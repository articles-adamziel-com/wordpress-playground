/**
 * Minimal WebSocket-shaped class used to intercept Emscripten's
 * WebSocket-based TCP connections without opening a real network socket.
 *
 * Emscripten's networking layer treats sockets as WebSockets:
 *   - In the browser it consumes the property-based API
 *     (`onmessage`, `onclose`, etc.) and `addEventListener`.
 *   - In Node.js (via the `ws` package) it consumes the EventEmitter-style
 *     API (`on('message', (data, isBinary) => ...)`).
 *
 * This shim implements both surfaces so subclasses can be returned from a
 * `websocket.decorator` hook in either runtime. Subclasses override `send`
 * and `close` to wire up outbound bytes, and call the
 * `emitOpen` / `emitMessage` / `emitClose` / `emitError` helpers to deliver
 * inbound events. Those helpers and the `listeners` map are public because
 * `websocket.decorator` returns an anonymous subclass expression, and
 * TypeScript's TS4094 forbids exported class expressions whose base has
 * private or protected members.
 */
export class WebSocketShim {
	readonly CONNECTING = 0;
	readonly OPEN = 1;
	readonly CLOSING = 2;
	readonly CLOSED = 3;

	readyState = 0; // CONNECTING

	url: string;
	protocol = '';
	binaryType: 'arraybuffer' | 'blob' = 'arraybuffer';
	extensions = '';
	bufferedAmount = 0;

	onopen: ((e: any) => void) | null = null;
	onmessage: ((e: any) => void) | null = null;
	onclose: ((e: any) => void) | null = null;
	onerror: ((e: any) => void) | null = null;

	listeners = new Map<string, Set<(...args: any[]) => void>>();
	nodeListeners = new Map<string, Set<(...args: any[]) => void>>();

	constructor(url = '') {
		this.url = url;
	}

	// Browser-style listener API
	addEventListener(event: string, fn: (...args: any[]) => void) {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(fn);
	}

	removeEventListener(event: string, fn: (...args: any[]) => void) {
		this.listeners.get(event)?.delete(fn);
	}

	// Node `ws`-style listener API
	on(event: string, fn: (...args: any[]) => void) {
		let set = this.nodeListeners.get(event);
		if (!set) {
			set = new Set();
			this.nodeListeners.set(event, set);
		}
		set.add(fn);
	}

	once(event: string, fn: (...args: any[]) => void) {
		const wrapped = (...args: any[]) => {
			this.removeListener(event, wrapped);
			fn(...args);
		};
		this.on(event, wrapped);
	}

	removeListener(event: string, fn: (...args: any[]) => void) {
		this.nodeListeners.get(event)?.delete(fn);
	}

	emitOpen() {
		this.readyState = this.OPEN;
		this.onopen?.({});
		const set = this.listeners.get('open');
		if (set) for (const fn of set) fn({});
		const nodeSet = this.nodeListeners.get('open');
		if (nodeSet) for (const fn of nodeSet) fn({});
	}

	/**
	 * Delivers an inbound message to consumers. Browser Emscripten reads
	 * messages via the `onmessage` property and expects a MessageEvent-shaped
	 * `{ data }` object, while Node Emscripten registers via `on('message')`
	 * (the `ws` library convention) and expects `(data, isBinary)`.
	 */
	emitMessage(data: Uint8Array | ArrayBuffer | string) {
		const event = { data };
		this.onmessage?.(event);
		const set = this.listeners.get('message');
		if (set) for (const fn of set) fn(event);

		const nodeSet = this.nodeListeners.get('message');
		if (!nodeSet) return;
		const isBinary = typeof data !== 'string';
		for (const fn of nodeSet) {
			fn(data, isBinary);
		}
	}

	emitClose() {
		this.readyState = this.CLOSED;
		this.onclose?.({});
		const set = this.listeners.get('close');
		if (set) for (const fn of set) fn({});
		const nodeSet = this.nodeListeners.get('close');
		if (nodeSet) for (const fn of nodeSet) fn({});
	}

	emitError(err: any) {
		this.onerror?.(err);
		const set = this.listeners.get('error');
		if (set) for (const fn of set) fn(err);
		const nodeSet = this.nodeListeners.get('error');
		if (nodeSet) for (const fn of nodeSet) fn(err);
	}

	// To be overridden by subclasses.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	send(_data: ArrayBuffer | Uint8Array | string) {}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	close(_code?: number, _reason?: string) {}
}
