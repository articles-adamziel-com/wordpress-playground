import React, {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from 'react';
import type { FileNode, FilePickerTreeHandle } from '@wp-playground/components';
import { FilePickerTree as CoreFilePickerTree } from '@wp-playground/components';
import styles from './FileExplorer.module.css';
import saveAs from 'file-saver';
import { zipDirectory } from '@wp-playground/common';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { setCode, setCurrentPath } from '../../store';
import { DEFAULT_WORKSPACE_DIR } from '../../constants';
import { basename, dirname, joinPaths, normalizePath } from '@php-wasm/util';
import { Popover, NavigableMenu, MenuItem } from '@wordpress/components';

async function listDir(filesystem: AsyncFilesystem, path: string) {
	const names = await filesystem.listFiles(path);
	const results: { name: string; type: 'file' | 'folder' }[] = [];
	for (const name of names) {
		const childPath = path === '/' ? `/${name}` : `${path}/${name}`;
		const isDirectory = await filesystem.isDir(childPath);
		results.push({ name, type: isDirectory ? 'folder' : 'file' });
	}
	return results.sort((a, b) => {
		if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

export interface PlaygroundFilePickerTreeRef {
	createFile: () => void;
	createFolder: () => void;
	refresh: () => Promise<void>;
}

export interface AsyncFilesystem {
	isDir: (path: string) => Promise<boolean>;
	fileExists: (path: string) => Promise<boolean>;
	readFileAsBuffer: (path: string) => Promise<Uint8Array>;
	readFileAsText: (path: string) => Promise<string>;
	listFiles: (path: string) => Promise<string[]>;
	writeFile: (path: string, data: Uint8Array | string) => Promise<void>;
	mkdir: (path: string) => Promise<void>;
	rmdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
	mv: (source: string, destination: string) => Promise<void>;
	unlink: (path: string) => Promise<void>;
}

export type PlaygroundFilePickerTreeProps = {
	root?: string;
	initialPath?: string;
	excludePaths?: string[];
	onSelect?: (path: string) => void;
	filesystem: AsyncFilesystem;
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
	{ root = '/wordpress', initialPath, excludePaths, onSelect, filesystem },
	ref
) {
	const normalizedRoot = useMemo(() => normalizePath(root), [root]);
	const [files, setFiles] = useState<FileNode[]>([]);
	const [contextMenu, setContextMenu] = useState<{
		path: string;
		type: 'file' | 'folder';
		x: number;
		y: number;
	} | null>(null);
	const [renamingAbsolutePath, setRenamingAbsolutePath] = useState<
		string | null
	>(null);
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

	useEffect(() => {
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	const reloadTopLevel = async () => {
		try {
			const entries = await listDir(filesystem, normalizedRoot);
			const excludeSet = new Set(excludePaths ?? []);
			const filtered = entries.filter((item) => {
				const childAbs = `/${item.name}`;
				return !excludeSet.has(childAbs);
			});
			if (isMountedRef.current) {
				setFiles(filtered as FileNode[]);
			}
		} catch {
			if (isMountedRef.current) {
				setFiles([]);
			}
		}
	};

	useEffect(() => {
		void reloadTopLevel();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const pathToRelative = (path: string) => {
		return (
			path.startsWith(normalizedRoot)
				? path.slice(normalizedRoot.length)
				: path
		).replace(/^\//, '');
	};

	const relativeInitialPath = useMemo(
		() => (initialPath ? pathToRelative(initialPath) : undefined),
		[initialPath, normalizedRoot]
	);

	const pathToAbsolute = (path: string) => {
		return joinPaths(normalizedRoot, path);
	};

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

	const handleLoadChildren = async (relativePath: string) => {
		const absDirPath = pathToAbsolute(relativePath);
		const items = await listDir(filesystem, absDirPath);
		const filtered = items.filter((item) => {
			const childAbs =
				absDirPath === '/'
					? `/${item.name}`
					: `${absDirPath}/${item.name}`;
			return !excludePaths?.includes(childAbs);
		});
		return filtered;
	};

	const handleSelect = (path: string) => {
		onSelect?.(pathToAbsolute(path));
	};

	const handleInternalContextMenu = (
		event: React.MouseEvent,
		node: FileNode,
		path: string
	) => {
		event.preventDefault();
		event.stopPropagation();
		const absPath = pathToAbsolute(path);
		setRenamingAbsolutePath(null);
		setContextMenu({
			path: absPath,
			type: node.type,
			x: event.clientX,
			y: event.clientY,
		});
	};

	const handleContextMenuRename = (targetPath: string) => {
		setContextMenu(null);
		setRenamingAbsolutePath(targetPath);
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
			(await filesystem?.fileExists(`${prefix}/${name}`)) ||
			(await filesystem?.isDir(`${prefix}/${name}`))
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
			if (await filesystem?.isDir(path)) {
				break;
			}
			path = dirname(path);
		}
		return path;
	};

	const handleCreateFile = async (targetDir?: string) => {
		const baseDir = await resolveBaseDir(targetDir);
		const normalizedBase = normalizePath(baseDir);
		try {
			const name = await findAvailableName(
				normalizedBase,
				'untitled.php'
			);
			const tempPath = joinPaths(normalizedBase, name);
			await filesystem.writeFile(tempPath, '');
			pendingCreateRef.current = { type: 'file', tempPath };
			setRenamingAbsolutePath(tempPath);
			setLastSelectedPath(tempPath);
			const absoluteBasePath = pathToAbsolute(normalizedBase);
			const absoluteTempPath = pathToAbsolute(tempPath);
			if (treeRef.current) {
				await treeRef.current.expandToPath(absoluteBasePath);
				await treeRef.current.refresh(absoluteBasePath);
				treeRef.current.focusPath(absoluteTempPath, { notify: false });
			}
		} catch (e) {
			void e;
		}
	};

	const handleCreateDirectory = async (targetDir?: string) => {
		const baseDir = await resolveBaseDir(targetDir);
		const normalizedBase = normalizePath(baseDir);
		try {
			const name = await findAvailableName(normalizedBase, 'New Folder');
			const tempPath = joinPaths(normalizedBase, name);
			await filesystem.mkdir(tempPath);
			pendingCreateRef.current = { type: 'folder', tempPath };
			setRenamingAbsolutePath(tempPath);
			setLastSelectedPath(tempPath);
			const absoluteBasePath = pathToAbsolute(normalizedBase);
			const absoluteTempPath = pathToAbsolute(tempPath);
			if (treeRef.current) {
				await treeRef.current.expandToPath(absoluteBasePath);
				await treeRef.current.refresh(absoluteBasePath);
				treeRef.current.focusPath(absoluteTempPath, { notify: false });
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
			refresh: reloadTopLevel,
		}),
		[]
	);

	const handleDeletePath = async (
		targetPath: string,
		type: 'file' | 'folder'
	) => {
		const normalized = normalizePath(targetPath);
		setContextMenu(null);
		try {
			if (type === 'folder') {
				await filesystem.rmdir(normalized, {
					recursive: true,
				} as any);
			} else {
				await filesystem.unlink(normalized);
			}
		} catch {
			// Ignore failure
		} finally {
			setRenamingAbsolutePath(null);
			const parentDir = dirname(normalized);
			setLastSelectedPath(parentDir);
			const relativeParentPath = pathToRelative(parentDir);
			if (parentDir === normalizedRoot) {
				await reloadTopLevel();
			} else if (treeRef.current) {
				await treeRef.current.refresh(relativeParentPath);
				if (relativeParentPath) {
					treeRef.current.focusPath(relativeParentPath, {
						notify: false,
					});
				}
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
	};

	const handleDownloadPath = async (targetPath: string) => {
		setContextMenu(null);
		try {
			const normalized = normalizePath(targetPath);
			const baseName = basename(normalized) || 'download';
			const isDir = await filesystem.isDir(normalized);
			if (isDir) {
				const bytes = await zipDirectory(filesystem as any, normalized);
				saveAs(new File([bytes], `${baseName}.zip`));
				return;
			}
			const data = await filesystem.readFileAsBuffer(normalized);
			saveAs(new File([data], baseName));
		} catch {
			// Ignore failure
		}
	};

	return (
		<>
			<CoreFilePickerTree
				ref={treeRef}
				files={files}
				initialPath={relativeInitialPath}
				onSelect={handleSelect}
				onLoadChildren={handleLoadChildren}
				autoFocus={false}
				renamingPath={
					renamingAbsolutePath
						? pathToRelative(renamingAbsolutePath)
						: undefined
				}
				onRename={async (relativePath, newName) => {
					const absPath = pathToAbsolute(relativePath);
					const pending = pendingCreateRef.current;
					const isPending = pending?.tempPath === absPath;
					const parent = dirname(absPath);
					const relativeParentPath = pathToRelative(parent);
					const relativeOriginalPath = pathToRelative(absPath);
					const sanitized = (newName || '').trim();
					if (!isValidNameSegment(sanitized)) {
						if (isPending) {
							try {
								if (pending.type === 'folder') {
									await filesystem.rmdir(absPath, {
										recursive: true,
									} as any);
								} else {
									await filesystem.unlink(absPath);
								}
							} catch (e) {
								void e;
							}
							pendingCreateRef.current = null;
						}
						setRenamingAbsolutePath(isPending ? null : absPath);
						return;
					}

					const composePath = (name: string) =>
						parent === '/' ? `/${name}` : `${parent}/${name}`;
					let candidate = composePath(sanitized);
					let candidateNormalized = normalizePath(candidate);
					if (candidateNormalized === absPath) {
						setRenamingAbsolutePath(null);
						if (isPending) {
							pendingCreateRef.current = null;
						}
						setLastSelectedPath(candidateNormalized);
						const relativeCandidateSamePath =
							pathToRelative(candidateNormalized);
						if (relativeCandidateSamePath) {
							if (normalizedRoot === '/' && parent === '/') {
								setTimeout(() => {
									treeRef.current?.focusPath(
										relativeCandidateSamePath,
										{
											notify: false,
										}
									);
								}, 0);
							} else {
								treeRef.current?.focusPath(
									relativeCandidateSamePath,
									{
										notify: false,
									}
								);
							}
						}
						return;
					}

					const exists = await filesystem.fileExists(
						candidateNormalized
					);
					const existsDir = await filesystem.isDir(
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
							setRenamingAbsolutePath(absPath);
							return;
						}
					}

					const relativeCandidatePath =
						pathToRelative(candidateNormalized);
					let candidateIsDir = pending?.type === 'folder';
					try {
						await filesystem.mv(absPath, candidate as any);
						if (!pending) {
							const isDir = await filesystem.isDir(
								candidate as any
							);
							candidateIsDir = isDir;
						}
						setLastSelectedPath(candidateNormalized);
						if (
							candidateIsDir &&
							treeRef.current &&
							relativeOriginalPath &&
							relativeCandidatePath
						) {
							treeRef.current.remapPath(
								relativeOriginalPath,
								relativeCandidatePath
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
										await filesystem.readFileAsText(
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

						if (parent === normalizedRoot) {
							await reloadTopLevel();
						} else if (treeRef.current) {
							await treeRef.current.refresh(relativeParentPath);
						}
						if (relativeCandidatePath) {
							treeRef.current?.focusPath(relativeCandidatePath, {
								notify: false,
							});
						}
					} catch {
						if (isPending) {
							try {
								if (pending?.type === 'folder') {
									await filesystem.rmdir(absPath, {
										recursive: true,
									} as any);
								} else {
									await filesystem.unlink(absPath);
								}
							} catch {
								// Ignore failure
							}
						}
					} finally {
						pendingCreateRef.current = null;
						setRenamingAbsolutePath(null);
					}
				}}
				onRenameCancel={async (relativePath) => {
					const absPath = pathToAbsolute(relativePath);
					const pending = pendingCreateRef.current;
					if (!filesystem || pending?.tempPath !== absPath) {
						setRenamingAbsolutePath((prev) =>
							prev === absPath ? null : prev
						);
						return;
					}
					try {
						if (pending.type === 'folder') {
							await filesystem.rmdir(absPath, {
								recursive: true,
							} as any);
						} else {
							await filesystem.unlink(absPath);
						}
					} catch (e) {
						void e;
					}
					pendingCreateRef.current = null;
					setRenamingAbsolutePath(null);
					const parentDir = dirname(absPath);
					setLastSelectedPath(parentDir);
					const relativeParentPath = pathToRelative(parentDir);
					if (parentDir === normalizedRoot) {
						await reloadTopLevel();
					} else if (treeRef.current) {
						await treeRef.current.refresh(relativeParentPath);
					}
					if (relativeParentPath) {
						const focusLater =
							normalizedRoot === '/' && parentDir === '/';
						const focusAction = () =>
							treeRef.current?.focusPath(relativeParentPath, {
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
			{contextMenu && (
				<Popover
					placement="bottom-start"
					onClose={() => setContextMenu(null)}
					anchor={{
						getBoundingClientRect: () => ({
							x: contextMenu.x,
							y: contextMenu.y,
							width: 0,
							height: 0,
							top: contextMenu.y,
							left: contextMenu.x,
							right: contextMenu.x,
							bottom: contextMenu.y,
							toJSON: () => ({}),
						}),
						ownerDocument: document,
					}}
					noArrow={true}
					resize={false}
					focusOnMount="firstElement"
				>
					<NavigableMenu role="menu">
						{contextMenu.type === 'folder' && (
							<MenuItem
								role="menuitem"
								className={styles.contextMenuButton}
								onClick={async () => {
									const dir = contextMenu.path;
									setContextMenu(null);
									await handleCreateFile(dir);
								}}
							>
								Create file
							</MenuItem>
						)}
						{contextMenu.type === 'folder' && (
							<MenuItem
								role="menuitem"
								className={styles.contextMenuButton}
								onClick={async () => {
									const dir = contextMenu.path;
									setContextMenu(null);
									await handleCreateDirectory(dir);
								}}
							>
								Create directory
							</MenuItem>
						)}
						<MenuItem
							role="menuitem"
							className={styles.contextMenuButton}
							onClick={() =>
								handleContextMenuRename(contextMenu.path)
							}
						>
							Rename
						</MenuItem>
						<MenuItem
							role="menuitem"
							className={`${styles.contextMenuButton} ${styles.contextMenuButtonDanger}`}
							onClick={() =>
								handleDeletePath(
									contextMenu.path,
									contextMenu.type
								)
							}
						>
							Delete
						</MenuItem>
						<MenuItem
							role="menuitem"
							className={styles.contextMenuButton}
							onClick={() => handleDownloadPath(contextMenu.path)}
						>
							Download
						</MenuItem>
					</NavigableMenu>
				</Popover>
			)}
		</>
	);
});

export default PlaygroundFilePickerTree;
