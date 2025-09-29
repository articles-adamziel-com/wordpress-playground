import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

import PlaygroundFilePickerTree, {
	type AsyncFilesystem,
} from '../../src/php-playground/components/file-explorer/PlaygroundFilePickerTree';
import type { PlaygroundState } from '../../src/php-playground/store';
import {
	DEFAULT_CODE,
	DEFAULT_PHP_VERSION,
	DEFAULT_WORKSPACE_DIR,
} from '../../src/php-playground/constants';
import { normalizePath } from '@php-wasm/util';

type DirNode = { type: 'dir'; children: Record<string, FsEntry> };
type FileNodeEntry = { type: 'file'; content: string };
type FsEntry = DirNode | FileNodeEntry;

const basePlaygroundState: PlaygroundState = {
	code: DEFAULT_CODE,
	currentPath: null,
	phpVersion: DEFAULT_PHP_VERSION,
	wpVersion: 'latest',
	phpVersions: [],
	wpVersions: [],
	bootStatus: 'ready',
	bootError: null,
	runRequestId: 0,
	client: null,
	initialized: true,
	wpVersionsLoading: false,
};

const createStore = () =>
	configureStore({
		reducer: {
			playground(
				state = { ...basePlaygroundState },
				action: { type: string; payload?: unknown }
			) {
				switch (action.type) {
					case 'playground/setCode':
						return {
							...state,
							code: action.payload as string,
						};
					case 'playground/setCurrentPath':
						return {
							...state,
							currentPath: action.payload as string | null,
						};
					default:
						return state;
				}
			},
		},
	});

const baseFilesystem: DirNode = {
	type: 'dir',
	children: {
		wordpress: {
			type: 'dir',
			children: {
				workspace: {
					type: 'dir',
					children: {
						'index.php': {
							type: 'file',
							content: "<?php echo 'Hello';",
						},
						'new-file.php': {
							type: 'file',
							content: "<?php echo 'Default';",
						},
						'notes.txt': {
							type: 'file',
							content: 'Workspace notes',
						},
						subdir: {
							type: 'dir',
							children: {
								'nested.php': {
									type: 'file',
									content: "<?php echo 'Nested';",
								},
							},
						},
						'New Folder': {
							type: 'dir',
							children: {},
						},
					},
				},
				'wp-content': {
					type: 'dir',
					children: {
						plugins: {
							type: 'dir',
							children: {
								'akismet.php': {
									type: 'file',
									content: "<?php echo 'Plugin';",
								},
							},
						},
						themes: {
							type: 'dir',
							children: {
								twentytwentyone: {
									type: 'dir',
									children: {
										'style.css': {
											type: 'file',
											content:
												'body { background: #fff; }',
										},
									},
								},
							},
						},
					},
				},
				'readme.html': {
					type: 'file',
					content: '<h1>Readme</h1>',
				},
			},
		},
		'notes.txt': {
			type: 'file',
			content: 'Root notes',
		},
	},
};

const cloneStructure = <T,>(value: T): T => structuredClone(value);

class InMemoryFilesystem implements AsyncFilesystem {
	private root: DirNode;

	constructor(snapshot: DirNode) {
		this.root = snapshot;
	}

	private resolve(path: string): FsEntry | undefined {
		const normalized = normalizePath(path);
		if (normalized === '/') {
			return this.root;
		}
		const segments = normalized.split('/').filter(Boolean);
		let current: FsEntry = this.root;
		for (const segment of segments) {
			if (current.type !== 'dir') {
				return undefined;
			}
			const next = current.children[segment];
			if (!next) {
				return undefined;
			}
			current = next;
		}
		return current;
	}

	private resolveDir(path: string): DirNode | undefined {
		const node = this.resolve(path);
		return node && node.type === 'dir' ? node : undefined;
	}

	private resolveParent(
		path: string
	): { parent: DirNode; name: string } | undefined {
		const normalized = normalizePath(path);
		if (normalized === '/') {
			return undefined;
		}
		const segments = normalized.split('/').filter(Boolean);
		const name = segments.pop();
		const parentPath = segments.length ? `/${segments.join('/')}` : '/';
		const parent = this.resolveDir(parentPath);
		if (!parent || !name) {
			return undefined;
		}
		return { parent, name };
	}

	async listFiles(path: string): Promise<string[]> {
		const dir = this.resolveDir(path);
		if (!dir) {
			return [];
		}
		return Object.keys(dir.children);
	}

	async isDir(path: string): Promise<boolean> {
		const normalized = normalizePath(path);
		if (normalized === '/') {
			return true;
		}
		const node = this.resolve(path);
		return !!node && node.type === 'dir';
	}

	async fileExists(path: string): Promise<boolean> {
		const node = this.resolve(path);
		return !!node && node.type === 'file';
	}

