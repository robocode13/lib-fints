import { describe, it, expect } from 'vitest';
import { registerSegments } from '../segments/registry.js';
import { HIBPA, type HIBPASegment } from '../segments/HIBPA.js';
import { decode, encode } from '../segment.js';

registerSegments();

describe('HIBPA', () => {
	it('has correct id', () => {
		const definition = new HIBPA();
		expect(definition.id).toBe('HIBPA');
		expect(HIBPA.Id).toBe('HIBPA');
	});

	it('decodes correctly', () => {
		const text =
			"HIBPA:4:3:3+12+280:12030000+Deutsche Kreditbank Aktiengesellschaft+3+1:2:3+220:300'";
		const segment = decode(text) as HIBPASegment;

		expect(segment.supportedLanguages.length).toBe(3);
		expect(segment.supportedHbciVersions.length).toBe(2);
		expect(segment.supportedLanguages[2]).toBe(3);
		expect(segment.supportedHbciVersions[1]).toBe(300);
	});

	it('decode and encode roundtrip matches', () => {
		HIBPA.Id;

		const text = "HIBPA:4:3:3+12+280:12030000+Deutsche Kreditbank Aktiengesellschaft+3+1+300'";
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});
});
