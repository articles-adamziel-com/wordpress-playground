import { Icon, Spinner } from '@wordpress/components';
import { gitlabOAuthState, setGitLabOAuthToken } from '../state';
import { GitLabIcon } from '../gitlab';
import css from './style.module.css';
import { useState } from 'react';
import { useActiveSite } from '../../lib/state/redux/store';
import { Modal } from '../../components/modal';

export function GitLabOAuthGuardModal({ children }: GitLabOAuthGuardProps) {
	const [isModalOpen, setIsModalOpen] = useState(
		!gitlabOAuthState.value.token
	);

	if (gitlabOAuthState.value.token && !children) {
		return null;
	}

	if (!isModalOpen) {
		return null;
	}

	return (
		<Modal
			title="Connect to GitLab"
			onRequestClose={() => {
				setIsModalOpen(false);
			}}
		>
			<GitLabOAuthGuard mayLoseProgress={false}>
				{children}
			</GitLabOAuthGuard>
		</Modal>
	);
}

interface GitLabOAuthGuardProps {
	children?: React.ReactNode;
	mayLoseProgress?: boolean;
}

export default function GitLabOAuthGuard({
	children,
	mayLoseProgress,
}: GitLabOAuthGuardProps) {
	if (gitlabOAuthState.value.isAuthorizing) {
		return (
			<div>
				<Spinner />
				Authorizing...
			</div>
		);
	}

	if (gitlabOAuthState.value.token) {
		return <div>{children}</div>;
	}

	return <Authenticate mayLoseProgress={mayLoseProgress} />;
}

interface AuthenticateProps {
	mayLoseProgress?: boolean;
}

function Authenticate({ mayLoseProgress = undefined }: AuthenticateProps) {
	const storage = useActiveSite()?.metadata?.storage;
	const [token, setToken] = useState('');
	const [baseUrl, setBaseUrl] = useState('https://gitlab.com');
	const [error, setError] = useState<string | null>(null);

	if (mayLoseProgress === undefined) {
		mayLoseProgress = storage === 'none';
	}
	const [exported, setExported] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!token.trim()) {
			setError('Please enter a Personal Access Token');
			return;
		}

		// Validate the token by making a test request
		try {
			const response = await fetch(`${baseUrl}/api/v4/user`, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			if (!response.ok) {
				if (response.status === 401) {
					setError(
						'Invalid token. Please check your Personal Access Token.'
					);
				} else {
					setError(
						`Failed to authenticate: ${response.status} ${response.statusText}`
					);
				}
				return;
			}

			// Token is valid, save it
			setGitLabOAuthToken(token, baseUrl);
		} catch (err) {
			setError(
				'Failed to connect to GitLab. Please check the URL and try again.'
			);
		}
	};

	return (
		<div>
			<p>
				Export plugins, themes, and wp-content directories directly to
				your GitLab repositories.
			</p>
			<p>
				To enable this feature, you'll need to create a Personal Access
				Token in GitLab with <code>api</code> scope.
			</p>

			{mayLoseProgress ? (
				<>
					<p>
						<b>Note:</b> Your Playground is temporary. Be sure to
						export your Playground to a zip file before proceeding
						if you haven't already.
					</p>
					<label style={{ cursor: 'pointer' }}>
						<input
							type="checkbox"
							checked={exported}
							onChange={() => setExported(!exported)}
						/>
						I understand, and I have exported my Playground as a zip
						if needed.
					</label>
				</>
			) : null}

			<form onSubmit={handleSubmit}>
				<div className={css.formGroup}>
					<label>
						GitLab URL
						<input
							type="url"
							className={css.baseUrlInput}
							value={baseUrl}
							onChange={(e) => setBaseUrl(e.target.value)}
							placeholder="https://gitlab.com"
						/>
					</label>
					<div className={css.helpText}>
						Use https://gitlab.com for GitLab.com, or enter your
						self-hosted GitLab URL.
					</div>
				</div>

				<div className={css.formGroup}>
					<label>
						Personal Access Token
						<input
							type="password"
							className={css.tokenInput}
							value={token}
							onChange={(e) => setToken(e.target.value)}
							placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
							disabled={mayLoseProgress && !exported}
						/>
					</label>
					<div className={css.helpText}>
						Create a token at GitLab → Settings → Access Tokens with{' '}
						<code>api</code> scope.
						<br />
						<a
							href={`${baseUrl}/-/user_settings/personal_access_tokens`}
							target="_blank"
							rel="noopener noreferrer"
						>
							Create a Personal Access Token
						</a>
					</div>
				</div>

				{error && (
					<p style={{ color: 'red', marginBottom: '16px' }}>{error}</p>
				)}

				<button
					type="submit"
					className={`${css.gitlabButton} ${mayLoseProgress && !exported ? css.disabled : ''}`}
					disabled={mayLoseProgress && !exported}
				>
					<Icon icon={GitLabIcon} />
					Connect to GitLab
				</button>
			</form>

			<p style={{ marginTop: '16px', fontSize: '12px', color: '#666' }}>
				Your access token is stored only in your browser's memory and is
				not sent to any server other than GitLab.
			</p>
		</div>
	);
}
