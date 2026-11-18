import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import { HKCCS, type HKCCSSegment } from '../segments/HKCCS.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

const PAIN_001_09 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09';

describe('HKCCS v1', () => {
	it('encode', () => {
		const pain = '<Document><Nm>Max Mustermann</Nm></Document>';
		const segment: HKCCSSegment = {
			header: { segId: HKCCS.Id, segNr: 4, version: 1 },
			account: { iban: 'DE02120300000000202051', bic: 'BYLADEM1001' },
			sepaDescriptor: PAIN_001_09,
			sepaPainMessage: pain,
		};

		expect(encode(segment)).toBe(
			`HKCCS:4:1+DE02120300000000202051:BYLADEM1001+urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.001.001.09+@${pain.length}@${pain}'`,
		);
	});

	it('carries the pain message as binary, without escaping', () => {
		// Separators and escape characters inside the document must reach the bank as
		// they are: the length prefix is what delimits the data.
		const pain = "<Ustrd>Rechnung 1+2 ?: O'Neil</Ustrd>";
		const segment: HKCCSSegment = {
			header: { segId: HKCCS.Id, segNr: 3, version: 1 },
			account: { iban: 'DE02120300000000202051', bic: 'BYLADEM1001' },
			sepaDescriptor: PAIN_001_09,
			sepaPainMessage: pain,
		};

		const text = encode(segment);
		expect(text.endsWith(`+@${pain.length}@${pain}'`)).toBe(true);
		expect((decode(text) as HKCCSSegment).sepaPainMessage).toBe(pain);
	});

	it('counts bytes, not characters, for a UTF-8 document', () => {
		const xml = '<Nm>Jürgen Müller</Nm>';
		const bytes = Buffer.from(xml, 'utf8').toString('latin1');
		const segment: HKCCSSegment = {
			header: { segId: HKCCS.Id, segNr: 3, version: 1 },
			account: { iban: 'DE02120300000000202051' },
			sepaDescriptor: PAIN_001_09,
			sepaPainMessage: bytes,
		};

		expect(encode(segment)).toContain(`@${xml.length + 2}@`);
	});

	it('decode and encode roundtrip matches', () => {
		const text =
			"HKCCS:3:1+DE02120300000000202051:BYLADEM1001+urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.001.001.09+@13@<Document/>  '";
		const segment = decode(text) as HKCCSSegment;
		expect(segment.account.iban).toBe('DE02120300000000202051');
		expect(segment.sepaDescriptor).toBe(PAIN_001_09);
		expect(segment.sepaPainMessage).toBe('<Document/>  ');
		expect(encode(segment)).toBe(text);
	});
});
