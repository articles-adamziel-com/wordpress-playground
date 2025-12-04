import { setOAuthToken, oAuthState } from './state';

const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 700;
const OAUTH_POPUP_URL = 'oauth.php?redirect=1&popup=1';

interface OAuthMessage {
	type: 'github-oauth-success' | 'github-oauth-error';
	token?: string;
	error?: string;
}

let popupWindow: Window | null = null;
let messageListener: ((event: MessageEvent) => void) | null = null;

function calculatePopupPosition(): { left: number; top: number } {
	const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
	const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2;
	return { left, top };
}

function cleanupPopup(): void {
	if (messageListener) {
		window.removeEventListener('message', messageListener);
		messageListener = null;
	}
	popupWindow = null;
}

export function openGitHubAuthPopup(): Promise<string> {
	return new Promise((resolve, reject) => {
		// Close any existing popup
		if (popupWindow && !popupWindow.closed) {
			popupWindow.close();
		}
		cleanupPopup();

		const { left, top } = calculatePopupPosition();

		// Open the popup
		popupWindow = window.open(
			OAUTH_POPUP_URL,
			'github-oauth-popup',
			`width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},scrollbars=yes,resizable=yes`
		);

		if (!popupWindow) {
			reject(new Error('Failed to open popup. Please allow popups for this site.'));
			return;
		}

		// Set authorizing state
		oAuthState.value = {
			...oAuthState.value,
			isAuthorizing: true,
		};

		// Listen for messages from the popup
		messageListener = (event: MessageEvent) => {
			// Verify the origin
			if (event.origin !== window.location.origin) {
				return;
			}

			const data = event.data as OAuthMessage;

			if (data.type === 'github-oauth-success' && data.token) {
				cleanupPopup();
				setOAuthToken(data.token);
				oAuthState.value = {
					...oAuthState.value,
					isAuthorizing: false,
				};
				resolve(data.token);
			} else if (data.type === 'github-oauth-error') {
				cleanupPopup();
				oAuthState.value = {
					...oAuthState.value,
					isAuthorizing: false,
				};
				reject(new Error(data.error || 'Authentication failed'));
			}
		};

		window.addEventListener('message', messageListener);

		// Poll to check if popup was closed without completing auth
		const pollTimer = setInterval(() => {
			if (popupWindow && popupWindow.closed) {
				clearInterval(pollTimer);
				if (messageListener) {
					cleanupPopup();
					oAuthState.value = {
						...oAuthState.value,
						isAuthorizing: false,
					};
					reject(new Error('Authentication was cancelled'));
				}
			}
		}, 500);
	});
}
