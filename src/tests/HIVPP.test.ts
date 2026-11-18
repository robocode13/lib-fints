import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import type { HIVPPSegment } from '../segments/HIVPP.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HIVPP v1', () => {
	it('decodes a single result with a close match', () => {
		const text =
			"HIVPP:5:1:3+@12@VOP-ID-12345+20261118:120000++++DE02120300000000202051::Max Mustermann::RVMC+Der Name weicht ab. Bitte pruefen.'";
		const segment = decode(text) as HIVPPSegment;

		expect(segment.vopId).toBe('VOP-ID-12345');
		expect(segment.vopIdValidUntil?.date).toBeInstanceOf(Date);
		expect(segment.pollingId).toBeUndefined();
		expect(segment.paymentStatusReport).toBeUndefined();
		expect(segment.singleResult).toEqual({
			iban: 'DE02120300000000202051',
			ibanAdditionalInfo: undefined,
			closeMatchName: 'Max Mustermann',
			otherIdentification: undefined,
			result: 'RVMC',
			notApplicableReason: undefined,
		});
		expect(segment.notice).toBe('Der Name weicht ab. Bitte pruefen.');
		expect(encode(segment)).toBe(text);
	});

	it('decodes a not applicable result with its reason', () => {
		const text =
			"HIVPP:5:1:3+@6@VOP-01+++++DE02120300000000202051::::RVNA:Empfaengerbank nimmt nicht teil'";
		const segment = decode(text) as HIVPPSegment;

		expect(segment.singleResult?.result).toBe('RVNA');
		expect(segment.singleResult?.notApplicableReason).toBe('Empfaengerbank nimmt nicht teil');
		expect(encode(segment)).toBe(text);
	});

	it('decodes a pending answer carrying only a polling ID and a wait time', () => {
		const text = "HIVPP:5:1:3+++@10@POLL-12345+++++2'";
		const segment = decode(text) as HIVPPSegment;

		expect(segment.vopId).toBeUndefined();
		expect(segment.pollingId).toBe('POLL-12345');
		expect(segment.singleResult).toBeUndefined();
		expect(segment.waitSeconds).toBe(2);
		expect(encode(segment)).toBe(text);
	});

	it('decodes a result delivered as pain.002', () => {
		const pain002 =
			'<?xml version="1.0" encoding="UTF-8"?><Document><CstmrPmtStsRpt><OrgnlGrpInfAndSts><GrpSts>RCVC</GrpSts></OrgnlGrpInfAndSts></CstmrPmtStsRpt></Document>';
		const text = `HIVPP:5:1:3+@6@VOP-01+++urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.002.001.10+@${pain002.length}@${pain002}'`;
		const segment = decode(text) as HIVPPSegment;

		expect(segment.vopId).toBe('VOP-01');
		expect(segment.paymentStatusReportDescriptor).toBe(
			'urn:iso:std:iso:20022:tech:xsd:pain.002.001.10',
		);
		expect(segment.paymentStatusReport).toBe(pain002);
		expect(encode(segment)).toBe(text);
	});

	it('decodes a VoP ID without any result', () => {
		const text = "HIVPP:5:1:3+@11@notprovided'";
		const segment = decode(text) as HIVPPSegment;

		expect(segment.vopId).toBe('notprovided');
		expect(segment.singleResult).toBeUndefined();
		expect(segment.paymentStatusReport).toBeUndefined();
		expect(encode(segment)).toBe(text);
	});
});
