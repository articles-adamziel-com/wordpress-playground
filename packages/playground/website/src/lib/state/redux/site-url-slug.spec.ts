import {
	assertUrlSlugIsAvailable,
	deriveUrlSlugFromSiteName,
	siteMatchesUrlSlug,
} from './site-url-slug';

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

	it('derives a URL slug from a trimmed site name', () => {
		expect(deriveUrlSlugFromSiteName('  My Saved Playground  ')).toBe(
			'my-saved-playground'
		);
	});

	it('rejects an empty URL slug', () => {
		expect(() =>
			assertUrlSlugIsAvailable(
				[],
				'',
				'current-site',
				'Cannot rename site'
			)
		).toThrow('Site name must not be empty.');
	});

	it('rejects duplicate URL slugs while ignoring the current storage slug', () => {
		expect(() =>
			assertUrlSlugIsAvailable(
				[
					{ slug: 'current-site', urlSlug: 'current-url-slug' },
					{ slug: 'other-storage-slug', urlSlug: 'other-url-slug' },
				],
				'other-url-slug',
				'current-site',
				'Cannot rename site'
			)
		).toThrow(
			"Cannot rename site. URL slug 'other-url-slug' is already in use."
		);

		expect(() =>
			assertUrlSlugIsAvailable(
				[{ slug: 'current-site', urlSlug: 'current-url-slug' }],
				'current-url-slug',
				'current-site',
				'Cannot rename site'
			)
		).not.toThrow();
	});
});
