import type { MessageListener } from '@php-wasm/universal';
import type { SyncProgressCallback } from '@php-wasm/web';
import { spawnPHPWorkerThread, exposeAPI, consumeAPI } from '@php-wasm/web';

import type {
	PlaygroundWorkerEndpoint,
	WorkerBootOptions,
	MountDescriptor,
} from './playground-worker-endpoint';
export type { MountDescriptor, WorkerBootOptions };
import type { WebClientMixin } from './playground-client';
import type { ProgressBarOptions } from './progress-bar';
import ProgressBar from './progress-bar';

type PHPRemoteApi = WebClientMixin & Pick<PlaygroundWorkerEndpoint, 'cli'>;

// @ts-ignore
import serviceWorkerPath from '../../service-worker.ts?worker&url';
import type { FilesystemOperation } from '@php-wasm/fs-journal';
import { logger } from '@php-wasm/logger';
import { PhpWasmError } from '@php-wasm/util';
import { responseTo } from '@php-wasm/web-service-worker';
import { serializeStreamedResponseForServiceWorker } from './service-worker-response';

// Select worker runtime (v1 or v2) based on query parameter
// @ts-ignore
import workerV1Url from './playground-worker-endpoint-blueprints-v1.ts?worker&url';
// @ts-ignore
import workerV2Url from './playground-worker-endpoint-blueprints-v2.ts?worker&url';

// Avoid literal "import.meta.url" on purpose as vite would attempt
// to resolve it during build time. This should specifically be
// resolved by the browser at runtime to reflect the current origin.
const origin = new URL('/', (import.meta || {}).url).origin;

function getWorkerUrl(): string {
	const runner = new URL(document.location.href).searchParams.get(
		'blueprints-runner'
	);
	const isV2 = runner === 'v2';
	const selected = isV2 ? workerV2Url : workerV1Url;
	return new URL(selected, origin) + '';
}

export const serviceWorkerUrl = new URL(serviceWorkerPath, origin);

// Prevent Vite from hot-reloading this file – it would
// cause bootPlaygroundRemote() to register another web worker
// without unregistering the previous one. The first web worker
// would then fight for service worker requests with the second
// one. It's a difficult problem to debug and HMR isn't that useful
// here anyway – let's just disable it for this file.
// @ts-ignore
if (import.meta.hot) {
	// @ts-ignore
	import.meta.hot.accept(() => {});
}

const query = new URL(document.location.href).searchParams;

// Match the iframe canvas to WordPress while a new document is parsing.
const WP_ADMIN_BACKGROUND_COLOR = '#f0f0f1';
const DEFAULT_WORDPRESS_BACKGROUND_COLOR = '#fff';
const documentsWithNavigationHandlers = new WeakSet<Document>();

