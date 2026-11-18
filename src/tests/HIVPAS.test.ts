import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import type { HIVPASSegment } from '../segments/HIVPAS.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HIVPAS v1', () => {
	it('decode and encode roundtrip matches', () => {
		const text = "HIVPAS:28:1:4+1+0+0'";
		const segment = decode(text) as HIVPASSegment;

		expect(segment.header.segId).toBe('HIVPAS');
		expect(segment.maxTrans).toBe(1);
		expect(segment.minSigs).toBe(0);
		expect(segment.secClass).toBe(0);
		expect(encode(segment)).toBe(text);
	});
});
