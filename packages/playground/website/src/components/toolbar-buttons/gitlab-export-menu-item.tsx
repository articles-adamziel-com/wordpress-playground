import { MenuItem } from '@wordpress/components';
import { setActiveModal } from '../../lib/state/redux/slice-ui';
import type { PlaygroundDispatch } from '../../lib/state/redux/store';
import { useDispatch } from 'react-redux';
import { modalSlugs } from '../layout';

interface Props {
	onClose: () => void;
	disabled?: boolean;
}
export function GitLabExportMenuItem({ onClose, disabled }: Props) {
	const dispatch: PlaygroundDispatch = useDispatch();
	return (
		<MenuItem
			aria-label="Export WordPress theme, plugin, or wp-content directory to a GitLab repository as a Merge Request."
			disabled={disabled}
			onClick={() => {
				dispatch(setActiveModal(modalSlugs.GITLAB_EXPORT));
				onClose();
			}}
		>
			Export to GitLab
		</MenuItem>
	);
}
