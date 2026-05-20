import { describe, expect, it } from 'vitest';
import {
	cloneRequest,
	getRequestHeaders,
	isHtmlContentType,
	removeContentSecurityPolicyDirective,
} from '../lib/utils';

describe('cloneRequest', () => {
	it('should clone request headers', async () => {
		const request = new Request('http://localhost', {
			headers: {
				'Content-Type': 'text/plain',
				'X-Wp-Nonce': '123456',
			},
		});
		const cloned = await cloneRequest(request, {});
		expect(cloned.headers.get('content-type')).toBe('text/plain');
		expect(cloned.headers.get('x-wp-nonce')).toBe('123456');
	});
});

describe('getRequestHeaders', () => {
	it('should extract request headers', async () => {
		const request = new Request('http://localhost', {
			headers: {
				'Content-Type': 'text/plain',
				'X-Wp-Nonce': '123456',
			},
		});
		expect(getRequestHeaders(request)).toEqual({
			'content-type': 'text/plain',
			'x-wp-nonce': '123456',
		});
	});
});

describe('isHtmlContentType', () => {
	it('detects text/html', () => {
		expect(isHtmlContentType('text/html')).toBe(true);
	});

	it('detects text/html with parameters', () => {
		expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
	});

	it('is case-insensitive', () => {
		expect(isHtmlContentType('Text/HTML')).toBe(true);
		expect(isHtmlContentType('TEXT/HTML; charset=UTF-8')).toBe(true);
	});

	it('accepts an array of content type values', () => {
		expect(isHtmlContentType(['text/html'])).toBe(true);
		expect(isHtmlContentType(['application/json', 'text/html'])).toBe(true);
	});

	it('returns false for non-HTML content types', () => {
		expect(isHtmlContentType('application/json')).toBe(false);
		expect(isHtmlContentType('text/plain')).toBe(false);
		expect(isHtmlContentType('image/png')).toBe(false);
	});

	it('returns false for empty values', () => {
		expect(isHtmlContentType(undefined)).toBe(false);
		expect(isHtmlContentType(null)).toBe(false);
		expect(isHtmlContentType([])).toBe(false);
	});

	it('handles whitespace around the MIME type', () => {
		expect(isHtmlContentType('  text/html  ')).toBe(true);
		expect(isHtmlContentType('  text/html ; charset=utf-8')).toBe(true);
	});
});

describe('removeContentSecurityPolicyDirective', () => {
	it('should remove the specified directive from the middle of the Content-Security-Policy header value', () => {
		const cspHeader =
			"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self';";
		const directiveToRemove = 'frame-ancestors';
		const filteredCspHeader = removeContentSecurityPolicyDirective(
			directiveToRemove,
			cspHeader
		);
		expect(filteredCspHeader).toBe(
			"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self';"
		);
	});

	it('should remove the specified directive from the beginning of the Content-Security-Policy header value', () => {
		const cspHeader =
			"frame-ancestors 'self'; default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self';";
		const directiveToRemove = 'frame-ancestors';
		const filteredCspHeader = removeContentSecurityPolicyDirective(
			directiveToRemove,
			cspHeader
		);
		expect(filteredCspHeader).toBe(
			" default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self';"
		);
	});

	it('should remove the specified directive from the end of the Content-Security-Policy header value', () => {
		const cspHeader =
			"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self';";
		const directiveToRemove = 'frame-ancestors';
		const filteredCspHeader = removeContentSecurityPolicyDirective(
			directiveToRemove,
			cspHeader
		);
		expect(filteredCspHeader).toBe(
			"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self';"
		);
	});

	it('should remove the specified directive from the Content-Security-Policy header value when there are multiple directives', () => {
		const cspHeader =
			"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; frame-ancestors 'self';";
		const directiveToRemove = 'frame-ancestors';
		const filteredCspHeader = removeContentSecurityPolicyDirective(
			directiveToRemove,
			cspHeader
		);
		expect(filteredCspHeader).toBe(
			"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self';"
		);
	});

	it('should remove the specified directive when preceded by every type of ASCII whitespace', () => {
		const cspHeader =
			"default-src 'self';\u{9}\u{A}\u{C}\u{D}\u{20}frame-ancestors 'self';";
		const directiveToRemove = 'frame-ancestors';
		const filteredCspHeader = removeContentSecurityPolicyDirective(
			directiveToRemove,
			cspHeader
		);
		expect(filteredCspHeader).toBe("default-src 'self';");
	});

	it('should remove the specified directive when followed by every type of ASCII whitespace', () => {
		const cspHeader =
			"default-src 'self'; frame-ancestors\u{9}\u{A}\u{C}\u{D}\u{20}'self';";
		const directiveToRemove = 'frame-ancestors';
		const filteredCspHeader = removeContentSecurityPolicyDirective(
			directiveToRemove,
			cspHeader
		);
		expect(filteredCspHeader).toBe("default-src 'self';");
	});
});
