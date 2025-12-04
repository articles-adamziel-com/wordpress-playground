import { signal } from '@preact/signals-react';

export interface GitLabOAuthState {
	token?: string;
	isAuthorizing: boolean;
	baseUrl?: string;
}

export const GITLAB_TOKEN_KEY = 'gitlab-token';
export const GITLAB_BASE_URL_KEY = 'gitlab-base-url';

// Store the token in localStorage in development mode so that it persists
// across page reloads.
const shouldStoreToken = process.env.NODE_ENV === 'development';

export const gitlabOAuthState = signal<GitLabOAuthState>({
	isAuthorizing: false,
	token: shouldStoreToken ? localStorage.getItem(GITLAB_TOKEN_KEY) || '' : '',
	baseUrl: shouldStoreToken
		? localStorage.getItem(GITLAB_BASE_URL_KEY) || 'https://gitlab.com'
		: 'https://gitlab.com',
});

export function setGitLabOAuthToken(token?: string, baseUrl?: string) {
	if (shouldStoreToken) {
		localStorage.setItem(GITLAB_TOKEN_KEY, token || '');
		if (baseUrl) {
			localStorage.setItem(GITLAB_BASE_URL_KEY, baseUrl);
		}
	}
	gitlabOAuthState.value = {
		...gitlabOAuthState.value,
		token,
		baseUrl: baseUrl || gitlabOAuthState.value.baseUrl,
	};
}
