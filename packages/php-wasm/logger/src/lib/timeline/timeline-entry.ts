/**
 * Categories of timeline events for filtering and display.
 */
export type TimelineEventCategory =
	| 'blueprint'
	| 'php'
	| 'navigation'
	| 'runtime'
	| 'filesystem'
	| 'external';

/**
 * Specific types of timeline events.
 */
export type TimelineEventType =
	// Blueprint events
	| 'blueprint.step.start'
	| 'blueprint.step.finish'
	| 'blueprint.step.error'
	| 'blueprint.progress'
	| 'blueprint.validation'
	// PHP events
	| 'php.request.start'
	| 'php.request.end'
	| 'php.request.error'
	| 'php.run.exit'
	// Runtime events
	| 'runtime.initialized'
	| 'runtime.beforeExit'
	| 'php.instance.spawn'
	// Navigation events
	| 'navigation.request'
	| 'query.params.change'
	// Filesystem events
	| 'filesystem.write'
	// External caller events
	| 'external.writeFile'
	| 'external.run'
	| 'external.request';

/**
 * Information about what triggered the event.
 */
export interface TimelineEntryCaller {
	/** Whether this was triggered internally or by an external API caller */
	type: 'internal' | 'external';
	/** Source description, e.g., "blueprint step 3", "user script" */
	source?: string;
}

/**
 * A single entry in the debug timeline.
 */
export interface TimelineEntry {
	/** ISO 8601 timestamp with microseconds: "2026-01-14T14:58:12.324150Z" */
	timestamp: string;
	/** High-precision relative time in milliseconds from session start */
	relativeMs: number;
	/** Event category for filtering */
	category: TimelineEventCategory;
	/** Specific event type */
	type: TimelineEventType;
	/** Human-readable message */
	message: string;
	/** Optional structured data */
	data?: Record<string, unknown>;
	/** Optional caller information */
	caller?: TimelineEntryCaller;
	/** Verbose-only flag (only captured when verbose mode enabled) */
	verbose?: boolean;
}

/**
 * Input for creating a timeline entry (without auto-generated fields).
 */
export type TimelineEntryInput = Omit<
	TimelineEntry,
	'timestamp' | 'relativeMs'
>;
