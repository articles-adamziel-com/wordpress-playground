import { errorLogPath, logger } from '@php-wasm/logger';
import { createNodeFsMountHandler, loadNodeRuntime } from '@php-wasm/node';
import { EmscriptenDownloadMonitor, ProgressTracker } from '@php-wasm/progress';
import {
	PHP,
	PHPRequest,
	PHPRequestHandler,
	PHPResponse,
	SupportedPHPVersion,
} from '@php-wasm/universal';
import {
	Blueprint,
	compileBlueprint,
	runBlueprintSteps,
} from '@wp-playground/blueprints';
import { RecommendedPHPVersion, zipDirectory } from '@wp-playground/common';
import {
	bootWordPress,
	resolveWordPressRelease,
} from '@wp-playground/wordpress';
import fs from 'fs';
import { Server } from 'http';
import path from 'path';
import readline from 'readline';
import { rootCertificates } from 'tls';
import {
	CACHE_FOLDER,
	cachedDownload,
	fetchSqliteIntegration,
	readAsFile,
} from './download';
import { startServer } from './server';

export interface RunCLIArgs {
	blueprint?: string;
	command: 'server' | 'run-blueprint' | 'build-snapshot';
	debug?: boolean;
	login?: boolean;
	mount?: string[];
	mountBeforeInstall?: string[];
	outfile?: string;
	php?: SupportedPHPVersion;
	port?: number;
	quiet?: boolean;
	skipWordPressSetup?: boolean;
	wp?: string;
}

export interface RunCLIServer {
	requestHandler: PHPRequestHandler;
	server: Server;
}

