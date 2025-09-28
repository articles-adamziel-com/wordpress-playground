import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
	__experimentalTreeGrid as TreeGrid,
	__experimentalTreeGridRow as TreeGridRow,
	__experimentalTreeGridCell as TreeGridCell,
	Button,
	Spinner,
} from '@wordpress/components';
import { Icon, chevronRight, chevronDown } from '@wordpress/icons';
import '@wordpress/components/build-style/style.css';
import css from './style.module.css';
import classNames from 'classnames';
import { folder, file } from '../icons';

export type FileNode = {
	name: string;
	type: 'file' | 'folder';
	children?: FileNode[];
};

export type FilePickerControlProps = {
	files: FileNode[];
	initialPath?: string;
	onSelect?: (path: string) => void;
	isLoading?: boolean;
	error?: string;
	onLoadChildren?: (path: string) => Promise<FileNode[]>;
	onContextMenu?: (
		event: React.MouseEvent,
		node: FileNode,
		path: string
	) => void;
	renamingPath?: string | null;
	onRename?: (path: string, newName: string) => void;
	onRenameCancel?: (path: string) => void;
	autoFocus?: boolean;
	// Optional: invalidate a specific folder path cache and reload its children without remounting
	invalidatePath?: string | null;
	// Optional: change this to force re-invalidation even if the path is the same
	invalidateKey?: number;
	// Optional: remap expanded paths and cached children after a directory rename
	renameMapping?: { from: string; to: string } | null;
	// Optional: bump to apply a new rename mapping
	renameKey?: number;
};

type ExpandedNodePaths = Record<string, boolean>;

type LoadedChildrenMap = Record<string, FileNode[]>;

