import React, { useEffect } from 'react';
import { useState } from 'react';
import type { PlaygroundClient } from '@wp-playground/client';
import {
	wpContentFilesExcludedFromExport,
	zipWpContent,
} from '@wp-playground/client';

import css from './style.module.css';
import forms from '../../forms.module.css';
import Button from '../../components/button';
import {
	staticAnalyzeGitLabURL,
	getGitLabBaseUrl,
} from '../analyze-gitlab-url';
import type { Changeset, GitLabClient } from '@wp-playground/storage';
import {
	changeset,
	createGitLabClient,
	createGitLabCommit,
	createGitLabMergeRequest,
	getGitLabMergeRequest,
	getGitLabProject,
	getGitLabBranch,
	createGitLabBranch,
	getGitLabFilesFromDirectory,
	gitlabFilesListToObject,
	iterateFiles,
	mayPushToGitLab,
	forkGitLabProject,
} from '@wp-playground/storage';
import { gitlabOAuthState, setGitLabOAuthToken } from '../state';
import { Spinner } from '../../components/spinner';
import GitLabOAuthGuard from '../gitlab-oauth-guard';
import type { ContentType } from '../../github/import-from-github';
import { joinPaths } from '@php-wasm/util';
import MultiplePathsInput from './multiple-paths-input';
import type { FileEntry } from '@wp-playground/storage';

export interface GitLabExportFormProps {
	playground: PlaygroundClient;
	initialValues?: Partial<ExportFormValues>;
	initialFilesBeforeChanges?: any[];
	allowZipExport?: boolean;
	onExported?: (mrURL: string, formValues: ExportFormValues) => void;
	onClose: () => void;
}

let gitlabClient: GitLabClient;
function getClient() {
	if (!gitlabClient) {
		gitlabClient = createGitLabClient(
			gitlabOAuthState.value.token!,
			gitlabOAuthState.value.baseUrl
		);
	}
	return gitlabClient;
}

export type MergeRequestAction = 'update' | 'create';

export function asMergeRequestAction(
	value: any
): MergeRequestAction | undefined {
	if (value === 'update' || value === 'create') {
		return value;
	}
	return 'create';
}

export interface ExportFormValues {
	repoUrl: string;
	mrAction?: MergeRequestAction;
	mrNumber: string;
	contentType?: ContentType;
	toPathInRepo: string;
	fromPlaygroundRoot: string;
	relativeExportPaths: string[];
	commitMessage: string;
	plugin?: string;
	theme?: string;
	includeZip: boolean;
}

