/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { ImperativePanelHandle } from 'react-resizable-panels';

import styles from './layout.module.css';
import { Controls } from './Controls';
import { EditorHost } from './EditorHost';
import { HelpModal } from './HelpModal';
import FileExplorerSidebar from './FileExplorerSidebar';
import { PlaygroundManager } from './PlaygroundManager';
import { Terminal } from './Terminal';
import { useAppSelector } from '../hooks';
import AddressBar from '../../components/address-bar';
import { Spinner } from '../../components/spinner';
import { DEFAULT_WORKSPACE_DIR } from '../constants';

export const Layout = () => {
	const [isHelpOpen, setHelpOpen] = useState(false);
	const [isTerminalCollapsed, setTerminalCollapsed] = useState(false);
	const [terminalResizeToken, setTerminalResizeToken] = useState(0);
	const terminalPanelRef = useRef<ImperativePanelHandle | null>(null);
	const playgroundClient = useAppSelector((state) => state.playground.client);
	const bootStatus = useAppSelector((state) => state.playground.bootStatus);
	const currentPath = useAppSelector((state) => state.playground.currentPath);
	const [previewUrl, setPreviewUrl] = useState('');
	const [selectedDirPath, setSelectedDirPath] = useState<string | null>(
		DEFAULT_WORKSPACE_DIR
	);
	const [forceSelectedPath, setForceSelectedPath] = useState<string | null>(
		null
	);

	useEffect(() => {
		const previousTitle = document.title;
		document.title = 'WordPress PHP Playground';
		return () => {
			document.title = previousTitle;
		};
	}, []);

	useEffect(() => {
		if (!playgroundClient) {
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const url = await playgroundClient.getCurrentURL();
				if (!cancelled) setPreviewUrl(url || '');
			} catch (e) {
				void e;
			}
			try {
				await playgroundClient.onNavigation((url) => {
					setPreviewUrl(url);
				});
			} catch (e) {
				void e;
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [playgroundClient]);

	// treeInitialPath is computed within FileExplorer

	return (
		<div id="php-playground-react-root" className={styles.root}>
			<PlaygroundManager />
			<PanelGroup direction="horizontal" id="app" className={styles.app}>
				<Panel minSize={16} defaultSize={16} collapsible>
					<div className={styles.editorPane}>
						{bootStatus === 'ready' && playgroundClient ? (
							<FileExplorerSidebar
								playgroundClient={playgroundClient}
								currentPath={currentPath}
								selectedDirPath={selectedDirPath}
								setSelectedDirPath={setSelectedDirPath}
								forceSelectedPath={forceSelectedPath}
								setForceSelectedPath={setForceSelectedPath}
							/>
						) : (
							<div className={styles.fileExplorerContainer}>
								<div className={styles.fileExplorerHeader}>
									<span className={styles.fileExplorerTitle}>
										Files
									</span>
									<div className={styles.fileExplorerActions}>
										<button
											className={
												styles.fileExplorerButton
											}
											disabled
										>
											New File
										</button>
										<button
											className={
												styles.fileExplorerButton
											}
											disabled
										>
											New Folder
										</button>
									</div>
								</div>
								<div className={styles.fileExplorerTree}>
									<div
										className={styles.placeholderContainer}
										aria-live="polite"
									>
										<div
											className={
												styles.placeholderContent
											}
										>
											<div
												className={
													styles.placeholderHeading
												}
											>
												Preparing Playground…
											</div>
											<div
												className={
													styles.placeholderSubtext
												}
											>
												File explorer will be ready
												shortly
											</div>
											<div
												className={styles.skeletonList}
												aria-hidden="true"
											>
												<div
													className={
														styles.skeletonLine
													}
												></div>
												<div
													className={
														styles.skeletonLine
													}
												></div>
												<div
													className={clsx(
														styles.skeletonLine,
														styles.skeletonLineShort
													)}
												></div>
											</div>
										</div>
									</div>
								</div>
							</div>
						)}
					</div>
				</Panel>
				<PanelResizeHandle className={styles.horizontalHandle} />
				<Panel minSize={40}>
					<div className={styles.editorPane}>
						<Controls onHelpClick={() => setHelpOpen(true)} />
						<PanelGroup
							direction="vertical"
							className={styles.editorSplitGroup}
						>
							<Panel
								defaultSize={60}
								minSize={30}
								style={{ overflow: 'auto' }}
							>
								<div className={styles.editorContent}>
									{currentPath && (
										<div
											className={styles.filePathBar}
											title={currentPath}
										>
											<span
												className={styles.filePathText}
											>
												{currentPath}
											</span>
										</div>
									)}
									<EditorHost />
								</div>
							</Panel>
							<PanelResizeHandle
								className={styles.verticalHandle}
							/>
							<Panel
								ref={terminalPanelRef}
								minSize={15}
								collapsible
								onCollapse={() => setTerminalCollapsed(true)}
								onExpand={() => setTerminalCollapsed(false)}
								onResize={() =>
									setTerminalResizeToken((token) => token + 1)
								}
								className={styles.terminalPanel}
							>
								<section
									id="terminalSection"
									className={clsx(styles.terminalSection, {
										[styles.terminalSectionCollapsed]:
											isTerminalCollapsed,
									})}
									aria-label="Playground terminal"
								>
									<div className={styles.terminalPane}>
										<Terminal
											playgroundClient={playgroundClient}
											isCollapsed={isTerminalCollapsed}
											resizeToken={terminalResizeToken}
										/>
									</div>
									{bootStatus !== 'ready' ||
									!playgroundClient ? (
										<div
											className={styles.terminalOverlay}
											aria-live="polite"
											aria-busy="true"
										>
											<div
												className={
													styles.terminalOverlayContent
												}
											>
												<Spinner size={36} />
												<div>Starting Playground…</div>
												<div
													style={{
														opacity: 0.8,
														fontSize: '12px',
													}}
												>
													Terminal will be available
													shortly
												</div>
											</div>
										</div>
									) : null}
								</section>
							</Panel>
						</PanelGroup>
					</div>
				</Panel>
				<PanelResizeHandle className={styles.horizontalHandle} />
				<Panel minSize={15}>
					<div id="previewPane" className={styles.previewPane}>
						{bootStatus === 'ready' && playgroundClient ? (
							<div style={{ padding: '6px 8px' }}>
								<AddressBar
									url={previewUrl}
									onUpdate={(newUrl) =>
										playgroundClient.goTo(newUrl)
									}
								/>
							</div>
						) : null}
						<iframe
							id="preview"
							title="WordPress Playground"
							className={styles.preview}
						/>
					</div>
				</Panel>
			</PanelGroup>
			<HelpModal
				isOpen={isHelpOpen}
				onRequestClose={() => setHelpOpen(false)}
			/>
		</div>
	);
};
