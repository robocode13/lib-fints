import { describe, expect, it } from 'vitest';
import { TanProcess } from '../codes.js';
import { decode, encode } from '../segment.js';
import { HKTAN, type HKTANSegment } from '../segments/HKTAN.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HKTAN', () => {
	it('encode', () => {
		const segment: HKTANSegment = {
			header: { segId: HKTAN.Id, segNr: 1, version: 6 },
			segId: 'HKKAZ',
			tanProcess: TanProcess.Process4,
			tanMedia: 'Media1',
		};

		expect(encode(segment)).toBe("HKTAN:1:6+4+HKKAZ+++++++++Media1'");
	});

	it('decode and encode roundtrip matches', () => {
		const text = "HKTAN:5:6+4+HKIDN'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});
});
