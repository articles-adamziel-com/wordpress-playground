/**
 * Background service worker for the WordPress Playground DevTools extension.
 *
 * Manages communication between content scripts and the DevTools panel,
 * and tracks which frames have playground instances.
 */

import {
	getHostname,
	getOrigin,
	getOriginPattern,
	hasPermissionForUrl,
	isAllowlistedUrl,
	isSupportedUrl,
} from './permissions';

interface PlaygroundFrame {
	frameId: number;
	tabId: number;
	url: string;
	hasPlayground: boolean;
	documentRoot?: string;
}

interface FrameAccess {
	frameId: number;
	parentFrameId: number;
	url: string;
	origin: string;
	originPattern: string | null;
	hostname: string;
	isSupported: boolean;
	isAllowlisted: boolean;
	hasPermission: boolean;
	canRequestPermission: boolean;
}

interface InjectionResult {
	frameId: number;
	url: string;
	injected: boolean;
	error?: string;
}

// Store playground frames per tab
const playgroundFrames = new Map<number, Map<number, PlaygroundFrame>>();

// Store connections to DevTools panels
const devToolsConnections = new Map<number, chrome.runtime.Port>();

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getDetectedPlaygroundFrames(tabId: number): PlaygroundFrame[] {
	return Array.from(playgroundFrames.get(tabId)?.values() ?? []).filter(
		(frame) => frame.hasPlayground
	);
}

function getDynamicContentScriptId(originPattern: string): string {
	return `wp-playground-devtools-${originPattern
		.replace(/[^a-zA-Z0-9_]/g, '_')
		.slice(0, 80)}`;
}

function canRegisterDynamicContentScript(originPattern: string): boolean {
	return (
		originPattern === '<all_urls>' ||
		originPattern.startsWith('http://') ||
		originPattern.startsWith('https://')
	);
}

async function registerDynamicContentScript(originPattern: string) {
	if (!canRegisterDynamicContentScript(originPattern)) {
		return;
	}

	const id = getDynamicContentScriptId(originPattern);
	const existing = await chrome.scripting.getRegisteredContentScripts({
		ids: [id],
	});

	if (existing.length > 0) {
		return;
	}

	try {
		await chrome.scripting.registerContentScripts([
			{
				id,
				matches: [originPattern],
				js: ['content-script.js'],
				runAt: 'document_idle',
				allFrames: true,
				matchOriginAsFallback: true,
				persistAcrossSessions: true,
			},
		]);
	} catch (error) {
		const existingAfterError =
			await chrome.scripting.getRegisteredContentScripts({
				ids: [id],
			});
		if (existingAfterError.length === 0) {
			throw error;
		}
	}
}

async function unregisterDynamicContentScripts(originPatterns: string[]) {
	const ids = originPatterns
		.filter(canRegisterDynamicContentScript)
		.map(getDynamicContentScriptId);

	if (ids.length === 0) {
		return;
	}

	await chrome.scripting.unregisterContentScripts({ ids });
}

async function syncDynamicContentScripts() {
	try {
		const permissions = await chrome.permissions.getAll();
		await Promise.all(
			(permissions.origins ?? []).map(registerDynamicContentScript)
		);
	} catch (error) {
		// eslint-disable-next-line no-console
		console.debug('Failed to sync dynamic content scripts:', error);
	}
}

async function getFrameAccess(tabId: number): Promise<FrameAccess[]> {
	const frames = await chrome.webNavigation.getAllFrames({ tabId });
	if (!frames) {
		return [];
	}

	return Promise.all(
		frames.map(async (frame) => {
			const originPattern = getOriginPattern(frame.url);
			const isSupported = isSupportedUrl(frame.url);
			const isAllowlisted = isAllowlistedUrl(frame.url);
			const hasPermission =
				isSupported &&
				(isAllowlisted || (await hasPermissionForUrl(frame.url)));

			return {
				frameId: frame.frameId,
				parentFrameId: frame.parentFrameId,
				url: frame.url,
				origin: getOrigin(frame.url),
				originPattern,
				hostname: getHostname(frame.url),
				isSupported,
				isAllowlisted,
				hasPermission,
				canRequestPermission: isSupported && !isAllowlisted,
			};
		})
	);
}

async function postFrameState(
	tabId: number,
	injectionResults?: InjectionResult[]
) {
	const port = devToolsConnections.get(tabId);
	if (!port) {
		return;
	}

	port.postMessage({
		type: 'FRAMES_UPDATED',
		frames: getDetectedPlaygroundFrames(tabId),
		frameAccess: await getFrameAccess(tabId),
		injectionResults,
	});
}

