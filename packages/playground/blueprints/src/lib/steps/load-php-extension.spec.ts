import { describe, expect, it } from 'vitest';

import {
	getPHPExtensionRuntimeConfig,
	loadPHPExtension,
} from './load-php-extension';

describe('loadPHPExtension Blueprint step', () => {
	it('converts a direct .so resource and extra files into runtime config', async () => {
		const soBytes = new Uint8Array([1, 2, 3]);

		const extension = await getPHPExtensionRuntimeConfig({
			source: new File([soBytes], 'example.so'),
			extraFiles: {
				name: 'example-assets',
				files: {
					'data.txt': 'sidecar',
					nested: {
						'asset.dat': new Uint8Array([4, 5, 6]),
					},
				},
			},
			extraFilesPath: '/internal/shared/example-assets',
		});

		expect(extension).toMatchObject({
			source: {
				format: 'so',
				name: 'example',
				bytes: soBytes,
			},
			extraFiles: {
				files: {
					'/internal/shared/example-assets/data.txt': 'sidecar',
					'/internal/shared/example-assets/nested/asset.dat':
						new Uint8Array([4, 5, 6]),
				},
				directories: ['/internal/shared/example-assets/nested'],
			},
		});
	});

	it('preserves URL-backed manifests as manifestUrl runtime sources', async () => {
		const manifest = new File(['{}'], 'manifest.json') as File & {
			sourceUrl?: string;
		};
		Object.defineProperty(manifest, 'sourceUrl', {
			value: 'https://example.com/ext/manifest.json',
		});

		await expect(
			getPHPExtensionRuntimeConfig({
				source: manifest,
			})
		).resolves.toMatchObject({
			source: {
				format: 'manifest',
				manifestUrl: 'https://example.com/ext/manifest.json',
			},
		});
	});

	it('uses manifestBaseUrl for inline manifests', async () => {
		const manifest = new File(
			[
				JSON.stringify({
					name: 'example',
					artifacts: [],
				}),
			],
			'manifest.json'
		);

		await expect(
			getPHPExtensionRuntimeConfig({
				source: manifest,
				manifestBaseUrl: 'https://example.com/ext/manifest.json',
			})
		).resolves.toMatchObject({
			source: {
				format: 'manifest',
				manifest: {
					name: 'example',
					artifacts: [],
				},
				baseUrl: 'https://example.com/ext/manifest.json',
			},
		});
	});

	it('runs as a no-op because extensions are applied before PHP starts', async () => {
		await expect(loadPHPExtension({} as any, {} as any)).resolves.toBe(
			undefined
		);
	});
});
