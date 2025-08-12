import { PHP } from '@php-wasm/universal';
import { RecommendedPHPVersion } from '@wp-playground/common';
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

// eslint-disable-next-line @nx/enforce-module-boundaries
vi.mock('../lib/networking/with-networking', () => ({
	withNetworking: async (args: any) => args,
}));

import { loadNodeRuntime } from '../lib';

describe('wp-cli', () => {
	it('prints a help message when run without arguments', async () => {
		const php = new PHP(await loadNodeRuntime(RecommendedPHPVersion));
		php.writeFile(
			'/wp-cli.phar',
			readFileSync(
				new URL(
					'../../../../playground/blueprints/tests/fixtures/wp-cli.phar',
					import.meta.url
				)
			)
		);
		const result = await php.cli(['php', '/wp-cli.phar'], {
			env: {
				WP_CLI_ALLOW_ROOT: '1',
				PAGER: 'cat',
			},
		});
		const stdout = await result.stdoutText;
		expect(stdout).toContain('Manage WordPress through the command-line');
		expect(stdout).toContain('SUBCOMMANDS');
		expect(await result.exitCode).toBe(0);
		php.exit();
	});
});
