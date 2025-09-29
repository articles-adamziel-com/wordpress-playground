import React, {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from 'react';
import {
	__experimentalTreeGrid as TreeGrid,
	__experimentalTreeGridRow as TreeGridRow,
	__experimentalTreeGridCell as TreeGridCell,
	Button,
} from '@wordpress/components';
import { Icon, chevronDown, chevronRight } from '@wordpress/icons';
import '@wordpress/components/build-style/style.css';
import css from './style.module.css';
import classNames from 'classnames';
import { file, folder } from '../icons';

type ExpandedNodePaths = Record<string, boolean>;

export type FileNode = {
	name: string;
	type: 'file' | 'folder';
	children?: FileNode[];
};

export type FilePickerTreeProps = {
	files: FileNode[];
	initialPath?: string;
	error?: string;
	onSelect?: (path: string) => void;
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
};

export type FilePickerTreeHandle = {
	focusPath: (
		path: string,
		options?: { select?: boolean; domFocus?: boolean; notify?: boolean }
	) => void;
	selectPath: (path: string) => void;
	getSelectedPath: () => string | null;
	expandToPath: (path: string) => Promise<void>;
	refresh: (path: string) => Promise<FileNode[] | undefined>;
	remapPath: (from: string, to: string) => void;
};

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

export const FilePickerTree = forwardRef<
	FilePickerTreeHandle,
	FilePickerTreeProps
>(function FilePickerTree(
	{
		files,
		initialPath,
		error,
		onSelect = () => {},
		onLoadChildren,
		onContextMenu,
		renamingPath = null,
		onRename,
		onRenameCancel,
		autoFocus = true,
	},
	ref
) {
	const [expanded, setExpanded] = useState<ExpandedNodePaths>(() => {
		if (!initialPath) {
			return {};
		}
		const initialExpanded: ExpandedNodePaths = {};
		for (const path of buildPathChain(initialPath)) {
			initialExpanded[path] = true;
		}
		return initialExpanded;
	});
	const [selectedPath, setSelectedPath] = useState<string | null>(
		() => initialPath ?? null
	);
	const [focusedPath, setFocusedPath] = useState<string | null>(
		() => initialPath ?? null
	);
	const [lazyChildren, setLazyChildren] = useState<
		Record<string, FileNode[]>
	>({});
	const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>(
		{}
	);

	const containerRef = useRef<HTMLDivElement>(null);
	const searchBufferTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const loadingPathsRef = useRef(loadingPaths);
	const lazyChildrenRef = useRef(lazyChildren);

	useEffect(() => {
		loadingPathsRef.current = loadingPaths;
	}, [loadingPaths]);

	useEffect(() => {
		lazyChildrenRef.current = lazyChildren;
	}, [lazyChildren]);

	const focusDomNode = (path: string) => {
		const focusTarget = containerRef.current?.querySelector(
			`[data-path="${path}"]`
		) as HTMLElement | null;
		if (focusTarget && typeof focusTarget.focus === 'function') {
			focusTarget.focus();
		}
	};

	const generatePath = (node: FileNode, parentPath = ''): string => {
		const raw = parentPath ? `${parentPath}/${node.name}` : node.name;
		return raw.replaceAll(/\\+/g, '/').replace(/\/{2,}/g, '/');
	};

	const getResolvedChildren = (
		node: FileNode,
		path: string
	): FileNode[] | undefined => {
		if (node.children) {
			return node.children;
		}
		return lazyChildren[path];
	};

	const loadChildrenForPath = (path: string, node: FileNode) => {
		if (!onLoadChildren || node.type !== 'folder') {
			return node.children;
		}
		const existingChildren = node.children ?? lazyChildrenRef.current[path];
		if (existingChildren || loadingPathsRef.current[path]) {
			return existingChildren;
		}
		setLoadingPaths((prev) => ({ ...prev, [path]: true }));
		return new Promise<FileNode[]>((resolve) => {
			onLoadChildren(path)
				.then((children) => {
					setLazyChildren((prev) => ({
						...prev,
						[path]: children ?? [],
					}));
					resolve(children ?? []);
				})
				.catch(() => {
					resolve([]);
				})
				.finally(() => {
					setLoadingPaths((prev) => {
						const next = { ...prev };
						delete next[path];
						return next;
					});
				});
		});
	};

	const refreshChildren = (path: string) => {
		if (!onLoadChildren) {
			return Promise.resolve(undefined);
		}
		setLoadingPaths((prev) => ({ ...prev, [path]: true }));
		return new Promise<FileNode[]>((resolve) => {
			onLoadChildren(path)
				.then((children) => {
					setLazyChildren((prev) => ({
						...prev,
						[path]: children ?? [],
					}));
					resolve(children ?? []);
				})
				.catch(() => {
					resolve([]);
				})
				.finally(() => {
					setLoadingPaths((prev) => {
						const next = { ...prev };
						delete next[path];
						return next;
					});
				});
		});
	};

	const toggleNode = (path: string, node: FileNode, isOpen: boolean) => {
		setExpanded((prev) => ({
			...prev,
			[path]: isOpen,
		}));
		if (isOpen) {
			void loadChildrenForPath(path, node);
		} else {
			setLazyChildren((prev) => {
				if (prev[path] === undefined) {
					return prev;
				}
				const next = { ...prev } as Record<string, FileNode[]>;
				delete next[path];
				return next;
			});
		}
	};

	const expandToPath = async (targetPath: string) => {
		if (!targetPath) return;
		const chain = buildPathChain(targetPath);
		if (chain.length === 0) return;
		setExpanded((prev) => {
			const next = { ...prev } as ExpandedNodePaths;
			for (const segment of chain) {
				next[segment] = true;
			}
			return next;
		});
		if (!onLoadChildren) {
			return;
		}

		let currentChildren: FileNode[] | undefined = files;
		let parentPath = '';
		for (const segmentPath of chain) {
			const nextNode = currentChildren?.find((child) => {
				const childPath = generatePath(child, parentPath);
				return childPath === segmentPath;
			});
			if (!nextNode || nextNode.type !== 'folder') {
				parentPath = segmentPath;
				currentChildren = [];
				continue;
			}
			const loaded = await loadChildrenForPath(segmentPath, nextNode);
			currentChildren = loaded ?? lazyChildrenRef.current[segmentPath];
			parentPath = segmentPath;
		}
	};

	const remapPathState = (from: string, to: string) => {
		if (!from || !to || from === to) {
			return;
		}
		const fromPrefix = from === '/' ? '/' : `${from}/`;
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
					next[mapped] = prev[key];
					delete next[key];
					changed = true;
				}
			}
			return changed ? next : prev;
		});

		setLazyChildren((prev) => {
			let changed = false;
			const next = { ...prev } as Record<string, FileNode[]>;
			for (const key of Object.keys(prev)) {
				const mapped = remapKey(key);
				if (mapped && mapped !== key) {
					next[mapped] = prev[key];
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
	};

	const selectPath = (path: string, notify = true) => {
		setSelectedPath(path);
		if (notify) {
			onSelect(path);
		}
	};

	useImperativeHandle(
		ref,
		() => ({
			focusPath: (
				path: string,
				options: {
					select?: boolean;
					domFocus?: boolean;
					notify?: boolean;
				} = {}
			) => {
				if (!path) return;
				const {
					select = true,
					domFocus = true,
					notify = false,
				} = options;
				if (select) {
					selectPath(path, notify);
				}
				setFocusedPath(path);
				if (domFocus) {
					focusDomNode(path);
				}
			},
			selectPath: (path: string) => {
				if (!path) return;
				selectPath(path);
				setFocusedPath(path);
				focusDomNode(path);
			},
			getSelectedPath: () => selectedPath,
			expandToPath: async (path: string) => await expandToPath(path),
			refresh: async (path: string) => await refreshChildren(path),
			remapPath: remapPathState,
		}),
		[]
	);

	const hasInitializedRef = useRef(false);
	const pendingInitialExpandRef = useRef<string | null>(initialPath ?? null);
	const previousInitialPathRef = useRef(initialPath);

	useEffect(() => {
		if (initialPath && initialPath !== previousInitialPathRef.current) {
			pendingInitialExpandRef.current = initialPath;
		} else if (!initialPath) {
			pendingInitialExpandRef.current = null;
		}
		previousInitialPathRef.current = initialPath;
	}, [initialPath]);
	useEffect(() => {
		if (!initialPath || hasInitializedRef.current) {
			return;
		}
		hasInitializedRef.current = true;
		const chain = buildPathChain(initialPath);
		setExpanded((prev) => {
			const next = { ...prev } as ExpandedNodePaths;
			for (const path of chain) {
				next[path] = true;
			}
			return next;
		});
		const target = chain[chain.length - 1] || initialPath;
		setFocusedPath(target);
		setSelectedPath(target);
		if (onLoadChildren) {
			void expandToPath(initialPath);
		}
	}, [initialPath, expandToPath, onLoadChildren]);

	useEffect(() => {
		const target = pendingInitialExpandRef.current;
		if (!target || !onLoadChildren || files.length === 0) {
			return;
		}
		pendingInitialExpandRef.current = null;
		void expandToPath(target);
	}, [files, expandToPath, onLoadChildren]);

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
		focusDomNode(focusedPath);
	}, [
		autoFocus,
		files,
		focusedPath,
		generatePath,
		renamingPath,
		focusDomNode,
	]);

	useEffect(() => {
		if (!onLoadChildren || files.length === 0) {
			return;
		}
		const rootNode = files[0];
		if (rootNode?.type !== 'folder' || rootNode.name !== '/') {
			return;
		}
		setExpanded((prev) => (prev['/'] ? prev : { ...prev, '/': true }));
		if (!lazyChildrenRef.current['/'] && !loadingPathsRef.current['/']) {
			void loadChildrenForPath('/', rootNode);
		}
	}, [files, onLoadChildren, loadChildrenForPath]);

	useEffect(() => {
		return () => {
			if (searchBufferTimeoutRef.current) {
				clearTimeout(searchBufferTimeoutRef.current);
			}
		};
	}, []);

	const [searchBuffer, setSearchBuffer] = useState('');

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key.length === 1 && event.key.match(/\S/)) {
			const newSearchBuffer = searchBuffer + event.key.toLowerCase();
			setSearchBuffer(newSearchBuffer);
			if (searchBufferTimeoutRef.current) {
				clearTimeout(searchBufferTimeoutRef.current);
			}
			searchBufferTimeoutRef.current = setTimeout(() => {
				setSearchBuffer('');
			}, 1000);
			if (!containerRef.current) {
				return;
			}
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
						setFocusedPath(path);
					}
					break;
				}
			}
		} else {
			setSearchBuffer('');
			if (searchBufferTimeoutRef.current) {
				clearTimeout(searchBufferTimeoutRef.current);
			}
		}
	};

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
						onToggle={toggleNode}
						selectedNode={selectedPath}
						focusPath={(path) => setFocusedPath(path)}
						focusedNode={focusedPath}
						selectPath={selectPath}
						generatePath={generatePath}
						getChildren={getResolvedChildren}
						onContextMenu={onContextMenu}
						renamingPath={renamingPath}
						onRename={onRename}
						onRenameCancel={onRenameCancel}
					/>
				))}
			</TreeGrid>
		</div>
	);
});

const NodeRow: React.FC<{
	node: FileNode;
	level: number;
	position: number;
	setSize: number;
	expandedNodePaths: ExpandedNodePaths;
	onToggle: (
		path: string,
		node: FileNode,
		isOpen: boolean
	) => void | Promise<void>;
	selectedNode: string | null;
	focusPath: (path: string) => void;
	focusedNode: string | null;
	selectPath: (path: string, notify?: boolean) => void;
	generatePath: (node: FileNode, parentPath?: string) => string;
	getChildren: (node: FileNode, path: string) => FileNode[] | undefined;
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
	onToggle,
	selectedNode,
	focusPath,
	focusedNode,
	selectPath,
	generatePath,
	getChildren,
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
			onToggle(path, node, !isExpanded);
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
				onToggle(path, node, !isExpanded);
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
			return;
		}
		if (
			event.key === 'ArrowLeft' ||
			event.key === 'ArrowRight' ||
			event.key === 'ArrowUp' ||
			event.key === 'ArrowDown'
		) {
			event.stopPropagation();
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
						onToggle={onToggle}
						selectedNode={selectedNode}
						focusPath={focusPath}
						focusedNode={focusedNode}
						selectPath={selectPath}
						generatePath={generatePath}
						getChildren={getChildren}
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
