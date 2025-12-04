import { Semaphore } from '@php-wasm/util';
import type { Changeset } from './changeset';

export interface GitLabRequestOptions {
	headers?: Record<string, string>;
	body?: unknown;
}

export type GitLabClient = {
	token: string;
	baseUrl: string;
	request: <T>(
		method: string,
		path: string,
		options?: GitLabRequestOptions
	) => Promise<T>;
};

export function createGitLabClient(
	gitlabToken: string,
	baseUrl = 'https://gitlab.com'
): GitLabClient {
	const request = async <T>(
		method: string,
		path: string,
		options: GitLabRequestOptions = {}
	): Promise<T> => {
		const url = `${baseUrl}/api/v4${path}`;
		const headers: HeadersInit = {
			Authorization: `Bearer ${gitlabToken}`,
			'Content-Type': 'application/json',
			...(options.headers || {}),
		};

		const response = await fetch(url, {
			method,
			headers,
			body: options.body ? JSON.stringify(options.body) : undefined,
		});

		if (!response.ok) {
			const errorText = await response.text();
			const error = new Error(
				`GitLab API error: ${response.status} ${response.statusText} - ${errorText}`
			) as Error & { status: number };
			error.status = response.status;
			throw error;
		}

		// Handle empty responses
		const text = await response.text();
		if (!text) {
			return {} as T;
		}
		return JSON.parse(text) as T;
	};

	return {
		token: gitlabToken,
		baseUrl,
		request,
	};
}

export type GitLabFiles = Record<string, Uint8Array>;

export function gitlabFilesListToObject(
	files: GitLabFileEntry[],
	root = ''
): GitLabFiles {
	if (root.length && !root.endsWith('/')) {
		root += '/';
	}
	const result: GitLabFiles = {};
	for (const file of files) {
		if (file.path.startsWith(root)) {
			result[file.path.substring(root.length)] = file.content;
		}
	}
	return result;
}

export interface GitLabFileEntry {
	path: string;
	name: string;
	content: Uint8Array;
}

export interface GetGitLabFilesProgress {
	foundFiles: number;
	downloadedFiles: number;
}

export interface GetGitLabFilesOptions {
	onProgress?: ({
		foundFiles,
		downloadedFiles,
	}: GetGitLabFilesProgress) => void;
	progress?: GetGitLabFilesProgress;
}

interface GitLabTreeItem {
	id: string;
	name: string;
	type: 'blob' | 'tree';
	path: string;
	mode: string;
}

/**
 * Encode project path for GitLab API URLs
 */
export function encodeProjectPath(owner: string, repo: string): string {
	return encodeURIComponent(`${owner}/${repo}`);
}

export async function getGitLabFilesFromDirectory(
	client: GitLabClient,
	owner: string,
	repo: string,
	ref: string,
	path: string,
	options: GetGitLabFilesOptions = {}
): Promise<GitLabFileEntry[]> {
	if (!options.progress) {
		options.progress = {
			foundFiles: 0,
			downloadedFiles: 0,
		};
	}
	const { onProgress } = options;
	const filePromises: Promise<GitLabFileEntry>[] = [];
	const directoryPromises: Promise<GitLabFileEntry[]>[] = [];

	const projectPath = encodeProjectPath(owner, repo);
	const encodedPath = path ? encodeURIComponent(path) : '';
	const queryParams = new URLSearchParams({
		ref,
		...(path ? { path } : {}),
	});

	// Fetch the content of the directory using GitLab's repository tree API
	const content = await client.request<GitLabTreeItem[]>(
		'GET',
		`/projects/${projectPath}/repository/tree?${queryParams.toString()}`
	);

	if (!Array.isArray(content)) {
		throw new Error(
			`Expected the list of files to be an array, but got ${typeof content}`
		);
	}

	for (const item of content) {
		if (item.type === 'blob') {
			++options.progress.foundFiles;
			onProgress?.(options.progress);
			filePromises.push(
				getGitLabFileContent(client, owner, repo, ref, item).then(
					(file) => {
						++options.progress!.downloadedFiles;
						onProgress?.(options.progress!);
						return file;
					}
				)
			);
		} else if (item.type === 'tree') {
			directoryPromises.push(
				getGitLabFilesFromDirectory(
					client,
					owner,
					repo,
					ref,
					item.path,
					options
				)
			);
		}
	}

	const files = await Promise.all(filePromises);
	const filesInDirs = (await Promise.all(directoryPromises)).flatMap(
		(dir) => dir
	);
	return [...files, ...filesInDirs];
}

