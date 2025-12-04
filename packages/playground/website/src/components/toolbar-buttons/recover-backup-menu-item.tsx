import { MenuItem } from '@wordpress/components';
import { setActiveModal } from '../../lib/state/redux/slice-ui';
import type { PlaygroundDispatch } from '../../lib/state/redux/store';
import { useDispatch } from 'react-redux';
import { modalSlugs } from '../layout';

type Props = { onClose: () => void };
export function RecoverBackupMenuItem({ onClose }: Props) {
	const dispatch: PlaygroundDispatch = useDispatch();

	return (
		<MenuItem
			aria-label="Recover from a previous backup"
			onClick={() => {
				dispatch(setActiveModal(modalSlugs.RECOVER_BACKUP));
				if (typeof onClose === 'function') {
					onClose();
				}
			}}
		>
			Recover from backup
		</MenuItem>
	);
}
