import { Button } from '@wordpress/components';
import { Modal } from '../modal';
import ModalButtons from '../modal/modal-buttons';
import {
	useAppDispatch,
	useAppSelector,
	setActiveSite,
} from '../../lib/state/redux/store';
import { setActiveModal } from '../../lib/state/redux/slice-ui';
import {
	selectAutoSavedSites,
	removeSite,
	type SiteInfo,
} from '../../lib/state/redux/slice-sites';
import { opfsSiteStorage } from '../../lib/state/opfs/opfs-site-storage';
import { logger } from '@php-wasm/logger';
import { useState } from 'react';
import { PlaygroundRoute, redirectTo } from '../../lib/state/url/router';
import css from './style.module.css';

export function RecoverBackupModal() {
	const dispatch = useAppDispatch();
	const autoSavedSites = useAppSelector(selectAutoSavedSites);
	const [selectedSiteSlug, setSelectedSiteSlug] = useState<string | null>(
		autoSavedSites.length > 0 ? autoSavedSites[0].slug : null
	);

	const closeModal = () => {
		dispatch(setActiveModal(null));
	};

	const handleRestore = () => {
		if (!selectedSiteSlug) return;

		const site = autoSavedSites.find((s) => s.slug === selectedSiteSlug);
		if (!site) return;

		// Navigate to the auto-saved site
		dispatch(setActiveSite(site.slug));
		redirectTo(PlaygroundRoute.site(site));
		closeModal();
	};

	const handleDelete = async (site: SiteInfo) => {
		try {
			// Remove from Redux state
			dispatch(removeSite(site.slug));
			// Remove from OPFS
			await opfsSiteStorage?.delete(site.slug);

			// Update selection if needed
			if (selectedSiteSlug === site.slug) {
				const remaining = autoSavedSites.filter(
					(s) => s.slug !== site.slug
				);
				setSelectedSiteSlug(
					remaining.length > 0 ? remaining[0].slug : null
				);
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

	return (
		<Modal
			title="Recover from Backup"
			contentLabel="Recover from Backup"
			onRequestClose={closeModal}
			small
		>
			<div className={css.container}>
				{autoSavedSites.length === 0 ? (
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
							Select a backup to open. Auto-saved playgrounds are
							stored like regular playgrounds and can be accessed
							from the sidebar.
						</p>
						<div className={css.backupList}>
							{autoSavedSites.map((site) => (
								<div
									key={site.slug}
									className={`${css.backupItem} ${
										selectedSiteSlug === site.slug
											? css.backupItemSelected
											: ''
									}`}
									onClick={() =>
										setSelectedSiteSlug(site.slug)
									}
									role="button"
									tabIndex={0}
									onKeyDown={(e) => {
										if (
											e.key === 'Enter' ||
											e.key === ' '
										) {
											setSelectedSiteSlug(site.slug);
										}
									}}
								>
									<div className={css.backupInfo}>
										<span className={css.backupName}>
											{site.metadata.name}
										</span>
										<span className={css.backupDate}>
											{formatDate(
												site.metadata.whenCreated || 0
											)}
										</span>
									</div>
									<Button
										variant="tertiary"
										isDestructive
										onClick={(e) => {
											e.stopPropagation();
											handleDelete(site);
										}}
										className={css.deleteButton}
									>
										Delete
									</Button>
								</div>
							))}
						</div>
					</>
				)}

				<ModalButtons
					submitText="Open"
					onCancel={closeModal}
					areDisabled={!selectedSiteSlug}
					areBusy={false}
					onSubmit={handleRestore}
					style={{ marginTop: 16 }}
				/>
			</div>
		</Modal>
	);
}
