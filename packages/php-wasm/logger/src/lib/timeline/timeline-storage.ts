import type { TimelineEntry } from './timeline-entry';
import type { TimelineSession, SessionsIndex } from './timeline-session';

const TIMELINE_ROOT = 'debug-timeline';
const SESSIONS_INDEX = 'sessions.json';
const MAX_SESSIONS = 10;

/**
 * Storage backend for debug timeline sessions using OPFS.
 */
export class TimelineStorage {
	private opfsRoot: FileSystemDirectoryHandle;
	private initialized = false;

	private constructor(opfsRoot: FileSystemDirectoryHandle) {
		this.opfsRoot = opfsRoot;
	}

	/**
	 * Create a TimelineStorage instance.
	 * @returns A fully initialized TimelineStorage
	 * @throws Error if OPFS is not available
	 */
	static async create(): Promise<TimelineStorage> {
		if (typeof navigator === 'undefined') {
			throw new Error('OPFS not available: navigator is undefined');
		}
		if (!navigator.storage || !navigator.storage.getDirectory) {
			throw new Error('OPFS not available: storage API not supported');
		}

		const root = await navigator.storage.getDirectory();
		const timelineDir = await root.getDirectoryHandle(TIMELINE_ROOT, {
			create: true,
		});

		const storage = new TimelineStorage(timelineDir);
		await storage.initialize();
		return storage;
	}

	/**
	 * Check if OPFS is available in the current environment.
	 */
	static isAvailable(): boolean {
		return (
			typeof navigator !== 'undefined' &&
			navigator.storage !== undefined &&
			typeof navigator.storage.getDirectory === 'function'
		);
	}

	private async initialize(): Promise<void> {
		if (this.initialized) return;

		// Ensure sessions.json exists
		const exists = await this.fileExists(SESSIONS_INDEX);
		if (!exists) {
			const index: SessionsIndex = { version: 1, sessions: [] };
			await this.writeJson(SESSIONS_INDEX, index);
		}

		this.initialized = true;
	}

	/**
	 * Append a timeline entry to a session file.
	 */
	async appendEntry(sessionId: string, entry: TimelineEntry): Promise<void> {
		const fileName = this.getSessionFileName(sessionId);
		const line = JSON.stringify(entry) + '\n';

		// Read existing content and append
		let existing = '';
		try {
			existing = await this.readText(fileName);
		} catch {
			// File doesn't exist yet
		}

		await this.writeText(fileName, existing + line);
	}

	/**
	 * Append multiple timeline entries to a session file (batched write).
	 */
	async appendEntries(
		sessionId: string,
		entries: TimelineEntry[]
	): Promise<void> {
		if (entries.length === 0) return;

		const fileName = this.getSessionFileName(sessionId);
		const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';

		// Read existing content and append
		let existing = '';
		try {
			existing = await this.readText(fileName);
		} catch {
			// File doesn't exist yet
		}

		await this.writeText(fileName, existing + lines);
	}

	/**
	 * Read all entries from a session.
	 */
	async readSession(sessionId: string): Promise<TimelineEntry[]> {
		const fileName = this.getSessionFileName(sessionId);
		try {
			const content = await this.readText(fileName);
			return content
				.split('\n')
				.filter((line) => line.trim())
				.map((line) => JSON.parse(line) as TimelineEntry);
		} catch {
			return [];
		}
	}

	/**
	 * List all sessions.
	 */
	async listSessions(): Promise<TimelineSession[]> {
		const index = await this.readIndex();
		return index.sessions;
	}

	/**
	 * Create a new session and add it to the index.
	 * Automatically cleans up old sessions if over the limit.
	 */
	async createSession(session: TimelineSession): Promise<void> {
		const index = await this.readIndex();
		index.sessions.unshift(session);

		// Cleanup old sessions if over limit
		while (index.sessions.length > MAX_SESSIONS) {
			const removed = index.sessions.pop()!;
			await this.deleteSessionFile(removed.id);
		}

		await this.writeIndex(index);
	}

	/**
	 * Update an existing session's metadata.
	 */
	async updateSession(
		sessionId: string,
		updates: Partial<TimelineSession>
	): Promise<void> {
		const index = await this.readIndex();
		const session = index.sessions.find((s) => s.id === sessionId);
		if (session) {
			Object.assign(session, updates);
			await this.writeIndex(index);
		}
	}

	/**
	 * Delete a specific session.
	 */
	async deleteSession(sessionId: string): Promise<void> {
		const index = await this.readIndex();
		const sessionIndex = index.sessions.findIndex(
			(s) => s.id === sessionId
		);
		if (sessionIndex !== -1) {
			index.sessions.splice(sessionIndex, 1);
			await this.writeIndex(index);
		}
		await this.deleteSessionFile(sessionId);
	}

	/**
	 * Clear all sessions.
	 */
	async clearAllSessions(): Promise<void> {
		const index = await this.readIndex();
		for (const session of index.sessions) {
			await this.deleteSessionFile(session.id);
		}
		await this.writeIndex({ version: 1, sessions: [] });
	}

	// --- Private helpers ---

	private getSessionFileName(sessionId: string): string {
		return `session-${sessionId}.jsonl`;
	}

	private async readIndex(): Promise<SessionsIndex> {
		try {
			const content = await this.readText(SESSIONS_INDEX);
			return JSON.parse(content) as SessionsIndex;
		} catch {
			return { version: 1, sessions: [] };
		}
	}

	private async writeIndex(index: SessionsIndex): Promise<void> {
		await this.writeJson(SESSIONS_INDEX, index);
	}

	private async deleteSessionFile(sessionId: string): Promise<void> {
		const fileName = this.getSessionFileName(sessionId);
		try {
			await this.opfsRoot.removeEntry(fileName);
		} catch {
			// Ignore if file doesn't exist
		}
	}

	private async fileExists(fileName: string): Promise<boolean> {
		try {
			await this.opfsRoot.getFileHandle(fileName);
			return true;
		} catch {
			return false;
		}
	}

	private async readText(fileName: string): Promise<string> {
		const handle = await this.opfsRoot.getFileHandle(fileName);
		const file = await handle.getFile();
		return await file.text();
	}

	private async writeText(fileName: string, content: string): Promise<void> {
		const handle = await this.opfsRoot.getFileHandle(fileName, {
			create: true,
		});
		const writable = await handle.createWritable();
		await writable.write(content);
		await writable.close();
	}

	private async writeJson(fileName: string, data: unknown): Promise<void> {
		await this.writeText(fileName, JSON.stringify(data, null, 2));
	}
}
