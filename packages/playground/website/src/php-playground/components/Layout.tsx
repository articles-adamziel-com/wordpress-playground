import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import type { PlaygroundClient } from '@wp-playground/client';

import styles from './layout.module.css';
import { Controls } from './Controls';
import { EditorHost } from './EditorHost';
import { HelpModal } from './HelpModal';
import PlaygroundFilePickerTree, {
	type PlaygroundFilePickerTreeRef,
} from './PlaygroundFilePickerTree';
import { PlaygroundManager } from './PlaygroundManager';
import { Terminal } from './Terminal';
import { useAppDispatch, useAppSelector } from '../hooks';
import { setCode, setCurrentPath } from '../store';
import AddressBar from '../../components/address-bar';

const DEFAULT_WORKSPACE_DIR = '/wordpress/workspace';
const MAX_INLINE_BYTES = 1024 * 1024; // 1MB

const normalizeFsPath = (path: string) => {
	if (!path) {
		return '/';
	}
	let normalized = path.replace(/\\+/g, '/');
	if (!normalized.startsWith('/')) {
		normalized = `/${normalized}`;
	}
	normalized = normalized.replace(/\/{2,}/g, '/');
	if (normalized.length > 1 && normalized.endsWith('/')) {
		normalized = normalized.slice(0, -1);
	}
	return normalized || '/';
};

const dirnameSafe = (path: string) => {
	const normalized = normalizeFsPath(path);
	if (normalized === '/') {
		return '/';
	}
	const index = normalized.lastIndexOf('/');
	return index <= 0 ? '/' : normalized.slice(0, index);
};

// removed legacy prompt-based helpers in favor of inline rename flow

// validation handled in tree component

const isProbablyTextBuffer = (buffer: Uint8Array) => {
	// Fast null-byte check
	const len = buffer.byteLength;
	for (let i = 0; i < Math.min(len, 4096); i++) {
		if (buffer[i] === 0) {
			return false;
		}
	}
	// UTF-8 validation
	try {
		new TextDecoder('utf-8', { fatal: true }).decode(buffer);
		return true;
	} catch {
		return false;
	}
};

const createDownloadUrl = (data: Uint8Array, filename: string) => {
	const blob = new Blob([data]);
	const url = URL.createObjectURL(blob);
	// Best-effort cleanup later
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
	return { url, filename };
};

