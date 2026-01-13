import { DebugTimeline } from '../lib/timeline/debug-timeline';

function createFakeDirectoryHandle() {
	const files = new Map<string, string>();
	const directories = new Map<
		string,
		ReturnType<typeof createFakeDirectoryHandle>
	>();

	return {
		async getDirectoryHandle(
			name: string,
			options: { create?: boolean } = {}
		) {
			let directory = directories.get(name);
			if (!directory) {
				if (!options.create) {
					throw new Error(`Directory not found: ${name}`);
				}
				directory = createFakeDirectoryHandle();
				directories.set(name, directory);
			}
			return directory;
		},
		async getFileHandle(name: string, options: { create?: boolean } = {}) {
			if (!files.has(name)) {
				if (!options.create) {
					throw new Error(`File not found: ${name}`);
				}
				files.set(name, '');
			}

			return {
				async getFile() {
					return {
						text: async () => files.get(name) ?? '',
					};
				},
				async createWritable() {
					return {
						write: async (content: string) => {
							files.set(name, content);
						},
						close: async () => undefined,
					};
				},
			};
		},
		async removeEntry(name: string) {
			if (!files.delete(name) && !directories.delete(name)) {
				throw new Error(`Entry not found: ${name}`);
			}
		},
	};
}

describe('DebugTimeline', () => {
	let root: ReturnType<typeof createFakeDirectoryHandle>;
	let nextUUID = 1;

	beforeEach(() => {
		root = createFakeDirectoryHandle();
		nextUUID = 1;

		vi.stubGlobal('navigator', {
			storage: {
				getDirectory: vi.fn(async () => root),
			},
		});
		vi.stubGlobal('crypto', {
			randomUUID: vi.fn(() => `session-${nextUUID++}`),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('stores timeline entries and filters verbose entries by default', async () => {
		const timeline = new DebugTimeline({
			verboseMode: false,
			siteSlug: 'demo-site',
			phpVersion: '8.3',
			wpVersion: '6.8',
		});

		await timeline.initialize();
		timeline.log({
			category: 'runtime',
			type: 'runtime.initialized',
			message: 'Runtime initialized',
		});
		timeline.log({
			category: 'filesystem',
			type: 'filesystem.write',
			message: 'Filesystem write',
			verbose: true,
		});

		await timeline.endSession();

		const currentSession = timeline.getCurrentSession();
		expect(currentSession).toMatchObject({
			id: 'session-1',
			entryCount: 1,
			siteSlug: 'demo-site',
			phpVersion: '8.3',
			wpVersion: '6.8',
			verboseMode: false,
		});

		const sessions = await timeline.listSessions();
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({
			id: 'session-1',
			entryCount: 1,
		});

		const entries = await timeline.readSession('session-1');
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			category: 'runtime',
			type: 'runtime.initialized',
			message: 'Runtime initialized',
		});
		expect(entries[0].timestamp).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
		);
	});

	it('includes buffered entries when reading the latest entries', async () => {
		const timeline = new DebugTimeline({ verboseMode: true });
		await timeline.initialize();

		timeline.log({
			category: 'blueprint',
			type: 'blueprint.step.start',
			message: 'Starting blueprint',
		});

		const latest = await timeline.readLatest(5);
		expect(latest).toHaveLength(1);
		expect(latest[0]).toMatchObject({
			category: 'blueprint',
			type: 'blueprint.step.start',
			message: 'Starting blueprint',
		});
	});

	it('exports sessions as jsonl, json, and csv', async () => {
		const timeline = new DebugTimeline({ verboseMode: true });
		await timeline.initialize();
		timeline.log({
			category: 'external',
			type: 'external.request',
			message: 'External call',
			data: { method: 'debugLog.readLatest' },
		});
		await timeline.endSession();

		const jsonl = await timeline.exportSession('session-1', 'jsonl');
		expect(jsonl).toContain('"type":"external.request"');

		const json = await timeline.exportSession('session-1', 'json');
		expect(JSON.parse(json)).toMatchObject([
			{
				category: 'external',
				type: 'external.request',
				message: 'External call',
			},
		]);

		const csv = await timeline.exportSession('session-1', 'csv');
		expect(csv).toContain(
			'timestamp,relativeMs,category,type,message,data'
		);
		expect(csv).toContain('"External call"');
		expect(csv).toContain('"method"":""debugLog.readLatest"');
	});
});
