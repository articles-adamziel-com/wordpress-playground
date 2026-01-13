import { useEffect, useState } from 'react';
import { logEventType, logger } from '@php-wasm/logger';

import classNames from 'classnames';
import css from './style.module.css';
import { Modal } from '../modal';
import { TextControl } from '@wordpress/components';
import type {
	PlaygroundDispatch,
	PlaygroundReduxState,
} from '../../lib/state/redux/store';
import { useDispatch, useSelector } from 'react-redux';
import { setActiveModal } from '../../lib/state/redux/slice-ui';
import { DebugTimelineView } from '../debug-timeline';
import { usePlaygroundClient } from '../../lib/use-playground-client';

type LogModalTab = 'logs' | 'timeline';

export function LogModal(props: { description?: JSX.Element; title?: string }) {
	const activeModal = useSelector(
		(state: PlaygroundReduxState) => state.ui.activeModal
	);
	const dispatch: PlaygroundDispatch = useDispatch();
	const [activeTab, setActiveTab] = useState<LogModalTab>('logs');
	const client = usePlaygroundClient();

	// Check if debug timeline is available
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const hasDebugTimeline = !!(client as any)?.debugLog;
	const showTimeline = hasDebugTimeline && activeTab === 'timeline';

	function onClose() {
		dispatch(setActiveModal(null));
	}

	return (
		<Modal
			title={
				props.title ||
				(hasDebugTimeline ? 'Logs & Timeline' : 'Error Logs')
			}
			onRequestClose={onClose}
		>
			<div>{props.description}</div>
			{hasDebugTimeline && (
				<div className={css.tabs}>
					<button
						className={classNames(css.tab, {
							[css.tabActive]: activeTab === 'logs',
						})}
						onClick={() => setActiveTab('logs')}
					>
						Error Logs
					</button>
					<button
						className={classNames(css.tab, {
							[css.tabActive]: activeTab === 'timeline',
						})}
						onClick={() => setActiveTab('timeline')}
					>
						Debug Timeline
					</button>
				</div>
			)}
			{showTimeline ? (
				<DebugTimelineView />
			) : (
				<SiteLogs key={activeModal} className={css.logsInsideModal} />
			)}
		</Modal>
	);
}

export function SiteLogs({ className }: { className?: string }) {
	const [logs, setLogs] = useState<string[]>([]);
	const [searchTerm, setSearchTerm] = useState('');

	const filteredLogs = logs.filter((log) =>
		log.toLowerCase().includes(searchTerm.toLowerCase())
	);

	useEffect(() => {
		getLogs();
		logger.addEventListener(logEventType, getLogs);
		return () => {
			logger.removeEventListener(logEventType, getLogs);
		};
	}, []);

	function getLogs() {
		// TODO: Fix log querying/listing to be per site
		setLogs(logger.getLogs());
	}

	function logList() {
		return filteredLogs.reverse().map((log, index) => (
			<div
				className={css.logEntry}
				key={index}
				dangerouslySetInnerHTML={{
					__html: log.replace(/Error:|Fatal:/, '<mark>$&</mark>'),
				}}
			/>
		));
	}

	return (
		<div className={classNames(css.logsComponent, className)}>
			{logs.length > 0 ? (
				<TextControl
					aria-label="Search"
					placeholder="Search logs"
					value={searchTerm}
					onChange={setSearchTerm}
					autoFocus={true}
					className={css.logSearch}
				/>
			) : null}
			<div className={css.logContentContainer}>
				{filteredLogs.length > 0 ? (
					<main className={css.logList}>{logList()}</main>
				) : logs.length > 0 ? (
					<div className={css.logEmptyPlaceholder}>
						No matching logs found.
					</div>
				) : (
					<div>
						Error logs for Playground, WordPress, and PHP will show
						up here when something goes wrong.
						<br />
						<br />
						No problems so far – yay! 🎉
					</div>
				)}
			</div>
		</div>
	);
}
