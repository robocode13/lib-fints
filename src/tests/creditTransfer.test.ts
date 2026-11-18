import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { AccountType } from '../bankAccount.js';
import type { BankingInformation } from '../bankingInformation.js';
import type { BankTransaction } from '../bankTransaction.js';
import { FinTSClient } from '../client.js';
import { Language, TanMediaRequirement } from '../codes.js';
import { FinTSConfig } from '../config.js';
import { extractVopResult } from '../interactions/creditTransferInteraction.js';
import { InitDialogInteraction } from '../interactions/initDialogInteraction.js';
import { type CustomerMessage, Message } from '../message.js';
import { PAIN_001_001_03, PAIN_001_001_09, SepaValidationError } from '../pain001Builder.js';
import type { HIVPPSParameter } from '../segments/HIVPPS.js';
import type { HKCCSSegment } from '../segments/HKCCS.js';
import type { HKTANSegment } from '../segments/HKTAN.js';
import type { HKVPASegment } from '../segments/HKVPA.js';
import type { HKVPPSegment } from '../segments/HKVPP.js';
import type { HNHBKSegment } from '../segments/HNHBK.js';
import { registerSegments } from '../segments/registry.js';

/**
 * The bank: every message sent is numbered as the real HttpClient does (encode), kept, and
 * answered with the next response in the queue. Nothing leaves the process.
 */
const bank = vi.hoisted(() => ({
	responses: [] as unknown[],
	sent: [] as CustomerMessage[],
}));

vi.mock('../httpClient.js', () => ({
	HttpClient: class MockHttpClient {
		constructor(
			public url: string,
			public debug = false,
			public debugRaw = false,
		) {}

		async sendMessage(message: CustomerMessage) {
			message.encode();
			bank.sent.push(message);

			const response = bank.responses.shift();

			if (!response) {
				throw new Error(`unexpected message: ${orderSegments(message).join(', ')}`);
			}

			if (response instanceof Error) {
				throw response;
			}

			return response;
		}
	},
}));

registerSegments();

const DIALOG_ID = 'DIALOG-0001';
const ACCOUNT = '1234567890';
const PAYEE_IBAN = 'DE02120300000000202051';
const REPORT_FORMAT = 'urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.002.001.10';

const TRANSFER = {
	name: 'Max Mustermann',
	iban: PAYEE_IBAN,
	amount: 42.5,
	purpose: 'Rechnung 2026-001',
	endToEndId: 'E2E-0001',
};

const VOP_PARAMS: HIVPPSParameter = {
	maxOptInTransactions: 1,
	noticeStructured: false,
	reportDelivery: 'V',
	batchWithSingleOrderAllowed: false,
	entryCountAllowed: false,
	supportedReportFormats: 'urn:iso:std:iso:20022:tech:xsd:pain.002.001.10',
	vopRequiredTransactions: ['HKCCS'],
};