const semaphore = new Semaphore({ concurrency: 15 });
async function getGitLabFileContent(
	client: GitLabClient,
	owner: string,
	repo: string,
	ref: string,
	item: { path: string; name: string }
): Promise<GitLabFileEntry> {
	const release = await semaphore.acquire();
	try {
		const projectPath = encodeProjectPath(owner, repo);
		const encodedFilePath = encodeURIComponent(item.path);

		// Use GitLab's repository files API
		const fileData = await client.request<{
			content: string;
			encoding: string;
		}>(
			'GET',
			`/projects/${projectPath}/repository/files/${encodedFilePath}?ref=${encodeURIComponent(ref)}`
		);

		return {
			name: item.name,
			path: item.path,
			content: base64ToUint8Array(fileData.content),
		};
	} finally {
		release();
	}
}

function base64ToUint8Array(base64: string): Uint8Array {
	const binaryString = window.atob(base64);
	const len = binaryString.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes;
}

interface GitLabProject {
	id: number;
	path_with_namespace: string;
	default_branch: string;
	permissions?: {
		project_access?: { access_level: number };
		group_access?: { access_level: number };
	};
}

interface GitLabUser {
	id: number;
	username: string;
}

export async function mayPushToGitLab(
	client: GitLabClient,
	owner: string,
	repo: string
): Promise<boolean> {
	const projectPath = encodeProjectPath(owner, repo);
	try {
		const project = await client.request<GitLabProject>(
			'GET',
			`/projects/${projectPath}`
		);

		// GitLab access levels: 30 = Developer, 40 = Maintainer, 50 = Owner
		// Developer level or higher can push
		const projectAccess =
			project.permissions?.project_access?.access_level || 0;
		const groupAccess = project.permissions?.group_access?.access_level || 0;
		return Math.max(projectAccess, groupAccess) >= 30;
	} catch {
		return false;
	}
}

interface GitLabBranch {
	name: string;
	commit: {
		id: string;
	};
}

export async function createOrUpdateGitLabBranch(
	client: GitLabClient,
	owner: string,
	repo: string,
	branch: string,
	ref: string
): Promise<void> {
	const projectPath = encodeProjectPath(owner, repo);
	const encodedBranch = encodeURIComponent(branch);

	// Check if branch exists
	let branchExists = false;
	try {
		await client.request<GitLabBranch>(
			'GET',
			`/projects/${projectPath}/repository/branches/${encodedBranch}`
		);
		branchExists = true;
	} catch {
		branchExists = false;
	}

	if (branchExists) {
		// Delete and recreate since GitLab doesn't have a direct update refs API like GitHub
		// Actually, we can use the commits API to push changes
		// For now, we'll handle this differently in the commit flow
	} else {
		// Create the branch
		await client.request<GitLabBranch>(
			'POST',
			`/projects/${projectPath}/repository/branches`,
			{
				body: {
					branch,
					ref,
				},
			}
		);
	}
}

interface GitLabFork {
	id: number;
	path_with_namespace: string;
	namespace: {
		path: string;
	};
}

/**
 * Fork a GitLab repository
 * @returns The namespace (username) of the forked repository
 */
export async function forkGitLabProject(
	client: GitLabClient,
	owner: string,
	repo: string
): Promise<string> {
	const projectPath = encodeProjectPath(owner, repo);

	// Get current user
	const user = await client.request<GitLabUser>('GET', '/user');

	// Check if fork already exists
	const forks = await client.request<GitLabFork[]>(
		'GET',
		`/projects/${projectPath}/forks`
	);

	const existingFork = forks.find(
		(fork) => fork.namespace.path === user.username
	);

	if (!existingFork) {
		// Create fork
		await client.request<GitLabFork>(
			'POST',
			`/projects/${projectPath}/fork`,
			{
				body: {
					namespace_path: user.username,
				},
			}
		);
	}

	return user.username;
}

interface GitLabCommitAction {
	action: 'create' | 'update' | 'delete';
	file_path: string;
	content?: string;
	encoding?: 'text' | 'base64';
}

interface GitLabCommitResponse {
	id: string;
	short_id: string;
	web_url: string;
}

/**
 * Create a commit with multiple file changes using GitLab's commits API
 */
