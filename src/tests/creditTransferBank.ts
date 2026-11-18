import { AccountType } from '../bankAccount.js';
import type { BankingInformation } from '../bankingInformation.js';
import type { BankTransaction } from '../bankTransaction.js';
import { Language, TanMediaRequirement } from '../codes.js';
import { type CustomerMessage, Message } from '../message.js';
import { PAIN_001_001_09 } from '../pain001Builder.js';
import type { HIVPPSegment } from '../segments/HIVPP.js';
import type { HIVPPSParameter } from '../segments/HIVPPS.js';
import type { HKCCSSegment } from '../segments/HKCCS.js';
import { registerSegments } from '../segments/registry.js';

// The bank, its parameters and its answers for the credit transfer tests

/**
 * The bank: every message sent is numbered as the real HttpClient does (encode), kept, and
 * answered with the next response in the queue. Nothing leaves the process. A pain.002 in
 * the answer names the order the bank last received: the placeholder ORDER_MESSAGE_ID
 * gives way to the message reference of the latest pain.001 sent.
 */
export const bank = {
	responses: [] as unknown[],
	sent: [] as CustomerMessage[],
	orderMessageId: '',
	paymentInfoId: '',
};
export const ORDER_MESSAGE_ID = 'ORDER-MESSAGE-ID-OF-THE-TRANSFER';
/** The payment information ID in a pain.002 of the tests, for that of the latest pain.001 */
export const PAYMENT_INFO_ID = 'PMT-1';

/** Stands in for HttpClient: `vi.mock('../httpClient.js', ...)` with `HttpClient: MockHttpClient` */
export class MockHttpClient {
	constructor(
		public url: string,
		public debug = false,
		public debugRaw = false,
	) {}

	async sendMessage(message: CustomerMessage) {
		message.encode();
		bank.sent.push(message);
		const order = message.segments.find((segment) => segment.header.segId === 'HKCCS') as
			| HKCCSSegment
			| undefined;
		bank.orderMessageId =
			/<MsgId>([^<]*)<\/MsgId>/.exec(order?.sepaPainMessage ?? '')?.[1] ?? bank.orderMessageId;

		const response = bank.responses.shift();

		if (!response) {
			throw new Error(`unexpected message: ${orderSegments(message).join(', ')}`);
		}

		if (response instanceof Error) {
			throw response;
		}

		if (response instanceof Promise) {
			return response;
		}

		for (const hivpp of (response as Message).findAllSegments<HIVPPSegment>('HIVPP')) {
			hivpp.paymentStatusReport = hivpp.paymentStatusReport
				?.replace(ORDER_MESSAGE_ID, bank.orderMessageId)
				.replace(PAYMENT_INFO_ID, bank.paymentInfoId);
		}

		return response;
	}
}

registerSegments();

export const DIALOG_ID = 'DIALOG-0001';
export const ACCOUNT = '1234567890';
export const PAYEE_IBAN = 'DE02120300000000202051';
export const REPORT_FORMAT = 'urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.002.001.10';

export const TRANSFER = {
	name: 'Max Mustermann',
	iban: PAYEE_IBAN,
	amount: 42.5,
	purpose: 'Rechnung 2026-001',
	endToEndId: 'E2E-0001',
};

export const VOP_PARAMS: HIVPPSParameter = {
	maxOptInTransactions: 1,
	noticeStructured: false,
	reportDelivery: 'V',
	batchWithSingleOrderAllowed: false,
	entryCountAllowed: false,
	supportedReportFormats: 'urn:iso:std:iso:20022:tech:xsd:pain.002.001.10',
	vopRequiredTransactions: ['HKCCS'],
};

export function createBankingInformation(): BankingInformation {
	return {
		systemId: 'SYSTEM01',
		bankMessages: [],
		bpd: {
			version: 1,
			url: 'https://bank.example.com/fints',
			countryCode: 280,
			bankId: '12030000',
			bankName: 'Example Bank',
			allowedTransactions: [
				{ transId: 'HKCCS', versions: [1], tanRequired: true },
				{ transId: 'HKVPP', versions: [1], tanRequired: false, params: { ...VOP_PARAMS } },
				{ transId: 'HKVPA', versions: [1], tanRequired: false },
				{
					transId: 'HKSPA',
					versions: [3],
					tanRequired: false,
					params: {
						individualAccountRetrievalAllowed: true,
						nationalAccountAllowed: false,
						structuredPurposeAllowed: false,
						supportedSepaFormats: [PAIN_001_001_09],
					},
				},
				{ transId: 'HKSAL', versions: [7], tanRequired: false },
			] as BankTransaction[],
			maxTransactionsPerMessage: 1,
			supportedLanguages: [Language.German],
			supportedHbciVersions: [300],
			supportedTanMethods: [
				{
					id: 912,
					name: 'chipTAN',
					version: 7,
					isDecoupled: false,
					activeTanMediaCount: 0,
					activeTanMedia: [],
					tanMediaRequirement: TanMediaRequirement.NotAllowed,
				},
				{
					id: 946,
					name: 'pushTAN',
					version: 7,
					isDecoupled: true,
					activeTanMediaCount: 0,
					activeTanMedia: [],
					tanMediaRequirement: TanMediaRequirement.NotAllowed,
				},
			],
			availableTanMethodIds: [912, 946],
		},
		upd: {
			version: 1,
			usage: 0,
			bankAccounts: [
				{
					accountNumber: ACCOUNT,
					bank: { bankId: '12030000', country: 280 },
					isSepaAccount: true,
					iban: 'DE89370400440532013000',
					customerId: 'customer1',
					accountType: AccountType.CheckingAccount,
					currency: 'EUR',
					holder1: 'Erika Mustermann',
					allowedTransactions: [
						{ transId: 'HKCCS', numSignatures: 1 },
						{ transId: 'HKSAL', numSignatures: 1 },
					],
				},
				{
					accountNumber: '9876543210',
					bank: { bankId: '12030000', country: 280 },
					isSepaAccount: true,
					iban: 'DE89370400440532013001',
					customerId: 'customer1',
					accountType: AccountType.CheckingAccount,
					currency: 'EUR',
					holder1: 'Erika Mustermann',
					allowedTransactions: [{ transId: 'HKSAL', numSignatures: 1 }],
				},
			],
		},
	} as unknown as BankingInformation;
}

