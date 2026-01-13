import type { ProgressTracker } from '@php-wasm/progress';
import {
	type PlaygroundClient,
	type StartPlaygroundOptions,
	compileBlueprintV1,
	isBlueprintBundle,
	runBlueprintV1Steps,
	resolveRuntimeConfiguration,
	BlueprintReflection,
} from '.';
import {
	collectPhpLogs,
	logger,
	DebugTimeline,
	collectPhpRuntimeEvents,
	createBlueprintV1Callbacks,
	collectNavigationEvents,
} from '@php-wasm/logger';
import type { DebugLogAPI } from '@wp-playground/remote';
import { consumeAPI } from '@php-wasm/universal';
import type { PHPWebExtension } from '@php-wasm/web';

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

export class BlueprintsV1Handler {
	private readonly options: StartPlaygroundOptions;

	constructor(options: StartPlaygroundOptions) {
		this.options = options;
	}

	async bootPlayground(
		iframe: HTMLIFrameElement,
		progressTracker: ProgressTracker
	) {
		const {
			onBlueprintValidated,
			onBlueprintStepCompleted,
			corsProxy,
			gitAdditionalHeadersCallback,
			mounts,
			sapiName,
			scope,
			shouldInstallWordPress,
			sqliteDriverVersion,
			wordpressInstallMode,
			onClientConnected,
			pathAliases,
		} = this.options;
		const executionProgress = progressTracker!.stage(0.5);
		const downloadProgress = progressTracker!.stage();

		// Set a default blueprint if none is provided.
		const blueprint = this.options.blueprint || {};

		// Connect the Comlink API client to the remote worker,
		// boot the playground, and run the blueprint steps.
		const playground = consumeAPI<PlaygroundClient>(
			iframe.contentWindow!,
			iframe.ownerDocument!.defaultView!
		) as PlaygroundClient;
		await playground.isConnected();
		progressTracker.pipe(playground);

		const runtimeConfiguration =
			await resolveRuntimeConfiguration(blueprint);
		const extensions: PHPWebExtension[] = runtimeConfiguration.intl
			? ['intl']
			: [];
		extensions.push(...(this.options.extensions || []));
		await playground.onDownloadProgress(downloadProgress.loadingListener);
		// Blueprint's `preferredVersions.wp: false` is the declarative way to
		// opt out of WordPress. Bundles carry their declaration inside a JSON
		// file we haven't read here, so we only honor the flag for inline
		// declarations. If the caller also requested WordPress explicitly and
		// the two disagree, refuse to silently pick a winner.
		const declarativeOptOut =
			!isBlueprintBundle(blueprint) &&
			blueprint.preferredVersions?.wp === false;
		const resolvedWordPressInstallMode: WordPressInstallMode =
			wordpressInstallMode ??
			(declarativeOptOut
				? 'do-not-attempt-installing'
				: shouldInstallWordPress === false
					? 'install-from-existing-files-if-needed'
					: 'download-and-install');
		if (
			declarativeOptOut &&
			(shouldInstallWordPress === true ||
				(wordpressInstallMode !== undefined &&
					wordpressInstallMode !== 'do-not-attempt-installing'))
		) {
			throw new Error(
				'Conflicting options: WordPress was requested, ' +
					'but the Blueprint sets ' +
					'`preferredVersions.wp: false`. Pick one.'
			);
		}
		await playground.boot({
			mounts,
			sapiName,
			scope: scope ?? Math.random().toFixed(16),
			wordpressInstallMode: resolvedWordPressInstallMode,
			phpVersion: runtimeConfiguration.phpVersion,
			wpVersion: runtimeConfiguration.wpVersion,
			extensions,
			withNetworking: runtimeConfiguration.networking,
			corsProxyUrl: corsProxy,
			sqliteDriverVersion,
			pathAliases,
		});
		await playground.isReady();
		downloadProgress.finish();

		collectPhpLogs(logger, playground);

		// Initialize debug timeline if enabled
		const debugConfig = getDebugLogConfig();
		let timeline: DebugTimeline | null = null;
		if (debugConfig.enabled) {
			timeline = new DebugTimeline({
				verboseMode: debugConfig.verbose,
				siteSlug: scope,
				phpVersion: runtimeConfiguration.phpVersion,
				wpVersion: runtimeConfiguration.wpVersion,
			});
			await timeline.initialize();

			// Collect PHP runtime events
			collectPhpRuntimeEvents(timeline, playground);

			// Collect navigation events
			collectNavigationEvents(timeline, playground as any);

			// Log initial boot
			timeline.log({
				category: 'runtime',
				type: 'runtime.initialized',
				message: `Playground booted with PHP ${runtimeConfiguration.phpVersion}, WP ${runtimeConfiguration.wpVersion}`,
				data: {
					phpVersion: runtimeConfiguration.phpVersion,
					wpVersion: runtimeConfiguration.wpVersion,
					scope,
				},
			});

			// Attach debugLog API to playground client
			(playground as any).debugLog = createDebugLogAPI(timeline);
		}

		onClientConnected?.(playground);

		const reflection = await BlueprintReflection.create(blueprint);
		if (reflection.getVersion() === 1) {
			// Create step callbacks that log to timeline
			const timelineCallbacks = timeline
				? createBlueprintV1Callbacks(timeline, {
						onStepCompleted: onBlueprintStepCompleted,
					})
				: null;

			const compiled = await compileBlueprintV1(blueprint, {
				progress: executionProgress,
				onStepCompleted:
					timelineCallbacks?.onStepCompleted ||
					onBlueprintStepCompleted,
				onBlueprintValidated,
				corsProxy,
				gitAdditionalHeadersCallback,
			});

			// Log blueprint start
			timeline?.log({
				category: 'blueprint',
				type: 'blueprint.step.start',
				message: 'Starting blueprint execution',
			});

			await runBlueprintV1Steps(compiled, playground);

			// Log blueprint completion
			timeline?.log({
				category: 'blueprint',
				type: 'blueprint.step.finish',
				message: 'Blueprint execution completed',
			});
		}

		/**
		 * Pre-fetch WordPress update checks to speed up the initial wp-admin load.
		 * Skip for old WordPress versions — the functions called by prefetch
		 * (wp_check_php_version, wp_update_plugins, etc.) don't exist or crash
		 * on legacy WP, and the resulting PHP errors create noise. WP 5.0
		 * (Gutenberg 1.0) also crashes the runtime with exit code 255 inside
		 * prefetchUpdateChecks when using the modern SQLite driver, so extend
		 * the skip range up to (but not including) WP 5.1.
		 *
		 * parseFloat extracts the major version from strings like "6.8",
		 * "4.9.26", etc. Non-numeric values like "nightly" or "trunk"
		 * produce NaN, which Number.isFinite rejects — those fall
		 * through to enabling prefetch (correct for dev builds).
		 *
		 * @see https://github.com/WordPress/wordpress-playground/pull/2295
		 */
		const wpMajor = parseFloat(runtimeConfiguration.wpVersion);
		const isLegacyWpVersion = Number.isFinite(wpMajor) && wpMajor < 5.1;
		// Prefetch only makes sense when WordPress is actually installed.
		// In PHP-only mode (`preferredVersions.wp: false`), wp-load.php
		// doesn't exist and the prefetch crashes the runtime.
		if (
			runtimeConfiguration.networking &&
			!isLegacyWpVersion &&
			resolvedWordPressInstallMode === 'download-and-install'
		) {
			await playground.prefetchUpdateChecks();
		}

		return playground;
	}
}

type WordPressInstallMode = NonNullable<
	StartPlaygroundOptions['wordpressInstallMode']
>;
