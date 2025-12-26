import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HIUPA', () => {
	it('decode and encode roundtrip matches', () => {
		const text = "HIUPA:165:4:4+1197651234+0+0++PERSNR0010488691234'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});
});
