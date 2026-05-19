import { createSendmailSpawnHandler } from '../lib/create-sendmail-handler';
import type { CaughtMessage } from '../lib/smtp';

const enc = new TextEncoder();

describe('createSendmailSpawnHandler', () => {
	it('reports rawSize in bytes and preserves non-ASCII raw text', async () => {
		const messages: CaughtMessage[] = [];
		const spawnHandler = createSendmailSpawnHandler((message) => {
			messages.push(message);
		});
		const childProcess = spawnHandler('/usr/sbin/sendmail -t -i');
		const spawned = new Promise<void>((resolve) => {
			childProcess.on('spawn', () => resolve());
		});
		const exitCode = new Promise<number>((resolve) => {
			childProcess.on('exit', resolve);
		});

		const raw =
			'From: sender@test.com\n' +
			'To: recipient@test.com\n' +
			'Subject: UTF-8\n' +
			'\n' +
			'Caf\u00e9 \ud83d\ude80\n';
		const normalizedRaw = raw.replace(/\r?\n/g, '\r\n');

		await spawned;
		childProcess.stdin.write(enc.encode(raw));
		childProcess.stdin.end();

		await expect(exitCode).resolves.toBe(0);
		expect(messages).toHaveLength(1);
		expect(messages[0].raw).toBe(normalizedRaw);
		expect(messages[0].rawSize).toBe(enc.encode(normalizedRaw).byteLength);
		expect(messages[0].rawSize).toBeGreaterThan(normalizedRaw.length);
	});
});
