import type { PHPExtensionLoadDirective } from '@php-wasm/universal';
import { PHP_EXTENSIONS_DIR } from '@php-wasm/universal';
import { joinPaths } from '@php-wasm/util';
import type { StepHandler } from '.';
import type { BlueprintPHPExtension } from '../types';
import type { Directory, FileTree } from '../v1/resources';

type SourceFile = File & { sourceUrl?: string };
type ExtraFilesConfig = NonNullable<BlueprintPHPExtension['extraFiles']>;

export type PHPExtensionSourceFormat = 'so' | 'manifest';

/**
 * @inheritDoc loadPHPExtension
 * @example
 *
 * <code>
 * {
 * 		"step": "loadPHPExtension",
 * 		"source": {
 * 			"resource": "url",
 * 			"url": "https://example.com/extensions/example/manifest.json"
 * 		},
 * 		"sourceFormat": "manifest"
 * }
 * </code>
 */
export interface LoadPHPExtensionStep<FileResource, DirectoryResource> {
	step: 'loadPHPExtension';
	/** The extension `.so` file or a PHP extension `manifest.json`. */
	source: FileResource;
	/** Defaults to "manifest" for `.json` files and "so" otherwise. */
	sourceFormat?: PHPExtensionSourceFormat;
	/** Required when loading a `.so` file whose filename is not named after the extension. */
	name?: string;
	/** Defaults to "extension". Use "zend_extension" for extensions like Xdebug. */
	loadWithIniDirective?: PHPExtensionLoadDirective;
	/** Extra `php.ini` entries to write next to the extension. */
	iniEntries?: Record<string, string>;
	/** Extra files required by the extension, such as ICU data or shared libraries. */
	extraFiles?: DirectoryResource;
	/** Where to write `extraFiles`. Defaults to an extension-specific assets directory. */
	extraFilesPath?: string;
	/** Runtime environment variables needed by the extension. */
	env?: Record<string, string>;
	/** Base URL for relative artifact paths in an inline or bundled manifest. */
	manifestBaseUrl?: string;
	/** Where to install the extension `.so` and `.ini` files. */
	extensionDir?: string;
}

export const loadPHPExtension: StepHandler<
	LoadPHPExtensionStep<File, Directory>,
	Promise<void>
> = async () => {
	/*
	 * PHP extensions must be registered before the PHP runtime starts.
	 * compileBlueprintV1() extracts this step into runtime configuration; once
	 * the ordinary Blueprint step runner reaches it, there is nothing left to do.
	 */
};

export async function getPHPExtensionRuntimeConfig({
	source,
	sourceFormat,
	name,
	loadWithIniDirective,
	iniEntries,
	extraFiles,
	extraFilesPath,
	env,
	manifestBaseUrl,
	extensionDir,
}: Omit<
	LoadPHPExtensionStep<File, Directory>,
	'step'
>): Promise<BlueprintPHPExtension> {
	const format = sourceFormat ?? inferSourceFormat(source);
	const sourceConfig =
		format === 'manifest'
			? await getManifestSourceConfig(source, manifestBaseUrl)
			: await getSoSourceConfig(source, name);
	const extensionName = name ?? inferExtensionName(source);

	return {
		source: sourceConfig,
		...(name ? { name } : {}),
		...(loadWithIniDirective !== undefined ? { loadWithIniDirective } : {}),
		...(iniEntries ? { iniEntries } : {}),
		...(extraFiles
			? {
					extraFiles: getExtraFilesConfig(
						extraFiles,
						extraFilesPath ??
							getDefaultExtraFilesPath(
								extensionName,
								extensionDir
							)
					),
				}
			: {}),
		...(env ? { env } : {}),
		...(extensionDir ? { extensionDir } : {}),
	};
}

function inferSourceFormat(source: File): PHPExtensionSourceFormat {
	return source.name.endsWith('.json') ? 'manifest' : 'so';
}

function inferExtensionName(source: File): string | undefined {
	return source.name.endsWith('.so') ? source.name.slice(0, -3) : undefined;
}

async function getManifestSourceConfig(
	source: SourceFile,
	manifestBaseUrl?: string
): Promise<BlueprintPHPExtension['source']> {
	const sourceUrl = source.sourceUrl;
	if (sourceUrl && !manifestBaseUrl) {
		return {
			format: 'manifest',
			manifestUrl: sourceUrl,
		};
	}

	const baseUrl = manifestBaseUrl ?? sourceUrl;
	if (!baseUrl) {
		throw new Error(
			'loadPHPExtension requires manifestBaseUrl when the manifest is not loaded from a URL resource.'
		);
	}

	return {
		format: 'manifest',
		manifest: JSON.parse(await source.text()),
		baseUrl,
	};
}

async function getSoSourceConfig(
	source: File,
	name?: string
): Promise<BlueprintPHPExtension['source']> {
	const extensionName = name ?? inferExtensionName(source);
	if (!extensionName) {
		throw new Error(
			'loadPHPExtension requires name when source is not a .so file.'
		);
	}

	return {
		format: 'so',
		name: extensionName,
		bytes: new Uint8Array(await source.arrayBuffer()),
	};
}

function getDefaultExtraFilesPath(
	extensionName: string | undefined,
	extensionDir = PHP_EXTENSIONS_DIR
) {
	if (!extensionName) {
		throw new Error(
			'loadPHPExtension requires extraFilesPath when the extension name cannot be inferred.'
		);
	}
	return joinPaths(extensionDir, `${extensionName}-assets`);
}

function getExtraFilesConfig(
	extraFiles: Directory,
	targetPath: string
): ExtraFilesConfig {
	const files: ExtraFilesConfig['files'] = {};
	const directories: string[] = [];
	flattenFileTree(extraFiles.files, targetPath, files, directories);
	return {
		files,
		...(directories.length ? { directories } : {}),
	};
}

function flattenFileTree(
	tree: FileTree,
	root: string,
	files: ExtraFilesConfig['files'],
	directories: string[]
) {
	for (const [relativePath, content] of Object.entries(tree)) {
		const target = joinPaths(root, relativePath);
		if (content instanceof Uint8Array || typeof content === 'string') {
			files[target] = content;
		} else {
			directories.push(target);
			flattenFileTree(content, target, files, directories);
		}
	}
}
