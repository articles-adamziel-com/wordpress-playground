/**
 * CLI Output Formatter
 *
 * Provides a clean, informative CLI output experience with:
 * - TTY-aware formatting (colors, in-place updates)
 * - Banner and configuration display
 * - Progress tracking on a single line
 * - Respect for verbosity settings
 */

import { shouldRenderProgress } from './utils/progress';

export interface CLIOutputOptions {
	verbosity: string;
	writeStream?: NodeJS.WriteStream;
}

export interface ConfigSummary {
	phpVersion: string;
	wpVersion: string;
	port: number;
	xdebug: boolean;
	intl: boolean;
	mounts: Array<{ hostPath: string; vfsPath: string }>;
	autoMountResult?: AutoMountResult;
	blueprint?: string;
}

export type AutoMountResult =
	| { type: 'plugin'; name: string; hostPath: string; vfsPath: string }
	| { type: 'theme'; name: string; hostPath: string; vfsPath: string }
	| { type: 'wp-content'; hostPath: string; vfsPath: string }
	| { type: 'wordpress'; hostPath: string; vfsPath: string }
	| { type: 'directory'; hostPath: string; vfsPath: string }
	| { type: 'none' };

/**
 * Manages CLI output with TTY-awareness and verbosity respect.
 */
export class CLIOutput {
	private verbosity: string;
	private writeStream: NodeJS.WriteStream;
	private lastProgressLine = '';
	private progressActive = false;

	constructor(options: CLIOutputOptions) {
		this.verbosity = options.verbosity;
		this.writeStream = options.writeStream || process.stdout;
	}

	get isTTY(): boolean {
		return Boolean(this.writeStream.isTTY);
	}

	get shouldRender(): boolean {
		return shouldRenderProgress(this.writeStream);
	}

	get isQuiet(): boolean {
		return this.verbosity === 'quiet';
	}

	// ANSI formatting helpers - only apply when TTY
	private bold(text: string): string {
		return this.isTTY ? `\x1b[1m${text}\x1b[0m` : text;
	}

	private dim(text: string): string {
		return this.isTTY ? `\x1b[2m${text}\x1b[0m` : text;
	}

	private green(text: string): string {
		return this.isTTY ? `\x1b[32m${text}\x1b[0m` : text;
	}

	private cyan(text: string): string {
		return this.isTTY ? `\x1b[36m${text}\x1b[0m` : text;
	}

	private yellow(text: string): string {
		return this.isTTY ? `\x1b[33m${text}\x1b[0m` : text;
	}

	private red(text: string): string {
		return this.isTTY ? `\x1b[31m${text}\x1b[0m` : text;
	}

	private magenta(text: string): string {
		return this.isTTY ? `\x1b[35m${text}\x1b[0m` : text;
	}

	/**
	 * Display the WordPress Playground CLI banner.
	 */
	printBanner(): void {
		if (this.isQuiet) return;

		const banner = this.bold('WordPress Playground');
		this.writeStream.write(`\n${banner}\n\n`);
	}

	/**
	 * Display the configuration summary.
	 */
	printConfig(config: ConfigSummary): void {
		if (this.isQuiet) return;

		const lines: string[] = [];

		// PHP and WordPress versions
		lines.push(
			`${this.dim('PHP')} ${this.cyan(config.phpVersion)}  ${this.dim('WordPress')} ${this.cyan(config.wpVersion)}`
		);

		// Extensions
		const extensions: string[] = [];
		if (config.intl) extensions.push('intl');
		if (config.xdebug) extensions.push(this.yellow('xdebug'));
		if (extensions.length > 0) {
			lines.push(`${this.dim('Extensions')} ${extensions.join(', ')}`);
		}

		// Auto-mount result
		if (config.autoMountResult && config.autoMountResult.type !== 'none') {
			const mount = config.autoMountResult;
			let mountDesc: string;
			switch (mount.type) {
				case 'plugin':
					mountDesc = `${this.green('plugin')} ${this.bold(mount.name)}`;
					break;
				case 'theme':
					mountDesc = `${this.magenta('theme')} ${this.bold(mount.name)}`;
					break;
				case 'wp-content':
					mountDesc = `${this.cyan('wp-content')} directory`;
					break;
				case 'wordpress':
					mountDesc = `${this.cyan('WordPress')} installation`;
					break;
				case 'directory':
					mountDesc = `host directory`;
					break;
			}
			lines.push(`${this.dim('Mounting')} ${mountDesc}`);
			lines.push(
				`  ${this.dim(mount.hostPath)} ${this.dim('at')} ${mount.vfsPath}`
			);
		}

		// Blueprint if specified
		if (config.blueprint) {
			lines.push(`${this.dim('Blueprint')} ${config.blueprint}`);
		}

		this.writeStream.write(lines.join('\n') + '\n\n');
	}

	/**
	 * Start a progress indicator.
	 * In TTY mode, this will be updated in-place on the same line.
	 */
	startProgress(message: string): void {
		if (this.isQuiet) return;
		if (!this.shouldRender) return;

		this.progressActive = true;
		this.updateProgress(message);
	}

