import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import css from './style.module.css';
import 'xterm/css/xterm.css';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { splitShellCommand } from '@php-wasm/util';
import type { StreamedPHPResponse } from '@php-wasm/universal';
import { Icon } from '@wordpress/components';
import { close } from '@wordpress/icons';
import {
	getActiveClientInfo,
	useAppDispatch,
	useAppSelector,
} from '../../lib/state/redux/store';
import { setWpCliConsoleOpen } from '../../lib/state/redux/slice-ui';

const WP_CLI_PATH = '/tmp/wp-cli.phar';
const WP_CLI_URL = 'https://playground.wordpress.net/wp-cli.phar';
const DEFAULT_PANEL_HEIGHT = 360;
const MIN_PANEL_HEIGHT = 220;
const PANEL_MARGIN = 72;

function writeTerminalText(term: Terminal, text: string) {
	term.write(text.replace(/\r?\n/g, '\r\n'));
}

async function writeStreamToTerminal(
	term: Terminal,
	reader: ReadableStreamDefaultReader<Uint8Array>,
	isAborted = () => false
) {
	const decoder = new TextDecoder();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			writeTerminalText(term, decoder.decode(value, { stream: true }));
		}
		const tail = decoder.decode();
		if (tail) {
			writeTerminalText(term, tail);
		}
	} catch (error) {
		if (!isAborted()) {
			throw error;
		}
	} finally {
		reader.releaseLock();
	}
}

