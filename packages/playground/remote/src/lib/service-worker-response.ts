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

export async function serializeStreamedResponseForServiceWorker(
	streamedResponse: StreamedPHPResponse
): Promise<SerializedServiceWorkerPHPResponse> {
	const httpStatusCode = await streamedResponse.httpStatusCode;
	const headers = await streamedResponse.headers;

	if (isHtmlContentType(headers['content-type'])) {
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
