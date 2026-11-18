import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { FinTSClient } from '../client.js';
import { UpdUsage } from '../codes.js';
import { FinTSConfig } from '../config.js';
import { extractVopResult } from '../interactions/creditTransferInteraction.js';
import { InitDialogInteraction } from '../interactions/initDialogInteraction.js';
import type { Message } from '../message.js';
import { PAIN_001_001_03, PAIN_001_001_09, SepaValidationError } from '../pain001Builder.js';
import type { HIVPPSParameter } from '../segments/HIVPPS.js';
import type { HKCCSSegment } from '../segments/HKCCS.js';
import type { HKTANSegment } from '../segments/HKTAN.js';
import type { HKVPASegment } from '../segments/HKVPA.js';
import type { HKVPPSegment } from '../segments/HKVPP.js';
import type { HNHBKSegment } from '../segments/HNHBK.js';

import {
	ACCOUNT,
	APPROVAL_VOIDED,
	answer,
	bank,
	CHECK_RESULT,
	createBankingInformation,
	endOk,
	hirms,
	hitan,
	hivppPending,
	hivppReport,
	hivppSingle,
	initOk,
	NO_HKVPA_NEEDED,
	OK,
	ORDER_MESSAGE_ID,
	PAYEE_IBAN,
	pain002,
	REPORT_FORMAT,
	sentOrders,
	TAN_REQUIRED,
	TRANSFER,
	tanAccepted,
	WARNINGS,
} from './creditTransferBank.js';

vi.mock('../httpClient.js', async () => ({
	HttpClient: (await import('./creditTransferBank.js')).MockHttpClient,
}));

