import { Icon, Spinner } from '@wordpress/components';
import { oAuthState } from '../state';
import { GitHubIcon } from '../github';
import css from './style.module.css';
import { useState } from 'react';
import classNames from 'classnames';
import { Modal } from '../../components/modal';
import { openGitHubAuthPopup } from '../popup-auth';

export function GitHubOAuthGuardModal({ children }: GitHubOAuthGuardProps) {
	const [isModalOpen, setIsModalOpen] = useState(!oAuthState.value.token);

	if (oAuthState.value.token && !children) {
		return null;
	}

	if (!isModalOpen) {
		return null;
	}

	return (
		<Modal
			title="Connect to GitHub"
			onRequestClose={() => {
				setIsModalOpen(false);
			}}
		>
			<GitHubOAuthGuard mayLoseProgress={false}>
				{children}
			</GitHubOAuthGuard>
		</Modal>
	);
}

interface GitHubOAuthGuardProps {
	children?: React.ReactNode;
	mayLoseProgress?: boolean;
}
export default function GitHubOAuthGuard({
	children,
}: GitHubOAuthGuardProps) {
	if (oAuthState.value.isAuthorizing) {
		return (
			<div>
				<Spinner />
				Authorizing...
			</div>
		);
	}

	if (oAuthState.value.token) {
		return <div>{children}</div>;
	}

	return <Authenticate />;
}

function Authenticate() {
	const [error, setError] = useState<string | null>(null);

	const handleConnect = async () => {
		setError(null);
		try {
			await openGitHubAuthPopup();
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Authentication failed'
			);
		}
	};

	return (
		<div>
			<p>
				Importing plugins, themes, and wp-content directories directly
				from your public GitHub repositories.
			</p>
			<p>
				To enable this feature, connect your GitHub account with
				WordPress Playground.
			</p>
			{error && (
				<p className={css.error}>
					{error}
				</p>
			)}
			<p>
				<button
					aria-label="Connect your GitHub account"
					className={classNames(css.githubButton)}
					onClick={handleConnect}
					type="button"
				>
					<Icon icon={GitHubIcon} />
					Connect your GitHub account
				</button>
			</p>
			<p>
				Your access token is not stored anywhere, which means you'll
				have to re-authenticate after every page refresh.
			</p>
		</div>
	);
}
