import type { SiteInfo } from './slice-sites';

function installBrowserGlobals() {
	const pushState = vitest.fn();
	const replaceState = vitest.fn();
	const location = {
		href: 'https://playground.example/',
		origin: 'https://playground.example',
	};
	const windowMock: any = {
		location,
		history: {
			pushState,
			replaceState,
		},
		innerWidth: 1280,
		addEventListener: vitest.fn(),
		removeEventListener: vitest.fn(),
		dispatchEvent: vitest.fn(),
	};
	windowMock.self = windowMock;
	windowMock.top = windowMock;

	vitest.stubGlobal('window', windowMock);
	vitest.stubGlobal('document', { location });
	vitest.stubGlobal('location', location);
	vitest.stubGlobal('navigator', { onLine: true });
	vitest.stubGlobal(
		'Event',
		class Event {
			type: string;
			constructor(type: string) {
				this.type = type;
			}
		}
	);

	return { pushState, replaceState };
}

function makeSite(
	slug: string,
	{
		name,
		storage,
		urlSlug = slug,
	}: {
		name: string;
		storage: 'none' | 'opfs';
		urlSlug?: string;
	}
): SiteInfo {
	return {
		slug,
		urlSlug,
		originalUrlParams: {
			searchParams: {},
			hash: '',
		},
		metadata: {
			id: `${slug}-id`,
			name,
			storage,
			whenCreated: Date.now(),
			originalBlueprint: {},
			originalBlueprintSource: {
				type: 'none',
			},
			runtimeConfiguration: {
				phpVersion: '8.4' as any,
				wpVersion: 'latest',
				intl: false,
				networking: true,
				extraLibraries: [],
				constants: {},
			},
		},
	};
}

async function createHarness(sites: SiteInfo[], activeSiteSlug: string) {
	vitest.resetModules();
	const browser = installBrowserGlobals();
	vitest.doMock('./store', () => ({
		selectActiveSite: (state: any) =>
			state.ui.activeSite?.slug
				? state.sites.entities[state.ui.activeSite.slug]
				: undefined,
		setActiveSite: (slug: string | undefined) => (dispatch: any) => {
			dispatch({ type: 'ui/setActiveSite', payload: slug });
		},
		useAppDispatch: () => {
			throw new Error('useAppDispatch is not available in this test.');
		},
		useAppSelector: () => {
			throw new Error('useAppSelector is not available in this test.');
		},
	}));
	const [
		{ configureStore },
		{ default: sitesReducer, sitesSlice },
		{ default: uiReducer, __internal_uiSlice },
		{ default: clientsReducer, addClientInfo },
		{ createSitesAPI },
	] = await Promise.all([
		import('@reduxjs/toolkit'),
		import('./slice-sites'),
		import('./slice-ui'),
		import('./slice-clients'),
		import('./site-management-api-middleware'),
	]);

	const store = configureStore({
		reducer: {
			ui: uiReducer,
			sites: sitesReducer,
			clients: clientsReducer,
		},
		middleware: (getDefaultMiddleware) =>
			getDefaultMiddleware({ serializableCheck: false }),
	});
	store.dispatch(sitesSlice.actions.addSites(sites));
	store.dispatch(__internal_uiSlice.actions.setActiveSite(activeSiteSlug));

	const api = createSitesAPI(store.getState as any, store.dispatch as any);
	return { ...browser, store, api, addClientInfo };
}

describe('createSitesAPI', () => {
	afterEach(() => {
		vitest.doUnmock('./store');
		vitest.restoreAllMocks();
		vitest.unstubAllGlobals();
	});

	it('rejects empty names in the public rename API', async () => {
		const { api, store, pushState } = await createHarness(
			[
				makeSite('storage-slug', {
					name: 'Original Site',
					storage: 'opfs',
				}),
			],
			'storage-slug'
		);

		await expect(api.rename('   ')).rejects.toThrow(
			'Site name must not be empty.'
		);

		const site = store.getState().sites.entities['storage-slug'];
		expect(site?.metadata.name).toBe('Original Site');
		expect(site?.urlSlug).toBe('storage-slug');
		expect(pushState).not.toHaveBeenCalled();
	});

	it('trims public API renames before persisting the name and URL slug', async () => {
		const { api, store, pushState } = await createHarness(
			[
				makeSite('storage-slug', {
					name: 'Original Site',
					storage: 'opfs',
				}),
			],
			'storage-slug'
		);

		await api.rename('  Renamed Site  ');

		const site = store.getState().sites.entities['storage-slug'];
		expect(site?.metadata.name).toBe('Renamed Site');
		expect(site?.urlSlug).toBe('renamed-site');
		expect(pushState).toHaveBeenCalledWith(
			{},
			'',
			'https://playground.example/?site-slug=renamed-site'
		);
	});

	it('persists a custom save name as the saved site URL slug', async () => {
		const { api, store, pushState, addClientInfo } = await createHarness(
			[
				makeSite('temporary-slug', {
					name: 'Temporary Site',
					storage: 'none',
				}),
			],
			'temporary-slug'
		);
		store.dispatch(
			addClientInfo({
				siteSlug: 'temporary-slug',
				url: 'https://playground.example/',
				client: {
					mountOpfs: vitest.fn(async () => undefined),
					readFileAsText: vitest.fn(async () => '{}'),
				} as any,
			})
		);

		await api.saveInBrowser('  My Custom Playground Name  ');

		const site = store.getState().sites.entities['temporary-slug'];
		expect(site?.metadata.storage).toBe('opfs');
		expect(site?.metadata.name).toBe('My Custom Playground Name');
		expect(site?.urlSlug).toBe('my-custom-playground-name');
		expect(pushState).toHaveBeenCalledWith(
			{},
			'',
			'https://playground.example/?site-slug=my-custom-playground-name'
		);
	});

	it('rejects duplicate custom save name URL slugs', async () => {
		const tempClient = {
			mountOpfs: vitest.fn(async () => undefined),
			readFileAsText: vitest.fn(async () => '{}'),
		};
		const { api, store, addClientInfo } = await createHarness(
			[
				makeSite('temporary-slug', {
					name: 'Temporary Site',
					storage: 'none',
				}),
				makeSite('existing-storage-slug', {
					name: 'Existing Site',
					storage: 'opfs',
					urlSlug: 'my-custom-playground-name',
				}),
			],
			'temporary-slug'
		);
		store.dispatch(
			addClientInfo({
				siteSlug: 'temporary-slug',
				url: 'https://playground.example/',
				client: tempClient as any,
			})
		);

		await expect(
			api.saveInBrowser('My Custom Playground Name')
		).rejects.toThrow(
			"Cannot save site. URL slug 'my-custom-playground-name' is already in use."
		);

		expect(tempClient.mountOpfs).not.toHaveBeenCalled();
		const site = store.getState().sites.entities['temporary-slug'];
		expect(site?.metadata.storage).toBe('none');
	});
});
