/**
 * Mock SMTP server that intercepts outgoing emails from PHP.
 *
 * This module implements a basic SMTP server that accepts email submissions
 * and stores them in an array for later inspection. It's designed to work
 * similarly to the TLS interception - intercepting SMTP traffic and handling
 * it locally instead of forwarding to an actual mail server.
 *
 * ## Supported SMTP Commands:
 * - EHLO/HELO: Server greeting
 * - AUTH: Authentication (accepts any credentials)
 * - MAIL FROM: Sender address
 * - RCPT TO: Recipient address(es)
 * - DATA: Email body (terminated by \r\n.\r\n)
 * - QUIT: Close connection
 * - RSET: Reset transaction
 * - NOOP: No operation
 *
 * ## Usage:
 * The captured emails are stored in the `capturedEmails` array exported
 * from this module. Each email contains the sender, recipients, and raw
 * email data.
 */

export interface CapturedEmail {
	from: string;
	to: string[];
	data: string;
	timestamp: Date;
}

/**
 * Array storing all captured emails.
 * This is the main way to access intercepted emails.
 */
export const capturedEmails: CapturedEmail[] = [];

/**
 * Clear all captured emails.
 */
export function clearCapturedEmails(): void {
	capturedEmails.length = 0;
}

type SMTPState =
	| 'INIT'
	| 'GREETING_SENT'
	| 'READY'
	| 'MAIL_FROM'
	| 'RCPT_TO'
	| 'DATA'
	| 'QUIT';

const SMTP_RESPONSES = {
	GREETING: '220 playground.wordpress.net ESMTP Mock SMTP Server\r\n',
	EHLO_RESPONSE: (domain: string) =>
		`250-playground.wordpress.net Hello ${domain}\r\n` +
		'250-SIZE 35882577\r\n' +
		'250-8BITMIME\r\n' +
		'250-AUTH PLAIN LOGIN\r\n' +
		'250 OK\r\n',
	HELO_RESPONSE: '250 playground.wordpress.net\r\n',
	OK: '250 OK\r\n',
	AUTH_OK: '235 2.7.0 Authentication successful\r\n',
	AUTH_CONTINUE: '334 \r\n',
	DATA_START: '354 Start mail input; end with <CRLF>.<CRLF>\r\n',
	QUIT: '221 Bye\r\n',
	ERROR_SYNTAX: '500 Syntax error, command unrecognized\r\n',
	ERROR_SEQUENCE: '503 Bad sequence of commands\r\n',
	ERROR_AUTH: '535 Authentication failed\r\n',
};

/**
 * Mock SMTP server session handler.
 * Creates a bidirectional stream pair for handling SMTP communication.
 */
export class MockSMTPServer {
	private state: SMTPState = 'INIT';
	private currentEmail: Partial<CapturedEmail> = {};
	private dataBuffer = '';
	private inputBuffer = '';
	private authState: 'none' | 'waiting_username' | 'waiting_password' =
		'none';

	private writer: WritableStreamDefaultWriter<Uint8Array>;
	private encoder = new TextEncoder();
	private decoder = new TextDecoder();

	/**
	 * Upstream: data from the client (PHP) to the server
	 * Downstream: data from the server to the client (PHP)
	 */
	public clientUpstream = new TransformStream<Uint8Array, Uint8Array>();
	public clientDownstream = new TransformStream<Uint8Array, Uint8Array>();

	constructor() {
		this.writer = this.clientDownstream.writable.getWriter();
		this.startProcessing();
	}

