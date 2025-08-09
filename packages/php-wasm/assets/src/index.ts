export type AssetOpts = {
	baseUrl?: string;
	packageName?: string;
	version?: string;
	fetchImpl?: (url: string) => Promise<Response>;
};

const defaultCdnBase = (pkg: string, ver: string) =>
	`https://unpkg.com/${pkg}@${ver}/shared/`;

export function assetBaseUrl(): string | undefined {
	const g: any = globalThis as any;
	if (typeof g.__PHP_WASM_ASSET_BASE__ === 'string') {
		return g.__PHP_WASM_ASSET_BASE__;
	}
	if (typeof process !== 'undefined' && process.env.PHP_WASM_ASSET_BASE) {
		return process.env.PHP_WASM_ASSET_BASE;
	}
	return undefined;
}

export async function fetchAsset(
	name: string,
	opts: AssetOpts = {}
): Promise<ArrayBuffer> {
	const pkg = opts.packageName ?? '@php-wasm/web';
	const ver = opts.version ?? '__PKG_VERSION__';
	const fetcher =
		opts.fetchImpl ??
		(typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
	if (!fetcher) {
		throw new Error('fetch unavailable');
	}

	const candidates: string[] = [];

	const explicit = opts.baseUrl ?? assetBaseUrl();
	if (explicit) {
		candidates.push(explicit.endsWith('/') ? explicit : explicit + '/');
	}

	if (typeof document !== 'undefined') {
		const base = new URL('.', import.meta.url).toString();
		candidates.push(base + 'shared/');
	}

	candidates.push(defaultCdnBase(pkg, ver));

	let lastErr: unknown;
	for (const base of candidates) {
		try {
			const res = await fetcher(base + name);
			if (res.ok) {
				return await res.arrayBuffer();
			}
		} catch (e) {
			lastErr = e;
		}
	}
	throw lastErr ?? new Error(`Unable to load asset: ${name}`);
}

export async function resolveAssetFilePath(
	name: string,
	pkg = '@php-wasm/web'
): Promise<string> {
	const { createRequire } = await import('node:module');
	const { dirname, join } = await import('node:path');
	const { existsSync } = await import('node:fs');
	const require = createRequire(import.meta.url);
	const pkgJson = require.resolve(`${pkg}/package.json`);
	const base = dirname(pkgJson);
	const candidates = [
		join(base, 'shared', name),
		join(base, 'src', 'lib', 'data', 'shared', name),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(`Unable to resolve asset: ${name}`);
}
