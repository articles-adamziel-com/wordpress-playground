import { describe, expect, it } from 'vitest';
import {
	getHostname,
	getOrigin,
	getOriginPattern,
	isAllowlistedUrl,
	isSupportedUrl,
} from './permissions';

describe('DevTools extension permissions', () => {
	it('creates Chrome host permission patterns without ports', () => {
		expect(
			getOriginPattern('http://arbitrary-playground.test:8888/page')
		).toBe('http://arbitrary-playground.test/*');
		expect(
			getOriginPattern('https://arbitrary-playground.test:9443/page')
		).toBe('https://arbitrary-playground.test/*');
	});

	it('does not create host permission patterns for unsupported schemes', () => {
		expect(getOriginPattern('chrome://extensions')).toBeNull();
		expect(getOriginPattern('file:///tmp/playground.html')).toBeNull();
	});

	it('keeps origin labels and hostnames useful for UI display', () => {
		const url = 'http://arbitrary-playground.test:8888/page';

		expect(getOrigin(url)).toBe('http://arbitrary-playground.test:8888');
		expect(getHostname(url)).toBe('arbitrary-playground.test');
	});

	it('keeps the built-in allowlist exact', () => {
		expect(isAllowlistedUrl('https://wordpress.org/playground')).toBe(true);
		expect(isAllowlistedUrl('https://make.wordpress.org/core')).toBe(false);
		expect(isAllowlistedUrl('https://playground.wordpress.net/')).toBe(
			true
		);
	});

	it('only supports web page URLs for optional host grants', () => {
		expect(isSupportedUrl('http://arbitrary-playground.test')).toBe(true);
		expect(isSupportedUrl('https://arbitrary-playground.test')).toBe(true);
		expect(isSupportedUrl('chrome://extensions')).toBe(false);
	});
});
