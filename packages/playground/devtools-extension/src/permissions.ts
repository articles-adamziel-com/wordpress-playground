const ALLOWLISTED_HOSTS = [
	'playground.wordpress.net',
	'developer.wordpress.org',
	'developer.woocommerce.com',
	'developer.wordpress.com',
	'wordpress.org',
	'localhost',
	'127.0.0.1',
];

export async function hasPermissionForUrl(url: string): Promise<boolean> {
	const originPattern = getOriginPattern(url);
	if (!originPattern) {
		return false;
	}

	try {
		return await chrome.permissions.contains({
			origins: [originPattern],
		});
	} catch {
		return false;
	}
}

export async function requestPermissionForUrl(url: string): Promise<boolean> {
	const originPattern = getOriginPattern(url);
	if (!originPattern) {
		return false;
	}

	try {
		return await chrome.permissions.request({
			origins: [originPattern],
		});
	} catch {
		return false;
	}
}

export function isAllowlistedUrl(url: string): boolean {
	const hostname = getHostname(url);
	return ALLOWLISTED_HOSTS.includes(hostname);
}

export function getHostname(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return '';
	}
}

export function getOrigin(url: string): string {
	try {
		return new URL(url).origin;
	} catch {
		return '';
	}
}

export function getOriginPattern(url: string): string | null {
	try {
		const urlObject = new URL(url);
		if (!isSupportedProtocol(urlObject.protocol)) {
			return null;
		}

		return `${urlObject.protocol}//${urlObject.hostname}/*`;
	} catch {
		return null;
	}
}

export function isSupportedUrl(url: string): boolean {
	try {
		return isSupportedProtocol(new URL(url).protocol);
	} catch {
		return false;
	}
}

function isSupportedProtocol(protocol: string): boolean {
	return protocol === 'http:' || protocol === 'https:';
}
