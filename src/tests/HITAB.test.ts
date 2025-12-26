import exp from 'constants';
import { describe, expect, it } from 'vitest';
import { decode, encode, segmentToString } from '../segment.js';
import { HITAB, type HITABSegment } from '../segments/HITAB.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HITAB', () => {
	it('decodes correctly', () => {
		const text = "HITAB:5:4:3+0+A:1:::::::::::Media1::::::::+A:1:::::::::::Media2::::::::'";
		const segment = decode(text) as HITABSegment;

		expect(segment.mediaList).toBeDefined();
		expect(segment.mediaList!.length).toBe(2);
		expect(segment.mediaList![0].name).toBe('Media1');
	});

	it('decode and encode roundtrip matches', () => {
		HITAB.Id;

		const text = "HITAB:5:4:3+0+A:1:::::::::::Greenwood::::::::+A:1:::::::::::iPhone::::::::'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});

	it('decodes and stringifies when list is empty', () => {
		HITAB.Id;

		const text = 'HITAB:4:5:3+0';
		const segment = decode(text) as HITABSegment;
		expect(segmentToString(segment)).toBe('   4. HITAB v5 RefSeg: 3; tanUsage: 0');
	});
});
