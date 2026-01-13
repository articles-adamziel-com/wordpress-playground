import type { TimelineEntry, TimelineEntryInput } from './timeline-entry';
import type { TimelineSession } from './timeline-session';
import { logger } from '../logger';
import { TimelineStorage } from './timeline-storage';

/**
 * Options for initializing the debug timeline.
 */
export interface DebugTimelineOptions {
	/** Enable verbose mode to capture additional events */
	verboseMode: boolean;
	/** Associated site slug */
	siteSlug?: string;
	/** PHP version for this session */
	phpVersion?: string;
	/** WordPress version for this session */
	wpVersion?: string;
}

/**
 * Export formats for timeline sessions.
 */
export type TimelineExportFormat = 'jsonl' | 'json' | 'csv';

/**
 * Debug timeline for tracking Playground events with OPFS persistence.
 *
 * Usage:
 * ```ts
 * const timeline = new DebugTimeline({ verboseMode: true });
 * await timeline.initialize();
 *
 * timeline.log({
 *   category: 'blueprint',
 *   type: 'blueprint.step.finish',
 *   message: 'Step completed: installPlugin',
 * });
 *
 * const sessions = await timeline.listSessions();
 * ```
 */
export class DebugTimeline {
	private storage: TimelineStorage | null = null;
	private currentSession: TimelineSession | null = null;
	private sessionStartTime = 0;
	private options: DebugTimelineOptions;
	private buffer: TimelineEntry[] = [];
	private flushScheduled = false;
	private flushPromise: Promise<void> | null = null;

	constructor(options: DebugTimelineOptions) {
		this.options = options;
	}

	/**
	 * Initialize the timeline storage and create a new session.
	 * Must be called before logging entries.
	 */
	async initialize(): Promise<void> {
		if (!TimelineStorage.isAvailable()) {
			logger.warn(
				'Debug Timeline: OPFS not available, timeline will be in-memory only'
			);
			return;
		}

		try {
			this.storage = await TimelineStorage.create();
		} catch (error) {
			logger.warn('Debug Timeline: Failed to initialize storage', error);
			return;
		}

		this.sessionStartTime = performance.now();

		this.currentSession = {
			id: this.generateUUID(),
			startTime: new Date().toISOString(),
			entryCount: 0,
			siteSlug: this.options.siteSlug,
			phpVersion: this.options.phpVersion,
			wpVersion: this.options.wpVersion,
			userAgent:
				typeof navigator !== 'undefined'
					? navigator.userAgent
					: 'unknown',
			verboseMode: this.options.verboseMode,
		};

		await this.storage.createSession(this.currentSession);
	}

	/**
	 * Log a timeline entry.
	 */
	log(entry: TimelineEntryInput): void {
		if (!this.currentSession) return;

		// Skip verbose entries if not in verbose mode
		if (entry.verbose && !this.options.verboseMode) return;

		const fullEntry: TimelineEntry = {
			...entry,
			timestamp: this.formatTimestamp(new Date()),
			relativeMs:
				Math.round((performance.now() - this.sessionStartTime) * 100) /
				100,
		};

		this.buffer.push(fullEntry);
		this.scheduleFlush();
	}

	/**
	 * End the current session.
	 */
	async endSession(): Promise<void> {
		if (!this.currentSession || !this.storage) return;

		// Wait for any pending flush
		if (this.flushPromise) {
			await this.flushPromise;
		}

		// Flush remaining entries
		await this.flushBuffer();

		await this.storage.updateSession(this.currentSession.id, {
			endTime: new Date().toISOString(),
			entryCount: this.currentSession.entryCount,
		});
	}

	/**
	 * Get all available sessions.
	 */
	async listSessions(): Promise<TimelineSession[]> {
		if (!this.storage) return [];
		return this.storage.listSessions();
	}

	/**
	 * Read all entries from a session.
	 */
	async readSession(id: string): Promise<TimelineEntry[]> {
		if (!this.storage) return [];
		return this.storage.readSession(id);
	}