export const FilePickerTree: React.FC<FilePickerControlProps> = ({
	isLoading = false,
	error = undefined,
	files,
	initialPath,
	onSelect = () => {},
	onLoadChildren,
	onContextMenu,
	renamingPath = null,
	onRename,
	onRenameCancel,
	autoFocus = true,
	invalidatePath = null,
	invalidateKey = 0,
	renameMapping = null,
	renameKey = 0,
}) => {
	function buildPathChain(path: string): string[] {
		if (!path) return [];
		const normalized =
			path
				.replaceAll(/\\+/g, '/')
				.replace(/\/{2,}/g, '/')
				.replace(/\/$/, '') || path;
		const hasLeadingSlash = normalized.startsWith('/');
		const parts = normalized.split('/').filter(Boolean);
		const chain: string[] = [];
		let current = hasLeadingSlash ? '/' : '';
		if (hasLeadingSlash) chain.push('/');
		for (const part of parts) {
			if (!current || current === '/') {
				current = current === '/' ? `/${part}` : part;
			} else {
				current = `${current}/${part}`;
			}
			chain.push(current);
		}
		return chain;
	}
	const [expanded, setExpanded] = useState<ExpandedNodePaths>(() => {
		if (!initialPath) {
			return {};
		}
		const initialExpanded: ExpandedNodePaths = {};
		for (const p of buildPathChain(initialPath)) {
			initialExpanded[p] = true;
		}
		return initialExpanded;
	});
	const [selectedPath, setSelectedPath] = useState<string | null>(() =>
		initialPath ? initialPath : null
	);
	const [focusedPath, setFocusedPath] = useState<string | null>(() =>
		initialPath ? initialPath : null
	);
	const [lazyChildren, setLazyChildren] = useState<LoadedChildrenMap>({});
	const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>(
		{}
	);

	const containerRef = useRef<HTMLDivElement>(null);
	const searchBufferTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const loadingPathsRef = useRef(loadingPaths);

	useEffect(() => {
		loadingPathsRef.current = loadingPaths;
	}, [loadingPaths]);

	const expandNode = useCallback((path: string, isOpen: boolean) => {
		setExpanded((prevState) => ({
			...prevState,
			[path]: isOpen,
		}));
	}, []);

	const selectPath = useCallback(
		(path: string) => {
			setSelectedPath(path);
			onSelect(path);
		},
		[onSelect]
	);

	const focusPath = useCallback((path: string) => {
		setFocusedPath(path);
	}, []);

	const generatePath = useCallback(
		(node: FileNode, parentPath = ''): string => {
			const raw = parentPath ? `${parentPath}/${node.name}` : node.name;
			return raw.replaceAll(/\\+/g, '/').replace(/\/{2,}/g, '/');
		},
		[]
	);

	// Ensure that when initialPath changes after mount, expand its chain and focus/select
	useEffect(() => {
		if (!initialPath) {
			return;
		}
		const chain = buildPathChain(initialPath);
		setExpanded((prev) => {
			const next = { ...prev } as ExpandedNodePaths;
			for (const p of chain) {
				next[p] = true;
			}
			return next;
		});
		const target = chain[chain.length - 1] || initialPath;
		setFocusedPath(target);
		setSelectedPath(target);
	}, [initialPath]);

	const getResolvedChildren = useCallback(
		(node: FileNode, path: string): FileNode[] | undefined => {
			if (node.children) {
				return node.children;
			}
			return lazyChildren[path];
		},
		[lazyChildren]
	);

	const loadChildrenForPath = useCallback(
		async (path: string, node: FileNode) => {
			if (!onLoadChildren || node.type !== 'folder') {
				return;
			}
			const existingChildren = node.children ?? lazyChildren[path];
			if (existingChildren || loadingPathsRef.current[path]) {
				return existingChildren;
			}
			setLoadingPaths((prev) => ({
				...prev,
				[path]: true,
			}));
			try {
				const children = await onLoadChildren(path);
				setLazyChildren((prev) => ({
					...prev,
					[path]: children ?? [],
				}));
				return children;
			} finally {
				setLoadingPaths((prev) => {
					const next = { ...prev };
					delete next[path];
					return next;
				});
			}
		},
		[onLoadChildren]
	);

	const handleToggleExpand = useCallback(
		async (path: string, node: FileNode, isOpen: boolean) => {
			expandNode(path, isOpen);
			if (isOpen) {
				await loadChildrenForPath(path, node);
			} else {
				// Clear cached children on collapse so that reopening refreshes the listing
				setLazyChildren((prev) => {
					if (prev[path] === undefined) return prev;
					const next = { ...prev } as LoadedChildrenMap;
					delete next[path];
					return next;
				});
			}
		},
		[expandNode, loadChildrenForPath]
	);

	// Invalidate a folder's children and refresh them in-place without clearing first,
	// preventing a brief empty state (visible flicker) during rename/delete/create.
	useEffect(() => {
		if (!invalidatePath) {
			return;
		}
		// If it's expanded and we can load, refresh immediately without clearing cache
		if (onLoadChildren && expanded[invalidatePath]) {
			setLoadingPaths((prev) => ({
				...prev,
				[invalidatePath]: true,
			}));
			void onLoadChildren(invalidatePath)
				.then((children) => {
					setLazyChildren((prev) => ({
						...prev,
						[invalidatePath]: children ?? [],
					}));
				})
				.finally(() => {
					setLoadingPaths((prev) => {
						const next = { ...prev };
						delete next[invalidatePath as string];
						return next;
					});
				});
		}
	}, [invalidatePath, invalidateKey, onLoadChildren, expanded]);

	// Preserve expansion and cached children across directory rename by remapping
	// path keys from old to new. Also update selection and focus if they were inside.
	useEffect(() => {
		if (!renameMapping) {
			return;
		}
		const { from, to } = renameMapping;
		const withTrailingSlash = from.endsWith('/') ? from : `${from}`;
		const fromPrefix = withTrailingSlash + (from === '/' ? '' : '/');
		const remapKey = (key: string): string | null => {
			if (key === from) return to;
			if (key.startsWith(fromPrefix)) {
				return to + key.slice(from.length);
			}
			return null;
		};

		setExpanded((prev) => {
			let changed = false;
			const next: ExpandedNodePaths = { ...prev };
			for (const key of Object.keys(prev)) {
				const mapped = remapKey(key);
				if (mapped && mapped !== key) {
					if (!next[mapped]) {
						next[mapped] = prev[key];
					}
					delete next[key];
					changed = true;
				}
			}
			return changed ? next : prev;
		});

		setLazyChildren((prev) => {
			let changed = false;
			const next: LoadedChildrenMap = { ...prev };
			for (const key of Object.keys(prev)) {
				const mapped = remapKey(key);
				if (mapped && mapped !== key) {
					if (next[mapped] === undefined) {
						next[mapped] = prev[key];
					}
					delete next[key];
					changed = true;
				}
			}
			return changed ? next : prev;
		});

		setSelectedPath((prev) => {
			if (!prev) return prev;
			const mapped = remapKey(prev);
			return mapped ?? prev;
		});
		setFocusedPath((prev) => {
			if (!prev) return prev;
			const mapped = remapKey(prev);
			return mapped ?? prev;
		});
	}, [renameKey, renameMapping]);

	// Auto-expand and load the root when it is '/'
	useEffect(() => {
		if (!onLoadChildren || files.length === 0) {
			return;
		}
		const rootNode = files[0];
		if (rootNode?.type === 'folder' && rootNode.name === '/') {
			setExpanded((prev) => (prev['/'] ? prev : { ...prev, '/': true }));
			if (!lazyChildren['/'] && !loadingPathsRef.current['/']) {
				void loadChildrenForPath('/', rootNode);
			}
		}
	}, [files, onLoadChildren, lazyChildren, loadChildrenForPath]);

	useEffect(() => {
		if (!initialPath || !onLoadChildren) {
			return;
		}

		let isMounted = true;
		const loadInitialPath = async () => {
			const chain = buildPathChain(initialPath);
			let currentChildren = files;
			let parentPath = '';
			for (let i = 0; i < chain.length; i++) {
				const segmentPath = chain[i];
				const nextNode = currentChildren?.find((child) => {
					const childPath = generatePath(child, parentPath);
					return childPath === segmentPath;
				});
				if (!nextNode) {
					break;
				}
				if (nextNode.type !== 'folder') {
					currentChildren = [];
					continue;
				}
				const existingChildren =
					nextNode.children ?? lazyChildren[segmentPath];
				if (!existingChildren && isMounted) {
					const loaded = await loadChildrenForPath(
						segmentPath,
						nextNode
					);
					currentChildren = loaded ?? [];
				} else {
					currentChildren = existingChildren ?? [];
				}
				parentPath = segmentPath;
			}
		};

		loadInitialPath();

		return () => {
			isMounted = false;
		};
	}, [initialPath, files, onLoadChildren, loadChildrenForPath]);

	useEffect(() => {
		if (!focusedPath) {
			if (files.length > 0) {
				const firstPath = generatePath(files[0]);
				setFocusedPath(firstPath);
			}
			return;
		}
		if (renamingPath && renamingPath === focusedPath) {
			return;
		}
		if (!autoFocus) {
			return;
		}
		const focusTarget = containerRef.current?.querySelector(
			`[data-path="${focusedPath}"]`
		) as HTMLElement | null;
		if (focusTarget && typeof focusTarget.focus === 'function') {
			focusTarget.focus();
		}
	}, [
		autoFocus,
		files,
		focusedPath,
		generatePath,
		lazyChildren,
		renamingPath,
	]);

	useEffect(() => {
		return () => {
			if (searchBufferTimeoutRef.current) {
				clearTimeout(searchBufferTimeoutRef.current);
			}
		};
	}, []);

	const [searchBuffer, setSearchBuffer] = useState('');

	function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
		if (event.key.length === 1 && event.key.match(/\S/)) {
			const newSearchBuffer = searchBuffer + event.key.toLowerCase();
			setSearchBuffer(newSearchBuffer);
			if (searchBufferTimeoutRef.current) {
				clearTimeout(searchBufferTimeoutRef.current);
			}
			searchBufferTimeoutRef.current = setTimeout(() => {
				setSearchBuffer('');
			}, 1000);

			if (containerRef.current) {
				const buttons = Array.from(
					containerRef.current.querySelectorAll('.file-node-button')
				);
				const activeElement = document.activeElement;
				let startIndex = 0;
				if (
					activeElement &&
					buttons.includes(activeElement as HTMLButtonElement)
				) {
					startIndex = buttons.indexOf(
						activeElement as HTMLButtonElement
					);
				}
				for (let i = 0; i < buttons.length; i++) {
					const index = (startIndex + i) % buttons.length;
					const button = buttons[index] as HTMLElement;
					if (
						button.textContent
							?.toLowerCase()
							.trim()
							.startsWith(newSearchBuffer)
					) {
						button.focus();
						const path = button.getAttribute('data-path');
						if (path) {
							focusPath(path);
						}
						break;
					}
				}
			}
		} else {
			setSearchBuffer('');
			if (searchBufferTimeoutRef.current) {
				clearTimeout(searchBufferTimeoutRef.current);
			}
		}
	}

	if (isLoading) {
		return (
			<div className={css['loadingContainer']}>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className={css['errorContainer']}>
				<h2>Error loading files</h2>
				<p>{error}</p>
			</div>
		);
	}

	return (
		<div onKeyDown={handleKeyDown} ref={containerRef}>
			<TreeGrid className={css['filePickerTree']}>
				{files.map((file, index) => (
					<NodeRow
						key={file.name}
						node={file}
						level={0}
						position={index + 1}
						setSize={files.length}
						expandedNodePaths={expanded}
						expandNode={handleToggleExpand}
						selectedNode={selectedPath}
						focusedNode={focusedPath}
						selectPath={selectPath}
						focusPath={focusPath}
						generatePath={generatePath}
						getChildren={getResolvedChildren}
						loadingPaths={loadingPaths}
						onContextMenu={onContextMenu}
						renamingPath={renamingPath}
						onRename={onRename}
						onRenameCancel={onRenameCancel}
					/>
				))}
			</TreeGrid>
		</div>
	);
};