export async function bootPlaygroundRemote() {
	assertNotInfiniteLoadingLoop();

	const hasProgressBar = query.has('progressbar');
	let bar: ProgressBar | undefined;
	if (hasProgressBar) {
		bar = new ProgressBar();
		document.body.prepend(bar.element);
	}
	const sw = navigator.serviceWorker;
	if (!sw) {
		/**
		 * Service workers may only run in secure contexts.
		 * See https://w3c.github.io/webappsec-secure-contexts/
		 */
		if (window.isSecureContext) {
			throw new PhpWasmError(
				'Service workers are not supported in your browser.'
			);
		} else {
			throw new PhpWasmError(
				'WordPress Playground uses service workers and may only work on HTTPS and http://localhost/ sites, but the current site is neither.'
			);
		}
	}

	const registration = await sw.register(serviceWorkerUrl + '', {
		type: 'module',
		// Always bypass HTTP cache when fetching the new Service Worker script:
		updateViaCache: 'none',
	});

	// Check if there's a new service worker available and, if so, enqueue
	// the update:
	try {
		await registration.update();
	} catch (e) {
		// registration.update() throws if it can't reach the server.
		// We're swallowing the error to keep the app working in offline mode
		// or when playground.wordpress.net is down. We can be sure we have a
		// functional service worker at this point because sw.register() succeeded.
		logger.error('Failed to update service worker.', e);
	}

	/**
	 * Feature-detect Document-Isolation-Policy support.
	 *
	 * Note this is not awaited on purpose. We don't want to delay the entire
	 * loading pipeline here. This information is only needed before the first
	 * page load inside the iframe so it's awaited later on in goTo().
	 *
	 * See `service-worker.ts` for the full story on why Playground does this.
	 */
	const documentIsolationSupportDetected =
		detectDocumentIsolationPolicySuport().then((isolationSupported) => {
			navigator.serviceWorker.controller?.postMessage({
				type: 'document-isolation-policy-support-check',
				supported: isolationSupported,
			});
		});

	const workerUrl = new URL(getWorkerUrl(), origin) + '';

	const phpWorkerApi = consumeAPI<PlaygroundWorkerEndpoint>(
		await spawnPHPWorkerThread(workerUrl)
	);

	let wpFrame = document.querySelector('#wp') as HTMLIFrameElement;
	let stagedNavigationFrame: HTMLIFrameElement | undefined;
	let cancelStagedNavigation: (() => void) | undefined;
	const navigationListeners = new Set<(url: string) => void>();

	/**
	 * Load the next WordPress document before replacing the visible iframe.
	 * This keeps the current admin page visible until the new page is ready.
	 */
	const stageWordPressFrameNavigation = (url: string): Promise<void> => {
		const currentFrame = wpFrame;
		const nextFrame = createStagedWordPressFrame(currentFrame, url);

		// A newer navigation supersedes any staged document still loading.
		cancelStagedNavigation?.();
		stagedNavigationFrame?.remove();
		stagedNavigationFrame = nextFrame;
		setWordPressFrameBackground(currentFrame, url);
		const navigationComplete = new Promise<void>((resolve) => {
			let resolved = false;
			const resolveNavigation = () => {
				if (resolved) {
					return;
				}
				resolved = true;
				if (cancelStagedNavigation === resolveNavigation) {
					cancelStagedNavigation = undefined;
				}
				resolve();
			};
			cancelStagedNavigation = resolveNavigation;

			void activateStagedWordPressFrame(nextFrame, () => {
				if (stagedNavigationFrame !== nextFrame) {
					nextFrame.remove();
					resolveNavigation();
					return;
				}

				stagedNavigationFrame = undefined;
				currentFrame.removeAttribute('id');
				nextFrame.id = 'wp';
				nextFrame.classList.remove('is-staged');
				currentFrame.remove();
				wpFrame = nextFrame;
				setupWordPressFrame(
					wpFrame,
					stageWordPressFrameNavigation,
					navigationListeners,
					(urlToConvert) => playground.internalUrlToPath(urlToConvert)
				);
				for (const listener of navigationListeners) {
					void notifyWordPressFrameNavigation(
						wpFrame,
						listener,
						(urlToConvert) =>
							playground.internalUrlToPath(urlToConvert)
					);
				}
				resolveNavigation();
			});
		});
		currentFrame.after(nextFrame);
		return navigationComplete;
	};
	setupWordPressFrame(
		wpFrame,
		stageWordPressFrameNavigation,
		navigationListeners,
		(urlToConvert) => playground.internalUrlToPath(urlToConvert)
	);
	const phpRemoteApi: PHPRemoteApi = {
		async onDownloadProgress(fn) {
			return phpWorkerApi.onDownloadProgress(fn);
		},
		/**
		 * Re-expose cli() from this iframe instead of piping through the
		 * worker proxy. WebKit otherwise receives a Comlink function proxy
		 * from another Comlink proxy and may dispatch the call to an endpoint
		 * that has not booted yet.
		 */
		async cli(argv, options) {
			return await phpWorkerApi.cli(argv, options);
		},
		async journalFSEvents(root: string, callback) {
			return phpWorkerApi.journalFSEvents(root, callback);
		},
		async replayFSJournal(events: FilesystemOperation[]) {
			return phpWorkerApi.replayFSJournal(events);
		},
		async addEventListener(event, listener) {
			return await phpWorkerApi.addEventListener(event, listener);
		},
		async removeEventListener(event, listener) {
			return await phpWorkerApi.removeEventListener(event, listener);
		},
		async setProgress(options: ProgressBarOptions) {
			if (!bar) {
				throw new Error('Progress bar not available');
			}
			bar.setOptions(options);
		},
		async setLoaded() {
			if (!bar) {
				throw new Error('Progress bar not available');
			}
			bar.destroy();
		},

		/**
		 * Listens to Playground navigation.
		 *
		 * @param fn The function to be called when a navigation event occurs.
		 */
		async onNavigation(fn) {
			/**
			 * Note: We do not manually clear the event listener and the interval set in this function.
			 *
			 * This is because we're inside remote.html – a Playground instance-specific iframe.
			 * When a Playground is stopped the iframe is destroyed and the resources – cleaned up.
			 * Even if we wanted to clean up these resources manually, it would have to be onbeforeunload.
			 * We'll let the browser handle that.
			 */
			let lastPath: string | undefined;
			const notifyPath = (path: string) => {
				if (path !== lastPath) {
					lastPath = path;
					fn(path);
				}
			};

			/**
			 * Listen for URL change messages from the WordPress iframe.
			 *
			 * When Document-Isolation-Policy is enabled, we can't access the
			 * iframe's location.href due to cross-origin restrictions. Instead,
			 * a WordPress MU plugin posts a message with the current URL.
			 *
			 * @see packages/playground/remote/src/lib/playground-mu-plugin/0-playground.php
			 */
			window.addEventListener('message', async (event) => {
				if (event.source !== wpFrame.contentWindow) {
					return;
				}
				try {
					const data =
						typeof event.data === 'string'
							? JSON.parse(event.data)
							: event.data;
					if (data?.type !== 'playground-url-change') {
						return;
					}
					const path = await playground.internalUrlToPath(data.url);
					notifyPath(path);
				} catch {
					// Ignore JSON parse errors
				}
			});

			navigationListeners.add(notifyPath);
			addWordPressFrameNavigationListener(wpFrame, notifyPath, (url) =>
				playground.internalUrlToPath(url)
			);

			// Also propagate navigation changes twice a second for any
			// updates we don't receive via the iframe load event.
			//
			// For more details on the challenges related to the load event,
			// see:
			//
			// * https://github.com/WordPress/wordpress-playground/pull/1945
			// * https://html.spec.whatwg.org/multipage/document-sequences.html#nav-active-history-entry
			// * https://html.spec.whatwg.org/dev/browsing-the-web.html#centralized-modifications-of-session-history
			setInterval(async () => {
				try {
					let href = '';
					if (wpFrame.contentWindow) {
						href = wpFrame.contentWindow.location.href;
					} else {
						href = wpFrame.src;
					}
					const path = await playground.internalUrlToPath(href);
					if (path !== lastPath) {
						lastPath = path;
						fn(path);
					}
				} catch {
					// Ignore errors due to CORS or CSP restrictions
				}
			}, 500);
		},
		async goTo(requestedPath: string) {
			// We need to know whether the browser supports
			// Document-Isolation-Policy before the first navigation.
			await documentIsolationSupportDetected;

			if (!requestedPath.startsWith('/')) {
				requestedPath = '/' + requestedPath;
			}
			/**
			 * Workaround for a Safari bug: navigating to `/wp-admin`
			 * without the trailing slash causes the browser to hang.
			 * Chrome and Firefox correctly navigate to `/wp-admin`,
			 * get a 302 redirect from PHPRequestHandler, and then follow
			 * it to `/wp-admin/`.
			 *
			 * Interestingly, opening pretty permalinks without the trailing slash
			 * works correctly. For example, `/sample-page` works as expected.
			 */
			if (requestedPath === '/wp-admin') {
				requestedPath = '/wp-admin/';
			}
			const newUrl = await playground.pathToInternalUrl(requestedPath);
			await stageWordPressFrameNavigation(newUrl);
		},
		async getCurrentURL() {
			let url = '';
			try {
				url = wpFrame.contentWindow!.location.href;
			} catch {
				// The above call can fail if we're embedded in an
				// environment with a restrictive CSP policy.
			}
			if (!url) {
				// If we can't get the URL from the iframe (e.g. it's not loaded
				// yet), let's refer to the src attribute of the iframe itself.
				// This is less reliable because the src attribute may not be
				// updated when the iframe navigates to a new URL.
				url = wpFrame.src;
			}
			return await playground.internalUrlToPath(url);
		},
		async setIframeSandboxFlags(flags: string[]) {
			wpFrame.setAttribute('sandbox', flags.join(' '));
		},
		/**
		 * This function is merely here to explicitly call workerApi.onMessage.
		 * Comlink should be able to handle that on its own, but something goes
		 * wrong and if this function is not here, we see the following error:
		 *
		 * Error: Failed to execute 'postMessage' on 'Worker': function() {
		 * } could not be cloned.
		 *
		 * In the future, this explicit declaration shouldn't be needed.
		 *
		 * @param callback
		 * @returns
		 */
		async onMessage(callback: MessageListener) {
			return await phpWorkerApi.onMessage(callback);
		},

		/**
		 * Ditto for this function.
		 * @see onMessage
		 * @param callback
		 * @returns
		 */
		async mountOpfs(
			options: MountDescriptor,
			onProgress?: SyncProgressCallback
		) {
			return await phpWorkerApi.mountOpfs(options, onProgress);
		},

		async flushOpfs(mountpoint: string) {
			return await phpWorkerApi.flushOpfs(mountpoint);
		},

		/**
		 * Ditto for this function.
		 * @see onMessage
		 * @param mountpoint
		 * @returns
		 */
		async unmountOpfs(mountpoint: string) {
			return await phpWorkerApi.unmountOpfs(mountpoint);
		},

		/**
		 * Download WordPress assets.
		 * @see backfillStaticFilesRemovedFromMinifiedBuild in the worker-thread.ts
		 */
		async backfillStaticFilesRemovedFromMinifiedBuild() {
			await phpWorkerApi.backfillStaticFilesRemovedFromMinifiedBuild();
		},

		/**
		 * Checks whether we have the missing WordPress assets readily
		 * available in the request cache.
		 */
		async hasCachedStaticFilesRemovedFromMinifiedBuild() {
			return await phpWorkerApi.hasCachedStaticFilesRemovedFromMinifiedBuild();
		},

		async boot(options) {
			await phpWorkerApi.boot(options);

			// Proxy the service worker messages to the web worker:
			navigator.serviceWorker.addEventListener(
				'message',
				async function onMessage(event) {
					/**
					 * Ignore events meant for other PHP instances to
					 * avoid handling the same event twice.
					 *
					 * This is important because the service worker posts the
					 * same message to all application instances across all browser tabs.
					 */
					if (options.scope && event.data.scope !== options.scope) {
						return;
					}

					const args = event.data.args || [];
					const method = event.data
						.method as keyof PlaygroundWorkerEndpoint;
					if (method === 'request') {
						const streamedResponse = await (
							phpWorkerApi.requestStreamed as any
						)(...args);

						/**
						 * ReadableStreams are transferable, but cannot be
						 * transferred to the service worker.
						 *
						 * In Chrome, ServiceWorker.postMessage() silently drops the entire
						 * message when the transfer list contains a ReadableStream.
						 * The call succeeds and the stream detaches from the sender,
						 * but the message never arrives at the service worker.
						 *
						 * To work around this, we bridge the body stream via a MessagePort.
						 *
						 * See:
						 * * https://github.com/whatwg/streams/issues/1063
						 * * https://github.com/whatwg/streams/issues/276
						 * * https://groups.google.com/a/chromium.org/g/chromium-discuss/c/90Esr_dE6U4
						 *
						 * HTML responses are intentionally buffered instead
						 * of bridged through a MessagePort so the browser can
						 * inspect the document body during navigation.
						 */
						const { response, transfer } =
							await serializeStreamedResponseForServiceWorker(
								streamedResponse
							);
						(event.source! as ServiceWorker).postMessage(
							responseTo(event.data.requestId, response),
							transfer
						);
					} else {
						// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
						const result = await (phpWorkerApi[method] as Function)(
							...args
						);
						event.source!.postMessage(
							responseTo(event.data.requestId, result)
						);
					}
				}
			);
			sw.startMessages();

			try {
				await phpWorkerApi.isReady();

				setupDynamicPostMessageRelay(
					() => wpFrame,
					getOrigin((await playground.absoluteUrl)!)
				);

				setAPIReady();
			} catch (e) {
				setAPIError(e as Error);
				throw e;
			}

			/**
			 * When we're running WordPress from a minified bundle, we're missing some static assets.
			 * The section below backfills them if needed. It doesn't do anything if the assets are already
			 * in place, or when WordPress is loaded from a non-minified bundle.
			 *
			 * Minified bundles are shipped without most static assets to reduce the bundle size and
			 * the loading time. When WordPress loads for the first time, the browser parses all the
			 * <script src="">, <link href="">, etc. tags and fetches the missing assets from the server.
			 *
			 * Unfortunately, fetching these assets on demand wouldn't work in an offline mode.
			 *
			 * Below we're downloading a zipped bundle of the missing assets.
			 */
			if (
				await phpRemoteApi.hasCachedStaticFilesRemovedFromMinifiedBuild()
			) {
				/**
				 * If we already have the static assets in the cache, the backfilling only
				 * involves unzipping the archive. This is fast. Let's do it before the first
				 * render.
				 *
				 * Why?
				 *
				 * Because otherwise the initial offline page render would lack CSS.
				 * Without the static assets in /wordpress/wp-content, the browser would
				 * attempt to fetch them from the server. However, we're in an offline mode
				 * so nothing would be fetched.
				 */
				await phpRemoteApi.backfillStaticFilesRemovedFromMinifiedBuild();
			} else {
				/**
				 * If we don't have the static assets in the cache, we need to fetch them.
				 *
				 * Let's wait for the initial page load before we start the backfilling.
				 * The static assets are 12MB+ in size. Starting the download before
				 * Playground is loaded would noticeably delay the first paint.
				 */
				wpFrame.addEventListener('load', () => {
					phpRemoteApi.backfillStaticFilesRemovedFromMinifiedBuild();
				});
			}
		},
	};

	await phpWorkerApi.isConnected();

	// If onDownloadProgress is not explicitly re-exposed here,
	// Comlink will throw an error and claim the callback
	// cannot be cloned. Adding a transfer handler for functions
	// doesn't help:
	// https://github.com/GoogleChromeLabs/comlink/issues/426#issuecomment-578401454
	// @TODO: Handle the callback conversion automatically and don't explicitly re-expose
	//        the onDownloadProgress method
	const [setAPIReady, setAPIError, playground] = exposeAPI(
		phpRemoteApi,
		phpWorkerApi
	);

	/*
	 * An assertion to make sure Playground Client is compatible
	 * with Remote<PlaygroundClient>
	 */
	return playground;
}

