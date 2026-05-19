export interface SiteUrlSlugInfo {
	slug: string;
	urlSlug?: string;
}

export function siteMatchesUrlSlug(site: SiteUrlSlugInfo, urlSlug: string) {
	return site.urlSlug === urlSlug || site.slug === urlSlug;
}
