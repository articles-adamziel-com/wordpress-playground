import { useEffect, useState, useCallback } from 'react';
import { usePlaygroundClient } from '../../lib/use-playground-client';
import type {
	TimelineEntry,
	TimelineSession,
	TimelineExportFormat,
} from '@php-wasm/logger';
import type { DebugLogAPI } from '@wp-playground/remote';
import css from './style.module.css';
import classNames from 'classnames';

interface TimelineEntryRowProps {
	entry: TimelineEntry;
}

const categoryColors: Record<string, string> = {
	blueprint: css.categoryBlueprint,
	php: css.categoryPhp,
	navigation: css.categoryNavigation,
	runtime: css.categoryRuntime,
	filesystem: css.categoryFilesystem,
	external: css.categoryExternal,
};

function TimelineEntryRow({ entry }: TimelineEntryRowProps) {
	const formattedTime = entry.timestamp.replace('T', ' ').replace('Z', '');

	return (
		<div
			className={classNames(
				css.entryRow,
				categoryColors[entry.category] || ''
			)}
		>
			<span className={css.timestamp}>[{formattedTime}]</span>
			<span className={css.category}>{entry.category}</span>
			<span className={css.type}>{entry.type}</span>
			<span className={css.message}>{entry.message}</span>
			{entry.data && Object.keys(entry.data).length > 0 && (
				<details className={css.dataExpander}>
					<summary>Data</summary>
					<pre>{JSON.stringify(entry.data, null, 2)}</pre>
				</details>
			)}
		</div>
	);
}

interface SessionSelectorProps {
	sessions: TimelineSession[];
	selectedId: string | null;
	onSelect: (id: string | null) => void;
}

function SessionSelector({
	sessions,
	selectedId,
	onSelect,
}: SessionSelectorProps) {
	if (sessions.length === 0) {
		return null;
	}

	return (
		<select
			className={css.sessionSelect}
			value={selectedId || ''}
			onChange={(e) => onSelect(e.target.value || null)}
		>
			{sessions.map((session) => {
				const date = new Date(session.startTime);
				const label = `${date.toLocaleDateString()} ${date.toLocaleTimeString()} (${session.entryCount} entries)`;
				return (
					<option key={session.id} value={session.id}>
						{label}
					</option>
				);
			})}
		</select>
	);
}

export function DebugTimelineView() {
	const client = usePlaygroundClient();
	const [sessions, setSessions] = useState<TimelineSession[]>([]);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
		null
	);
	const [entries, setEntries] = useState<TimelineEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState('');
	const [debugLog, setDebugLog] = useState<DebugLogAPI | null>(null);

	// Resolve the debugLog property which might be a Promise or direct value
	useEffect(() => {
		if (!client) {
			setLoading(false);
			return;
		}

		// The debugLog property is set directly on the client, not through Comlink,
		// but TypeScript thinks it might be wrapped. We access it directly.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const maybeDebugLog = (client as any).debugLog;
		if (!maybeDebugLog) {
			setLoading(false);
			return;
		}

		// Check if it's a Promise or direct object
		if (typeof maybeDebugLog.then === 'function') {
			maybeDebugLog.then((resolved: DebugLogAPI | undefined) => {
				setDebugLog(resolved || null);
				setLoading(false);
			});
		} else {
			setDebugLog(maybeDebugLog);
			setLoading(false);
		}
	}, [client]);

	useEffect(() => {
		if (!debugLog) return;

		debugLog.listSessions().then((sessionList: TimelineSession[]) => {
			setSessions(sessionList);
			if (sessionList.length > 0) {
				setSelectedSessionId(sessionList[0].id);
			}
		});
	}, [debugLog]);

	useEffect(() => {
		if (!debugLog || !selectedSessionId) return;

		debugLog.readSession(selectedSessionId).then(setEntries);
	}, [debugLog, selectedSessionId]);

	// Periodically refresh entries for the current session
	useEffect(() => {
		if (!debugLog || !selectedSessionId) return;

		const interval = setInterval(async () => {
			const currentSession = debugLog.getCurrentSession();
			if (currentSession && currentSession.id === selectedSessionId) {
				const newEntries =
					await debugLog.readSession(selectedSessionId);
				setEntries(newEntries);
			}
		}, 2000);

		return () => clearInterval(interval);
	}, [debugLog, selectedSessionId]);

	const handleExport = useCallback(
		async (format: TimelineExportFormat) => {
			if (!debugLog || !selectedSessionId) return;

			const content = await debugLog.exportSession(
				selectedSessionId,
				format
			);
			const blob = new Blob([content], { type: 'text/plain' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `debug-timeline-${selectedSessionId}.${format}`;
			a.click();
			URL.revokeObjectURL(url);
		},
		[debugLog, selectedSessionId]
	);

	const handleClear = useCallback(async () => {
		if (!debugLog) return;
		if (
			!window.confirm(
				'Are you sure you want to clear all debug timeline sessions?'
			)
		) {
			return;
		}
		await debugLog.clearSessions();
		setSessions([]);
		setEntries([]);
		setSelectedSessionId(null);
	}, [debugLog]);

	const filteredEntries = entries.filter(
		(entry) =>
			!filter ||
			entry.message.toLowerCase().includes(filter.toLowerCase()) ||
			entry.type.toLowerCase().includes(filter.toLowerCase()) ||
			entry.category.toLowerCase().includes(filter.toLowerCase())
	);

	if (loading) {
		return <div className={css.loading}>Loading timeline...</div>;
	}

	if (!debugLog) {
		return (
			<div className={css.notEnabled}>
				Debug Timeline is not enabled.
				<br />
				<br />
				Add <code>?debug-log=verbose</code> to the URL to enable it.
			</div>
		);
	}

	return (
		<div className={css.timelineContainer}>
			<div className={css.toolbar}>
				<SessionSelector
					sessions={sessions}
					selectedId={selectedSessionId}
					onSelect={setSelectedSessionId}
				/>
				<input
					type="text"
					placeholder="Filter entries..."
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					className={css.filterInput}
				/>
				<div className={css.actions}>
					<button onClick={() => handleExport('jsonl')}>JSONL</button>
					<button onClick={() => handleExport('json')}>JSON</button>
					<button onClick={() => handleExport('csv')}>CSV</button>
					<button onClick={handleClear} className={css.dangerButton}>
						Clear All
					</button>
				</div>
			</div>

			<div className={css.entriesList}>
				{filteredEntries.length === 0 ? (
					<div className={css.emptyState}>
						{entries.length === 0
							? 'No timeline entries yet. Perform some actions to see events.'
							: 'No entries match the filter.'}
					</div>
				) : (
					filteredEntries.map((entry, index) => (
						<TimelineEntryRow key={index} entry={entry} />
					))
				)}
			</div>
		</div>
	);
}

export default DebugTimelineView;
