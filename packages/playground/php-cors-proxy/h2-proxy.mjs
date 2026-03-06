/**
 * HTTP/2 reverse proxy for the CORS proxy in development.
 *
 * Chrome requires HTTP/2 for streaming request bodies (ReadableStream
 * with duplex: 'half'). Vite's dev server only speaks HTTP/1.1, so
 * streaming uploads through it fail with ERR_ALPN_NEGOTIATION_FAILED.
 *
 * This server sits in front of the PHP built-in CORS proxy server
 * (port 5263) and speaks HTTP/2 with TLS, allowing the browser to
 * stream request bodies for large file uploads.
 *
 * On first run, it generates a self-signed certificate for localhost
 * and caches it in node_modules/.cache/playground-h2-proxy/.
 */
import { createSecureServer } from 'node:http2';
import { request as httpRequest } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import selfsigned from 'selfsigned';

const H2_PORT = 5264;
const PHP_PORT = 5263;
const PHP_HOST = '127.0.0.1';

const CACHE_DIR = join(
	import.meta.dirname,
	'../../../node_modules/.cache/playground-h2-proxy'
);
const CERT_PATH = join(CACHE_DIR, 'cert.pem');
const KEY_PATH = join(CACHE_DIR, 'key.pem');

async function getCertificates() {
	if (existsSync(CERT_PATH) && existsSync(KEY_PATH)) {
		return {
			cert: readFileSync(CERT_PATH, 'utf8'),
			key: readFileSync(KEY_PATH, 'utf8'),
		};
	}

	// Generate a self-signed certificate valid for 10 years.
	const attrs = [{ name: 'commonName', value: 'localhost' }];
	const pems = await selfsigned.generate(attrs, {
		algorithm: 'sha256',
		days: 3650,
		keySize: 2048,
		extensions: [
			{
				name: 'subjectAltName',
				altNames: [
					{ type: 2, value: 'localhost' },
					{ type: 7, ip: '127.0.0.1' },
					{ type: 7, ip: '::1' },
				],
			},
		],
	});

	mkdirSync(CACHE_DIR, { recursive: true });
	writeFileSync(CERT_PATH, pems.cert);
	writeFileSync(KEY_PATH, pems.private);

	return { cert: pems.cert, key: pems.private };
}

const { cert, key } = await getCertificates();

const server = createSecureServer(
	{
		cert,
		key,
		allowHTTP1: true,
	},
	(req, res) => {
		// Strip HTTP/2 pseudo-headers (prefixed with `:`) before
		// forwarding to the HTTP/1.1 PHP server.
		const forwardHeaders = {};
		for (const [key, value] of Object.entries(req.headers)) {
			if (!key.startsWith(':')) {
				forwardHeaders[key] = value;
			}
		}
		forwardHeaders.host =
			req.headers[':authority'] || req.headers.host || 'localhost';

		// Forward the request to the PHP CORS proxy server.
		const proxyReq = httpRequest(
			{
				hostname: PHP_HOST,
				port: PHP_PORT,
				path: req.url,
				method: req.method,
				headers: forwardHeaders,
			},
			(proxyRes) => {
				// Add CORS headers so the browser accepts cross-origin
				// responses from this server.
				const headers = { ...proxyRes.headers };
				headers['access-control-allow-origin'] = '*';
				headers['access-control-allow-methods'] =
					'GET, POST, PUT, DELETE, PATCH, OPTIONS';
				headers['access-control-allow-headers'] = '*';
				headers['access-control-expose-headers'] =
					'x-playground-cors-proxy, x-request-id';

				res.writeHead(proxyRes.statusCode, headers);
				proxyRes.pipe(res);
			}
		);

		proxyReq.on('error', (err) => {
			console.error('CORS proxy upstream error:', err.message);
			res.writeHead(502, {
				'access-control-allow-origin': '*',
				'content-type': 'text/plain',
			});
			res.end('CORS proxy upstream unavailable');
		});

		// Handle preflight requests locally so the browser doesn't
		// need to wait for the PHP server.
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'access-control-allow-origin': '*',
				'access-control-allow-methods':
					'GET, POST, PUT, DELETE, PATCH, OPTIONS',
				'access-control-allow-headers': '*',
				'access-control-max-age': '86400',
			});
			res.end();
			return;
		}

		req.pipe(proxyReq);
	}
);

server.listen(H2_PORT, () => {
	console.log(`HTTP/2 CORS proxy listening on https://localhost:${H2_PORT}`);
	console.log(
		`Forwarding to PHP CORS proxy at http://${PHP_HOST}:${PHP_PORT}`
	);
	console.log('\nIf streaming uploads fail with a certificate error, visit');
	console.log(
		`https://localhost:${H2_PORT}/ in your browser and accept the self-signed certificate.`
	);
	console.log(
		'Or enable chrome://flags/#allow-insecure-localhost in Chrome.\n'
	);
});