export async function runCLI(args: RunCLIArgs): Promise<RunCLIServer> {
	/**
	 * TODO: This exact feature will be provided in the PHP Blueprints library.
	 *       Let's use it when it ships. Let's also use it in the web Playground
	 *       app.
	 */
	async function zipSite(outfile: string) {
		// Fake URL for the build
		const { php, reap } =
			await requestHandler.processManager.acquirePHPInstance();
		try {
			await php.run({
				code: `<?php
				$zip = new ZipArchive();
				if(false === $zip->open('/tmp/build.zip', ZipArchive::CREATE | ZipArchive::OVERWRITE)) {
					throw new Exception('Failed to create ZIP');
				}
				$files = new RecursiveIteratorIterator(
					new RecursiveDirectoryIterator('/wordpress')
				);
				foreach ($files as $file) {
					echo $file . PHP_EOL;
					if (!$file->isFile()) {
						continue;
					}
					$zip->addFile($file->getPathname(), $file->getPathname());
				}
				$zip->close();

			`,
			});
			const zip = php.readFileAsBuffer('/tmp/build.zip');
			fs.writeFileSync(outfile, zip);
		} finally {
			reap();
		}
	}

	function mountResources(php: PHP, rawMounts: string[]) {
		const parsedMounts = rawMounts.map((mount) => {
			const [source, vfsPath] = mount.split(':');
			return {
				hostPath: path.resolve(process.cwd(), source),
				vfsPath,
			};
		});
		for (const mount of parsedMounts) {
			php.mkdir(mount.vfsPath);
			php.mount(mount.vfsPath, createNodeFsMountHandler(mount.hostPath));
		}
	}

	function compileInputBlueprint() {
		/**
		 * @TODO This looks similar to the resolveBlueprint() call in the website package:
		 * 	     https://github.com/WordPress/wordpress-playground/blob/ce586059e5885d185376184fdd2f52335cca32b0/packages/playground/website/src/main.tsx#L41
		 *
		 * 		 Also the Blueprint Builder tool does something similar.
		 *       Perhaps all these cases could be handled by the same function?
		 */
		let blueprint: Blueprint | undefined;

		if (args.blueprint) {
			blueprint = args.blueprint as Blueprint;
		} else {
			blueprint = {
				preferredVersions: {
					php: args.php ?? RecommendedPHPVersion,
					wp: args.wp ?? 'latest',
				},
				login: args.login,
			};
		}

		const tracker = new ProgressTracker();
		let lastCaption = '';
		let progress100 = false;
		tracker.addEventListener('progress', (e: any) => {
			if (progress100) {
				return;
			} else if (e.detail.progress === 100) {
				progress100 = true;
			}
			lastCaption =
				e.detail.caption || lastCaption || 'Running the Blueprint';
			readline.clearLine(process.stdout, 0);
			readline.cursorTo(process.stdout, 0);
			process.stdout.write(
				'\r\x1b[K' + `${lastCaption.trim()} – ${e.detail.progress}%`
			);
			if (progress100) {
				process.stdout.write('\n');
			}
		});
		return compileBlueprint(blueprint as Blueprint, {
			progress: tracker,
		});
	}

	if (args.quiet) {
		// @ts-ignore
		logger.handlers = [];
	}

	const compiledBlueprint = compileInputBlueprint();

	let requestHandler: PHPRequestHandler;
	let wordPressReady = false;

	logger.log('Starting a PHP server...');

	return startServer({
		port: args['port'] as number,
		onBind: async (server: Server, port: number): Promise<RunCLIServer> => {
			const absoluteUrl = `http://127.0.0.1:${port}`;

			logger.log(`Setting up WordPress ${args.wp}`);
			let wpDetails: any = undefined;
			const monitor = new EmscriptenDownloadMonitor();
			if (!args.skipWordPressSetup) {
				// @TODO: Rename to FetchProgressMonitor. There's nothing Emscripten
				// about that class anymore.
				monitor.addEventListener('progress', ((
					e: CustomEvent<ProgressEvent & { finished: boolean }>
				) => {
					// @TODO Every progres bar will want percentages. The
					//       download monitor should just provide that.
					const percentProgress = Math.round(
						Math.min(100, (100 * e.detail.loaded) / e.detail.total)
					);
					if (!args.quiet) {
						readline.clearLine(process.stdout, 0);
						readline.cursorTo(process.stdout, 0);
						process.stdout.write(
							`Downloading WordPress ${percentProgress}%...`
						);
					}
				}) as any);

				wpDetails = await resolveWordPressRelease(args.wp);
			}
			logger.log(
				`Resolved WordPress release URL: ${wpDetails?.releaseUrl}`
			);

			const preinstalledWpContentPath =
				wpDetails &&
				path.join(
					CACHE_FOLDER,
					`prebuilt-wp-content-for-wp-${wpDetails.version}.zip`
				);
			const wordPressZip = !wpDetails
				? undefined
				: fs.existsSync(preinstalledWpContentPath)
				? readAsFile(preinstalledWpContentPath)
				: await cachedDownload(
						wpDetails.releaseUrl,
						`${wpDetails.version}.zip`,
						monitor
				  );

			const constants: Record<string, string | number | boolean | null> =
				{
					WP_DEBUG: true,
					WP_DEBUG_LOG: true,
					WP_DEBUG_DISPLAY: false,
				};

			logger.log(`Booting WordPress...`);
			requestHandler = await bootWordPress({
				siteUrl: absoluteUrl,
				createPhpRuntime: async () =>
					await loadNodeRuntime(compiledBlueprint.versions.php),
				wordPressZip,
				sqliteIntegrationPluginZip: fetchSqliteIntegration(monitor),
				sapiName: 'cli',
				createFiles: {
					'/internal/shared/ca-bundle.crt':
						rootCertificates.join('\n'),
				},
				constants,
				phpIniEntries: {
					'openssl.cafile': '/internal/shared/ca-bundle.crt',
					allow_url_fopen: '1',
					disable_functions: '',
				},
				hooks: {
					async beforeWordPressFiles(php) {
						if (args.mountBeforeInstall) {
							mountResources(php, args.mountBeforeInstall);
						}
					},
				},
			});
			logger.log(`Booted!`);

			const php = await requestHandler.getPrimaryPhp();
			try {
				if (
					wpDetails &&
					!args.mountBeforeInstall &&
					!fs.existsSync(preinstalledWpContentPath)
				) {
					logger.log(
						`Caching preinstalled WordPress for the next boot...`
					);
					fs.writeFileSync(
						preinstalledWpContentPath,
						await zipDirectory(php, '/wordpress')
					);
					logger.log(`Cached!`);
				}

				if (args.mount) {
					mountResources(php, args.mount);
				}

				wordPressReady = true;

				if (compiledBlueprint) {
					const { php, reap } =
						await requestHandler.processManager.acquirePHPInstance();
					try {
						logger.log(`Running the Blueprint...`);
						await runBlueprintSteps(compiledBlueprint, php);
						logger.log(`Finished running the blueprint`);
					} finally {
						reap();
					}
				}

				if (args.command === 'build-snapshot') {
					await zipSite(args.outfile as string);
					logger.log(`WordPress exported to ${args.outfile}`);
					process.exit(0);
				} else if (args.command === 'run-blueprint') {
					logger.log(`Blueprint executed`);
					process.exit(0);
				} else {
					logger.log(`WordPress is running on ${absoluteUrl}`);
				}

				return { requestHandler, server };
			} catch (error) {
				if (!args.debug) {
					throw error;
				}
				const phpLogs = php.readFileAsText(errorLogPath);
				throw new Error(phpLogs, { cause: error });
			}
		},
		async handleRequest(request: PHPRequest) {
			if (!wordPressReady) {
				return PHPResponse.forHttpCode(
					502,
					'WordPress is not ready yet'
				);
			}
			return await requestHandler.request(request);
		},
	});
}
