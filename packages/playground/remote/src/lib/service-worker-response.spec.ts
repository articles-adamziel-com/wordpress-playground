import { PHPResponse, StreamedPHPResponse } from '@php-wasm/universal';
import { serializeStreamedResponseForServiceWorker } from './service-worker-response';

const enc = new TextEncoder();

describe('serializeStreamedResponseForServiceWorker', () => {
	it('buffers HTML responses into bytes', async () => {
		const bytes = enc.encode('<!doctype html><p>Hello</p>');
		const streamedResponse = StreamedPHPResponse.fromPHPResponse(
			new PHPResponse(
				200,
				{ 'content-type': ['text/html; charset=utf-8'] },
				bytes
			)
		);

		const { response, transfer } =
			await serializeStreamedResponseForServiceWorker(streamedResponse);

		expect(response.httpStatusCode).toBe(200);
		expect(response.headers['content-type']).toEqual([
			'text/html; charset=utf-8',
		]);
		expect(response.bytes).toEqual(bytes);
		expect(response.bodyPort).toBeUndefined();
		expect(transfer).toEqual([bytes.buffer]);
	});

	it('keeps non-HTML responses streamed through a MessagePort', async () => {
		const streamedResponse = StreamedPHPResponse.fromPHPResponse(
			new PHPResponse(
				200,
				{ 'content-type': ['application/octet-stream'] },
				enc.encode('binary')
			)
		);

		const { response, transfer } =
			await serializeStreamedResponseForServiceWorker(streamedResponse);

		expect(response.bytes).toBeUndefined();
		expect(response.bodyPort).toBeDefined();
		expect(transfer).toEqual([response.bodyPort]);
		response.bodyPort?.close();
	});
});