	async readFileAsBuffer(path: string): Promise<Uint8Array> {
		const text = await this.readFileAsText(path);
		return new TextEncoder().encode(text);
	}

	async readFileAsText(path: string): Promise<string> {
		const node = this.resolve(path);
		if (!node || node.type !== 'file') {
			throw new Error(`File not found: ${path}`);
		}
		return node.content;
	}

	async writeFile(path: string, data: Uint8Array | string): Promise<void> {
		const parentInfo = this.resolveParent(path);
		if (!parentInfo) {
			throw new Error(`Parent missing for ${path}`);
		}
		const content =
			typeof data === 'string' ? data : new TextDecoder().decode(data);
		parentInfo.parent.children[parentInfo.name] = {
			type: 'file',
			content,
		};
	}

	async mkdir(path: string): Promise<void> {
		const parentInfo = this.resolveParent(path);
		if (!parentInfo) {
			throw new Error(`Parent missing for ${path}`);
		}
		if (!parentInfo.parent.children[parentInfo.name]) {
			parentInfo.parent.children[parentInfo.name] = {
				type: 'dir',
				children: {},
			};
		}
	}

	async rmdir(path: string): Promise<void> {
		const parentInfo = this.resolveParent(path);
		if (!parentInfo) {
			return;
		}
		const target = parentInfo.parent.children[parentInfo.name];
		if (target && target.type === 'dir') {
			delete parentInfo.parent.children[parentInfo.name];
		}
	}

	async mv(source: string, destination: string): Promise<void> {
		const normalizedSource = normalizePath(source);
		const normalizedDestination = normalizePath(destination);
		if (normalizedSource === normalizedDestination) {
			return;
		}
		const sourceInfo = this.resolveParent(source);
		const entry = this.resolve(source);
		const targetInfo = this.resolveParent(destination);
		if (!sourceInfo || !targetInfo || !entry) {
			throw new Error('Unable to move path');
		}
		targetInfo.parent.children[targetInfo.name] = entry;
		delete sourceInfo.parent.children[sourceInfo.name];
	}

	async unlink(path: string): Promise<void> {
		const parentInfo = this.resolveParent(path);
		if (!parentInfo) {
			return;
		}
		const target = parentInfo.parent.children[parentInfo.name];
		if (target && target.type === 'file') {
			delete parentInfo.parent.children[parentInfo.name];
		}
	}
}

const createFilesystem = () =>
	new InMemoryFilesystem(cloneStructure(baseFilesystem));

type RenderOptions = {
	initialPath?: string;
	excludePaths?: string[];
	root?: string;
	filesystem?: AsyncFilesystem;
};

const renderTree = async (mount: any, options: RenderOptions = {}) => {
	const store = createStore();
	const filesystem = options.filesystem ?? createFilesystem();
	const component = await mount(
		<Provider store={store}>
			<PlaygroundFilePickerTree
				root={options.root ?? '/'}
				filesystem={filesystem}
				initialPath={options.initialPath ?? DEFAULT_WORKSPACE_DIR}
				excludePaths={options.excludePaths}
			/>
		</Provider>
	);
	return { component, filesystem, store };
};

const nodeLocator = (component: any, path: string) =>
	component.locator(`[data-path="${path}"]`);

const nodeButton = (component: any, path: string) =>
	component.locator(`button[data-path="${path}"]`).first();

const renameInput = (component: any, path: string) =>
	component.locator(`[data-path="${path}"] input`).first();

const expandNode = async (component: any, path: string) => {
	await nodeButton(component, path).click();
};

const expectFocused = async (component: any, path: string) => {
	await expect(nodeButton(component, path)).toHaveClass(/focused__/);
};

const expectSelected = async (component: any, path: string) => {
	await expect(nodeButton(component, path)).toHaveClass(/selected__/);
};

test('renders top level entries for the root filesystem', async ({ mount }) => {
	const { component } = await renderTree(mount);
	await expect(nodeButton(component, 'wordpress')).toBeVisible();
	await expect(nodeButton(component, 'notes.txt')).toBeVisible();
});
test('expands a folder on click to reveal its children', async ({ mount }) => {
	const { component } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	await expect(nodeButton(component, 'wordpress/workspace')).toBeVisible();
	await expect(nodeButton(component, 'wordpress/wp-content')).toBeVisible();
});

test('collapses a folder when it is toggled again', async ({ mount }) => {
	const { component } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	await expect(nodeButton(component, 'wordpress/workspace')).toBeVisible();
	await expandNode(component, 'wordpress');
	await expect(nodeLocator(component, 'wordpress/workspace')).toHaveCount(0);
});

