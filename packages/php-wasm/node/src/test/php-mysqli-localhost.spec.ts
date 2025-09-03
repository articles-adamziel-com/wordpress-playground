import { PHP, SupportedPHPVersions } from '@php-wasm/universal';
import { loadNodeRuntime } from '../lib';
import { jspi } from 'wasm-feature-detect';

const runtimeMode = (await jspi()) ? 'jspi' : 'asyncify';

describe(`mysqli localhost uses TCP – ${runtimeMode}`, () => {
	const phpVersions =
		'PHP' in process.env ? [process.env['PHP']!] : SupportedPHPVersions;

	describe.each(phpVersions)(`PHP %s – ${runtimeMode}`, (phpVersion) => {
		let php: PHP;
		beforeEach(async () => {
			php = new PHP(await loadNodeRuntime(phpVersion as any));
		});

		afterEach(async () => {
			php.exit();
		});

		it('prefers TCP over UNIX sockets when using localhost', async () => {
			const result = await php.run({
				code: `<?php
                                mysqli_report(MYSQLI_REPORT_OFF);
                                @$m = new mysqli('localhost', 'user', 'pass');
                                echo $m->connect_error;
                        `,
			});
			expect(result.errors).toBeFalsy();
			expect(result.text).toContain('Connection refused');
			expect(result.text).not.toContain('No such file or directory');
		});
	});
});