const NodeRow: React.FC<{
	node: FileNode;
	level: number;
	position: number;
	setSize: number;
	expandedNodePaths: ExpandedNodePaths;
	expandNode: (
		path: string,
		node: FileNode,
		isOpen: boolean
	) => void | Promise<void>;
	selectPath: (path: string) => void;
	selectedNode: string | null;
	focusPath: (path: string) => void;
	focusedNode: string | null;
	generatePath: (node: FileNode, parentPath?: string) => string;
	getChildren: (node: FileNode, path: string) => FileNode[] | undefined;
	loadingPaths: Record<string, boolean>;
	onContextMenu?: (
		event: React.MouseEvent,
		node: FileNode,
		path: string
	) => void;
	renamingPath: string | null;
	onRename?: (path: string, newName: string) => void;
	onRenameCancel?: (path: string) => void;
	parentPath?: string;
}> = ({
	node,
	level,
	position,
	setSize,
	expandedNodePaths,
	expandNode,
	selectPath,
	selectedNode,
	focusPath,
	focusedNode,
	generatePath,
	getChildren,
	loadingPaths,
	onContextMenu,
	renamingPath,
	onRename,
	onRenameCancel,
	parentPath = '',
}) => {
	const path = generatePath(node, parentPath);
	const isExpanded = expandedNodePaths[path];
	const isRenaming = renamingPath === path;
	const renameInputRef = useRef<HTMLInputElement>(null);
	const [renameValue, setRenameValue] = useState(node.name);
	const renameHandledRef = useRef(false);

	const resolvedChildren = getChildren(node, path) ?? [];

	useEffect(() => {
		if (isRenaming) {
			setRenameValue(node.name);
			renameHandledRef.current = false;
			if (typeof window !== 'undefined' && window.requestAnimationFrame) {
				window.requestAnimationFrame(() => {
					renameInputRef.current?.select();
				});
			} else {
				renameInputRef.current?.select();
			}
		} else {
			renameHandledRef.current = false;
		}
	}, [isRenaming, node.name]);

	const toggleOpen = () => {
		if (node.type === 'folder') {
			expandNode(path, node, !isExpanded);
		}
	};

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === 'ArrowLeft') {
			if (isExpanded) {
				toggleOpen();
			} else {
				(
					document.querySelector(
						`[data-path="${parentPath}"]`
					) as HTMLButtonElement
				)?.focus();
			}
			event.preventDefault();
			event.stopPropagation();
		} else if (event.key === 'ArrowRight') {
			if (isExpanded) {
				if (resolvedChildren?.length) {
					const firstChildPath = generatePath(
						resolvedChildren[0],
						path
					);
					(
						document.querySelector(
							`[data-path="${firstChildPath}"]`
						) as HTMLButtonElement
					)?.focus();
				}
			} else {
				toggleOpen();
			}
			event.preventDefault();
			event.stopPropagation();
		} else if (
			event.key === ' ' ||
			event.key === 'Space' ||
			event.key === 'Spacebar'
		) {
			if (node.type === 'folder') {
				expandNode(path, node, !isExpanded);
			}
			event.preventDefault();
		} else if (event.key === 'Enter') {
			selectPath(path);
			focusPath(path);
			const form = (event.currentTarget as HTMLElement)?.closest('form');
			if (form) {
				setTimeout(() => {
					form.dispatchEvent(new Event('submit', { bubbles: true }));
				});
			}
		}
	};

	const handleContextMenu = (event: React.MouseEvent) => {
		onContextMenu?.(event, node, path);
	};

	const handleRenameSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		renameHandledRef.current = true;
		onRename?.(path, renameValue.trim());
	};

	const handleRenameKeyDown = (
		event: React.KeyboardEvent<HTMLInputElement>
	) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			renameHandledRef.current = true;
			onRenameCancel?.(path);
		}
	};

	const handleRenameBlur = () => {
		if (!renameHandledRef.current) {
			onRenameCancel?.(path);
		}
		renameHandledRef.current = false;
	};

	return (
		<>
			<TreeGridRow
				level={level}
				positionInSet={position}
				setSize={setSize}
			>
				<TreeGridCell>
					{() => (
						<>
							{isRenaming ? (
								<form
									onSubmit={handleRenameSubmit}
									className={classNames(
										css['fileNodeButton'],
										css['renaming'],
										'file-node-button',
										{
											[css['selected']]:
												selectedNode === path,
											[css['focused']]:
												focusedNode === path,
										}
									)}
									data-path={path}
									onContextMenu={handleContextMenu}
								>
									<FileName
										node={node}
										isOpen={
											node.type === 'folder' && isExpanded
										}
										level={level}
										hideName
									/>
									<input
										ref={renameInputRef}
										className={css['renameInput']}
										value={renameValue}
										onChange={(event) =>
											setRenameValue(event.target.value)
										}
										onBlur={handleRenameBlur}
										onFocus={() => focusPath(path)}
										onKeyDown={handleRenameKeyDown}
									/>
								</form>
							) : (
								<Button
									onClick={() => {
										if (node.type === 'folder') {
											toggleOpen();
										}
										selectPath(path);
										focusPath(path);
									}}
									onKeyDown={handleKeyDown}
									onFocus={() => {
										focusPath(path);
									}}
									onContextMenu={handleContextMenu}
									className={classNames(
										css['fileNodeButton'],
										{
											[css['selected']]:
												selectedNode === path,
											[css['focused']]:
												focusedNode === path,
										}
									)}
									data-path={path}
								>
									<FileName
										node={node}
										isOpen={
											node.type === 'folder' && isExpanded
										}
										level={level}
									/>
								</Button>
							)}
						</>
					)}
				</TreeGridCell>
			</TreeGridRow>
			{isExpanded &&
				resolvedChildren &&
				resolvedChildren.map((child, index) => (
					<NodeRow
						key={child.name}
						node={child}
						level={level + 1}
						position={index + 1}
						setSize={resolvedChildren.length}
						expandedNodePaths={expandedNodePaths}
						expandNode={expandNode}
						selectPath={selectPath}
						selectedNode={selectedNode}
						focusPath={focusPath}
						focusedNode={focusedNode}
						generatePath={generatePath}
						getChildren={getChildren}
						loadingPaths={loadingPaths}
						onContextMenu={onContextMenu}
						renamingPath={renamingPath}
						onRename={onRename}
						onRenameCancel={onRenameCancel}
						parentPath={path}
					/>
				))}
		</>
	);
};

const FileName: React.FC<{
	node: FileNode;
	level: number;
	isOpen?: boolean;
	hideName?: boolean;
}> = ({ node, level, isOpen, hideName = false }) => {
	const indent: string[] = [];
	for (let i = 0; i < level; i++) {
		indent.push('&nbsp;&nbsp;&nbsp;&nbsp;');
	}
	return (
		<>
			<span
				aria-hidden="true"
				dangerouslySetInnerHTML={{ __html: indent.join('') }}
			></span>
			{node.type === 'folder' ? (
				<Icon width={16} icon={isOpen ? chevronDown : chevronRight} />
			) : (
				<div style={{ width: 16 }}>&nbsp;</div>
			)}
			<Icon width={16} icon={node.type === 'folder' ? folder : file} />
			{!hideName && <span className={css['fileName']}>{node.name}</span>}
		</>
	);
};

export default FilePickerTree;
