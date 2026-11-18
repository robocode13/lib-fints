import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import { HKVPA, type HKVPASegment } from '../segments/HKVPA.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HKVPA v1', () => {
	it('encode', () => {
		const segment: HKVPASegment = {
			header: { segId: HKVPA.Id, segNr: 3, version: 1 },
			vopId: 'VOP-ID-12345',
		};

		expect(encode(segment)).toBe("HKVPA:3:1+@12@VOP-ID-12345'");
	});

	it('decode and encode roundtrip matches with binary content', () => {
		const text = "HKVPA:3:1+@8@a+b:c'd?'";
		const segment = decode(text) as HKVPASegment;
		expect(segment.vopId).toBe("a+b:c'd?");
		expect(encode(segment)).toBe(text);
	});
});
