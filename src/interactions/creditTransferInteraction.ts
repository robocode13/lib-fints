import { randomBytes } from 'node:crypto';
import type { FinTSConfig } from '../config.js';
import type { InternationalAccount } from '../dataGroups/InternationalAccount.js';
import type { Message } from '../message.js';
import type { Pain001Message } from '../pain001Builder.js';
import { type PaymentStatusReport, parsePain002 } from '../pain002Parser.js';
import type { Segment } from '../segment.js';
import type { Answer } from '../segments/HIRMG.js';
import { HIRMS, type HIRMSSegment } from '../segments/HIRMS.js';
import { HIVPP, type HIVPPSegment } from '../segments/HIVPP.js';
import { HKCCS, type HKCCSSegment } from '../segments/HKCCS.js';
import { HKVPA, type HKVPASegment } from '../segments/HKVPA.js';
import { HKVPP, type HKVPPSegment } from '../segments/HKVPP.js';
import { HNHBK, type HNHBKSegment } from '../segments/HNHBK.js';
import { type ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';

/**
 * The ISO 20022 codes of a Verification of Payee result
 */
export type VopResultCode = 'RCVC' | 'RVMC' | 'RVNM' | 'RVNA';

/**
 * The result of a Verification of Payee check of the payee's name against the IBAN
 */
export interface VopResult {
	/**
	 * match: the name matches; closeMatch: it almost matches, see suggestedName;
	 * noMatch: it does not match; notApplicable: the check was not possible
	 */
	result: 'match' | 'closeMatch' | 'noMatch' | 'notApplicable';
	/** The code the bank reported; absent when the bank delivered no result at all */
	code?: VopResultCode;
	/** The payee IBAN the result is for */
	iban?: string;
	/** For a close match: the name the payee's bank holds for the account */
	suggestedName?: string;
	/** For notApplicable: why the check was not possible, when the bank says */
	notApplicableReason?: string;
	/**
	 * The bank's explanation of what authorising despite a deviation means. The DK
	 * specification requires showing it to the customer before they confirm.
	 */
	notice?: string;
	/** Whether the notice may contain formatting tags such as <br> or <b> (HIVPPS) */
	noticeStructured: boolean;
	/** All additional information lines of the payment status report */
	reasons: string[];
	/** The pain.002 report, when the bank sent one */
	paymentStatusReport?: PaymentStatusReport;
}

/**
 * The response to a SEPA credit transfer step. The transfer is done only when
 * `success` is true and neither `requiresTan` nor `requiresVopConfirmation` is.
 * @property requiresVopConfirmation the bank checked the payee and waits for the
 * caller's decision: `FinTSClient.confirmTransfer()` authorises the transfer despite
 * the result in `vop`, `FinTSClient.cancelTransfer()` drops it
 * @property vop the result of the Verification of Payee check, once known
 * @property transferId an opaque reference of this transfer, the same on every response to
 * it; `FinTSClient.confirmTransfer()` and `FinTSClient.cancelTransfer()` take it, so that a
 * decision about one transfer cannot act on another
 * @property endToEndId the end-to-end reference the transfer carries
 * @property failureReason why the transfer stopped, when `success` is false and the
 * bank answers alone do not say
 * @property outcomeUncertain the transfer stopped (`success` is false) without the bank
 * saying whether it executed the order, such as with code 9000 or an executed order next
 * to an error: the bank may have executed it. Check the account before sending it again.
 */
export interface TransferResponse extends ClientResponse {
	requiresVopConfirmation: boolean;
	vop?: VopResult;
	transferId: string;
	endToEndId: string;
	failureReason?: string;
	outcomeUncertain: boolean;
}

/**
 * What the bank's parameters say about Verification of Payee for HKCCS
 */
export type VopParameters = {
	/** The pain.002 formats to ask for, as HIVPPS lists them */
	reportFormats: string[];
	noticeStructured: boolean;
	hkvppVersion: number;
	hkvpaVersion: number;
};

/**
 * The order as built from the banking information: the account, the pain.001 and what
 * the bank's parameters say about HKCCS and Verification of Payee
 */
export type PreparedTransfer = {
	account: InternationalAccount;
	pain: Pain001Message;
	hkccsVersion: number;
	/** Absent when the bank does not require Verification of Payee for HKCCS */
	vopParameters?: VopParameters;
};

export type TransferStatus =
	| 'pending'
	| 'polling'
	| 'awaitingConfirmation'
	| 'awaitingTan'
	| 'accepted'
	| 'failed';

const VOP_RESULTS: Record<VopResultCode, VopResult['result']> = {
	RCVC: 'match',
	RVMC: 'closeMatch',
	RVNM: 'noMatch',
	RVNA: 'notApplicable',
};

const CHECK_ACCOUNT = 'Check bankAnswers and the account before retrying.';

const OUTCOME_UNCERTAIN =
	'The bank did not confirm the outcome of the transfer and may have executed it. Check the account before sending the transfer again.';

/** The codes with which the bank accepts an order: 0010 received, 0020 executed */
const ACCEPTED = [10, 20];

/** The codes that say the bank is not done with the order: 3040 more to come, 3093 the
 * name check is still running */
const PENDING = [3040, 3093];

/** The return codes about a Verification of Payee: 3090 check the result, 3091 no HKVPA
 * needed, 3093 the check is still running */
const VOP_CODES = [3090, 3091, 3093];

/**
 * The state of one credit transfer across the messages of its dialog: the order, built
 * when it is created (to check the input before anything is sent) and built again from
 * the banking information as the dialog initialisation left it, right before it is first
 * sent; and what the bank has said about it so far.
 */
export class CreditTransferOrder {
	/** The opaque reference of this transfer for the caller (TransferResponse.transferId) */
	readonly transferId = randomBytes(16).toString('hex');
	status: TransferStatus = 'pending';
	vopId?: string;
	pollingId?: string;
	touchdownPoint?: string;
	waitSeconds?: number;
	vopResult?: VopResult;
	/** Whether the caller has confirmed the VoP result with `confirmTransfer()` */
	confirmed = false;
	/** Whether HKVPA goes with the next TAN message (a match without code 3091) */
	sendVopAuthorizationWithTan = false;
	/**
	 * Whether the bank holds the order after a match and waived the strong authentication
	 * (3076 without 3091): the confirmation is HKVPA alone, without the order or HKTAN
	 * (DK VoP specification E.8.1, figure 3)
	 */
	authorizationOnly = false;
	/**
	 * The reference under which the bank processes the order (3070 to HKCCS), possibly
	 * empty; once set, nothing is offered that would send the order again
	 */
	processingReference?: string;
	/** The response of the latest message this order's interactions handled */
	lastResponse?: TransferResponse;
	/** The latest HIVPP that carried a result, for a final HIVPP that carries only the VoP ID */
	private resultSegment?: HIVPPSegment;
	private prepared: PreparedTransfer;

	/**
	 * @param build builds the order from the banking information as it is at the time of
	 * the call; throws when the account, the bank or the input does not allow the transfer
	 */
	constructor(private readonly build: () => PreparedTransfer) {
		this.prepared = build();
	}

	get account(): InternationalAccount {
		return this.prepared.account;
	}

	get pain(): Pain001Message {
		return this.prepared.pain;
	}

	get hkccsVersion(): number {
		return this.prepared.hkccsVersion;
	}

	get vopParameters(): VopParameters | undefined {
		return this.prepared.vopParameters;
	}

	/**
	 * Builds the order again from the banking information as it is now. Called right
	 * before the order is first sent, after the dialog initialisation, which may have
	 * brought new bank or account parameters; every later message reuses this order.
	 */
	prepare(): void {
		this.prepared = this.build();
	}

	createHkccs(): HKCCSSegment {
		return {
			header: { segId: HKCCS.Id, segNr: 0, version: this.hkccsVersion },
			account: this.account,
			sepaDescriptor: this.pain.descriptor,
			sepaPainMessage: this.pain.bytes,
		};
	}

	createHkvpa(): HKVPASegment {
		if (!this.vopParameters || this.vopId === undefined) {
			throw new Error('cannot authorise a transfer without a VoP ID');
		}

		return {
			header: { segId: HKVPA.Id, segNr: 0, version: this.vopParameters.hkvpaVersion },
			vopId: this.vopId,
		};
	}

	createHkvpp(): HKVPPSegment {
		if (!this.vopParameters) {
			throw new Error('cannot check the payee when the bank does not require it');
		}

		return {
			header: { segId: HKVPP.Id, segNr: 0, version: this.vopParameters.hkvppVersion },
			supportedReports: this.vopParameters.reportFormats,
			pollingId: this.pollingId,
			touchdownPoint: this.touchdownPoint,
		};
	}

	/**
	 * Takes over what a HIVPP says about polling: the touchdown point comes with code
	 * 3040, and the wait time is read from every response anew.
	 */
	track(message: Message, hivpp: HIVPPSegment) {
		const touchdownPoint = message.getBankAnswers().find((answer) => answer.code === 3040)
			?.params?.[0];

		if (touchdownPoint) {
			this.touchdownPoint = touchdownPoint;
		}

		if (hivpp.pollingId) {
			this.pollingId = hivpp.pollingId;
		}

		this.waitSeconds = hivpp.waitSeconds;

		if (hivpp.paymentStatusReport || hivpp.singleResult) {
			this.resultSegment = hivpp;
		}
	}

	/**
	 * Reads the result from the final HIVPP, or from the latest one that carried a
	 * result when the final one carries only the VoP ID
	 * @returns the result, or why it cannot be trusted
	 */
	readResult(final: HIVPPSegment): VopResult | string {
		const source = final.paymentStatusReport || final.singleResult ? final : this.resultSegment;
		let result: VopResult;

		try {
			result = extractVopResult(
				source ?? final,
				final.notice ?? source?.notice,
				this.vopParameters?.noticeStructured ?? false,
			);
		} catch (error) {
			return `${(error as Error).message}. The transfer was not executed.`;
		}

		return this.checkPayee(result) ?? result;
	}

	/**
	 * Takes over a result the bank sends with a later answer, such as with 3945 to the TAN,
	 * in place of the earlier one
	 * @returns why the result cannot be trusted, if it cannot
	 */
	takeNewerResult(hivpp: HIVPPSegment | undefined): string | undefined {
		if (!hivpp || (!hivpp.paymentStatusReport && !hivpp.singleResult)) {
			return undefined;
		}

		const result = this.readResult(hivpp);

		if (typeof result === 'string') {
			return result;
		}

		this.resultSegment = hivpp;
		this.vopResult = result;

		if (hivpp.vopId !== undefined) {
			this.vopId = hivpp.vopId;
		}

		return undefined;
	}

	/**
	 * A result counts only for the payee of this order: the IBAN it names, and the payee
	 * name a pain.002 repeats from the order, must be the submitted ones
	 * @returns why the result is not about this order, if it is not
	 */
	private checkPayee(result: VopResult): string | undefined {
		const transactions = result.paymentStatusReport?.transactions ?? [];
		const ibans = [result.iban, ...transactions.map((t) => t.creditorIban)].filter(
			(iban): iban is string => !!iban,
		);

		if (ibans.some((iban) => iban.replace(/\s+/g, '').toUpperCase() !== this.pain.creditorIban)) {
			return 'The Verification of Payee result is for another IBAN than the transfer. The transfer was not executed.';
		}

		const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
		const names = transactions.map((t) => t.creditorName).filter((name): name is string => !!name);

		if (names.some((name) => normalizeName(name) !== normalizeName(this.pain.creditorName))) {
			return 'The Verification of Payee result is for another payee name than the transfer. The transfer was not executed.';
		}

		return undefined;
	}
}

/**
 * Reads a Verification of Payee result from a HIVPP, from its single result, its
 * pain.002 report, or both. When both are present and disagree, the one that is not
 * a match wins: the caller then has to decide, which is the safe side.
 * @throws Error when a code is not one of RCVC, RVMC, RVNM and RVNA (PDNG included:
 * a pending check with a VoP ID is a contradiction) or the report cannot be read
 */
export function extractVopResult(
	hivpp: HIVPPSegment,
	notice: string | undefined,
	noticeStructured: boolean,
): VopResult {
	const report = hivpp.paymentStatusReport
		? parsePain002(decodeReport(hivpp.paymentStatusReport))
		: undefined;
	const single = hivpp.singleResult;

	// From the most specific level to the least; for one transfer there is one transaction
	const reportCodes = report
		? [
				...report.transactions.map((transaction) => transaction.status),
				report.paymentInfoStatus,
				report.groupStatus,
			].filter((code): code is string => !!code)
		: [];
	const codes = [single?.result, ...reportCodes].filter((code): code is string => !!code);

	for (const code of codes) {
		if (!(code in VOP_RESULTS)) {
			throw new Error(`The bank reported the unknown Verification of Payee result '${code}'`);
		}
	}

	const code = codes.length
		? ((codes.find((c) => c !== 'RCVC') ?? 'RCVC') as VopResultCode)
		: undefined;
	const transaction =
		report?.transactions.find((t) => t.status === code) ?? report?.transactions[0];

	return {
		// The DK specification allows a HIVPP without a result where none can exist
		// ("notprovided" as the VoP ID); the caller still has to decide
		result: code ? VOP_RESULTS[code] : 'notApplicable',
		code,
		iban: single?.iban ?? transaction?.creditorIban,
		// In a pain.002 the payee bank's name for a close match is the transaction's
		// status reason line (DFÜ-Abkommen Anlage 3, as hbci4java reads it too)
		suggestedName:
			single?.closeMatchName ?? (code === 'RVMC' ? transaction?.reasons[0] : undefined),
		notApplicableReason: single?.notApplicableReason,
		notice,
		noticeStructured,
		reasons: report
			? [
					...report.groupReasons,
					...report.paymentInfoReasons,
					...report.transactions.flatMap((t) => t.reasons),
				]
			: [],
		paymentStatusReport: report,
	};
}

/**
 * The pain.002 arrives as bytes, one character per byte. It is UTF-8 unless its XML
 * declaration says otherwise; ISO-8859-1 is then read as it stands.
 */
function decodeReport(bytes: string): string {
	const encoding = /^<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(bytes)?.[1];

	if (encoding && !/^utf-?8$/i.test(encoding)) {
		return bytes;
	}

	return Buffer.from(bytes, 'latin1').toString('utf8').replace(/^﻿/, '');
}

/**
 * The first HIVPP that carries a VoP ID, or the first one at all
 */
function findHivpp(message: Message): HIVPPSegment | undefined {
	const segments = message.findAllSegments<HIVPPSegment>(HIVPP.Id);
	return segments.find((segment) => segment.vopId !== undefined) ?? segments[0];
}

function withoutTan(response: ClientResponse): ClientResponse {
	const {
		tanReference: _reference,
		tanChallenge: _challenge,
		tanPhoto: _photo,
		tanChallengeHhdUc: _hhdUc,
		tanMediaName: _media,
		...rest
	} = response;
	return { ...rest, requiresTan: false };
}

/**
 * What the transfer interactions share: the order state, the evaluation of every
 * answer against it, and holding the dialog open while the bank or the caller has
 * to act before the next message.
 *
 * Nothing that can move money is sent without the caller seeing the VoP result
 * first, unless the bank itself executes the order on the first message (DK VoP
 * specification E.8.1 rule 2: codes 3091 and 3076). Anything unexpected ends the
 * transfer with `success: false` instead of sending another message.
 */
abstract class TransferOrderInteraction extends CustomerOrderInteraction {
	constructor(
		segId: string,
		public order: CreditTransferOrder,
	) {
		super(segId, HIVPP.Id);
	}

	override handleClientResponse(message: Message): TransferResponse {
		let base: ClientResponse;

		try {
			base = super.handleClientResponse(message);
		} catch (error) {
			// Such as a code asking for a TAN without a HITAN: answer, do not throw
			base = {
				dialogId: message.findSegment<HNHBKSegment>(HNHBK.Id)?.dialogId ?? '',
				success: false,
				bankingInformationUpdated: false,
				bankAnswers: message.getBankAnswers(),
				requiresTan: false,
			};
			const accepted = this.orderAnswers(message).some((answer) => ACCEPTED.includes(answer.code));
			return this.record(
				this.fail(
					base,
					`Unexpected answer from the bank: ${(error as Error).message}. ${CHECK_ACCOUNT}`,
					accepted,
				),
			);
		}

		// The base response counts a TAN request as success even next to an error code
		const response =
			message.getHighestReturnCode() >= 9000
				? this.evaluateError(message, base)
				: this.evaluate(message, base);

		return this.record(response);
	}

	/**
	 * An error code is a rejection only when nothing says the order went through: 9000
	 * (status indifferent) or an acceptance of the order itself next to the error (such as
	 * 0020 to HKCCS, 9210 to HKVPP and 9050 to the message) leave the outcome open.
	 */
	private evaluateError(message: Message, base: ClientResponse): TransferResponse {
		const accepted = this.orderAnswers(message).some((answer) => ACCEPTED.includes(answer.code));

		if (message.hasReturnCode(9000) || accepted) {
			return this.fail(base, OUTCOME_UNCERTAIN, true);
		}

		return this.fail(base, 'The bank rejected the order, see bankAnswers.');
	}

	/**
	 * The segment number of the order in the message just sent, whose answers say what
	 * became of it; none for a message that carries no order
	 */
	protected orderSegNr(): number | undefined {
		return undefined;
	}

	/**
	 * The bank's answers about the order: those referring to the order segment in the
	 * message that carries it, and every segment answer to a TAN message, which carries
	 * no order and whose answers stand for it
	 */
	protected orderAnswers(message: Message): Answer[] {
		const tanMessage = this.order.status === 'awaitingTan';
		const segNr = this.orderSegNr();

		return message
			.findAllSegments<HIRMSSegment>(HIRMS.Id)
			.filter((hirms) => tanMessage || (segNr !== undefined && hirms.header.refSegNr === segNr))
			.flatMap((hirms) => hirms.answers);
	}

	/**
	 * Whether the bank accepted the order (0010 or 0020) and says nothing is pending
	 */
	protected isAccepted(message: Message): boolean {
		const codes = this.orderAnswers(message).map((answer) => answer.code);
		return (
			codes.some((code) => ACCEPTED.includes(code)) && !codes.some((code) => PENDING.includes(code))
		);
	}

	/**
	 * Takes over the reference of 3070 to the order: the bank processes it under that
	 * reference, so it must not be offered for sending again
	 */
	protected trackProcessing(message: Message): void {
		const processing = this.orderAnswers(message).find((answer) => answer.code === 3070);

		if (processing) {
			this.order.processingReference = processing.params?.[0] ?? '';
		}
	}

	override awaitsCaller(): boolean {
		return this.order.status === 'polling' || this.order.status === 'awaitingConfirmation';
	}

	protected handleResponse(): void {
		// Everything happens in handleClientResponse, which also sees TAN requests
	}

	protected abstract evaluate(message: Message, base: ClientResponse): TransferResponse;

	/**
	 * The answer to the TAN message, whichever step asked for the TAN
	 */
	protected evaluateTan(message: Message, base: ClientResponse): TransferResponse {
		const untrusted = this.takeNewerResult(message, base);

		if (untrusted) {
			return untrusted;
		}

		if (message.hasReturnCode(3945)) {
			// The bank voided the approval and wants HKVPA with the order (E.8.1 rule 5)
			if (this.order.vopParameters && this.order.vopId !== undefined && !this.order.confirmed) {
				return this.awaitConfirmation(base);
			}

			return this.fail(
				base,
				'The bank refused the approval (3945). The transfer was not executed.',
			);
		}

		if (base.requiresTan) {
			// Decoupled approval still pending (3956), or another TAN asked for
			return this.respond(base);
		}

		if (message.hasReturnCode(3958)) {
			return this.fail(
				base,
				'The approval app does not support the approval of this order (3958). The transfer was not executed.',
			);
		}

		return this.isAccepted(message) ? this.accept(base) : this.fail(base, OUTCOME_UNCERTAIN, true);
	}

	/**
	 * Takes over a Verification of Payee result in an answer after the first one, before
	 * anything is offered on the strength of the earlier result
	 * @returns the failed response when that result cannot be trusted and the bank did not
	 * accept the order
	 */
	protected takeNewerResult(message: Message, base: ClientResponse): TransferResponse | undefined {
		const reason = this.order.takeNewerResult(findHivpp(message));
		return reason !== undefined && !this.isAccepted(message) ? this.fail(base, reason) : undefined;
	}

	protected respond(base: ClientResponse, requiresVopConfirmation = false): TransferResponse {
		return {
			...base,
			requiresVopConfirmation,
			vop: this.order.vopResult,
			transferId: this.order.transferId,
			endToEndId: this.order.pain.endToEndId,
			outcomeUncertain: false,
		};
	}

	protected accept(base: ClientResponse): TransferResponse {
		this.order.status = 'accepted';
		return this.respond(withoutTan(base));
	}

	protected awaitConfirmation(base: ClientResponse): TransferResponse {
		const reference = this.order.processingReference;

		if (reference !== undefined) {
			// The bank already processes the order (3070): a confirmation would send it again
			return this.fail(
				base,
				`The bank processes the transfer under the reference ${reference || '(none given)'} (3070) and did not confirm its outcome; it may execute it. Check the account before sending the transfer again.`,
				true,
			);
		}

		this.order.status = 'awaitingConfirmation';
		return this.respond(withoutTan(base), true);
	}

	protected awaitTan(base: ClientResponse): TransferResponse {
		this.order.status = 'awaitingTan';
		return this.respond(base);
	}

	protected poll(base: ClientResponse): TransferResponse {
		this.order.status = 'polling';
		return this.respond(withoutTan(base));
	}

	protected fail(
		base: ClientResponse,
		failureReason: string,
		outcomeUncertain = false,
	): TransferResponse {
		this.order.status = 'failed';
		return {
			...this.respond(withoutTan(base)),
			success: false,
			failureReason,
			outcomeUncertain,
		};
	}

	private record(response: TransferResponse): TransferResponse {
		this.order.lastResponse = response;
		return response;
	}
}

/**
 * Submits a SEPA credit transfer (HKCCS), with the Verification of Payee check
 * request (HKVPP) in front of it when the bank requires one, or, as the confirm step,
 * sends the identical order again together with the authorisation (HKVPA) after the
 * caller has accepted the VoP result.
 */
export class CreditTransferInteraction extends TransferOrderInteraction {
	private hkccs?: HKCCSSegment;

	constructor(
		order: CreditTransferOrder,
		public step: 'submit' | 'confirm',
	) {
		super(HKCCS.Id, order);
	}

	protected createSegments(_config: FinTSConfig): Segment[] {
		if (this.step === 'confirm') {
			this.hkccs = this.order.createHkccs();
			return [this.order.createHkvpa(), this.hkccs];
		}

		this.order.prepare();
		this.hkccs = this.order.createHkccs();
		return this.order.vopParameters ? [this.order.createHkvpp(), this.hkccs] : [this.hkccs];
	}

	protected override orderSegNr(): number | undefined {
		return this.hkccs?.header.segNr;
	}

	override needsTanSegment(tanRequired: boolean): boolean {
		// HKVPP or HKVPA, HKTAN and the order always go together (DK VoP specification
		// E.8.1 rules 1 and 4), whatever the BPD say about a TAN for HKCCS
		return tanRequired || !!this.order.vopParameters;
	}

	override getTanMessageSegments(_config: FinTSConfig): Segment[] {
		// After a match without 3091, HKVPA goes with the TAN (E.8.1, figure 3); only
		// with the first TAN message, not with the status requests of a decoupled method
		if (this.order.status === 'awaitingTan' && this.order.sendVopAuthorizationWithTan) {
			this.order.sendVopAuthorizationWithTan = false;
			return [this.order.createHkvpa()];
		}

		return [];
	}

	protected evaluate(message: Message, base: ClientResponse): TransferResponse {
		if (this.order.status === 'awaitingTan') {
			return this.evaluateTan(message, base);
		}

		if (this.step === 'confirm') {
			return this.evaluateConfirm(message, base);
		}

		return this.order.vopParameters
			? this.evaluateSubmitWithVop(message, base)
			: this.evaluateSubmitWithoutVop(message, base);
	}

	private evaluateSubmitWithoutVop(message: Message, base: ClientResponse): TransferResponse {
		if (message.hasReturnCode(3945)) {
			return this.fail(
				base,
				'The bank asked for a Verification of Payee its parameters do not announce for HKCCS (3945). The transfer was not executed.',
			);
		}

		// The banking information said no check was needed, but the bank checked: its result
		// has to reach the caller before any TAN, which this order cannot offer
		if (findHivpp(message) || VOP_CODES.some((code) => message.hasReturnCode(code))) {
			return this.fail(
				base,
				base.requiresTan
					? 'The bank reported a Verification of Payee its parameters do not announce for HKCCS. The transfer was not executed; synchronize to update the bank parameters and try again.'
					: `The bank reported a Verification of Payee its parameters do not announce for HKCCS. ${CHECK_ACCOUNT}`,
			);
		}

		if (base.requiresTan) {
			return this.awaitTan(base);
		}

		return this.isAccepted(message) ? this.accept(base) : this.fail(base, OUTCOME_UNCERTAIN, true);
	}

	private evaluateSubmitWithVop(message: Message, base: ClientResponse): TransferResponse {
		// Searched in every answer, not only the HKTAN's: Commerzbank attaches 3945
		// elsewhere (observed at that bank, reported in python-fints PR #223)
		const approvalVoided = message.hasReturnCode(3945);
		const hivpp = findHivpp(message);
		this.trackProcessing(message);

		if (hivpp) {
			this.order.track(message, hivpp);
		}

		if (!base.requiresTan && !approvalVoided && this.isExecuted(message)) {
			// The bank executed the order straight away; the result is for information only
			const result = hivpp ? this.order.readResult(hivpp) : undefined;
			this.order.vopResult = typeof result === 'object' ? result : undefined;
			return this.accept(base);
		}

		if (!hivpp) {
			return this.fail(
				base,
				`The bank answered without a Verification of Payee result. ${CHECK_ACCOUNT}`,
			);
		}

		if (hivpp.vopId === undefined) {
			// Atruvia banks check asynchronously: polling ID, touchdown point (3040) and
			// code 3905 instead of a challenge (observed there, reported in python-fints
			// PR #223). A TAN request before the result is complete is not expected.
			if (this.order.pollingId && !base.requiresTan) {
				return this.poll(base);
			}

			return this.fail(
				base,
				`The bank sent a Verification of Payee result without a VoP ID. ${CHECK_ACCOUNT}`,
			);
		}

		const result = this.order.readResult(hivpp);

		if (typeof result === 'string') {
			return this.fail(base, result);
		}

		this.order.vopId = hivpp.vopId;
		this.order.vopResult = result;

		// The codes decide the flow, not the result (E.8.1): 3945 voids the approval
		// even for a match
		if (base.requiresTan && !approvalVoided && result.result === 'match') {
			// 3091: the bank needs no HKVPA, the TAN alone answers the challenge (rule 3)
			this.order.sendVopAuthorizationWithTan = !message.hasReturnCode(3091);
			return this.awaitTan(base);
		}

		// A match the bank holds and needs no SCA for: the caller decides, and HKVPA alone
		// authorises the held order
		this.order.authorizationOnly =
			!base.requiresTan &&
			!approvalVoided &&
			result.result === 'match' &&
			message.hasReturnCode(3076) &&
			!message.hasReturnCode(3091);

		// A deviation, or a match the bank wants confirmed: the caller decides. A TAN
		// the bank asked for anyway is dropped; the confirm step brings a new one.
		return this.awaitConfirmation(base);
	}

	private evaluateConfirm(message: Message, base: ClientResponse): TransferResponse {
		const untrusted = this.takeNewerResult(message, base);

		if (untrusted) {
			return untrusted;
		}

		if (message.hasReturnCode(3945)) {
			return this.fail(
				base,
				'The bank refused the authorisation (3945). The transfer was not executed.',
			);
		}

		if (base.requiresTan) {
			// HKVPA has gone with the order; the TAN message carries none
			this.order.sendVopAuthorizationWithTan = false;
			return this.awaitTan(base);
		}

		return this.isAccepted(message) ? this.accept(base) : this.fail(base, OUTCOME_UNCERTAIN, true);
	}

	/**
	 * Whether the bank executed the order on the first message: it executed HKCCS
	 * itself (0020 referring to the segment), or it waived the check and the strong
	 * authentication (3091 with 3076, E.8.1 rule 2; Hamburger Sparkasse does this, as
	 * reported to python-fints). Offering a confirmation then would invite the caller to
	 * send the order a second time.
	 *
	 * 0010 does not count: it only says the bank received the order ("zur Ausführung
	 * vorgemerkt"), which it may do while the name check is still running (3093) or
	 * while the order waits for HKVPA.
	 */
	private isExecuted(message: Message): boolean {
		const executed = this.orderAnswers(message).some((answer) => answer.code === 20);
		return executed || (message.hasReturnCode(3091) && message.hasReturnCode(3076));
	}
}

/**
 * Authorises an order the bank holds after a match and for which it waived the strong
 * authentication (3076 without 3091): HKVPA alone, without the order and without HKTAN
 * (DK VoP specification E.8.1, figure 3 and its note on small amounts).
 */
export class VopAuthorizationInteraction extends TransferOrderInteraction {
	constructor(order: CreditTransferOrder) {
		super(HKVPA.Id, order);
	}

	protected createSegments(_config: FinTSConfig): Segment[] {
		return [this.order.createHkvpa()];
	}

	override needsTanSegment(_tanRequired: boolean): boolean {
		return false;
	}

	protected override orderAnswers(message: Message): Answer[] {
		// HKVPA stands for the held order: every segment answer is about it
		return message.findAllSegments<HIRMSSegment>(HIRMS.Id).flatMap((hirms) => hirms.answers);
	}

	protected evaluate(message: Message, base: ClientResponse): TransferResponse {
		if (this.order.status === 'awaitingTan') {
			return this.evaluateTan(message, base);
		}

		const untrusted = this.takeNewerResult(message, base);

		if (untrusted) {
			return untrusted;
		}

		if (message.hasReturnCode(3945)) {
			return this.fail(
				base,
				'The bank refused the authorisation (3945). The transfer was not executed.',
			);
		}

		if (base.requiresTan) {
			return this.awaitTan(base);
		}

		return this.isAccepted(message) ? this.accept(base) : this.fail(base, OUTCOME_UNCERTAIN, true);
	}
}

/**
 * Asks again for a Verification of Payee result the bank is still producing: HKVPP
 * alone, with the polling ID and the touchdown point (DK VoP specification C.10.7.1.1;
 * both are required, Atruvia answers 9210 to either alone, as reported in
 * python-fints PR #223).
 *
 * The dialog adds HKTAN only if the bank's parameters require a TAN for HKVPP itself.
 */
export class VopPollInteraction extends TransferOrderInteraction {
	constructor(order: CreditTransferOrder) {
		super(HKVPP.Id, order);
	}

	protected createSegments(_config: FinTSConfig): Segment[] {
		return [this.order.createHkvpp()];
	}

	protected evaluate(message: Message, base: ClientResponse): TransferResponse {
		const hivpp = findHivpp(message);

		if (!hivpp || base.requiresTan) {
			return this.fail(
				base,
				'Unexpected answer to the Verification of Payee poll. The transfer was not executed.',
			);
		}

		this.order.track(message, hivpp);

		if (hivpp.vopId === undefined) {
			// The VoP ID comes with the final part of the result (C.10.7.1.1)
			return this.order.pollingId
				? this.poll(base)
				: this.fail(
						base,
						'The bank sent a Verification of Payee result without a VoP ID. The transfer was not executed.',
					);
		}

		const result = this.order.readResult(hivpp);

		if (typeof result === 'string') {
			return this.fail(base, result);
		}

		this.order.vopId = hivpp.vopId;
		this.order.vopResult = result;

		// No challenge was issued yet, so even a match goes back to the caller: the
		// confirm step may execute the order straight away where no TAN is needed
		return this.awaitConfirmation(base);
	}
}
