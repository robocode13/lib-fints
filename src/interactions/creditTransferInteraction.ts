import { randomBytes } from 'node:crypto';
import type { FinTSConfig } from '../config.js';
import type { InternationalAccount } from '../dataGroups/InternationalAccount.js';
import type { CustomerMessage, Message } from '../message.js';
import type { Pain001Message } from '../pain001Builder.js';
import type { Segment } from '../segment.js';
import { HIVPP, type HIVPPSegment } from '../segments/HIVPP.js';
import { HKCCS, type HKCCSSegment } from '../segments/HKCCS.js';
import { HKVPA, type HKVPASegment } from '../segments/HKVPA.js';
import { HKVPP, type HKVPPSegment } from '../segments/HKVPP.js';
import { HNHBK, type HNHBKSegment } from '../segments/HNHBK.js';
import { type ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';
import { type Outcome, type Proposal, TransferEvidence } from './transferOutcome.js';
import { VopCheck, type VopResult } from './vopCheck.js';

export { extractVopResult, type VopResult, type VopResultCode } from './vopCheck.js';

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
 * @property outcomeUncertain the transfer stopped (`success` is false) and the bank may have
 * executed it all the same: it received the order (0010, 3070, an order it holds for its
 * authorisation) and a later step failed or timed out, it answered 9000, or it reported an
 * execution its other answers contradict. A receipt alone is no execution. Check the
 * account before sending it again.
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

/** The return codes about a Verification of Payee: 3090 check the result, 3091 no HKVPA
 * needed, 3093 the check is still running */
const VOP_CODES = [3090, 3091, 3093];

const NO_VOP_ID = 'The bank sent a Verification of Payee result without a VoP ID.';

const UNANNOUNCED_CHECK =
	'The bank reported a Verification of Payee its parameters do not announce for HKCCS; synchronize to update the bank parameters.';

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
	/** Every bank answer to this order, and what they say became of it */
	readonly evidence = new TransferEvidence();
	/** The response of the latest message this order's interactions handled */
	lastResponse?: TransferResponse;
	/** The current Verification of Payee check: its result, VoP ID, notice and codes */
	check = new VopCheck();
	private prepared: PreparedTransfer;
	/**
	 * The material fields of the result the caller was handed to decide on, kept here
	 * where no caller can change them
	 */
	private decided?: string;

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

	get vopId(): string | undefined {
		return this.check.vopId;
	}

	get vopResult(): VopResult | undefined {
		return this.check.result;
	}

	get waitSeconds(): number | undefined {
		return this.check.waitSeconds;
	}

	/**
	 * Builds the order again from the banking information as it is now. Called right
	 * before the order is first sent, after the dialog initialisation, which may have
	 * brought new bank or account parameters; every later message reuses this order.
	 */
	prepare(): void {
		this.prepared = this.build();
		this.startCheck();
	}

	/** Starts a new check: whatever the bank said about an earlier one no longer counts */
	startCheck(): VopCheck {
		this.check = new VopCheck();
		this.authorizationOnly = false;
		return this.check;
	}

	/**
	 * Reads the result of the current check
	 * @returns the result, or why it cannot be trusted
	 */
	readResult(): VopResult | string {
		return this.check.read(this.pain, this.vopParameters?.noticeStructured ?? false);
	}

	/**
	 * Binds the caller's decision, a confirmation or a TAN, to the current result: the
	 * first result handed to the caller is the only one the transfer goes on with
	 */
	bindDecision(): void {
		this.decided ??= this.material();
	}

	/** Whether the current result is, in every material field, the one the caller decided on */
	isDecided(): boolean {
		return this.decided !== undefined && this.decided === this.material();
	}

	private material(): string | undefined {
		const result = this.vopResult;

		if (!result) {
			return undefined;
		}

		const { code, iban, suggestedName, notApplicableReason, notice, reasons } = result;
		return JSON.stringify([
			this.vopId,
			result.result,
			code,
			iban,
			suggestedName,
			notApplicableReason,
			notice,
			reasons,
		]);
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

	/**
	 * HKVPP to start the check, or, while it runs, to ask for the rest of the result with
	 * the touchdown point and polling ID of the latest answer
	 */
	createHkvpp(): HKVPPSegment {
		if (!this.vopParameters) {
			throw new Error('cannot check the payee when the bank does not require it');
		}

		const { touchdownPoint, pollingId } = this.check;
		return {
			header: { segId: HKVPP.Id, segNr: 0, version: this.vopParameters.hkvppVersion },
			supportedReports: this.vopParameters.reportFormats,
			pollingId: touchdownPoint ? pollingId : undefined,
			touchdownPoint,
		};
	}

	/**
	 * Whether the bank holds the order after the match of the current check and needs no
	 * strong authentication for it (3076 without 3091 or 3945, no TAN asked for): HKVPA
	 * alone then authorises it
	 */
	holdsMatch(tanRequested: boolean): boolean {
		return (
			!tanRequested &&
			this.vopResult?.result === 'match' &&
			this.check.has(3076) &&
			!this.check.has(3091) &&
			!this.check.has(3945)
		);
	}
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
 * Every message goes through the order's evidence before it is sent, and every answer
 * into it before anything branches on it; the interaction then reads what the
 * Verification of Payee allows next, and the evidence decides the outcome
 * (TransferEvidence). Nothing that can move money is sent without the caller seeing the
 * VoP result first, unless the bank itself executes the order on the first message (DK
 * VoP specification E.8.1 rule 2: codes 3091 and 3076). Anything unexpected ends the
 * transfer with `success: false` instead of sending another message.
 */
abstract class TransferOrderInteraction extends CustomerOrderInteraction {
	constructor(
		segId: string,
		public order: CreditTransferOrder,
	) {
		super(segId, HIVPP.Id);
	}

	override beforeSend(message: CustomerMessage): void {
		this.order.evidence.send(message);
	}

	override handleClientResponse(message: Message): TransferResponse {
		let base: ClientResponse;
		let unreadable: string | undefined;

		try {
			base = super.handleClientResponse(message);
		} catch (error) {
			// Such as a code asking for a TAN without a HITAN: answer, do not throw
			unreadable = `Unexpected answer from the bank: ${(error as Error).message}.`;
			base = {
				dialogId: message.findSegment<HNHBKSegment>(HNHBK.Id)?.dialogId ?? '',
				success: false,
				bankingInformationUpdated: false,
				bankAnswers: message.getBankAnswers(),
				requiresTan: false,
			};
		}

		if (base.requiresTan && !base.tanReference) {
			// A challenge that cannot be answered: the evidence so far decides
			unreadable = 'The bank asked for a TAN without the reference of its challenge.';
		}

		this.order.evidence.record(message, {
			tanRequested: base.requiresTan || unreadable !== undefined,
			unreadable,
			externalApproval: !!this.dialog?.config.selectedTanMethod?.isDecoupled,
		});
		// An error ends the transfer whatever else the answer says; the base response counts
		// a TAN request as success even next to an error code
		const proposal =
			unreadable !== undefined || message.getHighestReturnCode() >= 9000
				? 'none'
				: this.evaluate(message, base);
		const response = this.conclude(base, this.order.evidence.decide(proposal));
		this.order.lastResponse = response;
		return response;
	}

	override awaitsCaller(): boolean {
		return this.order.status === 'polling' || this.order.status === 'awaitingConfirmation';
	}

	protected handleResponse(): void {
		// Everything happens in handleClientResponse, which also sees TAN requests
	}

	/** What the answer allows next as far as the Verification of Payee is concerned */
	protected abstract evaluate(message: Message, base: ClientResponse): Proposal;

	/**
	 * The answer to a message after the check: the TAN message, whichever step asked for
	 * the TAN, or the message that carries HKVPA, the caller's authorisation despite the
	 * result
	 */
	protected evaluateLater(message: Message, base: ClientResponse): Proposal {
		const order = this.order;
		const later = this.takeLaterResult(message);

		if (later) {
			return later;
		}

		if (message.hasReturnCode(3945)) {
			// 3945: the bank voided the approval and wants HKVPA with the order (E.8.1 rule 5)
			if (order.vopParameters && order.vopId !== undefined && !order.confirmed) {
				return 'confirmation';
			}

			return { stop: 'The bank refused the approval (3945).' };
		}

		if (base.requiresTan) {
			// Decoupled approval still pending (3956), another TAN asked for, or the TAN for
			// the authorisation; HKVPA has gone, the TAN message carries none
			order.sendVopAuthorizationWithTan = false;
			return 'tan';
		}

		if (message.hasReturnCode(3958)) {
			return { stop: 'The approval app does not support the approval of this order (3958).' };
		}

		return 'none';
	}

	/**
	 * Takes in a result the bank sends with an answer after the check, such as with 3945 to
	 * the TAN: a new check, which replaces the earlier one whole. The caller decided on the
	 * earlier one; a result that differs from it in any material field ends the transfer
	 * instead of asking again, so no decision, a late one included, applies to another result.
	 * @returns why the transfer has to stop, if it does
	 */
	private takeLaterResult(message: Message): { stop: string } | undefined {
		const hivpp = findHivpp(message);

		if (!hivpp) {
			return undefined;
		}

		const order = this.order;

		if (!order.vopParameters) {
			return { stop: UNANNOUNCED_CHECK };
		}

		order.startCheck().take(message, hivpp, order.evidence.touchdownPoint);
		const result = order.readResult();

		if (typeof result === 'string') {
			return { stop: result };
		}

		return order.isDecided()
			? undefined
			: {
					stop: 'The bank sent another Verification of Payee result than the one decided on, see vop.',
				};
	}

	/**
	 * Hands the result of the check to the caller. A match the bank holds and needs no
	 * strong authentication for, by the codes of every answer of the check, is authorised
	 * by HKVPA alone (E.8.1, figure 3).
	 */
	protected offerConfirmation(tanRequested: boolean): Proposal {
		this.order.authorizationOnly = this.order.holdsMatch(tanRequested);

		if (this.order.authorizationOnly) {
			this.order.evidence.hold();
		}

		return 'confirmation';
	}

	private conclude(base: ClientResponse, outcome: Outcome): TransferResponse {
		const order = this.order;

		if (outcome.status === 'failed') {
			order.status = 'failed';
			return {
				...this.respond(withoutTan(base)),
				success: false,
				failureReason: outcome.reason,
				outcomeUncertain: outcome.uncertain,
			};
		}

		if (outcome.status === 'tan' || outcome.status === 'confirmation') {
			order.bindDecision();
		}

		if (outcome.status === 'tan') {
			order.status = 'awaitingTan';
			return this.respond(base);
		}

		order.status =
			outcome.status === 'confirmation'
				? 'awaitingConfirmation'
				: outcome.status === 'poll'
					? 'polling'
					: 'accepted';
		return this.respond(withoutTan(base), outcome.status === 'confirmation');
	}

	private respond(base: ClientResponse, requiresVopConfirmation = false): TransferResponse {
		return {
			...base,
			requiresVopConfirmation,
			// A copy: what the caller does with it changes nothing here
			vop: structuredClone(this.order.vopResult),
			transferId: this.order.transferId,
			endToEndId: this.order.pain.endToEndId,
			outcomeUncertain: false,
		};
	}
}

/**
 * Submits a SEPA credit transfer (HKCCS), with the Verification of Payee check
 * request (HKVPP) in front of it when the bank requires one, or, as the confirm step,
 * sends the identical order again together with the authorisation (HKVPA) after the
 * caller has accepted the VoP result.
 */
export class CreditTransferInteraction extends TransferOrderInteraction {
	constructor(
		order: CreditTransferOrder,
		public step: 'submit' | 'confirm',
	) {
		super(HKCCS.Id, order);
	}

	protected createSegments(_config: FinTSConfig): Segment[] {
		if (this.step === 'confirm') {
			return [this.order.createHkvpa(), this.order.createHkccs()];
		}

		this.order.prepare();
		const hkccs = this.order.createHkccs();
		return this.order.vopParameters ? [this.order.createHkvpp(), hkccs] : [hkccs];
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

	protected evaluate(message: Message, base: ClientResponse): Proposal {
		if (this.order.status === 'awaitingTan' || this.step === 'confirm') {
			return this.evaluateLater(message, base);
		}

		return this.order.vopParameters
			? this.evaluateSubmitWithVop(message, base)
			: this.evaluateSubmitWithoutVop(message, base);
	}

	private evaluateSubmitWithoutVop(message: Message, base: ClientResponse): Proposal {
		if (message.hasReturnCode(3945)) {
			return {
				stop: 'The bank asked for a Verification of Payee its parameters do not announce for HKCCS (3945).',
			};
		}

		// The banking information said no check was needed, but the bank checked: its result
		// has to reach the caller before any TAN, which this order cannot offer
		if (findHivpp(message) || VOP_CODES.some((code) => message.hasReturnCode(code))) {
			return { stop: UNANNOUNCED_CHECK };
		}

		return base.requiresTan ? 'tan' : 'none';
	}

	private evaluateSubmitWithVop(message: Message, base: ClientResponse): Proposal {
		const order = this.order;
		// Searched in every answer, not only the HKTAN's: Commerzbank attaches 3945
		// elsewhere (observed at that bank, reported in python-fints PR #223)
		const approvalVoided = message.hasReturnCode(3945);
		const hivpp = findHivpp(message);
		// 3091 with 3076 in this answer, the bank executed the order without a challenge
		// (E.8.1 rule 2; Hamburger Sparkasse does this, as reported to python-fints): the
		// evidence decides that before anything this reads
		order.check.take(message, hivpp, order.evidence.touchdownPoint);

		if (!hivpp) {
			return { stop: 'The bank answered without a Verification of Payee result.' };
		}

		if (hivpp.vopId === undefined) {
			// Atruvia banks check asynchronously: polling ID, touchdown point (3040) and
			// code 3905 instead of a challenge (observed there, reported in python-fints
			// PR #223). A TAN request before the result is complete is not expected.
			return order.check.canPoll() && !base.requiresTan ? 'poll' : { stop: NO_VOP_ID };
		}

		const result = order.readResult();

		if (typeof result === 'string') {
			return { stop: result };
		}

		// The codes decide the flow, not the result (E.8.1): 3945 voids the approval
		// even for a match
		if (base.requiresTan && !approvalVoided && result.result === 'match') {
			// 3091: the bank needs no HKVPA, the TAN alone answers the challenge (rule 3)
			order.sendVopAuthorizationWithTan = !order.check.has(3091);
			return 'tan';
		}

		// A deviation, or a match the bank wants confirmed: the caller decides. A TAN
		// the bank asked for anyway is dropped; the confirm step brings a new one.
		return this.offerConfirmation(base.requiresTan);
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

	protected evaluate(message: Message, base: ClientResponse): Proposal {
		return this.evaluateLater(message, base);
	}
}

/**
 * Asks again for a Verification of Payee result the bank is still producing: HKVPP
 * alone, with the touchdown point of the latest answer and the polling ID, when the bank
 * sent them (DK VoP specification C.10.7.1.1; the polling ID is optional, but where the
 * bank sends both, Atruvia answers 9210 to either alone, as reported in python-fints
 * PR #223).
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

	protected evaluate(message: Message, base: ClientResponse): Proposal {
		const hivpp = findHivpp(message);

		if (!hivpp || base.requiresTan) {
			return { stop: 'Unexpected answer to the Verification of Payee poll.' };
		}

		const check = this.order.check;
		check.take(message, hivpp, this.order.evidence.touchdownPoint);

		if (hivpp.vopId === undefined) {
			// The VoP ID comes with the final part of the result (C.10.7.1.1)
			return check.canPoll() ? 'poll' : { stop: NO_VOP_ID };
		}

		const result = this.order.readResult();

		if (typeof result === 'string') {
			return { stop: result };
		}

		// No challenge was issued yet, so even a match goes back to the caller: the
		// confirm step may execute the order straight away where no TAN is needed
		return this.offerConfirmation(false);
	}
}
