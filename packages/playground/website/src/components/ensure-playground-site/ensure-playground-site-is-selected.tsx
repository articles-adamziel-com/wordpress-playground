import { useEffect, useState } from 'react';
import { useCurrentUrl } from '../../lib/state/url/router-hooks';
import { opfsSiteStorage } from '../../lib/state/opfs/opfs-site-storage';
import {
	OPFSSitesLoaded,
	selectSiteBySlug,
	setTemporarySiteSpec,
	setTemporarySiteSpecFromBackup,
	deriveSiteNameFromSlug,
} from '../../lib/state/redux/slice-sites';
import {
	selectActiveSite,
	setActiveSite,
	useAppDispatch,
	useAppSelector,
} from '../../lib/state/redux/store';
import { redirectTo } from '../../lib/state/url/router';
import { logger } from '@php-wasm/logger';
import { usePrevious } from '../../lib/hooks/use-previous';
import { modalSlugs } from '../layout';
import { setActiveModal } from '../../lib/state/redux/slice-ui';
import { selectClientBySiteSlug } from '../../lib/state/redux/slice-clients';
import { randomSiteName } from '../../lib/state/redux/random-site-name';
import { opfsTempBackupStorage } from '../../lib/state/opfs/opfs-temp-backup-storage';

/**
 * Ensures the redux store always has an activeSite value.
 *
 * It has two routing modes:
 * * When `site-slug` is provided, it load an existing site
 * * When `site-slug` is missing, it creates a new site using the Query API and Blueprint API
 *   data sourced from the current URL.
 */
export function EnsurePlaygroundSiteIsSelected({
	children,
}: {
	children: React.ReactNode;
}) {
	const siteListingStatus = useAppSelector(
		(state) => state.sites.opfsSitesLoadingState
	);
	const activeSite = useAppSelector((state) => selectActiveSite(state));
	const dispatch = useAppDispatch();
	const url = useCurrentUrl();
	const requestedSiteSlug = url.searchParams.get('site-slug');
	const requestedSiteObject = useAppSelector((state) =>
		selectSiteBySlug(state, requestedSiteSlug!)
	);
	const requestedClientInfo = useAppSelector(
		(state) =>
			requestedSiteSlug &&
			selectClientBySiteSlug(state, requestedSiteSlug)
	);
	const [needMissingSitePromptForSlug, setNeedMissingSitePromptForSlug] =
		useState<false | string>(false);

	const promptIfSiteMissing =
		url.searchParams.get('if-stored-site-missing') === 'prompt';
	const prevUrl = usePrevious(url);

	useEffect(() => {
		if (!opfsSiteStorage) {
			logger.error('Error loading sites: OPFS not available');
			dispatch(OPFSSitesLoaded([]));
			return;
		}
		opfsSiteStorage.list().then(
			(sites) => dispatch(OPFSSitesLoaded(sites)),
			(error) => {
				logger.error('Error loading sites:', error);
				dispatch(OPFSSitesLoaded([]));
			}
		);
	}, [dispatch]);

	useEffect(() => {
		async function ensureSiteIsSelected() {
			// Don't create a new temporary site until the site listing settles.
			// Otherwise, the status change from "loading" to "loaded" would
			// re-run this entire effect, potentially leading to multiple
			// sites being created since we couldn't look for duplicates yet.
			if (!['loaded', 'error'].includes(siteListingStatus)) {
				return;
			}

			// If the site slug is provided, try to load the site.
			if (requestedSiteSlug) {
				// If the site does not exist, redirect to a new temporary site.
				if (!requestedSiteObject) {
					if (promptIfSiteMissing) {
						logger.log(
							'The requested site was not found. Creating a new temporary site.'
						);

						await createNewTemporarySite(
							dispatch,
							requestedSiteSlug
						);
						setNeedMissingSitePromptForSlug(requestedSiteSlug);
						return;
					} else {
						// @TODO: Notification: 'The requested site was not found. Redirecting to a new temporary site.'
						logger.log(
							'The requested site was not found. Redirecting to a new temporary site.'
						);
						const currentUrl = new URL(window.location.href);
						currentUrl.searchParams.delete('site-slug');
						redirectTo(currentUrl.toString());
						return;
					}
				}

				dispatch(setActiveSite(requestedSiteSlug));
				return;
			}

			// If only the 'modal' parameter changes in searchParams, don't reload the page
			const notRefreshingParam = 'modal';
			const oldParams = new URLSearchParams(prevUrl?.search);
			const newParams = new URLSearchParams(url?.search);
			oldParams.delete(notRefreshingParam);
			newParams.delete(notRefreshingParam);
			const avoidUnnecessaryTempSiteReload =
				activeSite && oldParams.toString() === newParams.toString();
			if (avoidUnnecessaryTempSiteReload) {
				return;
			}

			await createNewTemporarySite(dispatch);
		}

		ensureSiteIsSelected();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [url.href, requestedSiteSlug, siteListingStatus]);

	useEffect(() => {
		if (
			needMissingSitePromptForSlug &&
			needMissingSitePromptForSlug === requestedSiteSlug &&
			requestedClientInfo
		) {
			dispatch(setActiveModal(modalSlugs.MISSING_SITE_PROMPT));
			setNeedMissingSitePromptForSlug(false);
		}
	}, [
		needMissingSitePromptForSlug,
		requestedSiteSlug,
		requestedClientInfo,
		dispatch,
	]);

	return children;
}

async function createNewTemporarySite(
	dispatch: ReturnType<typeof useAppDispatch>,
	requestedSiteSlug?: string
) {
	const url = new URL(window.location.href);
	const restoreBackupId = url.searchParams.get('restore-backup');

	// Check if we're restoring from a backup
	if (restoreBackupId) {
		try {
			const backup = await opfsTempBackupStorage.read(restoreBackupId);
			if (backup) {
				// Remove the restore-backup parameter to avoid infinite loop
				url.searchParams.delete('restore-backup');
				window.history.replaceState({}, '', url.toString());

				// Create a site from the backup
				const siteName = backup.metadata.name || randomSiteName();
				const newSiteInfo = await dispatch(
					setTemporarySiteSpecFromBackup(
						siteName,
						url,
						restoreBackupId,
						backup.metadata.siteMetadata
					)
				);
				await dispatch(setActiveSite(newSiteInfo.slug));
				return;
			}
		} catch (e) {
			logger.error('Failed to restore from backup:', e);
		}
		// If backup restoration fails, fall through to create a new temp site
		url.searchParams.delete('restore-backup');
		window.history.replaceState({}, '', url.toString());
	}

	// If the site slug is missing, create a new temporary site.
	const siteName = requestedSiteSlug
		? deriveSiteNameFromSlug(requestedSiteSlug)
		: randomSiteName();
	const newSiteInfo = await dispatch(
		setTemporarySiteSpec(siteName, new URL(window.location.href))
	);
	await dispatch(setActiveSite(newSiteInfo.slug));
}
