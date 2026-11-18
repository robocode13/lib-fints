import { randomBytes } from 'node:crypto';

export const PAIN_001_001_09 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09';
export const PAIN_001_001_03 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';

/**
 * The pain.001 schemas this library writes, the preferred one first. The DK made
 * pain.001.001.09 the standard in November 2023; pain.001.001.03 is what banks that
 * have not moved yet still list.
 */
const SUPPORTED_FORMATS = [PAIN_001_001_09, PAIN_001_001_03];

/** The requested execution date that means "as soon as possible" (FinTS C.10.2.1) */
const EXECUTE_IMMEDIATELY = '1999-01-01';

/** The highest amount a SEPA credit transfer may carry (EPC rulebook) */
const MAX_AMOUNT = 999999999.99;

/**
 * The characters allowed in names and remittance information: the EPC basic Latin set
 * plus the German extension of DK Anlage 3 (umlauts, ß, &, *, $, %). Banks outside
 * Germany may accept fewer; a bank that does not accept one rejects the order.
 */
const TEXT_CHARACTERS = /[A-Za-z0-9/\-?:().,'+ ÄÖÜäöüß&*$%]/;

/** The characters allowed in references such as the end-to-end ID (EPC basic Latin set) */
const ID_CHARACTERS = /[A-Za-z0-9/\-?:().,'+ ]/;

/**
 * The IBAN lengths of the countries and territories of the SEPA scheme with an IBAN
 * country code of their own (SWIFT IBAN registry). An IBAN of a country not listed is
 * checked by its check digits only.
 */
const IBAN_LENGTHS: Record<string, number> = {
	AD: 24,
	AL: 28,
	AT: 20,
	BE: 16,
	BG: 22,
	CH: 21,
	CY: 28,
	CZ: 24,
	DE: 22,
	DK: 18,
	EE: 20,
	ES: 24,
	FI: 18,
	FR: 27,
	GB: 22,
	GI: 23,
	GR: 27,
	HR: 21,
	HU: 28,
	IE: 22,
	IS: 26,
	IT: 27,
	LI: 21,
	LT: 20,
	LU: 20,
	LV: 21,
	MC: 27,
	MD: 24,
	ME: 22,
	MK: 19,
	MT: 31,
	NL: 18,
	NO: 15,
	PL: 28,
	PT: 25,
	RO: 24,
	RS: 22,
	SE: 24,
	SI: 19,
	SK: 24,
	SM: 27,
	VA: 22,
};

/**
 * A SEPA credit transfer to one payee
 */
export type CreditTransfer = {
	/**
	 * The payee's name as the payee's bank holds it, at most 70 characters. This is the
	 * name Verification of Payee checks against the IBAN.
	 */
	name: string;
	/** The payee's IBAN; spaces are removed and letters upper-cased */
	iban: string;
	/** The payee's BIC, may be omitted for payees within the EEA */
	bic?: string;
	/** The amount in euros, positive, at most two decimal places */
	amount: number;
	/** Unstructured remittance information (Verwendungszweck), at most 140 characters */
	purpose?: string;
	/** The end-to-end reference, at most 35 characters; NOTPROVIDED when omitted */
	endToEndId?: string;
	/**
	 * The debtor's name, at most 70 characters. When omitted, the account holder from
	 * the UPD is used.
	 */
	debtorName?: string;
};

/**
 * The account the money comes from
 */
export type Pain001Debtor = {
	name: string;
	iban: string;
	bic?: string;
};

/**
 * A pain.001 document ready for HKCCS
 */
export type Pain001Message = {
	/** The schema URN, HKCCS's SEPA descriptor */
	descriptor: string;
	/** The document as text */
	xml: string;
	/** The document's UTF-8 bytes, one character per byte, as HKCCS carries it */
	bytes: string;
	messageId: string;
	endToEndId: string;
	/** The payee IBAN as the document carries it, without spaces and in capitals */
	creditorIban: string;
	/** The payee name as the document carries it */
	creditorName: string;
};

/**
 * Thrown before anything is sent when a transfer's data cannot go into a pain.001 as given.
 * The message names the field, never the value.
 */
export class SepaValidationError extends Error {
	constructor(
		public field: string,
		message: string,
	) {
		super(message);
		this.name = 'SepaValidationError';
	}
}

/**
 * Picks the pain.001 schema to write from the formats the bank lists in HISPAS.
 * @param supportedSepaFormats the SEPA formats from the HISPAS parameters
 * @returns the schema URN, or undefined when the bank lists formats but none this library writes
 */
export function selectPain001Format(supportedSepaFormats?: string[]): string | undefined {
	const formats = supportedSepaFormats?.filter((format) => !!format) ?? [];

	// A bank that lists no format at all says nothing about pain.001; the current DK
	// standard is the best guess, and a bank that does not accept it rejects the order.
	if (formats.length === 0) {
		return PAIN_001_001_09;
	}

	return SUPPORTED_FORMATS.find((format) => formats.includes(format));
}

/**
 * Normalises and checks an IBAN: only ASCII letters, digits and spaces are allowed;
 * spaces are removed, letters upper-cased, then the structure, the length for the
 * country and the ISO 13616 check digits are verified.
 * @throws SepaValidationError when the IBAN is not valid
 */
export function normalizeIban(iban: string, field = 'iban'): string {
	if (typeof iban !== 'string') {
		throw new SepaValidationError(field, `${field} must be a string`);
	}

	// Checked before upper-casing, which turns some other letters into ASCII ones (ſ into S)
	const normalized = /^[A-Za-z0-9 ]*$/.test(iban) ? iban.replace(/ /g, '').toUpperCase() : '';

	if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(normalized)) {
		throw new SepaValidationError(field, `${field} is not a well-formed IBAN`);
	}

	const length = IBAN_LENGTHS[normalized.slice(0, 2)];

	if (length !== undefined && normalized.length !== length) {
		throw new SepaValidationError(
			field,
			`${field} must have ${length} characters for its country, it has ${normalized.length}`,
		);
	}

	if (ibanChecksum(normalized) !== 1) {
		throw new SepaValidationError(field, `${field} has invalid check digits`);
	}

	return normalized;
}

/**
 * The BIC patterns of the schemas: BICIdentifier in pain.001.001.03, BICFIDec2014Identifier
 * (BICFI) in pain.001.001.09, which allows digits in the first four characters
 */
const BIC_PATTERNS: Record<string, RegExp> = {
	[PAIN_001_001_03]: /^[A-Z]{6}[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?$/,
	[PAIN_001_001_09]: /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
};

/**
 * Normalises and checks a BIC (8 or 11 ASCII letters and digits, letters upper-cased)
 * against the pattern of the schema it goes into
 * @param descriptor the pain.001 schema the BIC is written in
 * @throws SepaValidationError when the BIC is not valid
 */
export function normalizeBic(
	bic: string,
	field = 'bic',
	descriptor: string = PAIN_001_001_09,
): string {
	if (typeof bic !== 'string') {
		throw new SepaValidationError(field, `${field} must be a string`);
	}

	// Checked before upper-casing, which turns some other letters into ASCII ones (ſ into S)
	const normalized = /^[A-Za-z0-9]*$/.test(bic) ? bic.toUpperCase() : '';

	if (!(BIC_PATTERNS[descriptor] ?? BIC_PATTERNS[PAIN_001_001_09]).test(normalized)) {
		throw new SepaValidationError(field, `${field} is not a valid BIC`);
	}

	return normalized;
}

/**
 * Builds a pain.001 document for a single SEPA credit transfer, executed as soon as
 * possible. Every value is checked first; nothing is shortened, transliterated or
 * dropped to make it fit.
 * @param debtor the account the money comes from
 * @param transfer the payee, amount and references
 * @param descriptor the schema to write, see selectPain001Format
 * @param now the creation time written into the group header
 * @throws SepaValidationError when a value cannot go into the document as given
 */
export function buildPain001(
	debtor: Pain001Debtor,
	transfer: CreditTransfer,
	descriptor: string = PAIN_001_001_09,
	now: Date = new Date(),
): Pain001Message {
	if (!SUPPORTED_FORMATS.includes(descriptor)) {
		throw new SepaValidationError('descriptor', 'the pain.001 format is not supported');
	}

	if (!transfer || typeof transfer !== 'object') {
		throw new SepaValidationError('transfer', 'transfer must be provided');
	}

	const debtorName = checkText(debtor.name, 'debtorName', 70);
	const debtorIban = normalizeIban(debtor.iban, 'debtor iban');
	const debtorBic = debtor.bic ? normalizeBic(debtor.bic, 'debtor bic', descriptor) : undefined;
	const name = checkText(transfer.name, 'name', 70);
	const iban = normalizeIban(transfer.iban);
	const bic = transfer.bic ? normalizeBic(transfer.bic, 'bic', descriptor) : undefined;
	const amount = formatAmount(transfer.amount);
	const purpose =
		transfer.purpose === undefined || transfer.purpose === ''
			? undefined
			: checkText(transfer.purpose, 'purpose', 140);
	const endToEndId =
		transfer.endToEndId === undefined || transfer.endToEndId === ''
			? 'NOTPROVIDED'
			: checkReference(transfer.endToEndId, 'endToEndId');

	const messageId = randomBytes(16).toString('hex');
	const paymentInfoId = randomBytes(16).toString('hex');
	const isV09 = descriptor === PAIN_001_001_09;
	const bicTag = isV09 ? 'BICFI' : 'BIC';
	const agent = (agentBic: string | undefined) =>
		agentBic
			? `<FinInstnId><${bicTag}>${agentBic}</${bicTag}></FinInstnId>`
			: '<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>';

	const xml =
		'<?xml version="1.0" encoding="UTF-8"?>' +
		`<Document xmlns="${descriptor}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
		'<CstmrCdtTrfInitn>' +
		'<GrpHdr>' +
		`<MsgId>${messageId}</MsgId>` +
		`<CreDtTm>${formatDateTime(now)}</CreDtTm>` +
		'<NbOfTxs>1</NbOfTxs>' +
		`<CtrlSum>${amount}</CtrlSum>` +
		`<InitgPty><Nm>${escapeXml(debtorName)}</Nm></InitgPty>` +
		'</GrpHdr>' +
		'<PmtInf>' +
		`<PmtInfId>${paymentInfoId}</PmtInfId>` +
		'<PmtMtd>TRF</PmtMtd>' +
		'<NbOfTxs>1</NbOfTxs>' +
		`<CtrlSum>${amount}</CtrlSum>` +
		'<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>' +
		(isV09
			? `<ReqdExctnDt><Dt>${EXECUTE_IMMEDIATELY}</Dt></ReqdExctnDt>`
			: `<ReqdExctnDt>${EXECUTE_IMMEDIATELY}</ReqdExctnDt>`) +
		`<Dbtr><Nm>${escapeXml(debtorName)}</Nm></Dbtr>` +
		`<DbtrAcct><Id><IBAN>${debtorIban}</IBAN></Id></DbtrAcct>` +
		`<DbtrAgt>${agent(debtorBic)}</DbtrAgt>` +
		'<ChrgBr>SLEV</ChrgBr>' +
		'<CdtTrfTxInf>' +
		`<PmtId><EndToEndId>${escapeXml(endToEndId)}</EndToEndId></PmtId>` +
		`<Amt><InstdAmt Ccy="EUR">${amount}</InstdAmt></Amt>` +
		// The creditor agent only when a BIC is given: within the EEA the IBAN is enough,
		// and an empty or NOTPROVIDED agent is not allowed in this position.
		(bic ? `<CdtrAgt>${agent(bic)}</CdtrAgt>` : '') +
		`<Cdtr><Nm>${escapeXml(name)}</Nm></Cdtr>` +
		`<CdtrAcct><Id><IBAN>${iban}</IBAN></Id></CdtrAcct>` +
		(purpose ? `<RmtInf><Ustrd>${escapeXml(purpose)}</Ustrd></RmtInf>` : '') +
		'</CdtTrfTxInf>' +
		'</PmtInf>' +
		'</CstmrCdtTrfInitn>' +
		'</Document>';

	return {
		descriptor,
		xml,
		bytes: Buffer.from(xml, 'utf8').toString('latin1'),
		messageId,
		endToEndId,
		creditorIban: iban,
		creditorName: name,
	};
}

function ibanChecksum(iban: string): number {
	const rearranged = iban.slice(4) + iban.slice(0, 4);
	let remainder = 0;

	for (const char of rearranged) {
		const value = char >= 'A' && char <= 'Z' ? char.charCodeAt(0) - 55 : Number(char);
		remainder = (remainder * (value >= 10 ? 100 : 10) + value) % 97;
	}

	return remainder;
}

function checkText(value: string, field: string, maxLength: number): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new SepaValidationError(field, `${field} must be provided`);
	}

	checkCharacters(value, field, TEXT_CHARACTERS);
	checkWhitespace(value, field);

	if (value.length > maxLength) {
		throw new SepaValidationError(
			field,
			`${field} must not exceed ${maxLength} characters, it has ${value.length}`,
		);
	}

	return value;
}

function checkReference(value: string, field: string): string {
	if (typeof value !== 'string') {
		throw new SepaValidationError(field, `${field} must be a string`);
	}

	checkCharacters(value, field, ID_CHARACTERS);
	checkWhitespace(value, field);

	if (value.length > 35) {
		throw new SepaValidationError(
			field,
			`${field} must not exceed 35 characters, it has ${value.length}`,
		);
	}

	if (value.startsWith('/') || value.endsWith('/') || value.includes('//')) {
		throw new SepaValidationError(field, `${field} must not start or end with '/' or contain '//'`);
	}

	return value;
}

/**
 * Names the positions of the characters not allowed, not the characters: the error
 * message must not repeat the value (it may end up in logs)
 */
function checkCharacters(value: string, field: string, allowed: RegExp) {
	const positions = [...value].flatMap((char, index) => (allowed.test(char) ? [] : [index + 1]));

	if (positions.length > 0) {
		throw new SepaValidationError(
			field,
			`${field} contains characters outside the SEPA character set at position${
				positions.length > 1 ? 's' : ''
			} ${positions.join(', ')}`,
		);
	}
}

function checkWhitespace(value: string, field: string) {
	if (value !== value.trim()) {
		throw new SepaValidationError(field, `${field} must not start or end with a space`);
	}
}

function formatAmount(amount: number): string {
	if (typeof amount !== 'number' || !Number.isFinite(amount)) {
		throw new SepaValidationError('amount', 'amount must be a finite number');
	}

	if (amount <= 0) {
		throw new SepaValidationError('amount', 'amount must be positive');
	}

	if (amount > MAX_AMOUNT) {
		throw new SepaValidationError('amount', `amount must not exceed ${MAX_AMOUNT} EUR`);
	}

	if (Math.round(amount * 100) / 100 !== amount) {
		throw new SepaValidationError('amount', 'amount must not have more than two decimal places');
	}

	return amount.toFixed(2);
}

function formatDateTime(date: Date): string {
	const pad = (value: number) => value.toString().padStart(2, '0');
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
	);
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
