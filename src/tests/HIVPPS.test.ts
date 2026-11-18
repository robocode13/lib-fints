import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import type { HIVPPSSegment } from '../segments/HIVPPS.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HIVPPS v1', () => {
	it('decode and encode roundtrip matches', () => {
		const text =
			"HIVPPS:27:1:4+1+1+0+500:J:V:N:N:urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.002.001.10:HKCCS:HKCDE:HKCSE:HKIPZ'";
		const segment = decode(text) as HIVPPSSegment;

		expect(segment.params).toEqual({
			maxOptInTransactions: 500,
			noticeStructured: true,
			reportDelivery: 'V',
			batchWithSingleOrderAllowed: false,
			entryCountAllowed: false,
			supportedReportFormats: 'urn:iso:std:iso:20022:tech:xsd:pain.002.001.10',
			vopRequiredTransactions: ['HKCCS', 'HKCDE', 'HKCSE', 'HKIPZ'],
		});
		expect(encode(segment)).toBe(text);
	});

	it('decodes a single VoP required transaction', () => {
		const text =
			"HIVPPS:92:1:3+1+0+0+1000:N:S:J:J:urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.002.001.10:HKCCS'";
		const segment = decode(text) as HIVPPSSegment;

		expect(segment.params.reportDelivery).toBe('S');
		expect(segment.params.entryCountAllowed).toBe(true);
		expect(segment.params.vopRequiredTransactions).toEqual(['HKCCS']);
		expect(encode(segment)).toBe(text);
	});
});
