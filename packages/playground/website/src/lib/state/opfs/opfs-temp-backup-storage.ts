/**
 * OPFS storage for temporary playground backups.
 *
 * This module provides automatic backup functionality for temporary playgrounds
 * to help users avoid data loss. Backups are stored in OPFS and limited to the
 * last 5 most recent backups.
 *
 * Important: These backups are never auto-restored. Users must manually choose
 * to restore from a backup.
 */

import type { SiteMetadata, SiteInfo } from '../redux/slice-sites';
import { logger } from '@php-wasm/logger';
import metadataWorkerUrl from './opfs-site-storage-worker-for-safari?worker&url';
import { joinPaths } from '@php-wasm/util';

const TEMP_BACKUPS_ROOT = '/temp-backups';
const BACKUP_METADATA_FILENAME = 'backup-info.json';
const MAX_BACKUPS = 5;

/**
 * Stored backup metadata.
 */
export interface TempBackupMetadata {
	/**
	 * Unique identifier for the backup.
	 */
	id: string;

	/**
	 * Name to display for the backup.
	 */
	name: string;

	/**
	 * Timestamp when the backup was created.
	 */
	whenCreated: number;

	/**
	 * Original URL parameters used to create the playground.
	 */
	originalUrlParams?: {
		searchParams?: Record<string, string>;
		hash?: string;
	};

	/**
	 * Site metadata from the temporary playground.
	 */
	siteMetadata: SiteMetadata;
}

/**
 * Information about a stored backup.
 */
export interface TempBackupInfo {
	/**
	 * The backup ID (directory name).
	 */
	id: string;

	/**
	 * Backup metadata.
	 */
	metadata: TempBackupMetadata;
}

let opfsTempBackupsRoot: FileSystemDirectoryHandle | undefined = undefined;

async function initOpfsTempBackupsRoot(): Promise<FileSystemDirectoryHandle | undefined> {
	if (opfsTempBackupsRoot) {
		return opfsTempBackupsRoot;
	}
	try {
		let root = await navigator.storage.getDirectory();
		for (const path of TEMP_BACKUPS_ROOT.replace(/^\//, '').split('/')) {
			root = await root.getDirectoryHandle(path, { create: true });
		}
		opfsTempBackupsRoot = root;
		return root;
	} catch {
		// OPFS is not supported in this environment.
		return undefined;
	}
}

class OpfsTempBackupStorage {
	/**
	 * Create a new backup from a temporary site.
	 * Returns the backup ID.
	 */
	async create(siteInfo: SiteInfo): Promise<string> {
		const root = await initOpfsTempBackupsRoot();
		if (!root) {
			throw new Error('OPFS is not available for temp backups');
		}

		const backupId = `backup-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
		const backupDir = await root.getDirectoryHandle(backupId, {
			create: true,
		});

		const metadata: TempBackupMetadata = {
			id: backupId,
			name: siteInfo.metadata.name,
			whenCreated: Date.now(),
			originalUrlParams: siteInfo.originalUrlParams,
			siteMetadata: siteInfo.metadata,
		};

		await opfsWriteFile(
			joinPaths(TEMP_BACKUPS_ROOT, backupId, BACKUP_METADATA_FILENAME),
			JSON.stringify(metadata, null, 2)
		);

		return backupId;
	}

	/**
	 * Update an existing backup's metadata.
	 */
	async updateMetadata(
		backupId: string,
		metadata: TempBackupMetadata
	): Promise<void> {
		const root = await initOpfsTempBackupsRoot();
		if (!root) {
			throw new Error('OPFS is not available for temp backups');
		}

		await opfsWriteFile(
			joinPaths(TEMP_BACKUPS_ROOT, backupId, BACKUP_METADATA_FILENAME),
			JSON.stringify(metadata, null, 2)
		);
	}

	/**
	 * List all available backups, sorted by creation time (newest first).
	 */
	async list(): Promise<TempBackupInfo[]> {
		const root = await initOpfsTempBackupsRoot();
		if (!root) {
			return [];
		}

		const backups: TempBackupInfo[] = [];
		for await (const entry of root.values()) {
			if (entry.kind === 'directory') {
				try {
					const backup = await this.read(entry.name);
					if (backup) {
						backups.push(backup);
					}
				} catch (e) {
					logger.error(`Error reading backup ${entry.name}:`, e);
				}
			}
		}

		// Sort by creation time, newest first
		return backups.sort(
			(a, b) => b.metadata.whenCreated - a.metadata.whenCreated
		);
	}

	/**
	 * Read a specific backup.
	 */
	async read(backupId: string): Promise<TempBackupInfo | undefined> {
		const root = await initOpfsTempBackupsRoot();
		if (!root) {
			return undefined;
		}

		try {
			const backupDir = await root.getDirectoryHandle(backupId);
			const metadataFileHandle = await backupDir.getFileHandle(
				BACKUP_METADATA_FILENAME
			);
			const file = await metadataFileHandle.getFile();
			const metadata = JSON.parse(await file.text()) as TempBackupMetadata;
			return {
				id: backupId,
				metadata,
			};
		} catch {
			return undefined;
		}
	}

	/**
	 * Delete a backup.
	 */
	async delete(backupId: string): Promise<void> {
		const root = await initOpfsTempBackupsRoot();
		if (!root) {
			return;
		}

		try {
			await root.removeEntry(backupId, { recursive: true });
		} catch (e) {
			logger.error(`Error deleting backup ${backupId}:`, e);
		}
	}

	/**
	 * Cleanup old backups, keeping only the most recent MAX_BACKUPS.
	 */
	async cleanup(): Promise<void> {
		const backups = await this.list();
		if (backups.length <= MAX_BACKUPS) {
			return;
		}

		// Delete oldest backups beyond the limit
		const toDelete = backups.slice(MAX_BACKUPS);
		for (const backup of toDelete) {
			await this.delete(backup.id);
		}
	}

	/**
	 * Get the OPFS directory path for a backup's WordPress files.
	 */
	getBackupDirectoryPath(backupId: string): string {
		return joinPaths(TEMP_BACKUPS_ROOT, backupId);
	}

	/**
	 * Check if OPFS temp backups are available.
	 */
	async isAvailable(): Promise<boolean> {
		const root = await initOpfsTempBackupsRoot();
		return root !== undefined;
	}
}

export const opfsTempBackupStorage = new OpfsTempBackupStorage();

async function opfsWriteFile(path: string, content: string) {
	// Note: Safari appears to require a worker to write OPFS file content.
	const worker = new Worker(metadataWorkerUrl, { type: 'module' });

	const channel = new MessageChannel();
	const promiseToWrite = new Promise<void>((resolve, reject) => {
		worker.postMessage({ path, content }, { transfer: [channel.port2] });
		channel.port1.onmessage = function (event: MessageEvent) {
			if (event.data === 'done') {
				resolve();
			} else {
				reject(
					new Error(
						`Unexpected message from OPFS write worker: ${event.data}`
					)
				);
			}
		};
		worker.onerror = reject;
	});
	const promiseToTimeout = new Promise<void>((_, reject) => {
		setTimeout(() => reject(new Error('timeout')), 5000);
	});

	return Promise.race<void>([promiseToWrite, promiseToTimeout]).finally(() =>
		worker.terminate()
	);
}