	/**
	 * Read the latest n entries from the current session.
	 */
	async readLatest(n = 10): Promise<TimelineEntry[]> {
		if (!this.currentSession) return [];

		// Include buffered entries that haven't been flushed yet
		let entries: TimelineEntry[] = [];
		if (this.storage) {
			entries = await this.storage.readSession(this.currentSession.id);
		}

		// Add buffer entries
		entries = entries.concat(this.buffer);

		return entries.slice(-n);
	}

	/**
	 * Clear all sessions.
	 */
	async clearSessions(): Promise<void> {
		if (!this.storage) return;
		await this.storage.clearAllSessions();
	}

	/**
	 * Export a session in the specified format.
	 */
	async exportSession(
		id: string,
		format: TimelineExportFormat = 'jsonl'
	): Promise<string> {
		const entries = await this.readSession(id);

		switch (format) {
			case 'json':
				return JSON.stringify(entries, null, 2);
			case 'csv':
				return this.entriesToCsv(entries);
			case 'jsonl':
			default:
				return entries.map((e) => JSON.stringify(e)).join('\n');
		}
	}

	/**
	 * Get the current session info.
	 */
	getCurrentSession(): TimelineSession | null {
		return this.currentSession;
	}

	/**
	 * Check if the timeline is initialized and ready.
	 */
	isReady(): boolean {
		return this.currentSession !== null;
	}

	// --- Private methods ---

	private formatTimestamp(date: Date): string {
		// Format: "2026-01-14T14:58:12.324150Z"
		const iso = date.toISOString();
		// Add microseconds precision from performance.now()
		const microPart = String(
			Math.floor((performance.now() % 1) * 1000)
		).padStart(3, '0');
		return iso.replace(/\.\d{3}Z$/, `.${iso.slice(20, 23)}${microPart}Z`);
	}

	private scheduleFlush(): void {
		if (this.flushScheduled) return;
		this.flushScheduled = true;

		// Use requestIdleCallback for non-blocking writes
		const doFlush = () => {
			this.flushScheduled = false;
			this.flushPromise = this.flushBuffer().finally(() => {
				this.flushPromise = null;
			});
		};

		if (typeof requestIdleCallback !== 'undefined') {
			requestIdleCallback(doFlush, { timeout: 500 });
		} else {
			setTimeout(doFlush, 100);
		}
	}

	private async flushBuffer(): Promise<void> {
		if (this.buffer.length === 0 || !this.storage || !this.currentSession) {
			return;
		}

		const entries = this.buffer.splice(0);

		try {
			await this.storage.appendEntries(this.currentSession.id, entries);
			this.currentSession.entryCount += entries.length;

			// Update session metadata periodically (every 10 entries)
			if (this.currentSession.entryCount % 10 === 0) {
				await this.storage.updateSession(this.currentSession.id, {
					entryCount: this.currentSession.entryCount,
				});
			}
		} catch (error) {
			// Re-add entries to buffer on failure
			this.buffer.unshift(...entries);
			logger.warn('Debug Timeline: Failed to flush entries', error);
		}
	}

	private entriesToCsv(entries: TimelineEntry[]): string {
		const headers = [
			'timestamp',
			'relativeMs',
			'category',
			'type',
			'message',
			'data',
		];
		const escapeCell = (value: string) =>
			`"${value.replace(/"/g, '""').replace(/\n/g, '\\n')}"`;

		const rows = entries.map((e) => [
			e.timestamp,
			String(e.relativeMs),
			e.category,
			e.type,
			escapeCell(e.message),
			e.data ? escapeCell(JSON.stringify(e.data)) : '',
		]);

		return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
	}

	private generateUUID(): string {
		if (typeof crypto !== 'undefined' && crypto.randomUUID) {
			return crypto.randomUUID();
		}
		// Fallback for older browsers
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
			const r = (Math.random() * 16) | 0;
			const v = c === 'x' ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		});
	}
}