/**
 * Interacts with the service-worker served HTML document to check
 * the browser support for Document-Isolation-Policy.
 *
 * See `service-worker.ts` for more details.
 */
function detectDocumentIsolationPolicySuport(): Promise<boolean> {
	return new Promise((resolve) => {
		const testFrame = document.createElement('iframe');
		testFrame.style.display = 'none';
		// This file does not exist on the server. It is served by the
		// service worker.
		testFrame.src = '/feature-detect/document-isolation-policy.html';

		// From here, we're:
		// 1. Creating an iframe.
		// 2. Waiting for a message that confirms support for Document-Isolation-Policy.
		// 3. If anything goes wrong or we time out, we assume no support.
		let resolved = false;
		const cleanup = () => {
			if (resolved) return;
			resolved = true;
			window.removeEventListener('message', messageHandler);
			clearTimeout(timeoutId);
			testFrame.remove();
		};

		const messageHandler = (event: MessageEvent) => {
			if (event.source !== testFrame.contentWindow) {
				return;
			}
			cleanup();
			resolve(event.data.supported === true);
		};
		window.addEventListener('message', messageHandler);

		const timeoutId = setTimeout(() => {
			cleanup();
			resolve(false);
		}, 1000);

		testFrame.onerror = () => {
			cleanup();
			resolve(false);
		};

		document.body.appendChild(testFrame);
	});
}

