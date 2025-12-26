import { describe, it, expect } from 'vitest';
import { registerSegments } from '../segments/registry.js';
import { decode, encode } from '../segment.js';

registerSegments();

describe('HNSHK', () => {
	it('decode and encode roundtrip matches', () => {
		const text =
			"HNSHK:2:4+PIN:1+999+6506545+1+1+1::0+1+1:20240121:120140+1:999:1+6:10:16+280:12030000:1234567890_p:S:0:0'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});
});
