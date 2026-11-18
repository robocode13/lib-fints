import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import { HKVPP, type HKVPPSegment } from '../segments/HKVPP.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

const PAIN_002_10 = 'urn:iso:std:iso:20022:tech:xsd:pain.002.001.10';

describe('HKVPP v1', () => {
	it('encode a first check request', () => {
		const segment: HKVPPSegment = {
			header: { segId: HKVPP.Id, segNr: 3, version: 1 },
			supportedReports: [PAIN_002_10],
		};

		expect(encode(segment)).toBe(
			"HKVPP:3:1+urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.002.001.10'",
		);
	});

	it('encode a repeated request with polling ID and touchdown point', () => {
		const segment: HKVPPSegment = {
			header: { segId: HKVPP.Id, segNr: 3, version: 1 },
			supportedReports: [PAIN_002_10],
			pollingId: 'POLL-0001',
			touchdownPoint: 'TP-0001',
		};

		expect(encode(segment)).toBe(
			"HKVPP:3:1+urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.002.001.10+@9@POLL-0001++TP-0001'",
		);
	});

	it('has no continuationMark element, so 3040 never repeats the payment order', () => {
		expect(new HKVPP().elements.map((element) => element.name)).not.toContain('continuationMark');
	});

	it('decode and encode roundtrip matches', () => {
		const text =
			"HKVPP:3:1+urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.002.001.10:urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.002.001.14+@9@POLL-0001+50+TP-0001'";
		const segment = decode(text) as HKVPPSegment;

		expect(segment.supportedReports).toEqual([
			PAIN_002_10,
			'urn:iso:std:iso:20022:tech:xsd:pain.002.001.14',
		]);
		expect(segment.pollingId).toBe('POLL-0001');
		expect(segment.maxEntries).toBe(50);
		expect(segment.touchdownPoint).toBe('TP-0001');
		expect(encode(segment)).toBe(text);
	});
});
