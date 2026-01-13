/**
 * Metadata for a debug timeline session.
 */
export interface TimelineSession {
	/** Unique session identifier (UUID) */
	id: string;
	/** ISO 8601 timestamp when session started */
	startTime: string;
	/** ISO 8601 timestamp when session ended (set when session closes) */
	endTime?: string;
	/** Number of entries in this session */
	entryCount: number;
	/** Associated site slug if known */
	siteSlug?: string;
	/** PHP version used in this session */
	phpVersion?: string;
	/** WordPress version used in this session */
	wpVersion?: string;
	/** User agent string */
	userAgent: string;
	/** Whether verbose mode was enabled */
	verboseMode: boolean;
}

/**
 * Index file structure for tracking all sessions.
 */
export interface SessionsIndex {
	/** Schema version for future compatibility */
	version: 1;
	/** List of sessions, ordered by most recent first */
	sessions: TimelineSession[];
}
