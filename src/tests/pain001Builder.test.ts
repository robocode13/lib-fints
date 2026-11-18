import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import {
	buildPain001,
	type CreditTransfer,
	normalizeBic,
	normalizeIban,
	PAIN_001_001_03,
	PAIN_001_001_09,
	type Pain001Debtor,
	SepaValidationError,
	selectPain001Format,
} from '../pain001Builder.js';

const debtor: Pain001Debtor = {
	name: 'Erika Mustermann',
	iban: 'DE89370400440532013000',
};

const transfer: CreditTransfer = {
	name: 'Max Mustermann',
	iban: 'DE02120300000000202051',
	amount: 12.5,
	purpose: 'Rechnung 4711',
	endToEndId: 'E2E-2026-0001',
};

const now = new Date(2026, 10, 18, 9, 5, 7);

// biome-ignore lint/suspicious/noExplicitAny: parsed XML in tests
function parse(xml: string): any {
	expect(XMLValidator.validate(xml)).toBe(true);
	return new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@',
		parseTagValue: false,
	}).parse(xml).Document;
}

function expectValidationError(action: () => unknown, field: string, message: RegExp) {
	try {
		action();
	} catch (error) {
		expect(error).toBeInstanceOf(SepaValidationError);
		expect((error as SepaValidationError).field).toBe(field);
		expect((error as Error).message).toMatch(message);
		return;
	}
	throw new Error('expected a SepaValidationError');
}

describe('selectPain001Format', () => {
	it('prefers pain.001.001.09', () => {
		expect(
			selectPain001Format([
				'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08',
				PAIN_001_001_03,
				PAIN_001_001_09,
			]),
		).toBe(PAIN_001_001_09);
	});

	it('falls back to pain.001.001.03', () => {
		expect(selectPain001Format([PAIN_001_001_03, 'sepade.pain.008.001.02.xsd'])).toBe(
			PAIN_001_001_03,
		);
	});

	it('returns undefined when the bank lists only formats this library does not write', () => {
		expect(selectPain001Format(['urn:iso:std:iso:20022:tech:xsd:pain.001.001.12'])).toBeUndefined();
	});

	it('uses pain.001.001.09 when the bank lists no formats', () => {
		expect(selectPain001Format(undefined)).toBe(PAIN_001_001_09);
		expect(selectPain001Format([])).toBe(PAIN_001_001_09);
	});
});

describe('normalizeIban', () => {
	it('removes spaces and upper-cases', () => {
		expect(normalizeIban('de02 1203 0000 0000 2020 51')).toBe('DE02120300000000202051');
	});

	it('accepts IBANs of other SEPA countries', () => {
		expect(normalizeIban('GB82 WEST 1234 5698 7654 32')).toBe('GB82WEST12345698765432');
	});

	it('rejects wrong check digits', () => {
		expectValidationError(() => normalizeIban('DE03120300000000202051'), 'iban', /check digits/);
	});

	it('rejects letters that only upper-case to ASCII', () => {
		// The long s (ſ) upper-cases to S, which would make the IBAN checksum-valid
		expectValidationError(() => normalizeIban('GB82WEſT12345698765432'), 'iban', /well-formed/);
	});

	it('rejects an IBAN of the wrong length for its country before the checksum', () => {
		// Valid check digits, but one digit too many for a German IBAN
		expectValidationError(() => normalizeIban('DE890370400440532013000'), 'iban', /22 characters/);
	});

	it('rejects malformed IBANs', () => {
		expectValidationError(() => normalizeIban('DE0212030000-0000202051'), 'iban', /well-formed/);
		expectValidationError(() => normalizeIban('DE02'), 'iban', /well-formed/);
		expectValidationError(() => normalizeIban(''), 'iban', /well-formed/);
	});
});

describe('normalizeBic', () => {
	it('accepts 8 and 11 characters', () => {
		expect(normalizeBic('TESTDEFF')).toBe('TESTDEFF');
		expect(normalizeBic('testdeffxxx')).toBe('TESTDEFFXXX');
	});

	it('rejects malformed BICs', () => {
		expectValidationError(() => normalizeBic('TESTDEF'), 'bic', /not a valid BIC/);
		expectValidationError(() => normalizeBic('TEST1EFF'), 'bic', /not a valid BIC/);
		expectValidationError(() => normalizeBic('TESTDEFFXX'), 'bic', /not a valid BIC/);
		expectValidationError(() => normalizeBic('TESTDEFF XXX'), 'bic', /not a valid BIC/);
	});
});