test('arrow right expands the focused directory', async ({ mount }) => {
	const { component } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	const wpContent = nodeButton(component, 'wordpress/wp-content');
	await wpContent.focus();
	await wpContent.press('ArrowRight');
	await expect(
		nodeButton(component, 'wordpress/wp-content/plugins')
	).toBeVisible();
});

test('arrow left collapses an expanded folder in place', async ({ mount }) => {
	const { component } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	const wpContent = nodeButton(component, 'wordpress/wp-content');
	await wpContent.focus();
	await wpContent.press('ArrowRight');
	await expect(
		nodeButton(component, 'wordpress/wp-content/plugins')
	).toBeVisible();
	await wpContent.press('ArrowLeft');
	await expect(
		nodeLocator(component, 'wordpress/wp-content/plugins')
	).toHaveCount(0);
});

test('arrow left on a file returns focus to its parent folder', async ({
	mount,
}) => {
	const { component } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	await expandNode(component, 'wordpress/wp-content');
	const plugins = nodeButton(component, 'wordpress/wp-content/plugins');
	await plugins.focus();
	await plugins.press('ArrowRight');
	const akismet = nodeButton(
		component,
		'wordpress/wp-content/plugins/akismet.php'
	);
	await akismet.focus();
	await akismet.press('ArrowLeft');
	await expectFocused(component, 'wordpress/wp-content/plugins');
});

test('arrow down moves focus to the next visible node', async ({ mount }) => {
	const { component } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	const root = nodeButton(component, 'wordpress');
	await root.focus();
	await root.press('ArrowDown');
	await expectFocused(component, 'wordpress/workspace');
});

test('arrow up moves focus to the previous visible node', async ({ mount }) => {
	const { component } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	const workspace = nodeButton(component, 'wordpress/workspace');
	await workspace.focus();
	await workspace.press('ArrowUp');
	await expectFocused(component, 'wordpress');
});

test('type-ahead search focuses the first matching node', async ({ mount }) => {
	const { component } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	const root = nodeButton(component, 'wordpress');
	await root.focus();
	await root.press('n');
	await expectFocused(component, 'notes.txt');
});

test('folder context menu exposes creation actions', async ({
	mount,
	page,
}) => {
	const { component } = await renderTree(mount);
	await nodeButton(component, 'wordpress').click({ button: 'right' });
	await expect(component.getByRole('menu')).toBeVisible();
	await expect(
		component.getByRole('menuitem', { name: 'Create file' })
	).toBeVisible();
	await expect(
		component.getByRole('menuitem', { name: 'Create directory' })
	).toBeVisible();
	await page.keyboard.press('Escape');
});

test('file context menu omits folder-only actions', async ({ mount, page }) => {
	const { component } = await renderTree(mount);
	await nodeButton(component, 'notes.txt').click({ button: 'right' });
	await expect(component.getByRole('menu')).toBeVisible();
	await expect(
		component.getByRole('menuitem', { name: 'Create file' })
	).toHaveCount(0);
	await expect(
		component.getByRole('menuitem', { name: 'Create directory' })
	).toHaveCount(0);
	await expect(
		component.getByRole('menuitem', { name: 'Rename' })
	).toBeVisible();
	await page.keyboard.press('Escape');
});

test('renaming a file updates the label and filesystem entry', async ({
	mount,
}) => {
	const { component, filesystem } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	await expandNode(component, 'wordpress/workspace');
	await nodeButton(component, 'wordpress/workspace/index.php').click({
		button: 'right',
	});
	await component.getByRole('menuitem', { name: 'Rename' }).click();
	const inputPath = 'wordpress/workspace/index.php';
	const input = renameInput(component, inputPath);
	await expect(input).toBeVisible();
	await input.fill('main.php');
	await input.press('Enter');
	await expect(
		nodeButton(component, 'wordpress/workspace/main.php')
	).toBeVisible();
	await expectSelected(component, 'wordpress/workspace/main.php');
	await expect(
		filesystem.readFileAsText('/wordpress/workspace/main.php')
	).resolves.toContain('Hello');
});

test('renaming a directory keeps it expanded with its children', async ({
	mount,
}) => {
	const { component } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	await expandNode(component, 'wordpress/wp-content');
	await expandNode(component, 'wordpress/wp-content/themes');
	await nodeButton(component, 'wordpress/wp-content/themes').click({
		button: 'right',
	});
	await component.getByRole('menuitem', { name: 'Rename' }).click();
	const input = renameInput(component, 'wordpress/wp-content/themes');
	await input.fill('themes-legacy');
	await input.press('Enter');
	await expect(
		nodeButton(component, 'wordpress/wp-content/themes-legacy')
	).toBeVisible();
	await expect(
		nodeButton(
			component,
			'wordpress/wp-content/themes-legacy/twentytwentyone'
		)
	).toBeVisible();
});

