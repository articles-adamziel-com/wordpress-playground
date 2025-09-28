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
import type { FileNode } from '@wp-playground/components';
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

const isValidNameSegment = (name: string) => {
	if (!name) {
		return false;
	}
	if (name === '.' || name === '..') {
		return false;
	}
	return !/[\\/]/.test(name);
};

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
	const playgroundClient = useAppSelector((state) => state.playground.client);
	const bootStatus = useAppSelector((state) => state.playground.bootStatus);
	const currentPath = useAppSelector((state) => state.playground.currentPath);
	const [previewUrl, setPreviewUrl] = useState('');
	const navigationClientRef = useRef<PlaygroundClient | null>(null);
	const [renamingPath, setRenamingPath] = useState<string | null>(null);
	const [selectedDirPath, setSelectedDirPath] = useState<string | null>(
		DEFAULT_WORKSPACE_DIR
	);
	const [forceSelectedPath, setForceSelectedPath] = useState<string | null>(
		null
	);
	const pendingCreateRef = useRef<{
		type: 'file' | 'folder';
		tempPath: string;
	} | null>(null);
	const [contextMenu, setContextMenu] = useState<{
		path: string;
		type: 'file' | 'folder';
		x: number;
		y: number;
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
			const prefix = baseDir === '/' ? '' : baseDir;
			while (
				(await client
					.fileExists(`${prefix}/${name}`)
					.catch(() => false)) ||
				(await client.isDir(`${prefix}/${name}`).catch(() => false))
			) {
				counter += 1;
				const { stem, ext } = splitExt(baseName);
				name = `${stem} (${counter})${ext}`;
			}
			return name;
		},
		[]
	);

	const ensureParentExpandedPath = useCallback((path: string) => {
		const parent = dirnameSafe(path);
		setSelectedDirPath(parent);
	}, []);

	useEffect(() => {
		const previousTitle = document.title;
		document.title = 'WordPress PHP Playground';
		return () => {
			document.title = previousTitle;
		};
	}, []);

	useEffect(() => {
		if (!contextMenu) {
			return;
		}
		const handleClose = () => setContextMenu(null);
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				handleClose();
			}
		};
		window.addEventListener('click', handleClose);
		window.addEventListener('contextmenu', handleClose);
		window.addEventListener('keydown', handleKey);
		return () => {
			window.removeEventListener('click', handleClose);
			window.removeEventListener('contextmenu', handleClose);
			window.removeEventListener('keydown', handleKey);
		};
	}, [contextMenu]);

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
				'untitled.php'
			);
			const tempPath = `${
				normalizedBase === '/' ? '' : normalizedBase
			}/${name}`;
			await playgroundClient.writeFile(tempPath, '');
			pendingCreateRef.current = { type: 'file', tempPath };
			setRenamingPath(tempPath);
			setForceSelectedPath(tempPath);
			ensureParentExpandedPath(tempPath);
			setSelectedDirPath(dirnameSafe(tempPath));
			setContextMenu(null);
		} catch (e) {
			void e;
		}
	}, [
		playgroundClient,
		currentPath,
		selectedDirPath,
		findAvailableName,
		ensureParentExpandedPath,
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
			setForceSelectedPath(tempPath);
			ensureParentExpandedPath(tempPath);
			setSelectedDirPath(tempPath);
			setContextMenu(null);
		} catch (e) {
			void e;
		}
	}, [
		playgroundClient,
		currentPath,
		selectedDirPath,
		findAvailableName,
		ensureParentExpandedPath,
	]);

	const handleRenameSubmit = useCallback(
		async (path: string, newName: string) => {
			if (!playgroundClient) {
				return;
			}
			const pending = pendingCreateRef.current;
			const isPending = pending?.tempPath === path;
			const parent = dirnameSafe(path);
			const sanitized = (newName || '').trim();
			if (!isValidNameSegment(sanitized)) {
				if (isPending) {
					try {
						if (pending.type === 'folder') {
							await playgroundClient.rmdir(path, {
								recursive: true,
							} as any);
						} else {
							await playgroundClient.unlink(path);
						}
					} catch (e) {
						void e;
					}
					pendingCreateRef.current = null;
				}
				setRenamingPath(isPending ? null : path);
				return;
			}

			const composePath = (name: string) =>
				parent === '/' ? `/${name}` : `${parent}/${name}`;
			const finalName = sanitized;
			let candidate = composePath(finalName);
			const candidateNormalized = normalizeFsPath(candidate);
			if (candidateNormalized === path) {
				setRenamingPath(null);
				if (isPending) {
					pendingCreateRef.current = null;
				}
				setForceSelectedPath(candidateNormalized);
				return;
			}

			const exists = await playgroundClient
				.fileExists(candidateNormalized)
				.catch(() => false);
			const existsDir = await playgroundClient
				.isDir(candidateNormalized)
				.catch(() => false);
			if ((exists || existsDir) && candidateNormalized !== path) {
				if (isPending) {
					try {
						const unique = await findAvailableName(
							playgroundClient,
							parent === '/' ? '/' : parent,
							finalName
						);
						candidate = composePath(unique);
					} catch (e) {
						void e;
					}
				} else {
					setRenamingPath(path);
					return;
				}
			}

			let candidateIsDir = pending?.type === 'folder';

			try {
				await playgroundClient.mv(path, candidate as any);
				if (pending?.type === 'file') {
					try {
						const newContent =
							await playgroundClient.readFileAsText(candidate);
						dispatch(setCode(newContent));
						dispatch(setCurrentPath(candidate));
					} catch (e) {
						void e;
					}
				} else if (!pending) {
					const isDir = await playgroundClient
						.isDir(candidate as any)
						.catch(() => false);
					candidateIsDir = isDir;
					if (!isDir) {
						try {
							const newContent =
								await playgroundClient.readFileAsText(
									candidate
								);
							dispatch(setCode(newContent));
							dispatch(setCurrentPath(candidate));
						} catch {
							// Ignore failure
						}
					} else if (currentPath === path) {
						dispatch(setCurrentPath(candidate));
					}
				}
				setForceSelectedPath(candidate);
				setSelectedDirPath(
					candidateIsDir ? candidate : dirnameSafe(candidate)
				);
			} catch {
				if (isPending) {
					try {
						if (pending?.type === 'folder') {
							await playgroundClient.rmdir(path, {
								recursive: true,
							} as any);
						} else {
							await playgroundClient.unlink(path);
						}
					} catch {
						// Ignore failure
					}
				}
			} finally {
				pendingCreateRef.current = null;
				setRenamingPath(null);
			}
		},
		[playgroundClient, findAvailableName, dispatch, currentPath]
	);

	const handleRenameCancel = useCallback(
		async (path: string) => {
			const pending = pendingCreateRef.current;
			setContextMenu(null);
			if (!playgroundClient || pending?.tempPath !== path) {
				setRenamingPath(null);
				return;
			}
			try {
				if (pending.type === 'folder') {
					await playgroundClient.rmdir(path, {
						recursive: true,
					} as any);
				} else {
					await playgroundClient.unlink(path);
				}
			} catch (e) {
				void e;
			}
			pendingCreateRef.current = null;
			setRenamingPath(null);
			setForceSelectedPath(null);
			setSelectedDirPath((prev) => {
				if (!prev) {
					return prev;
				}
				const normalized = normalizeFsPath(path);
				if (prev === normalized || prev.startsWith(`${normalized}/`)) {
					return dirnameSafe(normalized);
				}
				return prev;
			});
		},
		[playgroundClient]
	);

	const handleContextMenuRename = useCallback(
		(path: string) => {
			pendingCreateRef.current = null;
			setContextMenu(null);
			setRenamingPath(path);
			setForceSelectedPath(path);
			setSelectedDirPath(dirnameSafe(path));
			ensureParentExpandedPath(path);
		},
		[ensureParentExpandedPath]
	);

	const handleDeletePath = useCallback(
		async (targetPath: string, type: 'file' | 'folder') => {
			if (!playgroundClient) {
				return;
			}
			const normalized = normalizeFsPath(targetPath);
			setContextMenu(null);
			try {
				if (type === 'folder') {
					await playgroundClient.rmdir(normalized, {
						recursive: true,
					} as any);
				} else {
					await playgroundClient.unlink(normalized);
				}
			} catch {
				// Ignore failure
			}
			if (pendingCreateRef.current?.tempPath === normalized) {
				pendingCreateRef.current = null;
			}
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
		[playgroundClient, currentPath, selectedDirPath, dispatch]
	);

	const handleDownloadPath = useCallback(
		async (targetPath: string) => {
			if (!playgroundClient) {
				return;
			}
			setContextMenu(null);
			try {
				const content = await playgroundClient.readFileAsText(
					targetPath
				);
				const blob = new Blob([content], {
					type: 'text/plain;charset=utf-8',
				});
				const url = URL.createObjectURL(blob);
				const link = document.createElement('a');
				link.href = url;
				link.download =
					normalizeFsPath(targetPath).split('/').pop() || 'template';
				document.body.appendChild(link);
				link.click();
				link.remove();
				URL.revokeObjectURL(url);
			} catch {
				// Ignore failure
			}
		},
		[playgroundClient]
	);

	const handleTreeContextMenu = useCallback(
		(event: React.MouseEvent, node: FileNode, path: string) => {
			event.preventDefault();
			event.stopPropagation();
			const absolute = normalizeFsPath(path);
			setRenamingPath(null);
			setContextMenu({
				path: absolute,
				type: node.type,
				x: event.clientX,
				y: event.clientY,
			});
		},
		[renamingPath]
	);

	const treeInitialPath = normalizeFsPath(
		renamingPath ??
			forceSelectedPath ??
			selectedDirPath ??
			(currentPath ? dirnameSafe(currentPath) : DEFAULT_WORKSPACE_DIR)
	);

	const contextMenuStyle = contextMenu
		? {
				left:
					typeof window === 'undefined'
						? contextMenu.x
						: Math.min(contextMenu.x, window.innerWidth - 200),
				top:
					typeof window === 'undefined'
						? contextMenu.y
						: Math.min(contextMenu.y, window.innerHeight - 140),
		  }
		: undefined;

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
											initialPath={treeInitialPath}
											excludePaths={[
												'/dev',
												'/internal',
												'/proc',
												'/request',
											]}
											onSelect={async (path) => {
												setContextMenu(null);
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
											onRename={handleRenameSubmit}
											onRenameCancel={handleRenameCancel}
											onContextMenu={
												handleTreeContextMenu
											}
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
			{contextMenu && contextMenuStyle && (
				<div
					className={styles.contextMenu}
					style={contextMenuStyle}
					onClick={(event) => event.stopPropagation()}
					onContextMenu={(event) => event.preventDefault()}
				>
					<button
						className={styles.contextMenuButton}
						onClick={() =>
							handleContextMenuRename(contextMenu.path)
						}
					>
						Rename
					</button>
					<button
						className={clsx(
							styles.contextMenuButton,
							styles.contextMenuButtonDanger
						)}
						onClick={() =>
							handleDeletePath(contextMenu.path, contextMenu.type)
						}
					>
						Delete
					</button>
					{contextMenu.type === 'file' && (
						<button
							className={styles.contextMenuButton}
							onClick={() => handleDownloadPath(contextMenu.path)}
						>
							Download
						</button>
					)}
				</div>
			)}
		</div>
	);
};
