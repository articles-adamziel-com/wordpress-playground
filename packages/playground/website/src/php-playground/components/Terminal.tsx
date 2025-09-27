import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import clsx from 'clsx';
import { splitShellCommand } from '@php-wasm/util';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

import { playgroundRuntime } from '../runtime';
import styles from './layout.module.css';
import 'xterm/css/xterm.css';

const MIN_TERMINAL_HEIGHT = 140;
const MAX_TERMINAL_HEIGHT = 600;
const DEFAULT_TERMINAL_HEIGHT = 220;
const PROGRESS_BAR_WIDTH = 28;
const SPINNER_FRAMES = ['-', '\\', '|', '/'];

interface DownloadProgress {
	label: string;
	totalBytes: number;
	receivedBytes: number;
	spinnerIndex: number;
	lastRenderedLength: number;
}

const clampHeight = (value: number) =>
	Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, value));

const formatBytes = (bytes: number) => {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	const units = ['KB', 'MB', 'GB'];
	let size = bytes / 1024;
	let unitIndex = 0;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex += 1;
	}
	return `${size.toFixed(1)} ${units[unitIndex]}`;
};

const drawProgress = (term: XTerm, progress: DownloadProgress) => {
	let line: string;
	if (progress.totalBytes > 0) {
		const percent = Math.min(
			100,
			Math.round((progress.receivedBytes / progress.totalBytes) * 100)
		);
		const filled = Math.round((PROGRESS_BAR_WIDTH * percent) / 100);
		const bar = '#'.repeat(filled).padEnd(PROGRESS_BAR_WIDTH, ' ');
		line = `${progress.label}: [${bar}] ${percent
			.toString()
			.padStart(3, ' ')}%`;
	} else {
		const spinner =
			SPINNER_FRAMES[progress.spinnerIndex % SPINNER_FRAMES.length];
		line = `${progress.label}: ${spinner} ${formatBytes(
			progress.receivedBytes
		)}`;
	}
	const padLength = Math.max(line.length, progress.lastRenderedLength);
	term.write(`\r${line.padEnd(padLength, ' ')}`);
	progress.lastRenderedLength = padLength;
};

