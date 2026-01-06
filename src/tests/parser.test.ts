import { describe, expect, it } from 'vitest';
import { splitBySeparator } from '../parser.js';

describe('splitBySeparator', () => {
	it('works with binary elements', () => {
		const text =
			"HNVSD:999:1+@105@HNSHK:2:4+PIN:1+999+6506545+1+1+1::0+1+1:20240121:120140+1:999:1+6:10:16+280:12030000:1234567890_p:S:0:0''HNHBS:7:1+1'";

		const segments = splitBySeparator(text, "'");

		expect(segments.length).toBe(2);
		expect(segments[0].slice(0, 5)).toBe('HNVSD');
		expect(segments[1].slice(0, 5)).toBe('HNHBS');
	});

	it('ignores escaped separators', () => {
		const text = 'HNSHK:2:4+PIN:1+999+hello?+world??+3+2+1';

		const segments = splitBySeparator(text, '+');

		expect(segments.length).toBe(7);
		expect(segments[0]).toBe('HNSHK:2:4');
		expect(segments[1]).toBe('PIN:1');
		expect(segments[3]).toBe('hello?+world??');
		expect(segments[6]).toBe('1');
	});
});