function getOrigin(url: string) {
	return new URL(url, 'https://example.com').origin;
}

function setupWordPressFrame(
	wpFrame: HTMLIFrameElement,
	navigate: (url: string) => void | Promise<void>,
	navigationListeners: Set<(url: string) => void>,
	internalUrlToPath: (url: string) => Promise<string>
) {
	wpFrame.classList.add('wp-frame');
	setupWordPressFrameBackgroundSync(wpFrame, navigate);
	for (const listener of navigationListeners) {
		addWordPressFrameNavigationListener(
			wpFrame,
			listener,
			internalUrlToPath
		);
	}
}

function createStagedWordPressFrame(
	currentFrame: HTMLIFrameElement,
	url: string
) {
	const nextFrame = document.createElement('iframe');
	nextFrame.title = currentFrame.title;
	nextFrame.className = currentFrame.className;
	nextFrame.classList.add('wp-frame', 'is-staged');

	const sandbox = currentFrame.getAttribute('sandbox');
	if (sandbox !== null) {
		nextFrame.setAttribute('sandbox', sandbox);
	}

	setWordPressFrameBackground(nextFrame, url);
	nextFrame.src = url;
	return nextFrame;
}

async function activateStagedWordPressFrame(
	wpFrame: HTMLIFrameElement,
	activate: () => void
) {
	await waitForWordPressFrameLoad(wpFrame);
	await new Promise((resolve) => requestAnimationFrame(resolve));
	activate();
}

