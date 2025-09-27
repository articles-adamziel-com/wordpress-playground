import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
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
};

type ExpandedNodePaths = Record<string, boolean>;

type LoadedChildrenMap = Record<string, FileNode[]>;

const FilePickerTree: React.FC<FilePickerControlProps> = ({
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
}) => {
	const [expanded, setExpanded] = useState<ExpandedNodePaths>(() => {
		if (!initialPath) {
			return {};
		}
		const initialExpanded: ExpandedNodePaths = {};
		const pathParts = initialPath.split('/');
		for (let i = 0; i < pathParts.length; i++) {
			const pathSoFar = pathParts.slice(0, i + 1).join('/');
			initialExpanded[pathSoFar] = true;
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
	const lazyChildrenRef = useRef(lazyChildren);
	const loadingPathsRef = useRef(loadingPaths);

	useEffect(() => {
		lazyChildrenRef.current = lazyChildren;
	}, [lazyChildren]);

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
			return parentPath
				? `${parentPath}/${node.name}`.replaceAll(/\\+/g, '/')
				: node.name;
		},
		[]
	);

	const getResolvedChildren = useCallback(
		(node: FileNode, path: string): FileNode[] | undefined => {
			if (node.children) {
				return node.children;
			}
			return lazyChildrenRef.current[path];
		},
		[]
	);

	const loadChildrenForPath = useCallback(
		async (path: string, node: FileNode) => {
			if (!onLoadChildren || node.type !== 'folder') {
				return;
			}
			const existingChildren =
				node.children ?? lazyChildrenRef.current[path];
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
			}
		},
		[expandNode, loadChildrenForPath]
	);

	useEffect(() => {
		if (!initialPath || !onLoadChildren) {
			return;
		}

		let isMounted = true;
		const loadInitialPath = async () => {
			const segments = initialPath.split('/');
			let currentChildren = files;
			let accumulatedPath = '';
			for (let i = 0; i < segments.length; i++) {
				const segment = segments[i];
				const nextNode = currentChildren?.find(
					(child) => child.name === segment
				);
				if (!nextNode) {
					break;
				}
				accumulatedPath = accumulatedPath
					? `${accumulatedPath}/${segment}`
					: segment;
				if (nextNode.type !== 'folder') {
					currentChildren = [];
					continue;
				}
				const existingChildren =
					nextNode.children ??
					lazyChildrenRef.current[accumulatedPath];
				if (!existingChildren && isMounted) {
					const loaded = await loadChildrenForPath(
						accumulatedPath,
						nextNode
					);
					currentChildren = loaded ?? [];
				} else {
					currentChildren = existingChildren ?? [];
				}
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
		const focusTarget = containerRef.current?.querySelector(
			`[data-path="${focusedPath}"]`
		) as HTMLElement | null;
		if (focusTarget && typeof focusTarget.focus === 'function') {
			focusTarget.focus();
		}
	}, [files, focusedPath, generatePath, lazyChildren, renamingPath]);

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

	const resolvedChildren = useMemo(
		() => getChildren(node, path) ?? [],
		[getChildren, node, path]
	);
	const isLoadingChildren = Boolean(loadingPaths[path]);

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
										isLoading={isLoadingChildren}
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
										isLoading={isLoadingChildren}
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
	isLoading?: boolean;
	hideName?: boolean;
}> = ({ node, level, isOpen, isLoading = false, hideName = false }) => {
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
			{isLoading && <Spinner className={css['inlineSpinner']} />}
			{!hideName && <span className={css['fileName']}>{node.name}</span>}
		</>
	);
};

export default FilePickerTree;
