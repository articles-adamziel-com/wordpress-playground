/**
 * Auto-backup hook for temporary playgrounds.
 *
 * This hook automatically backs up temporary playgrounds to OPFS to help
 * prevent data loss. Backups are triggered:
 * - When the temporary playground is first booted
 * - Periodically while the playground is active (debounced)
 * - Before the page unloads (best effort)
 *
 * Important: These backups are never auto-restored. They are only used
 * for manual recovery if the user loses their work.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppSelector } from '../state/redux/store';
import { selectClientInfoBySiteSlug } from '../state/redux/slice-clients';
import { selectSiteBySlug } from '../state/redux/slice-sites';
import {
	opfsTempBackupStorage,
	type TempBackupMetadata,
} from '../state/opfs/opfs-temp-backup-storage';
import { logger } from '@php-wasm/logger';
import type { PlaygroundClient } from '@wp-playground/remote';

// Minimum interval between backups (5 minutes)
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;

// Debounce time for filesystem writes before triggering backup
const DEBOUNCE_MS = 30 * 1000;

interface BackupState {
	backupId: string | null;
	lastBackupTime: number;
	pendingBackup: ReturnType<typeof setTimeout> | null;
	isBackingUp: boolean;
}

/**
 * Hook that automatically backs up a temporary site to OPFS.
 *
 * @param siteSlug - The slug of the temporary site to back up
 */
export function useAutoBackupTemporarySite(siteSlug: string | undefined) {
	const clientInfo = useAppSelector((state) =>
		siteSlug ? selectClientInfoBySiteSlug(state, siteSlug) : undefined
	);
	const site = useAppSelector((state) =>
		siteSlug ? selectSiteBySlug(state, siteSlug) : undefined
	);

	const backupStateRef = useRef<BackupState>({
		backupId: null,
		lastBackupTime: 0,
		pendingBackup: null,
		isBackingUp: false,
	});

	const performBackup = useCallback(
		async (playground: PlaygroundClient, force = false) => {
			if (!site || site.metadata.storage !== 'none') {
				return;
			}

			const state = backupStateRef.current;

			// Don't backup if already backing up
			if (state.isBackingUp) {
				return;
			}

			// Don't backup too frequently unless forced
			const timeSinceLastBackup = Date.now() - state.lastBackupTime;
			if (!force && timeSinceLastBackup < BACKUP_INTERVAL_MS) {
				return;
			}

			state.isBackingUp = true;

			try {
				// Create or get backup entry
				if (!state.backupId) {
					state.backupId =
						await opfsTempBackupStorage.create(site);
					logger.info(
						`Created temp backup entry: ${state.backupId}`
					);
				}

				// Sync filesystem to OPFS backup
				const backupPath =
					opfsTempBackupStorage.getBackupDirectoryPath(
						state.backupId
					);

				await playground.mountOpfs({
					device: {
						type: 'opfs',
						path: backupPath,
					},
					mountpoint: '/wordpress',
					initialSyncDirection: 'memfs-to-opfs',
				});

				// Update backup metadata with current timestamp
				const metadata: TempBackupMetadata = {
					id: state.backupId,
					name: site.metadata.name,
					whenCreated: Date.now(),
					originalUrlParams: site.originalUrlParams,
					siteMetadata: site.metadata,
				};
				await opfsTempBackupStorage.updateMetadata(
					state.backupId,
					metadata
				);

				state.lastBackupTime = Date.now();
				logger.info(`Temp playground backed up: ${state.backupId}`);

				// Cleanup old backups
				await opfsTempBackupStorage.cleanup();
			} catch (e) {
				logger.error('Failed to backup temporary playground:', e);
			} finally {
				state.isBackingUp = false;
			}
		},
		[site]
	);

	const scheduleBackup = useCallback(
		(playground: PlaygroundClient) => {
			const state = backupStateRef.current;

			// Clear any pending backup
			if (state.pendingBackup) {
				clearTimeout(state.pendingBackup);
			}

			// Schedule a new backup after debounce period
			state.pendingBackup = setTimeout(() => {
				state.pendingBackup = null;
				performBackup(playground, false);
			}, DEBOUNCE_MS);
		},
		[performBackup]
	);

	useEffect(() => {
		// Only backup temporary sites
		if (!site || site.metadata.storage !== 'none' || !clientInfo?.client) {
			return;
		}

		const playground = clientInfo.client;

		// Perform initial backup
		performBackup(playground, true);

		// Listen for filesystem writes
		const handleFilesystemWrite = () => {
			scheduleBackup(playground);
		};

		playground.addEventListener('filesystem.write', handleFilesystemWrite);

		// Backup before unload (best effort)
		const handleBeforeUnload = () => {
			// We can't do async operations reliably here, but we try
			// The backup might not complete, but it's better than nothing
			performBackup(playground, true);
		};
		window.addEventListener('beforeunload', handleBeforeUnload);

		// Set up periodic backup interval as a fallback
		const intervalId = setInterval(() => {
			performBackup(playground, false);
		}, BACKUP_INTERVAL_MS);

		return () => {
			playground.removeEventListener(
				'filesystem.write',
				handleFilesystemWrite
			);
			window.removeEventListener('beforeunload', handleBeforeUnload);
			clearInterval(intervalId);

			const state = backupStateRef.current;
			if (state.pendingBackup) {
				clearTimeout(state.pendingBackup);
				state.pendingBackup = null;
			}
		};
	}, [site, clientInfo?.client, performBackup, scheduleBackup]);

	// Reset backup state when site changes
	useEffect(() => {
		backupStateRef.current = {
			backupId: null,
			lastBackupTime: 0,
			pendingBackup: null,
			isBackingUp: false,
		};
	}, [siteSlug]);
}
