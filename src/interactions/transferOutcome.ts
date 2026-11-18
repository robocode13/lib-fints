import type { Answer } from '../segments/HIRMG.js';

/**
 * What a bank answer to a message of a transfer is about: the payment (HKCCS), the payee
 * check (HKVPP), the authorisation of its result (HKVPA), the TAN (HKTAN), or the message
 * as a whole (HIRMG, and HIRMS to any other segment)
 */
export type AnswerRole = 'payment' | 'check' | 'authorization' | 'tan' | 'message';

/** The bank's answers to one message of a transfer, by what they are about */
export type MessageAnswers = {
	answers: (Answer & { role: AnswerRole })[];
	/**
	 * Whether the message carried the payment (HKCCS). The answers to a message that does
	 * not, a TAN message or HKVPA alone, stand for the payment through HKVPA and HKTAN.
	 */
	carriesPayment: boolean;
	/** Whether the bank asked for a TAN */
	tanRequested: boolean;
	/** Why the answer could not be read, if it could not, such as a TAN request without HITAN */
	unreadable?: string;
};

/** The next step an interaction offers, as far as the Verification of Payee is concerned */
export type Continuation = 'confirmation' | 'tan' | 'poll';

/**
 * What an interaction reads from an answer beyond the codes: a continuation; 'executed'
 * when the codes of the check say the bank executed the order without a challenge (3091
 * with 3076, DK VoP specification E.8.1 rule 2); 'none' when it has nothing to offer and
 * the codes alone decide; or why the transfer has to stop, `uncertain` when the bank may
 * execute it all the same, such as with an approval still open
 */
export type Proposal = Continuation | 'executed' | 'none' | { stop: string; uncertain?: boolean };

export type Outcome =
	| { status: 'accepted' }
	| { status: Continuation }
	| { status: 'failed'; reason: string; uncertain: boolean };

const NOT_EXECUTED = 'The transfer was not executed.';
const CHECK_ACCOUNT = 'Check the account before sending the transfer again.';

/** 0010: received ("entgegengenommen", not legally binding); 0020: executed (DK return codes B.1) */
const RECEIVED = 10;
const EXECUTED = 20;
/** The bank processes the order under the reference it gives */
const PROCESSING = 3070;
/** 9000: the status of the order is indifferent */
const STATUS_INDIFFERENT = 9000;
/** The approval was voided: the order goes again with a new HKTAN and HKVPA */
const APPROVAL_VOIDED = 3945;
/** The bank is not done with the order: 3040 more to come, 3093 the check is still running */
const PENDING = [3040, 3093];

/**
 * Every bank answer of one transfer, by message and by the segment it refers to, and the
 * one place that decides from them what became of the transfer. The order of the
 * decision is fixed:
 * 1. Execution of the payment (0020 to it, or 3091 with 3076) means executed; if the same
 *    answer contradicts it, the outcome is uncertain. Nothing is offered afterwards.
 * 2. An error the bank gives to the payment itself, in a message without its receipt,
 *    means rejected.
 * 3. Once the bank has received the payment (0010 or 3070 to it, or an order it holds for
 *    HKVPA alone), any other failure means uncertain; so does 9000.
 * 4. A receipt alone is not an execution: without a continuation it means uncertain.
 * 5. Only then: the caller's decision, a TAN, or the next poll.
 */
export class TransferEvidence {
	private readonly messages: MessageAnswers[] = [];
	/** Whether the bank holds the order for an authorisation by HKVPA alone */
	private held = false;

	/** Takes in the answers to a message, before decide() */
	record(message: MessageAnswers): void {
		this.messages.push(message);
	}

	/** The bank holds the order for an authorisation by HKVPA alone (3076 after a match) */
	hold(): void {
		this.held = true;
	}

	/** The reference of 3070 to the payment, possibly empty, once the bank has sent one */
	get processingReference(): string | undefined {
		const processing = this.messages
			.flatMap((message) => paymentAnswers(message))
			.find((answer) => answer.code === PROCESSING);
		return processing ? (processing.params?.[0] ?? '') : undefined;
	}

	/**
	 * Why the transfer stops after a step that got no answer in time, such as polling that
	 * took too long, and whether the bank may execute it all the same
	 */
	giveUp(reason: string): { reason: string; uncertain: boolean } {
		const outcome = this.decide({ stop: reason }, false);
		return outcome.status === 'failed' ? outcome : { reason, uncertain: true };
	}

