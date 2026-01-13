import type { DebugTimeline } from '../timeline/debug-timeline';

/**
 * Interface for PHP event sources (UniversalPHP or PlaygroundClient).
 */
interface PHPEventSource {
	addEventListener(event: string, listener: (event: unknown) => void): void;
}

/**
 * Interface for request error events.
 */
interface RequestErrorEvent {
	error?: Error;
	source?: 'request' | 'php-wasm';
}

/**
 * Collect PHP runtime events and log them to the timeline.
 */
export function collectPhpRuntimeEvents(
	timeline: DebugTimeline,
	php: PHPEventSource
): void {
	php.addEventListener('runtime.initialized', () => {
		timeline.log({
			category: 'runtime',
			type: 'runtime.initialized',
			message: 'PHP runtime initialized',
		});
	});

	php.addEventListener('runtime.beforeExit', () => {
		timeline.log({
			category: 'runtime',
			type: 'runtime.beforeExit',
			message: 'PHP runtime exiting',
		});
	});

	php.addEventListener('request.end', () => {
		timeline.log({
			category: 'php',
			type: 'php.request.end',
			message: 'PHP request completed',
		});
	});

	php.addEventListener('request.error', (event: unknown) => {
		const errorEvent = event as RequestErrorEvent;
		timeline.log({
			category: 'php',
			type: 'php.request.error',
			message: `PHP request error: ${errorEvent.error?.message || 'Unknown error'}`,
			data: {
				source: errorEvent.source,
				errorMessage: errorEvent.error?.message,
				errorStack: errorEvent.error?.stack,
			},
		});
	});

	// Filesystem events are verbose-only
	php.addEventListener('filesystem.write', () => {
		timeline.log({
			category: 'filesystem',
			type: 'filesystem.write',
			message: 'Filesystem write operation',
			verbose: true,
		});
	});
}

/**
 * Options for blueprint step callbacks.
 */
export interface BlueprintStepCallbacks {
	/** Original callback to call after logging */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	onStepCompleted?: (output: any, step: any) => any;
}

/**
 * Create blueprint V1 step callbacks that log to the timeline.
 * The callback signature matches `OnStepCompleted = (output: any, step: StepDefinition) => any`
 */
export function createBlueprintV1Callbacks(
	timeline: DebugTimeline,
	options: BlueprintStepCallbacks = {}
): {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	onStepCompleted: (output: any, step: any) => any;
} {
	let stepIndex = 0;
	return {
		onStepCompleted: (output: unknown, step: unknown) => {
			const stepObj = step as {
				step?: string;
				progress?: { caption?: string };
			};
			const stepName = stepObj.step || 'unknown';
			const caption = stepObj.progress?.caption;

			timeline.log({
				category: 'blueprint',
				type: 'blueprint.step.finish',
				message: caption
					? `Blueprint step ${stepIndex + 1} completed: ${stepName} - ${caption}`
					: `Blueprint step ${stepIndex + 1} completed: ${stepName}`,
				data: { stepIndex, stepName },
			});

			stepIndex++;

			// Call original handler if provided
			return options.onStepCompleted?.(output, step);
		},
	};
}

/**
 * Blueprint V2 message types.
 */
interface BlueprintMessage {
	type: string;
	progress?: number;
	caption?: string;
	message?: string;
	details?: unknown;
}

/**
 * Interface for Playground client with blueprint message events.
 */
interface PlaygroundWithEvents {
	addEventListener(
		event: 'blueprint.message',
		listener: (event: { message: BlueprintMessage }) => void
	): void;
	onNavigation?(callback: (path: string) => void): void;
}

/**
 * Collect Blueprint V2 message events and log them to the timeline.
 */
export function collectBlueprintV2Events(
	timeline: DebugTimeline,
	playground: PlaygroundWithEvents
): void {
	playground.addEventListener('blueprint.message', ({ message }) => {
		switch (message.type) {
			case 'blueprint.progress':
				timeline.log({
					category: 'blueprint',
					type: 'blueprint.progress',
					message: message.caption || 'Blueprint progress',
					data: { progress: message.progress },
				});
				break;

			case 'blueprint.error':
				timeline.log({
					category: 'blueprint',
					type: 'blueprint.step.error',
					message: `Blueprint error: ${message.message || 'Unknown error'}`,
					data: { details: message.details },
				});
				break;

			case 'blueprint.completion':
				timeline.log({
					category: 'blueprint',
					type: 'blueprint.step.finish',
					message: message.message || 'Blueprint completed',
				});
				break;
		}
	});
}

/**
 * Collect navigation events and log them to the timeline.
 */
export function collectNavigationEvents(
	timeline: DebugTimeline,
	playground: PlaygroundWithEvents
): void {
	if (!playground.onNavigation) {
		return;
	}

	playground.onNavigation((path: string) => {
		timeline.log({
			category: 'navigation',
			type: 'navigation.request',
			message: `Navigation to: ${path}`,
			data: { path },
		});
	});
}

/**
 * Log a query parameter change event.
 */
export function logQueryParamsChange(
	timeline: DebugTimeline,
	oldParams: string,
	newParams: string
): void {
	timeline.log({
		category: 'navigation',
		type: 'query.params.change',
		message: `Query params changed: ${oldParams} -> ${newParams}`,
		data: { oldParams, newParams },
	});
}

/**
 * Log an external API call (for tracking calls from integrators).
 */
export function logExternalCall(
	timeline: DebugTimeline,
	method: string,
	args?: unknown
): void {
	timeline.log({
		category: 'external',
		type: 'external.request',
		message: `External API call: ${method}`,
		data: { method, args },
		caller: { type: 'external' },
	});
}
