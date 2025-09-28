/* eslint-disable react-hooks/exhaustive-deps */
import React, {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from 'react';
import type { FileNode } from '@wp-playground/components';
import { FilePickerTree as CoreFilePickerTree } from '@wp-playground/components';
import type { PlaygroundClient } from '@wp-playground/client';
import styles from './layout.module.css';
import { useAppDispatch, useAppSelector } from '../hooks';
import { setCode, setCurrentPath } from '../store';

function normalizePath(path: string) {
	if (!path) return '/';
	const normalized =
		('/' + path).replace(/\/+/, '/').replace(/\/+$/, '') || '/';
	return normalized;
}

async function listDir(client: PlaygroundClient, path: string) {
	const names = await client.listFiles(path);
	const results: { name: string; type: 'file' | 'folder' }[] = [];
	for (const name of names) {
		const childPath = path === '/' ? `/${name}` : `${path}/${name}`;
		const isDirectory = await client.isDir(childPath).catch(() => false);
		results.push({ name, type: isDirectory ? 'folder' : 'file' });
	}
	return results.sort((a, b) => {
		if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

function getBaseName(path: string) {
	const p = normalizePath(path);
	if (p === '/') return '/';
	const parts = p.split('/').filter(Boolean);
	return parts[parts.length - 1] || '/';
}

function toCorePath(absPath: string, normalizedRoot: string) {
	const abs = normalizePath(absPath);
	const rootName = getBaseName(normalizedRoot);
	if (abs === normalizedRoot) return rootName;
	if (normalizedRoot === '/') {
		// When root is '/', drop the leading '/'
		return abs === '/' ? '' : abs.slice(1);
	}
	const prefix = normalizedRoot.endsWith('/')
		? normalizedRoot
		: normalizedRoot + '/';
	if (abs.startsWith(prefix)) {
		return rootName + abs.slice(normalizedRoot.length);
	}
	return rootName;
}

function corePathToAbsolute(corePath: string, normalizedRoot: string) {
	const rootName = getBaseName(normalizedRoot);
	if (corePath === rootName) return normalizedRoot;
	if (normalizedRoot === '/') {
		// When root is '/', the incoming core path is relative to '/'
		return normalizePath('/' + corePath);
	}
	const prefix = rootName.endsWith('/') ? rootName : rootName + '/';
	if (corePath.startsWith(prefix)) {
		return normalizePath(normalizedRoot + corePath.slice(rootName.length));
	}
	return normalizedRoot;
}

export interface PlaygroundFilePickerTreeRef {
	createFile: () => void;
	createFolder: () => void;
}

export type PlaygroundFilePickerTreeProps = {
	root?: string;
	initialPath?: string;
	excludePaths?: string[];
	onSelect?: (path: string) => void;
	playgroundClient?: PlaygroundClient;
	renamingPath?: string | null;
	onRename?: (path: string, newName: string) => void;
	onRenameCancel?: (path: string) => void;
	onContextMenu?: (
		event: React.MouseEvent,
		node: FileNode,
		path: string
	) => void;
};

const DEFAULT_WORKSPACE_DIR = '/wordpress/workspace';

const isValidNameSegment = (name: string) => {
	if (!name) {
		return false;
	}
	if (name === '.' || name === '..') {
		return false;
	}
	return !/[\\/]/.test(name);
};

const PlaygroundFilePickerTree = forwardRef<
	PlaygroundFilePickerTreeRef,
	PlaygroundFilePickerTreeProps
>(function PlaygroundFilePickerTree(
	{
		root = '/wordpress',
		initialPath,
		excludePaths,
		onSelect,
		playgroundClient,
		renamingPath,
		onRenameCancel,
		onContextMenu,
	},
	ref
) {
	const normalizedRoot = useMemo(() => normalizePath(root), [root]);
	const rootName = useMemo(
		() => getBaseName(normalizedRoot),
		[normalizedRoot]
	);

	const [files, setFiles] = useState<FileNode[]>([]);
	const [isRootLoading, setIsRootLoading] = useState(false);
	const [contextMenu, setContextMenu] = useState<{
		path: string;
		type: 'file' | 'folder';
		x: number;
		y: number;
	} | null>(null);
	const [localRenamingPath, setLocalRenamingPath] = useState<string | null>(
		null
	);
	const [invalidatePath, setInvalidatePath] = useState<string | null>(null);
	const [invalidateKey, setInvalidateKey] = useState(0);
	const [renameMapping, setRenameMapping] = useState<{
		from: string;
		to: string;
	} | null>(null);
	const [renameKey, setRenameKey] = useState(0);
	const [focusRequestPath, setFocusRequestPath] = useState<string | null>(
		null
	);
	const [focusRequestKey, setFocusRequestKey] = useState(0);
	const [expandRequestPath, setExpandRequestPath] = useState<string | null>(
		null
	);
	const [expandRequestKey, setExpandRequestKey] = useState(0);
	const pendingCreateRef = useRef<{
		type: 'file' | 'folder';
		tempPath: string;
	} | null>(null);
	const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(
		initialPath ?? DEFAULT_WORKSPACE_DIR
	);
	const dispatch = useAppDispatch();
	const currentPath = useAppSelector((state) => state.playground.currentPath);

	const getDirname = useCallback((path: string) => {
		const p = normalizePath(path);
		if (p === '/') return '/';
		const i = p.lastIndexOf('/');
		return i <= 0 ? '/' : p.slice(0, i);
	}, []);

	const getBasename = useCallback((path: string) => {
		const p = normalizePath(path);
		if (p === '/') return '/';
		const i = p.lastIndexOf('/');
		return i < 0 ? p : p.slice(i + 1);
	}, []);

	const prioritizeRenaming = useCallback(
		(
			items: { name: string; type: 'file' | 'folder' }[],
			absDirPath: string
		) => {
			if (!renamingPath) return items;
			const renPath = normalizePath(renamingPath);
			if (getDirname(renPath) !== absDirPath) return items;
			const targetName = getBasename(renPath);
			const idx = items.findIndex((i) => i.name === targetName);
			if (idx === -1) return items;
			const copy = items.slice();
			const [entry] = copy.splice(idx, 1);
			const dirs = copy.filter((i) => i.type === 'folder');
			const filesOnly = copy.filter((i) => i.type === 'file');
			if (entry.type === 'folder') {
				return [entry, ...dirs, ...filesOnly];
			}
			return [...dirs, entry, ...filesOnly];
		},
		[renamingPath, getDirname, getBasename]
	);

	// Track when we need to refresh root files
	const [rootRefreshKey, setRootRefreshKey] = useState(0);

	useEffect(() => {
		let cancelled = false;
		async function init() {
			if (normalizedRoot === '/') {
				setIsRootLoading(true);
				if (!playgroundClient) {
					if (!cancelled) setFiles([]);
					setIsRootLoading(false);
					return;
				}
				const items = await listDir(playgroundClient, '/');
				const filtered = items.filter((item) => {
					const childAbs = `/${item.name}`;
					return !excludePaths?.includes(childAbs);
				});
				const ordered = prioritizeRenaming(filtered, '/');
				if (!cancelled) setFiles(ordered as FileNode[]);
				setIsRootLoading(false);
			} else {
				if (!cancelled)
					setFiles([
						{ name: rootName, type: 'folder' },
					] as FileNode[]);
				setIsRootLoading(false);
			}
		}
		init();
		return () => {
			cancelled = true;
		};
	}, [
		normalizedRoot,
		rootName,
		playgroundClient,
		JSON.stringify(excludePaths),
		rootRefreshKey,
	]);

	const coreInitialPath = useMemo(() => {
		return initialPath
			? toCorePath(initialPath, normalizedRoot)
			: undefined;
	}, [initialPath, normalizedRoot]);

	// Dismiss context menu on outside interactions / ESC key
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

	const handleLoadChildren = useCallback(
		async (corePath: string) => {
			if (!playgroundClient) return [] as FileNode[];
			const absDirPath = corePathToAbsolute(corePath, normalizedRoot);
			const items = await listDir(playgroundClient, absDirPath);
			const filtered = items.filter((item) => {
				const childAbs =
					absDirPath === '/'
						? `/${item.name}`
						: `${absDirPath}/${item.name}`;
				return !excludePaths?.includes(childAbs);
			});
			return prioritizeRenaming(filtered, absDirPath) as FileNode[];
		},
		[playgroundClient, normalizedRoot, excludePaths, prioritizeRenaming]
	);

	const handleSelect = useCallback(
		(path: string) => {
			const normalized = normalizePath(path);
			setLastSelectedPath(normalized);
			if (onSelect) onSelect(normalized);
		},
		[onSelect]
	);

	const effectiveRenamingPath = useMemo(() => {
		return renamingPath ?? localRenamingPath ?? undefined;
	}, [renamingPath, localRenamingPath]);

	const handleInternalContextMenu = useCallback(
		(event: React.MouseEvent, node: FileNode, corePath: string) => {
			event.preventDefault();
			event.stopPropagation();
			const absPath = corePathToAbsolute(corePath, normalizedRoot);
			setLocalRenamingPath(null);
			setContextMenu({
				path: absPath,
				type: node.type,
				x: event.clientX,
				y: event.clientY,
			});
			if (onContextMenu) {
				onContextMenu(event, node, absPath);
			}
		},
		[normalizedRoot, onContextMenu]
	);

	const handleContextMenuRename = useCallback((targetPath: string) => {
		setContextMenu(null);
		setLocalRenamingPath(targetPath);
	}, []);

	// dirname helper not needed in this component

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

	const resolveBaseDir = useCallback(() => {
		if (!lastSelectedPath) return DEFAULT_WORKSPACE_DIR;
		// If selection is a folder, use it; otherwise use its dirname
		return lastSelectedPath;
	}, [lastSelectedPath]);

	const handleCreateFile = useCallback(async () => {
		if (!playgroundClient) {
			return;
		}
		const baseDir = resolveBaseDir() || DEFAULT_WORKSPACE_DIR;
		const normalizedBase = normalizePath(baseDir);
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
			setLocalRenamingPath(tempPath);
			setLastSelectedPath(tempPath);
			setInvalidatePath(normalizedBase);
			setInvalidateKey((k) => k + 1);
			// Ensure the base directory is expanded and focused so the form is visible
			setExpandRequestPath(normalizedBase);
			setExpandRequestKey((k) => k + 1);
			setFocusRequestPath(tempPath);
			setFocusRequestKey((k) => k + 1);
			// Clear requests after a short delay
			setTimeout(() => {
				setExpandRequestPath(null);
				setFocusRequestPath(null);
			}, 100);
		} catch (e) {
			void e;
		}
	}, [playgroundClient, resolveBaseDir, findAvailableName]);

	const handleCreateDirectory = useCallback(async () => {
		if (!playgroundClient) {
			return;
		}
		const baseDir = resolveBaseDir() || DEFAULT_WORKSPACE_DIR;
		const normalizedBase = normalizePath(baseDir);
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
			setLocalRenamingPath(tempPath);
			setLastSelectedPath(tempPath);
			setInvalidatePath(normalizedBase);
			setInvalidateKey((k) => k + 1);
			// Ensure the base directory is expanded and focused so the form is visible
			setExpandRequestPath(normalizedBase);
			setExpandRequestKey((k) => k + 1);
			setFocusRequestPath(tempPath);
			setFocusRequestKey((k) => k + 1);
			// Clear requests after a short delay
			setTimeout(() => {
				setExpandRequestPath(null);
				setFocusRequestPath(null);
			}, 100);
		} catch (e) {
			void e;
		}
	}, [playgroundClient, resolveBaseDir, findAvailableName]);

	useImperativeHandle(
		ref,
		() => ({
			createFile: handleCreateFile,
			createFolder: handleCreateDirectory,
		}),
		[handleCreateFile, handleCreateDirectory]
	);

	const handleDeletePath = useCallback(
		async (targetPath: string, type: 'file' | 'folder') => {
			if (!playgroundClient) {
				return;
			}
			const normalized = normalizePath(targetPath);
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
			} finally {
				setLocalRenamingPath(null);
				const parentDir = getDirname(normalized);
				if (parentDir === normalizedRoot && normalizedRoot === '/') {
					// Special case: deleting at root level, refresh root files
					setRootRefreshKey((k) => k + 1);
				} else {
					setInvalidatePath(parentDir);
					setInvalidateKey((k) => k + 1);
				}
				// Focus on the parent directory after deletion
				setFocusRequestPath(parentDir);
				setFocusRequestKey((k) => k + 1);
				// Clear focus request after a short delay
				setTimeout(() => {
					setFocusRequestPath(null);
				}, 100);
				// Clear editor if deleted current file or a parent directory
				if (
					currentPath &&
					(currentPath === normalized ||
						currentPath.startsWith(`${normalized}/`))
				) {
					dispatch(setCode(''));
					dispatch(setCurrentPath(null));
				}
			}
		},
		[playgroundClient, currentPath, dispatch]
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
					normalizePath(targetPath).split('/').pop() || 'download';
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

	const contextMenuStyle = useMemo(() => {
		if (!contextMenu)
			return undefined as undefined | { left: number; top: number };
		const left =
			typeof window === 'undefined'
				? contextMenu.x
				: Math.min(contextMenu.x, window.innerWidth - 200);
		const top =
			typeof window === 'undefined'
				? contextMenu.y
				: Math.min(contextMenu.y, window.innerHeight - 140);
		return { left, top };
	}, [contextMenu]);

	return (
		<>
			<CoreFilePickerTree
				files={files}
				initialPath={coreInitialPath}
				onSelect={handleSelect}
				onLoadChildren={handleLoadChildren}
				isLoading={normalizedRoot === '/' && isRootLoading}
				autoFocus={false}
				renamingPath={
					effectiveRenamingPath
						? toCorePath(effectiveRenamingPath, normalizedRoot)
						: undefined
				}
				invalidatePath={
					invalidatePath
						? toCorePath(invalidatePath, normalizedRoot)
						: undefined
				}
				invalidateKey={invalidateKey}
				renameMapping={
					renameMapping
						? {
								from: toCorePath(
									renameMapping.from,
									normalizedRoot
								),
								to: toCorePath(
									renameMapping.to,
									normalizedRoot
								),
						  }
						: undefined
				}
				renameKey={renameKey}
				focusPathRequest={
					focusRequestPath
						? toCorePath(focusRequestPath, normalizedRoot)
						: undefined
				}
				focusRequestKey={focusRequestKey}
				expandPathRequest={
					expandRequestPath
						? toCorePath(expandRequestPath, normalizedRoot)
						: undefined
				}
				expandRequestKey={expandRequestKey}
				onRename={async (corePath, newName) => {
					if (!playgroundClient) return;
					const absPath = corePathToAbsolute(
						corePath,
						normalizedRoot
					);
					const pending = pendingCreateRef.current;
					const isPending = pending?.tempPath === absPath;
					const parent = getDirname(absPath);
					const sanitized = (newName || '').trim();
					if (!isValidNameSegment(sanitized)) {
						if (isPending) {
							try {
								if (pending.type === 'folder') {
									await playgroundClient.rmdir(absPath, {
										recursive: true,
									} as any);
								} else {
									await playgroundClient.unlink(absPath);
								}
							} catch (e) {
								void e;
							}
							pendingCreateRef.current = null;
						}
						setLocalRenamingPath(isPending ? null : absPath);
						return;
					}

					const composePath = (name: string) =>
						parent === '/' ? `/${name}` : `${parent}/${name}`;
					const finalName = sanitized;
					let candidate = composePath(finalName);
					const candidateNormalized = normalizePath(candidate);
					if (candidateNormalized === absPath) {
						setLocalRenamingPath(null);
						if (isPending) {
							pendingCreateRef.current = null;
						}
						setLastSelectedPath(candidateNormalized);
						return;
					}

					const exists = await playgroundClient
						.fileExists(candidateNormalized)
						.catch(() => false);
					const existsDir = await playgroundClient
						.isDir(candidateNormalized)
						.catch(() => false);
					if (
						(exists || existsDir) &&
						candidateNormalized !== absPath
					) {
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
							setLocalRenamingPath(absPath);
							return;
						}
					}

					let candidateIsDir = pending?.type === 'folder';
					try {
						await playgroundClient.mv(absPath, candidate as any);
						if (!pending) {
							const isDir = await playgroundClient
								.isDir(candidate as any)
								.catch(() => false);
							candidateIsDir = isDir;
						}
						setLastSelectedPath(candidate);
						// If a directory was renamed and it was expanded, remap it to keep expanded state
						if (candidateIsDir) {
							setRenameMapping({
								from: absPath,
								to: candidateNormalized,
							});
							setRenameKey((k) => k + 1);
						}
						// Update editor state
						if (candidateIsDir) {
							if (currentPath === absPath) {
								dispatch(setCurrentPath(candidate));
							}
							// keep focus on the renamed directory row
							setFocusRequestPath(candidateNormalized);
							setFocusRequestKey((k) => k + 1);
						} else {
							if (isPending) {
								// Only open the file if we just created it
								try {
									const newContent =
										await playgroundClient.readFileAsText(
											candidate
										);
									dispatch(setCode(newContent));
									dispatch(setCurrentPath(candidate));
								} catch (e) {
									void e;
								}
							} else if (currentPath === absPath) {
								// If the renamed file was open, just update the path
								dispatch(setCurrentPath(candidate));
							}
							// keep focus on the renamed file row
							setFocusRequestPath(candidateNormalized);
							setFocusRequestKey((k) => k + 1);
						}
					} catch {
						if (isPending) {
							try {
								if (pending?.type === 'folder') {
									await playgroundClient.rmdir(absPath, {
										recursive: true,
									} as any);
								} else {
									await playgroundClient.unlink(absPath);
								}
							} catch {
								// Ignore failure
							}
						}
					} finally {
						pendingCreateRef.current = null;
						setLocalRenamingPath(null);
						// Always invalidate parent to update the file list with new name
						if (
							parent === normalizedRoot &&
							normalizedRoot === '/'
						) {
							// Special case: renaming at root level, refresh root files
							setRootRefreshKey((k) => k + 1);
						} else {
							setInvalidatePath(parent);
							setInvalidateKey((k) => k + 1);
						}
						// focus the renamed entry
						setFocusRequestPath(candidateNormalized);
						setFocusRequestKey((k) => k + 1);
						// Clear focus request after a short delay to prevent interference
						setTimeout(() => {
							setFocusRequestPath(null);
						}, 100);
					}
				}}
				onRenameCancel={async (corePath) => {
					const absPath = corePathToAbsolute(
						corePath,
						normalizedRoot
					);
					const pending = pendingCreateRef.current;
					if (!playgroundClient || pending?.tempPath !== absPath) {
						onRenameCancel?.(absPath);
						setLocalRenamingPath((prev) =>
							prev === absPath ? null : prev
						);
						return;
					}
					try {
						if (pending.type === 'folder') {
							await playgroundClient.rmdir(absPath, {
								recursive: true,
							} as any);
						} else {
							await playgroundClient.unlink(absPath);
						}
					} catch (e) {
						void e;
					}
					pendingCreateRef.current = null;
					setLocalRenamingPath(null);
					setInvalidatePath(getDirname(absPath));
					setInvalidateKey((k) => k + 1);
					// refocus the original item (if exists) or its parent
					setFocusRequestPath(getDirname(absPath));
					setFocusRequestKey((k) => k + 1);
					// Clear focus request after a short delay
					setTimeout(() => {
						setFocusRequestPath(null);
					}, 100);
				}}
				onContextMenu={handleInternalContextMenu}
			/>
			{contextMenu && contextMenuStyle && (
				<div
					className={styles.contextMenu}
					style={contextMenuStyle}
					onClick={(event) => event.stopPropagation()}
					onContextMenu={(event) => event.preventDefault()}
				>
					{contextMenu.type === 'folder' && (
						<button
							className={styles.contextMenuButton}
							onClick={async () => {
								const dir = contextMenu.path;
								setContextMenu(null);
								// Focus and expand the directory, then create a file inside
								setExpandRequestPath(dir);
								setExpandRequestKey((k) => k + 1);
								const baseBefore = lastSelectedPath;
								setLastSelectedPath(dir);
								await handleCreateFile();
								setLastSelectedPath(baseBefore);
							}}
						>
							Create file
						</button>
					)}
					{contextMenu.type === 'folder' && (
						<button
							className={styles.contextMenuButton}
							onClick={async () => {
								const dir = contextMenu.path;
								setContextMenu(null);
								setExpandRequestPath(dir);
								setExpandRequestKey((k) => k + 1);
								const baseBefore = lastSelectedPath;
								setLastSelectedPath(dir);
								await handleCreateDirectory();
								setLastSelectedPath(baseBefore);
							}}
						>
							Create directory
						</button>
					)}
					<button
						className={styles.contextMenuButton}
						onClick={() =>
							handleContextMenuRename(contextMenu.path)
						}
					>
						Rename
					</button>
					<button
						className={`${styles.contextMenuButton} ${styles.contextMenuButtonDanger}`}
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
		</>
	);
});

export default PlaygroundFilePickerTree;
