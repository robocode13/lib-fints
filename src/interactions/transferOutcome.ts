import { TanProcess } from '../codes.js';
import type { CustomerMessage, Message } from '../message.js';
import type { Segment } from '../segment.js';
import { type Answer, HIRMG, type HIRMGSegment } from '../segments/HIRMG.js';
import { HIRMS, type HIRMSSegment } from '../segments/HIRMS.js';
import { HKCCS } from '../segments/HKCCS.js';
import { HKTAN, type HKTANSegment } from '../segments/HKTAN.js';
import { HKVPA } from '../segments/HKVPA.js';
import { HKVPP } from '../segments/HKVPP.js';
import { HNHBK, type HNHBKSegment } from '../segments/HNHBK.js';

/**
 * What a bank answer to a message of a transfer is about: the payment (HKCCS), the payee
 * check (HKVPP, and an HKTAN for it), the authorisation of its result (HKVPA), the TAN
 * for the payment (HKTAN), or the message as a whole (HIRMG, and HIRMS to any other
 * segment)
 */
type AnswerRole = 'payment' | 'check' | 'authorization' | 'tan' | 'message';

/** What a message of a transfer does, by the segments it carries */
type MessageKind =
	/** HKCCS, with HKVPP in front of it for a payee check */
	| 'submission'
	/** HKVPA with HKCCS: the order again after the caller's decision (DK VoP E.8.1 rules 4, 5) */
	| 'continuation'
	/** HKTAN process 2: the TAN, with HKVPA after a match */
	| 'approval'
	/** HKTAN process S: whether a decoupled approval has been given, with HKVPA after a match */
	| 'statusQuery'
	/** HKVPP, with an HKTAN for it where the bank requires one: read-only */
	| 'poll'
	/** HKVPA alone, for an order the bank holds after a match */
	| 'authorization'
	| 'other';

type SentMessage = {
	msgNr: number;
	kind: MessageKind;
	segments: Map<number, { segId: string; role: AnswerRole }>;
};

/** The latest answer, as read against the message it answers */
type CurrentAnswer = {
	codes: number[];
	/** The touchdown point the answer gives the payee check (3040 to HKVPP), if any */
	touchdownPoint?: string;
	unreadable?: string;
	/** Whether the bank rejected the payment in a message that carried it */
	rejected: boolean;
	/** Whether the answer contradicts an execution of the payment */
	contradicts: boolean;
};

/** The next step an interaction offers, as far as the Verification of Payee is concerned */
export type Continuation = 'confirmation' | 'tan' | 'poll';

/**
 * What an interaction reads from an answer beyond the codes: a continuation; 'none' when
 * it has nothing to offer and the codes alone decide; or why the transfer has to stop,
 * `uncertain` when the bank may execute it all the same
 */
export type Proposal = Continuation | 'none' | { stop: string; uncertain?: boolean };

export type Outcome =
	| { status: 'accepted' }
	| { status: Continuation }
	| { status: 'failed'; reason: string; uncertain: boolean };

const NOT_EXECUTED = 'The transfer was not executed.';
const CHECK_ACCOUNT = 'Check the account before sending the transfer again.';

/** 0010: received ("entgegengenommen", not legally binding); 0020: executed (DK return codes B.1) */
const RECEIVED = 10;
const EXECUTED = 20;
/** 0030: received, the bank waits for its approval */
const AWAITING_APPROVAL = 30;
/** The bank processes the order under the reference it gives */
const PROCESSING = 3070;
/** 3076: no strong authentication needed; 3091: no HKVPA needed (DK VoP E.8.1 rule 2) */
const SCA_WAIVED = 3076;
const VOP_WAIVED = 3091;
/** The approval was voided (3945) or cannot be given in the app (3958) */
const APPROVAL_VOIDED = 3945;
const APPROVAL_UNSUPPORTED = 3958;
/** A decoupled approval is under way (3955) or still outstanding (3956) */
const APPROVAL_PENDING = [3955, 3956];
/** The bank is not done with the order: 3040 more to come, 3093 the check is still running */
const PENDING = [3040, 3093];
/** 9000: the status of the order is indifferent */
const STATUS_INDIFFERENT = 9000;
/** The order was submitted twice (DK return codes B.4) */
const DUPLICATE = 9390;
/** "Auftrag existiert nicht bzw. wurde bereits ausgeführt" to HKVPA (DK VoP C.10.7.1.2) */
const ORDER_UNKNOWN_OR_EXECUTED = 9210;

const ROLES: Record<string, AnswerRole> = {
	[HKCCS.Id]: 'payment',
	[HKVPP.Id]: 'check',
	[HKVPA.Id]: 'authorization',
};

