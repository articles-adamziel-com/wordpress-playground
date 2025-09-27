import { useCallback, useEffect, useState } from 'react';

import styles from './layout.module.css';
import { Controls } from './Controls';
import { EditorHost } from './EditorHost';
import { HelpModal } from './HelpModal';
import { PlaygroundManager } from './PlaygroundManager';
import { Terminal } from './Terminal';

export const Layout = () => {
	const [isHelpOpen, setHelpOpen] = useState(false);

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

	return (
		<div id="php-playground-react-root" className={styles.root}>
			<PlaygroundManager />
			<div id="app" className={styles.app}>
				<div id="editorPane" className={styles.editorPane}>
					<Controls onHelpClick={handleOpenHelp} />
					<div className={styles.editorContent}>
						<EditorHost />
						<Terminal />
					</div>
				</div>
				<div id="previewPane" className={styles.previewPane}>
					<iframe
						id="preview"
						title="WordPress Playground"
						className={styles.preview}
					/>
				</div>
			</div>
			<HelpModal isOpen={isHelpOpen} onRequestClose={handleCloseHelp} />
		</div>
	);
};
