import { useState, useEffect } from 'react';
import { Button, Spinner } from '@wordpress/components';
import { Modal } from '../modal';
import ModalButtons from '../modal/modal-buttons';
import { useAppDispatch } from '../../lib/state/redux/store';
import { setActiveModal } from '../../lib/state/redux/slice-ui';
import {
	opfsTempBackupStorage,
	type TempBackupInfo,
} from '../../lib/state/opfs/opfs-temp-backup-storage';
import { logger } from '@php-wasm/logger';
import css from './style.module.css';

type RestoreStatus = 'idle' | 'restoring' | 'success' | 'error';

export function RecoverBackupModal() {
	const dispatch = useAppDispatch();
	const [backups, setBackups] = useState<TempBackupInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedBackupId, setSelectedBackupId] = useState<string | null>(
		null
	);
	const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>('idle');
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		loadBackups();
	}, []);

	const loadBackups = async () => {
		try {
			setLoading(true);
			const available = await opfsTempBackupStorage.isAvailable();
			if (!available) {
				setBackups([]);
				return;
			}
			const list = await opfsTempBackupStorage.list();
			setBackups(list);
			// Auto-select the first backup if available
			if (list.length > 0 && !selectedBackupId) {
				setSelectedBackupId(list[0].id);
			}
		} catch (e) {
			logger.error('Failed to load backups:', e);
			setError('Failed to load backups');
		} finally {
			setLoading(false);
		}
	};

	const closeModal = () => {
		dispatch(setActiveModal(null));
	};

	const handleRestore = async () => {
		if (!selectedBackupId) return;

		const backup = backups.find((b) => b.id === selectedBackupId);
		if (!backup) return;

		try {
			setRestoreStatus('restoring');
			setError(null);

			// Build URL with the original parameters from the backup
			const url = new URL(window.location.origin);

			// Add original URL parameters if they exist
			if (backup.metadata.originalUrlParams?.searchParams) {
				for (const [key, value] of Object.entries(
					backup.metadata.originalUrlParams.searchParams
				)) {
					if (Array.isArray(value)) {
						for (const v of value) {
							url.searchParams.append(key, v);
						}
					} else {
						url.searchParams.set(key, value);
					}
				}
			}
			if (backup.metadata.originalUrlParams?.hash) {
				url.hash = backup.metadata.originalUrlParams.hash;
			}

			// Add a special parameter to indicate we should restore from backup
			url.searchParams.set('restore-backup', backup.id);

			setRestoreStatus('success');

			// Redirect to the URL which will restore the backup
			window.location.href = url.toString();
		} catch (e) {
			logger.error('Failed to restore backup:', e);
			setError('Failed to restore backup. Please try again.');
			setRestoreStatus('error');
		}
	};

	const handleDelete = async (backupId: string) => {
		try {
			await opfsTempBackupStorage.delete(backupId);
			await loadBackups();
			if (selectedBackupId === backupId) {
				setSelectedBackupId(backups.length > 1 ? backups[0].id : null);
			}
		} catch (e) {
			logger.error('Failed to delete backup:', e);
		}
	};

	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) {
			return 'Just now';
		} else if (diffMins < 60) {
			return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
		} else if (diffHours < 24) {
			return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
		} else if (diffDays < 7) {
			return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
		} else {
			return date.toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
				year:
					date.getFullYear() !== now.getFullYear()
						? 'numeric'
						: undefined,
				hour: 'numeric',
				minute: '2-digit',
			});
		}
	};

	const isRestoring = restoreStatus === 'restoring';

	return (
		<Modal
			title="Recover from Backup"
			contentLabel="Recover from Backup"
			onRequestClose={closeModal}
			isDismissible={!isRestoring}
			small
		>
			<div className={css.container}>
				{loading ? (
					<div className={css.loadingContainer}>
						<Spinner />
						<p>Loading backups...</p>
					</div>
				) : backups.length === 0 ? (
					<div className={css.emptyState}>
						<p>No backups available.</p>
						<p className={css.helpText}>
							Temporary playgrounds are automatically backed up
							while you work. Backups will appear here if you
							accidentally close or refresh the page.
						</p>
					</div>
				) : (
					<>
						<p className={css.description}>
							Select a backup to restore. This will create a new
							temporary playground with the saved content.
						</p>
						<div className={css.backupList}>
							{backups.map((backup) => (
								<div
									key={backup.id}
									className={`${css.backupItem} ${
										selectedBackupId === backup.id
											? css.backupItemSelected
											: ''
									}`}
									onClick={() =>
										setSelectedBackupId(backup.id)
									}
									role="button"
									tabIndex={0}
									onKeyDown={(e) => {
										if (
											e.key === 'Enter' ||
											e.key === ' '
										) {
											setSelectedBackupId(backup.id);
										}
									}}
								>
									<div className={css.backupInfo}>
										<span className={css.backupName}>
											{backup.metadata.name}
										</span>
										<span className={css.backupDate}>
											{formatDate(
												backup.metadata.whenCreated
											)}
										</span>
									</div>
									<Button
										variant="tertiary"
										isDestructive
										onClick={(e) => {
											e.stopPropagation();
											handleDelete(backup.id);
										}}
										disabled={isRestoring}
										className={css.deleteButton}
									>
										Delete
									</Button>
								</div>
							))}
						</div>
					</>
				)}

				{error && <p className={css.errorText}>{error}</p>}

				<ModalButtons
					submitText={isRestoring ? 'Restoring...' : 'Restore'}
					onCancel={closeModal}
					areDisabled={!selectedBackupId || isRestoring || loading}
					areBusy={isRestoring}
					onSubmit={handleRestore}
					style={{ marginTop: 16 }}
				/>
			</div>
		</Modal>
	);
}
