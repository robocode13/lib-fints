import { describe, expect, it } from 'vitest';
import {
	ElectronicStatementInteraction,
	type ElectronicStatementResponse,
} from '../interactions/electronicStatementInteraction.js';
import { Message } from '../message.js';
import { decode, encode } from '../segment.js';
import type { HIEKASegment } from '../segments/HIEKA.js';
import type { HIEKASSegment } from '../segments/HIEKAS.js';
import { HKEKA, type HKEKASegment, StatementFormat } from '../segments/HKEKA.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HKEKA v5', () => {
	it('encode', () => {
		const segment: HKEKASegment = {
			header: { segId: HKEKA.Id, segNr: 3, version: 5 },
			account: {
				iban: 'DE991234567123456',
				bic: 'BANK12',
			},
			statementFormat: StatementFormat.PDF,
		};

		expect(encode(segment)).toBe("HKEKA:3:5+DE991234567123456:BANK12+3'");
	});

	it('encode with statement number, year and offset', () => {
		const segment: HKEKASegment = {
			header: { segId: HKEKA.Id, segNr: 3, version: 5 },
			account: {
				iban: 'DE991234567123456',
				bic: 'BANK12',
			},
			statementFormat: StatementFormat.PDF,
			statementNumber: 7,
			statementYear: 2026,
			offset: '20260530120235141058000_0',
		};

		expect(encode(segment)).toBe(
			"HKEKA:3:5+DE991234567123456:BANK12+3+7+2026++20260530120235141058000_0'",
		);
	});

	it('decode and encode roundtrip matches', () => {
		const text = "HKEKA:0:5+DE991234567123456:BANK12+3+7+2026++20260530120235141058000_0'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});
});

describe('HIEKA v5', () => {
	// The element order is the whole risk of this segment: `booked` comes AFTER
	// date/year/number, unlike HIEKP v2 where it comes first.
	const text =
		"HIEKA:5:5:3+3+20260601:20260630+20260701+2026+7+@9@%PDF-1.7 +Abschluss+Konditionen+Werbung+DE991234567123456+BANK12+Muster+GmbH+i?:G?:+@4@abcd'";

	it('decode', () => {
		const segment = decode(text) as HIEKASegment;

		expect(segment.format).toBe(StatementFormat.PDF);
		expect(segment.timeRange?.from).toEqual(new Date('2026-06-01'));
		expect(segment.timeRange?.to).toEqual(new Date('2026-06-30'));
		expect(segment.date).toEqual(new Date('2026-07-01'));
		expect(segment.year).toBe(2026);
		expect(segment.number).toBe(7);
		expect(segment.booked).toBe('%PDF-1.7 ');
		expect(segment.closingInfo).toBe('Abschluss');
		expect(segment.conditionsInfo).toBe('Konditionen');
		expect(segment.advertisement).toBe('Werbung');
		expect(segment.iban).toBe('DE991234567123456');
		expect(segment.bic).toBe('BANK12');
		expect(segment.name).toBe('Muster');
		expect(segment.name2).toBe('GmbH');
		expect(segment.name3).toBe('i:G:');
		expect(segment.receipt).toBe('abcd');
	});

	it('decode and encode roundtrip matches', () => {
		expect(encode(decode(text))).toBe(text);
	});

	it('decode without the optional elements', () => {
		const segment = decode("HIEKA:5:5:3+3+20260601:20260630++++@9@%PDF-1.7 '") as HIEKASegment;

		expect(segment.format).toBe(StatementFormat.PDF);
		expect(segment.timeRange?.from).toEqual(new Date('2026-06-01'));
		expect(segment.date).toBeUndefined();
		expect(segment.number).toBeUndefined();
		expect(segment.booked).toBe('%PDF-1.7 ');
		expect(segment.receipt).toBeUndefined();
	});
});

describe('HKEKA / HIEKA older versions', () => {
	// Up to version 3 the request carries the national account connection, from version 4
	// on the international one; `year` does not exist before version 3. Getting this wrong
	// puts an IBAN into the slot the bank reads as an account number.
	it('encodes version 3 with the national account connection and no year', () => {
		const segment: HKEKASegment = {
			header: { segId: HKEKA.Id, segNr: 3, version: 3 },
			account: { accountNumber: '2759161761', bank: { country: 280, bankId: '10090000' } },
			statementFormat: StatementFormat.PDF,
			statementNumber: 7,
		};

		expect(encode(segment)).toBe("HKEKA:3:3+2759161761::280:10090000+3+7'");
	});

	it('encodes version 5 with the international account connection', () => {
		const segment: HKEKASegment = {
			header: { segId: HKEKA.Id, segNr: 3, version: 5 },
			account: { iban: 'DE991234567123456', bic: 'BANK12' },
			statementFormat: StatementFormat.PDF,
			statementNumber: 7,
		};

		expect(encode(segment)).toBe("HKEKA:3:5+DE991234567123456:BANK12+3+7'");
	});

	// Up to version 4 the response has no date/year/number — `booked` follows the time
	// range directly. Decoded with the version 5 layout this does not throw, it hands out
	// the advertisement text as the statement document.
	it('decodes a version 4 response without shifting the document', () => {
		const segment = decode(
			"HIEKA:5:4+3+20260601:20260630+@9@%PDF-1.7 +Abschluss+Konditionen+Werbung+DE991234567123456+BANK12+Muster+++@4@abcd'",
		) as HIEKASegment;

		expect(segment.booked).toBe('%PDF-1.7 ');
		expect(segment.closingInfo).toBe('Abschluss');
		expect(segment.advertisement).toBe('Werbung');
		expect(segment.iban).toBe('DE991234567123456');
		expect(segment.date).toBeUndefined();
		expect(segment.year).toBeUndefined();
		expect(segment.number).toBeUndefined();
		expect(segment.receipt).toBe('abcd');
	});

	it('decodes a version 1 response, which has no iban/bic/name', () => {
		const segment = decode(
			"HIEKA:5:1+3+20260601:20260630+@9@%PDF-1.7 +Abschluss+Konditionen+Werbung+@4@abcd'",
		) as HIEKASegment;

		expect(segment.booked).toBe('%PDF-1.7 ');
		expect(segment.advertisement).toBe('Werbung');
		expect(segment.iban).toBeUndefined();
		expect(segment.receipt).toBe('abcd');
	});
});

describe('HIEKAS v5', () => {
	it('decode and encode roundtrip matches', () => {
		const text = "HIEKAS:4:5:4+1+1+0+J:N:J:1:3'";
		const segment = decode(text) as HIEKASSegment;

		expect(segment.params.indexAllowed).toBe(true);
		expect(segment.params.receiptRequired).toBe(false);
		expect(segment.params.maxEntryCountAllowed).toBe(true);
		expect(segment.params.supportedFormats).toEqual(['1', '3']);

		expect(encode(segment)).toBe(text);
	});
});

describe('binary payloads', () => {
	// A PDF contains every character FinTS uses structurally: + and ' as separators,
	// @ for binary markers, ? for escaping. Only the declared length keeps them apart
	// from real syntax.
	it('carries a payload containing FinTS control characters through unharmed', () => {
		const pdf = "%PDF-1.7\n+ ' @ ? +++ '''\nstartxref\n%%EOF";
		const text = `HIEKA:5:5:3+3+20260601:20260630+20260701+2026+7+@${pdf.length}@${pdf}+++++++++`;

		const segment = decode(`${text}'`) as HIEKASegment;

		expect(segment.booked).toBe(pdf);
		expect(segment.number).toBe(7);
	});

	it('honours the declared length instead of reading to the end of the field', () => {
		// Some banks pad a binary field; the declared length is what counts.
		const pdf = '%PDF-1.7 ';
		const segment = decode(
			`HIEKA:5:5:3+3+20260601:20260630+20260701+2026+7+@${pdf.length}@${pdf}\u0000+++++++++'`,
		) as HIEKASegment;

		expect(segment.booked).toBe(pdf);
		expect(segment.booked).not.toContain('\u0000');
	});
});

describe('ElectronicStatementInteraction', () => {
	const pdf = '%PDF-1.7 fake';

	function messageWith(hieka: string, continuation?: string): Message {
		const answers = continuation
			? `HIRMG:3:2+0010::Entgegengenommen.+3040::Es liegen weitere Dokumente vor.:${continuation}'`
			: "HIRMG:3:2+0010::Entgegengenommen.'";
		return Message.decode(`${answers}${hieka}`);
	}

	function hiekaText(booked: string): string {
		return (
			`HIEKA:5:5:3+3+20260601:20260630+20260701+2026+7+@${booked.length}@${booked}` +
			`+Abschluss+Konditionen+Werbung+DE991234567123456+BANK12+Muster+GmbH++@4@abcd'`
		);
	}

	function handle(message: Message) {
		const interaction = new ElectronicStatementInteraction('123');
		const clientResponse = { bankAnswers: message.getBankAnswers() } as never;
		interaction.handleResponse(message, clientResponse);
		return clientResponse as unknown as ElectronicStatementResponse;
	}

	it('maps the response onto a statement', () => {
		const response = handle(messageWith(hiekaText(pdf)));

		expect(response.statements).toHaveLength(1);
		const statement = response.statements[0];
		expect(statement.format).toBe(StatementFormat.PDF);
		expect(statement.year).toBe(2026);
		expect(statement.number).toBe(7);
		expect(statement.from).toEqual(new Date('2026-06-01'));
		expect(statement.iban).toBe('DE991234567123456');
		expect(statement.accountName).toBe('Muster GmbH');
		expect(statement.receipt).toBe('abcd');
		expect(Buffer.from(statement.document).toString('latin1')).toBe(pdf);
	});

	it('reports the offset of a waiting successor and nothing otherwise', () => {
		expect(handle(messageWith(hiekaText(pdf), 'AUFSETZ_1')).nextOffset).toBe('AUFSETZ_1');
		expect(handle(messageWith(hiekaText(pdf))).nextOffset).toBeUndefined();
	});

	it('collects every statement the response carries', () => {
		const message = messageWith(`${hiekaText(pdf)}${hiekaText('%PDF-1.7 second')}`);
		expect(handle(message).statements).toHaveLength(2);
	});

	it('unwraps a base64 wrapped document, but only when it proves to be one', () => {
		const wrapped = Buffer.from(pdf, 'latin1').toString('base64');
		const unwrapped = handle(messageWith(hiekaText(wrapped))).statements[0].document;
		expect(Buffer.from(unwrapped).toString('latin1')).toBe(pdf);

		// Base64-looking text that does NOT decode to a document must survive untouched.
		const notADocument = 'SGVsbG8gV29ybGQ=';
		const kept = handle(messageWith(hiekaText(notADocument))).statements[0].document;
		expect(Buffer.from(kept).toString('latin1')).toBe(notADocument);
	});
});
