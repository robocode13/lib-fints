import { describe, it, expect } from 'vitest';
import { registerSegments } from '../segments/registry.js';
import { decode, encode } from '../segment.js';
import { HICAZSSegment } from '../segments/HICAZS.js';

registerSegments();

describe('HICAZS', () => {
	it('decode and encode roundtrip matches', () => {
		const text =
			"HICAZS:16:1:4+1+1+0+450:N:N:urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08:urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.02'";
		const segment = decode(text) as HICAZSSegment;

		expect(segment.params.maxDays).toBe(450);
		expect(segment.params.entryCountAllowed).toBeFalsy();
		expect(segment.params.allAccountsAllowed).toBeFalsy();
		expect(segment.params.supportedCamtFormats).toEqual([
			'urn:iso:std:iso:20022:tech:xsd:camt.052.001.08',
			'urn:iso:std:iso:20022:tech:xsd:camt.052.001.02',
		]);

		expect(encode(segment)).toBe(text);
	});
});
