import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import { HKCCS, type HKCCSSegment } from '../segments/HKCCS.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

const PAIN = '<?xml version="1.0"?><Document><Nm>A+B: C\'s</Nm></Document>';

describe('HKCCS v1', () => {
	it('encode carries the pain message as binary, unescaped', () => {
		const segment: HKCCSSegment = {
			header: { segId: HKCCS.Id, segNr: 3, version: 1 },
			account: { iban: 'DE991234567123456', bic: 'BANK12' },
			sepaDescriptor: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09',
			sepaPainMessage: PAIN,
		};

		expect(encode(segment)).toBe(
			`HKCCS:3:1+DE991234567123456:BANK12+urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.001.001.09+@${PAIN.length}@${PAIN}'`,
		);
	});

	it('decode and encode roundtrip matches', () => {
		const text = `HKCCS:3:1+DE991234567123456:BANK12+urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.001.001.09+@${PAIN.length}@${PAIN}'`;
		expect(encode(decode(text))).toBe(text);
	});
});