function waitForWordPressFrameLoad(wpFrame: HTMLIFrameElement) {
	return new Promise<void>((resolve) => {
		const onLoad = () => {
			if (getWordPressFrameUrl(wpFrame) === 'about:blank') {
				return;
			}
			wpFrame.removeEventListener('load', onLoad);
			resolve();
		};
		wpFrame.addEventListener('load', onLoad);
	});
}

function setupWordPressFrameBackgroundSync(
	wpFrame: HTMLIFrameElement,
	navigate: (url: string) => void | Promise<void>
) {
	const syncFromCurrentDocument = () => {
		const currentUrl = getWordPressFrameUrl(wpFrame);
		setWordPressFrameBackground(wpFrame, currentUrl);
		installNavigationHandlers(wpFrame, navigate);
	};

	wpFrame.addEventListener('load', syncFromCurrentDocument);
	syncFromCurrentDocument();
}

function addWordPressFrameNavigationListener(
	wpFrame: HTMLIFrameElement,
	listener: (url: string) => void,
	internalUrlToPath: (url: string) => Promise<string>
) {
	wpFrame.addEventListener('load', async (e: Event) => {
		await notifyWordPressFrameNavigation(
			e.currentTarget as HTMLIFrameElement,
			listener,
			internalUrlToPath
		);
	});
}