test('escape cancels an in-progress rename', async ({ mount }) => {
	const { component } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	await expandNode(component, 'wordpress/workspace');
	await nodeButton(component, 'wordpress/workspace/index.php').click({
		button: 'right',
	});
	await component.getByRole('menuitem', { name: 'Rename' }).click();
	const input = renameInput(component, 'wordpress/workspace/index.php');
	await input.fill('temporary.php');
	await input.press('Escape');
	await expect(
		nodeButton(component, 'wordpress/workspace/index.php')
	).toBeVisible();
});

test('deleting a file removes it from the tree view', async ({ mount }) => {
	const { component, filesystem } = await renderTree(mount);
	await nodeButton(component, 'notes.txt').click({ button: 'right' });
	await component.getByRole('menuitem', { name: 'Delete' }).click();
	await expect(nodeLocator(component, 'notes.txt')).toHaveCount(0);
	await expect(filesystem.fileExists('/notes.txt')).resolves.toBe(false);
});

test('deleting a folder moves focus to its parent directory', async ({
	mount,
}) => {
	const { component, filesystem } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	await expandNode(component, 'wordpress/wp-content');
	await nodeButton(component, 'wordpress/wp-content/plugins').click({
		button: 'right',
	});
	await component.getByRole('menuitem', { name: 'Delete' }).click();
	await expect(
		nodeLocator(component, 'wordpress/wp-content/plugins')
	).toHaveCount(0);
	await expect(
		filesystem.isDir('/wordpress/wp-content/plugins')
	).resolves.toBe(false);
	await expectFocused(component, 'wordpress/wp-content');
});

test('creating a file through the context menu inserts a pending rename field', async ({
	mount,
}) => {
	const { component, filesystem } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	await expandNode(component, 'wordpress/wp-content');
	await nodeButton(component, 'wordpress/wp-content').click({
		button: 'right',
	});
	await component.getByRole('menuitem', { name: 'Create file' }).click();
	const pendingPath = 'wordpress/wp-content/new-file.php';
	const input = renameInput(component, pendingPath);
	await expect(input).toBeVisible();
	await input.fill('plugin.php');
	await input.press('Enter');
	await expect(
		nodeButton(component, 'wordpress/wp-content/plugin.php')
	).toBeVisible();
	await expect(
		filesystem.readFileAsText('/wordpress/wp-content/plugin.php')
	).resolves.toBe('');
});

test('creating a file reuses an available suffixed name when needed', async ({
	mount,
}) => {
	const { component, filesystem } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	await expandNode(component, 'wordpress/workspace');
	await nodeButton(component, 'wordpress/workspace').click({
		button: 'right',
	});
	await component.getByRole('menuitem', { name: 'Create file' }).click();
	const pendingPath = 'wordpress/workspace/new-file (1).php';
	const input = renameInput(component, pendingPath);
	await expect(input).toHaveValue('new-file (1).php');
	await input.press('Enter');
	await expect(nodeButton(component, pendingPath)).toBeVisible();
	await expect(
		filesystem.readFileAsText('/wordpress/workspace/new-file (1).php')
	).resolves.toBe('');
});

test('creating a directory through the context menu adds the new folder', async ({
	mount,
}) => {
	const { component, filesystem } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	await expandNode(component, 'wordpress/workspace');
	await nodeButton(component, 'wordpress/workspace').click({
		button: 'right',
	});
	await component.getByRole('menuitem', { name: 'Create directory' }).click();
	const pendingPath = 'wordpress/workspace/New Folder (1)';
	const input = renameInput(component, pendingPath);
	await expect(input).toHaveValue('New Folder (1)');
	await input.fill('assets');
	await input.press('Enter');
	await expect(
		nodeButton(component, 'wordpress/workspace/assets')
	).toBeVisible();
	await expect(filesystem.isDir('/wordpress/workspace/assets')).resolves.toBe(
		true
	);
});

test('invalid rename on a new file removes the placeholder entry', async ({
	mount,
}) => {
	const { component, filesystem } = await renderTree(mount);
	await expandNode(component, 'wordpress');
	await expandNode(component, 'wordpress/workspace');
	await nodeButton(component, 'wordpress/workspace').click({
		button: 'right',
	});
	await component.getByRole('menuitem', { name: 'Create file' }).click();
	const pendingPath = 'wordpress/workspace/new-file (1).php';
	const input = renameInput(component, pendingPath);
	await input.fill('');
	await input.press('Enter');
	await expect(nodeLocator(component, pendingPath)).toHaveCount(0);
	await expect(
		filesystem.fileExists('/wordpress/workspace/new-file (1).php')
	).resolves.toBe(false);
});