function recordPlaygroundFrame(
	tabId: number,
	frameId: number,
	response: {
		url: string;
		hasPlayground: boolean;
		documentRoot?: string;
	}
) {
	const frames = playgroundFrames.get(tabId) ?? new Map();
	frames.set(frameId, {
		frameId,
		tabId,
		url: response.url,
		hasPlayground: response.hasPlayground,
		documentRoot: response.documentRoot,
	});
	playgroundFrames.set(tabId, frames);
}

async function refreshFrame(tabId: number, frameId: number) {
	try {
		const response = await chrome.tabs.sendMessage(
			tabId,
			{ type: 'CHECK_PLAYGROUND' },
			{ frameId }
		);

		if (response) {
			recordPlaygroundFrame(tabId, frameId, response);
		}
	} catch {
		// No content script is available in this frame.
	}
}

async function refreshTabFrames(tabId: number) {
	const frameAccess = await getFrameAccess(tabId);
	const activeFrameIds = new Set(frameAccess.map((frame) => frame.frameId));
	const tabFrames = playgroundFrames.get(tabId);

	if (tabFrames) {
		for (const frameId of tabFrames.keys()) {
			if (!activeFrameIds.has(frameId)) {
				tabFrames.delete(frameId);
			}
		}
	}

	await Promise.all(
		frameAccess
			.filter((frame) => frame.hasPermission)
			.map((frame) => refreshFrame(tabId, frame.frameId))
	);

	await postFrameState(tabId);
}

async function injectContentScript(
	tabId: number,
	originPattern?: string
): Promise<InjectionResult[]> {
	const frameAccess = await getFrameAccess(tabId);
	const framesToInject = frameAccess.filter(
		(frame) =>
			frame.hasPermission &&
			(!originPattern ||
				originPattern === '<all_urls>' ||
				frame.originPattern === originPattern)
	);

	const results = await Promise.all(
		framesToInject.map(async (frame): Promise<InjectionResult> => {
			try {
				await chrome.scripting.executeScript({
					target: { tabId, frameIds: [frame.frameId] },
					files: ['content-script.js'],
				});
				return {
					frameId: frame.frameId,
					url: frame.url,
					injected: true,
				};
			} catch (error) {
				return {
					frameId: frame.frameId,
					url: frame.url,
					injected: false,
					error: getErrorMessage(error),
				};
			}
		})
	);

	await Promise.all(
		results
			.filter((result) => result.injected)
			.map((result) => refreshFrame(tabId, result.frameId))
	);
	await postFrameState(tabId, results);

	return results;
}

async function registerAndInjectHostPermission(tabId: number, url: string) {
	const originPattern = getOriginPattern(url);
	if (originPattern) {
		await registerDynamicContentScript(originPattern);
	}

	await injectContentScript(tabId, originPattern ?? undefined);
	await refreshTabFrames(tabId);
}

/**
 * Handle messages from content scripts.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'PLAYGROUND_STATUS' && sender.tab?.id !== undefined) {
		const tabId = sender.tab.id;
		const frameId = sender.frameId ?? 0;

		recordPlaygroundFrame(tabId, frameId, {
			url: message.url,
			hasPlayground: message.hasPlayground,
			documentRoot: message.documentRoot,
		});

		void postFrameState(tabId);
		return false;
	}

	// Handle DETECT_PLAYGROUND - use chrome.scripting.executeScript to check for window.playground
	if (message.type === 'DETECT_PLAYGROUND' && sender.tab?.id !== undefined) {
		const tabId = sender.tab.id;
		const frameId = sender.frameId ?? 0;

		chrome.scripting
			.executeScript({
				target: { tabId, frameIds: [frameId] },
				world: 'MAIN',
				func: () => {
					const hasPlayground =
						typeof (window as any).playground !== 'undefined' &&
						(window as any).playground !== null;
					let documentRoot: string | undefined = undefined;
					if (hasPlayground) {
						const pg = (window as any).playground;
						if (typeof pg.documentRoot === 'string') {
							documentRoot = pg.documentRoot;
						}
					}
					return { hasPlayground, documentRoot };
				},
			})
			.then((results) => {
				const result = results?.[0]?.result;
				sendResponse(result || { hasPlayground: false });
			})
			.catch((error) => {
				// eslint-disable-next-line no-console
				console.error('Failed to detect playground:', error);
				sendResponse({ hasPlayground: false });
			});

		return true; // Keep message channel open for async response
	}

	// Handle EXEC_PLAYGROUND_METHOD - execute a method on window.playground
	if (
		message.type === 'EXEC_PLAYGROUND_METHOD' &&
		sender.tab?.id !== undefined
	) {
		const tabId = sender.tab.id;
		const frameId = sender.frameId ?? 0;
		const { method, args } = message;

		chrome.scripting
			.executeScript({
				target: { tabId, frameIds: [frameId] },
				world: 'MAIN',
				func: async (methodName: string, methodArgs: unknown[]) => {
					try {
						const pg = (window as any).playground;
						if (!pg) {
							throw new Error(
								'window.playground is not available'
							);
						}
						if (typeof pg[methodName] !== 'function') {
							throw new Error(
								`Method ${methodName} is not a function on window.playground`
							);
						}
						let result = await pg[methodName](...methodArgs);
						// Handle ArrayBuffer/Uint8Array results by converting to array
						if (result instanceof Uint8Array) {
							result = {
								__type: 'Uint8Array',
								data: Array.from(result),
							};
						} else if (result instanceof ArrayBuffer) {
							result = {
								__type: 'Uint8Array',
								data: Array.from(new Uint8Array(result)),
							};
						}
						return { result };
					} catch (error: any) {
						return { error: error.message || String(error) };
					}
				},
				args: [method, args],
			})
			.then((results) => {
				const response = results?.[0]?.result;
				sendResponse(
					response || { error: 'No result from script execution' }
				);
			})
			.catch((error) => {
				sendResponse({
					error: error.message || 'Script execution failed',
				});
			});

		return true; // Keep message channel open for async response
	}

	return false;
});

/**
 * Handle connections from DevTools panels.
 */
