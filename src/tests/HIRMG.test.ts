import { describe, it, expect } from 'vitest';
import { registerSegments } from '../segments/registry.js';
import { HIRMGSegment } from '../segments/HIRMG.js';
import { decode, encode, segmentToString } from '../segment.js';

registerSegments();

describe('HIRMG', () => {
	it('decodes correctly', () => {
		const text =
			"HIRMG:3:2+0010::Nachricht entgegengenommen.+3920::Zugelassene Zwei-Schritt-Verfahren für den Benutzer.:921:922'";
		const segment = decode(text) as HIRMGSegment;

		expect(segment.answers.length).toBe(2);
		expect(segment.answers[0].code).toBe(10);
		expect(segment.answers[1].code).toBe(3920);
		expect(segment.answers[1].params).toEqual(['921', '922']);
	});

	it('decode and encode roundtrip matches', () => {
		const text = "HIRMG:3:2+0010::Nachricht entgegengenommen.+0100::Dialog beendet.'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});

	it('decode and toString() gives correct output', () => {
		const text = "HIRMG:3:2+0010::Nachricht entgegengenommen.+0100::Dialog beendet.'";
		const segment = decode(text);
		expect(segmentToString(segment)).toBe(
			'   3. HIRMG v2; [code: 10, text: Nachricht entgegengenommen.]; [code: 100, text: Dialog beendet.]',
		);
	});
});
