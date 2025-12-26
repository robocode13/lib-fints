import { describe, it, expect } from 'vitest';
import { HKIDN, HKIDNSegment } from '../segments/HKIDN.js';
import { registerSegments } from '../segments/registry.js';
import { decode, encode } from '../segment.js';

registerSegments();

describe('HKIDN', () => {
	it('encodes correctly', () => {
		const segment: HKIDNSegment = {
			header: { segId: HKIDN.Id, segNr: 1, version: 2 },
			bank: { country: 280, bankId: '12030000' },
			systemId: '4711',
			customerId: '1022334455_p',
			systemIdRequired: 1,
		};

		expect(encode(segment)).toBe("HKIDN:1:2+280:12030000+1022334455_p+4711+1'");
	});

	it('decode and encode roundtrip matches', () => {
		const text = "HKIDN:1:2+280:12030000+1022334455_p+4711+1'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});
});
