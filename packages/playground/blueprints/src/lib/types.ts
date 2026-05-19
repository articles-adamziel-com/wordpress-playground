import type { ReadableFilesystemBackend } from '@wp-playground/storage';
import type {
	BlueprintV1,
	BlueprintV1Declaration,
	ExtraLibrary,
	PHPConstants,
} from './v1/types';
import type {
	BlueprintV2,
	BlueprintV2Declaration,
} from './v2/blueprint-v2-declaration';
import type {
	AllPHPVersion,
	PHPExtensionManifest,
	ResolvedInstallOptions,
} from '@php-wasm/universal';

export type BlueprintPHPExtensionSource =
	| {
			format: 'so';
			name?: string;
			bytes: Uint8Array | ArrayBuffer;
	  }
	| {
			format: 'url';
			name?: string;
			url: string;
	  }
	| {
			format: 'manifest';
			manifestUrl: string;
	  }
	| {
			format: 'manifest';
			manifest: PHPExtensionManifest;
			baseUrl?: string;
	  };

export interface BlueprintPHPExtension
	extends Omit<ResolvedInstallOptions, 'phpVersion' | 'fetch' | 'source'> {
	source: BlueprintPHPExtensionSource;
}

/**
 * A filesystem structure containing a /blueprint.json file and any
 * resources referenced by that blueprint.
 */
export type BlueprintBundle = ReadableFilesystemBackend;

export type BlueprintDeclaration =
	| BlueprintV1Declaration
	| BlueprintV2Declaration;
export type Blueprint = BlueprintV1 | BlueprintV2;

export interface RuntimeConfiguration {
	phpVersion: AllPHPVersion;
	wpVersion: string;
	intl: boolean;
	networking: boolean;
	extraLibraries: ExtraLibrary[];
	phpExtensions?: BlueprintPHPExtension[];
	constants: PHPConstants;
}
