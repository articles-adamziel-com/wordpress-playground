import { useDispatch } from 'react-redux';
import {
	setActiveModal,
	setSiteManagerOpen,
} from '../../lib/state/redux/slice-ui';
import type { PlaygroundDispatch } from '../../lib/state/redux/store';
import { Modal } from '../modal';
import GitRepoImportForm from './form';
import { PlaygroundRoute, redirectTo } from '../../lib/state/url/router';

export function GitRepoImportModal() {
	const dispatch: PlaygroundDispatch = useDispatch();

	const closeModal = () => {
		dispatch(setActiveModal(null));
	};

	const handleSubmit = (config: {
		repoUrl: string;
		ref: string;
		refType: 'branch' | 'tag';
		sourcePath: string;
		targetPath: string;
	}) => {
		// Create a Blueprint with a writeFiles step using a git:directory resource
		const blueprint = {
			landingPage: '/wp-admin/',
			steps: [
				{
					step: 'writeFiles',
					writeToPath: config.targetPath,
					filesTree: {
						resource: 'git:directory',
						url: config.repoUrl,
						ref: config.ref,
						refType: config.refType,
						path: config.sourcePath || undefined,
					},
				},
			],
		};

		// Encode the blueprint as base64 for the URL
		const blueprintJson = JSON.stringify(blueprint);
		const blueprintBase64 = btoa(
			encodeURIComponent(blueprintJson).replace(
				/%([0-9A-F]{2})/g,
				(_, p1) => String.fromCharCode(parseInt(p1, 16))
			)
		);

		dispatch(setSiteManagerOpen(false));
		closeModal();

		// Redirect to a new temporary site with the blueprint
		redirectTo(
			PlaygroundRoute.newTemporarySite({
				query: {
					blueprint: blueprintBase64,
				},
			})
		);
	};

	return (
		<Modal
			title="Import from Git Repository"
			onRequestClose={closeModal}
			contentLabel='This is a dialog window which overlays the main content of the page. The modal begins with a heading 2 called "Import from Git Repository". Pressing the Close button will close the modal and bring you back to where you were on the page.'
		>
			<GitRepoImportForm onSubmit={handleSubmit} onClose={closeModal} />
		</Modal>
	);
}

export { GitRepoImportForm };
