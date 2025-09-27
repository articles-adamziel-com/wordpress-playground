import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import type { FileNode } from '@wp-playground/components';
import { FilePickerTree as CoreFilePickerTree } from '@wp-playground/components';
import type { PlaygroundClient } from '@wp-playground/client';

type NodeMap = Map<string, FileNode & { loaded?: boolean; loading?: boolean }>;

function normalizePath(path: string) {
	if (!path) return '/';
	const normalized =
		('/' + path).replace(/\/+/, '/').replace(/\/+$/, '') || '/';
	return normalized;
}

function toSegments(path: string) {
	const p = normalizePath(path);
	if (p === '/') return ['/'];
	const parts = p.split('/').filter(Boolean);
	const segments: string[] = [];
	let acc = '';
	for (const part of parts) {
		acc += '/' + part;
		segments.push(acc);
	}
	return segments.length ? segments : ['/'];
}

async function listDir(client: PlaygroundClient, path: string) {
	// listFiles returns names without the path by default
	const names = await client.listFiles(path);
	const results: { name: string; type: 'file' | 'folder' }[] = [];
	for (const name of names) {
		const childPath = path === '/' ? `/${name}` : `${path}/${name}`;
		// Prefer isDir to avoid stat costs; isDir is available on the client
		const isDirectory = await client.isDir(childPath).catch(() => false);
		results.push({ name, type: isDirectory ? 'folder' : 'file' });
	}
	return results.sort((a, b) => {
		// Folders first, then files; alphabetical within groups
		if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

function getParentPath(path: string) {
	const p = normalizePath(path);
	if (p === '/') return '';
	const lastSlash = p.lastIndexOf('/');
	return lastSlash <= 0 ? '/' : p.substring(0, lastSlash);
}

function getBaseName(path: string) {
	const p = normalizePath(path);
	if (p === '/') return '/';
	const parts = p.split('/').filter(Boolean);
	return parts[parts.length - 1] || '/';
}

function upsertChild(map: NodeMap, parentPath: string, child: FileNode) {
	const parent = map.get(parentPath);
	if (!parent) return;
	const prevChildren = parent.children || [];
	const existingIndex = prevChildren.findIndex((c) => c.name === child.name);
	let nextChildren: FileNode[];
	if (existingIndex >= 0) {
		nextChildren = prevChildren.slice();
		nextChildren[existingIndex] = child;
	} else {
		nextChildren = prevChildren.concat(child);
	}
	map.set(parentPath, { ...parent, children: nextChildren });
}

function cloneTreeFromMap(map: NodeMap, rootPath: string): FileNode[] {
	const root = map.get(rootPath);
	if (!root) return [];
	const clone = (nodePath: string): FileNode => {
		const node = map.get(nodePath)!;
		const base: FileNode = {
			name: node.name,
			type: node.type,
			children: undefined,
		};
		if (node.children) {
			const children: FileNode[] = [];
			for (const child of node.children) {
				const childPath =
					nodePath === '/'
						? `/${child.name}`
						: `${nodePath}/${child.name}`;
				children.push(clone(childPath));
			}
			base.children = children;
		}
		return base;
	};
	return [clone(rootPath)];
}

export default function PlaygroundFilePickerTree({
	root = '/wordpress',
	initialPath,
	excludePaths,
	onSelect,
	playgroundClient,
}: {
	root?: string;
	initialPath?: string;
	excludePaths?: string[];
	onSelect?: (path: string) => void;
	playgroundClient?: PlaygroundClient;
}) {
	const normalizedRoot = useMemo(() => normalizePath(root), [root]);
	const [treeVersion, setTreeVersion] = useState(0);
	const nodeMapRef = useRef<NodeMap>(new Map());
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);

	// Ensure the root exists in the map.
	useEffect(() => {
		nodeMapRef.current.clear();
		const rootName =
			normalizedRoot === '/' ? '/' : getBaseName(normalizedRoot);
		nodeMapRef.current.set(normalizedRoot, {
			name: rootName,
			type: 'folder',
			children: [],
			loaded: false,
		});
		setTreeVersion((v) => v + 1);
	}, [normalizedRoot]);

	const loadChildren = useCallback(
		async (dirPath: string) => {
			dirPath = normalizePath(dirPath);
			const map = nodeMapRef.current;
			const node = map.get(dirPath);
			if (!node || node.type !== 'folder') return;
			if ((node as any).loading || (node as any).loaded) return;
			(node as any).loading = true;
			setTreeVersion((v) => v + 1);
			try {
				if (!playgroundClient) {
					throw new Error('Playground client is not ready yet.');
				}
				const items = await listDir(playgroundClient, dirPath);
				// Reset children to reflect latest listing
				map.set(dirPath, {
					...node,
					children: [],
				});
				for (const item of items) {
					const childPath =
						dirPath === '/'
							? `/${item.name}`
							: `${dirPath}/${item.name}`;
					if (excludePaths?.includes(childPath)) {
						continue;
					}
					const childNode: FileNode = {
						name: item.name,
						type: item.type,
						children: item.type === 'folder' ? [] : undefined,
					};
					map.set(childPath, { ...childNode, loaded: false });
					upsertChild(map, dirPath, childNode);
				}
				(map.get(dirPath) as any).loaded = true;
			} catch (e: any) {
				setError(e?.message || String(e));
			} finally {
				(map.get(dirPath) as any).loading = false;
				setTreeVersion((v) => v + 1);
			}
		},
		[playgroundClient, excludePaths]
	);

	// Prefetch ancestors for initialPath, expanding lazily along the way
	useEffect(() => {
		let cancelled = false;
		const run = async () => {
			if (!initialPath) return;
			setIsLoading(true);
			try {
				const segments = toSegments(initialPath);
				for (const seg of segments) {
					const parent = getParentPath(seg) || normalizedRoot;
					// Ensure parent exists in map
					if (!nodeMapRef.current.has(parent)) {
						const baseName =
							parent === '/' ? '/' : getBaseName(parent);
						nodeMapRef.current.set(parent, {
							name: baseName,
							type: 'folder',
							children: [],
							loaded: false,
						});
					}
					await loadChildren(parent);
					if (cancelled) return;
				}
			} finally {
				setIsLoading(false);
			}
		};
		void run();
		return () => {
			cancelled = true;
		};
	}, [initialPath, normalizedRoot, loadChildren]);

	const files = useMemo(() => {
		return cloneTreeFromMap(nodeMapRef.current, normalizedRoot);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [treeVersion, normalizedRoot]);

	const handleSelect = useCallback(
		(path: string) => {
			if (onSelect) onSelect(normalizePath(path));
		},
		[onSelect]
	);

	return (
		<CoreFilePickerTree
			files={files}
			initialPath={initialPath}
			onSelect={handleSelect}
			onExpand={(path) => loadChildren(path)}
			isLoading={isLoading}
			error={error}
		/>
	);
}
