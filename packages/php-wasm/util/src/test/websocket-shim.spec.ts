import { WebSocketShim } from '../lib/websocket-shim';

describe('WebSocketShim', () => {
	it('passes MessageEvent-shaped objects to browser message listeners', () => {
		const ws = new WebSocketShim();
		const message = new Uint8Array([1, 2, 3]);
		const listener = vitest.fn();
		const propertyHandler = vitest.fn();

		ws.addEventListener('message', listener);
		ws.onmessage = propertyHandler;
		ws.emitMessage(message);

		expect(listener).toHaveBeenCalledWith({ data: message });
		expect(propertyHandler).toHaveBeenCalledWith({ data: message });
	});

	it('keeps Node-style message listeners on the ws callback shape', () => {
		const ws = new WebSocketShim();
		const message = new Uint8Array([1, 2, 3]);
		const listener = vitest.fn();

		ws.on('message', listener);
		ws.emitMessage(message);

		expect(listener).toHaveBeenCalledWith(message, true);
	});

	it('removes Node-style once listeners after the first event', () => {
		const ws = new WebSocketShim();
		const listener = vitest.fn();

		ws.once('message', listener);
		ws.emitMessage('first');
		ws.emitMessage('second');

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith('first', false);
	});
});
