import { describe, it, expect } from 'vitest';
import { registerSegments } from '../segments/registry.js';
import { HKCAZ, type HKCAZSegment } from '../segments/HKCAZ.js';
import { decode, encode } from '../segment.js';

registerSegments();

describe('HKCAZ v1', () => {
	it('encode', () => {
		const segment: HKCAZSegment = {
			header: { segId: HKCAZ.Id, segNr: 1, version: 1 },
			account: {
				iban: 'DE991234567123456',
				bic: 'BANK12',
				accountNumber: '123456',
				bank: { country: 280, bankId: '12030000' },
			},
			acceptedCamtFormats: ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'],
			allAccounts: false,
			from: new Date('2023-01-01'),
			to: new Date('2023-12-31'),
		};

		expect(encode(segment)).toBe(
			"HKCAZ:1:1+DE991234567123456:BANK12:123456::280:12030000+urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08+N+20230101+20231231'",
		);
	});

	it('encode without optional dates', () => {
		const segment: HKCAZSegment = {
			header: { segId: HKCAZ.Id, segNr: 2, version: 1 },
			account: {
				iban: 'DE991234567123456',
				bic: 'BANK12',
				accountNumber: '123456',
				bank: { country: 280, bankId: '12030000' },
			},
			acceptedCamtFormats: ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'],
			allAccounts: true,
		};

		expect(encode(segment)).toBe(
			"HKCAZ:2:1+DE991234567123456:BANK12:123456::280:12030000+urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08+J'",
		);
	});

	it('decode and encode roundtrip matches', () => {
		const text =
			"HKCAZ:0:1+DE991234567123456:BANK12:123456::280:12030000+urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08+N+20230101+20231231'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});

	it('decode and encode roundtrip without dates', () => {
		const text =
			"HKCAZ:0:1+DE991234567123456:BANK12+urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08+J'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});
});
