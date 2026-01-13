import type { ProgressTracker } from '@php-wasm/progress';
import type { PlaygroundClient, StartPlaygroundOptions } from '.';
import {
	collectPhpLogs,
	logger,
	DebugTimeline,
	collectPhpRuntimeEvents,
	collectBlueprintV2Events,
	collectNavigationEvents,
} from '@php-wasm/logger';
import type { DebugLogAPI } from '@wp-playground/remote';
import { consumeAPI } from '@php-wasm/universal';

/**
 * Check if debug timeline is enabled via query param.
 */
function getDebugLogConfig(): { enabled: boolean; verbose: boolean } {
	if (typeof window === 'undefined') {
		return { enabled: false, verbose: false };
	}
	const params = new URLSearchParams(window.location.search);
	const debugLog = params.get('debug-log');
	return {
		enabled: debugLog === 'verbose' || debugLog === 'true',
		verbose: debugLog === 'verbose',
	};
}

/**
 * Create the debugLog API from a DebugTimeline instance.
 */
function createDebugLogAPI(timeline: DebugTimeline): DebugLogAPI {
	return {
		listSessions: () => timeline.listSessions(),
		readSession: (id: string) => timeline.readSession(id),
		readLatest: (n?: number) => timeline.readLatest(n),
		clearSessions: () => timeline.clearSessions(),
		exportSession: (id: string, format?) =>
			timeline.exportSession(id, format),
		getCurrentSession: () => timeline.getCurrentSession(),
	};
}

export class BlueprintsV2Handler {
	private readonly options: StartPlaygroundOptions;

	constructor(options: StartPlaygroundOptions) {
		this.options = options;
	}

	async bootPlayground(
		iframe: HTMLIFrameElement,
		progressTracker: ProgressTracker
	) {
		const {
			blueprint,
			onClientConnected,
			corsProxy,
			mounts,
			sapiName,
			scope,
			pathAliases,
		} = this.options;
		const downloadProgress = progressTracker!.stage(0.25);
		const executionProgress = progressTracker!.stage(0.75);

		// Connect the Comlink API client to the remote worker,
		// boot the playground, and run the blueprint steps.
		const playground = consumeAPI<PlaygroundClient>(
			iframe.contentWindow!,
			iframe.ownerDocument!.defaultView!
		) as PlaygroundClient;
		await playground.isConnected();
		progressTracker.pipe(playground);

		// Connect the Comlink API client to the remote worker download monitor
		await playground.onDownloadProgress(downloadProgress.loadingListener);
		await playground.addEventListener(
			'blueprint.message',
			({ message }: any) => {
				switch (message.type) {
					case 'blueprint.target_resolved': {
						// @TODO: Evaluate consistenty with the CLI worker
						// if (!this.blueprintTargetResolved) {
						// 	this.blueprintTargetResolved = true;
						// 	for (const php of this
						// 		.phpInstancesThatNeedMountsAfterTargetResolved) {
						// 		// console.log('mounting resources for php', php);
						// 		this.phpInstancesThatNeedMountsAfterTargetResolved.delete(
						// 			php
						// 		);
						// 		await mountResources(php, args.mount || []);
						// 	}
						// }
						break;
					}
					case 'blueprint.progress': {
						executionProgress.set(message.progress);
						executionProgress.setCaption(message.caption);
						break;
					}
					case 'blueprint.error': {
						// @TODO: Error reporting.
						const red = '\x1b[31m';
						const bold = '\x1b[1m';
						const reset = '\x1b[0m';
						if (message.details) {
							logger.error(
								`${red}${bold}Fatal error:${reset} Uncaught ${message.details.exception}: ${message.details.message}\n` +
									`  at ${message.details.file}:${message.details.line}\n` +
									(message.details.trace
										? message.details.trace + '\n'
										: '')
							);
						} else {
							logger.error(
								`${red}${bold}Error:${reset} ${message.message}\n`
							);
						}

						// TODO: Should we report the error like that?
						throw new Error(message.message);
						break;
					}
				}
			}
		);

		await playground.boot({
			mounts,
			sapiName,
			scope: scope ?? Math.random().toFixed(16),
			corsProxyUrl: corsProxy,
			extensions: this.options.extensions,
			experimentalBlueprintsV2Runner: true,
			// Pass the declaration directly – the worker runs the V2 runner.
			blueprint: blueprint as any,
			pathAliases,
		} as any);

		await playground.isReady();
		downloadProgress.finish();

		collectPhpLogs(logger, playground);

		// Initialize debug timeline if enabled
		const debugConfig = getDebugLogConfig();
		if (debugConfig.enabled) {
			const timeline = new DebugTimeline({
				verboseMode: debugConfig.verbose,
				siteSlug: scope,
			});
			await timeline.initialize();

			// Collect PHP runtime events
			collectPhpRuntimeEvents(timeline, playground);

			// Collect Blueprint V2 message events
			collectBlueprintV2Events(timeline, playground as any);

			// Collect navigation events
			collectNavigationEvents(timeline, playground as any);

			// Log initial boot
			timeline.log({
				category: 'runtime',
				type: 'runtime.initialized',
				message: 'Playground booted (Blueprints V2 mode)',
				data: { scope },
			});

			// Attach debugLog API to playground client
			(playground as any).debugLog = createDebugLogAPI(timeline);
		}

		onClientConnected?.(playground);

		// @TODO: Get the landing page from the Blueprint.
		playground.goTo('/');

		/**
		 * Pre-fetch WordPress update checks to speed up the initial wp-admin load.
		 *
		 * @see https://github.com/WordPress/wordpress-playground/pull/2295
		 */
		// @TODO get the enabled features somehow – probably using the same
		//       resolveRuntimeConfiguration() logic as the redux site-slice.ts
		// if (compiled.features.networking) {
		// 	await playground.prefetchUpdateChecks();
		// }

		return playground;
	}
}
