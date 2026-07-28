import React, { useState, useCallback, useMemo } from 'react';
import { Button as WPButton } from '@wordpress/components';
import { Icon, chevronDown, chevronRight } from '@wordpress/icons';
import {
	listGitRefs,
	listGitFiles,
	resolveCommitHash,
	GitAuthenticationError,
} from '@wp-playground/storage';
import type { GitFileTree } from '@wp-playground/storage';
import { Spinner } from '../spinner';
import Button from '../button';
import css from './style.module.css';

export interface GitRepoImportFormProps {
	onSubmit: (config: {
		repoUrl: string;
		ref: string;
		refType: 'branch' | 'tag';
		sourcePath: string;
		targetPath: string;
	}) => void;
	onClose: () => void;
}

interface LoadingState {
	refs: boolean;
	files: boolean;
}

interface GitRefInfo {
	name: string;
	oid: string;
	type: 'branch' | 'tag';
}

export default function GitRepoImportForm({
	onSubmit,
	onClose,
}: GitRepoImportFormProps) {
	const [repoUrl, setRepoUrl] = useState('');
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState<LoadingState>({
		refs: false,
		files: false,
	});

	// Repository metadata
	const [refs, setRefs] = useState<GitRefInfo[]>([]);
	const [selectedRef, setSelectedRef] = useState<GitRefInfo | null>(null);
	const [fileTree, setFileTree] = useState<GitFileTree[] | null>(null);

	// User selections
	const [sourcePath, setSourcePath] = useState('/');
	const [targetPath, setTargetPath] = useState('/wordpress/wp-content');

	// UI state
	const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
		new Set(['/'])
	);
	const [repoLoaded, setRepoLoaded] = useState(false);

	const normalizeGitUrl = (url: string): string => {
		let normalized = url.trim();
		// Remove trailing slashes
		normalized = normalized.replace(/\/+$/, '');
		// Add .git suffix if not present and it's a GitHub/GitLab URL
		if (
			!normalized.endsWith('.git') &&
			(normalized.includes('github.com') ||
				normalized.includes('gitlab.com'))
		) {
			normalized = normalized + '.git';
		}
		// Convert SSH URLs to HTTPS
		if (normalized.startsWith('git@')) {
			normalized = normalized
				.replace('git@', 'https://')
				.replace(':', '/');
		}
		return normalized;
	};

	const handleLoadRepository = async () => {
		setErrors({});
		const normalizedUrl = normalizeGitUrl(repoUrl);
		if (!normalizedUrl) {
			setErrors({ url: 'Please enter a repository URL' });
			return;
		}

		setLoading({ refs: true, files: false });
		setRefs([]);
		setSelectedRef(null);
		setFileTree(null);
		setRepoLoaded(false);

		try {
			// Fetch branches
			const branchRefs = await listGitRefs(normalizedUrl, 'refs/heads/');
			const tagRefs = await listGitRefs(normalizedUrl, 'refs/tags/');

			const allRefs: GitRefInfo[] = [];

			// Process branches
			for (const [refPath, oid] of Object.entries(branchRefs)) {
				const name = refPath.replace('refs/heads/', '');
				allRefs.push({ name, oid, type: 'branch' });
			}

			// Process tags
			for (const [refPath, oid] of Object.entries(tagRefs)) {
				const name = refPath.replace('refs/tags/', '');
				allRefs.push({ name, oid, type: 'tag' });
			}

			if (allRefs.length === 0) {
				setErrors({
					url: 'No branches or tags found. Make sure the repository is public and the URL is correct.',
				});
				return;
			}

			// Sort: branches first (with main/master at top), then tags
			allRefs.sort((a, b) => {
				if (a.type !== b.type) {
					return a.type === 'branch' ? -1 : 1;
				}
				// Prioritize main/master
				if (a.name === 'main' || a.name === 'master') return -1;
				if (b.name === 'main' || b.name === 'master') return 1;
				return a.name.localeCompare(b.name);
			});

			setRefs(allRefs);
			setRepoUrl(normalizedUrl);
			setRepoLoaded(true);

			// Auto-select first ref (usually main/master)
			if (allRefs.length > 0) {
				await handleSelectRef(allRefs[0], normalizedUrl);
			}
		} catch (error) {
			if (error instanceof GitAuthenticationError) {
				setErrors({
					url: 'This repository requires authentication. Please use a public repository.',
				});
			} else {
				setErrors({
					url: `Failed to load repository: ${(error as Error).message}`,
				});
			}
		} finally {
			setLoading((prev) => ({ ...prev, refs: false }));
		}
	};

	const handleSelectRef = async (ref: GitRefInfo, url?: string) => {
		setSelectedRef(ref);
		setFileTree(null);
		setLoading((prev) => ({ ...prev, files: true }));
		setErrors({});
		setSourcePath('/');
		setExpandedFolders(new Set(['/']));

		const repoToUse = url || repoUrl;

		try {
			const commitHash = await resolveCommitHash(repoToUse, {
				value: ref.name,
				type: ref.type,
			});

			const files = await listGitFiles(repoToUse, commitHash);
			setFileTree(files);
		} catch (error) {
			setErrors({
				files: `Failed to load files: ${(error as Error).message}`,
			});
		} finally {
			setLoading((prev) => ({ ...prev, files: false }));
		}
	};

	const handleRefChange = async (
		event: React.ChangeEvent<HTMLSelectElement>
	) => {
		const refName = event.target.value;
		const ref = refs.find((r) => `${r.type}:${r.name}` === refName);
		if (ref) {
			await handleSelectRef(ref);
		}
	};

	const toggleFolder = useCallback((path: string) => {
		setExpandedFolders((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	const handleSelectPath = useCallback((path: string) => {
		setSourcePath(path);
	}, []);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedRef) {
			setErrors({ ref: 'Please select a branch or tag' });
			return;
		}
		if (!sourcePath) {
			setErrors({ sourcePath: 'Please select a source path' });
			return;
		}
		if (!targetPath.trim()) {
			setErrors({ targetPath: 'Please enter a target path' });
			return;
		}

		onSubmit({
			repoUrl,
			ref: selectedRef.name,
			refType: selectedRef.type,
			sourcePath: sourcePath === '/' ? '' : sourcePath,
			targetPath: targetPath.trim(),
		});
	};

	const isLoading = loading.refs || loading.files;
	const canSubmit = repoLoaded && selectedRef && !isLoading;

	return (
		<form onSubmit={handleSubmit} className={css.formContainer}>
			<div className={css.formSection}>
				<label className={css.formLabel}>Git Repository URL</label>
				<div style={{ display: 'flex', gap: 8 }}>
					<input
						type="text"
						value={repoUrl}
						className={css.repoInput}
						onChange={(e) => {
							setRepoUrl(e.target.value);
							setRepoLoaded(false);
							setRefs([]);
							setFileTree(null);
						}}
						placeholder="https://github.com/owner/repo.git"
						autoFocus
						disabled={loading.refs}
					/>
					<WPButton
						variant="secondary"
						onClick={handleLoadRepository}
						disabled={!repoUrl.trim() || loading.refs}
					>
						{loading.refs ? 'Loading...' : 'Load'}
					</WPButton>
				</div>
				{errors.url && (
					<div className={css.errorMessage}>{errors.url}</div>
				)}
				<p className={css.formHint}>
					Enter the URL of a public Git repository (GitHub, GitLab,
					etc.)
				</p>
			</div>

			{repoLoaded && (
				<>
					<div className={css.formSection}>
						<label className={css.formLabel}>Branch or Tag</label>
						<select
							className={css.branchSelect}
							value={
								selectedRef
									? `${selectedRef.type}:${selectedRef.name}`
									: ''
							}
							onChange={handleRefChange}
							disabled={loading.files}
						>
							<option value="">-- Select a ref --</option>
							{refs.some((r) => r.type === 'branch') && (
								<optgroup label="Branches">
									{refs
										.filter((r) => r.type === 'branch')
										.map((ref) => (
											<option
												key={`branch:${ref.name}`}
												value={`branch:${ref.name}`}
											>
												{ref.name}
											</option>
										))}
								</optgroup>
							)}
							{refs.some((r) => r.type === 'tag') && (
								<optgroup label="Tags">
									{refs
										.filter((r) => r.type === 'tag')
										.map((ref) => (
											<option
												key={`tag:${ref.name}`}
												value={`tag:${ref.name}`}
											>
												{ref.name}
											</option>
										))}
								</optgroup>
							)}
						</select>
						{errors.ref && (
							<div className={css.errorMessage}>{errors.ref}</div>
						)}
					</div>

					{loading.files && (
						<div className={css.loadingContainer}>
							<Spinner size={30} />
							<span className={css.loadingText}>
								Loading repository files...
							</span>
						</div>
					)}

					{fileTree && !loading.files && (
						<div className={css.formSection}>
							<label className={css.formLabel}>
								Source Path in Repository
							</label>
							<p className={css.formHint}>
								Select a folder or the root to import
							</p>
							<div className={css.fileTreeContainer}>
								<GitFileTreeView
									files={fileTree}
									selectedPath={sourcePath}
									expandedFolders={expandedFolders}
									onToggleFolder={toggleFolder}
									onSelectPath={handleSelectPath}
									parentPath=""
								/>
							</div>
							<div className={css.selectedPathDisplay}>
								Selected: {sourcePath || '/'}
							</div>
							{errors.sourcePath && (
								<div className={css.errorMessage}>
									{errors.sourcePath}
								</div>
							)}
						</div>
					)}

					{fileTree && !loading.files && (
						<div className={css.formSection}>
							<label className={css.formLabel}>
								Target Path in Playground
							</label>
							<input
								type="text"
								value={targetPath}
								className={css.pathInput}
								onChange={(e) => setTargetPath(e.target.value)}
								placeholder="/wordpress/wp-content/plugins/my-plugin"
							/>
							<p className={css.formHint}>
								Where to write the files in your Playground
								(e.g., /wordpress/wp-content/plugins/my-plugin)
							</p>
							{errors.targetPath && (
								<div className={css.errorMessage}>
									{errors.targetPath}
								</div>
							)}
						</div>
					)}
				</>
			)}

			<div className={css.submitRow}>
				<WPButton variant="tertiary" onClick={onClose}>
					Cancel
				</WPButton>
				<Button
					type="submit"
					variant="primary"
					size="large"
					disabled={!canSubmit}
				>
					Create Playground
				</Button>
			</div>
		</form>
	);
}

interface GitFileTreeViewProps {
	files: GitFileTree[];
	selectedPath: string;
	expandedFolders: Set<string>;
	onToggleFolder: (path: string) => void;
	onSelectPath: (path: string) => void;
	parentPath: string;
}

function GitFileTreeView({
	files,
	selectedPath,
	expandedFolders,
	onToggleFolder,
	onSelectPath,
	parentPath,
}: GitFileTreeViewProps) {
	// Sort: folders first, then files, alphabetically
	const sortedFiles = useMemo(() => {
		return [...files].sort((a, b) => {
			if (a.type !== b.type) {
				return a.type === 'folder' ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});
	}, [files]);

	// Show root selector first if we're at the top level
	const isTopLevel = parentPath === '';

	return (
		<div>
			{isTopLevel && (
				<div
					className={`${css.treeNode} ${selectedPath === '/' ? css.treeNodeSelected : ''}`}
					onClick={() => onSelectPath('/')}
				>
					<span className={css.treeTogglePlaceholder} />
					<span className={css.treeNodeIcon}>📁</span>
					<span>/ (repository root)</span>
				</div>
			)}
			{sortedFiles.map((file) => {
				const fullPath = parentPath
					? `${parentPath}/${file.name}`
					: `/${file.name}`;
				const isFolder = file.type === 'folder';
				const isExpanded = expandedFolders.has(fullPath);
				const isSelected = selectedPath === fullPath;

				return (
					<div key={fullPath}>
						<div
							className={`${css.treeNode} ${isSelected ? css.treeNodeSelected : ''}`}
							onClick={() => {
								if (isFolder) {
									onSelectPath(fullPath);
								}
							}}
						>
							{isFolder ? (
								<span
									className={css.treeToggle}
									onClick={(e) => {
										e.stopPropagation();
										onToggleFolder(fullPath);
									}}
								>
									<Icon
										icon={
											isExpanded
												? chevronDown
												: chevronRight
										}
										size={16}
									/>
								</span>
							) : (
								<span className={css.treeTogglePlaceholder} />
							)}
							<span className={css.treeNodeIcon}>
								{isFolder ? '📁' : '📄'}
							</span>
							<span>{file.name}</span>
						</div>
						{isFolder &&
							isExpanded &&
							file.type === 'folder' &&
							file.children && (
								<div className={css.treeNodeChildren}>
									<GitFileTreeView
										files={file.children}
										selectedPath={selectedPath}
										expandedFolders={expandedFolders}
										onToggleFolder={onToggleFolder}
										onSelectPath={onSelectPath}
										parentPath={fullPath}
									/>
								</div>
							)}
					</div>
				);
			})}
		</div>
	);
}
