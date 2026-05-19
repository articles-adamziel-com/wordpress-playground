import { defineConfig } from 'vitest/config';

// eslint-disable-next-line @nx/enforce-module-boundaries
import { viteTsConfigPaths } from '../../vite-extensions/vite-ts-config-paths';

export default defineConfig({
	root: __dirname,
	plugins: [
		viteTsConfigPaths({
			root: '../../../',
		}),
	],
	test: {
		include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
	},
});
