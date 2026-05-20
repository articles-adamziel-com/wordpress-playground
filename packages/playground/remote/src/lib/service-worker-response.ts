import type { StreamedPHPResponse } from '@php-wasm/universal';
import { streamToPort } from '@php-wasm/universal';
import { isHtmlContentType } from '@php-wasm/web-service-worker';

export type ServiceWorkerPHPResponse = {
	httpStatusCode: number;
	headers: Record<string, string[]>;
	bodyPort?: MessagePort;
	bytes?: Uint8Array;
};

export type SerializedServiceWorkerPHPResponse = {
	response: ServiceWorkerPHPResponse;
	transfer: Transferable[];
};

/**
 * Serializes a streamed PHP response for transfer to the service worker.
 *
 * Most responses are kept as streams, just wrapped in a MessagePort
 * since ReadableStream is not directly transferrable to the remote.html iframe.
 *
 * HTML responses, however, are buffered. Otherwise the browser may assume
 * the HTML elements are intentionally provided over time and apply a
 * confusing "gradual fade-in" effect when view transitions are enabled.
 * It's bad UX. A single all-or-nothing transition feels a lot better.
 * Therefore, we wait until the entire HTML body is available and expose
 * it all at once.
 *
 * @see https://github.com/WordPress/wordpress-playground/issues/3436
 */
export async function serializeStreamedResponseForServiceWorker(
	streamedResponse: StreamedPHPResponse
): Promise<SerializedServiceWorkerPHPResponse> {
	const httpStatusCode = await streamedResponse.httpStatusCode;
	const headers = await streamedResponse.headers;

	if (isHtmlContentType(headers['content-type'])) {
		// Buffer HTML responses for a nice full-page view transition.
		const bytes = await streamedResponse.stdoutBytes;
		const transfer =
			bytes.byteLength > 0 && bytes.buffer instanceof ArrayBuffer
				? [bytes.buffer]
				: [];
		return {
			response: {
				httpStatusCode,
				headers,
				bytes,
			},
			transfer,
		};
	}

	// Keep non-HTML responses streamed to avoid buffering large assets or
	// binary downloads in memory before the service worker can respond.
	const bodyPort = streamToPort(streamedResponse.stdout);
	return {
		response: {
			httpStatusCode,
			headers,
			bodyPort,
		},
		transfer: [bodyPort],
	};
}