export const Terminal = () => {
	const terminalContainerRef = useRef<HTMLDivElement | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const progressRef = useRef<DownloadProgress | null>(null);

	const [height, setHeight] = useState(DEFAULT_TERMINAL_HEIGHT);
	const [isCollapsed, setCollapsed] = useState(false);
	const [isDragging, setDragging] = useState(false);

	const lastExpandedHeightRef = useRef(DEFAULT_TERMINAL_HEIGHT);
	const isCollapsedRef = useRef(isCollapsed);
	const isDraggingRef = useRef(false);
	const dragContextRef = useRef({
		pointerId: -1,
		startY: 0,
		startHeight: DEFAULT_TERMINAL_HEIGHT,
	});

	useEffect(() => {
		isCollapsedRef.current = isCollapsed;
	}, [isCollapsed]);

	useEffect(() => {
		if (!isCollapsed) {
			lastExpandedHeightRef.current = height;
		}
	}, [height, isCollapsed]);

	useEffect(() => {
		if (!isDragging) {
			return;
		}
		const previousUserSelect = document.body.style.userSelect;
		document.body.style.userSelect = 'none';
		return () => {
			document.body.style.userSelect = previousUserSelect;
		};
	}, [isDragging]);

	const applyHeight = useCallback((value: number) => {
		setHeight(clampHeight(value));
	}, []);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();

			let baseHeight = height;
			if (isCollapsedRef.current) {
				const restored = clampHeight(
					lastExpandedHeightRef.current || DEFAULT_TERMINAL_HEIGHT
				);
				baseHeight = restored;
				setCollapsed(false);
				setHeight(restored);
			}

			dragContextRef.current = {
				pointerId: event.pointerId,
				startY: event.clientY,
				startHeight: baseHeight,
			};
			isDraggingRef.current = true;
			setDragging(true);
			event.currentTarget.setPointerCapture?.(event.pointerId);
		},
		[height]
	);

	const handlePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (
				!isDraggingRef.current ||
				dragContextRef.current.pointerId !== event.pointerId
			) {
				return;
			}
			const delta = dragContextRef.current.startY - event.clientY;
			applyHeight(dragContextRef.current.startHeight + delta);
		},
		[applyHeight]
	);

	const endResize = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (dragContextRef.current.pointerId !== event.pointerId) {
				return;
			}
			event.currentTarget.releasePointerCapture?.(event.pointerId);
			isDraggingRef.current = false;
			setDragging(false);
			fitAddonRef.current?.fit();
		},
		[]
	);

	const toggleCollapse = useCallback(() => {
		setCollapsed((prev) => {
			if (prev) {
				const restored = clampHeight(
					lastExpandedHeightRef.current || DEFAULT_TERMINAL_HEIGHT
				);
				setHeight(restored);
				return false;
			}
			lastExpandedHeightRef.current = height;
			return true;
		});
	}, [height]);

	useEffect(() => {
		if (isCollapsed) {
			return;
		}
		const fitAddon = fitAddonRef.current;
		if (!fitAddon) {
			return;
		}
		const frame = requestAnimationFrame(() => {
			try {
				fitAddon.fit();
			} catch {}
		});
		return () => cancelAnimationFrame(frame);
	}, [height, isCollapsed]);

	useEffect(() => {
		const handleResize = () => {
			if (!isCollapsedRef.current) {
				try {
					fitAddonRef.current?.fit();
				} catch {}
			}
		};
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, []);

	useEffect(() => {
		const container = terminalContainerRef.current;
		if (!container) {
			return;
		}

		const term = new XTerm({
			convertEol: true,
			fontSize: 14,
			theme: {
				background: '#111111',
				foreground: '#f1f5f9',
			},
			cursorBlink: true,
		});
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.open(container);
		fitAddonRef.current = fitAddon;
		requestAnimationFrame(() => {
			try {
				fitAddon.fit();
			} catch {}
		});

		const startDownloadProgress = (label: string, totalBytes: number) => {
			progressRef.current = {
				label,
				totalBytes,
				receivedBytes: 0,
				spinnerIndex: 0,
				lastRenderedLength: 0,
			};
			term.writeln('');
			drawProgress(term, progressRef.current);
		};

		const updateDownloadProgress = (
			receivedBytes: number,
			totalBytes: number
		) => {
			if (!progressRef.current) {
				return;
			}
			progressRef.current.receivedBytes = receivedBytes;
			if (totalBytes) {
				progressRef.current.totalBytes = totalBytes;
			}
			progressRef.current.spinnerIndex += 1;
			drawProgress(term, progressRef.current);
		};

		const finishDownloadProgress = (message: string) => {
			if (!progressRef.current) {
				return;
			}
			if (progressRef.current.totalBytes) {
				progressRef.current.receivedBytes =
					progressRef.current.totalBytes;
				drawProgress(term, progressRef.current);
			}
			term.writeln('');
			term.writeln(`${progressRef.current.label}: ${message}`);
			progressRef.current = null;
		};

		const failDownloadProgress = (message: string) => {
			if (!progressRef.current) {
				term.writeln(message);
				return;
			}
			const failureLine = `${progressRef.current.label}: failed`;
			const pad = Math.max(
				failureLine.length,
				progressRef.current.lastRenderedLength
			);
			term.write(`\r${failureLine.padEnd(pad, ' ')}`);
			term.writeln('');
			term.writeln(message);
			progressRef.current = null;
		};

		const prompt = (newLine = true) => {
			term.write(newLine ? '\r\n$ ' : '$ ');
		};

		const refreshInputLine = (currentLine: string) => {
			term.write(`\r\x1b[2K$ ${currentLine}`);
		};

		const writeStdout = (text: string) => {
			if (!text) {
				return;
			}
			term.write(text.replace(/\r?\n/g, '\r\n'));
		};

		const writeStderr = (text: string) => {
			if (!text) {
				return;
			}
			term.write(`\u001b[31m${text.replace(/\r?\n/g, '\r\n')}\u001b[0m`);
		};

		term.writeln(
			'WordPress Playground CLI ready. Type `help` to see available commands.'
		);
		prompt(false);

		const downloadWithProgress = async (url: string, label: string) => {
			try {
				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(
						`Failed to download ${label.toLowerCase()}.`
					);
				}
				const totalHeader = response.headers.get('content-length');
				const totalBytes = totalHeader ? Number(totalHeader) : 0;
				startDownloadProgress(label, totalBytes);

				if (!response.body || !response.body.getReader) {
					const buffer = await response.arrayBuffer();
					finishDownloadProgress('complete');
					return new Uint8Array(buffer);
				}

				const reader = response.body.getReader();
				const chunks: Uint8Array[] = [];
				let received = 0;
				while (true) {
					const { value, done } = await reader.read();
					if (done) {
						break;
					}
					if (value) {
						chunks.push(value);
						received += value.byteLength;
						updateDownloadProgress(received, totalBytes);
					}
				}

				const bytes = new Uint8Array(received);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.byteLength;
				}
				finishDownloadProgress('complete');
				return bytes;
			} catch (error: any) {
				failDownloadProgress(error?.message || String(error));
				throw error;
			}
		};

		const ensureBootReady = async () => {
			await playgroundRuntime.getBootPromise();
			const client = playgroundRuntime.getClient();
			if (!client) {
				throw new Error('Playground client is not ready yet.');
			}
			return client as any;
		};

		const ensureTerminalExpanded = () => {
			if (!isCollapsedRef.current) {
				return;
			}
			const targetHeight = clampHeight(
				lastExpandedHeightRef.current || DEFAULT_TERMINAL_HEIGHT
			);
			lastExpandedHeightRef.current = targetHeight;
			setCollapsed(false);
			setHeight(targetHeight);
		};

		const ensureWpCliBinary = async () => {
			const client = await ensureBootReady();
			const path = '/tmp/wp-cli.phar';
			if (await client.fileExists(path)) {
				return;
			}
			term.writeln('\r\nPreparing WP-CLI...');
			const binary = await downloadWithProgress(
				'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar',
				'WP-CLI download'
			);
			await client.writeFile(path, binary);
		};

		const ensureComposerBinary = async () => {
			const client = await ensureBootReady();
			const path = '/tmp/composer.phar';
			if (await client.fileExists(path)) {
				return;
			}
			term.writeln('\r\nPreparing Composer...');
			const binary = await downloadWithProgress(
				'https://wordpress-playground-cors-proxy.net/?https://getcomposer.org/download/2.8.12/composer.phar',
				'Composer download'
			);
			await client.writeFile(`${path}.bin`, binary);
			await client.writeFile(
				path,
				`<?php
// Composer assumes the grapheme_strlen function is available
// and will crash if it's not. Symfony Polyfills somehow do
// not kick in in this case.
function grapheme_strlen($string) {
	return strlen($string);
}
require_once __FILE__ . '.bin';
`
			);
		};

		const runCli = async (
			argv: string[],
			options: { env?: Record<string, string> } = {}
		) => {
			const client = await ensureBootReady();
			const requestHandler = client.__internal_getRequestHandler?.();
			const processManager = requestHandler?.processManager;
			const { php, reap } = processManager
				? await processManager.acquirePHPInstance()
				: { php: await client.__internal_getPHP?.(), reap: () => {} };
			try {
				const response = await php.cli(argv, options);
				const stdoutReader = response.stdout.getReader();
				const stderrReader = response.stderr.getReader();
				const stdoutDecoder = new TextDecoder();
				const stderrDecoder = new TextDecoder();
				let aborted = false;

				const activeProcess = {
					async terminate() {
						if (aborted) {
							return;
						}
						aborted = true;
						try {
							await stdoutReader.cancel();
						} catch {}
						try {
							await stderrReader.cancel();
						} catch {}
						try {
							php.exit(130);
						} catch {}
					},
				};
				currentProcess = activeProcess;

				const streamStdout = (async () => {
					try {
						while (!aborted) {
							const { value, done } = await stdoutReader.read();
							if (done) {
								break;
							}
							if (value) {
								const text = stdoutDecoder.decode(value, {
									stream: true,
								});
								writeStdout(text);
							}
						}
						const flush = stdoutDecoder.decode();
						writeStdout(flush);
					} catch (error) {
						if (!aborted) {
							throw error;
						}
					}
				})();

				const streamStderr = (async () => {
					try {
						while (!aborted) {
							const { value, done } = await stderrReader.read();
							if (done) {
								break;
							}
							if (value) {
								const text = stderrDecoder.decode(value, {
									stream: true,
								});
								writeStderr(text);
							}
						}
						const flush = stderrDecoder.decode();
						writeStderr(flush);
					} catch (error) {
						if (!aborted) {
							throw error;
						}
					}
				})();

				const exitCodePromise = response.exitCode.catch(
					(error: any) => {
						if (!aborted) {
							throw error;
						}
						return 130;
					}
				);

				exitCodePromise.finally(() => reap());

				const [, , exitCode] = await Promise.all([
					streamStdout.catch(() => {}),
					streamStderr.catch(() => {}),
					exitCodePromise,
				]);

				const result = {
					exitCode,
					aborted,
				};
				currentProcess = null;
				return result;
			} catch (error) {
				currentProcess = null;
				throw error;
			}
		};

		const commandHistory: string[] = [];
		let historyIndex = -1;
		let currentLine = '';
		let isRunningCommand = false;
		let currentProcess: { terminate: () => Promise<void> } | null = null;
		let lastInputChar = '';

		const runTerminalCommand = async (rawInput: string) => {
			const trimmed = rawInput.trim();
			if (!trimmed) {
				isRunningCommand = false;
				prompt();
				return;
			}
			const parts = splitShellCommand(trimmed);
			if (!parts.length) {
				isRunningCommand = false;
				prompt();
				return;
			}

			ensureTerminalExpanded();

			const [command, ...args] = parts;
			try {
				if (command === 'help') {
					term.writeln(
						'\r\nAvailable commands:\r\n  help        Show this message\r\n  php <...>  Run PHP CLI arguments\r\n  wp <...>   Run WP-CLI (auto-downloads if needed)\r\n  composer <...>  Run Composer (auto-downloads if needed)'
					);
				} else if (command === 'php') {
					if (!args.length) {
						term.writeln('\r\nUsage: php <arguments>');
					} else {
						const result = await runCli(['php', ...args]);
						if (!result.aborted && result.exitCode !== 0) {
							term.writeln(
								`\r\nProcess exited with code ${result.exitCode}`
							);
						}
					}
				} else if (command === 'wp') {
					await ensureWpCliBinary();
					const result = await runCli([
						'php',
						'/tmp/wp-cli.phar',
						'--path=/wordpress',
						...args,
					]);
					if (!result.aborted && result.exitCode !== 0) {
						term.writeln(
							`\r\nProcess exited with code ${result.exitCode}`
						);
					}
				} else if (command === 'composer') {
					await ensureComposerBinary();
					const result = await runCli([
						'php',
						'/tmp/composer.phar',
						...args,
					]);
					if (!result.aborted && result.exitCode !== 0) {
						term.writeln(
							`\r\nProcess exited with code ${result.exitCode}`
						);
					}
				} else {
					term.writeln(`\r\n${command}: command not found`);
				}
			} catch (error: any) {
				const message = error?.message || String(error);
				term.writeln(`\r\nError: ${message}`);
			} finally {
				isRunningCommand = false;
				if (!currentProcess) {
					prompt();
				}
			}
		};

		const abortActiveProcess = async () => {
			if (!currentProcess) {
				isRunningCommand = false;
				prompt();
				return;
			}
			try {
				await currentProcess.terminate();
			} finally {
				currentProcess = null;
				isRunningCommand = false;
			}
		};

		term.onData((chunk) => {
			for (const char of chunk) {
				if (char === '\u0003') {
					term.write('^C');
					currentLine = '';
					void abortActiveProcess();
					lastInputChar = char;
					continue;
				}
				if (isRunningCommand) {
					lastInputChar = char;
					continue;
				}
				switch (char) {
					case '\r':
					case '\n': {
						if (char === '\n' && lastInputChar === '\r') {
							break;
						}
						term.write('\r\n');
						const submitted = currentLine;
						if (submitted.trim()) {
							commandHistory.unshift(submitted);
						}
						historyIndex = -1;
						currentLine = '';
						isRunningCommand = true;
						void runTerminalCommand(submitted);
						break;
					}
					case '\u007f': {
						if (currentLine.length > 0) {
							currentLine = currentLine.slice(0, -1);
							term.write('\b \b');
						}
						break;
					}
					default: {
						if (char === '\n') {
							break;
						}
						if (char >= ' ' || char >= '\u00a0') {
							currentLine += char;
							term.write(char);
						}
						break;
					}
				}
				lastInputChar = char;
			}
		});

		term.attachCustomKeyEventHandler((event) => {
			if (event.type !== 'keydown') {
				return true;
			}
			if (event.metaKey || event.ctrlKey) {
				return true;
			}
			if (event.code === 'ArrowUp') {
				event.preventDefault();
				if (!commandHistory.length) {
					return false;
				}
				const nextIndex = historyIndex + 1;
				if (nextIndex < commandHistory.length) {
					historyIndex = nextIndex;
					currentLine = commandHistory[historyIndex];
					refreshInputLine(currentLine);
				}
				return false;
			}
			if (event.code === 'ArrowDown') {
				event.preventDefault();
				if (historyIndex > 0) {
					historyIndex -= 1;
					currentLine = commandHistory[historyIndex];
				} else {
					historyIndex = -1;
					currentLine = '';
				}
				refreshInputLine(currentLine);
				return false;
			}
			return true;
		});

		return () => {
			term.dispose();
			fitAddonRef.current = null;
			progressRef.current = null;
		};
	}, []);

	const sectionClassName = clsx(styles.terminalSection, {
		[styles.terminalSectionCollapsed]: isCollapsed,
	});

	const handleClassName = clsx(styles.terminalResizeHandle, {
		[styles.terminalResizeHandleDragging]: isDragging,
	});

	const paneStyle = isCollapsed
		? { height: 0, padding: 0 }
		: { height, padding: 8 };

	return (
		<section
			id="terminalSection"
			className={sectionClassName}
			aria-label="Playground terminal"
		>
			<div
				id="terminalResizeHandle"
				className={handleClassName}
				role="separator"
				aria-orientation="horizontal"
				aria-label="Resize terminal"
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={endResize}
				onPointerCancel={endResize}
			/>
			<header
				className={styles.terminalHeader}
				onClick={toggleCollapse}
				aria-expanded={!isCollapsed}
			>
				Terminal
			</header>
			<div
				id="terminalPane"
				className={styles.terminalPane}
				style={paneStyle}
			>
				<div
					ref={terminalContainerRef}
					id="terminal"
					className={styles.terminal}
				/>
			</div>
		</section>
	);
};