/**
 * Every message of one transfer and every bank answer to it, and the one place that
 * decides what became of the transfer and whether its payment may go out again.
 *
 * The ledger keeps each outgoing message by number with what each of its segments is,
 * and reads every answer against the message it references (HNHBK), else the latest.
 * Only answers to the payment count for it: to HKCCS in a message that carries it,
 * otherwise to HKVPA and the HKTAN for HKCCS, which stand for it (FinTS PIN/TAN B.4.2.1).
 * A poll and its HKTAN are read-only.
 *
 * The decision is fixed:
 * 1. Execution of the payment (0020 to it, or 3091 with 3076 in the answer to the order)
 *    means executed; if the same answer contradicts it, uncertain.
 * 2. An error ends the transfer: uncertain while anything allows that the bank executes
 *    the payment (a receipt, 3070, a hold, an open approval, an authorisation sent, the
 *    waiver pair, a duplicate, an HKVPA rejection that admits execution) or with 9000,
 *    otherwise not executed. Only a rejection of the payment itself undoes a receipt.
 * 3. A receipt alone is not an execution: without a continuation, uncertain.
 * 4. A confirmation that would send the payment again while the bank may still execute
 *    the one it has means uncertain.
 *
 * The guard: the payment (HKCCS) goes out once, and again only as the DK continuation
 * (HKVPA with HKCCS) the caller confirmed, once, while nothing the bank has can execute.
 */
export class TransferEvidence {
	private readonly sent: SentMessage[] = [];
	private current?: CurrentAnswer;
	private submissions = 0;
	private continuations = 0;
	/** Whether the decision offered a confirmation that has not been sent yet */
	private offered = false;
	/** Why the guard refused to send the payment again, once it has */
	refused?: string;

	private executed = false;
	/** The receipt of the payment, 0010 or 0030 */
	private received?: number;
	/** The reference of 3070, possibly empty */
	private processing?: string;
	/** Whether the bank holds the order for an authorisation by HKVPA alone */
	private held = false;
	/** Whether the bank waits for an approval the user may give outside the dialog */
	private approvalOpen = false;
	/** Whether a TAN or an authorisation for the payment has been sent and not refused */
	private authorized = false;
	private readonly waivers = new Set<number>();
	/** 3091 and 3076 across the answers of a check, though not in one answer */
	private waived = false;
	private duplicate = false;
	/** The bank rejected HKVPA in a way that admits the order may have executed */
	private maybeExecutedBefore = false;

	/**
	 * Takes in a message right before it goes out. A payment the guard does not allow is
	 * refused here, so that no path, a resend of a parted answer included, sends it.
	 * @throws Error when the message would send the payment again
	 */
	send(message: CustomerMessage): void {
		const segments = message.segments;
		const has = (segId: string) => segments.some((segment) => segment.header.segId === segId);
		const hktan = segments.find((segment) => segment.header.segId === HKTAN.Id) as
			| HKTANSegment
			| undefined;
		const kind: MessageKind = has(HKCCS.Id)
			? has(HKVPA.Id)
				? 'continuation'
				: 'submission'
			: hktan?.tanProcess === TanProcess.Process2
				? 'approval'
				: hktan?.tanProcess === TanProcess.Status
					? 'statusQuery'
					: has(HKVPP.Id)
						? 'poll'
						: has(HKVPA.Id)
							? 'authorization'
							: 'other';

		if (kind === 'submission' || kind === 'continuation') {
			this.admit(kind);
		}

		this.sent.push({
			msgNr: message.findSegment<HNHBKSegment>(HNHBK.Id)?.msgNr ?? 0,
			kind,
			// Numbered by position, as CustomerMessage.encode() numbers them
			segments: new Map(
				segments.map((segment, index) => [
					index + 1,
					{ segId: segment.header.segId, role: roleOf(segment) },
				]),
			),
		});

		if (kind === 'approval' || (kind !== 'continuation' && has(HKVPA.Id))) {
			this.authorized = true;
		}
	}

	private admit(kind: 'submission' | 'continuation'): void {
		const continuation =
			kind === 'continuation' &&
			this.continuations === 0 &&
			this.offered &&
			!this.held &&
			this.blocking() === undefined;

		if (this.submissions > 0 && !continuation) {
			this.refused =
				'The transfer would have sent its payment to the bank again, which may still execute the first one.';
			throw new Error(this.refused);
		}

		if (kind === 'continuation') {
			this.continuations++;
			this.waivers.clear();
		}

		this.submissions++;
		this.offered = false;
	}

