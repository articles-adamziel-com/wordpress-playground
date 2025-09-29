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
	createFile: (absSelectedPath?: string) => void;
	createFolder: (absSelectedPath?: string) => void;
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
	onSelect?: (path: string | null) => void;
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
		absPath: string;
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

	const getAbsoluteSelectedPath = () => {
		const relative = treeRef.current?.getSelectedPath() || null;
		return relative ? pathToAbsolute(relative) : null;
	};
	const handleSelect = (path: string) => {
		const abs = pathToAbsolute(path);
		onSelect?.(abs);
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
			absPath: absPath,
			type: node.type,
			x: event.clientX,
			y: event.clientY,
		});
	};

	const handleContextMenuRename = (targetPath: string) => {
		setContextMenu(null);
		setRenamingAbsolutePath(targetPath);
	};

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

	const handleCreateFile = async (absSelectedPath?: string) =>
		await handleCreateNode(absSelectedPath, 'file', 'untitled.php');

	const handleCreateDirectory = async (absSelectedPath?: string) =>
		await handleCreateNode(absSelectedPath, 'folder', 'New Folder');

	const handleCreateNode = async (
		absSelectedPath: string | undefined,
		type: 'file' | 'folder',
		initialName: string
	) => {
		absSelectedPath = absSelectedPath || getAbsoluteSelectedPath() || root;

		// Resolve the parent directory of the new node – either the
		// currently selected directory or its first existing parent.
		let nodeParent = absSelectedPath;
		while (true) {
			if (nodeParent === '/') {
				break;
			}
			if (await filesystem?.isDir(nodeParent)) {
				break;
			}
			nodeParent = dirname(nodeParent);
		}

		const normalizedBase = normalizePath(nodeParent);
		const name = await findAvailableName(normalizedBase, initialName);
		const tempPath = joinPaths(normalizedBase, name);
		if (type === 'folder') {
			await filesystem.mkdir(tempPath);
		} else {
			await filesystem.writeFile(tempPath, '');
		}
		pendingCreateRef.current = { type, tempPath };
		setRenamingAbsolutePath(tempPath);
		if (normalizedBase === normalizedRoot) {
			await reloadTopLevel();
		} else if (treeRef.current) {
			await treeRef.current.expandToPath(pathToRelative(normalizedBase));
			await treeRef.current.refresh(pathToRelative(normalizedBase));
		}
		const relativeTempPath = pathToRelative(tempPath);
		if (treeRef.current && relativeTempPath) {
			const focusLater = normalizedRoot === '/' && normalizedBase === '/';
			const focusAction = () => {
				treeRef.current?.focusPath(relativeTempPath, { notify: false });
			};
			if (focusLater) {
				setTimeout(focusAction, 0);
			} else {
				focusAction();
			}
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
		absSelectedPath: string,
		type: 'file' | 'folder'
	) => {
		const normalized = normalizePath(absSelectedPath);
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
			// Notify parent if deleted current file or a parent directory
			const currentAbs = getAbsoluteSelectedPath();
			if (
				currentAbs &&
				(currentAbs === normalized ||
					currentAbs.startsWith(`${normalized}/`))
			) {
				onSelect?.(null);
			}
		}
	};

	const handleDownloadPath = async (absSelectedPath: string) => {
		setContextMenu(null);
		const normalized = normalizePath(absSelectedPath);
		const baseName = basename(normalized) || 'download';
		const isDir = await filesystem.isDir(normalized);
		if (isDir) {
			const bytes = await zipDirectory(filesystem as any, normalized);
			saveAs(new File([bytes], `${baseName}.zip`));
			return;
		}
		const data = await filesystem.readFileAsBuffer(normalized);
		saveAs(new File([data], baseName));
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
						const relativeCandidateSamePath =
							pathToRelative(candidateNormalized);
						if (relativeCandidateSamePath) {
							setTimeout(() => {
								treeRef.current?.focusPath(
									relativeCandidateSamePath,
									{
										notify: false,
									}
								);
							}, 0);
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
						// If the currently selected path was renamed, notify parent with the new path
						const currentAbs = getAbsoluteSelectedPath();
						if (currentAbs === absPath) {
							onSelect?.(normalizePath(candidate));
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
									setContextMenu(null);
									await handleCreateFile(contextMenu.absPath);
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
									setContextMenu(null);
									await handleCreateDirectory(
										contextMenu.absPath
									);
								}}
							>
								Create directory
							</MenuItem>
						)}
						<MenuItem
							role="menuitem"
							className={styles.contextMenuButton}
							onClick={() =>
								handleContextMenuRename(contextMenu.absPath)
							}
						>
							Rename
						</MenuItem>
						<MenuItem
							role="menuitem"
							className={`${styles.contextMenuButton} ${styles.contextMenuButtonDanger}`}
							onClick={() =>
								handleDeletePath(
									contextMenu.absPath,
									contextMenu.type
								)
							}
						>
							Delete
						</MenuItem>
						<MenuItem
							role="menuitem"
							className={styles.contextMenuButton}
							onClick={() =>
								handleDownloadPath(contextMenu.absPath)
							}
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