async function notifyWordPressFrameNavigation(
	wpFrame: HTMLIFrameElement,
	listener: (url: string) => void,
	internalUrlToPath: (url: string) => Promise<string>
) {
	try {
		/**
		 * When navigating to a page with %0A sequences (encoded newlines)
		 * in the query string, the `location.href` property of the
		 * iframe's content window doesn't seem to reflect them. Everything
		 * else is in place, but not the %0A sequences.
		 *
		 * Weirdly, these sequences are available after the next event
		 * loop tick – hence the `setTimeout(0)`.
		 *
		 * The exact cause is unclear at the moment of writing of this
		 * comment. The WHATWG HTML Standard [1] has a few hints:
		 *
		 * * Current and active session history entries may get out of
		 *   sync for iframes.
		 * * Documents inside iframes have "is delaying load events" set
		 *   to true.
		 *
		 * But there doesn't seem to be any concrete explanation and no
		 * recommended remediation. If anyone has a clue, please share it
		 * in a GitHub issue or start a new PR.
		 *
		 * [1] https://html.spec.whatwg.org/multipage/document-sequences.html#nav-active-history-entry
		 */
		await new Promise((resolve) => setTimeout(resolve, 0));
		const path = await internalUrlToPath(
			wpFrame.contentWindow!.location.href
		);
		listener(path);
	} catch {
		// Ignore errors due to CORS or CSP restrictions.
	}
}

