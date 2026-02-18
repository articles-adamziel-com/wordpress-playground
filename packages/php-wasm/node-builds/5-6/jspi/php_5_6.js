// Placeholder – replace with compiled WASM binary.
// Compile with: node packages/php-wasm/compile/build.js --PLATFORM=node --PHP_VERSION=5.6 --WITH_JSPI=yes
export const dependencyFilename = '';
export const dependenciesTotalSize = 0;
export function init(RuntimeName, PHPLoader) {
	throw new Error(
		'PHP 5.6 WASM binaries have not been compiled yet. ' +
			'Run: node packages/php-wasm/compile/build.js --PLATFORM=node --PHP_VERSION=5.6 --WITH_JSPI=yes'
	);
}
