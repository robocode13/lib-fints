import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HNVSK', () => {
	it('decode and encode roundtrip matches', () => {
		const text =
			"HNVSK:998:3+PIN:1+998+1+1::0+1:20240121:120140+2:2:13:@8@00000000:5:1+280:12030000:1234567890_p:S:0:0+0'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});
});
