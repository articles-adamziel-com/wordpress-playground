/* eslint-disable react-hooks/exhaustive-deps */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { FileNode } from '@wp-playground/components';
import { FilePickerTree as CoreFilePickerTree } from '@wp-playground/components';
import type { PlaygroundClient } from '@wp-playground/client';

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

export default function PlaygroundFilePickerTree({
	root = '/wordpress',
	initialPath,
	excludePaths,
	onSelect,
	playgroundClient,
	renamingPath,
	onRename,
	onRenameCancel,
	onContextMenu,
}: {
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
}) {
	const normalizedRoot = useMemo(() => normalizePath(root), [root]);
	const rootName = useMemo(
		() => getBaseName(normalizedRoot),
		[normalizedRoot]
	);

	const [files, setFiles] = useState<FileNode[]>([]);
	const [isRootLoading, setIsRootLoading] = useState(false);

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
		prioritizeRenaming,
	]);

	const coreInitialPath = useMemo(() => {
		return initialPath
			? toCorePath(initialPath, normalizedRoot)
			: undefined;
	}, [initialPath, normalizedRoot]);

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
			if (onSelect) onSelect(normalizePath(path));
		},
		[onSelect]
	);

	return (
		<CoreFilePickerTree
			files={files}
			initialPath={coreInitialPath}
			onSelect={handleSelect}
			onLoadChildren={handleLoadChildren}
			isLoading={normalizedRoot === '/' && isRootLoading}
			autoFocus={false}
			renamingPath={
				renamingPath
					? toCorePath(renamingPath, normalizedRoot)
					: undefined
			}
			onRename={(corePath, newName) => {
				if (!onRename) return;
				const absPath = corePathToAbsolute(corePath, normalizedRoot);
				onRename(absPath, newName);
			}}
			onRenameCancel={(corePath) => {
				if (!onRenameCancel) return;
				const absPath = corePathToAbsolute(corePath, normalizedRoot);
				onRenameCancel(absPath);
			}}
			onContextMenu={
				onContextMenu
					? (event, node, corePath) =>
							onContextMenu(
								event,
								node as FileNode,
								corePathToAbsolute(corePath, normalizedRoot)
							)
					: undefined
			}
		/>
	);
}