	/**
	 * Decides what became of the transfer after the latest answer recorded, or, with
	 * `answered` false, after a step that got no answer (such as polling that took too long)
	 */
	decide(proposal: Proposal, answered = true): Outcome {
		const current = answered ? this.messages.at(-1) : undefined;
		const codes = current?.answers.map((answer) => answer.code) ?? [];
		const payment = current ? paymentAnswers(current).map((answer) => answer.code) : [];

		if (this.executed() || proposal === 'executed') {
			const contradicted =
				!!current &&
				(!!current.unreadable ||
					current.tanRequested ||
					codes.some((code) => code >= STATUS_INDIFFERENT || code === APPROVAL_VOIDED) ||
					payment.some((code) => PENDING.includes(code)));

			return contradicted
				? failed(
						`The bank reported the transfer as executed, but its other answers contradict that; see bankAnswers. ${CHECK_ACCOUNT}`,
						true,
					)
				: { status: 'accepted' };
		}

		const paymentRejected =
			!!current?.carriesPayment && payment.some((code) => code >= STATUS_INDIFFERENT);
		const reason =
			current?.unreadable ??
			(paymentRejected
				? 'The bank rejected the order, see bankAnswers.'
				: codes.some((code) => code >= STATUS_INDIFFERENT)
					? 'The bank answered with an error, see bankAnswers.'
					: typeof proposal === 'object'
						? proposal.stop
						: undefined);
		const receivedNow = payment.some((code) => code === RECEIVED || code === PROCESSING);
		const received = this.describeReceipt();

		if (reason !== undefined) {
			if (codes.includes(STATUS_INDIFFERENT)) {
				return failed(
					`The bank did not say whether it executed the transfer (9000) and may have executed it. ${CHECK_ACCOUNT}`,
					true,
				);
			}

			// Only a rejection of the payment itself, with no receipt next to it, undoes an
			// earlier receipt
			if (received && !(paymentRejected && !receivedNow)) {
				return failed(`${reason} The bank ${received} and may execute it. ${CHECK_ACCOUNT}`, true);
			}

			if (typeof proposal === 'object' && proposal.uncertain && reason === proposal.stop) {
				return failed(`${reason} ${CHECK_ACCOUNT}`, true);
			}

			return failed(`${reason} ${NOT_EXECUTED}`, false);
		}

		if (proposal === 'none') {
			return failed(
				received
					? `The bank ${received}, but did not confirm that it executed it. ${CHECK_ACCOUNT}`
					: `The bank did not confirm the outcome of the transfer and may have executed it. ${CHECK_ACCOUNT}`,
				true,
			);
		}

		const reference = this.processingReference;

		if (proposal === 'confirmation' && reference !== undefined) {
			// A confirmation would send the order again, which the bank already processes
			return failed(
				`The bank processes the transfer under the reference ${reference || '(none given)'} (3070) and did not confirm its outcome; it may execute it. ${CHECK_ACCOUNT}`,
				true,
			);
		}

		return { status: proposal as Continuation };
	}

	/** Whether any answer says the bank executed the payment (0020 to it) */
	private executed(): boolean {
		return this.messages.some((message) =>
			paymentAnswers(message).some((answer) => answer.code === EXECUTED),
		);
	}

	/** What says the bank has the payment, for the failure reason, if anything does */
	private describeReceipt(): string | undefined {
		const reference = this.processingReference;

		if (reference !== undefined) {
			return `processes the transfer under the reference ${reference || '(none given)'} (3070)`;
		}

		if (this.held) {
			return 'holds the transfer for its authorisation';
		}

		const received = this.messages.some((message) =>
			paymentAnswers(message).some((answer) => answer.code === RECEIVED),
		);
		return received ? 'received the transfer (0010)' : undefined;
	}
}

/**
 * The answers about the payment: those to HKCCS, and, in a message without it, those to
 * HKVPA and HKTAN, which stand for it
 */
function paymentAnswers(message: MessageAnswers): Answer[] {
	const roles: AnswerRole[] = message.carriesPayment ? ['payment'] : ['authorization', 'tan'];
	return message.answers.filter((answer) => roles.includes(answer.role));
}

function failed(reason: string, uncertain: boolean): Outcome {
	return { status: 'failed', reason, uncertain };
}
