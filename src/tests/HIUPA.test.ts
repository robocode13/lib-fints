import { describe, it, expect } from 'vitest';
import { registerSegments } from '../segments/registry.js';
import { decode, encode } from '../segment.js';

registerSegments();

describe('HIUPA', () => {
	it('decode and encode roundtrip matches', () => {
		const text = "HIUPA:165:4:4+1197651234+0+0++PERSNR0010488691234'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});
});
