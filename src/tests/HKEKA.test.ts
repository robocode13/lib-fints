import { describe, expect, it } from 'vitest';
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
