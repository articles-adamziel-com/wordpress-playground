import {
	createSpawnHandler,
	joinPaths,
	normalizePath,
	dirname,
	basename,
} from '@php-wasm/util';
import type { PHPProcessManager } from './php-process-manager';

/**
 * An isomorphic proc_open() handler that implements typical shell in TypeScript
 * without relying on a server runtime. It can be used in the browser and Node.js
 * alike whenever you need to spawn a PHP subprocess, query the terminal size, etc.
 * It is open for future expansion if more shell or busybox calls are needed, but
 * advanced shell features such as piping, stream redirection etc. are outside of
 * the scope of this minimal handler. If they become vital at any point, let's
 * explore bringing in an actual shell implementation or at least a proper command
 * parser.
 */
export function sandboxedSpawnHandlerFactory(
	processManager: PHPProcessManager
) {
	return createSpawnHandler(async function (args, processApi, options) {
		processApi.notifySpawn();
		if (args[0] === 'exec') {
			args.shift();
		}

		if (args[0].endsWith('.php') || args[0].endsWith('.phar')) {
			args.unshift('php');
		}

		const binaryName = args[0].split('/').pop();
		const argv = args.slice(1);

		const sleep = (ms: number) =>
			new Promise((resolve) => setTimeout(resolve, ms));
		const parseFlags = (arr: string[]) => {
			const flags: Set<string> = new Set();
			const rest: string[] = [];
			for (const a of arr) {
				if (a.startsWith('-')) {
					for (let i = 1; i < a.length; i++) {
						flags.add(a[i]);
					}
				} else {
					rest.push(a);
				}
			}
			return { flags, rest } as const;
		};
		const validateAllowedFlags = (
			program: string,
			flags: Set<string>,
			allowed: string[]
		) => {
			for (const f of flags) {
				if (!allowed.includes(f)) {
					processApi.stderr(
						`${program}: unrecognized option -${f}\n`
					);
					return false;
				}
			}
			return true;
		};
		const resolvePath = (path: string, cwd: string) => {
			if (!path || path === '.') {
				return cwd;
			}
			return normalizePath(
				path.startsWith('/') ? path : joinPaths(cwd, path)
			);
		};

		// Mock programs required by wp-cli:
		if (binaryName === 'env') {
			// Minimal env support: env stty size
			if (argv[0] === 'stty' && argv[1] === 'size') {
				// These numbers are hardcoded because this handler is stringified.
				processApi.stdout(`18 140`);
				processApi.exit(0);
				return;
			}
			processApi.stderr('env: unsupported invocation\n');
			processApi.exit(1);
			return;
		} else if (binaryName === 'tput') {
			if (argv[0] === 'cols') {
				processApi.stdout(`140`);
				processApi.exit(0);
				return;
			}
			processApi.stderr(
				`tput: unknown capability ${argv[0] ? `'${argv[0]}'` : "''"}\n`
			);
			processApi.exit(1);
			return;
		} else if (binaryName === 'less') {
			processApi.on('stdin', (data: Uint8Array) => {
				processApi.stdout(data);
			});
			// Exit after the stdin stream is exhausted.
			await new Promise((resolve) => {
				processApi.childProcess.stdin.on('finish', () => {
					resolve(true);
				});
			});
			processApi.exit(0);
			return;
		}

		// Binaries requiring PHP to be running.
		const { php, reap } = await processManager.acquirePHPInstance({
			considerPrimary: false,
		});

		try {
			if ('cwd' in options) {
				php.chdir((options.cwd as string) ?? '/');
			}

			const cwd = php.cwd();

			if (binaryName === 'php') {
				// Figure out more about setting env, putenv(), etc.
				const result = await php.cli(args, {
					env: {
						...options.env,
						SCRIPT_PATH: args[1],
						// Set SHELL_PIPE to 0 to ensure WP-CLI formats
						// the output as ASCII tables.
						// @see https://github.com/wp-cli/wp-cli/issues/1102
						SHELL_PIPE: '0',
					},
				});

				result.stdout.pipeTo(
					new WritableStream({
						write(chunk) {
							processApi.stdout(chunk);
						},
					})
				);
				result.stderr.pipeTo(
					new WritableStream({
						write(chunk) {
							processApi.stderr(chunk);
						},
					})
				);
				processApi.exit(await result.exitCode);
			} else if (binaryName === 'pwd') {
				const { flags, rest } = parseFlags(argv);
				if (!validateAllowedFlags('pwd', flags, [])) {
					await sleep(1);
					processApi.exit(1);
					return;
				}
				if (rest.length) {
					processApi.stderr('pwd: too many arguments\n');
					await sleep(1);
					processApi.exit(1);
					return;
				}
				processApi.stdout(cwd + '\n');
				await sleep(1);
				processApi.exit(0);
			} else if (binaryName === 'cd') {
				const { flags, rest } = parseFlags(argv);
				if (!validateAllowedFlags('cd', flags, [])) {
					await sleep(1);
					processApi.exit(1);
					return;
				}
				const target = rest[0] ? resolvePath(rest[0], cwd) : cwd;
				if (!php.isDir(target)) {
					processApi.stderr(
						`cd: no such file or directory: ${rest[0] || target}\n`
					);
					await sleep(1);
					processApi.exit(1);
					return;
				}
				php.chdir(target);
				await sleep(1);
				processApi.exit(0);
			} else if (binaryName === 'mkdir') {
				const { flags, rest } = parseFlags(argv);
				if (!validateAllowedFlags('mkdir', flags, [])) {
					await sleep(1);
					processApi.exit(1);
					return;
				}
				if (!rest.length) {
					processApi.stderr('mkdir: missing operand\n');
					await sleep(1);
					processApi.exit(1);
					return;
				}
				let failed = false;
				for (const p of rest) {
					try {
						php.mkdir(resolvePath(p, cwd));
					} catch (e: any) {
						failed = true;
						processApi.stderr(`mkdir: ${e?.message || e}\n`);
					}
				}
				await sleep(1);
				processApi.exit(failed ? 1 : 0);
			} else if (binaryName === 'touch') {
				const { flags, rest } = parseFlags(argv);
				if (!validateAllowedFlags('touch', flags, [])) {
					await sleep(1);
					processApi.exit(1);
					return;
				}
				if (!rest.length) {
					processApi.stderr('touch: missing file operand\n');
					await sleep(1);
					processApi.exit(1);
					return;
				}
				let failed = false;
				for (const p of rest) {
					const abs = resolvePath(p, cwd);
					try {
						if (php.isDir(abs)) {
							processApi.stderr(
								`touch: not a regular file: ${p}\n`
							);
							failed = true;
							continue;
						}
						if (!php.fileExists(abs)) {
							php.mkdir(dirname(abs));
							php.writeFile(abs, new Uint8Array());
						} else if (php.isFile(abs)) {
							// No-op: pretend timestamp updated
						}
					} catch (e: any) {
						failed = true;
						processApi.stderr(`touch: ${e?.message || e}\n`);
					}
				}
				await sleep(1);
				processApi.exit(failed ? 1 : 0);
			} else if (binaryName === 'cp') {
				const { flags, rest } = parseFlags(argv);
				if (!validateAllowedFlags('cp', flags, ['r'])) {
					await sleep(1);
					processApi.exit(1);
					return;
				}
				if (rest.length < 2) {
					processApi.stderr('cp: missing file operand\n');
					await sleep(1);
					processApi.exit(1);
					return;
				}
				const recursive = flags.has('r');
				const dest = resolvePath(rest[rest.length - 1], cwd);
				const sources = rest
					.slice(0, -1)
					.map((p) => resolvePath(p, cwd));
				const destIsDir = php.isDir(dest);
				if (sources.length > 1 && !destIsDir) {
					processApi.stderr('cp: target is not a directory\n');
					await sleep(1);
					processApi.exit(1);
					return;
				}
				let failed = false;
				const copyFile = (src: string, to: string) => {
					const data = php.readFileAsBuffer(src);
					php.mkdir(dirname(to));
					php.writeFile(to, data);
				};
				const copyRecursive = (src: string, to: string) => {
					if (php.isDir(src)) {
						php.mkdir(to);
						for (const name of php.listFiles(src)) {
							copyRecursive(
								joinPaths(src, name),
								joinPaths(to, name)
							);
						}
					} else {
						copyFile(src, to);
					}
				};
				for (const src of sources) {
					try {
						if (!php.fileExists(src)) {
							throw new Error(
								`no such file or directory: ${src}`
							);
						}
						const target = destIsDir
							? joinPaths(dest, basename(src))
							: dest;
						if (php.isDir(src)) {
							if (!recursive) {
								throw new Error('omitting directory (use -r)');
							}
							copyRecursive(src, target);
						} else {
							copyFile(src, target);
						}
					} catch (e: any) {
						failed = true;
						processApi.stderr(`cp: ${e?.message || e}\n`);
					}
				}
				await sleep(1);
				processApi.exit(failed ? 1 : 0);
			} else if (binaryName === 'mv') {
				const { flags, rest } = parseFlags(argv);
				if (!validateAllowedFlags('mv', flags, [])) {
					await sleep(1);
					processApi.exit(1);
					return;
				}
				if (rest.length < 2) {
					processApi.stderr('mv: missing file operand\n');
					await sleep(1);
					processApi.exit(1);
					return;
				}
				const dest = resolvePath(rest[rest.length - 1], cwd);
				const sources = rest
					.slice(0, -1)
					.map((p) => resolvePath(p, cwd));
				const destIsDir = php.isDir(dest);
				if (sources.length > 1 && !destIsDir) {
					processApi.stderr('mv: target is not a directory\n');
					await sleep(1);
					processApi.exit(1);
					return;
				}
				let failed = false;
				for (const src of sources) {
					try {
						if (!php.fileExists(src)) {
							throw new Error(
								`no such file or directory: ${src}`
							);
						}
						const target = destIsDir
							? joinPaths(dest, basename(src))
							: dest;
						php.mv(src, target);
					} catch (e: any) {
						failed = true;
						processApi.stderr(`mv: ${e?.message || e}\n`);
					}
				}
				await sleep(1);
				processApi.exit(failed ? 1 : 0);
			} else if (binaryName === 'rm') {
				const { flags, rest } = parseFlags(argv);
				if (!validateAllowedFlags('rm', flags, ['r'])) {
					await sleep(1);
					processApi.exit(1);
					return;
				}
				if (!rest.length) {
					processApi.stderr('rm: missing operand\n');
					await sleep(1);
					processApi.exit(1);
					return;
				}
				const recursive = flags.has('r');
				let failed = false;
				for (const p of rest) {
					const abs = resolvePath(p, cwd);
					try {
						if (!php.fileExists(abs)) {
							throw new Error(`no such file or directory: ${p}`);
						}
						if (php.isDir(abs)) {
							if (!recursive) {
								throw new Error('is a directory (use -r)');
							}
							php.rmdir(abs, { recursive: true });
						} else {
							php.unlink(abs);
						}
					} catch (e: any) {
						failed = true;
						processApi.stderr(`rm: ${e?.message || e}\n`);
					}
				}
				await sleep(1);
				processApi.exit(failed ? 1 : 0);
			} else if (binaryName === 'ls') {
				const { flags, rest } = parseFlags(argv);
				if (!validateAllowedFlags('ls', flags, ['r'])) {
					await sleep(1);
					processApi.exit(1);
					return;
				}
				const recursive = flags.has('r');
				const targets = rest.length ? rest : [cwd];
				const listOne = (root: string) => {
					const items = php.listFiles(root);
					for (const name of items) {
						processApi.stdout(name + '\n');
					}
				};
				const listRecursive = (root: string) => {
					const walk = (dir: string, prefix = '') => {
						for (const name of php.listFiles(dir)) {
							const rel = prefix ? joinPaths(prefix, name) : name;
							processApi.stdout(rel + '\n');
							const child = joinPaths(dir, name);
							if (php.isDir(child)) {
								walk(child, rel);
							}
						}
					};
					walk(root, '');
				};
				for (const t of targets) {
					const abs = resolvePath(t, cwd);
					if (!php.fileExists(abs)) {
						processApi.stderr(
							`ls: no such file or directory: ${t}\n`
						);
						continue;
					}
					if (recursive) {
						listRecursive(abs);
					} else if (php.isDir(abs)) {
						listOne(abs);
					} else {
						processApi.stdout(basename(abs) + '\n');
					}
				}
				await sleep(10);
				processApi.exit(0);
			} else {
				// 127 is the exit code for command not found.
				processApi.exit(127);
			}
		} catch (e) {
			// An exception here means the PHP runtime has crashed.
			processApi.exit(1);
			throw e;
		} finally {
			reap();
		}
	});
}