export async function createGitLabCommit(
	client: GitLabClient,
	owner: string,
	repo: string,
	branch: string,
	message: string,
	changeset: Changeset,
	startBranch?: string
): Promise<string> {
	const projectPath = encodeProjectPath(owner, repo);
	const actions: GitLabCommitAction[] = [];

	// Add created files
	for (const [path, content] of changeset.create) {
		actions.push({
			action: 'create',
			file_path: path,
			content: uint8ArrayToBase64(content),
			encoding: 'base64',
		});
	}

	// Add updated files
	for (const [path, content] of changeset.update) {
		actions.push({
			action: 'update',
			file_path: path,
			content: uint8ArrayToBase64(content),
			encoding: 'base64',
		});
	}

	// Add deleted files
	for (const path of changeset.delete) {
		// Verify file exists before attempting to delete
		const encodedFilePath = encodeURIComponent(path);
		try {
			await client.request(
				'HEAD',
				`/projects/${projectPath}/repository/files/${encodedFilePath}?ref=${encodeURIComponent(branch)}`
			);
			actions.push({
				action: 'delete',
				file_path: path,
			});
		} catch {
			// File doesn't exist, skip deletion
		}
	}

	if (actions.length === 0) {
		throw new Error(
			'No changes were detected so there is nothing to commit.'
		);
	}

	const commitData: {
		branch: string;
		commit_message: string;
		actions: GitLabCommitAction[];
		start_branch?: string;
	} = {
		branch,
		commit_message: message,
		actions,
	};

	if (startBranch) {
		commitData.start_branch = startBranch;
	}

	const response = await client.request<GitLabCommitResponse>(
		'POST',
		`/projects/${projectPath}/repository/commits`,
		{
			body: commitData,
		}
	);

	return response.id;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	const binary = [];
	const len = bytes.byteLength;
	for (let i = 0; i < len; i++) {
		binary.push(String.fromCharCode(bytes[i]));
	}
	return window.btoa(binary.join(''));
}

interface GitLabMergeRequest {
	iid: number;
	web_url: string;
	source_branch: string;
	target_branch: string;
	state: string;
}

/**
 * Create a new merge request
 */
export async function createGitLabMergeRequest(
	client: GitLabClient,
	owner: string,
	repo: string,
	title: string,
	sourceBranch: string,
	targetBranch: string,
	description?: string
): Promise<GitLabMergeRequest> {
	const projectPath = encodeProjectPath(owner, repo);

	const response = await client.request<GitLabMergeRequest>(
		'POST',
		`/projects/${projectPath}/merge_requests`,
		{
			body: {
				source_branch: sourceBranch,
				target_branch: targetBranch,
				title,
				description: description || title,
			},
		}
	);

	return response;
}

/**
 * Get an existing merge request
 */
export async function getGitLabMergeRequest(
	client: GitLabClient,
	owner: string,
	repo: string,
	mrNumber: number
): Promise<GitLabMergeRequest> {
	const projectPath = encodeProjectPath(owner, repo);

	return client.request<GitLabMergeRequest>(
		'GET',
		`/projects/${projectPath}/merge_requests/${mrNumber}`
	);
}

/**
 * Get project information
 */
export async function getGitLabProject(
	client: GitLabClient,
	owner: string,
	repo: string
): Promise<GitLabProject> {
	const projectPath = encodeProjectPath(owner, repo);
	return client.request<GitLabProject>('GET', `/projects/${projectPath}`);
}

/**
 * Get branch information
 */
export async function getGitLabBranch(
	client: GitLabClient,
	owner: string,
	repo: string,
	branch: string
): Promise<GitLabBranch> {
	const projectPath = encodeProjectPath(owner, repo);
	const encodedBranch = encodeURIComponent(branch);
	return client.request<GitLabBranch>(
		'GET',
		`/projects/${projectPath}/repository/branches/${encodedBranch}`
	);
}

/**
 * Create a new branch
 */
export async function createGitLabBranch(
	client: GitLabClient,
	owner: string,
	repo: string,
	branch: string,
	ref: string
): Promise<GitLabBranch> {
	const projectPath = encodeProjectPath(owner, repo);

	return client.request<GitLabBranch>(
		'POST',
		`/projects/${projectPath}/repository/branches`,
		{
			body: {
				branch,
				ref,
			},
		}
	);
}
