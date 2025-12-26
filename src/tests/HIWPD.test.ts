import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import { HIWPD, type HIWPDSegment } from '../segments/HIWPD.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HIWPD', () => {
	it('decode and encode roundtrip matches', () => {
		const portfolioData = 'U29tZSBTd2lmdCBNVCA1MzUvNTcxIGRhdGE=';
		const text = `HIWPD:1:6+${portfolioData}'`;
		const segment = decode(text) as HIWPDSegment;

		expect(segment.portfolioStatement).toBe(portfolioData);

		const expectedEncodedText = `HIWPD:1:6+@${portfolioData.length}@${portfolioData}'`;
		expect(encode(segment)).toBe(expectedEncodedText);
	});

	it('handles empty portfolio data', () => {
		const text = "HIWPD:1:6+@@'";
		const segment = decode(text) as HIWPDSegment;
		expect(segment.portfolioStatement).toBe('');
	});

	it('handles large portfolio data', () => {
		const largeData = 'A'.repeat(1000);
		const text = `HIWPD:1:6+${largeData}'`;
		const segment = decode(text) as HIWPDSegment;
		expect(segment.portfolioStatement).toBe(largeData);
	});
});
