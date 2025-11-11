import { describe, it, expect } from 'vitest';
import { registerSegments } from '../segments/registry.js';
import { HKCCS, HKCCSSegment } from '../segments/HKCCS.js';
import { decode, encode } from '../segment.js';

registerSegments();

describe('HKCCS v1', () => {
	it('encode', () => {
		const painMessage = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.003.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>MSG-123</MsgId>
      <CreDtTm>2024-01-01T12:00:00Z</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>100.00</CtrlSum>
    </GrpHdr>
  </CstmrCdtTrfInitn>
</Document>`;

		const segment: HKCCSSegment = {
			header: { segId: HKCCS.Id, segNr: 1, version: 1 },
			account: {
				iban: 'DE89370400440532013000',
				bic: 'COBADEFFXXX',
			},
			sepaDescriptor: 'urn:iso:std:iso:20022:tech:xsd:pain.001.003.03',
			sepaPainMessage: painMessage,
		};

		const encoded = encode(segment);
		expect(encoded).toContain('HKCCS:1:1+');
		expect(encoded).toContain('DE89370400440532013000:COBADEFFXXX');
		expect(encoded).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.003.03');
		expect(encoded).toContain('@');
		expect(encoded).toContain(painMessage);
	});

	it('encode with minimal data', () => {
		const painMessage = '<Document></Document>';

		const segment: HKCCSSegment = {
			header: { segId: HKCCS.Id, segNr: 3, version: 1 },
			account: {
				iban: 'DE89370400440532013000',
			},
			sepaDescriptor: 'urn:iso:std:iso:20022:tech:xsd:pain.001.003.03',
			sepaPainMessage: painMessage,
		};

		const encoded = encode(segment);
		expect(encoded).toContain('HKCCS:3:1+');
		expect(encoded).toContain('DE89370400440532013000');
		expect(encoded).toContain('@21@<Document></Document>');
		expect(encoded).toContain('urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.001.003.03');
	});

	it('decode and encode roundtrip matches', () => {
		const painMessage = '<Document><Test>Data</Test></Document>';
		// Note: colons in sepaDescriptor are escaped as ?: in FinTS encoding
		const text = `HKCCS:0:1+DE89370400440532013000:COBADEFFXXX+urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.001.003.03+@${painMessage.length}@${painMessage}'`;
		const segment = decode(text);
		expect(encode(segment)).toBe(text);
	});
});
