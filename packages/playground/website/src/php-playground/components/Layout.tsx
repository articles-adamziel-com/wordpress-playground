import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import type { PlaygroundClient } from '@wp-playground/client';

import styles from './layout.module.css';
import { Controls } from './Controls';
import { EditorHost } from './EditorHost';
import { HelpModal } from './HelpModal';
import PlaygroundFilePickerTree from './PlaygroundFilePickerTree';
import { PlaygroundManager } from './PlaygroundManager';
import { Terminal } from './Terminal';
import { useAppDispatch, useAppSelector } from '../hooks';
import { setCode, setCurrentPath } from '../store';
import AddressBar from '../../components/address-bar';

const DEFAULT_WORKSPACE_DIR = '/wordpress/workspace';

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

export const Layout = () => {
	const [isHelpOpen, setHelpOpen] = useState(false);
	const [isTerminalCollapsed, setTerminalCollapsed] = useState(false);
	const [terminalResizeToken, setTerminalResizeToken] = useState(0);
	const [fileTreeRefreshToken, setFileTreeRefreshToken] = useState(0);
	const terminalPanelRef = useRef<ImperativePanelHandle | null>(null);
	const playgroundClient = useAppSelector((state) => state.playground.client);
	const bootStatus = useAppSelector((state) => state.playground.bootStatus);
	const currentPath = useAppSelector((state) => state.playground.currentPath);
	const [previewUrl, setPreviewUrl] = useState('');
	const navigationClientRef = useRef<PlaygroundClient | null>(null);
	const [renamingPath, setRenamingPath] = useState<string | null>(null);
	const [selectedDirPath, setSelectedDirPath] = useState<string | null>(null);
	const pendingCreateRef = useRef<{
		type: 'file' | 'folder';
		tempPath: string;
	} | null>(null);

	const dispatch = useAppDispatch();

	// getBaseName not used in this component

	const findAvailableName = useCallback(
		async (client: PlaygroundClient, baseDir: string, baseName: string) => {
			let name = baseName;
			let counter = 0;
			const splitExt = (n: string) => {
				const dot = n.lastIndexOf('.');
				if (dot > 0) {
					return { stem: n.slice(0, dot), ext: n.slice(dot) };
				}
				return { stem: n, ext: '' };
			};
			while (
				await client.fileExists(`${baseDir}/${name}`).catch(() => false)
			) {
				counter += 1;
				const { stem, ext } = splitExt(baseName);
				name = `${stem} (${counter})${ext}`;
			}
			return name;
		},
		[]
	);

	const ensureParentExpandedPath = useCallback(
		(path: string) => {
			const parent = dirnameSafe(path);
			dispatch(setCurrentPath(parent));
			setSelectedDirPath(parent);
		},
		[dispatch]
	);

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
		// Avoid registering multiple onNavigation handlers for the same client
		if (navigationClientRef.current === playgroundClient) {
			return;
		}
		navigationClientRef.current = playgroundClient;
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

	const handleTreeRefresh = useCallback(() => {
		setFileTreeRefreshToken((token) => token + 1);
	}, []);

	const handleCreateFile = useCallback(async () => {
		if (!playgroundClient) {
			return;
		}
		const baseDir = selectedDirPath
			? normalizeFsPath(selectedDirPath)
			: currentPath
			? dirnameSafe(currentPath)
			: DEFAULT_WORKSPACE_DIR;
		const normalizedBase = normalizeFsPath(baseDir);
		try {
			const name = await findAvailableName(
				playgroundClient,
				normalizedBase,
				'untitled'
			);
			const tempPath = `${
				normalizedBase === '/' ? '' : normalizedBase
			}/${name}`;
			await playgroundClient.writeFile(tempPath, '');
			pendingCreateRef.current = { type: 'file', tempPath };
			setRenamingPath(tempPath);
			ensureParentExpandedPath(tempPath);
			handleTreeRefresh();
		} catch (e) {
			void e;
		}
	}, [
		playgroundClient,
		currentPath,
		selectedDirPath,
		findAvailableName,
		ensureParentExpandedPath,
		handleTreeRefresh,
	]);

	const handleCreateDirectory = useCallback(async () => {
		if (!playgroundClient) {
			return;
		}
		const baseDir = selectedDirPath
			? normalizeFsPath(selectedDirPath)
			: currentPath
			? dirnameSafe(currentPath)
			: DEFAULT_WORKSPACE_DIR;
		const normalizedBase = normalizeFsPath(baseDir);
		try {
			const name = await findAvailableName(
				playgroundClient,
				normalizedBase,
				'New Folder'
			);
			const tempPath = `${
				normalizedBase === '/' ? '' : normalizedBase
			}/${name}`;
			await playgroundClient.mkdir(tempPath);
			pendingCreateRef.current = { type: 'folder', tempPath };
			setRenamingPath(tempPath);
			ensureParentExpandedPath(tempPath);
			handleTreeRefresh();
		} catch (e) {
			void e;
		}
	}, [
		playgroundClient,
		currentPath,
		selectedDirPath,
		findAvailableName,
		ensureParentExpandedPath,
		handleTreeRefresh,
	]);

	const handleRenameSubmit = useCallback(
		async (path: string, newName: string) => {
			if (!playgroundClient || !pendingCreateRef.current) {
				setRenamingPath(null);
				return;
			}
			const parent = dirnameSafe(path);
			const sanitized = (newName || '').trim();
			if (
				!sanitized ||
				sanitized.includes('/') ||
				sanitized === '.' ||
				sanitized === '..'
			) {
				// Treat invalid name as cancel
				try {
					if (pendingCreateRef.current.type === 'folder') {
						await playgroundClient.rmdir(path, {
							recursive: true,
						} as any);
					} else {
						await playgroundClient.unlink(path);
					}
				} catch (e) {
					void e;
				}
				setRenamingPath(null);
				pendingCreateRef.current = null;
				handleTreeRefresh();
				return;
			}

			let finalName = sanitized;
			const splitExt = (n: string) => {
				const dot = n.lastIndexOf('.');
				if (dot > 0) {
					return { stem: n.slice(0, dot), ext: n.slice(dot) };
				}
				return { stem: n, ext: '' };
			};
			let candidate = `${parent === '/' ? '' : parent}/${finalName}`;
			if (
				await playgroundClient.fileExists(candidate).catch(() => false)
			) {
				const { stem, ext } = splitExt(finalName);
				let counter = 1;
				while (
					await playgroundClient
						.fileExists(
							`${
								parent === '/' ? '' : parent
							}/${stem} (${counter})${ext}`
						)
						.catch(() => false)
				) {
					counter += 1;
				}
				finalName = `${stem} (${counter})${ext}`;
				candidate = `${parent === '/' ? '' : parent}/${finalName}`;
			}

			try {
				await playgroundClient.mv(path, candidate as any);
				if (pendingCreateRef.current.type === 'file') {
					try {
						const newContent =
							await playgroundClient.readFileAsText(candidate);
						dispatch(setCode(newContent));
						dispatch(setCurrentPath(candidate));
					} catch (e) {
						void e;
					}
				}
			} catch (e) {
				void e;
				// If rename fails, try to clean up temp
				try {
					if (pendingCreateRef.current.type === 'folder') {
						await playgroundClient.rmdir(path, {
							recursive: true,
						} as any);
					} else {
						await playgroundClient.unlink(path);
					}
				} catch (cleanupError) {
					void cleanupError;
				}
			}
			setRenamingPath(null);
			pendingCreateRef.current = null;
			handleTreeRefresh();
		},
		[playgroundClient, dispatch, handleTreeRefresh]
	);

	const handleRenameCancel = useCallback(
		async (path: string) => {
			if (!playgroundClient || !pendingCreateRef.current) {
				setRenamingPath(null);
				return;
			}
			try {
				if (pendingCreateRef.current.type === 'folder') {
					await playgroundClient.rmdir(path, {
						recursive: true,
					} as any);
				} else {
					await playgroundClient.unlink(path);
				}
			} catch (e) {
				void e;
			}
			setRenamingPath(null);
			pendingCreateRef.current = null;
			handleTreeRefresh();
		},
		[playgroundClient, handleTreeRefresh]
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
												onClick={handleCreateFile}
												title="Create new file"
												disabled={!playgroundClient}
											>
												New File
											</button>
											<button
												className={
													styles.fileExplorerButton
												}
												onClick={handleCreateDirectory}
												title="Create new folder"
												disabled={!playgroundClient}
											>
												New Folder
											</button>
										</div>
									</div>
									<div className={styles.fileExplorerTree}>
										<PlaygroundFilePickerTree
											playgroundClient={playgroundClient}
											root="/"
											initialPath={
												renamingPath
													? dirnameSafe(renamingPath)
													: selectedDirPath
													? selectedDirPath
													: currentPath
													? dirnameSafe(currentPath)
													: DEFAULT_WORKSPACE_DIR
											}
											excludePaths={[
												'/dev',
												'/internal',
												'/proc',
												'/request',
											]}
											onSelect={async (path) => {
												if (
													await playgroundClient.isDir(
														path
													)
												) {
													setSelectedDirPath(path);
													return;
												}
												const text =
													await playgroundClient.readFileAsText(
														path
													);
												if (text.length > 1024 * 1024) {
													dispatch(
														setCode(
															'File too large to be edited'
														)
													);
													dispatch(
														setCurrentPath(null)
													);
												} else {
													dispatch(setCode(text));
													dispatch(
														setCurrentPath(path)
													);
													setSelectedDirPath(
														dirnameSafe(path)
													);
												}
											}}
											renamingPath={renamingPath}
											onRename={(path, newName) => {
												void handleRenameSubmit(
													path,
													newName
												);
											}}
											onRenameCancel={(path) => {
												void handleRenameCancel(path);
											}}
											refreshToken={fileTreeRefreshToken}
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