	/**
	 * Update the current progress message.
	 * In TTY mode, this updates the same line.
	 */
	updateProgress(message: string, percent?: number): void {
		if (this.isQuiet) return;
		if (!this.shouldRender) return;
		if (!this.progressActive) {
			this.progressActive = true;
		}

		let fullMessage = `${message}`;
		if (percent !== undefined) {
			fullMessage = `${message} ${this.dim(`${percent}%`)}`;
		}

		if (fullMessage === this.lastProgressLine) {
			return; // Avoid flickering by not rewriting identical content
		}
		this.lastProgressLine = fullMessage;

		if (this.isTTY) {
			this.writeStream.cursorTo(0);
			this.writeStream.write(fullMessage);
			this.writeStream.clearLine(1);
		} else {
			this.writeStream.write(`${fullMessage}\n`);
		}
	}

	/**
	 * Complete the current progress and move to the next line.
	 */
	finishProgress(finalMessage?: string): void {
		if (this.isQuiet) return;
		if (!this.shouldRender) return;

		if (finalMessage) {
			if (this.isTTY) {
				this.writeStream.cursorTo(0);
				this.writeStream.write(`${finalMessage}`);
				this.writeStream.clearLine(1);
			} else {
				this.writeStream.write(`${finalMessage}\n`);
			}
		}

		if (this.isTTY) {
			this.writeStream.write('\n');
		}

		this.progressActive = false;
		this.lastProgressLine = '';
	}

	/**
	 * Print a status line (not a progress update).
	 */
	printStatus(message: string): void {
		if (this.isQuiet) return;

		// If we have an active progress line, clear it first
		if (this.progressActive && this.isTTY) {
			this.writeStream.cursorTo(0);
			this.writeStream.clearLine(0);
		}

		this.writeStream.write(`${message}\n`);
		this.progressActive = false;
		this.lastProgressLine = '';
	}

	/**
	 * Print an error message (always shown, even in quiet mode).
	 */
	printError(message: string): void {
		// Clear any active progress first
		if (this.progressActive && this.isTTY) {
			this.writeStream.cursorTo(0);
			this.writeStream.clearLine(0);
			this.progressActive = false;
		}

		this.writeStream.write(`${this.red('Error:')} ${message}\n`);
	}

	/**
	 * Print the final "ready" message with the server URL.
	 * Note: The string "WordPress is running on" is required for CI tests.
	 */
	printReady(url: string, workerCount: number): void {
		if (this.isQuiet) return;

		const workerLabel = workerCount === 1 ? 'worker' : 'workers';
		this.writeStream.write(
			`\n${this.green('Ready!')} WordPress is running on ${this.bold(url)} ${this.dim(`(${workerCount} ${workerLabel})`)}\n\n`
		);
	}

	/**
	 * Print a warning message.
	 */
	printWarning(message: string): void {
		if (this.isQuiet) return;

		this.writeStream.write(`${this.yellow('Warning:')} ${message}\n`);
	}
}

/**
 * Detect the type of directory being auto-mounted.
 */
export function detectAutoMountType(
	autoMountPath: string,
	args: {
		mount?: Array<{ hostPath: string; vfsPath: string }>;
		'mount-before-install'?: Array<{ hostPath: string; vfsPath: string }>;
		mode?: string;
	}
): AutoMountResult {
	// Check the mounts to determine what type was detected
	const allMounts = [
		...(args.mount || []),
		...(args['mount-before-install'] || []),
	];

	// Normalize paths for comparison
	const normalizedAutoMount = autoMountPath.replace(/\/$/, '');

	for (const mount of allMounts) {
		const normalizedHostPath = mount.hostPath.replace(/\/$/, '');

		// Check if this mount is related to the auto-mount path
		if (
			normalizedHostPath === normalizedAutoMount ||
			normalizedHostPath.startsWith(normalizedAutoMount + '/')
		) {
			if (
				mount.vfsPath.match(/^\/wordpress\/wp-content\/plugins\/[^/]+$/)
			) {
				const name = mount.vfsPath.split('/').pop() || '';
				return {
					type: 'plugin',
					name,
					hostPath: autoMountPath,
					vfsPath: mount.vfsPath,
				};
			}
			if (
				mount.vfsPath.match(/^\/wordpress\/wp-content\/themes\/[^/]+$/)
			) {
				const name = mount.vfsPath.split('/').pop() || '';
				return {
					type: 'theme',
					name,
					hostPath: autoMountPath,
					vfsPath: mount.vfsPath,
				};
			}
			// Check for wp-content mounts (but not the nested plugins/themes)
			if (
				mount.vfsPath.startsWith('/wordpress/wp-content/') &&
				!mount.vfsPath.startsWith('/wordpress/wp-content/plugins/') &&
				!mount.vfsPath.startsWith('/wordpress/wp-content/themes/')
			) {
				return {
					type: 'wp-content',
					hostPath: autoMountPath,
					vfsPath: '/wordpress/wp-content',
				};
			}
			if (mount.vfsPath === '/wordpress') {
				if (args.mode === 'apply-to-existing-site') {
					return {
						type: 'wordpress',
						hostPath: autoMountPath,
						vfsPath: '/wordpress',
					};
				}
				return {
					type: 'directory',
					hostPath: autoMountPath,
					vfsPath: '/wordpress',
				};
			}
		}
	}

	return { type: 'none' };
}
