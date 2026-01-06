import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import { HKSAL, type HKSALSegment } from '../segments/HKSAL.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HKSAL v8', () => {
	it('encode', () => {
		const segment: HKSALSegment = {
			header: { segId: HKSAL.Id, segNr: 1, version: 8 },
			allAccounts: false,
			account: {
				iban: 'DE991234567123456',
				bic: 'BANK12',
				accountNumber: '123456',
				bank: { country: 280, bankId: '12030000' },
			},
		};

		expect(encode(segment)).toBe("HKSAL:1:8+DE991234567123456:BANK12:123456::280:12030000+N'");
	});

	it('decode and encode roundtrip matches', () => {
		const text = "HKSAL:0:8+DE991234567123456:BANK12+N'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});
});

describe('HKSAL v6', () => {
	it('encode', () => {
		const segment: HKSALSegment = {
			header: { segId: HKSAL.Id, segNr: 1, version: 6 },
			allAccounts: false,
			account: {
				iban: 'DE991234567123456',
				bic: 'BANK12',
				accountNumber: '123456',
				bank: { country: 280, bankId: '12030000' },
			},
		};

		expect(encode(segment)).toBe("HKSAL:1:6+123456::280:12030000+N'");
	});

	it('decode and encode roundtrip matches', () => {
		const text = "HKSAL:0:6+123456::280:12030000+N'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});
});
