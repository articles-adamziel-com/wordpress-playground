/**
 * Auto-backup hook for temporary playgrounds.
 *
 * This hook automatically backs up temporary playgrounds to OPFS to help
 * prevent data loss. Backups are stored as regular OPFS sites with the
 * isAutoSave flag set to true.
 *
 * Backups are triggered periodically while the playground is active and
 * are limited to the most recent 5 backups.
 *
 * Important: These backups are never auto-restored. They are only used
 * for manual recovery if the user loses their work.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../state/redux/store';
import { selectClientInfoBySiteSlug } from '../state/redux/slice-clients';
import {
	selectSiteBySlug,
	selectAutoSavedSites,
	removeSite,
} from '../state/redux/slice-sites';
import {
	opfsSiteStorage,
	getDirectoryPathForSlug,
} from '../state/opfs/opfs-site-storage';
import { logger } from '@php-wasm/logger';

// Minimum interval between backups (5 minutes)
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;

// Maximum number of auto-saved backups to keep
const MAX_AUTO_SAVES = 5;

interface BackupState {
	lastBackupTime: number;
	isBackingUp: boolean;
}

/**
 * Hook that automatically backs up a temporary site to OPFS.
 *
 * @param siteSlug - The slug of the temporary site to back up
 */
export function useAutoBackupTemporarySite(siteSlug: string | undefined) {
	const dispatch = useAppDispatch();
	const clientInfo = useAppSelector((state) =>
		siteSlug ? selectClientInfoBySiteSlug(state, siteSlug) : undefined
	);
	const site = useAppSelector((state) =>
		siteSlug ? selectSiteBySlug(state, siteSlug) : undefined
	);
	const autoSavedSites = useAppSelector(selectAutoSavedSites);

	const backupStateRef = useRef<BackupState>({
		lastBackupTime: 0,
		isBackingUp: false,
	});

	const cleanupOldBackups = useCallback(async () => {
		// Get the current auto-saved sites (already sorted by newest first)
		const sitesToDelete = autoSavedSites.slice(MAX_AUTO_SAVES);

		for (const siteToDelete of sitesToDelete) {
			try {
				// Remove from Redux state
				dispatch(removeSite(siteToDelete.slug));
				// Remove from OPFS
				await opfsSiteStorage?.delete(siteToDelete.slug);
				logger.info(`Deleted old auto-save: ${siteToDelete.slug}`);
			} catch (e) {
				logger.error(
					`Failed to delete old auto-save ${siteToDelete.slug}:`,
					e
				);
			}
		}
	}, [autoSavedSites, dispatch]);

	const performBackup = useCallback(async () => {
		if (!site || site.metadata.storage !== 'none' || !clientInfo?.client) {
			return;
		}

		const state = backupStateRef.current;

		// Don't backup if already backing up
		if (state.isBackingUp) {
			return;
		}

		// Don't backup too frequently
		const timeSinceLastBackup = Date.now() - state.lastBackupTime;
		if (timeSinceLastBackup < BACKUP_INTERVAL_MS && state.lastBackupTime > 0) {
			return;
		}

		state.isBackingUp = true;

		try {
			// Create a unique slug for the auto-save
			const backupSlug = `auto-save-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
			const backupName = `Auto-save: ${site.metadata.name}`;

			// Create the site entry in OPFS with auto-save flag
			await opfsSiteStorage?.create(backupSlug, {
				...site.metadata,
				id: crypto.randomUUID(),
				name: backupName,
				storage: 'opfs',
				whenCreated: Date.now(),
				isAutoSave: true,
			});

			// Sync the filesystem to the new backup location
			const playground = clientInfo.client;
			await playground.mountOpfs({
				device: {
					type: 'opfs',
					path: getDirectoryPathForSlug(backupSlug),
				},
				mountpoint: '/wordpress',
				initialSyncDirection: 'memfs-to-opfs',
			});

			state.lastBackupTime = Date.now();
			logger.info(`Auto-saved temporary playground: ${backupSlug}`);

			// Cleanup old backups
			await cleanupOldBackups();
		} catch (e) {
			logger.error('Failed to auto-save temporary playground:', e);
		} finally {
			state.isBackingUp = false;
		}
	}, [site, clientInfo?.client, cleanupOldBackups]);

	useEffect(() => {
		// Only backup temporary sites
		if (!site || site.metadata.storage !== 'none' || !clientInfo?.client) {
			return;
		}

		// Perform initial backup after a short delay to let the site settle
		const initialBackupTimer = setTimeout(() => {
			performBackup();
		}, 10000); // Wait 10 seconds after site loads

		// Set up periodic backup interval
		const intervalId = setInterval(() => {
			performBackup();
		}, BACKUP_INTERVAL_MS);

		return () => {
			clearTimeout(initialBackupTimer);
			clearInterval(intervalId);
		};
	}, [site, clientInfo?.client, performBackup]);

	// Reset backup state when site changes
	useEffect(() => {
		backupStateRef.current = {
			lastBackupTime: 0,
			isBackingUp: false,
		};
	}, [siteSlug]);
}