describe('FinTSClient SEPA credit transfer', () => {
	let config: FinTSConfig;
	let client: FinTSClient;
	let sleep: MockInstance<(milliseconds: number) => Promise<void>>;

	beforeEach(() => {
		bank.responses = [];
		bank.sent = [];
		bank.orderMessageId = '';
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

		it('leaves an account the UPD does not list HKCCS for to the bank with UPD usage 1', async () => {
			const upd = config.bankingInformation.upd;
			if (upd) {
				upd.usage = UpdUsage.MissingUnknown;
				// The fixture's IBAN for this account has wrong check digits
				upd.bankAccounts[1].iban = 'DE89370400440532013000';
			}
			expect(client.canTransfer('9876543210')).toBe(true);

			bank.responses.push(initOk(), answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')));
			expect(await client.transfer('9876543210', TRANSFER)).toMatchObject({
				requiresVopConfirmation: true,
			});
			expect(sentOrders()[1]).toEqual(['HKVPP', 'HKCCS', 'HKTAN']);
		});

		it('is false without a TAN method that can send the HKTAN the transfer requires', () => {
			config.tanMethodId = undefined;
			expect(client.canTransfer(ACCOUNT)).toBe(false);
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
		// The cases of invalid input are the builder's tests; here only that nothing is sent
		it('sends no message for invalid input', async () => {
			await expect(
				client.transfer(ACCOUNT, { ...TRANSFER, iban: 'DE02120300000000202052' }),
			).rejects.toBeInstanceOf(SepaValidationError);
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
			// The answers of every poll, not only of the last one
			expect(response.bankAnswers.map((answer) => answer.code)).toEqual(
				expect.arrayContaining([3040, 3905, 3090]),
			);
			expect(
				response.bankAnswers.filter((answer) => answer.code === 3040).map((a) => a.params?.[0]),
			).toEqual(['TP-0001', 'TP-0002']);
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

		it('polls with the touchdown point alone when the bank sends no polling ID', async () => {
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(3, '3040::Weitere Daten.:TP-1'), "HIVPP:5:1:3++++++++2'"),
				answer(WARNINGS, hirms(3, '3040::Weitere Daten.:TP-2'), "HIVPP:5:1:3++++++++1'"),
				answer(OK, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({ requiresVopConfirmation: true, vop: { result: 'noMatch' } });
			expect(sentOrders().slice(2)).toEqual([['HKVPP'], ['HKVPP']]);
			const polls = bank.sent.slice(2).map((m) => m.findSegment<HKVPPSegment>('HKVPP'));
			expect(polls[0]?.touchdownPoint).toBe('TP-1');
			expect(polls[0]?.pollingId).toBeUndefined();
			expect(polls[1]?.touchdownPoint).toBe('TP-2');
		});

		it('asks again only with a current touchdown point, the polling ID alongside it', async () => {
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(3, '3040::Weitere Daten.:TP-1'), hivppPending('POLL-0001', 1)),
				// No 3040: the polling ID alone is no touchdown point to ask again from
				answer(OK, hivppPending('POLL-0001', 1)),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({ success: false, requiresVopConfirmation: false });
			expect(response.failureReason).toMatch(/without a VoP ID/);
			expect(sentOrders().slice(2)).toEqual([['HKVPP'], ['HKEND']]);
			expect(bank.sent[2].findSegment<HKVPPSegment>('HKVPP')).toMatchObject({
				pollingId: 'POLL-0001',
				touchdownPoint: 'TP-1',
			});
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

		it('authorises with HKVPA alone a held match whose result came by polling (3076 before it)', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, '3040::Weitere Daten.:TP-1'),
					hirms(5, '3076::Keine starke Kundenauthentifizierung notwendig.'),
					hivppPending(),
				),
				answer(OK, hirms(3, CHECK_RESULT), hivppSingle('RCVC')),
				answer(OK, hirms(3, '0020::Auftrag ausgefuehrt.')),
				endOk(),
			);

			const first = await client.transfer(ACCOUNT, TRANSFER);
			expect(first).toMatchObject({ requiresVopConfirmation: true, vop: { result: 'match' } });

			const done = await client.confirmTransfer(first.transferId);

			expect(done).toMatchObject({ success: true, requiresTan: false, outcomeUncertain: false });
			expect(sentOrders().slice(3)).toEqual([['HKVPA'], ['HKEND']]);
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

	describe('payment status reports', () => {
		const COUNTS = (status: string, count = 1) =>
			`<NbOfTxsPerSts><DtldNbOfTxs>${count}</DtldNbOfTxs><DtldSts>${status}</DtldSts></NbOfTxsPerSts>`;
		const withoutTransactions = (report: string, counts: string) =>
			report
				.replace(/<TxInfAndSts>.*?<\/TxInfAndSts>/, counts)
				.replace('</OrgnlGrpInfAndSts>', `${counts}</OrgnlGrpInfAndSts>`);
		const latin1 = (text: string) => Buffer.from(text, 'utf8').toString('latin1');
		const transferWithReport = async (report: string) => {
			bank.responses.push(initOk(), answer(WARNINGS, hirms(3, CHECK_RESULT), hivppReport(report)));
			return client.transfer(ACCOUNT, TRANSFER);
		};

		it('reads the transaction status below the aggregate status RVCM', async () => {
			const report = pain002('RVMC', 'Erika Mustermann')
				.replace('</OrgnlGrpInfAndSts>', '<GrpSts>RVCM</GrpSts></OrgnlGrpInfAndSts>')
				.replace('<TxInfAndSts>', '<PmtInfSts>RVCM</PmtInfSts><TxInfAndSts>');

			expect((await transferWithReport(report)).vop).toMatchObject({
				result: 'closeMatch',
				suggestedName: 'Erika Mustermann',
			});
		});

		it('reads a single match the report gives only as a count', async () => {
			const report = withoutTransactions(pain002('RCVC'), COUNTS('RCVC'));
			bank.responses.push(
				initOk(),
				answer(OK, hirms(3, NO_HKVPA_NEEDED), hirms(5, TAN_REQUIRED), hivppReport(report), hitan()),
			);

			expect(await client.transfer(ACCOUNT, TRANSFER)).toMatchObject({
				success: true,
				requiresTan: true,
				vop: { result: 'match', code: 'RCVC' },
			});
		});

		const transferWithTanAndReport = async (report: string) => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(5, TAN_REQUIRED), hivppReport(report), hitan()),
				endOk(),
			);
			return client.transfer(ACCOUNT, TRANSFER);
		};

		it('stops at a transaction status the counts contradict', async () => {
			const report = pain002('RCVC').replace(
				'</OrgnlGrpInfAndSts>',
				`${COUNTS('RVNM')}</OrgnlGrpInfAndSts>`,
			);

			const response = await transferWithTanAndReport(report);

			expect(response).toMatchObject({ success: false, requiresTan: false });
			expect(response.failureReason).toMatch(/contradicts/);
		});

		it('stops at a report about another payment', async () => {
			const response = await transferWithTanAndReport(
				pain002('RCVC').replace('E2E-0001', 'OTHER-INVOICE'),
			);

			expect(response).toMatchObject({ success: false, requiresTan: false });
			expect(response.failureReason).toMatch(/another payment/);
		});

		it('stops at a report about another order', async () => {
			const response = await transferWithTanAndReport(
				pain002('RCVC').replace(ORDER_MESSAGE_ID, 'SOME-OTHER-ORDER'),
			);

			expect(response).toMatchObject({ success: false, requiresTan: false });
			expect(response.failureReason).toMatch(/another order/);
		});

		it('stops at counts that do not name one result', async () => {
			const report = withoutTransactions(pain002('RCVC'), COUNTS('RCVC') + COUNTS('RVNM'));

			const response = await transferWithReport(report);

			expect(response).toMatchObject({ success: false, requiresVopConfirmation: false });
			expect(response.failureReason).toMatch(/not executed/);
		});

		it('stops at a mismatch the report does not detail', async () => {
			const report = pain002('RCVC')
				.replace(/<TxInfAndSts>.*?<\/TxInfAndSts>/, '')
				.replace('</OrgnlGrpInfAndSts>', '<GrpSts>RVCM</GrpSts></OrgnlGrpInfAndSts>');

			expect(await transferWithReport(report)).toMatchObject({
				success: false,
				requiresVopConfirmation: false,
			});
		});

		it('joins a payee name continued after 105 characters, dropping the quote mark', async () => {
			const first = 'A'.repeat(105);
			const report = pain002('RVMC', first).replace(
				`${first}</AddtlInf>`,
				`${first}</AddtlInf><AddtlInf>${latin1('“')} GmbH</AddtlInf>`,
			);

			expect((await transferWithReport(report)).vop?.suggestedName).toBe(`${first} GmbH`);
		});

		it('keeps the space at the boundary of a continued payee name', async () => {
			const name = `${'A'.repeat(104)} B`;
			const report = pain002(
				'RVMC',
				`${name.slice(0, 105)}</AddtlInf><AddtlInf>${name.slice(105)}`,
			);

			expect((await transferWithReport(report)).vop?.suggestedName).toBe(name);
		});

		it('decodes numeric character references in the payee name', async () => {
			const report = pain002('RVMC', 'J&#252;rgen M&#xFC;ller');

			expect((await transferWithReport(report)).vop?.suggestedName).toBe('Jürgen Müller');
		});

		it('reads the reason code of a check that was not possible', async () => {
			const report = pain002('RVNA', 'timed out').replace(
				'<AddtlInf>timed out</AddtlInf>',
				'<Rsn><Cd>AB11</Cd></Rsn>',
			);

			expect((await transferWithReport(report)).vop).toMatchObject({
				result: 'notApplicable',
				notApplicableReason: 'AB11',
			});
		});

		it('joins a report the bank splits across two answers', async () => {
			const report = pain002('RVMC', 'Jürgen Müller');
			const cut = report.indexOf('M', report.indexOf('<AddtlInf>')) + 3;
			const [head, tail] = [report.slice(0, cut), report.slice(cut)];
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, '3040::Weitere Daten.:TP-1'),
					`HIVPP:5:1:3+++@4@POLL+${REPORT_FORMAT}+@${head.length}@${head}'`,
				),
				answer(OK, hirms(3, CHECK_RESULT), hivppReport(tail)),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response.vop).toMatchObject({ result: 'closeMatch', suggestedName: 'Jürgen Müller' });
		});

		it('takes a complete report in place of an earlier one', async () => {
			const pending = pain002('PDNG');
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, '3040::Weitere Daten.:TP-1'),
					`HIVPP:5:1:3+++@4@POLL+${REPORT_FORMAT}+@${pending.length}@${pending}'`,
				),
				answer(OK, hirms(3, CHECK_RESULT), hivppReport(pain002('RVNM'))),
			);

			expect((await client.transfer(ACCOUNT, TRANSFER)).vop).toMatchObject({ result: 'noMatch' });
		});

		it('keeps the transaction details of an earlier delivery when the last one has only counts', async () => {
			vopParams().reportDelivery = 'S';
			const before = pain002('RVMC', 'Company A');
			const after = withoutTransactions(pain002('RVMC'), COUNTS('RVMC'));
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, '3040::Weitere Daten.:TP-1'),
					`HIVPP:5:1:3+++@1@P+${REPORT_FORMAT}+@${before.length}@${before}'`,
				),
				answer(OK, hirms(3, CHECK_RESULT), hivppReport(after)),
			);

			expect((await client.transfer(ACCOUNT, TRANSFER)).vop).toMatchObject({
				result: 'closeMatch',
				suggestedName: 'Company A',
			});
		});

		it('keeps the notice and reason lines of the delivery whose details it keeps', async () => {
			vopParams().reportDelivery = 'S';
			const before = pain002('RVMC', 'Company A').replace(
				'</OrgnlGrpInfAndSts>',
				'<StsRsnInf><AddtlInf>RVMC Achtung.</AddtlInf></StsRsnInf></OrgnlGrpInfAndSts>',
			);
			const after = withoutTransactions(pain002('RVMC'), COUNTS('RVMC'));
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, '3040::Weitere Daten.:TP-1'),
					`HIVPP:5:1:3+++@1@P+${REPORT_FORMAT}+@${before.length}@${before}++Hinweis.'`,
				),
				answer(OK, hirms(3, CHECK_RESULT), hivppReport(after)),
			);

			expect((await client.transfer(ACCOUNT, TRANSFER)).vop).toMatchObject({
				result: 'closeMatch',
				suggestedName: 'Company A',
				notice: 'Hinweis.',
				reasons: ['RVMC Achtung.', 'Company A'],
				paymentStatusReport: { groupReasons: ['RVMC Achtung.'] },
			});
		});

		it('checks the payee of an earlier delivery whose details it keeps', async () => {
			vopParams().reportDelivery = 'S';
			const before = pain002('RVMC', 'Company A', 'Erika Musterfrau');
			const after = withoutTransactions(pain002('RVMC'), COUNTS('RVMC'));
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, '3040::Weitere Daten.:TP-1'),
					`HIVPP:5:1:3+++@1@P+${REPORT_FORMAT}+@${before.length}@${before}'`,
				),
				answer(OK, hirms(3, CHECK_RESULT), hivppReport(after)),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({ success: false, requiresVopConfirmation: false });
			expect(response.failureReason).toMatch(/another payee name/);
		});

		it('takes white space after the end of a report as part of it', async () => {
			const report = pain002('RVNM');
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, '3040::Weitere Daten.:TP-1'),
					`HIVPP:5:1:3+++@1@P+${REPORT_FORMAT}+@${report.length}@${report}'`,
				),
				answer(OK, hirms(3, CHECK_RESULT), hivppReport('\r\n')),
			);

			expect(await client.transfer(ACCOUNT, TRANSFER)).toMatchObject({
				requiresVopConfirmation: true,
				vop: { result: 'noMatch' },
			});
		});

		it('does not take an earlier pending transaction for the final match', async () => {
			vopParams().reportDelivery = 'S';
			const before = pain002('PDNG');
			const after = withoutTransactions(pain002('RCVC'), COUNTS('RCVC'));
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, '3040::Weitere Daten.:TP-1'),
					`HIVPP:5:1:3+++@1@P+${REPORT_FORMAT}+@${before.length}@${before}'`,
				),
				answer(OK, hirms(3, CHECK_RESULT), hivppReport(after)),
			);

			expect((await client.transfer(ACCOUNT, TRANSFER)).vop).toMatchObject({ result: 'match' });
		});
	});

	it('reports banking information the dialog initialisation updated', async () => {
		bank.responses.push(
			answer(OK, "HIRMS:3:2:3+0020::Auftrag ausgefuehrt.'", "HIKIM:4:2:3+Notice+Changed.'"),
			answer(OK, hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
		);

		const response = await client.transfer(ACCOUNT, TRANSFER);

		expect(response).toMatchObject({ success: true, requiresTan: true });
		expect(response.bankingInformationUpdated).toBe(true);
	});

	it('reports updated banking information also when only closing the executed transfer failed', async () => {
		bank.responses.push(
			answer(OK, "HIRMS:3:2:3+0020::Auftrag ausgefuehrt.'", "HIKIM:4:2:3+Notice+Changed.'"),
			answer(OK, hirms(4, '0020::Auftrag ausgefuehrt.'), hivppSingle('RCVC')),
			new Error('lost the answer to HKEND'),
		);

		expect(await client.transfer(ACCOUNT, TRANSFER)).toMatchObject({
			success: true,
			bankingInformationUpdated: true,
		});
	});

	it('reads a HIVPP whose binary VoP ID ends in a question mark', async () => {
		bank.responses.push(
			initOk(),
			answer(
				WARNINGS,
				hirms(3, CHECK_RESULT),
				hivppSingle('RVMC', { closeMatchName: 'Herr Meier' }).replace('@6@VOP-01', '@3@AB?'),
			),
		);

		expect((await client.transfer(ACCOUNT, TRANSFER)).vop?.suggestedName).toBe('Herr Meier');
	});

	describe('results for another payee', () => {
		const OTHER_IBAN = 'DE89370400440532013000';

		it('stops at a match for another IBAN instead of asking for the TAN', async () => {
			bank.responses.push(
				initOk(),
				answer(
					OK,
					hirms(5, TAN_REQUIRED),
					hivppSingle('RCVC').replace(PAYEE_IBAN, OTHER_IBAN),
					hitan(),
				),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({
				success: false,
				requiresTan: false,
				requiresVopConfirmation: false,
				outcomeUncertain: false,
			});
			expect(response.failureReason).toMatch(/another IBAN/);
			expect(response.failureReason).not.toContain(OTHER_IBAN);
			expect(sentOrders().at(-1)).toEqual(['HKEND']);
		});

		it('accepts the IBAN of the result in another notation', async () => {
			bank.responses.push(
				initOk(),
				answer(
					OK,
					hirms(5, TAN_REQUIRED),
					hivppSingle('RCVC').replace(PAYEE_IBAN, 'de02 1203 0000 0000 2020 51'),
					hitan(),
				),
			);

			expect(await client.transfer(ACCOUNT, TRANSFER)).toMatchObject({
				success: true,
				requiresTan: true,
			});
		});

		it('stops at a report about a payee name other than the submitted one', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, CHECK_RESULT),
					hivppReport(pain002('RVNM', undefined, 'Erika Musterfrau')),
				),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject({ success: false, requiresVopConfirmation: false });
			expect(response.failureReason).toMatch(/another payee name/);
			expect(response.failureReason).not.toContain('Erika');
		});

		it('accepts the submitted name in other case and spacing', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, CHECK_RESULT),
					hivppReport(pain002('RVNM', undefined, 'MAX  MUSTERMANN')),
				),
			);

			expect(await client.transfer(ACCOUNT, TRANSFER)).toMatchObject({
				success: true,
				requiresVopConfirmation: true,
			});
		});

		it('ends the transfer when 3945 at the TAN step comes with another result', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(3, NO_HKVPA_NEEDED), hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				answer(
					WARNINGS,
					hirms(3, APPROVAL_VOIDED),
					hivppSingle('RVNM').replace('VOP-01', 'VOP-02'),
				),
				endOk(),
			);

			await client.transfer(ACCOUNT, TRANSFER);
			const response = await client.transferWithTan('TAN-REF-1', '123456');

			// The caller decided on the match; the bank voided the approval, so nothing executes
			expect(response).toMatchObject({
				success: false,
				requiresVopConfirmation: false,
				requiresTan: false,
				outcomeUncertain: false,
				vop: { result: 'noMatch', code: 'RVNM' },
			});
			await expect(client.confirmTransfer(response.transferId)).rejects.toThrow();
			expect(sentOrders().filter((segments) => segments.includes('HKCCS'))).toHaveLength(1);
		});

		it('asks for the confirmation again when 3945 at the TAN step comes with the same result', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(3, NO_HKVPA_NEEDED), hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				answer(WARNINGS, hirms(3, APPROVAL_VOIDED), hivppSingle('RCVC')),
			);

			await client.transfer(ACCOUNT, TRANSFER);
			const response = await client.transferWithTan('TAN-REF-1', '123456');

			expect(response).toMatchObject({
				success: true,
				requiresVopConfirmation: true,
				vop: { result: 'match' },
			});

			bank.responses.push(answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')));
			await client.confirmTransfer(response.transferId);

			const hkvpa = bank.sent.at(-1)?.findSegment<HKVPASegment>('HKVPA');
			expect(hkvpa?.vopId).toBe('VOP-01');
		});

		it('stops instead of continuing the approval when a later answer brings a deviation', async () => {
			client.selectTanMethod(946);
			bank.responses.push(
				initOk(),
				answer(OK, hirms(3, NO_HKVPA_NEEDED), hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				answer(
					WARNINGS,
					hirms(3, '3956::Freigabe noch ausstehend.'),
					hivppSingle('RVNM'),
					hitan('TAN-REF-2', 'S'),
				),
				endOk(),
			);

			await client.transfer(ACCOUNT, TRANSFER);
			const response = await client.transferWithTan('TAN-REF-1');

			// The approval the bank still waits for may go through all the same
			expect(response).toMatchObject({
				success: false,
				outcomeUncertain: true,
				requiresTan: false,
				requiresVopConfirmation: false,
				vop: { result: 'noMatch' },
			});
			expect(sentOrders().slice(3)).toEqual([['HKEND']]);
		});

		it('ends the transfer when a later answer replaces the match with no result (notprovided)', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(3, NO_HKVPA_NEEDED), hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				answer(
					WARNINGS,
					hirms(3, APPROVAL_VOIDED, CHECK_RESULT),
					"HIVPP:5:1:3+@11@notprovided++++++Bitte erneut pruefen.'",
				),
				endOk(),
			);

			await client.transfer(ACCOUNT, TRANSFER);
			const response = await client.transferWithTan('TAN-REF-1', '123456');

			expect(response).toMatchObject({
				success: false,
				requiresVopConfirmation: false,
				vop: { result: 'notApplicable', notice: 'Bitte erneut pruefen.' },
			});
			expect(response.vop?.code).toBeUndefined();
		});

		it('does not authorise a later result before its own VoP ID arrives', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(3, NO_HKVPA_NEEDED), hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				answer(WARNINGS, hirms(3, APPROVAL_VOIDED), hivppSingle('RVNM').replace('@6@VOP-01', '')),
				endOk(),
			);

			await client.transfer(ACCOUNT, TRANSFER);
			const response = await client.transferWithTan('TAN-REF-1', '123456');

			expect(response).toMatchObject({ success: false, requiresVopConfirmation: false });
			expect(response.vop).toBeUndefined();
			expect(response.failureReason).toMatch(/without a VoP ID/);
			expect(bank.sent.some((message) => message.findSegment('HKVPA'))).toBe(false);
		});

		it('stops when the result at the TAN step is for another IBAN', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(3, NO_HKVPA_NEEDED), hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				answer(
					WARNINGS,
					hirms(3, APPROVAL_VOIDED),
					hivppSingle('RVNM').replace(PAYEE_IBAN, OTHER_IBAN),
				),
				endOk(),
			);

			await client.transfer(ACCOUNT, TRANSFER);
			const response = await client.transferWithTan('TAN-REF-1', '123456');

			expect(response).toMatchObject({ success: false, requiresVopConfirmation: false });
			expect(response.failureReason).toMatch(/another IBAN/);
		});
	});

	describe('outcome codes', () => {
		const OTHER = 'DE89370400440532013000';
		const RECEIVED = '0010::Auftrag entgegengenommen.';
		const EXECUTED = '0020::Auftrag ausgefuehrt.';
		const PROCESSING = '3070::Auftrag wird unter Referenz R-1 verarbeitet.:R-1';
		const MORE = '3040::Weitere Informationen.:TP-0001';
		const POLL_REJECTED = '9210::Polling-ID ungueltig.';
		const TAN_WRONG = '9941::TAN ungueltig.';
		const NO_SCA = '3076::Keine starke Kundenauthentifizierung notwendig.';
		const matchWithTan = () =>
			answer(OK, hirms(3, NO_HKVPA_NEEDED), hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan());

		type Row = {
			/** The bank's answers after the dialog initialisation */
			answers: Message[];
			/** What the caller does after the first response */
			next?: 'tan' | 'confirm';
			withoutCheck?: true;
			decoupled?: true;
			/** The bank ends the dialog itself, which the library takes 9000 to mean */
			endedByBank?: true;
			expected: {
				success: boolean;
				outcomeUncertain: boolean;
				requiresVopConfirmation?: boolean;
			};
			/** How often HKCCS goes out, once unless given */
			payments?: number;
			reason?: RegExp;
		};

		// Each row is one combination of codes; every terminal outcome leaves nothing to
		// confirm, and an uncertain one says to check the account
		const rows: Record<string, Row> = {
			'0010 to the order while the check is pending is no execution (P3)': {
				answers: [
					answer(
						WARNINGS,
						hirms(3, MORE, '3093::Namensabgleich in Bearbeitung.'),
						hirms(4, RECEIVED),
						hirms(5, '3905::Es wurde keine Challenge erzeugt.'),
						hivppPending(),
					),
					answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
				],
				expected: { success: true, outcomeUncertain: false, requiresVopConfirmation: true },
			},
			'0010 to the order next to a deviation is no execution (P3)': {
				answers: [
					answer(WARNINGS, hirms(3, CHECK_RESULT), hirms(4, RECEIVED), hivppSingle('RVNM')),
				],
				expected: { success: true, outcomeUncertain: false, requiresVopConfirmation: true },
			},
			'9000 to the order (M5)': {
				answers: [answer(OK, hirms(4, '9000::Status indifferent.'))],
				endedByBank: true,
				expected: { success: false, outcomeUncertain: true },
			},
			'0020 to the order next to a failed check (M4)': {
				answers: [
					answer(
						"HIRMG:2:2+9050::Die Nachricht enthaelt Fehler.'",
						hirms(3, '9210::Namensabgleich abgelehnt.'),
						hirms(4, EXECUTED),
					),
				],
				expected: { success: false, outcomeUncertain: true },
			},
			'0020 to the order next to a deviation (M4)': {
				answers: [answer(OK, hirms(4, EXECUTED), hivppSingle('RVNM'))],
				expected: { success: true, outcomeUncertain: false },
			},
			'3091 with 3076: executed without a challenge (E.8.1 rule 2)': {
				answers: [
					answer(WARNINGS, hirms(3, NO_HKVPA_NEEDED), hirms(5, NO_SCA), hivppSingle('RCVC')),
				],
				expected: { success: true, outcomeUncertain: false },
			},
			'3070 to the order next to a match offers no confirmation (M5)': {
				answers: [answer(WARNINGS, hirms(4, PROCESSING), hivppSingle('RCVC'))],
				expected: { success: false, outcomeUncertain: true },
				reason: /R-1/,
			},
			'3070 to the order, then a deviation by polling (M5)': {
				answers: [
					answer(WARNINGS, hirms(3, MORE), hirms(4, PROCESSING), hivppPending()),
					answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
				],
				expected: { success: false, outcomeUncertain: true },
			},
			'3958 to a decoupled approval': {
				decoupled: true,
				answers: [
					answer(OK, hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
					answer(WARNINGS, hirms(4, '3958::Freigabe-Anwendung unterstuetzt das Verfahren nicht.')),
				],
				next: 'tan',
				expected: { success: false, outcomeUncertain: false },
				reason: /3958/,
			},
			'a TAN answered with 3040 alone': {
				answers: [matchWithTan(), answer(WARNINGS, hirms(3, '3040::Weitere Informationen.:MORE'))],
				next: 'tan',
				expected: { success: false, outcomeUncertain: true },
			},
			'3040 alone to an order without check': {
				withoutCheck: true,
				answers: [answer(WARNINGS, hirms(3, '3040::Auftrag nur teilweise ausgefuehrt.:MORE'))],
				expected: { success: false, outcomeUncertain: true },
			},
			'0020 to an order without check': {
				withoutCheck: true,
				answers: [answer(OK, hirms(3, EXECUTED))],
				expected: { success: true, outcomeUncertain: false },
			},
			'R7a: 0010 alone to an order without check is no execution': {
				withoutCheck: true,
				answers: [answer(OK, hirms(3, '0010::Auftrag zur Ausfuehrung vorgemerkt.'))],
				expected: { success: false, outcomeUncertain: true },
				reason: /0010/,
			},
			'R7b: a TAN answered with 0010 to HKVPA and 3905 to HKTAN': {
				answers: [
					answer(OK, hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
					answer(WARNINGS, hirms(3, RECEIVED), hirms(4, '3905::Keine Challenge erzeugt.')),
				],
				next: 'tan',
				expected: { success: false, outcomeUncertain: true },
			},
			'R7c: 0020 to an order without check next to an unexpected result': {
				withoutCheck: true,
				answers: [answer(OK, hirms(3, EXECUTED), hivppSingle('RCVC'))],
				expected: { success: true, outcomeUncertain: false },
			},
			'R7d: 9000 next to a TAN request without HITAN': {
				answers: [answer(WARNINGS, hirms(4, '9000::Status indifferent.'), hirms(5, TAN_REQUIRED))],
				endedByBank: true,
				expected: { success: false, outcomeUncertain: true },
			},
			'R2: 0020 to the order while 3945 voids the approval': {
				answers: [
					answer(WARNINGS, hirms(4, EXECUTED), hirms(5, APPROVAL_VOIDED), hivppSingle('RVNM')),
				],
				expected: { success: false, outcomeUncertain: true },
			},
			'R4: a receipt next to 3945 and a result for another IBAN at the TAN': {
				answers: [
					matchWithTan(),
					answer(
						WARNINGS,
						hirms(3, RECEIVED, APPROVAL_VOIDED),
						hivppSingle('RVNM').replace(PAYEE_IBAN, OTHER),
					),
				],
				next: 'tan',
				expected: { success: false, outcomeUncertain: true },
				reason: /another IBAN/,
			},
			'R6: 0010 to the order, then a failed poll': {
				answers: [
					answer(WARNINGS, hirms(3, MORE), hirms(4, RECEIVED), hivppPending()),
					answer(WARNINGS, hirms(3, POLL_REJECTED)),
				],
				expected: { success: false, outcomeUncertain: true },
			},
			'R6: 3070 to the order, then a failed poll': {
				answers: [
					answer(WARNINGS, hirms(3, MORE), hirms(4, PROCESSING), hivppPending()),
					answer(WARNINGS, hirms(3, POLL_REJECTED)),
				],
				expected: { success: false, outcomeUncertain: true },
			},
			'R6: 0010 to the order, then polling that takes too long': {
				answers: [answer(WARNINGS, hirms(3, MORE), hirms(4, RECEIVED), hivppPending('P', 61))],
				expected: { success: false, outcomeUncertain: true },
				reason: /within 60 seconds/,
			},
			'a failed poll without any receipt': {
				answers: [
					answer(WARNINGS, hirms(3, MORE), hivppPending()),
					answer(WARNINGS, hirms(3, POLL_REJECTED)),
				],
				expected: { success: false, outcomeUncertain: false },
			},
			'an error to the order itself': {
				answers: [answer("HIRMG:2:2+9050::Teilweise fehlerhaft.'", hirms(4, '9210::Abgelehnt.'))],
				expected: { success: false, outcomeUncertain: false },
				reason: /not executed/,
			},
			'0010 to the order, then the confirmed order rejected': {
				answers: [
					answer(WARNINGS, hirms(3, CHECK_RESULT), hirms(4, RECEIVED), hivppSingle('RVNM')),
					answer("HIRMG:2:2+9050::Teilweise fehlerhaft.'", hirms(4, '9210::Abgelehnt.')),
				],
				next: 'confirm',
				payments: 2,
				expected: { success: false, outcomeUncertain: false },
			},
			'an order held after a match (3076), then HKVPA rejected': {
				answers: [
					answer(WARNINGS, hirms(5, NO_SCA), hivppSingle('RCVC')),
					answer("HIRMG:2:2+9050::Teilweise fehlerhaft.'", hirms(3, '9210::Abgelehnt.')),
				],
				next: 'confirm',
				expected: { success: false, outcomeUncertain: true },
			},
			'0010 to the order, then a wrong TAN': {
				answers: [
					answer(
						OK,
						hirms(3, NO_HKVPA_NEEDED),
						hirms(4, RECEIVED),
						hirms(5, TAN_REQUIRED),
						hivppSingle('RCVC'),
						hitan(),
					),
					answer("HIRMG:2:2+9050::Teilweise fehlerhaft.'", hirms(3, TAN_WRONG)),
				],
				next: 'tan',
				expected: { success: false, outcomeUncertain: true },
			},
			'a wrong TAN without any receipt': {
				answers: [
					matchWithTan(),
					answer("HIRMG:2:2+9050::Teilweise fehlerhaft.'", hirms(3, TAN_WRONG)),
				],
				next: 'tan',
				expected: { success: false, outcomeUncertain: false },
			},
		};

		it.each(Object.entries(rows))('%s', async (_name, row) => {
			if (row.withoutCheck) {
				removeTransaction('HKVPP');
			}

			if (row.decoupled) {
				client.selectTanMethod(946);
			}

			bank.responses.push(initOk(), ...row.answers, endOk());
			let response = await client.transfer(ACCOUNT, TRANSFER);

			if (row.next === 'tan') {
				expect(response.requiresTan).toBe(true);
				response = await client.transferWithTan(
					response.tanReference ?? '',
					row.decoupled ? undefined : '123456',
				);
			} else if (row.next === 'confirm') {
				expect(response.requiresVopConfirmation).toBe(true);
				response = await client.confirmTransfer(response.transferId);
			}

			expect(response).toMatchObject({
				requiresVopConfirmation: false,
				requiresTan: false,
				...row.expected,
			});
			expect(sentOrders().filter((segments) => segments.includes('HKCCS'))).toHaveLength(
				row.payments ?? 1,
			);

			if (row.reason) {
				expect(response.failureReason).toMatch(row.reason);
			}

			if (row.expected.outcomeUncertain) {
				expect(response.failureReason).toMatch(/Check the account/);
				expect(response.failureReason).not.toMatch(/rejected|not executed/);
			}

			if (!row.expected.requiresVopConfirmation) {
				const sent = bank.sent.length;
				await expect(client.confirmTransfer(response.transferId)).rejects.toThrow();
				expect(bank.sent).toHaveLength(sent);

				if (!row.endedByBank) {
					expect(sentOrders().at(-1)).toEqual(['HKEND']);
				}
			}
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

		it('sends the payment from the account as they were when the transfer was called', async () => {
			removeTransaction('HKVPP');
			config.bankingInformation.upd?.bankAccounts[1].allowedTransactions?.push({
				transId: 'HKCCS',
				numSignatures: 1,
			});
			const account = structuredClone(config.bankingInformation.upd?.bankAccounts[0]);
			const form = { ...TRANSFER };
			bank.responses.push(initOk(), answer(OK, hirms(3, '0020::Auftrag ausgefuehrt.')), endOk());

			if (!account) throw new Error('no account');
			const started = client.transfer(account, form);
			// Changed while the login is still under way
			form.amount = 100;
			form.iban = 'DE02100100100006820101';
			form.name = 'Someone Else';
			account.accountNumber = '9876543210';

			expect((await started).success).toBe(true);
			const xml = bank.sent[1].findSegment<HKCCSSegment>('HKCCS')?.sepaPainMessage ?? '';
			expect({
				amount: xml.match(/<InstdAmt[^>]*>([^<]+)/)?.[1],
				payee: xml.match(/<CdtrAcct><Id><IBAN>([^<]+)/)?.[1],
				name: xml.match(/<Cdtr><Nm>([^<]+)/)?.[1],
				debtor: xml.match(/<DbtrAcct><Id><IBAN>([^<]+)/)?.[1],
			}).toEqual({
				amount: '42.50',
				payee: TRANSFER.iban,
				name: TRANSFER.name,
				debtor: 'DE89370400440532013000',
			});
		});

		it('sends no order when the TAN method the HKTAN needs is gone after the login', async () => {
			atInitialisation(() => {
				config.tanMethodId = undefined;
			});
			bank.responses.push(initOk(), endOk());

			await expect(client.transfer(ACCOUNT, TRANSFER)).rejects.toThrow(/no TAN method/);
			expect(sentOrders()).toEqual([['HKIDN', 'HKVVB', 'HKTAN'], ['HKEND']]);
		});

		it('confirms no order without a TAN method that can send its HKTAN', async () => {
			bank.responses.push(initOk(), answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')));
			const response = await client.transfer(ACCOUNT, TRANSFER);
			config.tanMethodId = undefined;
			bank.responses.push(endOk());

			await expect(client.confirmTransfer(response.transferId)).rejects.toThrow(/TAN method/);
			expect(sentOrders().filter((segments) => segments.includes('HKCCS'))).toHaveLength(1);
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

	describe('the README example', () => {
		/** The transfer example of the README, run as it stands, without its type assertions */
		const example = (() => {
			const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
			const section = readme.slice(readme.indexOf('### SEPA credit transfers'));
			const code = /```typescript\n([\s\S]*?)```/.exec(section)?.[1] ?? '';
			return code.replace(/(\w)!(?=[.,);])/g, '$1');
		})();
		const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

		const runExample = async (answers: string[]) => {
			const printed: string[] = [];
			const questions: string[] = [];
			const rl = {
				question: async (question: string) => {
					questions.push(question);
					return answers.shift() ?? '';
				},
			};
			const log = { log: (...values: unknown[]) => printed.push(values.map(String).join(' ')) };
			await new AsyncFunction('client', 'account', 'rl', 'console', example)(
				client,
				ACCOUNT,
				rl,
				log,
			);
			return { printed, questions };
		};

		it('asks for the decision the bank wants after the TAN (3945) before reporting acceptance', async () => {
			bank.responses.push(
				initOk(),
				answer(OK, hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				answer(WARNINGS, hirms(3, APPROVAL_VOIDED)),
				answer(OK, hirms(5, TAN_REQUIRED), hitan('TAN-REF-2')),
				tanAccepted(),
				endOk(),
			);

			const { printed, questions } = await runExample(['123456', 'yes', '654321']);

			expect(questions).toHaveLength(3);
			expect(questions[1]).toMatch(/anyway/);
			expect(printed).toContain('Bei Abweichungen haftet die Bank nicht.');
			expect(printed.at(-1)).toBe('The bank accepted the transfer INVOICE-2026-001');
		});

		it('shows the notice of the report and asks after a TAN for the login, then cancels', async () => {
			// The example's own end-to-end reference
			const report = pain002('RVNM')
				.replace('E2E-0001', 'INVOICE-2026-001')
				.replace(
					'</OrgnlGrpInfAndSts>',
					'<GrpSts>RVCM</GrpSts><StsRsnInf><AddtlInf>RVNM Bei Abweichungen haftet die Bank nicht.</AddtlInf></StsRsnInf></OrgnlGrpInfAndSts>',
				);
			bank.responses.push(
				answer(OK, "HIRMS:3:2:5+0030::Sicherheitsfreigabe erforderlich.'", hitan('INIT-REF')),
				initOk(),
				answer(WARNINGS, hirms(3, CHECK_RESULT), hivppReport(report)),
				endOk(),
			);

			const { printed, questions } = await runExample(['111111', 'no']);

			expect(questions).toHaveLength(2);
			expect(questions[1]).toMatch(/anyway/);
			expect(printed).toContain('Verification of Payee: noMatch');
			expect(printed).toContain('Bei Abweichungen haftet die Bank nicht.');
			expect(printed.join('\n')).not.toMatch(/accepted/);
			expect(sentOrders().at(-1)).toEqual(['HKEND']);
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

			it('keeps the outstanding challenge apart from the response the caller may change', async () => {
				bank.responses.push(
					initOk(),
					answer(WARNINGS, hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				);
				const response = await client.transfer(ACCOUNT, TRANSFER);
				response.tanReference = 'OTHER';

				await expect(client.transferWithTan('OTHER', '123456')).rejects.toThrow(
					/does not belong to the challenge/,
				);
				expect(bank.sent).toHaveLength(2);

				bank.responses.push(tanAccepted(), endOk());
				expect(await client.transferWithTan('TAN-REF-1', '123456')).toMatchObject({
					success: true,
				});
			});

			it('offers no TAN step a changed response asks for after a deviation', async () => {
				bank.responses.push(
					initOk(),
					answer(
						WARNINGS,
						hirms(3, CHECK_RESULT),
						hirms(5, TAN_REQUIRED),
						hitan(),
						hivppSingle('RVNM'),
					),
				);
				const response = await client.transfer(ACCOUNT, TRANSFER);
				expect(response.requiresVopConfirmation).toBe(true);
				Object.assign(response, { requiresTan: true, tanReference: 'TAN-REF-1' });

				await expect(client.transferWithTan('TAN-REF-1', '123456')).rejects.toThrow(
					/no transfer is waiting for a TAN/,
				);
				expect(bank.sent).toHaveLength(2);
			});

			it('keeps the challenge of the login apart from the response the caller may change', async () => {
				bank.responses.push(
					answer(OK, "HIRMS:3:2:5+0030::Sicherheitsfreigabe erforderlich.'", hitan('INIT-REF')),
				);
				const response = await client.transfer(ACCOUNT, TRANSFER);
				response.tanReference = 'OTHER';

				await expect(client.transferWithTan('OTHER', '111111')).rejects.toThrow(
					/does not belong to the challenge/,
				);
				expect(bank.sent).toHaveLength(1);

				bank.responses.push(
					initOk(),
					answer(WARNINGS, hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				);
				expect(await client.transferWithTan('INIT-REF', '111111')).toMatchObject({
					requiresTan: true,
					tanReference: 'TAN-REF-1',
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