	private async startProcessing() {
		// Send greeting immediately
		await this.sendResponse(SMTP_RESPONSES.GREETING);
		this.state = 'GREETING_SENT';

		// Process incoming data
		const reader = this.clientUpstream.readable.getReader();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				// Add to input buffer and process complete lines
				this.inputBuffer += this.decoder.decode(value);
				await this.processInputBuffer();
			}
		} catch (error) {
			// Connection closed or error
		} finally {
			reader.releaseLock();
			try {
				await this.writer.close();
			} catch {
				// Writer may already be closed
			}
		}
	}

	private async processInputBuffer() {
		if (this.state === 'DATA') {
			// In DATA mode, look for the terminator \r\n.\r\n
			const endIndex = this.inputBuffer.indexOf('\r\n.\r\n');
			if (endIndex !== -1) {
				// Extract the email data (without the terminator)
				this.dataBuffer += this.inputBuffer.slice(0, endIndex);
				this.inputBuffer = this.inputBuffer.slice(endIndex + 5); // Skip \r\n.\r\n

				// Store the captured email
				this.currentEmail.data = this.dataBuffer;
				this.currentEmail.timestamp = new Date();
				capturedEmails.push(this.currentEmail as CapturedEmail);

				// Reset for next email
				this.currentEmail = {};
				this.dataBuffer = '';
				this.state = 'READY';

				await this.sendResponse(SMTP_RESPONSES.OK);

				// Process any remaining commands in the buffer
				await this.processInputBuffer();
			} else {
				// More data to come, buffer it
				// Keep last 4 chars in inputBuffer in case terminator is split
				if (this.inputBuffer.length > 4) {
					this.dataBuffer += this.inputBuffer.slice(0, -4);
					this.inputBuffer = this.inputBuffer.slice(-4);
				}
			}
			return;
		}

		// Process line by line for commands
		let lineEndIndex: number;
		while ((lineEndIndex = this.inputBuffer.indexOf('\r\n')) !== -1) {
			const line = this.inputBuffer.slice(0, lineEndIndex);
			this.inputBuffer = this.inputBuffer.slice(lineEndIndex + 2);
			await this.processCommand(line);
		}
	}

	private async processCommand(line: string) {
		const upperLine = line.toUpperCase();

		// Handle AUTH continuation
		if (this.authState !== 'none') {
			if (this.authState === 'waiting_username') {
				// Username received (base64 encoded)
				this.authState = 'waiting_password';
				await this.sendResponse(SMTP_RESPONSES.AUTH_CONTINUE);
				return;
			} else if (this.authState === 'waiting_password') {
				// Password received (base64 encoded) - accept anything
				this.authState = 'none';
				await this.sendResponse(SMTP_RESPONSES.AUTH_OK);
				return;
			}
		}

		if (upperLine.startsWith('EHLO ')) {
			const domain = line.slice(5).trim();
			this.state = 'READY';
			await this.sendResponse(SMTP_RESPONSES.EHLO_RESPONSE(domain));
		} else if (upperLine.startsWith('HELO ')) {
			this.state = 'READY';
			await this.sendResponse(SMTP_RESPONSES.HELO_RESPONSE);
		} else if (upperLine.startsWith('AUTH ')) {
			if (this.state !== 'READY') {
				await this.sendResponse(SMTP_RESPONSES.ERROR_SEQUENCE);
				return;
			}

			const authType = line.slice(5).trim().toUpperCase();
			if (authType.startsWith('PLAIN ')) {
				// AUTH PLAIN with credentials inline - accept immediately
				await this.sendResponse(SMTP_RESPONSES.AUTH_OK);
			} else if (authType === 'PLAIN' || authType === 'LOGIN') {
				// Need to receive credentials
				this.authState = 'waiting_username';
				await this.sendResponse(SMTP_RESPONSES.AUTH_CONTINUE);
			} else {
				await this.sendResponse(SMTP_RESPONSES.AUTH_OK);
			}
		} else if (upperLine.startsWith('MAIL FROM:')) {
			if (this.state !== 'READY') {
				await this.sendResponse(SMTP_RESPONSES.ERROR_SEQUENCE);
				return;
			}

			const from = this.extractEmailAddress(line.slice(10));
			this.currentEmail = { from, to: [] };
			this.state = 'MAIL_FROM';
			await this.sendResponse(SMTP_RESPONSES.OK);
		} else if (upperLine.startsWith('RCPT TO:')) {
			if (this.state !== 'MAIL_FROM' && this.state !== 'RCPT_TO') {
				await this.sendResponse(SMTP_RESPONSES.ERROR_SEQUENCE);
				return;
			}

			const to = this.extractEmailAddress(line.slice(8));
			this.currentEmail.to = this.currentEmail.to || [];
			this.currentEmail.to.push(to);
			this.state = 'RCPT_TO';
			await this.sendResponse(SMTP_RESPONSES.OK);
		} else if (upperLine === 'DATA') {
			if (this.state !== 'RCPT_TO') {
				await this.sendResponse(SMTP_RESPONSES.ERROR_SEQUENCE);
				return;
			}

			this.state = 'DATA';
			this.dataBuffer = '';
			await this.sendResponse(SMTP_RESPONSES.DATA_START);
		} else if (upperLine === 'QUIT') {
			this.state = 'QUIT';
			await this.sendResponse(SMTP_RESPONSES.QUIT);
			try {
				await this.writer.close();
			} catch {
				// Already closed
			}
		} else if (upperLine === 'RSET') {
			this.currentEmail = {};
			this.dataBuffer = '';
			this.state = 'READY';
			await this.sendResponse(SMTP_RESPONSES.OK);
		} else if (upperLine === 'NOOP') {
			await this.sendResponse(SMTP_RESPONSES.OK);
		} else if (upperLine === 'STARTTLS') {
			// We don't actually support STARTTLS upgrade, but we can accept it
			// The TLS layer is handled separately in tcp-over-fetch-websocket
			await this.sendResponse('220 Ready to start TLS\r\n');
		} else {
			// Unknown command
			await this.sendResponse(SMTP_RESPONSES.ERROR_SYNTAX);
		}
	}

	private extractEmailAddress(input: string): string {
		// Extract email from formats like <email@example.com> or email@example.com
		const match = input.match(/<([^>]+)>/);
		if (match) {
			return match[1].trim();
		}
		return input.trim();
	}

	private async sendResponse(response: string) {
		try {
			await this.writer.write(this.encoder.encode(response));
		} catch {
			// Writer closed
		}
	}
}

/**
 * Standard SMTP ports.
 * - 25: Standard SMTP (plaintext or STARTTLS)
 * - 465: SMTPS (implicit TLS)
 * - 587: Submission (typically STARTTLS)
 */
export const SMTP_PORTS = [25, 465, 587];

/**
 * Check if a given port is an SMTP port.
 */
export function isSMTPPort(port: number): boolean {
	return SMTP_PORTS.includes(port);
}
