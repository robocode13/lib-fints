import type { FinTSConfig } from '../config.js';
import type { InternationalAccount } from '../dataGroups/InternationalAccount.js';
import type { Message } from '../message.js';
import type { Pain001Message } from '../pain001Builder.js';
import { type PaymentStatusReport, parsePain002 } from '../pain002Parser.js';
import type { Segment } from '../segment.js';
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
 * @property endToEndId the end-to-end reference the transfer carries
 * @property failureReason why the transfer stopped, when `success` is false and the
 * bank answers alone do not say
 */
export interface TransferResponse extends ClientResponse {
	requiresVopConfirmation: boolean;
	vop?: VopResult;
	endToEndId: string;
	failureReason?: string;
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

/**
 * The state of one credit transfer across the messages of its dialog: the order as
 * built once, before anything was sent, and what the bank has said about it so far.
 */
export class CreditTransferOrder {
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
	/** The response of the latest message this order's interactions handled */
	lastResponse?: TransferResponse;
	/** The latest HIVPP that carried a result, for a final HIVPP that carries only the VoP ID */
	private resultSegment?: HIVPPSegment;

	constructor(
		readonly account: InternationalAccount,
		readonly pain: Pain001Message,
		readonly hkccsVersion: number,
		readonly vopParameters?: VopParameters,
	) {}

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

		try {
			return extractVopResult(
				source ?? final,
				final.notice ?? source?.notice,
				this.vopParameters?.noticeStructured ?? false,
			);
		} catch (error) {
			return `${(error as Error).message}. The transfer was not executed.`;
		}
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
			return this.record(
				this.fail(
					base,
					`Unexpected answer from the bank: ${(error as Error).message}. ${CHECK_ACCOUNT}`,
				),
			);
		}

		// The base response counts a TAN request as success even next to an error code
		const response =
			message.getHighestReturnCode() >= 9000
				? this.fail(base, 'The bank rejected the order, see bankAnswers.')
				: this.evaluate(message, base);

		return this.record(response);
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

		return this.accept(base);
	}

	protected respond(base: ClientResponse, requiresVopConfirmation = false): TransferResponse {
		return {
			...base,
			requiresVopConfirmation,
			vop: this.order.vopResult,
			endToEndId: this.order.pain.endToEndId,
		};
	}

	protected accept(base: ClientResponse): TransferResponse {
		this.order.status = 'accepted';
		return this.respond(withoutTan(base));
	}

	protected awaitConfirmation(base: ClientResponse): TransferResponse {
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

	protected fail(base: ClientResponse, failureReason: string): TransferResponse {
		this.order.status = 'failed';
		return { ...this.respond(withoutTan(base)), success: false, failureReason };
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
		this.hkccs = this.order.createHkccs();

		if (this.step === 'confirm') {
			return [this.order.createHkvpa(), this.hkccs];
		}

		return this.order.vopParameters ? [this.order.createHkvpp(), this.hkccs] : [this.hkccs];
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

		return base.requiresTan ? this.awaitTan(base) : this.accept(base);
	}

	private evaluateSubmitWithVop(message: Message, base: ClientResponse): TransferResponse {
		// Searched in every answer, not only the HKTAN's: Commerzbank attaches 3945
		// elsewhere (observed at that bank, reported in python-fints PR #223)
		const approvalVoided = message.hasReturnCode(3945);
		const hivpp = findHivpp(message);

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

		// A deviation, or a match the bank wants confirmed: the caller decides. A TAN
		// the bank asked for anyway is dropped; the confirm step brings a new one.
		return this.awaitConfirmation(base);
	}

	private evaluateConfirm(message: Message, base: ClientResponse): TransferResponse {
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

		return this.accept(base);
	}

	/**
	 * Whether the bank executed the order on the first message: it accepted HKCCS
	 * itself (0010 or 0020 referring to the segment), or it waived the check and the
	 * strong authentication (3091 with 3076, E.8.1 rule 2; Hamburger Sparkasse does
	 * this, as reported to python-fints). Offering a confirmation then would invite
	 * the caller to send the order a second time.
	 *
	 * 0010 counts as well as 0020: it is what an accepted transfer got at one bank,
	 * Sparkasse Berlin, as observed in PR #27 (after the TAN there). Whether a bank
	 * could answer 0010 to an order it only parks until HKVPA is not known; that would
	 * report a transfer as accepted that was not executed, which is the lesser risk
	 * than offering to send an executed order again.
	 */
	private isExecuted(message: Message): boolean {
		const segNr = this.hkccs?.header.segNr;
		const accepted = message
			.findAllSegments<HIRMSSegment>(HIRMS.Id)
			.filter((hirms) => segNr !== undefined && hirms.header.refSegNr === segNr)
			.some((hirms) => hirms.answers.some((answer) => answer.code === 10 || answer.code === 20));

		return accepted || (message.hasReturnCode(3091) && message.hasReturnCode(3076));
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
