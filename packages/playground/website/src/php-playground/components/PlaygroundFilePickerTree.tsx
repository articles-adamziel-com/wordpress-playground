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
	refreshToken = 0,
	renamingPath,
	onRename,
	onRenameCancel,
}: {
	root?: string;
	initialPath?: string;
	excludePaths?: string[];
	onSelect?: (path: string) => void;
	playgroundClient?: PlaygroundClient;
	refreshToken?: number;
	renamingPath?: string | null;
	onRename?: (path: string, newName: string) => void;
	onRenameCancel?: (path: string) => void;
}) {
	const normalizedRoot = useMemo(() => normalizePath(root), [root]);
	const rootName = useMemo(
		() => getBaseName(normalizedRoot),
		[normalizedRoot]
	);

	const [files, setFiles] = useState<FileNode[]>([]);
	const [isRootLoading, setIsRootLoading] = useState(false);

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
				if (!cancelled) setFiles(filtered as FileNode[]);
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
		refreshToken,
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
			return filtered as FileNode[];
		},
		[playgroundClient, normalizedRoot, excludePaths]
	);

	const handleSelect = useCallback(
		(path: string) => {
			if (onSelect) onSelect(normalizePath(path));
		},
		[onSelect]
	);

	return (
		<CoreFilePickerTree
			key={refreshToken}
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
		/>
	);
}
