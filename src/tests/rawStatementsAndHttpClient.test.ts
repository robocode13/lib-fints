import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../httpClient.js';
import { StatementInteractionCAMT } from '../interactions/statementInteractionCAMT.js';
import { StatementInteractionMT940 } from '../interactions/statementInteractionMT940.js';
import { type CustomerMessage, Message } from '../message.js';
import { HICAZ } from '../segments/HICAZ.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

const CAMT_DESCRIPTOR = 'urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08';

const camt = (id: string) =>
	`<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">` +
	`<BkToCstmrAcctRpt><GrpHdr><MsgId>${id}</MsgId><CreDtTm>2026-07-01T10:00:00+02:00</CreDtTm></GrpHdr>` +
	`<Rpt><Id>${id}</Id><Acct><Id><IBAN>DE991234567123456</IBAN></Id><Ccy>EUR</Ccy></Acct>` +
	`<Ntry><Amt>10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>` +
	`<BookgDt><Dt>2026-07-01</Dt></BookgDt><ValDt><Dt>2026-07-01</Dt></ValDt>` +
	`<AcctSvcrRef>TXN${id}</AcctSvcrRef></Ntry></Rpt></BkToCstmrAcctRpt></Document>`;

const hicaz = (...docs: string[]) =>
	`HICAZ:5:1+DE991234567123456:BANK12+${CAMT_DESCRIPTOR}+${docs.map((d) => `@${d.length}@${d}`).join(':')}'`;

const MT940 =
	':20:STARTUMS\r\n:25:12030000/1234567890\r\n:28C:00001/001\r\n:60F:C260701EUR100,00\r\n' +
	':61:2607010701DR10,00NMSCNONREF\r\n:86:166?00GUTSCHRIFT?20SVWZ+Test\r\n:62F:C260701EUR90,00\r\n-\r\n';

describe('rawDocuments: statements as the bank sent them', () => {
	it('CAMT: one document per booking day, in order, even when the built-in parser fails', () => {
		const message = Message.decode(`${hicaz(camt('A'))}${hicaz(camt('B'))}`);
		const clientResponse = { statements: [] } as never as {
			statements: unknown[];
			rawDocuments?: { format: string; content: string }[];
		};
		new StatementInteractionCAMT('123').handleResponse(message, clientResponse as never);

		expect(clientResponse.rawDocuments).toEqual([
			{ format: 'camt', content: camt('A') },
			{ format: 'camt', content: camt('B') },
		]);
		// These minimal documents have no balances, which the built-in parser rejects
		expect(clientResponse.statements).toEqual([]);
	});

	it('CAMT: an empty list when the bank sent no bookings', () => {
		const message = Message.decode(`HIRMG:3:2+0010::Entgegengenommen.'`);
		const clientResponse = { statements: [] } as never as { rawDocuments?: unknown[] };
		new StatementInteractionCAMT('123').handleResponse(message, clientResponse as never);
		expect(clientResponse.rawDocuments).toEqual([]);
	});

	it('MT940: the stream as one document', () => {
		const message = Message.decode(`HIKAZ:5:7+@${MT940.length}@${MT940}'`);
		const clientResponse = { statements: [] } as never as {
			statements: unknown[];
			rawDocuments?: { format: string; content: string }[];
		};
		new StatementInteractionMT940('123').handleResponse(message, clientResponse as never);
		expect(clientResponse.rawDocuments).toEqual([{ format: 'mt940', content: MT940 }]);
		expect(clientResponse.statements.length).toBeGreaterThan(0);
	});
});

describe('HttpClient', () => {
	const message = {
		encode: () => "HNHBK:1:3'",
		toString: () => 'HNHBK',
	} as unknown as CustomerMessage;

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('waits without a timeout unless one is set', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
		vi.stubGlobal('fetch', fetchMock);
		await expect(new HttpClient('http://bank.example').sendMessage(message)).rejects.toThrow(
			'offline',
		);
		expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
	});

	it('gives every request the timeout that was set', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
		vi.stubGlobal('fetch', fetchMock);
		HttpClient.timeoutMs = 30_000;
		try {
			await expect(new HttpClient('http://bank.example').sendMessage(message)).rejects.toThrow(
				'timed out',
			);
			expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
		} finally {
			HttpClient.timeoutMs = undefined;
		}
	});

	it('does not print an undecodable response (it holds account data) unless debugging', async () => {
		const secret = "HIRMG:3:2+0010::Saldo 1.234,56 Max Mustermann DE99'";
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockImplementation(
					async () => new Response(Buffer.from(`garbage${secret}`, 'latin1').toString('base64')),
				),
		);
		vi.spyOn(Message, 'decode').mockImplementation(() => {
			throw new Error('cannot decode');
		});
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(new HttpClient('http://bank.example').sendMessage(message)).rejects.toThrow(
			'cannot decode',
		);
		expect(errors).not.toHaveBeenCalled();

		await expect(new HttpClient('http://bank.example', true).sendMessage(message)).rejects.toThrow(
			'cannot decode',
		);
		expect(errors).toHaveBeenCalled();
	});
});

// HICAZ is used through Message.decode above; keep the import explicit for readers
void HICAZ;