describe('buildPain001', () => {
	it('builds a pain.001.001.09 credit transfer for immediate execution', () => {
		const message = buildPain001(debtor, transfer, PAIN_001_001_09, now);

		expect(message.descriptor).toBe(PAIN_001_001_09);
		expect(message.messageId).toMatch(/^[0-9a-f]{32}$/);
		expect(message.endToEndId).toBe('E2E-2026-0001');

		const document = parse(message.xml);
		expect(document['@xmlns']).toBe(PAIN_001_001_09);

		const header = document.CstmrCdtTrfInitn.GrpHdr;
		expect(header.MsgId).toBe(message.messageId);
		expect(header.CreDtTm).toBe('2026-11-18T09:05:07');
		expect(header.NbOfTxs).toBe('1');
		expect(header.CtrlSum).toBe('12.50');
		expect(header.InitgPty.Nm).toBe('Erika Mustermann');

		const paymentInfo = document.CstmrCdtTrfInitn.PmtInf;
		expect(paymentInfo.PmtInfId).toMatch(/^[0-9a-f]{32}$/);
		expect(paymentInfo.PmtInfId).not.toBe(message.messageId);
		expect(paymentInfo.PmtMtd).toBe('TRF');
		expect(paymentInfo.NbOfTxs).toBe('1');
		expect(paymentInfo.CtrlSum).toBe('12.50');
		expect(paymentInfo.PmtTpInf.SvcLvl.Cd).toBe('SEPA');
		expect(paymentInfo.ReqdExctnDt.Dt).toBe('1999-01-01');
		expect(paymentInfo.Dbtr.Nm).toBe('Erika Mustermann');
		expect(paymentInfo.DbtrAcct.Id.IBAN).toBe('DE89370400440532013000');
		expect(paymentInfo.DbtrAgt.FinInstnId.Othr.Id).toBe('NOTPROVIDED');
		expect(paymentInfo.ChrgBr).toBe('SLEV');

		const tx = paymentInfo.CdtTrfTxInf;
		expect(tx.PmtId.EndToEndId).toBe('E2E-2026-0001');
		expect(tx.Amt.InstdAmt['#text']).toBe('12.50');
		expect(tx.Amt.InstdAmt['@Ccy']).toBe('EUR');
		expect(tx.CdtrAgt).toBeUndefined();
		expect(tx.Cdtr.Nm).toBe('Max Mustermann');
		expect(tx.CdtrAcct.Id.IBAN).toBe('DE02120300000000202051');
		expect(tx.RmtInf.Ustrd).toBe('Rechnung 4711');
	});

	it('builds a pain.001.001.03 credit transfer with the older element names', () => {
		const message = buildPain001(
			{ ...debtor, bic: 'TESTDEFFXXX' },
			{ ...transfer, bic: 'testde88' },
			PAIN_001_001_03,
			now,
		);

		const paymentInfo = parse(message.xml).CstmrCdtTrfInitn.PmtInf;
		expect(paymentInfo.ReqdExctnDt).toBe('1999-01-01');
		expect(paymentInfo.DbtrAgt.FinInstnId.BIC).toBe('TESTDEFFXXX');
		expect(paymentInfo.CdtTrfTxInf.CdtrAgt.FinInstnId.BIC).toBe('TESTDE88');
	});

	it('writes BICFI for pain.001.001.09', () => {
		const message = buildPain001(
			{ ...debtor, bic: 'TESTDEFFXXX' },
			{ ...transfer, bic: 'TESTDE88' },
			PAIN_001_001_09,
			now,
		);

		const paymentInfo = parse(message.xml).CstmrCdtTrfInitn.PmtInf;
		expect(paymentInfo.DbtrAgt.FinInstnId.BICFI).toBe('TESTDEFFXXX');
		expect(paymentInfo.CdtTrfTxInf.CdtrAgt.FinInstnId.BICFI).toBe('TESTDE88');
	});

	it('defaults the end-to-end ID to NOTPROVIDED and leaves out empty remittance information', () => {
		const message = buildPain001(
			debtor,
			{ name: 'Max Mustermann', iban: 'DE02120300000000202051', amount: 1 },
			PAIN_001_001_09,
			now,
		);

		expect(message.endToEndId).toBe('NOTPROVIDED');
		const tx = parse(message.xml).CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf;
		expect(tx.PmtId.EndToEndId).toBe('NOTPROVIDED');
		expect(tx.Amt.InstdAmt['#text']).toBe('1.00');
		expect(tx.RmtInf).toBeUndefined();
	});

	it('generates new IDs for every message', () => {
		const first = buildPain001(debtor, transfer);
		const second = buildPain001(debtor, transfer);
		expect(first.messageId).not.toBe(second.messageId);
	});

	it('escapes XML special characters', () => {
		const message = buildPain001(
			debtor,
			{ ...transfer, name: "Müller & O'Brien", purpose: 'A&B' },
			PAIN_001_001_09,
			now,
		);

		expect(message.xml).toContain('<Nm>Müller &amp; O&apos;Brien</Nm>');
		expect(message.xml).toContain('<Ustrd>A&amp;B</Ustrd>');
		const tx = new XMLParser({ processEntities: true }).parse(message.xml).Document.CstmrCdtTrfInitn
			.PmtInf.CdtTrfTxInf;
		expect(tx.Cdtr.Nm).toBe("Müller & O'Brien");
	});

	it('returns the UTF-8 bytes one character per byte', () => {
		const message = buildPain001(debtor, { ...transfer, name: 'Jörg Weiß' }, PAIN_001_001_09, now);

		expect(message.bytes.length).toBe(Buffer.byteLength(message.xml, 'utf8'));
		expect(Buffer.from(message.bytes, 'latin1').toString('utf8')).toBe(message.xml);
	});

	it('formats amounts with two decimals', () => {
		const amountOf = (amount: number) =>
			parse(buildPain001(debtor, { ...transfer, amount }, PAIN_001_001_09, now).xml)
				.CstmrCdtTrfInitn.GrpHdr.CtrlSum;

		expect(amountOf(0.01)).toBe('0.01');
		expect(amountOf(19.99)).toBe('19.99');
		expect(amountOf(1234567.89)).toBe('1234567.89');
		expect(amountOf(999999999.99)).toBe('999999999.99');
	});

	it('rejects invalid amounts', () => {
		const build = (amount: number) => () => buildPain001(debtor, { ...transfer, amount });

		expectValidationError(build(0), 'amount', /positive/);
		expectValidationError(build(-5), 'amount', /positive/);
		expectValidationError(build(Number.NaN), 'amount', /finite/);
		expectValidationError(build(Number.POSITIVE_INFINITY), 'amount', /finite/);
		expectValidationError(build(1.005), 'amount', /two decimal places/);
		expectValidationError(build(0.1 + 0.2), 'amount', /two decimal places/);
		expectValidationError(build(1000000000), 'amount', /must not exceed/);
		expectValidationError(build('12.50' as unknown as number), 'amount', /finite/);
	});

	it('rejects invalid IBANs and BICs', () => {
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, iban: 'DE02120300000000202052' }),
			'iban',
			/check digits/,
		);
		expectValidationError(
			() => buildPain001({ ...debtor, iban: 'DE00370400440532013000' }, transfer),
			'debtor iban',
			/check digits/,
		);
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, bic: 'NOBIC' }),
			'bic',
			/not a valid BIC/,
		);
	});

	it('rejects names and remittance information that are too long', () => {
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, name: 'M'.repeat(71) }),
			'name',
			/70 characters, it has 71/,
		);
		expect(() => buildPain001(debtor, { ...transfer, name: 'M'.repeat(70) })).not.toThrow();
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, purpose: 'P'.repeat(141) }),
			'purpose',
			/140 characters, it has 141/,
		);
		expectValidationError(
			() => buildPain001({ ...debtor, name: 'D'.repeat(71) }, transfer),
			'debtorName',
			/70 characters/,
		);
	});

	it('rejects characters outside the SEPA character set instead of transliterating them', () => {
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, name: 'José Müller' }),
			'name',
			/SEPA character set: "é"/,
		);
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, purpose: 'Mail an max@example.org' }),
			'purpose',
			/"@"/,
		);
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, purpose: '<b>' }),
			'purpose',
			/"<", ">"/,
		);
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, purpose: 'Zeile 1\nZeile 2' }),
			'purpose',
			/"\\n"/,
		);
	});

	it('rejects leading and trailing spaces instead of trimming them', () => {
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, name: ' Max Mustermann' }),
			'name',
			/start or end with a space/,
		);
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, purpose: 'Miete ' }),
			'purpose',
			/start or end with a space/,
		);
	});

	it('rejects missing names', () => {
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, name: '' }),
			'name',
			/must be provided/,
		);
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, name: '   ' }),
			'name',
			/must be provided/,
		);
		expectValidationError(
			() => buildPain001({ ...debtor, name: undefined as unknown as string }, transfer),
			'debtorName',
			/must be provided/,
		);
	});

	it('rejects invalid end-to-end IDs', () => {
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, endToEndId: 'E'.repeat(36) }),
			'endToEndId',
			/35 characters/,
		);
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, endToEndId: 'Bestellung-Ä1' }),
			'endToEndId',
			/"Ä"/,
		);
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, endToEndId: '/E2E' }),
			'endToEndId',
			/'\/'/,
		);
		expectValidationError(
			() => buildPain001(debtor, { ...transfer, endToEndId: 'E2E//1' }),
			'endToEndId',
			/'\/\/'/,
		);
	});

	it('accepts the German extension of the character set', () => {
		const message = buildPain001(
			debtor,
			{ ...transfer, name: 'Jürgen Größe & Söhne', purpose: 'Rabatt 5% *Aktion* $' },
			PAIN_001_001_09,
			now,
		);
		const tx = new XMLParser({ processEntities: true }).parse(message.xml).Document.CstmrCdtTrfInitn
			.PmtInf.CdtTrfTxInf;
		expect(tx.Cdtr.Nm).toBe('Jürgen Größe & Söhne');
		expect(tx.RmtInf.Ustrd).toBe('Rabatt 5% *Aktion* $');
	});

	it('rejects unsupported formats', () => {
		expectValidationError(
			() => buildPain001(debtor, transfer, 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.12'),
			'descriptor',
			/not supported/,
		);
	});
});
