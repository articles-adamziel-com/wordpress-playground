export interface SiteUrlSlugInfo {
	slug: string;
	urlSlug?: string;
}

export function deriveUrlSlugFromSiteName(name: string) {
	return name.trim().toLowerCase().replaceAll(' ', '-');
}

export function siteMatchesUrlSlug(site: SiteUrlSlugInfo, urlSlug: string) {
	return site.urlSlug === urlSlug || site.slug === urlSlug;
}

export function assertUrlSlugIsAvailable(
	sites: SiteUrlSlugInfo[],
	urlSlug: string,
	currentStorageSlug: string,
	messagePrefix: string
) {
	if (!urlSlug) {
		throw new Error('Site name must not be empty.');
	}
	const duplicateSite = sites.find(
		(otherSite) =>
			otherSite.slug !== currentStorageSlug &&
			siteMatchesUrlSlug(otherSite, urlSlug)
	);
	if (duplicateSite) {
		throw new Error(
			`${messagePrefix}. URL slug '${urlSlug}' is already in use.`
		);
	}
}
