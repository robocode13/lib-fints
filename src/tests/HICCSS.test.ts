import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import type { HICCSSSegment } from '../segments/HICCSS.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HICCSS v1', () => {
	it('decode and encode roundtrip matches', () => {
		const text = "HICCSS:61:1:4+1+1+1'";
		const segment = decode(text) as HICCSSSegment;

		expect(segment.header.segId).toBe('HICCSS');
		expect(segment.maxTrans).toBe(1);
		expect(segment.minSigs).toBe(1);
		expect(segment.secClass).toBe(1);
		expect(encode(segment)).toBe(text);
	});
});