chrome.runtime.onConnect.addListener((port) => {
	if (port.name !== 'playground-devtools') {
		return;
	}

	let tabId: number | null = null;

	port.onMessage.addListener((message) => {
		if (message.type === 'INIT') {
			tabId = message.tabId;
			if (tabId === null) {
				return;
			}
			devToolsConnections.set(tabId, port);

			void (async () => {
				await syncDynamicContentScripts();
				await injectContentScript(tabId!);
				await refreshTabFrames(tabId!);
			})();
		}

		if (message.type === 'REFRESH_FRAMES' && tabId !== null) {
			void refreshTabFrames(tabId);
		}

		if (
			(message.type === 'HOST_PERMISSION_GRANTED' ||
				message.type === 'INJECT_CONTENT_SCRIPT') &&
			tabId !== null
		) {
			void registerAndInjectHostPermission(tabId, message.url);
		}

		if (message.type === 'EXECUTE_METHOD' && tabId !== null) {
			// Forward method execution to the content script in the specified frame
			chrome.tabs
				.sendMessage(
					tabId,
					{
						type: 'EXECUTE_PLAYGROUND_METHOD',
						method: message.method,
						args: message.args,
					},
					{ frameId: message.frameId }
				)
				.then((result) => {
					port.postMessage({
						type: 'METHOD_RESULT',
						requestId: message.requestId,
						result,
					});
				})
				.catch((error) => {
					port.postMessage({
						type: 'METHOD_RESULT',
						requestId: message.requestId,
						error: error.message,
					});
				});
		}
	});

	port.onDisconnect.addListener(() => {
		if (tabId !== null) {
			devToolsConnections.delete(tabId);
		}
	});
});

chrome.permissions.onAdded.addListener((permissions) => {
	void Promise.all(
		(permissions.origins ?? []).map(registerDynamicContentScript)
	);
});

chrome.permissions.onRemoved.addListener((permissions) => {
	void (async () => {
		await unregisterDynamicContentScripts(permissions.origins ?? []);
		for (const tabId of devToolsConnections.keys()) {
			await refreshTabFrames(tabId);
		}
	})();
});

chrome.runtime.onInstalled.addListener(() => {
	void syncDynamicContentScripts();
});

chrome.runtime.onStartup.addListener(() => {
	void syncDynamicContentScripts();
});

void syncDynamicContentScripts();

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
	playgroundFrames.delete(tabId);
	devToolsConnections.delete(tabId);
});

// Clean up frames when navigation happens
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
	if (details.frameId === 0) {
		// Main frame navigation - clear all frames for this tab
		playgroundFrames.delete(details.tabId);
	} else {
		// Subframe navigation - clear just that frame
		const frames = playgroundFrames.get(details.tabId);
		if (frames) {
			frames.delete(details.frameId);
		}
	}

	void postFrameState(details.tabId);
});

chrome.webNavigation.onCompleted.addListener((details) => {
	if (!devToolsConnections.has(details.tabId)) {
		return;
	}

	void (async () => {
		await injectContentScript(details.tabId);
		await refreshTabFrames(details.tabId);
	})();
});
