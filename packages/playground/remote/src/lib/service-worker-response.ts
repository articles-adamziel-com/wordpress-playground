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
 * The remote iframe cannot transfer a ReadableStream directly, so most
 * responses are bridged through a MessagePort. HTML navigations are buffered
 * instead because browsers expect the navigation document body to be complete
 * when the service worker resolves the fetch response.
 */
export async function serializeStreamedResponseForServiceWorker(
	streamedResponse: StreamedPHPResponse
): Promise<SerializedServiceWorkerPHPResponse> {
	const httpStatusCode = await streamedResponse.httpStatusCode;
	const headers = await streamedResponse.headers;

	if (isHtmlContentType(headers['content-type'])) {
		// Buffer HTML documents so navigation requests receive a complete body
		// instead of a MessagePort-backed stream.
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