	/**
	 * Takes in the bank's answer to a message of the transfer, before anything branches on it
	 * @param tanRequested whether the bank asked for a TAN
	 * @param unreadable why the answer could not be read, such as a TAN request without HITAN
	 * @param externalApproval whether the TAN method is approved outside the dialog (decoupled)
	 */
	record(
		message: Message,
		{
			tanRequested,
			unreadable,
			externalApproval,
		}: { tanRequested: boolean; unreadable?: string; externalApproval: boolean },
	): void {
		const reference = message.findSegment<HNHBKSegment>(HNHBK.Id)?.refMsg?.msgNr;
		const sent = this.sent.find((entry) => entry.msgNr === reference) ?? this.sent.at(-1);
		const kind = sent?.kind ?? 'other';
		const answers: (Answer & { role: AnswerRole; segId?: string })[] = [
			...message
				.findAllSegments<HIRMGSegment>(HIRMG.Id)
				.flatMap((hirmg) => hirmg.answers.map((a) => ({ ...a, role: 'message' as const }))),
			...message.findAllSegments<HIRMSSegment>(HIRMS.Id).flatMap((hirms) => {
				const segment = sent?.segments.get(hirms.header.refSegNr ?? 0);
				return hirms.answers.map((a) => ({
					...a,
					role: segment?.role ?? ('message' as const),
					segId: segment?.segId,
				}));
			}),
		];
		const codes = answers.map((answer) => answer.code);
		const carriesPayment = kind === 'submission' || kind === 'continuation';
		const payment = answers.filter((answer) =>
			carriesPayment
				? answer.role === 'payment'
				: answer.role === 'authorization' || answer.role === 'tan',
		);
		const paymentHas = (code: number) => payment.some((answer) => answer.code === code);
		const errorTo = (role: AnswerRole) =>
			answers.filter((answer) => answer.role === role && answer.code >= STATUS_INDIFFERENT);

		if (
			paymentHas(EXECUTED) ||
			(carriesPayment && codes.includes(VOP_WAIVED) && codes.includes(SCA_WAIVED))
		) {
			this.executed = true;
		}

		if (carriesPayment || kind === 'poll') {
			for (const code of [VOP_WAIVED, SCA_WAIVED].filter((code) => codes.includes(code))) {
				this.waivers.add(code);
			}
			this.waived ||= !this.executed && this.waivers.size === 2;
		}

		if (paymentHas(DUPLICATE) && (kind === 'continuation' || this.received !== undefined)) {
			this.duplicate = true;
		}

		const receipt = payment.find(
			(answer) =>
				answer.code === RECEIVED ||
				(answer.code === AWAITING_APPROVAL && answer.role === 'payment'),
		);
		const processing = payment.find((answer) => answer.code === PROCESSING);
		const rejected = carriesPayment && payment.some((answer) => answer.code >= STATUS_INDIFFERENT);

		if (rejected && !receipt && !processing && !paymentHas(DUPLICATE)) {
			// The bank refused the order it was sent: nothing of it can execute
			this.received = undefined;
			this.processing = undefined;
			this.held = false;
			this.approvalOpen = false;
			this.authorized = false;
		}

		this.received = receipt?.code ?? this.received;
		this.processing = processing ? (processing.params?.[0] ?? '') : this.processing;

		for (const answer of errorTo('authorization')) {
			if (answer.code === ORDER_UNKNOWN_OR_EXECUTED || /ausgef|executed/i.test(answer.text)) {
				this.maybeExecutedBefore = true;
			}
			this.authorized = false;
		}

		if (
			tanRequested &&
			(externalApproval || APPROVAL_PENDING.some((code) => codes.includes(code)))
		) {
			this.approvalOpen = true;
		}

		// A failed status query says nothing about the approval; a refused TAN closes it
		if (
			codes.includes(APPROVAL_VOIDED) ||
			codes.includes(APPROVAL_UNSUPPORTED) ||
			(kind === 'approval' && errorTo('tan').length)
		) {
			this.approvalOpen = false;
			this.authorized = false;
		}

		if (codes.includes(APPROVAL_VOIDED)) {
			this.held = false;
		}

		this.current = {
			codes,
			touchdownPoint:
				answers.find((answer) => answer.code === PENDING[0] && answer.segId === HKVPP.Id)
					?.params?.[0] || undefined,
			unreadable,
			rejected,
			contradicts:
				!!unreadable ||
				tanRequested ||
				codes.some(
					(code) =>
						code >= STATUS_INDIFFERENT ||
						code === APPROVAL_VOIDED ||
						code === APPROVAL_UNSUPPORTED ||
						APPROVAL_PENDING.includes(code) ||
						PENDING.includes(code),
				),
		};
	}

	/**
	 * The touchdown point of the latest answer for the rest of the payee check: that of
	 * code 3040 to HKVPP, not to any other segment
	 */
	get touchdownPoint(): string | undefined {
		return this.current?.touchdownPoint;
	}

	/** The bank holds the order for an authorisation by HKVPA alone (3076 after a match) */
	hold(): void {
		this.held = true;
	}

	/**
	 * Whether the answers so far allow that the bank executes the payment, so that a step
	 * that got no answer leaves the outcome uncertain
	 */
	mayHaveExecuted(): boolean {
		return this.executed || this.allowance(false) !== undefined;
	}

