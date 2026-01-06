import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import type { HIPINSSegment } from '../segments/HIPINS.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HIPINS', () => {
	it('decode and encode roundtrip matches', () => {
		const text = "HIPINS:164:1:4+1+1+0+5:38:6:USERID:CUSTID:HKCSU:J:HKPKB:N:HKPKA:J:HKSAL:J'";
		const segment = decode(text) as HIPINSSegment;

		expect(segment.params.maxPinLen).toBe(38);
		expect(segment.params.transactions[3].transId).toBe('HKSAL');
		expect(segment.params.transactions[3].tanRequired).toBe(true);

		expect(encode(segment)).toBe(text);
	});
});
