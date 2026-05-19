import { siteMatchesUrlSlug } from './site-url-slug';

describe('siteMatchesUrlSlug', () => {
	it('matches a site by its URL slug', () => {
		expect(
			siteMatchesUrlSlug(
				{ slug: 'storage-slug', urlSlug: 'renamed-site' },
				'renamed-site'
			)
		).toBe(true);
	});

	it('keeps the storage slug as a fallback URL', () => {
		expect(
			siteMatchesUrlSlug(
				{ slug: 'storage-slug', urlSlug: 'renamed-site' },
				'storage-slug'
			)
		).toBe(true);
	});
});