	/**
	 * Why the transfer stops after a step that got no answer, such as polling that took too
	 * long or a lost connection, and whether the bank may execute it all the same
	 */
	giveUp(reason: string, uncertain = false): { reason: string; uncertain: boolean } {
		const outcome = this.decide({ stop: reason, uncertain }, false);
		return outcome.status === 'failed' ? outcome : { reason, uncertain: true };
	}

	/**
	 * Decides what became of the transfer after the latest answer recorded, or, with
	 * `answered` false, after a step that got no answer
	 */
	decide(proposal: Proposal, answered = true): Outcome {
		const current = answered ? this.current : undefined;
		const codes = current?.codes ?? [];

		if (this.executed) {
			return current?.contradicts
				? failed(
						`The bank reported the transfer as executed, but its other answers contradict that; see bankAnswers. ${CHECK_ACCOUNT}`,
						true,
					)
				: { status: 'accepted' };
		}

		const reason =
			current?.unreadable ??
			(current?.rejected
				? 'The bank rejected the order, see bankAnswers.'
				: codes.some((code) => code >= STATUS_INDIFFERENT)
					? 'The bank answered with an error, see bankAnswers.'
					: typeof proposal === 'object'
						? proposal.stop
						: undefined);
		const allowance = this.allowance(true);

		if (reason !== undefined) {
			if (codes.includes(STATUS_INDIFFERENT)) {
				return failed(
					`The bank did not say whether it executed the transfer (9000) and may have executed it. ${CHECK_ACCOUNT}`,
					true,
				);
			}

			if (allowance) {
				return failed(`${reason} The bank ${allowance} and may execute it. ${CHECK_ACCOUNT}`, true);
			}

			if (typeof proposal === 'object' && proposal.uncertain && reason === proposal.stop) {
				return failed(`${reason} ${CHECK_ACCOUNT}`, true);
			}

			return failed(`${reason} ${NOT_EXECUTED}`, false);
		}

		if (proposal === 'none') {
			return failed(
				allowance
					? `The bank ${allowance}, but did not confirm that it executed it. ${CHECK_ACCOUNT}`
					: `The bank did not confirm the outcome of the transfer and may have executed it. ${CHECK_ACCOUNT}`,
				true,
			);
		}

		if (proposal === 'confirmation') {
			const blocking = this.blocking();

			if (blocking) {
				// A confirmation would send the order again while the bank may execute it
				return failed(
					`The bank ${blocking} and did not confirm its outcome; it may execute it. ${CHECK_ACCOUNT}`,
					true,
				);
			}

			this.offered = true;
		}

		return { status: proposal as Continuation };
	}

	/**
	 * What the bank has of the payment that can still execute, a reason against sending it
	 * again, if anything
	 */
	private blocking(): string | undefined {
		if (this.executed) {
			return 'reported the transfer as executed';
		}

		if (this.continuations > 0) {
			return 'has been sent the transfer again after the payee check already';
		}

		return this.allowance(true, true);
	}

	/**
	 * What allows that the bank executes the payment, for the failure reason, if anything
	 * does
	 * @param sentAuthorization whether an authorisation sent counts, not only the answers
	 * @param exceptHeld leave out what the DK continuation is for: a receipt, and an order
	 * the bank holds for HKVPA alone, which the confirmation authorises without the order
	 */
	private allowance(sentAuthorization: boolean, exceptHeld = false): string | undefined {
		const reasons: [boolean, string][] = [
			[
				this.processing !== undefined,
				`processes the transfer under the reference ${this.processing || '(none given)'} (3070)`,
			],
			[this.duplicate, 'reported a duplicate submission of the transfer (9390)'],
			[
				this.maybeExecutedBefore,
				'answered the authorisation saying the order may have been executed already',
			],
			[this.approvalOpen, 'waits for an approval of the transfer that may still be given'],
			[this.waived, 'waived the payee check and the strong authentication (3091, 3076)'],
			[sentAuthorization && this.authorized, 'was sent the authorisation of the transfer'],
			[!exceptHeld && this.held, 'holds the transfer for its authorisation'],
			[
				!exceptHeld && this.received !== undefined,
				`received the transfer (${String(this.received).padStart(4, '0')})`,
			],
		];
		return reasons.find(([applies]) => applies)?.[1];
	}
}

function roleOf(segment: Segment): AnswerRole {
	if (segment.header.segId === HKTAN.Id) {
		// The HKTAN for a poll authorises the poll, not the payment
		return (segment as HKTANSegment).segId === HKVPP.Id ? 'check' : 'tan';
	}

	return ROLES[segment.header.segId] ?? 'message';
}

function failed(reason: string, uncertain: boolean): Outcome {
	return { status: 'failed', reason, uncertain };
}
