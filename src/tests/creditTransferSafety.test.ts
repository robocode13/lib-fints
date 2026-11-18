import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinTSClient } from '../client.js';
import { FinTSConfig } from '../config.js';
import { Message } from '../message.js';
import { HNHBK, type HNHBKSegment } from '../segments/HNHBK.js';
import {
	ACCOUNT,
	APPROVAL_VOIDED,
	answer,
	bank,
	CHECK_RESULT,
	createBankingInformation,
	DIALOG_ID,
	endOk,
	hirms,
	hitan,
	hivppPending,
	hivppSingle,
	initOk,
	NO_HKVPA_NEEDED,
	OK,
	sentOrders,
	TAN_REQUIRED,
	TRANSFER,
	WARNINGS,
} from './creditTransferBank.js';

vi.mock('../httpClient.js', async () => ({
	HttpClient: (await import('./creditTransferBank.js')).MockHttpClient,
}));

/**
 * What a transfer must never do whatever the bank answers: send its payment again while
 * the bank may execute the first one, count an answer to another segment as the payment's,
 * or call a payment not executed that the bank may have executed. Each case asserts what
 * matters for the money: how many orders went out, `success` and `outcomeUncertain`.
 */
describe('FinTSClient SEPA credit transfer safety', () => {
	let config: FinTSConfig;
	let client: FinTSClient;

	const EXECUTED = '0020::Auftrag ausgefuehrt.';
	const RECEIVED = '0010::Auftrag entgegengenommen.';
	const NO_SCA = '3076::Keine starke Kundenauthentifizierung notwendig.';
	const MORE = '3040::Weitere Daten folgen.:TP-1';
	const DECOUPLED = '3955::Bitte bestaetigen Sie den Auftrag in Ihrer App.';
	const UNCERTAIN = {
		success: false,
		requiresTan: false,
		requiresVopConfirmation: false,
		outcomeUncertain: true,
	};
	const payments = () => sentOrders().filter((segments) => segments.includes('HKCCS')).length;
	/** A match that needs only the TAN (3091), with a challenge for the order */
	const matchWithTan = () =>
		answer(OK, hirms(3, NO_HKVPA_NEEDED), hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan());

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
		vi.spyOn(
			FinTSClient.prototype as unknown as { sleep: (milliseconds: number) => Promise<void> },
			'sleep',
		).mockResolvedValue();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('the payment goes out once', () => {
		it('ends uncertain when the waiver pair comes with a voided approval', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(3, NO_HKVPA_NEEDED),
					hirms(5, NO_SCA, APPROVAL_VOIDED),
					hivppSingle('RCVC'),
				),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject(UNCERTAIN);
			await expect(client.confirmTransfer(response.transferId)).rejects.toThrow();
			expect(payments()).toBe(1);
		});

		it('offers no confirmation once the waiver pair has arrived over a poll', async () => {
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(3, MORE), hivppPending()),
				answer(WARNINGS, hirms(3, NO_HKVPA_NEEDED), hirms(3, NO_SCA), hivppSingle('RCVC')),
				endOk(),
			);

			expect(await client.transfer(ACCOUNT, TRANSFER)).toMatchObject(UNCERTAIN);
			expect(payments()).toBe(1);
		});

		it('offers no confirmation once the waiver pair is split over a pending check', async () => {
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(3, MORE), hirms(5, NO_SCA), hivppPending()),
				answer(OK, hirms(3, NO_HKVPA_NEEDED), hivppSingle('RCVC')),
				endOk(),
			);

			expect(await client.transfer(ACCOUNT, TRANSFER)).toMatchObject(UNCERTAIN);
			expect(payments()).toBe(1);
		});

		it('offers no confirmation while a decoupled approval of the order is open', async () => {
			client.selectTanMethod(946);
			bank.responses.push(
				initOk(),
				answer(OK, hirms(5, DECOUPLED), hitan(), hivppSingle('RVNM')),
				endOk(),
			);

			expect(await client.transfer(ACCOUNT, TRANSFER)).toMatchObject(UNCERTAIN);
			expect(payments()).toBe(1);
		});

		it('sends no third order after the bank received the confirmed one', async () => {
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(5, APPROVAL_VOIDED), hivppSingle('RVNM')),
				answer(WARNINGS, hirms(4, RECEIVED), hivppSingle('RVNM').replace('VOP-01', 'VOP-02')),
				endOk(),
			);
			const first = await client.transfer(ACCOUNT, TRANSFER);

			const confirmed = await client.confirmTransfer(first.transferId);

			expect(confirmed).toMatchObject(UNCERTAIN);
			await expect(client.confirmTransfer(confirmed.transferId)).rejects.toThrow();
			expect(payments()).toBe(2);
		});

		it('refuses to repeat the order, on any path, such as for a parted answer', async () => {
			// The dialog repeats a message for the rest of a parted answer (3040); the order in
			// it would go out again
			const parted = Message.decode(
				`HNHBK:1:3+000000000000+300+${DIALOG_ID}+2'${WARNINGS}${hirms(3, MORE)}${hivppPending()}`,
				'HIVPP',
			);
			bank.responses.push(initOk(), parted, endOk());

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject(UNCERTAIN);
			expect(payments()).toBe(1);
			expect(sentOrders().at(-1)).toEqual(['HKEND']);
			// The refused message took no message number: HKEND follows the transfer as message 3
			expect(bank.sent).toHaveLength(3);
			expect(bank.sent.at(-1)?.findSegment<HNHBKSegment>(HNHBK.Id)?.msgNr).toBe(3);
		});

		it('reads a TAN answer against the message it references', async () => {
			// The final answer references the first transfer message, whose HKCCS is segment 4
			const executedOriginal = Message.decode(
				`HNHBK:1:3+000000000000+300+${DIALOG_ID}+3+${DIALOG_ID}:2'${OK}${hirms(4, EXECUTED)}`,
			);
			bank.responses.push(initOk(), matchWithTan(), executedOriginal, endOk());
			await client.transfer(ACCOUNT, TRANSFER);

			const response = await client.transferWithTan('TAN-REF-1', '123456');

			expect(sentOrders()[2]).toEqual(['HKTAN']);
			expect(response).toMatchObject({ success: true, outcomeUncertain: false });
			expect(payments()).toBe(1);
		});
	});

	describe('evidence before branching', () => {
		it.each([
			['an error to the check', [hirms(3, NO_HKVPA_NEEDED, '9210::Abgelehnt.'), hirms(5, NO_SCA)]],
			[
				'a TAN challenge',
				[hirms(3, NO_HKVPA_NEEDED), hirms(5, NO_SCA, TAN_REQUIRED), hivppSingle('RCVC'), hitan()],
			],
			[
				'an unfinished check',
				[
					hirms(3, NO_HKVPA_NEEDED, MORE, '3093::Pruefung laeuft.'),
					hirms(5, NO_SCA),
					hivppPending(),
				],
			],
		])('ends uncertain on the waiver pair with %s', async (_title, segments) => {
			bank.responses.push(initOk(), answer(WARNINGS, ...segments), endOk());

			expect(await client.transfer(ACCOUNT, TRANSFER)).toMatchObject(UNCERTAIN);
			expect(payments()).toBe(1);
		});

		it('takes no acknowledgment of a poll for the payment', async () => {
			const hkvpp = config.bankingInformation.bpd?.allowedTransactions.find(
				(transaction) => transaction.transId === 'HKVPP',
			);
			if (hkvpp) hkvpp.tanRequired = true;
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(3, MORE), hivppPending()),
				// 0020 to the HKTAN of the poll, segment 4
				answer(OK, hirms(4, EXECUTED), hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(sentOrders()[2]).toEqual(['HKVPP', 'HKTAN']);
			expect(response).toMatchObject({
				success: true,
				requiresVopConfirmation: true,
				vop: { result: 'noMatch' },
			});
		});

		it('ends uncertain on an acknowledged HKVPA whose required approval failed', async () => {
			client.selectTanMethod(946);
			bank.responses.push(
				initOk(),
				answer(OK, hirms(5, TAN_REQUIRED), hivppSingle('RCVC'), hitan()),
				answer(WARNINGS, hirms(3, EXECUTED), hirms(4, '3958::Freigabe nicht unterstuetzt.')),
				endOk(),
			);
			await client.transfer(ACCOUNT, TRANSFER);

			const response = await client.transferWithTan('TAN-REF-1');

			expect(sentOrders()[2]).toEqual(['HKVPA', 'HKTAN']);
			expect(response).toMatchObject(UNCERTAIN);
		});
	});

	describe('a decision binds to its result', () => {
		it('is not undone by a change to the returned result', async () => {
			client.selectTanMethod(946);
			bank.responses.push(
				initOk(),
				matchWithTan(),
				answer(
					OK,
					hirms(3, '3956::Freigabe noch ausstehend.'),
					hivppSingle('RVNM'),
					hitan('TAN-REF-2', 'S'),
				),
				endOk(),
			);
			const first = await client.transfer(ACCOUNT, TRANSFER);
			if (first.vop) first.vop.code = 'RVNM';

			const response = await client.transferWithTan('TAN-REF-1');

			// The approval the bank still waits for may go through all the same
			expect(response).toMatchObject({ ...UNCERTAIN, vop: { code: 'RVNM' } });
			expect(sentOrders().filter((segments) => segments.join() === 'HKTAN')).toHaveLength(1);
		});

		it('ends the transfer on a changed payee name under the same VoP ID and code', async () => {
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(5, APPROVAL_VOIDED),
					hivppSingle('RVMC', { closeMatchName: 'Company A' }),
				),
				answer(
					OK,
					hirms(5, TAN_REQUIRED),
					hivppSingle('RVMC', { closeMatchName: 'Company B' }),
					hitan(),
				),
				endOk(),
			);
			const first = await client.transfer(ACCOUNT, TRANSFER);

			const later = await client.confirmTransfer(first.transferId);

			expect(later).toMatchObject({
				success: false,
				requiresTan: false,
				requiresVopConfirmation: false,
				vop: { suggestedName: 'Company B' },
			});
			expect(payments()).toBe(2);
		});

		it('ends the transfer on a later result, so a late confirmation authorises nothing', async () => {
			// The reviewer expected a new prompt for the later result; it ends the transfer
			// instead, which leaves no stale confirmation that could authorise it
			bank.responses.push(
				initOk(),
				answer(
					WARNINGS,
					hirms(5, APPROVAL_VOIDED),
					hivppSingle('RVMC', { closeMatchName: 'Company A' }),
				),
				answer(
					WARNINGS,
					hirms(5, APPROVAL_VOIDED),
					hivppSingle('RVNM').replace('VOP-01', 'VOP-02'),
				),
				answer(OK, hirms(4, EXECUTED)),
				endOk(),
			);
			const old = await client.transfer(ACCOUNT, TRANSFER);

			const newer = await client.confirmTransfer(old.transferId);

			// The bank voided the approval of the order it holds (3945): nothing can execute
			expect(newer).toMatchObject({
				success: false,
				requiresVopConfirmation: false,
				outcomeUncertain: false,
				vop: { result: 'noMatch' },
			});
			await expect(client.confirmTransfer(old.transferId)).rejects.toThrow();
			expect(payments()).toBe(2);
		});
	});

	describe('errors that allow an earlier execution', () => {
		it('ends uncertain on a duplicate after the bank received the order', async () => {
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(3, CHECK_RESULT), hirms(4, RECEIVED), hivppSingle('RVNM')),
				answer(WARNINGS, hirms(4, '9390::Doppeleinreichung.')),
				endOk(),
			);
			const first = await client.transfer(ACCOUNT, TRANSFER);

			expect(await client.confirmTransfer(first.transferId)).toMatchObject(UNCERTAIN);
			expect(payments()).toBe(2);
		});

		it('ends uncertain when the bank says the order may have been executed already', async () => {
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(3, CHECK_RESULT), hivppSingle('RVNM')),
				answer(WARNINGS, hirms(3, '9210::Auftrag existiert nicht bzw. wurde bereits ausgefuehrt.')),
				endOk(),
			);
			const first = await client.transfer(ACCOUNT, TRANSFER);

			expect(await client.confirmTransfer(first.transferId)).toMatchObject(UNCERTAIN);
		});

		it('ends uncertain when a status query fails while the approval is open', async () => {
			client.selectTanMethod(946);
			bank.responses.push(
				initOk(),
				answer(
					OK,
					hirms(4, TAN_REQUIRED),
					hirms(5, DECOUPLED),
					hirms(3, NO_HKVPA_NEEDED),
					hitan(),
					hivppSingle('RCVC'),
				),
				answer(WARNINGS, hirms(3, '9210::Referenz der Statusabfrage unbekannt.')),
				endOk(),
			);
			await client.transfer(ACCOUNT, TRANSFER);

			expect(await client.transferWithTan('TAN-REF-1')).toMatchObject(UNCERTAIN);
		});

		it('answers with the uncertainty when a poll after the receipt gets no answer', async () => {
			bank.responses.push(
				initOk(),
				answer(WARNINGS, hirms(4, RECEIVED), hirms(3, MORE), hivppPending()),
				new Error('connection lost'),
				endOk(),
			);

			const response = await client.transfer(ACCOUNT, TRANSFER);

			expect(response).toMatchObject(UNCERTAIN);
			expect(response.bankAnswers.map((bankAnswer) => bankAnswer.code)).toContain(10);
			expect(sentOrders().at(-1)).toEqual(['HKEND']);
		});
	});
});