function installNavigationHandlers(
	wpFrame: HTMLIFrameElement,
	navigate: (url: string) => void | Promise<void>
) {
	try {
		const doc = wpFrame.contentDocument;
		if (!doc || documentsWithNavigationHandlers.has(doc)) {
			return;
		}

		doc.addEventListener(
			'click',
			(event) => {
				const mouseEvent = event as MouseEvent;
				const element = event.target as Element | null;
				const link = element?.closest(
					'a[href]'
				) as HTMLAnchorElement | null;
				if (!link) {
					return;
				}

				if (shouldStageLinkNavigation(mouseEvent, link, wpFrame)) {
					event.preventDefault();
					void navigate(link.href);
				} else {
					setWordPressFrameBackground(wpFrame, link.href);
				}
			},
			false
		);

		doc.addEventListener(
			'submit',
			(event) => {
				const form = event.target as HTMLFormElement | null;
				if (form?.action) {
					setWordPressFrameBackground(wpFrame, form.action);
				}
			},
			{ capture: true }
		);

		documentsWithNavigationHandlers.add(doc);
	} catch {
		// Ignore errors due to CORS or CSP restrictions.
	}
}

function shouldStageLinkNavigation(
	event: MouseEvent,
	link: HTMLAnchorElement,
	wpFrame: HTMLIFrameElement
) {
	if (
		event.defaultPrevented ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey ||
		event.button !== 0 ||
		link.hasAttribute('download')
	) {
		return false;
	}

	const target = link.getAttribute('target');
	if (target && target.toLowerCase() !== '_self') {
		return false;
	}

	const currentUrl = new URL(getWordPressFrameUrl(wpFrame));
	const nextUrl = new URL(link.href, currentUrl);
	if (nextUrl.origin !== currentUrl.origin) {
		return false;
	}

	if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
		return false;
	}

	const currentUrlWithoutHash = new URL(currentUrl);
	currentUrlWithoutHash.hash = '';
	const nextUrlWithoutHash = new URL(nextUrl);
	nextUrlWithoutHash.hash = '';
	if (
		nextUrl.hash &&
		nextUrlWithoutHash.href === currentUrlWithoutHash.href
	) {
		return false;
	}

	return true;
}

function setupDynamicPostMessageRelay(
	getNestedFrame: () => HTMLIFrameElement,
	expectedOrigin?: string
) {
	window.addEventListener('message', (event) => {
		const nestedFrame = getNestedFrame();
		if (event.source !== nestedFrame.contentWindow) {
			return;
		}

		if (expectedOrigin && event.origin !== expectedOrigin) {
			return;
		}

		if (typeof event.data !== 'object' || event.data.type !== 'relay') {
			return;
		}

		window.parent.postMessage(event.data, '*');
	});

	window.addEventListener('message', (event) => {
		if (event.source !== window.parent) {
			return;
		}

		if (typeof event.data !== 'object' || event.data.type !== 'relay') {
			return;
		}

		getNestedFrame().contentWindow?.postMessage(event.data);
	});
}

function setWordPressFrameBackground(wpFrame: HTMLIFrameElement, url: string) {
	const color = isWpAdminUrl(url)
		? WP_ADMIN_BACKGROUND_COLOR
		: DEFAULT_WORDPRESS_BACKGROUND_COLOR;
	wpFrame.style.backgroundColor = color;
	document.documentElement.style.backgroundColor = color;
	document.body.style.backgroundColor = color;
}

function getWordPressFrameUrl(wpFrame: HTMLIFrameElement) {
	try {
		return wpFrame.contentWindow?.location.href || wpFrame.src;
	} catch {
		return wpFrame.src;
	}
}

function isWpAdminUrl(url: string) {
	try {
		const { pathname } = new URL(url, document.location.href);
		return /\/wp-admin(?:\/|$)/.test(pathname);
	} catch {
		return false;
	}
}

/**
 * When the service worker fails for any reason, the page displayed inside
 * the iframe won't be a WordPress instance we expect from the service worker.
 * Instead, it will be the original page trying to load the service worker. This
 * causes an infinite loop with a loader inside a loader inside a loader.
 */
function assertNotInfiniteLoadingLoop() {
	let isBrowserInABrowser = false;
	try {
		isBrowserInABrowser =
			window.parent !== window &&
			(window as any).parent.IS_WASM_WORDPRESS;
	} catch {
		// ignore
	}
	if (isBrowserInABrowser) {
		throw new Error(
			`The service worker did not load correctly. This is a bug,
			please report it on https://github.com/WordPress/wordpress-playground/issues`
		);
	}
	(window as any).IS_WASM_WORDPRESS = true;
}
