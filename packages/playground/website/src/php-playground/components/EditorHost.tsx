import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
	EditorView,
	keymap,
	lineNumbers,
	highlightActiveLine,
	highlightActiveLineGutter,
	dropCursor,
	rectangularSelection,
	crosshairCursor,
} from '@codemirror/view';
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
	autocompletion,
	completionKeymap,
	closeBrackets,
	closeBracketsKeymap,
} from '@codemirror/autocomplete';
import {
	foldGutter,
	indentOnInput,
	bracketMatching,
	foldKeymap,
	syntaxHighlighting,
	defaultHighlightStyle,
} from '@codemirror/language';
import { php } from '@codemirror/lang-php';

import { useAppDispatch, useAppSelector } from '../hooks';
import { queueRun, setCode } from '../store';
import styles from './layout.module.css';

export const EditorHost = () => {
	const dispatch = useAppDispatch();
	const code = useAppSelector((state) => state.playground.code);
	const editorRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const phpCompartmentRef = useRef(new Compartment());

	useEffect(() => {
		if (viewRef.current) {
			return;
		}
		const container = editorRef.current;
		if (!container) {
			return;
		}

		const state = EditorState.create({
			doc: code,
			extensions: [
				lineNumbers(),
				highlightActiveLineGutter(),
				highlightActiveLine(),
				foldGutter(),
				dropCursor(),
				rectangularSelection(),
				crosshairCursor(),
				phpCompartmentRef.current.of(php()),
				syntaxHighlighting(defaultHighlightStyle),
				indentOnInput(),
				bracketMatching(),
				closeBrackets(),
				history(),
				highlightSelectionMatches(),
				autocompletion(),
				EditorView.updateListener.of((update) => {
					if (!update.docChanged) {
						return;
					}
					const nextDoc = update.state.doc.toString();
					dispatch(setCode(nextDoc));
				}),
				keymap.of([
					{
						key: 'Mod-s',
						preventDefault: true,
						run: () => {
							dispatch(queueRun());
							return true;
						},
					},
					...closeBracketsKeymap,
					...completionKeymap,
					...foldKeymap,
					...searchKeymap,
					...historyKeymap,
					...defaultKeymap,
					indentWithTab,
				]),
			],
		});

		const view = new EditorView({ state, parent: container });
		viewRef.current = view;

		return () => {
			view.destroy();
			viewRef.current = null;
		};
		// The editor instance should persist across renders. Recreate it only once.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) {
			return;
		}
		const currentDoc = view.state.doc.toString();
		if (code === currentDoc) {
			return;
		}
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: code },
		});
	}, [code]);

	return <div id="editor" ref={editorRef} className={styles.editor} />;
};