export const Layout = () => {
	const [isHelpOpen, setHelpOpen] = useState(false);
	const [isTerminalCollapsed, setTerminalCollapsed] = useState(false);
	const [terminalResizeToken, setTerminalResizeToken] = useState(0);
	const terminalPanelRef = useRef<ImperativePanelHandle | null>(null);
	const treeRef = useRef<PlaygroundFilePickerTreeRef | null>(null);
	const playgroundClient = useAppSelector((state) => state.playground.client);
	const bootStatus = useAppSelector((state) => state.playground.bootStatus);
	const currentPath = useAppSelector((state) => state.playground.currentPath);
	const [previewUrl, setPreviewUrl] = useState('');
	const [renamingPath, setRenamingPath] = useState<string | null>(null);
	const [selectedDirPath, setSelectedDirPath] = useState<string | null>(
		DEFAULT_WORKSPACE_DIR
	);
	const [forceSelectedPath, setForceSelectedPath] = useState<string | null>(
		null
	);

	const dispatch = useAppDispatch();

	useEffect(() => {
		const previousTitle = document.title;
		document.title = 'WordPress PHP Playground';
		return () => {
			document.title = previousTitle;
		};
	}, []);

	useEffect(() => {
		if (!isHelpOpen) {
			return;
		}
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [isHelpOpen]);

	useEffect(() => {
		if (!playgroundClient) {
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const url = await playgroundClient.getCurrentURL();
				if (!cancelled) setPreviewUrl(url || '');
			} catch (e) {
				void e;
			}
			try {
				await playgroundClient.onNavigation((url) => {
					setPreviewUrl(url);
				});
			} catch (e) {
				void e;
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [playgroundClient]);

	const handleOpenHelp = useCallback(() => setHelpOpen(true), []);
	const handleCloseHelp = useCallback(() => setHelpOpen(false), []);

	const handleAfterDelete = useCallback(
		(path: string, type: 'file' | 'folder') => {
			const normalized = normalizeFsPath(path);
			if (
				currentPath &&
				(currentPath === normalized ||
					currentPath.startsWith(`${normalized}/`))
			) {
				dispatch(setCode(''));
				dispatch(setCurrentPath(null));
			}
			if (
				selectedDirPath &&
				(selectedDirPath === normalized ||
					selectedDirPath.startsWith(`${normalized}/`))
			) {
				setSelectedDirPath(dirnameSafe(normalized));
			}
			setRenamingPath(null);
			setForceSelectedPath(dirnameSafe(normalized));
		},
		[currentPath, selectedDirPath, dispatch]
	);

	const handleAfterRename = useCallback(
		async (oldPath: string, newPath: string, type: 'file' | 'folder') => {
			if (!playgroundClient) return;
			try {
				if (type === 'file') {
					const newContent = await playgroundClient.readFileAsText(
						newPath
					);
					dispatch(setCode(newContent));
					dispatch(setCurrentPath(newPath));
				} else if (currentPath === oldPath) {
					dispatch(setCurrentPath(newPath));
				}
			} catch (e) {
				void e;
			}
		},
		[playgroundClient, currentPath, dispatch]
	);

	const treeInitialPath = normalizeFsPath(
		renamingPath ??
			forceSelectedPath ??
			selectedDirPath ??
			(currentPath ? dirnameSafe(currentPath) : DEFAULT_WORKSPACE_DIR)
	);

	return (
		<div id="php-playground-react-root" className={styles.root}>
			<PlaygroundManager />
			<PanelGroup direction="horizontal" id="app" className={styles.app}>
				<>
					<Panel minSize={5} collapsible>
						<div className={styles.editorPane}>
							{bootStatus === 'ready' && playgroundClient ? (
								<div className={styles.fileExplorerContainer}>
									<div className={styles.fileExplorerHeader}>
										<span
											className={styles.fileExplorerTitle}
										>
											Files
										</span>
										<div
											className={
												styles.fileExplorerActions
											}
										>
											<button
												className={
													styles.fileExplorerButton
												}
												onClick={() =>
													treeRef.current?.createFile()
												}
												title="Create new file"
												disabled={!playgroundClient}
											>
												New File
											</button>
											<button
												className={
													styles.fileExplorerButton
												}
												onClick={() =>
													treeRef.current?.createFolder()
												}
												title="Create new folder"
												disabled={!playgroundClient}
											>
												New Folder
											</button>
										</div>
									</div>
									<div className={styles.fileExplorerTree}>
										<PlaygroundFilePickerTree
											ref={treeRef}
											playgroundClient={playgroundClient}
											root="/"
											initialPath={treeInitialPath}
											excludePaths={[
												'/dev',
												'/internal',
												'/proc',
												'/request',
											]}
											onSelect={async (path) => {
												setForceSelectedPath(null);
												if (
													await playgroundClient.isDir(
														path
													)
												) {
													setSelectedDirPath(path);
													return;
												}
												try {
													const data =
														await playgroundClient.readFileAsBuffer(
															path
														);
													const size =
														data.byteLength;
													if (
														size > MAX_INLINE_BYTES
													) {
														const {
															url,
															filename,
														} = createDownloadUrl(
															data,
															path
																.split('/')
																.pop() ||
																'download'
														);
														dispatch(
															setCode(
																`File too large to open (>1MB)\nDownload: ${url}\nFilename: ${filename}`
															)
														);
														dispatch(
															setCurrentPath(null)
														);
														setSelectedDirPath(
															dirnameSafe(path)
														);
														return;
													}
													if (
														!isProbablyTextBuffer(
															data
														)
													) {
														const {
															url,
															filename,
														} = createDownloadUrl(
															data,
															path
																.split('/')
																.pop() ||
																'download'
														);
														dispatch(
															setCode(
																`binary file. can't edit (download): ${url}\nFilename: ${filename}`
															)
														);
														dispatch(
															setCurrentPath(null)
														);
														setSelectedDirPath(
															dirnameSafe(path)
														);
														return;
													}
													const text =
														new TextDecoder(
															'utf-8'
														).decode(data);
													dispatch(setCode(text));
													dispatch(
														setCurrentPath(path)
													);
													setSelectedDirPath(
														dirnameSafe(path)
													);
												} catch {
													dispatch(
														setCode(
															'Could not open file'
														)
													);
													dispatch(
														setCurrentPath(null)
													);
													setSelectedDirPath(
														dirnameSafe(path)
													);
												}
											}}
											renamingPath={renamingPath}
											onAfterDelete={handleAfterDelete}
											onAfterRename={handleAfterRename}
										/>
									</div>
								</div>
							) : null}
						</div>
					</Panel>
					<PanelResizeHandle className={styles.horizontalHandle} />
				</>
				<Panel minSize={40}>
					<div className={styles.editorPane}>
						<Controls onHelpClick={handleOpenHelp} />
						<PanelGroup
							direction="vertical"
							className={styles.editorSplitGroup}
						>
							<Panel
								defaultSize={60}
								minSize={30}
								style={{ overflow: 'auto' }}
							>
								<div className={styles.editorContent}>
									{currentPath && (
										<div
											className={styles.filePathBar}
											title={currentPath}
										>
											<span
												className={styles.filePathText}
											>
												{currentPath}
											</span>
										</div>
									)}
									<EditorHost />
								</div>
							</Panel>
							<PanelResizeHandle
								className={styles.verticalHandle}
							/>
							<Panel
								ref={terminalPanelRef}
								minSize={15}
								collapsible
								onCollapse={() => setTerminalCollapsed(true)}
								onExpand={() => setTerminalCollapsed(false)}
								onResize={() =>
									setTerminalResizeToken((token) => token + 1)
								}
								className={styles.terminalPanel}
							>
								<section
									id="terminalSection"
									className={clsx(styles.terminalSection, {
										[styles.terminalSectionCollapsed]:
											isTerminalCollapsed,
									})}
									aria-label="Playground terminal"
								>
									<div className={styles.terminalPane}>
										<Terminal
											isCollapsed={isTerminalCollapsed}
											resizeToken={terminalResizeToken}
										/>
									</div>
								</section>
							</Panel>
						</PanelGroup>
					</div>
				</Panel>
				<PanelResizeHandle className={styles.horizontalHandle} />
				<Panel minSize={15}>
					<div id="previewPane" className={styles.previewPane}>
						{bootStatus === 'ready' && playgroundClient ? (
							<div style={{ padding: '6px 8px' }}>
								<AddressBar
									url={previewUrl}
									onUpdate={(newUrl) =>
										playgroundClient.goTo(newUrl)
									}
								/>
							</div>
						) : null}
						<iframe
							id="preview"
							title="WordPress Playground"
							className={styles.preview}
						/>
					</div>
				</Panel>
			</PanelGroup>
			<HelpModal isOpen={isHelpOpen} onRequestClose={handleCloseHelp} />
		</div>
	);
};