// --- bank answers -------------------------------------------------------------

export function answer(...segments: string[]): Message {
	return Message.decode(`HNHBK:1:3+000000000000+300+${DIALOG_ID}+1'${segments.join('')}`);
}

export const OK = "HIRMG:2:2+0010::Nachricht entgegengenommen.'";
export const WARNINGS = "HIRMG:2:2+3060::Bitte beachten Sie die enthaltenen Warnungen.'";

export const initOk = () => answer(OK, "HIRMS:3:2:3+0020::Auftrag ausgefuehrt.'");
export const endOk = () => answer("HIRMG:2:2+0100::Dialog beendet.'");
export const tanAccepted = () => answer(OK, "HIRMS:3:2:3+0020::Auftrag ausgefuehrt.'");

/** HKVPP is segment 3, HKCCS 4 and HKTAN 5 in the first transfer message */
export const hirms = (refSegNr: number, ...answers: string[]) =>
	`HIRMS:3:2:${refSegNr}+${answers.join('+')}'`;
export const TAN_REQUIRED = '0030::Auftrag empfangen - Sicherheitsfreigabe erforderlich.';
export const NO_HKVPA_NEEDED =
	'3091::Namensabgleich ohne Abweichung, keine Bestaetigung erforderlich.';
export const CHECK_RESULT = '3090::Bitte pruefen Sie das Ergebnis des Namensabgleichs.';
export const APPROVAL_VOIDED = '3945::Freigabe kann nicht erteilt werden.';

export const hitan = (reference = 'TAN-REF-1', process = '4') =>
	`HITAN:6:7:5+${process}++${reference}+Bitte geben Sie die TAN ein.'`;

export function hivppSingle(
	result: string,
	options: { closeMatchName?: string; reason?: string } = {},
) {
	return `HIVPP:5:1:3+@6@VOP-01+++++${PAYEE_IBAN}::${options.closeMatchName ?? ''}::${result}${options.reason ? `:${options.reason}` : ''}+Bei Abweichungen haftet die Bank nicht.'`;
}

/** A pain.002 as one character per UTF-8 byte, the way it arrives in a FinTS message */
export function pain002(status: string, reason?: string, creditorName = 'Max Mustermann'): string {
	const xml =
		'<?xml version="1.0" encoding="UTF-8"?>' +
		'<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.10"><CstmrPmtStsRpt>' +
		'<GrpHdr><MsgId>REPORT-1</MsgId><CreDtTm>2026-11-18T12:00:00</CreDtTm></GrpHdr>' +
		`<OrgnlGrpInfAndSts><OrgnlMsgId>${ORDER_MESSAGE_ID}</OrgnlMsgId><OrgnlMsgNmId>pain.001.001.09</OrgnlMsgNmId></OrgnlGrpInfAndSts>` +
		`<OrgnlPmtInfAndSts><OrgnlPmtInfId>${PAYMENT_INFO_ID}</OrgnlPmtInfId><TxInfAndSts>` +
		`<OrgnlEndToEndId>E2E-0001</OrgnlEndToEndId><TxSts>${status}</TxSts>` +
		(reason ? `<StsRsnInf><AddtlInf>${reason}</AddtlInf></StsRsnInf>` : '') +
		`<OrgnlTxRef><Cdtr><Pty><Nm>${creditorName}</Nm></Pty></Cdtr><CdtrAcct><Id><IBAN>${PAYEE_IBAN}</IBAN></Id></CdtrAcct></OrgnlTxRef>` +
		'</TxInfAndSts></OrgnlPmtInfAndSts></CstmrPmtStsRpt></Document>';
	return Buffer.from(xml, 'utf8').toString('latin1');
}

export function hivppReport(report: string, vopId = 'VOP-01') {
	return `HIVPP:5:1:3+@${vopId.length}@${vopId}+++${REPORT_FORMAT}+@${report.length}@${report}'`;
}

export const hivppPending = (pollingId = 'POLL-0001', wait = 2) =>
	`HIVPP:5:1:3+++@${pollingId.length}@${pollingId}+++++${wait}'`;

// --- sent messages -------------------------------------------------------------

export function orderSegments(message: CustomerMessage): string[] {
	return message.segments
		.map((segment) => segment.header.segId)
		.filter((segId) => !['HNHBK', 'HNSHK', 'HNSHA', 'HNHBS'].includes(segId));
}

export const sentOrders = () => bank.sent.map(orderSegments);
