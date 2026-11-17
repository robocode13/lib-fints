import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient, redactSignature } from '../httpClient.js';
import { CustomerMessage } from '../message.js';
import { HKIDN, type HKIDNSegment } from '../segments/HKIDN.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

// Characters that FinTS escapes, so the redaction has to follow escaped segment ends.
const PIN = "S3cr3t?+:'PIN";
const TAN = '654321';

function signedMessage(): CustomerMessage {
	const message = new CustomerMessage('0', 1);
	const hkidn: HKIDNSegment = {
		header: { segId: HKIDN.Id, segNr: 0, version: HKIDN.Version },
		bank: { country: 280, bankId: '12030000' },
		customerId: '12345678',
		systemId: '0',
		systemIdRequired: 1,
	};
	message.addSegment(hkidn);
	message.sign(280, '12030000', '12345678', PIN, '0', 900, TAN);
	return message;
}

describe('credentials in debug output', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('the encoded message carries the PIN, the redacted one does not', () => {
		const encoded = signedMessage().encode();
		expect(encoded).toContain('S3cr3t');
		const redacted = redactSignature(encoded);
		expect(redacted).not.toContain('S3cr3t');
		expect(redacted).not.toContain(TAN);
		expect(redacted).toContain("HNSHA:***'");
	});

	it('the readable message text does not show PIN or TAN', () => {
		const text = signedMessage().toString();
		expect(text).toContain('HNSHA');
		expect(text).not.toContain('S3cr3t');
		expect(text).not.toContain(TAN);
	});

	it('neither debug mode logs the PIN', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('down', { status: 503 })),
		);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		for (const raw of [false, true]) {
			await expect(
				new HttpClient('http://bank.example', true, raw).sendMessage(signedMessage()),
			).rejects.toThrow();
		}
		const logged = log.mock.calls.flat().join('\n');
		expect(logged).not.toContain('S3cr3t');
		expect(logged).not.toContain(TAN);
	});

	it('a failed request does not put the response body into the error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(`echo: ${PIN}`, { status: 500 })),
		);
		const error = await new HttpClient('http://bank.example')
			.sendMessage(signedMessage())
			.catch((e) => e);
		expect(error.message).toBe('Request failed with status code 500');
	});
});
