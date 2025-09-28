import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { ImperativePanelHandle } from 'react-resizable-panels';

import styles from './layout.module.css';
import { Controls } from './Controls';
import { EditorHost } from './EditorHost';
import { HelpModal } from './HelpModal';
import PlaygroundFilePickerTree from './PlaygroundFilePickerTree';
import { PlaygroundManager } from './PlaygroundManager';
import { Terminal } from './Terminal';
import { useAppDispatch, useAppSelector } from '../hooks';
import { setCode } from '../store';

export const Layout = () => {
	const [isHelpOpen, setHelpOpen] = useState(false);
	const [isTerminalCollapsed, setTerminalCollapsed] = useState(false);
	const [terminalResizeToken, setTerminalResizeToken] = useState(0);
	const terminalPanelRef = useRef<ImperativePanelHandle | null>(null);
	const playgroundClient = useAppSelector((state) => state.playground.client);
	const bootStatus = useAppSelector((state) => state.playground.bootStatus);

	useEffect(() => {
		const previousTitle = document.title;
		document.title = 'WordPress PHP Playground';
		return () => {
			document.title = previousTitle;
		};
	}, []);

	useEffect(() => {
		if (!isHelpOpen) {
			return;
		}
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [isHelpOpen]);

	const handleOpenHelp = useCallback(() => setHelpOpen(true), []);
	const handleCloseHelp = useCallback(() => setHelpOpen(false), []);

	const dispatch = useAppDispatch();

	return (
		<div id="php-playground-react-root" className={styles.root}>
			<PlaygroundManager />
			<PanelGroup direction="horizontal" id="app" className={styles.app}>
				<>
					<Panel minSize={5} collapsible>
						<div className={styles.editorPane}>
							{bootStatus === 'ready' && playgroundClient && (
								<PlaygroundFilePickerTree
									playgroundClient={playgroundClient}
									root="/"
									initialPath="/wordpress/workspace"
									excludePaths={[
										'/dev',
										'/internal',
										'/proc',
										'/request',
									]}
									onSelect={async (path) => {
										if (
											await playgroundClient.isDir(path)
										) {
											return;
										}
										const text =
											await playgroundClient.readFileAsText(
												path
											);
										if (text.length > 1024 * 1024) {
											dispatch(
												setCode(
													'File too large to be edited'
												)
											);
										} else {
											dispatch(setCode(text));
										}
									}}
								/>
							)}
						</div>
					</Panel>
					<PanelResizeHandle className={styles.horizontalHandle} />
				</>
				<Panel minSize={40}>
					<div className={styles.editorPane}>
						<Controls onHelpClick={handleOpenHelp} />
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
									<header className={styles.terminalHeader}>
										<button
											id="terminalToggle"
											type="button"
											className={styles.terminalToggle}
											onClick={() =>
												terminalPanelRef.current?.collapse()
											}
											aria-expanded={!isTerminalCollapsed}
										>
											{isTerminalCollapsed
												? 'Show terminal'
												: 'Hide terminal'}
										</button>
									</header>
									<div className={styles.terminalPane}>
										<Terminal
											isCollapsed={isTerminalCollapsed}
											resizeToken={terminalResizeToken}
										/>
									</div>
								</section>
							</Panel>
						</PanelGroup>
					</div>
				</Panel>
				<PanelResizeHandle className={styles.horizontalHandle} />
				<Panel minSize={15}>
					<div id="previewPane" className={styles.previewPane}>
						<iframe
							id="preview"
							title="WordPress Playground"
							className={styles.preview}
						/>
					</div>
				</Panel>
			</PanelGroup>
			<HelpModal isOpen={isHelpOpen} onRequestClose={handleCloseHelp} />
		</div>
	);
};
