export type GitLabURLInformation = {
	owner?: string;
	repo?: string;
	type: 'mr' | 'repo' | 'branch' | 'rawfile' | 'unknown';
	ref?: string;
	path?: string;
	mr?: number;
	host?: string;
};

/**
 * Analyzes a GitLab URL and extracts relevant information.
 *
 * GitLab URL formats:
 * - https://gitlab.com/owner/repo - basic repository
 * - https://gitlab.com/owner/repo/-/merge_requests/123 - merge request
 * - https://gitlab.com/owner/repo/-/tree/branch - branch view
 * - https://gitlab.com/owner/repo/-/tree/branch/path - path in branch
 * - https://gitlab.com/owner/repo/-/blob/branch/path/to/file - file view
 * - https://gitlab.com/owner/repo/-/raw/branch/path/to/file - raw file
 *
 * Also supports self-hosted GitLab instances (any hostname).
 */
export function staticAnalyzeGitLabURL(url: string): GitLabURLInformation {
	let urlObj;
	try {
		urlObj = new URL(url);
	} catch {
		return {
			type: 'unknown',
		};
	}

	const host = urlObj.hostname;
	const pathParts = urlObj.pathname.replace(/^\/+|\/+$/g, '').split('/');

	// GitLab projects can have nested namespaces (groups/subgroups)
	// The repo name is typically the last segment before /-/
	// For now, we'll handle the simple case of owner/repo
	if (pathParts.length < 2) {
		return {
			type: 'unknown',
			host,
		};
	}

	// Find the index of '-' which separates project path from the rest
	const dashIndex = pathParts.indexOf('-');

	let owner: string;
	let repo: string;
	let rest: string[];

	if (dashIndex === -1) {
		// No dash, so it's either a repo URL or something else
		// Could be owner/repo or a more complex path
		// For simplicity, treat first part as owner, second as repo
		owner = pathParts[0];
		repo = pathParts[1];
		rest = pathParts.slice(2);
	} else {
		// Everything before '-' is the project path
		const projectPath = pathParts.slice(0, dashIndex);
		if (projectPath.length < 2) {
			return {
				type: 'unknown',
				host,
			};
		}
		// For simplicity, first part is owner, second is repo
		// In practice, GitLab supports nested groups like group/subgroup/repo
		owner = projectPath.slice(0, -1).join('/');
		repo = projectPath[projectPath.length - 1];
		rest = pathParts.slice(dashIndex + 1);
	}

	let mr: number | undefined;
	let ref: string | undefined;
	let type: GitLabURLInformation['type'] = 'unknown';
	let path = '';

	if (rest.length === 0) {
		// Just owner/repo
		type = 'repo';
	} else if (rest[0] === 'merge_requests') {
		type = 'mr';
		mr = parseInt(rest[1]);
		if (isNaN(mr) || !mr) {
			throw new Error(
				`Invalid Merge Request number ${mr} parsed from the following GitLab URL: ${url}`
			);
		}
	} else if (rest[0] === 'raw') {
		type = 'rawfile';
		ref = rest[1];
		path = rest.slice(2).join('/');
	} else if (['blob', 'tree'].includes(rest[0])) {
		type = 'branch';
		ref = rest[1];
		path = rest.slice(2).join('/');
	}

	return { owner, repo, type, ref, path, mr, host };
}

/**
 * Checks if a URL is a GitLab URL
 */
export function isGitLabURL(url: string): boolean {
	try {
		const urlObj = new URL(url);
		// gitlab.com is the main GitLab instance
		// We also check for common GitLab self-hosted patterns
		if (urlObj.hostname === 'gitlab.com') {
			return true;
		}
		// For self-hosted, we'll need the user to configure or we can check
		// for gitlab in the hostname
		if (urlObj.hostname.includes('gitlab')) {
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

/**
 * Get the base URL from a GitLab URL
 */
export function getGitLabBaseUrl(url: string): string {
	try {
		const urlObj = new URL(url);
		return `${urlObj.protocol}//${urlObj.hostname}`;
	} catch {
		return 'https://gitlab.com';
	}
}