export default function GitLabExportForm({
	playground,
	onExported,
	onClose,
	initialValues = {},
	initialFilesBeforeChanges,
	allowZipExport = true,
}: GitLabExportFormProps) {
	const [pushResult, setPushResult] = useState<PushResult>();
	const [formValues, _setFormValues] = useState<ExportFormValues>({
		repoUrl: '',
		mrNumber: '',
		mrAction: 'create',
		commitMessage: 'Changes from WordPress Playground',
		relativeExportPaths: ['/'],
		toPathInRepo: '/',
		fromPlaygroundRoot: '/wordpress',
		includeZip: false,
		...initialValues,
	});
	const [repoDetails, setRepoDetails] = useState<{
		owner: string;
		repo: string;
	}>(() => {
		if (formValues.repoUrl) {
			try {
				const { owner, repo } = staticAnalyzeGitLabURL(
					formValues.repoUrl
				);
				return { owner: owner!, repo: repo! };
			} catch {
				// Ignore
			}
		}

		return { owner: '', repo: '' };
	});
	function setFormValues(values: ExportFormValues) {
		if (values.theme && !themes.includes(values.theme)) {
			values.theme = '';
		}
		if (values.plugin && !plugins.includes(values.plugin)) {
			values.plugin = '';
		}
		// The initialFilesBeforeChanges is valid for the repository
		// and path that the user initially entered. If those change,
		// we need to invalidate the initialFilesBeforeChanges.
		if (
			values.toPathInRepo !== formValues.toPathInRepo ||
			values.repoUrl !== formValues.repoUrl
		) {
			setFilesBeforeChanges(undefined);
		}
		_setFormValues(values);
	}

	const [errors, setErrors] = useState<Record<string, string>>({});
	const [plugins, setPlugins] = useState<string[]>([]);
	const [themes, setThemes] = useState<string[]>([]);
	const [filesBeforeChanges, setFilesBeforeChanges] = useState<
		any[] | undefined
	>(initialFilesBeforeChanges);

	useEffect(() => {
		if (!playground) return;
		async function computePluginsAndThemes() {
			const docRoot = await playground.documentRoot;
			const plugins = (
				await playground.listFiles(`${docRoot}/wp-content/plugins`)
			).filter(
				(pluginName) =>
					![
						'akismet',
						'wordpress-importer',
						'sqlite-database-integration',
						'hello.php',
						'index.php',
					].includes(pluginName)
			);
			const themes = await playground.listFiles(
				`${docRoot}/wp-content/themes`
			);
			setPlugins(plugins);
			setThemes(themes);
		}
		computePluginsAndThemes();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [!playground]);

	// Function to update form field values
	const setValue = <Field extends keyof ExportFormValues>(
		field: Field,
		value: ExportFormValues[Field]
	) => {
		setFormValues({
			...formValues,
			[field]: value,
		});
	};
	const setError = <Field extends keyof ExportFormValues>(
		field: Field,
		value: string
	) => {
		setErrors({
			...errors,
			[field]: value,
		});
	};

	const [isExporting, setIsExporting] = useState<boolean>(false);
	const [URLNeedsAnalyzing, setURLNeedsAnalyzing] = useState<boolean>(
		!initialValues.repoUrl || !initialValues.mrAction
	);

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setErrors({});

		const url = formValues.repoUrl?.trim();
		if (!url) {
			setError('repoUrl', 'Please enter a URL');
			return;
		}
		if (!formValues.contentType) {
			setError('contentType', 'Specify what you want to export');
			return;
		}
		if (formValues.contentType === 'theme' && !formValues.theme) {
			setError('theme', 'Specify the theme to export');
			return;
		}
		if (formValues.contentType === 'plugin' && !formValues.plugin) {
			setError('plugin', 'Specify the plugin to export');
			return;
		}
		if (URLNeedsAnalyzing) {
			const { type, owner, repo, path, mr } = staticAnalyzeGitLabURL(
				formValues.repoUrl
			);
			if (type === 'unknown') {
				setError('repoUrl', 'This URL is not supported');
				return;
			}
			setRepoDetails({
				owner: owner || '',
				repo: repo || '',
			});
			const updatedValues: Partial<ExportFormValues> = {};
			if (mr) {
				updatedValues['mrNumber'] = mr + '';
				updatedValues['mrAction'] = 'update';
			}
			if (path) {
				updatedValues['toPathInRepo'] = path;
			} else if (formValues.contentType === 'theme') {
				updatedValues['toPathInRepo'] = `/${formValues.theme}`;
			} else if (formValues.contentType === 'plugin') {
				updatedValues['toPathInRepo'] = `/${formValues.plugin}`;
			} else {
				updatedValues['toPathInRepo'] = '/';
			}
			setFormValues({
				...formValues,
				...updatedValues,
			});
			setURLNeedsAnalyzing(false);
			return;
		}
		if (!formValues.mrAction) {
			setError('mrAction', 'Please select an option');
			return;
		}
		if (formValues.mrAction === 'update' && !formValues.mrNumber) {
			setError('mrNumber', 'Please enter a Merge Request number');
			return;
		}
		if (!formValues.commitMessage) {
			setError('commitMessage', 'Specify a commit message');
			return;
		}

		let toPathInRepo = formValues.toPathInRepo.replace(/^\//g, '');
		if (!toPathInRepo) {
			toPathInRepo = '.';
		}

		setIsExporting(true);
		try {
			const client = getClient();

			const glProject = await getGitLabProject(
				client,
				repoDetails.owner,
				repoDetails.repo
			);
			const defaultBranch = glProject.default_branch;

			let glRawFiles: any[] = [];
			try {
				glRawFiles =
					filesBeforeChanges ||
					(await getGitLabFilesFromDirectory(
						client,
						repoDetails.owner,
						repoDetails.repo,
						defaultBranch,
						toPathInRepo
					));
			} catch {
				// ignore
			}
			const glComparableFiles = gitlabFilesListToObject(glRawFiles);

			let fromPlaygroundRoot = '';
			let relativeExportPaths = [];
			let mrTitle: string;
			const docroot = await playground.documentRoot;
			if (formValues.contentType === 'wp-content') {
				fromPlaygroundRoot = docroot;
				relativeExportPaths = ['/wp-content'];
				mrTitle = 'Update wp-content';
			} else if (formValues.contentType === 'theme') {
				fromPlaygroundRoot = `${docroot}/wp-content/themes/${formValues.theme}`;
				relativeExportPaths = [`./`];
				mrTitle = `Update theme ${formValues.theme}`;
			} else if (formValues.contentType === 'plugin') {
				fromPlaygroundRoot = `${docroot}/wp-content/plugins/${formValues.plugin}`;
				relativeExportPaths = [`./`];
				mrTitle = `Update plugin ${formValues.plugin}`;
			} else if (formValues.contentType === 'custom-paths') {
				fromPlaygroundRoot = formValues.fromPlaygroundRoot;
				relativeExportPaths = formValues.relativeExportPaths
					.map((path) => path.replace(/^\//g, ''))
					.filter(Boolean);
				mrTitle = `Update wp-content`;
			} else {
				throw new Error(
					`Unknown content type ${formValues.contentType}`
				);
			}

			if (relativeExportPaths.length === 0) {
				relativeExportPaths = ['/'];
			}

			const isoDateSlug = new Date().toISOString().replace(/[:.]/g, '-');
			const newBranchName = `playground-changes-${isoDateSlug}`;
			let commitMessage = formValues.commitMessage;

			if (allowZipExport && formValues.includeZip) {
				const zipFilename = `playground.zip`;
				const zipPath = joinPaths(fromPlaygroundRoot, zipFilename);
				relativeExportPaths.push(zipFilename);
				if (await playground.fileExists(zipPath)) {
					await playground.unlink(zipPath);
				}
				const zipContents = await zipWpContent(playground);
				await playground.writeFile(zipPath, zipContents);

				const baseUrl = getGitLabBaseUrl(formValues.repoUrl);
				const branchPreviewUrl = (branchName: string) => {
					const zipPath = [toPathInRepo, zipFilename]
						.filter(Boolean)
						.join('/');
					const zipballURL = `${baseUrl}/${repoDetails.owner}/${repoDetails.repo}/-/raw/${branchName}/${zipPath}`;
					const url = new URL(document.location.origin);
					url.pathname = document.location.pathname;
					url.searchParams.set('import-site', zipballURL);
					return url.toString();
				};

				let targetBranchName = '';
				if (parseInt(formValues.mrNumber, 10)) {
					const mr = await getGitLabMergeRequest(
						client,
						repoDetails.owner,
						repoDetails.repo,
						parseInt(formValues.mrNumber)
					);
					targetBranchName = mr.source_branch;
				} else {
					targetBranchName = newBranchName;
				}

				commitMessage +=
					'\n\n' +
					[
						'Also exported as a zip file.',
						'',
						`* [Preview loaded from this MR – available **before** this MR is merged](${branchPreviewUrl(
							targetBranchName
						)})`,
						`* [Preview loaded from the main branch – available **after** this MR is merged](${branchPreviewUrl(
							defaultBranch
						)})`,
					].join('\n');
			}

			const allPlaygroundFiles: FileEntry[] = [];
			for (const path of relativeExportPaths) {
				const iterator = iterateFiles(
					playground,
					joinPaths(fromPlaygroundRoot, path),
					{
						exceptPaths: wpContentFilesExcludedFromExport,
					}
				);
				for await (const file of iterator) {
					allPlaygroundFiles.push({
						path: joinPaths(
							toPathInRepo,
							file.path.substring(fromPlaygroundRoot.length)
						),
						read: file.read,
					});
				}
			}
			const changes = await changeset(
				new Map(Object.entries(glComparableFiles)),
				allPlaygroundFiles
			);

			const pushResult = await pushToGitLab(client, {
				owner: repoDetails.owner,
				repo: repoDetails.repo,
				commitMessage,
				changeset: changes,

				shouldCreateNewMR: formValues.mrAction === 'create',
				create: {
					againstBranch: defaultBranch,
					branchName: newBranchName,
					title: mrTitle,
				},
				update: {
					mrNumber: parseInt(formValues.mrNumber),
				},
			});

			setPushResult(pushResult);
			onExported?.(pushResult.url, formValues);
			return;
		} catch (e: any) {
			// Handle the "Bad Credentials" error
			if (e && e.status === 401) {
				setGitLabOAuthToken(undefined);
				throw e;
			}

			let eMessage = (e as any)?.message;
			eMessage = eMessage ? `(${eMessage})` : '';
			setError(
				'repoUrl',
				`There was an unexpected error ${eMessage}, please try again. If the problem persists, please report it at https://github.com/WordPress/wordpress-playground/issues.`
			);
			throw e;
		} finally {
			setIsExporting(false);
		}
	}

	if (pushResult) {
		return (
			<form id="export-playground-form" onSubmit={handleSubmit}>
				<h2>
					Merge Request{' '}
					{formValues.mrAction === 'create' ? 'created' : 'updated'}!
				</h2>
				<p>
					Your changes have been submitted to GitLab. You can view
					them here:{' '}
					<a
						href={pushResult.url}
						target="_blank"
						rel="noopener noreferrer"
					>
						{pushResult.url}
					</a>
				</p>

				{pushResult.forked && (
					<p>
						Because of access restrictions, these changes could not
						be submitted directly to the repository. Instead, they
						were submitted to your fork of the repository.
					</p>
				)}

				<div className={forms.submitRow}>
					<Button variant="primary" size="large" onClick={onClose}>
						Close this modal
					</Button>
				</div>
			</form>
		);
	}

	return (
		<GitLabOAuthGuard>
			<form id="export-playground-form" onSubmit={handleSubmit}>
				<p>
					You may export WordPress plugins, themes, and entire
					wp-content directories as merge requests to any GitLab
					repository.
				</p>

				<div className={`${forms.formGroup} ${forms.formGroupLast}`}>
					<label>
						I am exporting:
						<select
							className={css.repoInput}
							value={formValues.contentType}
							onChange={(e) =>
								setValue(
									'contentType',
									e.target.value as ContentType | undefined
								)
							}
						>
							<option value="">-- Select an option --</option>
							<option value="theme">A theme</option>
							<option value="plugin">A plugin</option>
							<option value="wp-content">
								wp-content directory
							</option>
							<option value="custom-paths">Specific paths</option>
						</select>
					</label>
					{errors.contentType && (
						<div className={forms.error}>{errors.contentType}</div>
					)}
				</div>
				{formValues.contentType === 'custom-paths' ? (
					<>
						<div
							className={`${forms.formGroup} ${forms.formGroupLast}`}
						>
							<div className={`${css.pathMappingGroup}`}>
								<label>
									From Playground path
									<input
										type="text"
										value={formValues.fromPlaygroundRoot}
										className={css.repoInput}
										onChange={(
											e: React.ChangeEvent<HTMLInputElement>
										) => {
											setValue(
												'fromPlaygroundRoot',
												e.target.value
											);
										}}
										placeholder="e.g. wp-content"
										autoFocus
									/>
								</label>
								<span className={css.pathMappingArrow}>➔</span>
								<label>
									To repository path
									<input
										type="text"
										className={css.repoInput}
										value={formValues.toPathInRepo}
										onChange={(e) =>
											setValue(
												'toPathInRepo',
												e.target.value
											)
										}
									/>
								</label>
							</div>
							{'fromPlaygroundRoot' in errors && (
								<div className={forms.error}>
									{errors.fromPlaygroundRoot}
								</div>
							)}
							{'toPathInRepo' in errors && (
								<div className={forms.error}>
									{errors.toPathInRepo}
								</div>
							)}
						</div>
						<div
							className={`${forms.formGroup} ${forms.formGroupLast}`}
						>
							<label>
								Paths to export – relative to the path root
								<MultiplePathsInput
									initialValue={
										formValues.relativeExportPaths
									}
									onChange={(paths) =>
										setValue('relativeExportPaths', paths)
									}
								/>
							</label>
							{errors.relativeExportPaths && (
								<div className={forms.error}>
									{errors.relativeExportPaths}
								</div>
							)}
						</div>
					</>
				) : null}
				{formValues.contentType === 'theme' ? (
					<div
						className={`${forms.formGroup} ${forms.formGroupLast}`}
					>
						<label>
							Which theme?
							<select
								className={css.repoInput}
								value={formValues.theme}
								onChange={(e) =>
									setValue('theme', e.target.value)
								}
							>
								<option value="">-- Select a theme --</option>
								{themes.map((theme) => (
									<option key={theme} value={theme}>
										{theme}
									</option>
								))}
							</select>
						</label>
						{errors.theme && (
							<div className={forms.error}>{errors.theme}</div>
						)}
					</div>
				) : null}
				{formValues.contentType === 'plugin' ? (
					<div
						className={`${forms.formGroup} ${forms.formGroupLast}`}
					>
						<label>
							Which plugin?
							<select
								className={css.repoInput}
								value={formValues.plugin}
								onChange={(e) =>
									setValue('plugin', e.target.value)
								}
							>
								<option value="">-- Select a plugin --</option>
								{plugins.map((plugin) => (
									<option key={plugin} value={plugin}>
										{plugin}
									</option>
								))}
							</select>
						</label>
						{errors.plugin && (
							<div className={forms.error}>{errors.plugin}</div>
						)}
					</div>
				) : null}
				<div className={`${forms.formGroup} ${forms.formGroupLast}`}>
					<label>
						{' '}
						I want my Merge Request to target this GitLab repo:
						<input
							type="text"
							value={formValues.repoUrl}
							className={css.repoInput}
							onChange={(
								e: React.ChangeEvent<HTMLInputElement>
							) => {
								setValue('repoUrl', e.target.value);
								setURLNeedsAnalyzing(true);
							}}
							placeholder="https://gitlab.com/my-org/my-repo/..."
							autoFocus
						/>
					</label>
					{'repoUrl' in errors ? (
						<div className={forms.error}>{errors.repoUrl}</div>
					) : null}
				</div>
				{formValues.repoUrl && !URLNeedsAnalyzing ? (
					<>
						<div
							className={`${forms.formGroup} ${forms.formGroupLast}`}
						>
							<label>
								Do you want to update an existing MR or create a
								new one?
								<select
									className={css.repoInput}
									value={formValues.mrAction}
									onChange={(e) =>
										setValue(
											'mrAction',
											e.target.value as MergeRequestAction
										)
									}
								>
									<option value="update">
										Update an existing MR
									</option>
									<option value="create">
										Create a new MR
									</option>
								</select>
							</label>
						</div>
						{formValues.mrAction === 'update' && (
							<div
								className={`${forms.formGroup} ${forms.formGroupLast}`}
							>
								<label>
									I want to update the MR number:
									<input
										type="text"
										className={css.repoInput}
										value={formValues.mrNumber}
										onChange={(e) =>
											setValue('mrNumber', e.target.value)
										}
									/>
								</label>
								{errors.mrNumber && (
									<div className={forms.error}>
										{errors.mrNumber}
									</div>
								)}
							</div>
						)}
						{formValues.repoUrl &&
						formValues.contentType !== 'custom-paths' ? (
							<div
								className={`${forms.formGroup} ${forms.formGroupLast}`}
							>
								<label>
									Enter the path in the repository where the
									changes should be committed:
									<input
										type="text"
										className={css.repoInput}
										value={formValues.toPathInRepo}
										onChange={(e) =>
											setValue(
												'toPathInRepo',
												e.target.value
											)
										}
									/>
								</label>
								{errors.pathInRepo && (
									<div className={forms.error}>
										{errors.pathInRepo}
									</div>
								)}
							</div>
						) : null}
						{formValues.repoUrl ? (
							<>
								<div
									className={`${forms.formGroup} ${forms.formGroupLast}`}
								>
									<label>
										Commit message:
										<textarea
											className={css.repoInput}
											rows={4}
											value={formValues.commitMessage}
											onChange={(e) =>
												setValue(
													'commitMessage',
													e.target.value
												)
											}
										/>
									</label>
									{errors.commitMessage && (
										<div className={forms.error}>
											{errors.commitMessage}
										</div>
									)}
								</div>
								{allowZipExport ? (
									<div
										className={`${forms.formGroup} ${forms.formGroupLast}`}
									>
										<label>
											<input
												type="checkbox"
												checked={formValues.includeZip}
												onChange={(e) =>
													setValue(
														'includeZip',
														e.target.checked
													)
												}
											/>
											Also export the changes as a zip
											file, so they can be imported into
											another Playground instance.
										</label>
									</div>
								) : null}
							</>
						) : null}
					</>
				) : null}
				<div className={forms.submitRow}>
					<Button
						disabled={!formValues.repoUrl || isExporting}
						type="submit"
						variant="primary"
						size="large"
					>
						{isExporting ? (
							formValues.mrAction === 'update' ? (
								<>
									<Spinner size={20} />
									Updating the Merge Request
								</>
							) : (
								<>
									<Spinner size={20} />
									Creating the Merge Request
								</>
							)
						) : URLNeedsAnalyzing ? (
							'Next step'
						) : formValues.mrAction === 'update' ? (
							`Update Merge Request !${formValues.mrNumber}`
						) : (
							'Create Merge Request'
						)}
					</Button>
				</div>
			</form>
		</GitLabOAuthGuard>
	);
}

type CreateMROptions = {
	title: string;
	branchName: string;
	againstBranch: string;
};
type UpdateMROptions = {
	mrNumber: number;
};
type PushToGitLabOptions = {
	owner: string;
	repo: string;
	commitMessage: string;
	changeset: Changeset;
	shouldCreateNewMR: boolean;
	create: CreateMROptions;
	update: UpdateMROptions;
	shouldFork?: boolean;
};

interface PushResult {
	url: string;
	forked: boolean;
}

async function pushToGitLab(
	client: GitLabClient,
	options: PushToGitLabOptions
): Promise<PushResult> {
	const {
		owner,
		repo,
		shouldCreateNewMR,
		commitMessage,
		changeset,
		shouldFork,
		create: { againstBranch, branchName: branchToCreate, title: mrTitle },
		update: { mrNumber },
	} = options;

	let pushToOwner = owner;
	if (shouldFork || !(await mayPushToGitLab(client, owner, repo))) {
		pushToOwner = await forkGitLabProject(client, owner, repo);
	}

	try {
		let pushToBranch: string;
		let mrUrl: string;

		if (shouldCreateNewMR) {
			// Get the default branch SHA to create our branch from
			const defaultBranch = await getGitLabBranch(
				client,
				pushToOwner,
				repo,
				againstBranch
			);

			pushToBranch = branchToCreate;

			// Create the new branch
			await createGitLabBranch(
				client,
				pushToOwner,
				repo,
				pushToBranch,
				defaultBranch.commit.id
			);

			// Create the commit with all changes
			await createGitLabCommit(
				client,
				pushToOwner,
				repo,
				pushToBranch,
				commitMessage,
				changeset
			);

			// Create the merge request
			const mr = await createGitLabMergeRequest(
				client,
				pushToOwner === owner ? owner : pushToOwner,
				repo,
				mrTitle || commitMessage,
				pushToOwner === owner
					? pushToBranch
					: `${pushToOwner}:${pushToBranch}`,
				againstBranch,
				commitMessage
			);

			mrUrl = mr.web_url;
		} else {
			// Update existing MR
			const existingMR = await getGitLabMergeRequest(
				client,
				owner,
				repo,
				mrNumber
			);

			pushToBranch = existingMR.source_branch;

			// Create a commit on the existing branch
			await createGitLabCommit(
				client,
				pushToOwner,
				repo,
				pushToBranch,
				commitMessage,
				changeset
			);

			mrUrl = existingMR.web_url;
		}

		return {
			url: mrUrl,
			forked: pushToOwner !== owner,
		};
	} catch (e: any) {
		if (
			e.status === 403 &&
			e.message?.includes('access') &&
			!shouldFork
		) {
			return await pushToGitLab(client, {
				...options,
				shouldFork: true,
			});
		}
		throw e;
	}
}
