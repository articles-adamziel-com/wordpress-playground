import { setOAuthToken, oAuthState } from './state';

const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 700;
const OAUTH_NONCE_KEY = 'github-oauth-nonce';

interface OAuthMessage {
	type: 'github-oauth-success' | 'github-oauth-error';
	token?: string;
	error?: string;
	nonce?: string;
}

let popupWindow: Window | null = null;
let messageListener: ((event: MessageEvent) => void) | null = null;
let currentNonce: string | null = null;

function generateNonce(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join(
		''
	);
}

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
	currentNonce = null;
	sessionStorage.removeItem(OAUTH_NONCE_KEY);
}

export function openGitHubAuthPopup(): Promise<string> {
	return new Promise((resolve, reject) => {
		// Security check: Only allow OAuth from the top-level window
		// This prevents rogue plugins in the WordPress iframe from stealing credentials
		if (window !== window.top) {
			reject(
				new Error(
					'OAuth authentication must be initiated from the main window'
				)
			);
			return;
		}

		// Close any existing popup
		if (popupWindow && !popupWindow.closed) {
			popupWindow.close();
		}
		cleanupPopup();

		// Generate a cryptographic nonce to verify the callback
		currentNonce = generateNonce();
		sessionStorage.setItem(OAUTH_NONCE_KEY, currentNonce);

		const { left, top } = calculatePopupPosition();

		// Build OAuth URL with nonce in state parameter
		const oauthUrl = `oauth.php?redirect=1&popup=1&state=${encodeURIComponent(currentNonce)}`;

		// Open the popup
		popupWindow = window.open(
			oauthUrl,
			'github-oauth-popup',
			`width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},scrollbars=yes,resizable=yes`
		);

		if (!popupWindow) {
			cleanupPopup();
			reject(
				new Error(
					'Failed to open popup. Please allow popups for this site.'
				)
			);
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

			// Verify the nonce matches to prevent credential theft
			const storedNonce = sessionStorage.getItem(OAUTH_NONCE_KEY);
			if (!data.nonce || data.nonce !== storedNonce) {
				// Invalid or missing nonce - ignore this message
				return;
			}

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
