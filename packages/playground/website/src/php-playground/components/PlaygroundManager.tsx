import { useEffect, useRef } from 'react';

import { startPlaygroundWeb } from '@wp-playground/client';

import { DEFAULT_WP_REMOTE } from '../constants';
import { useAppDispatch, useAppSelector } from '../hooks';
import {
	applyUrlState,
	setBootError,
	setBootStatus,
	setClient,
	setWpVersion,
	setWpVersions,
	setWpVersionsLoading,
} from '../store';
import { loadStateFromURL, saveStateToURL } from '../url-state';
import { playgroundRuntime } from '../runtime';

export const PlaygroundManager = () => {
	const dispatch = useAppDispatch();
	const { code, phpVersion, wpVersion, runRequestId, client, initialized } =
		useAppSelector((state) => state.playground);

	const codeRef = useRef(code);
	const phpVersionRef = useRef(phpVersion);
	const wpVersionRef = useRef(wpVersion);
	const clientRef = useRef(client);
	const runCountRef = useRef(0);
	const bootPromiseRef = useRef<Promise<void>>(Promise.resolve());

	useEffect(() => {
		return () => {
			clientRef.current = null;
			playgroundRuntime.setClient(null);
			playgroundRuntime.setBootPromise(Promise.resolve());
		};
	}, []);

	useEffect(() => {
		codeRef.current = code;
	}, [code]);

	useEffect(() => {
		phpVersionRef.current = phpVersion;
	}, [phpVersion]);

	useEffect(() => {
		wpVersionRef.current = wpVersion;
	}, [wpVersion]);

	useEffect(() => {
		clientRef.current = client;
	}, [client]);

	useEffect(() => {
		if (initialized) {
			return;
		}
		const state = loadStateFromURL();
		dispatch(
			applyUrlState({
				code: state.code,
				phpVersion: state.phpVersion,
				wpVersion: state.wpVersion,
			})
		);
	}, [dispatch, initialized]);

	useEffect(() => {
		const handleHashChange = () => {
			const state = loadStateFromURL();
			dispatch(
				applyUrlState({
					code: state.code,
					phpVersion: state.phpVersion,
					wpVersion: state.wpVersion,
				})
			);
		};
		window.addEventListener('hashchange', handleHashChange);
		return () => {
			window.removeEventListener('hashchange', handleHashChange);
		};
	}, [dispatch]);

	useEffect(() => {
		if (!initialized) {
			return;
		}
		const timeout = window.setTimeout(() => {
			saveStateToURL({
				code: codeRef.current,
				php: phpVersionRef.current,
				wp: wpVersionRef.current,
			});
		}, 500);
		return () => window.clearTimeout(timeout);
	}, [code, phpVersion, wpVersion, initialized]);

	useEffect(() => {
		if (!initialized) {
			return;
		}

		const previewIframe = document.getElementById(
			'preview'
		) as HTMLIFrameElement | null;
		if (!previewIframe) {
			return;
		}

		let cancelled = false;
		const boot = async () => {
			dispatch(setBootStatus('booting'));
			dispatch(setBootError(null));
			dispatch(setClient(null));
			clientRef.current = null;
			playgroundRuntime.setClient(null);
			dispatch(setWpVersionsLoading(true));
			runCountRef.current = 0;

			previewIframe.src = DEFAULT_WP_REMOTE;

			try {
				const clientInstance = await startPlaygroundWeb({
					iframe: previewIframe,
					remoteUrl: previewIframe.src,
					blueprint: {
						preferredVersions: {
							wp: wpVersionRef.current,
							php: phpVersionRef.current,
						},
					},
				});

				if (cancelled) {
					try {
						if (
							'destroy' in clientInstance &&
							typeof (clientInstance as any).destroy ===
								'function'
						) {
							await (clientInstance as any).destroy();
						}
					} catch {}
					return;
				}

				try {
					const { all, latest } =
						await clientInstance.getMinifiedWordPressVersions();
					const versions = Object.keys(all);
					dispatch(setWpVersions(versions));
					if (!versions.includes(wpVersionRef.current)) {
						dispatch(setWpVersion(latest));
					}
				} catch (error) {
					console.warn(
						'Failed to load WordPress versions list from client',
						error
					);
					dispatch(setWpVersionsLoading(false));
				}

				await clientInstance.isReady;
				if (cancelled) {
					try {
						if (
							'destroy' in clientInstance &&
							typeof (clientInstance as any).destroy ===
								'function'
						) {
							await (clientInstance as any).destroy();
						}
					} catch {}
					return;
				}

				await clientInstance.writeFile(
					'/wordpress/code.php',
					codeRef.current
				);
				await clientInstance.goTo('/code.php');

				clientRef.current = clientInstance;
				dispatch(setClient(clientInstance));
				playgroundRuntime.setClient(clientInstance);
				dispatch(setBootStatus('ready'));
			} catch (error: any) {
				const message = error?.message ?? String(error);
				dispatch(setBootStatus('error'));
				dispatch(setBootError(message));
				dispatch(setWpVersionsLoading(false));
			}
		};

		const promise = boot();
		bootPromiseRef.current = promise;
		playgroundRuntime.setBootPromise(promise);

		return () => {
			cancelled = true;
		};
	}, [dispatch, phpVersion, wpVersion, initialized]);

	useEffect(() => {
		if (!initialized) {
			return;
		}
		if (runRequestId === 0) {
			return;
		}

		const executeRun = async () => {
			await bootPromiseRef.current.catch(() => {});
			const currentClient = clientRef.current;
			if (!currentClient) {
				return;
			}
			runCountRef.current += 1;
			await currentClient.writeFile(
				'/wordpress/code.php',
				codeRef.current
			);
			const cacheBuster = `run=${runCountRef.current}-${Date.now()}`;
			await currentClient.goTo(`/code.php?${cacheBuster}`);
		};

		void executeRun();
	}, [runRequestId, initialized]);

	return null;
};
