import type { GitLabExportFormProps } from './form';
import GitLabExportForm from './form';
import { usePlaygroundClient } from '../../lib/use-playground-client';
import type { PlaygroundDispatch } from '../../lib/state/redux/store';
import { useDispatch } from 'react-redux';
import { setActiveModal } from '../../lib/state/redux/slice-ui';
import { Modal } from '../../components/modal';

interface GitLabExportModalProps {
	allowZipExport: GitLabExportFormProps['allowZipExport'];
	onExported?: GitLabExportFormProps['onExported'];
	initialFilesBeforeChanges?: GitLabExportFormProps['initialFilesBeforeChanges'];
	initialValues?: GitLabExportFormProps['initialValues'];
}
export function GitLabExportModal({
	onExported,
	allowZipExport,
	initialValues,
	initialFilesBeforeChanges,
}: GitLabExportModalProps) {
	const dispatch: PlaygroundDispatch = useDispatch();
	const playground = usePlaygroundClient();

	const closeModal = () => {
		dispatch(setActiveModal(null));
	};

	return (
		<Modal title="Export to GitLab" onRequestClose={closeModal}>
			<GitLabExportForm
				onClose={closeModal}
				onExported={onExported}
				playground={playground!}
				initialValues={initialValues}
				initialFilesBeforeChanges={initialFilesBeforeChanges}
				allowZipExport={allowZipExport}
			/>
		</Modal>
	);
}