function createBankingInformation(): BankingInformation {
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

function answer(...segments: string[]): Message {
	return Message.decode(`HNHBK:1:3+000000000000+300+${DIALOG_ID}+1'${segments.join('')}`);
}

const OK = "HIRMG:2:2+0010::Nachricht entgegengenommen.'";
const WARNINGS = "HIRMG:2:2+3060::Bitte beachten Sie die enthaltenen Warnungen.'";

const initOk = () => answer(OK, "HIRMS:3:2:3+0020::Auftrag ausgefuehrt.'");
const endOk = () => answer("HIRMG:2:2+0100::Dialog beendet.'");
const tanAccepted = () => answer(OK, "HIRMS:3:2:3+0010::Auftrag entgegengenommen.'");

/** HKVPP is segment 3, HKCCS 4 and HKTAN 5 in the first transfer message */
const hirms = (refSegNr: number, ...answers: string[]) =>
	`HIRMS:3:2:${refSegNr}+${answers.join('+')}'`;
const TAN_REQUIRED = '0030::Auftrag empfangen - Sicherheitsfreigabe erforderlich.';
const NO_HKVPA_NEEDED = '3091::Namensabgleich ohne Abweichung, keine Bestaetigung erforderlich.';
const CHECK_RESULT = '3090::Bitte pruefen Sie das Ergebnis des Namensabgleichs.';
const APPROVAL_VOIDED = '3945::Freigabe kann nicht erteilt werden.';

const hitan = (reference = 'TAN-REF-1', process = '4') =>
	`HITAN:6:7:5+${process}++${reference}+Bitte geben Sie die TAN ein.'`;

function hivppSingle(result: string, options: { closeMatchName?: string; reason?: string } = {}) {
	return `HIVPP:5:1:3+@6@VOP-01+++++${PAYEE_IBAN}::${options.closeMatchName ?? ''}::${result}${options.reason ? `:${options.reason}` : ''}+Bei Abweichungen haftet die Bank nicht.'`;
}

/** A pain.002 as one character per UTF-8 byte, the way it arrives in a FinTS message */
function pain002(status: string, reason?: string): string {
	const xml =
		'<?xml version="1.0" encoding="UTF-8"?>' +
		'<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.10"><CstmrPmtStsRpt>' +
		'<GrpHdr><MsgId>REPORT-1</MsgId><CreDtTm>2026-11-18T12:00:00</CreDtTm></GrpHdr>' +
		'<OrgnlGrpInfAndSts><OrgnlMsgId>MSG-1</OrgnlMsgId><OrgnlMsgNmId>pain.001.001.09</OrgnlMsgNmId></OrgnlGrpInfAndSts>' +
		'<OrgnlPmtInfAndSts><OrgnlPmtInfId>PMT-1</OrgnlPmtInfId><TxInfAndSts>' +
		`<OrgnlEndToEndId>E2E-0001</OrgnlEndToEndId><TxSts>${status}</TxSts>` +
		(reason ? `<StsRsnInf><AddtlInf>${reason}</AddtlInf></StsRsnInf>` : '') +
		`<OrgnlTxRef><Cdtr><Pty><Nm>Max Musterman</Nm></Pty></Cdtr><CdtrAcct><Id><IBAN>${PAYEE_IBAN}</IBAN></Id></CdtrAcct></OrgnlTxRef>` +
		'</TxInfAndSts></OrgnlPmtInfAndSts></CstmrPmtStsRpt></Document>';
	return Buffer.from(xml, 'utf8').toString('latin1');
}

function hivppReport(report: string, vopId = 'VOP-01') {
	return `HIVPP:5:1:3+@${vopId.length}@${vopId}+++${REPORT_FORMAT}+@${report.length}@${report}'`;
}

const hivppPending = (pollingId = 'POLL-0001', wait = 2) =>
	`HIVPP:5:1:3+++@${pollingId.length}@${pollingId}+++++${wait}'`;

// --- sent messages -------------------------------------------------------------

function orderSegments(message: CustomerMessage): string[] {
	return message.segments
		.map((segment) => segment.header.segId)
		.filter((segId) => !['HNHBK', 'HNSHK', 'HNSHA', 'HNHBS'].includes(segId));
}

const sentOrders = () => bank.sent.map(orderSegments);

describe('FinTSClient SEPA credit transfer', () => {
	let config: FinTSConfig;
	let client: FinTSClient;
	let sleep: MockInstance<(milliseconds: number) => Promise<void>>;

	beforeEach(() => {
		bank.responses = [];
		bank.sent = [];
		config = FinTSConfig.fromBankingInformation(
			'product',
			'1.0',
			createBankingInformation(),
			'user',
			'pin',
			912,
		);
		client = new FinTSClient(config);
		sleep = vi
			.spyOn(
				FinTSClient.prototype as unknown as { sleep: (milliseconds: number) => Promise<void> },
				'sleep',
			)
			.mockResolvedValue();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const vopParams = () =>
		config.bankingInformation.bpd?.allowedTransactions.find((t) => t.transId === 'HKVPP')
			?.params as HIVPPSParameter;

	const removeTransaction = (transId: string) => {
		const bpd = config.bankingInformation.bpd;
		if (bpd) {
			bpd.allowedTransactions = bpd.allowedTransactions.filter((t) => t.transId !== transId);
		}
	};

	describe('canTransfer', () => {
		it('is true for a bank and an account that support HKCCS', () => {
			expect(client.canTransfer()).toBe(true);
			expect(client.canTransfer(ACCOUNT)).toBe(true);
		});

		it('is false for an account the UPD does not allow transfers from', () => {
			expect(client.canTransfer('9876543210')).toBe(false);
		});

		it('is false for an account without IBAN', () => {
			const account = config.bankingInformation.upd?.bankAccounts[0];
			if (account) account.iban = undefined;
			expect(client.canTransfer(ACCOUNT)).toBe(false);
		});

		it('is false without HKCCS in the BPD', () => {
			removeTransaction('HKCCS');
			expect(client.canTransfer()).toBe(false);
		});

		it('is false when the bank lists only pain.001 formats this library does not write', () => {
			const hkspa = config.bankingInformation.bpd?.allowedTransactions.find(
				(t) => t.transId === 'HKSPA',
			);
			(hkspa?.params as { supportedSepaFormats: string[] }).supportedSepaFormats = [
				'urn:iso:std:iso:20022:tech:xsd:pain.001.002.03',
			];
			expect(client.canTransfer()).toBe(false);
		});

		it('is false when the bank announces HKVPP but its parameters could not be read', () => {
			const hkvpp = config.bankingInformation.bpd?.allowedTransactions.find(
				(t) => t.transId === 'HKVPP',
			);
			if (hkvpp) hkvpp.params = undefined;
			expect(client.canTransfer()).toBe(false);
		});

		it('is false when the bank requires VoP but announces no HKVPA', () => {
			removeTransaction('HKVPA');
			expect(client.canTransfer()).toBe(false);
		});

		it('is true when the bank does not require VoP for HKCCS, or has no HKVPP at all', () => {
			vopParams().vopRequiredTransactions = ['HKCSE'];
			removeTransaction('HKVPA');
			expect(client.canTransfer()).toBe(true);

			removeTransaction('HKVPP');
			expect(client.canTransfer()).toBe(true);
		});
	});

	describe('input validation', () => {
		it('rejects an invalid payee IBAN before anything is sent', async () => {
			await expect(
				client.transfer(ACCOUNT, { ...TRANSFER, iban: 'DE02120300000000202052' }),
			).rejects.toBeInstanceOf(SepaValidationError);
			expect(bank.sent).toHaveLength(0);
		});

		it('rejects a zero amount, more than two decimals and characters outside the SEPA set', async () => {
			for (const transfer of [
				{ ...TRANSFER, amount: 0 },
				{ ...TRANSFER, amount: 1.234 },
				{ ...TRANSFER, name: 'Max Mustermann 😀' },
			]) {
				await expect(client.transfer(ACCOUNT, transfer)).rejects.toBeInstanceOf(
					SepaValidationError,
				);
			}
			expect(bank.sent).toHaveLength(0);
		});

		it('rejects an account holder name the pain.001 cannot carry, naming debtorName', async () => {
			const account = config.bankingInformation.upd?.bankAccounts[0];
			if (account) account.holder1 = 'Erika Mustermann ★';

			await expect(client.transfer(ACCOUNT, TRANSFER)).rejects.toMatchObject({
				field: 'debtorName',
			});
			expect(bank.sent).toHaveLength(0);

			bank.responses.push(initOk(), answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')));
			const response = await client.transfer(ACCOUNT, {
				...TRANSFER,
				debtorName: 'Erika Mustermann',
			});
			expect(response.requiresVopConfirmation).toBe(true);
		});

		it('rejects an account without IBAN', async () => {
			const account = config.bankingInformation.upd?.bankAccounts[0];
			if (account) account.iban = undefined;
			await expect(client.transfer(ACCOUNT, TRANSFER)).rejects.toThrow(/has no IBAN/);
			expect(bank.sent).toHaveLength(0);
		});
	});

	describe('payee matches', () => {
		it('goes to the TAN without HKVPA when the bank answers 3091', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, NO_HKVPA_NEEDED),
					hirms(5, TAN_REQUIRED),
					hivppSingle('RCVC'),
					hitan(),
				),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({
				success: true,
				requiresTan: true,
				requiresVopConfirmation: false,
				tanReference: 'TAN-REF-1',
				endToEndId: 'E2E-0001',
				vop: { result: 'match', code: 'RCVC', iban: PAYEE_IBAN },
			});
			expect(response.vop?.notice).toBe('Bei Abweichungen haftet die Bank nicht.');
			expect(sentOrders()).toEqual([
				['HKIDN', 'HKVVB', 'HKTAN'],
				['HKVPP', 'HKCCS', 'HKTAN'],
			]);

			const hkvpp = bank.sent[1].findSegment<HKVPPSegment>('HKVPP');
			expect(hkvpp?.supportedReports).toEqual(['urn:iso:std:iso:20022:tech:xsd:pain.002.001.10']);
			expect(hkvpp?.pollingId).toBeUndefined();
			const hkccs = bank.sent[1].findSegment<HKCCSSegment>('HKCCS');
			expect(hkccs?.sepaDescriptor).toBe(PAIN_001_001_09);
			expect(hkccs?.account).toEqual({ iban: 'DE89370400440532013000', bic: undefined });
			expect(bank.sent[1].findSegment<HKTANSegment>('HKTAN')).toMatchObject({
				tanProcess: '4',
				segId: 'HKCCS',
			});

			bank.responses.push(tanAccepted(), endOk());
			const done = await client.transferWithTan('TAN-REF-1', '123456');

			expect(done).toMatchObject({
				success: true,
				requiresTan: false,
				requiresVopConfirmation: false,
				vop: { result: 'match' },
			});
			expect(sentOrders().slice(2)).toEqual([['HKTAN'], ['HKEND']]);
			expect(bank.sent[2].findSegment<HKTANSegment>('HKTAN')).toMatchObject({
				tanProcess: '2',
				segId: 'HKCCS',
				orderRef: 'TAN-REF-1',
			});
			expect(bank.responses).toHaveLength(0);
		});

		it('sends HKVPA with the TAN when the bank does not answer 3091', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);
			expect(response).toMatchObject({ requiresTan: true, requiresVopConfirmation: false });

			bank.responses.push(tanAccepted(), endOk());
			const done = await client.transferWithTan('TAN-REF-1', '123456');

			expect(done).toMatchObject({ success: true, requiresTan: false });
			expect(sentOrders()[2]).toEqual(['HKVPA', 'HKTAN']);
			expect(bank.sent[2].findSegment<HKVPASegment>('HKVPA')?.vopId).toBe('VOP-01');
		});

		it('sends HKVPA only with the first status request of a decoupled TAN method', async () => {
			client.selectTanMethod(946);
			bank.responses.push(
				initOk(),
				answer(
					OK,
					hirms(5, TAN_REQUIRED, '3955::Bitte bestaetigen Sie den Auftrag in Ihrer App.'),
					hivppSingle('RCVC'),
					hitan(),
				),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);
			expect(response).toMatchObject({ requiresTan: true, vop: { result: 'match' } });

			bank.responses.push(
				answer(
					WARNINGS,
					hirms(4, '3956::Starke Kundenauthentifizierung noch ausstehend.'),
					hitan('TAN-REF-1', 'S'),
				),
			);
			const pending = await client.transferWithTan('TAN-REF-1');
			expect(pending).toMatchObject({ success: true, requiresTan: true });

			bank.responses.push(tanAccepted(), endOk());
			const done = await client.transferWithTan('TAN-REF-1');

			expect(done).toMatchObject({ success: true, requiresTan: false });
			expect(sentOrders().slice(2)).toEqual([['HKVPA', 'HKTAN'], ['HKTAN'], ['HKEND']]);
			expect(bank.sent[3].findSegment<HKTANSegment>('HKTAN')?.tanProcess).toBe('S');
		});

		it('hands a match back for confirmation when the bank asks for no TAN yet', async () => {
			bank.responses.push(initOk(), answer(OK, hirms(3, CHECK_RESULT), hivppSingle('RCVC')));

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({
				success: true,
				requiresTan: false,
				requiresVopConfirmation: true,
				vop: { result: 'match' },
			});
		});

		it('hands a match back for confirmation when the bank voids the approval (3945, observed at Commerzbank)', async () => {
			const report = pain002('RCVC');
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(5, TAN_REQUIRED, APPROVAL_VOIDED), hivppReport(report), hitan()),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({
				success: true,
				requiresTan: false,
				requiresVopConfirmation: true,
				vop: { result: 'match', code: 'RCVC', iban: PAYEE_IBAN },
			});
			expect(response.tanReference).toBeUndefined();
			expect(response.vop?.paymentStatusReport?.transactions[0].endToEndId).toBe('E2E-0001');

			bank.responses.push(answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')));
			const confirmed = await client.confirmTransfer(response.transferId);
			expect(confirmed).toMatchObject({ requiresTan: true, tanReference: 'TAN-REF-2' });
			expect(sentOrders()[2]).toEqual(['HKVPA', 'HKCCS', 'HKTAN']);
		});

		it('asks the caller when the bank voids the approval only in answer to the TAN (E.8.1 rule 5)', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				answer(WARNINGS, hirms(3, APPROVAL_VOIDED)),
			);

			const { transferId } = await client.transfer(ACCOUNT, TRANSFER);
			const response = await client.transferWithTan('TAN-REF-1', '123456');

			expect(response).toMatchObject({
				success: true,
				requiresTan: false,
				requiresVopConfirmation: true,
			});

			bank.responses.push(
				answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')),
				tanAccepted(),
				endOk(),
			);
			await client.confirmTransfer(transferId);
			const done = await client.transferWithTan('TAN-REF-2', '654321');

			expect(done).toMatchObject({ success: true, requiresTan: false });
			expect(sentOrders().slice(2)).toEqual([
				['HKVPA', 'HKTAN'],
				['HKVPA', 'HKCCS', 'HKTAN'],
				['HKTAN'],
				['HKEND'],
			]);
		});
	});

	describe('payee deviates', () => {
		it('reports a close match with the suggested name and continues only on confirmTransfer()', async () => {
			vopParams().noticeStructured = true;
			bank.responses.push(
				initOk(),
				// Sparkassen fire the pushTAN already with the first message (reported in
				// python-fints PR #223); the TAN is dropped, confirmTransfer brings a new one
				answer(
					WARNINGS,
					hirms(3, CHECK_RESULT),
					hirms(5, TAN_REQUIRED),
					hivppSingle('RVMC', { closeMatchName: 'Max Mustermann' }),
					hitan(),
				),
			);

			const response = await client.transfer(ACCOUNT, { ...TRANSFER, name: 'Max Musterman' });

			expect(response).toMatchObject({
				success: true,
				requiresTan: false,
				requiresVopConfirmation: true,
				vop: {
					result: 'closeMatch',
					code: 'RVMC',
					suggestedName: 'Max Mustermann',
					notice: 'Bei Abweichungen haftet die Bank nicht.',
					noticeStructured: true,
				},
			});
			expect(response.tanReference).toBeUndefined();
			expect(response.tanChallenge).toBeUndefined();
			expect(bank.sent).toHaveLength(2);

			bank.responses.push(answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')));
			const confirmed = await client.confirmTransfer(response.transferId);

			expect(confirmed).toMatchObject({
				success: true,
				requiresTan: true,
				requiresVopConfirmation: false,
				tanReference: 'TAN-REF-2',
				vop: { result: 'closeMatch' },
			});
			expect(sentOrders()[2]).toEqual(['HKVPA', 'HKCCS', 'HKTAN']);
			expect(bank.sent[2].findSegment<HKVPASegment>('HKVPA')?.vopId).toBe('VOP-01');
			// The identical order, not a new one
			expect(bank.sent[2].findSegment<HKCCSSegment>('HKCCS')?.sepaPainMessage).toBe(
				bank.sent[1].findSegment<HKCCSSegment>('HKCCS')?.sepaPainMessage,
			);

			bank.responses.push(tanAccepted(), endOk());
			const done = await client.transferWithTan('TAN-REF-2', '123456');

			expect(done).toMatchObject({ success: true, requiresTan: false });
			expect(sentOrders().slice(3)).toEqual([['HKTAN'], ['HKEND']]);
		});

		it('reads the close match name from the pain.002 reason, decoded as UTF-8', async () => {
			const report = pain002('RVMC', 'Jürgen Müller');
			bank.responses.push(initOk(), answer(WARNINGS, hirms(3, CHECK_RESULT), hivppReport(report)));

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response.vop).toMatchObject({
				result: 'closeMatch',
				suggestedName: 'Jürgen Müller',
				reasons: ['Jürgen Müller'],
			});
		});

		it('reports no match, and cancelTransfer() ends the dialog without sending the order again', async () => {
			bank.responses.push(initOk(), answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')));

			const response = await client.transfer(ACCOUNT, TRANSFER);
			expect(response).toMatchObject({
				requiresVopConfirmation: true,
				vop: { result: 'noMatch', code: 'RVNM' },
			});

			bank.responses.push(endOk());
			await client.cancelTransfer(response.transferId);

			expect(sentOrders().slice(2)).toEqual([['HKEND']]);
			await expect(client.confirmTransfer(response.transferId)).rejects.toThrow(
				/no transfer is waiting/,
			);
		});

		it('reports a check that was not possible, with the reason', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, CHECK_RESULT),
					hivppSingle('RVNA', { reason: 'Empfaengerbank nimmt nicht teil' }),
				),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({
				requiresVopConfirmation: true,
				vop: {
					result: 'notApplicable',
					code: 'RVNA',
					notApplicableReason: 'Empfaengerbank nimmt nicht teil',
				},
			});
		});

		it('reports a VoP ID without any result as not applicable', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, CHECK_RESULT),
					"HIVPP:5:1:3+@11@notprovided++++++Der Namensabgleich war nicht moeglich.'",
				),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({
				requiresVopConfirmation: true,
				vop: { result: 'notApplicable', notice: 'Der Namensabgleich war nicht moeglich.' },
			});
			expect(response.vop?.code).toBeUndefined();

			bank.responses.push(answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')));
			await client.confirmTransfer(response.transferId);
			expect(bank.sent[2].findSegment<HKVPASegment>('HKVPA')?.vopId).toBe('notprovided');
		});
	});

	describe('asynchronous check', () => {
		it('polls with polling ID and touchdown point, honouring the wait time (as observed at Atruvia banks)', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, '3040::Es liegen weitere Informationen vor.:TP-0001'),
					hirms(5, '3905::Es wurde keine Challenge erzeugt.'),
					hivppPending('POLL-0001', 2),
				),
				answer(
					WARNINGS,
					hirms(3, '3040::Es liegen weitere Informationen vor.:TP-0002'),
					hivppPending('POLL-0001', 1),
				),
				answer(OK, hirms(3, CHECK_RESULT), hivppReport(pain002('RCVC'))),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({
				success: true,
				requiresTan: false,
				requiresVopConfirmation: true,
				vop: { result: 'match' },
			});
			expect(sleep.mock.calls).toEqual([[2000], [1000]]);
			expect(sentOrders()).toEqual([
				['HKIDN', 'HKVVB', 'HKTAN'],
				['HKVPP', 'HKCCS', 'HKTAN'],
				['HKVPP'],
				['HKVPP'],
			]);
			expect(bank.sent[2].findSegment<HKVPPSegment>('HKVPP')).toMatchObject({
				pollingId: 'POLL-0001',
				touchdownPoint: 'TP-0001',
			});
			expect(bank.sent[3].findSegment<HKVPPSegment>('HKVPP')).toMatchObject({
				pollingId: 'POLL-0001',
				touchdownPoint: 'TP-0002',
			});

			bank.responses.push(
				answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')),
				tanAccepted(),
				endOk(),
			);
			await client.confirmTransfer(response.transferId);
			const done = await client.transferWithTan('TAN-REF-2', '123456');

			expect(done).toMatchObject({ success: true, requiresTan: false });
			expect(sentOrders().slice(4)).toEqual([['HKVPA', 'HKCCS', 'HKTAN'], ['HKTAN'], ['HKEND']]);
		});

		it('gives up after 60 seconds of waiting without executing anything', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, '3040::Bitte erneut anfragen.:TP-0001'),
					hivppPending('POLL-0001', 9),
				),
			);
			for (let i = 0; i < 6; i++) {
				bank.responses.push(
					answer(
						WARNINGS,
						hirms(3, '3040::Bitte erneut anfragen.:TP-0001'),
						hivppPending('POLL-0001', 9),
					),
				);
			}
			bank.responses.push(endOk());

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response.success).toBe(false);
			expect(response.failureReason).toMatch(/within 60 seconds/);
			expect(sleep).toHaveBeenCalledTimes(6);
			expect(sentOrders().at(-1)).toEqual(['HKEND']);
			expect(sentOrders().filter((segments) => segments.includes('HKCCS'))).toHaveLength(1);
			expect(bank.responses).toHaveLength(0);
		});
	});

	describe('execution without a decision', () => {
		it('accepts a transfer the bank executed straight away (3091 with 3076)', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, NO_HKVPA_NEEDED),
					hirms(5, '3076::Keine starke Kundenauthentifizierung notwendig.'),
					hivppSingle('RCVC'),
				),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({
				success: true,
				requiresTan: false,
				requiresVopConfirmation: false,
				vop: { result: 'match' },
			});
			expect(sentOrders().at(-1)).toEqual(['HKEND']);
		});

		it('authorises a match the bank holds without SCA (3076 without 3091) with HKVPA alone', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(5, '3076::Keine starke Kundenauthentifizierung notwendig.'),
					hivppSingle('RCVC'),
				),
				answer(OK, hirms(3, '0020::Auftrag ausgefuehrt.')),
				endOk(),
			);

			const first = await client.transfer(ACCOUNT, TRANSFER);
			expect(first).toMatchObject({
				success: true,
				requiresVopConfirmation: true,
				vop: { result: 'match' },
			});

			const response = await client.confirmTransfer(first.transferId);

			expect(response).toMatchObject({
				success: true,
				requiresTan: false,
				requiresVopConfirmation: false,
				outcomeUncertain: false,
			});
			expect(sentOrders().slice(1)).toEqual([['HKVPP', 'HKCCS', 'HKTAN'], ['HKVPA'], ['HKEND']]);
		});

		it('reports an authorisation alone without an acceptance as an uncertain outcome', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(5, '3076::Keine starke Kundenauthentifizierung notwendig.'),
					hivppSingle('RCVC'),
				),
				answer(WARNINGS),
				endOk(),
			);

			const first = await client.transfer(ACCOUNT, TRANSFER);
			const response = await client.confirmTransfer(first.transferId);

			expect(response).toMatchObject({ success: false, outcomeUncertain: true });
			expect(sentOrders().slice(2)).toEqual([['HKVPA'], ['HKEND']]);
		});

		it('reports an order the bank accepted as accepted, whatever the result, so it is not sent twice', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(4, '0020::Auftrag ausgefuehrt.'), hivppSingle('RVNM')),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({
				success: true,
				requiresVopConfirmation: false,
				vop: { result: 'noMatch' },
			});
			await expect(client.confirmTransfer(response.transferId)).rejects.toThrow();
		});
	});

	describe('outcome codes', () => {
		const expectUncertain = (response: Awaited<ReturnType<FinTSClient['transfer']>>) => {
			expect(response).toMatchObject({
				success: false,
				outcomeUncertain: true,
				requiresTan: false,
				requiresVopConfirmation: false,
			});
			expect(response.failureReason).toMatch(/Check the account/);
		};

		it('does not take 0010 to the order as its execution while the check is pending', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, '3040::Weitere Informationen.:TP-0001', '3093::Namensabgleich in Bearbeitung.'),
					hirms(4, '0010::Auftrag entgegengenommen.'),
					hirms(5, '3905::Es wurde keine Challenge erzeugt.'),
					hivppPending(),
				),
				answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({
				success: true,
				requiresVopConfirmation: true,
				outcomeUncertain: false,
				vop: { result: 'noMatch' },
			});
			expect(sentOrders()[2]).toEqual(['HKVPP']);
		});

		it('does not take 0010 to the order next to a deviation as its execution', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, CHECK_RESULT),
					hirms(4, '0010::Auftrag entgegengenommen.'),
					hivppSingle('RVNM'),
				),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({ requiresVopConfirmation: true, vop: { result: 'noMatch' } });
		});

		it('reports 9000 (status indifferent) as an uncertain outcome', async () => {
			bank.responses.push(initOk(), answer(OK, hirms(4, '9000::Status indifferent.')), endOk());

			expectUncertain(await client.transfer(ACCOUNT, TRANSFER));
		});

		it('reports an executed order next to a failed check as an uncertain outcome', async () => {
			bank.responses.push(
				initOk(),
				answer(
					"HIRMG:2:2+9050::Die Nachricht enthaelt Fehler.'",
					hirms(3, '9210::Namensabgleich abgelehnt.'),
					hirms(4, '0020::Auftrag ausgefuehrt.'),
				),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expectUncertain(response);
			expect(response.failureReason).not.toMatch(/rejected/);
		});

		it('does not offer a confirmation for an order the bank processes under a reference (3070)', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(4, '3070::Auftrag wird unter Referenz R-1 verarbeitet.:R-1'),
					hivppSingle('RCVC'),
				),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expectUncertain(response);
			expect(response.failureReason).toMatch(/R-1/);
			expect(sentOrders().at(-1)).toEqual(['HKEND']);
			expect(sentOrders().filter((segments) => segments.includes('HKCCS'))).toHaveLength(1);
		});

		it('does not offer a confirmation after polling for an order processed under a reference', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, '3040::Weitere Informationen.:TP-0001'),
					hirms(4, '3070::Auftrag wird unter Referenz R-1 verarbeitet.:R-1'),
					hivppPending(),
				),
				answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
				endOk(),
			);

			expectUncertain(await client.transfer(ACCOUNT, TRANSFER));
		});

		it('reports a failed decoupled approval (3958) as not executed', async () => {
			client.selectTanMethod(946);
			bank.responses.push(
				initOk(),
				answer(OK, hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				answer(
					WARNINGS,
					hirms(4, '3958::Freigabe-Anwendung unterstuetzt das gewaehlte Verfahren nicht.'),
				),
				endOk(),
			);

			await client.transfer(ACCOUNT, TRANSFER);
			const response = await client.transferWithTan('TAN-REF-1');

			expect(response).toMatchObject({
				success: false,
				outcomeUncertain: false,
				requiresTan: false,
			});
			expect(response.failureReason).toMatch(/3958/);
			expect(sentOrders().at(-1)).toEqual(['HKEND']);
		});

		it('reports a TAN answered without any acceptance as an uncertain outcome', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(3, NO_HKVPA_NEEDED), hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				answer(WARNINGS, hirms(3, '3040::Weitere Informationen.:MORE')),
				endOk(),
			);

			await client.transfer(ACCOUNT, TRANSFER);
			expectUncertain(await client.transferWithTan('TAN-REF-1', '123456'));
		});

		it('reports 3040 alone to an order without check as an uncertain outcome', async () => {
			removeTransaction('HKVPP');
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(3, '3040::Auftrag nur teilweise ausgefuehrt.:MORE')),
				endOk(),
			);

			expectUncertain(await client.transfer(ACCOUNT, TRANSFER));
		});

		it('accepts an order without check on 0010 to it', async () => {
			removeTransaction('HKVPP');
			bank.responses.push(
				initOk(),
				answer(OK, hirms(3, '0010::Auftrag zur Ausfuehrung vorgemerkt.')),
				endOk(),
			);

			expect(await client.transfer(ACCOUNT, TRANSFER)).toMatchObject({
				success: true,
				outcomeUncertain: false,
				requiresTan: false,
			});
		});
	});

	describe('fails closed', () => {
		const expectStopped = (response: Awaited<ReturnType<FinTSClient['transfer']>>) => {
			expect(response.success).toBe(false);
			expect(response.requiresTan).toBe(false);
			expect(response.requiresVopConfirmation).toBe(false);
			expect(response.tanReference).toBeUndefined();
			expect(response.failureReason).toBeTruthy();
			expect(sentOrders().at(-1)).toEqual(['HKEND']);
			expect(sentOrders().filter((segments) => segments.includes('HKCCS'))).toHaveLength(1);
		};

		it('on an unknown result code', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(5, TAN_REQUIRED), hivppSingle('RXXX'), hitan()),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expectStopped(response);
			expect(response.failureReason).toMatch(/unknown Verification of Payee result 'RXXX'/);
		});

		it('on a pending result that comes with a VoP ID', async () => {
			bank.responses.push(initOk(), answer(OK, hivppReport(pain002('PDNG'))), endOk());
			expectStopped(await client.transfer(ACCOUNT, TRANSFER));
		});

		it('on an unreadable pain.002', async () => {
			bank.responses.push(initOk(), answer(OK, hivppReport('<Document><Unclosed>')), endOk());
			expectStopped(await client.transfer(ACCOUNT, TRANSFER));
		});

		it('on a result without VoP ID and without polling ID', async () => {
			bank.responses.push(initOk(), answer(OK, `HIVPP:5:1:3+++++${PAYEE_IBAN}::::RVMC'`), endOk());

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expectStopped(response);
			expect(response.failureReason).toMatch(/without a VoP ID/);
		});

		it('on a TAN request without any VoP result', async () => {
			bank.responses.push(initOk(), answer(OK, hirms(5, TAN_REQUIRED), hitan()), endOk());

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expectStopped(response);
			expect(response.failureReason).toMatch(/without a Verification of Payee result/);
		});

		it('on a TAN request before the asynchronous result is complete', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(5, TAN_REQUIRED), hivppPending(), hitan()),
				endOk(),
			);
			expectStopped(await client.transfer(ACCOUNT, TRANSFER));
		});

		it('on an error code, even next to a TAN request', async () => {
			bank.responses.push(
				initOk(),
				answer(
					"HIRMG:2:2+9050::Die Nachricht enthaelt Fehler.'",
					hirms(3, '9210::Auftrag abgelehnt.'),
					hirms(5, TAN_REQUIRED),
					hivppSingle('RCVC'),
					hitan(),
				),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expectStopped(response);
			expect(response.bankAnswers.map((a) => a.code)).toContain(9210);
			expect(response.outcomeUncertain).toBe(false);
		});

		it('on a code asking for a TAN without HITAN, instead of throwing', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(5, TAN_REQUIRED), hivppSingle('RCVC')),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expectStopped(response);
			expect(response.failureReason).toMatch(/Unexpected answer/);
		});

		it('on 3945 after the caller has already confirmed', async () => {
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
				answer(WARNINGS, hirms(5, APPROVAL_VOIDED)),
				endOk(),
			);

			const { transferId } = await client.transfer(ACCOUNT, TRANSFER);
			const response = await client.confirmTransfer(transferId);

			expect(response.success).toBe(false);
			expect(response.requiresVopConfirmation).toBe(false);
			expect(sentOrders().at(-1)).toEqual(['HKEND']);
		});

		it('on a poll answered with a TAN request', async () => {
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(3, '3040::Bitte erneut anfragen.:TP-0001'), hivppPending()),
				answer(OK, hirms(3, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response.success).toBe(false);
			expect(sentOrders().at(-1)).toEqual(['HKEND']);
		});
	});

	describe('parameters at the time of the order', () => {
		/** Changes the banking information the way a dialog initialisation answer would */
		const atInitialisation = (change: () => void) => {
			const original = InitDialogInteraction.prototype.handleResponse;
			vi.spyOn(InitDialogInteraction.prototype, 'handleResponse').mockImplementation(function (
				this: InitDialogInteraction,
				...args
			) {
				original.apply(this, args);
				change();
			});
		};
		const hkspaParams = () =>
			config.bankingInformation.bpd?.allowedTransactions.find((t) => t.transId === 'HKSPA')
				?.params as { supportedSepaFormats: string[] };

		it('refuses an account the UPD does not allow transfers from, as canTransfer() does', async () => {
			expect(client.canTransfer('9876543210')).toBe(false);

			await expect(client.transfer('9876543210', TRANSFER)).rejects.toThrow(
				/does not allow SEPA credit transfers/,
			);
			expect(bank.sent).toHaveLength(0);
		});

		it('checks the payee when the dialog initialisation brings parameters that require it', async () => {
			const withVop = config.bankingInformation.bpd?.allowedTransactions ?? [];
			removeTransaction('HKVPP');
			atInitialisation(() => {
				const bpd = config.bankingInformation.bpd;
				if (bpd) bpd.allowedTransactions = withVop;
			});
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, CHECK_RESULT),
					hirms(5, TAN_REQUIRED),
					hivppSingle('RVNM'),
					hitan(),
				),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({ requiresVopConfirmation: true, vop: { result: 'noMatch' } });
			expect(sentOrders()[1]).toEqual(['HKVPP', 'HKCCS', 'HKTAN']);
		});

		it('writes the pain.001 format the dialog initialisation announces, and confirms the same bytes', async () => {
			atInitialisation(() => {
				hkspaParams().supportedSepaFormats = [PAIN_001_001_03];
			});
			bank.responses.push(initOk(), answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')));

			const response = await client.transfer(ACCOUNT, TRANSFER);
			bank.responses.push(answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')));
			await client.confirmTransfer(response.transferId);

			const submitted = bank.sent[1].findSegment<HKCCSSegment>('HKCCS');
			const confirmed = bank.sent[2].findSegment<HKCCSSegment>('HKCCS');
			expect(submitted?.sepaDescriptor).toBe(PAIN_001_001_03);
			expect(submitted?.sepaPainMessage).toContain('pain.001.001.03');
			expect(confirmed?.sepaDescriptor).toBe(PAIN_001_001_03);
			expect(confirmed?.sepaPainMessage).toBe(submitted?.sepaPainMessage);
		});

		it('sends no order from an account the dialog initialisation withdrew transfers from', async () => {
			atInitialisation(() => {
				const account = config.bankingInformation.upd?.bankAccounts[0];
				if (account) account.allowedTransactions = [{ transId: 'HKSAL', numSignatures: 1 }];
			});
			bank.responses.push(initOk(), endOk());

			await expect(client.transfer(ACCOUNT, TRANSFER)).rejects.toThrow(
				/does not allow SEPA credit transfers/,
			);
			expect(sentOrders()).toEqual([['HKIDN', 'HKVVB', 'HKTAN'], ['HKEND']]);
			expect(bank.sent[1].findSegment<HNHBKSegment>('HNHBK')?.msgNr).toBe(2);
		});

		it('stops for the caller when the bank reports a check its stored parameters do not ask for', async () => {
			removeTransaction('HKVPP');
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, CHECK_RESULT),
					hirms(4, TAN_REQUIRED),
					hivppSingle('RVNM'),
					hitan(),
				),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({
				success: false,
				requiresTan: false,
				requiresVopConfirmation: false,
			});
			expect(response.failureReason).toMatch(/Verification of Payee/);
			expect(sentOrders().slice(1)).toEqual([['HKCCS', 'HKTAN'], ['HKEND']]);
		});

		it('sends HKTAN with the check and with the authorisation where the bank requires no TAN for HKCCS (E.8.1)', async () => {
			const hkccs = config.bankingInformation.bpd?.allowedTransactions.find(
				(t) => t.transId === 'HKCCS',
			);
			if (hkccs) hkccs.tanRequired = false;
			bank.responses.push(initOk(), answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')));

			const response = await client.transfer(ACCOUNT, TRANSFER);
			bank.responses.push(answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')));
			await client.confirmTransfer(response.transferId);

			expect(sentOrders().slice(1)).toEqual([
				['HKVPP', 'HKCCS', 'HKTAN'],
				['HKVPA', 'HKCCS', 'HKTAN'],
			]);
		});
	});

	describe('without Verification of Payee', () => {
		it('sends HKCCS alone when the bank does not require the check for HKCCS', async () => {
			vopParams().vopRequiredTransactions = ['HKCSE'];
			bank.responses.push(
				initOk(),
				answer(OK, "HIRMS:3:2:4+0030::Sicherheitsfreigabe erforderlich.'", hitan()),
				tanAccepted(),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);
			expect(response).toMatchObject({
				success: true,
				requiresTan: true,
				requiresVopConfirmation: false,
			});
			expect(response.vop).toBeUndefined();

			const done = await client.transferWithTan('TAN-REF-1', '123456');

			expect(done).toMatchObject({ success: true, requiresTan: false });
			expect(sentOrders().slice(1)).toEqual([['HKCCS', 'HKTAN'], ['HKTAN'], ['HKEND']]);
		});

		it('writes pain.001.001.03 for a bank that lists only that', async () => {
			removeTransaction('HKVPP');
			const hkspa = config.bankingInformation.bpd?.allowedTransactions.find(
				(t) => t.transId === 'HKSPA',
			);
			(hkspa?.params as { supportedSepaFormats: string[] }).supportedSepaFormats = [
				PAIN_001_001_03,
			];
			bank.responses.push(initOk(), answer(OK, "HIRMS:3:2:3+0020::Auftrag ausgefuehrt.'"), endOk());

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({ success: true, requiresTan: false });
			expect(bank.sent[1].findSegment<HKCCSSegment>('HKCCS')?.sepaDescriptor).toBe(PAIN_001_001_03);
		});

		it('stops when the bank asks for a check its parameters do not announce', async () => {
			removeTransaction('HKVPP');
			bank.responses.push(initOk(), answer(WARNINGS, hirms(3, APPROVAL_VOIDED)), endOk());

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response.success).toBe(false);
			expect(response.failureReason).toMatch(/3945/);
		});
	});

	describe('dialog handling', () => {
		it('continues with the transfer after a TAN for the dialog initialisation', async () => {
			bank.responses.push(
				answer(OK, "HIRMS:3:2:5+0030::Sicherheitsfreigabe erforderlich.'", hitan('INIT-REF')),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({
				success: true,
				requiresTan: true,
				requiresVopConfirmation: false,
				tanReference: 'INIT-REF',
				endToEndId: 'E2E-0001',
			});

			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, NO_HKVPA_NEEDED),
					hirms(5, TAN_REQUIRED),
					hivppSingle('RCVC'),
					hitan(),
				),
			);
			const submitted = await client.transferWithTan('INIT-REF', '111111');

			expect(submitted).toMatchObject({ requiresTan: true, tanReference: 'TAN-REF-1' });
			expect(bank.sent[1].findSegment<HKTANSegment>('HKTAN')).toMatchObject({
				segId: 'HKIDN',
				orderRef: 'INIT-REF',
			});
			expect(sentOrders()[2]).toEqual(['HKVPP', 'HKCCS', 'HKTAN']);
		});

		it('reports a failed initialisation as a transfer that was not executed', async () => {
			bank.responses.push(answer("HIRMG:2:2+9800::Dialog abgebrochen.'"), endOk());

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response.success).toBe(false);
			expect(response.failureReason).toMatch(/not executed/);
			expect(sentOrders().some((segments) => segments.includes('HKCCS'))).toBe(false);
		});

		it('allows one transfer at a time', async () => {
			bank.responses.push(initOk(), answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')));
			await client.transfer(ACCOUNT, TRANSFER);

			await expect(client.transfer(ACCOUNT, TRANSFER)).rejects.toThrow(/already in progress/);
		});

		it('refuses continuations that do not fit the state of the transfer', async () => {
			await expect(client.confirmTransfer('T')).rejects.toThrow(/no transfer is waiting/);
			await expect(client.transferWithTan('REF', '123456')).rejects.toThrow(
				/no transfer is waiting/,
			);

			bank.responses.push(initOk(), answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVMC')));
			await client.transfer(ACCOUNT, TRANSFER);
			await expect(client.transferWithTan('TAN-REF-1', '123456')).rejects.toThrow(
				/no transfer is waiting for a TAN/,
			);
		});

		it('requires the TAN for a TAN method that is not decoupled, without dropping the transfer', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, NO_HKVPA_NEEDED),
					hirms(5, TAN_REQUIRED),
					hivppSingle('RCVC'),
					hitan(),
				),
			);
			await client.transfer(ACCOUNT, TRANSFER);

			await expect(client.transferWithTan('TAN-REF-1')).rejects.toThrow(/TAN must be provided/);

			bank.responses.push(tanAccepted(), endOk());
			expect(await client.transferWithTan('TAN-REF-1', '123456')).toMatchObject({ success: true });
		});

		it('still reports success when only ending the dialog fails after the bank accepted', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, NO_HKVPA_NEEDED),
					hirms(5, TAN_REQUIRED),
					hivppSingle('RCVC'),
					hitan(),
				),
				tanAccepted(),
				new Error('connection reset'),
			);
			await client.transfer(ACCOUNT, TRANSFER);

			const done = await client.transferWithTan('TAN-REF-1', '123456');

			expect(done).toMatchObject({ success: true, requiresTan: false });
		});

		it('passes on a connection error during the TAN step and drops the transfer', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, NO_HKVPA_NEEDED),
					hirms(5, TAN_REQUIRED),
					hivppSingle('RCVC'),
					hitan(),
				),
				new Error('connection reset'),
				endOk(),
			);
			await client.transfer(ACCOUNT, TRANSFER);

			await expect(client.transferWithTan('TAN-REF-1', '123456')).rejects.toThrow(
				'connection reset',
			);
			expect(sentOrders().at(-1)).toEqual(['HKEND']);
			await expect(client.transferWithTan('TAN-REF-1', '123456')).rejects.toThrow(
				/no transfer is waiting/,
			);
		});

		it('cancels a transfer waiting for its TAN', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, NO_HKVPA_NEEDED),
					hirms(5, TAN_REQUIRED),
					hivppSingle('RCVC'),
					hitan(),
				),
				endOk(),
			);
			const { transferId } = await client.transfer(ACCOUNT, TRANSFER);

			await client.cancelTransfer(transferId);

			expect(sentOrders().at(-1)).toEqual(['HKEND']);
			await client.cancelTransfer(transferId);
			expect(bank.sent).toHaveLength(3);
		});

		describe('overlapping calls', () => {
			/** A bank answer that arrives only when the test delivers it */
			const deferred = () => {
				let deliver: (message: Message) => void = () => {};
				const promise = new Promise<Message>((resolve) => {
					deliver = resolve;
				});
				return { promise, deliver };
			};

			it('sends a confirmation once when confirmTransfer() is called again before the answer', async () => {
				bank.responses.push(
					initOk(),
					answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
				);
				const { transferId } = await client.transfer(ACCOUNT, TRANSFER);

				bank.responses.push(
					answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')),
					answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-3')),
				);
				const [first, second] = await Promise.allSettled([
					client.confirmTransfer(transferId),
					client.confirmTransfer(transferId),
				]);

				expect(first).toMatchObject({ status: 'fulfilled', value: { tanReference: 'TAN-REF-2' } });
				expect(second).toMatchObject({ status: 'rejected' });
				expect((second as PromiseRejectedResult).reason.message).toMatch(/still waiting/);
				expect(sentOrders().slice(2)).toEqual([['HKVPA', 'HKCCS', 'HKTAN']]);
			});

			it('sends a TAN once when transferWithTan() is called again before the answer', async () => {
				bank.responses.push(
					initOk(),
					answer(WARNINGS, hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				);
				await client.transfer(ACCOUNT, TRANSFER);

				bank.responses.push(tanAccepted(), endOk(), tanAccepted(), endOk());
				const [first, second] = await Promise.allSettled([
					client.transferWithTan('TAN-REF-1', '123456'),
					client.transferWithTan('TAN-REF-1', '123456'),
				]);

				expect(first).toMatchObject({ status: 'fulfilled', value: { success: true } });
				expect(second).toMatchObject({ status: 'rejected' });
				expect(sentOrders().slice(2)).toEqual([['HKVPA', 'HKTAN'], ['HKEND']]);
			});

			it('refuses to cancel while a step waits for its answer, and keeps the transfer', async () => {
				bank.responses.push(
					initOk(),
					answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
				);
				const { transferId } = await client.transfer(ACCOUNT, TRANSFER);

				const tanAnswer = deferred();
				bank.responses.push(tanAnswer.promise);
				const confirmed = client.confirmTransfer(transferId);

				await expect(client.cancelTransfer(transferId)).rejects.toThrow(/still waiting/);
				await expect(client.transfer(ACCOUNT, TRANSFER)).rejects.toThrow(/already in progress/);
				expect(bank.sent).toHaveLength(3);

				tanAnswer.deliver(answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')));
				expect(await confirmed).toMatchObject({ requiresTan: true, tanReference: 'TAN-REF-2' });

				bank.responses.push(tanAccepted(), endOk());
				expect(await client.transferWithTan('TAN-REF-2', '123456')).toMatchObject({
					success: true,
				});
			});

			it('leaves a transfer alone whose first message still waits for its answer', async () => {
				const orderAnswer = deferred();
				bank.responses.push(initOk(), orderAnswer.promise);
				const submitted = client.transfer(ACCOUNT, TRANSFER);
				await vi.waitFor(() => expect(bank.sent).toHaveLength(2));

				await client.cancelTransfer('T');
				await expect(client.confirmTransfer('T')).rejects.toThrow(/still waiting/);
				await expect(client.transferWithTan('TAN-REF-1', '123456')).rejects.toThrow(
					/still waiting/,
				);

				orderAnswer.deliver(answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')));
				const response = await submitted;
				expect(response).toMatchObject({ requiresVopConfirmation: true });
				expect(bank.sent).toHaveLength(2);

				bank.responses.push(endOk());
				await client.cancelTransfer(response.transferId);
				expect(sentOrders().at(-1)).toEqual(['HKEND']);
			});
		});

		describe('transfer references', () => {
			it('gives every transfer its own reference, on every response', async () => {
				bank.responses.push(
					answer(OK, "HIRMS:3:2:5+0030::Sicherheitsfreigabe erforderlich.'", hitan('INIT-REF')),
				);
				const first = await client.transfer(ACCOUNT, TRANSFER);

				bank.responses.push(
					initOk(),
					answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
				);
				const second = await client.transferWithTan('INIT-REF', '111111');

				bank.responses.push(endOk(), initOk(), answer(OK, hirms(4, '0020::Auftrag ausgefuehrt.')));
				await client.cancelTransfer(second.transferId);
				const other = await client.transfer(ACCOUNT, TRANSFER);

				expect(first.transferId).toMatch(/^[0-9a-f]{32}$/);
				expect(second.transferId).toBe(first.transferId);
				expect(other.transferId).toMatch(/^[0-9a-f]{32}$/);
				expect(other.transferId).not.toBe(first.transferId);
			});

			it('does not confirm a later transfer with the reference of an earlier one', async () => {
				bank.responses.push(
					initOk(),
					answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
				);
				const earlier = await client.transfer(ACCOUNT, TRANSFER);
				bank.responses.push(endOk());
				await client.cancelTransfer(earlier.transferId);

				bank.responses.push(
					initOk(),
					answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
				);
				const later = await client.transfer(ACCOUNT, { ...TRANSFER, amount: 100 });
				const sent = bank.sent.length;

				await expect(client.confirmTransfer(earlier.transferId)).rejects.toThrow(
					/no transfer is waiting/,
				);
				expect(bank.sent).toHaveLength(sent);

				bank.responses.push(answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')));
				expect(await client.confirmTransfer(later.transferId)).toMatchObject({
					requiresTan: true,
				});
			});

			it('does not cancel a later transfer with the reference of an earlier one', async () => {
				bank.responses.push(
					initOk(),
					answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
				);
				const earlier = await client.transfer(ACCOUNT, TRANSFER);
				bank.responses.push(endOk());
				await client.cancelTransfer(earlier.transferId);

				bank.responses.push(
					initOk(),
					answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
				);
				const later = await client.transfer(ACCOUNT, TRANSFER);
				const sent = bank.sent.length;

				await client.cancelTransfer(earlier.transferId);
				expect(bank.sent).toHaveLength(sent);

				bank.responses.push(answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')));
				expect(await client.confirmTransfer(later.transferId)).toMatchObject({
					requiresTan: true,
				});
			});

			it('refuses a TAN reference other than the outstanding challenge, keeping the transfer', async () => {
				bank.responses.push(
					initOk(),
					answer(WARNINGS, hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				);
				await client.transfer(ACCOUNT, TRANSFER);

				await expect(client.transferWithTan('PREVIOUS-TRANSFER', '123456')).rejects.toThrow(
					/does not belong to the challenge/,
				);
				expect(bank.sent).toHaveLength(2);

				bank.responses.push(tanAccepted(), endOk());
				expect(await client.transferWithTan('TAN-REF-1', '123456')).toMatchObject({
					success: true,
				});
				expect(sentOrders().slice(2)).toEqual([['HKVPA', 'HKTAN'], ['HKEND']]);
			});
		});
	});
});

describe('extractVopResult', () => {
	const report = (status: string, encoding = 'UTF-8', reason = '') =>
		`<?xml version="1.0" encoding="${encoding}"?><Document><CstmrPmtStsRpt><OrgnlGrpInfAndSts><OrgnlMsgId>M</OrgnlMsgId></OrgnlGrpInfAndSts><OrgnlPmtInfAndSts><TxInfAndSts><TxSts>${status}</TxSts>${reason ? `<StsRsnInf><AddtlInf>${reason}</AddtlInf></StsRsnInf>` : ''}</TxInfAndSts></OrgnlPmtInfAndSts></CstmrPmtStsRpt></Document>`;

	it('lets a deviation win when the single result and the report disagree', () => {
		const result = extractVopResult(
			{
				header: { segId: 'HIVPP', segNr: 5, version: 1 },
				vopId: 'VOP-01',
				singleResult: { iban: 'DE02120300000000202051', result: 'RCVC' },
				paymentStatusReport: report('RVNM'),
			},
			undefined,
			false,
		);

		expect(result.result).toBe('noMatch');
		expect(result.code).toBe('RVNM');
	});

	it('reads a report declared as ISO-8859-1 as it stands', () => {
		const result = extractVopResult(
			{
				header: { segId: 'HIVPP', segNr: 5, version: 1 },
				vopId: 'VOP-01',
				paymentStatusReport: report('RVMC', 'ISO-8859-1', 'Jürgen Müller'),
			},
			undefined,
			false,
		);

		expect(result.suggestedName).toBe('Jürgen Müller');
	});
});