export function WpCliConsole() {
	const isOpen = useAppSelector((state) => state.ui.wpCliConsoleIsOpen);
	const clientInfo = useAppSelector(getActiveClientInfo);
	const playground = clientInfo?.client;
	const dispatch = useAppDispatch();

	const wrapperRef = useRef<HTMLDivElement>(null);
	const terminalContainer = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal>();
	const fitAddonRef = useRef<FitAddon>();
	const isRunningCommand = useRef(false);
	const currentProcess = useRef<{ terminate: () => Promise<void> } | null>(
		null
	);
	const history = useRef<string[]>([]);
	const currentHistoryEntry = useRef(-1);
	const [downloading, setDownloading] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState<number>();
	const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);

	const closeConsole = useCallback(() => {
		dispatch(setWpCliConsoleOpen(false));
	}, [dispatch]);

	const fitTerminal = useCallback(() => {
		requestAnimationFrame(() => {
			fitAddonRef.current?.fit();
		});
	}, []);

	const ensureWpCli = useCallback(async () => {
		if (!playground) {
			return;
		}
		await playground.isReady();
		if (await playground.fileExists(WP_CLI_PATH)) {
			return;
		}
		setDownloading(true);
		setDownloadProgress(undefined);
		try {
			const response = await fetch(WP_CLI_URL);
			if (!response.ok) {
				throw new Error(
					`Failed to download WP-CLI: ${response.status} ${response.statusText}`
				);
			}
			const total = Number(response.headers.get('content-length')) || 0;
			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('Failed to read WP-CLI download stream.');
			}
			const chunks: Uint8Array[] = [];
			let received = 0;
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				chunks.push(value);
				received += value.length;
				if (total) {
					setDownloadProgress(received / total);
				}
			}
			const wpCli = new Uint8Array(received);
			let offset = 0;
			for (const chunk of chunks) {
				wpCli.set(chunk, offset);
				offset += chunk.length;
			}
			await playground.writeFile(WP_CLI_PATH, wpCli);
		} finally {
			setDownloading(false);
			setDownloadProgress(undefined);
		}
	}, [playground]);

	const runWpCli = useCallback(
		async (args: string[]) => {
			if (!playground || !terminalRef.current) {
				return;
			}
			const term = terminalRef.current;
			await ensureWpCli();
			await playground.isReady();
			const documentRoot = await playground.documentRoot;
			const response = (await playground.cli([
				'php',
				WP_CLI_PATH,
				`--path=${documentRoot}`,
				...args,
			])) as StreamedPHPResponse & {
				terminate?: () => Promise<void> | void;
			};

			let aborted = false;
			const stdoutReader = response.stdout.getReader();
			const stderrReader = response.stderr.getReader();
			const activeProcess = {
				async terminate() {
					if (aborted) {
						return;
					}
					aborted = true;
					try {
						await stdoutReader.cancel();
					} catch {
						/* ignore termination errors */
					}
					try {
						await stderrReader.cancel();
					} catch {
						/* ignore termination errors */
					}
					if (typeof response.terminate === 'function') {
						try {
							await response.terminate();
						} catch {
							/* ignore termination errors */
						}
					}
				},
			};
			currentProcess.current = activeProcess;

			let exitCode = 0;
			try {
				const stdout = writeStreamToTerminal(
					term,
					stdoutReader,
					() => aborted
				);
				const stderr = writeStreamToTerminal(
					term,
					stderrReader,
					() => aborted
				);
				exitCode = await response.exitCode.catch((error) => {
					if (!aborted) {
						throw error;
					}
					return 130;
				});
				await Promise.all([stdout, stderr]);
			} finally {
				if (currentProcess.current === activeProcess) {
					currentProcess.current = null;
				}
			}
			if (!aborted && exitCode !== 0) {
				writeTerminalText(
					term,
					`\r\nProcess exited with code ${exitCode}`
				);
			}
		},
		[ensureWpCli, playground]
	);

	const abortActiveProcess = useCallback(async () => {
		const process = currentProcess.current;
		if (!process) {
			return;
		}
		try {
			await process.terminate();
		} finally {
			if (currentProcess.current === process) {
				currentProcess.current = null;
			}
		}
	}, []);

	const runCommand = useCallback(
		async (rawCommand: string) => {
			const term = terminalRef.current;
			if (!term) {
				return;
			}
			const trimmedCommand = rawCommand.trim();
			if (trimmedCommand) {
				history.current.unshift(trimmedCommand);
			}
			currentHistoryEntry.current = -1;
			isRunningCommand.current = true;
			try {
				const args = splitShellCommand(trimmedCommand);
				const command = args.shift();
				switch (command) {
					case undefined:
						break;
					case '':
						break;
					case 'clear':
						term.clear();
						break;
					case 'exit':
					case 'quit':
						closeConsole();
						break;
					case 'wp':
						await runWpCli(args);
						break;
					default:
						writeTerminalText(
							term,
							`${command}: command not found`
						);
				}
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				writeTerminalText(term, `Error: ${message}`);
			} finally {
				writeTerminalText(term, '\r\n$ ');
				isRunningCommand.current = false;
			}
		},
		[closeConsole, runWpCli]
	);

	useEffect(() => {
		if (!terminalContainer.current || !playground) {
			return;
		}

		const term = new Terminal({
			cursorBlink: true,
			fontFamily:
				'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
			fontSize: 13,
			theme: {
				background: '#0b0f14',
				foreground: '#eef2f8',
			},
		});
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.open(terminalContainer.current);
		fitAddon.fit();

		terminalRef.current = term;
		fitAddonRef.current = fitAddon;
		writeTerminalText(
			term,
			'WP-CLI console. Type `wp help` to get started.\r\n$ '
		);

		let command = '';
		const clearPromptLine = () => {
			term.write('\x1b[2K\r$ ');
		};
		let lastInputChar = '';
		const disposable = term.onData((input) => {
			for (const char of input) {
				if (char === '\u0003') {
					term.write('^C');
					command = '';
					if (isRunningCommand.current) {
						void abortActiveProcess();
					} else {
						writeTerminalText(term, '\r\n$ ');
					}
					lastInputChar = char;
					continue;
				}
				if (isRunningCommand.current) {
					lastInputChar = char;
					continue;
				}
				switch (char) {
					case '\r':
					case '\n':
						if (char === '\n' && lastInputChar === '\r') {
							break;
						}
						writeTerminalText(term, '\r\n');
						void runCommand(command);
						command = '';
						break;
					case '\u007F':
						if (command.length > 0) {
							command = command.slice(0, -1);
							term.write('\b \b');
						}
						break;
					default:
						if (char >= ' ' || char >= '\u00a0') {
							command += char;
							term.write(char);
						}
				}
				lastInputChar = char;
			}
		});

		term.attachCustomKeyEventHandler((event) => {
			if (event.type !== 'keydown' || event.metaKey || event.ctrlKey) {
				return true;
			}
			if (event.code === 'ArrowUp') {
				if (currentHistoryEntry.current < history.current.length - 1) {
					currentHistoryEntry.current += 1;
					command =
						history.current[currentHistoryEntry.current] || '';
					clearPromptLine();
					term.write(command);
				}
				return false;
			}
			if (event.code === 'ArrowDown') {
				if (currentHistoryEntry.current > 0) {
					currentHistoryEntry.current -= 1;
					command =
						history.current[currentHistoryEntry.current] || '';
				} else {
					currentHistoryEntry.current = -1;
					command = '';
				}
				clearPromptLine();
				term.write(command);
				return false;
			}
			return true;
		});

		return () => {
			void currentProcess.current?.terminate();
			disposable.dispose();
			term.dispose();
			terminalRef.current = undefined;
			fitAddonRef.current = undefined;
		};
	}, [playground, runCommand]);

	useEffect(() => {
		if (isOpen) {
			window.setTimeout(() => {
				fitTerminal();
				terminalRef.current?.focus();
			}, 0);
		}
	}, [fitTerminal, isOpen]);

	useEffect(() => {
		fitTerminal();
	}, [fitTerminal, panelHeight]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && isOpen) {
				dispatch(setWpCliConsoleOpen(false));
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [dispatch, isOpen]);

	const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		const panel = wrapperRef.current;
		if (!panel) {
			return;
		}

		const pointerId = event.pointerId;
		const startY = event.clientY;
		const startHeight = panel.getBoundingClientRect().height;
		const maxHeight = Math.max(
			MIN_PANEL_HEIGHT,
			window.innerHeight - PANEL_MARGIN
		);

		const resize = (moveEvent: PointerEvent) => {
			if (moveEvent.pointerId !== pointerId) {
				return;
			}
			setPanelHeight(
				Math.min(
					maxHeight,
					Math.max(
						MIN_PANEL_HEIGHT,
						startHeight + moveEvent.clientY - startY
					)
				)
			);
		};

		const stopResize = (upEvent: PointerEvent) => {
			if (upEvent.pointerId !== pointerId) {
				return;
			}
			window.removeEventListener('pointermove', resize);
			window.removeEventListener('pointerup', stopResize);
			window.removeEventListener('pointercancel', stopResize);
			fitTerminal();
		};

		window.addEventListener('pointermove', resize);
		window.addEventListener('pointerup', stopResize);
		window.addEventListener('pointercancel', stopResize);
	};

	if (!playground) {
		return null;
	}

	return (
		<div
			aria-label="WP-CLI console"
			className={`${css.wrapper} ${isOpen ? css.open : ''}`}
			ref={wrapperRef}
			role="region"
			style={
				{ '--wp-cli-panel-height': `${panelHeight}px` } as CSSProperties
			}
		>
			<header className={css.header}>
				<div>
					<h2 className={css.title}>WP-CLI</h2>
					<p className={css.description}>
						Run commands against the active Playground site.
					</p>
					<p className={css.hint}>
						Try `wp help`, `wp plugin list`, or `wp option get
						home`.
					</p>
				</div>
				<button
					aria-label="Close WP-CLI console"
					className={css.closeButton}
					onClick={closeConsole}
					type="button"
				>
					<Icon icon={close} size={18} />
				</button>
			</header>
			{downloading && (
				<progress
					className={css.progress}
					value={downloadProgress}
					max={1}
				/>
			)}
			<div className={css.terminal} ref={terminalContainer} />
			<button
				aria-label="Resize WP-CLI console"
				className={css.resizeHandle}
				onPointerDown={startResize}
				type="button"
			/>
		</div>
	);
}

export default WpCliConsole;
