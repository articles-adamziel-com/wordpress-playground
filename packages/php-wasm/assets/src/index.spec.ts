declare const global: any;
import { assetBaseUrl } from './index';

describe('assetBaseUrl', () => {
	it('reads from global variable', () => {
		(global as any).__PHP_WASM_ASSET_BASE__ = 'https://example.com/';
		expect(assetBaseUrl()).toBe('https://example.com/');
		delete (global as any).__PHP_WASM_ASSET_BASE__;
	});

	it('reads from env variable', () => {
		process.env.PHP_WASM_ASSET_BASE = 'https://env.example/';
		expect(assetBaseUrl()).toBe('https://env.example/');
		delete process.env.PHP_WASM_ASSET_BASE;
	});
});
