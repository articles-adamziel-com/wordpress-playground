import React, {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from 'react';
import type { FileNode, FilePickerTreeHandle } from '@wp-playground/components';
import { FilePickerTree as CoreFilePickerTree } from '@wp-playground/components';
import type { PlaygroundClient } from '@wp-playground/client';
import styles from './layout.module.css';
import saveAs from 'file-saver';
import { zipDirectory } from '@wp-playground/common';
import { useAppDispatch, useAppSelector } from '../hooks';
import { setCode, setCurrentPath } from '../store';
import { DEFAULT_WORKSPACE_DIR } from '../constants';
import { basename, dirname, joinPaths, normalizePath } from '@php-wasm/util';

async function listDir(client: PlaygroundClient, path: string) {
	const names = await client.listFiles(path);
	const results: { name: string; type: 'file' | 'folder' }[] = [];
	for (const name of names) {
		const childPath = path === '/' ? `/${name}` : `${path}/${name}`;
		const isDirectory = await client.isDir(childPath);
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
	const excludePathsKey = useMemo(
		() => JSON.stringify(excludePaths ?? []),
		[excludePaths]
	);

	const [files, setFiles] = useState<FileNode[]>([]);
	const [contextMenu, setContextMenu] = useState<{
		path: string;
		type: 'file' | 'folder';
		x: number;
		y: number;
	} | null>(null);
	const [localRenamingPath, setLocalRenamingPath] = useState<string | null>(
		null
	);
	const treeRef = useRef<FilePickerTreeHandle>(null);
	const pendingCreateRef = useRef<{
		type: 'file' | 'folder';
		tempPath: string;
	} | null>(null);
	const isMountedRef = useRef(true);
	const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(
		initialPath ?? DEFAULT_WORKSPACE_DIR
	);
	const dispatch = useAppDispatch();
	const currentPath = useAppSelector((state) => state.playground.currentPath);

	const reloadRoot = useCallback(async () => {
		if (normalizedRoot !== '/') {
			if (!isMountedRef.current) return;
			setFiles([{ name: rootName, type: 'folder' } as FileNode]);
			return;
		}
		if (!playgroundClient) {
			if (!isMountedRef.current) return;
			setFiles([]);
			return;
		}
		try {
			const entries = await listDir(playgroundClient, '/');
			const excludeSet = new Set(excludePaths ?? []);
			const filtered = entries.filter((item) => {
				const childAbs = `/${item.name}`;
				return !excludeSet.has(childAbs);
			});
			const ordered = prioritizeRenaming(filtered, '/');
			if (isMountedRef.current) {
				setFiles(ordered as FileNode[]);
			}
		} catch {
			if (isMountedRef.current) {
				setFiles([]);
			}
		}
	}, [excludePathsKey, normalizedRoot, playgroundClient, rootName]);

	useEffect(() => {
		return () => {
			isMountedRef.current = false;
		};
	}, []);

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

	const toCore = useCallback(
		(path: string) => toCorePath(path, normalizedRoot),
		[normalizedRoot]
	);

	useEffect(() => {
		void reloadRoot();
	}, [reloadRoot]);

	const coreInitialPath = useMemo(
		() => (initialPath ? toCore(initialPath) : undefined),
		[initialPath, toCore]
	);

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

	const handleSelect = (path: string) => {
		const normalized = normalizePath('/' + path);
		setLastSelectedPath(normalized);
		if (onSelect) onSelect(normalized);
	};

	const effectiveRenamingPath = useMemo(() => {
		return renamingPath ?? localRenamingPath ?? undefined;
	}, [renamingPath, localRenamingPath]);

	const handleInternalContextMenu = (
		event: React.MouseEvent,
		node: FileNode,
		corePath: string
	) => {
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
	};

	const handleContextMenuRename = (targetPath: string) => {
		setContextMenu(null);
		setLocalRenamingPath(targetPath);
	};

	// dirname helper not needed in this component

	const findAvailableName = async (baseDir: string, baseName: string) => {
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
			(await playgroundClient?.fileExists(`${prefix}/${name}`)) ||
			(await playgroundClient?.isDir(`${prefix}/${name}`))
		) {
			counter += 1;
			const { stem, ext } = splitExt(baseName);
			name = `${stem} (${counter})${ext}`;
		}
		return name;
	};

	const resolveBaseDir = async (path?: string) => {
		if (!path) {
			path = lastSelectedPath || DEFAULT_WORKSPACE_DIR;
		}
		while (true) {
			if (path === '/') {
				break;
			}
			if (await playgroundClient?.isDir(path)) {
				break;
			}
			path = dirname(path);
		}
		return path;
	};

	const handleCreateFile = async (targetDir?: string) => {
		if (!playgroundClient) {
			return;
		}
		const baseDir = await resolveBaseDir(targetDir);
		const normalizedBase = normalizePath(baseDir);
		try {
			const name = await findAvailableName(
				normalizedBase,
				'untitled.php'
			);
			const tempPath = joinPaths(normalizedBase, name);
			await playgroundClient.writeFile(tempPath, '');
			pendingCreateRef.current = { type: 'file', tempPath };
			setLocalRenamingPath(tempPath);
			setLastSelectedPath(tempPath);
			const coreBase = toCore(normalizedBase);
			const coreTemp = toCore(tempPath);
			if (normalizedRoot === '/' && normalizedBase === '/') {
				await reloadRoot();
				setTimeout(() => {
					treeRef.current?.focusPath(coreTemp, { notify: false });
				}, 0);
			} else if (treeRef.current) {
				await treeRef.current.expandToPath(coreBase);
				await treeRef.current.refresh(coreBase);
				treeRef.current.focusPath(coreTemp, { notify: false });
			}
		} catch (e) {
			void e;
		}
	};

	const handleCreateDirectory = async (targetDir?: string) => {
		if (!playgroundClient) {
			return;
		}
		const baseDir = await resolveBaseDir(targetDir);
		const normalizedBase = normalizePath(baseDir);
		try {
			const name = await findAvailableName(normalizedBase, 'New Folder');
			const tempPath = joinPaths(normalizedBase, name);
			await playgroundClient.mkdir(tempPath);
			pendingCreateRef.current = { type: 'folder', tempPath };
			setLocalRenamingPath(tempPath);
			setLastSelectedPath(tempPath);
			const coreBase = toCore(normalizedBase);
			const coreTemp = toCore(tempPath);
			if (normalizedRoot === '/' && normalizedBase === '/') {
				await reloadRoot();
				setTimeout(() => {
					treeRef.current?.focusPath(coreTemp, { notify: false });
				}, 0);
			} else if (treeRef.current) {
				await treeRef.current.expandToPath(coreBase);
				await treeRef.current.refresh(coreBase);
				treeRef.current.focusPath(coreTemp, { notify: false });
			}
		} catch (e) {
			void e;
		}
	};

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
				setLastSelectedPath(parentDir);
				const coreParent = toCore(parentDir);
				if (normalizedRoot === '/' && parentDir === '/') {
					await reloadRoot();
					if (coreParent) {
						setTimeout(() => {
							treeRef.current?.focusPath(coreParent, {
								notify: false,
							});
						}, 0);
					}
				} else if (treeRef.current) {
					await treeRef.current.refresh(coreParent);
					treeRef.current.focusPath(coreParent, { notify: false });
				}
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
		[
			currentPath,
			dispatch,
			getDirname,
			normalizedRoot,
			playgroundClient,
			reloadRoot,
			toCore,
		]
	);

	const handleDownloadPath = useCallback(
		async (targetPath: string) => {
			if (!playgroundClient) {
				return;
			}
			setContextMenu(null);
			try {
				const normalized = normalizePath(targetPath);
				const baseName = basename(normalized) || 'download';
				const isDir = await playgroundClient.isDir(normalized);
				if (isDir) {
					const bytes = await zipDirectory(
						playgroundClient as any,
						normalized
					);
					saveAs(new File([bytes], `${baseName}.zip`));
					return;
				}
				const data = await playgroundClient.readFileAsBuffer(
					normalized
				);
				saveAs(new File([data], baseName));
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
				ref={treeRef}
				files={files}
				initialPath={coreInitialPath}
				onSelect={handleSelect}
				onLoadChildren={handleLoadChildren}
				autoFocus={false}
				renamingPath={
					effectiveRenamingPath
						? toCore(effectiveRenamingPath)
						: undefined
				}
				onRename={async (corePath, newName) => {
					if (!playgroundClient) return;
					const absPath = corePathToAbsolute(
						corePath,
						normalizedRoot
					);
					const pending = pendingCreateRef.current;
					const isPending = pending?.tempPath === absPath;
					const parent = getDirname(absPath);
					const coreParent = toCore(parent);
					const coreOriginal = toCore(absPath);
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
					let candidate = composePath(sanitized);
					let candidateNormalized = normalizePath(candidate);
					if (candidateNormalized === absPath) {
						setLocalRenamingPath(null);
						if (isPending) {
							pendingCreateRef.current = null;
						}
						setLastSelectedPath(candidateNormalized);
						const coreCandidateSame = toCore(candidateNormalized);
						if (coreCandidateSame) {
							if (normalizedRoot === '/' && parent === '/') {
								setTimeout(() => {
									treeRef.current?.focusPath(
										coreCandidateSame,
										{
											notify: false,
										}
									);
								}, 0);
							} else {
								treeRef.current?.focusPath(coreCandidateSame, {
									notify: false,
								});
							}
						}
						return;
					}

					const exists = await playgroundClient.fileExists(
						candidateNormalized
					);
					const existsDir = await playgroundClient.isDir(
						candidateNormalized
					);
					if (
						(exists || existsDir) &&
						candidateNormalized !== absPath
					) {
						if (isPending) {
							try {
								const unique = await findAvailableName(
									parent === '/' ? '/' : parent,
									sanitized
								);
								candidate = composePath(unique);
								candidateNormalized = normalizePath(candidate);
							} catch (e) {
								void e;
							}
						} else {
							setLocalRenamingPath(absPath);
							return;
						}
					}

					const coreCandidate = toCore(candidateNormalized);
					let candidateIsDir = pending?.type === 'folder';
					try {
						await playgroundClient.mv(absPath, candidate as any);
						if (!pending) {
							const isDir = await playgroundClient.isDir(
								candidate as any
							);
							candidateIsDir = isDir;
						}
						setLastSelectedPath(candidateNormalized);
						if (
							candidateIsDir &&
							treeRef.current &&
							coreOriginal &&
							coreCandidate
						) {
							treeRef.current.remapPath(
								coreOriginal,
								coreCandidate
							);
						}
						if (candidateIsDir) {
							if (currentPath === absPath) {
								dispatch(setCurrentPath(candidate));
							}
						} else {
							if (isPending) {
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
								dispatch(setCurrentPath(candidate));
							}
						}

						if (normalizedRoot === '/' && parent === '/') {
							await reloadRoot();
							if (coreCandidate) {
								setTimeout(() => {
									treeRef.current?.focusPath(coreCandidate, {
										notify: false,
									});
								}, 0);
							}
						} else if (treeRef.current) {
							await treeRef.current.refresh(coreParent);
							if (coreCandidate) {
								treeRef.current.focusPath(coreCandidate, {
									notify: false,
								});
							}
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
					const parentDir = getDirname(absPath);
					setLastSelectedPath(parentDir);
					const coreParent = toCore(parentDir);
					if (normalizedRoot === '/' && parentDir === '/') {
						await reloadRoot();
					} else if (treeRef.current) {
						await treeRef.current.refresh(coreParent);
					}
					if (coreParent) {
						const focusLater =
							normalizedRoot === '/' && parentDir === '/';
						const focusAction = () =>
							treeRef.current?.focusPath(coreParent, {
								notify: false,
							});
						if (focusLater) {
							setTimeout(focusAction, 0);
						} else {
							focusAction();
						}
					}
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
								await handleCreateFile(dir);
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
								await handleCreateDirectory(dir);
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
					<button
						className={styles.contextMenuButton}
						onClick={() => handleDownloadPath(contextMenu.path)}
					>
						Download
					</button>
				</div>
			)}
		</>
	);
});

export default PlaygroundFilePickerTree;
