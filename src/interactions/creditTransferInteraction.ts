import { randomBytes } from 'node:crypto';
import { XMLValidator } from 'fast-xml-parser';
import type { FinTSConfig } from '../config.js';
import type { InternationalAccount } from '../dataGroups/InternationalAccount.js';
import type { Message } from '../message.js';
import type { Pain001Message } from '../pain001Builder.js';
import {
	type PaymentStatusReport,
	type PaymentTransactionStatus,
	parsePain002,
} from '../pain002Parser.js';
import type { Segment } from '../segment.js';
import { HIRMG, type HIRMGSegment } from '../segments/HIRMG.js';
import { HIRMS, type HIRMSSegment } from '../segments/HIRMS.js';
import { HIVPP, type HIVPPSegment } from '../segments/HIVPP.js';
import { HKCCS, type HKCCSSegment } from '../segments/HKCCS.js';
import { HKVPA, type HKVPASegment } from '../segments/HKVPA.js';
import { HKVPP, type HKVPPSegment } from '../segments/HKVPP.js';
import { HNHBK, type HNHBKSegment } from '../segments/HNHBK.js';
import { type ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';
import {
	type AnswerRole,
	type MessageAnswers,
	type Outcome,
	type Proposal,
	TransferEvidence,
} from './transferOutcome.js';

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

const VOP_RESULTS: Record<VopResultCode, VopResult['result']> = {
	RCVC: 'match',
	RVMC: 'closeMatch',
	RVNM: 'noMatch',
	RVNA: 'notApplicable',
};

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
	/** Every bank answer to this order, and what they say became of it */
	readonly evidence = new TransferEvidence();
	/** The response of the latest message this order's interactions handled */
	lastResponse?: TransferResponse;
	/** The latest HIVPP that carried a result, for a final HIVPP that carries only the VoP ID */
	private resultSegment?: HIVPPSegment;
	/** The complete pain.002 reports of the current check, in the order they arrived */
	private reports: string[] = [];
	/**
	 * The part of a pain.002 received so far: a bank may cut a report into pieces it
	 * sends with successive answers, to be joined in that order (DK VoP specification)
	 */
	private reportFragment = '';
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
	 * 3040 and, like the wait time, is read from every response anew; the optional
	 * polling ID is kept once the bank has sent one (DK VoP specification C.10.7.1.1).
	 */
	track(message: Message, hivpp: HIVPPSegment) {
		this.touchdownPoint =
			message.getBankAnswers().find((answer) => answer.code === 3040)?.params?.[0] || undefined;

		if (hivpp.pollingId) {
			this.pollingId = hivpp.pollingId;
		}

		this.waitSeconds = hivpp.waitSeconds;
		this.collect(hivpp);
	}

	/**
	 * Whether the bank said how to ask for the rest of the result: a touchdown point in
	 * the latest answer, or a polling ID
	 */
	canPoll(): boolean {
		return !!this.touchdownPoint || !!this.pollingId;
	}

	/**
	 * Reads the result from the reports and the single result received so far for the
	 * final HIVPP (which track() or takeNewerResult() has taken in): from the latest HIVPP
	 * that carried a result, with the details of an earlier report when the latest one
	 * gives the transaction only as a count
	 * @returns the result, or why it cannot be trusted
	 */
	readResult(final: HIVPPSegment): VopResult | string {
		const source = final.paymentStatusReport || final.singleResult ? final : this.resultSegment;
		let result: VopResult;

		try {
			if (this.reportFragment) {
				throw new Error('The bank did not deliver the complete payment status report');
			}

			result = interpretVopResult(
				source?.singleResult,
				source?.paymentStatusReport ? this.reports.map(parsePain002) : [],
				final.notice ?? source?.notice,
				this.vopParameters?.noticeStructured ?? false,
			);
		} catch (error) {
			return `${(error as Error).message}.`;
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

		// A result sent with a later answer is a new check, not a continuation
		this.reports = [];
		this.reportFragment = '';
		this.collect(hivpp);
		const result = this.readResult(hivpp);

		if (typeof result === 'string') {
			return result;
		}

		this.vopResult = result;

		if (hivpp.vopId !== undefined) {
			this.vopId = hivpp.vopId;
		}

		return undefined;
	}

	/**
	 * Takes in the result parts of a HIVPP: a pain.002 piece is joined to the pieces
	 * before it until the report is complete
	 */
	private collect(hivpp: HIVPPSegment) {
		if (hivpp.paymentStatusReport) {
			this.reportFragment += hivpp.paymentStatusReport;

			if (XMLValidator.validate(decodeReport(this.reportFragment)) === true) {
				this.reports.push(decodeReport(this.reportFragment));
				this.reportFragment = '';
			}
		}

		if (hivpp.paymentStatusReport || hivpp.singleResult) {
			this.resultSegment = hivpp;
		}
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
			return 'The Verification of Payee result is for another IBAN than the transfer.';
		}

		const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
		const names = transactions.map((t) => t.creditorName).filter((name): name is string => !!name);

		if (names.some((name) => normalizeName(name) !== normalizeName(this.pain.creditorName))) {
			return 'The Verification of Payee result is for another payee name than the transfer.';
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
	return interpretVopResult(
		hivpp.singleResult,
		hivpp.paymentStatusReport ? [parsePain002(decodeReport(hivpp.paymentStatusReport))] : [],
		notice,
		noticeStructured,
	);
}

/** The transaction codes of a pain.002 about a payee check (DFÜ-Abkommen Anlage 3) */
const TRANSACTION_CODES = ['RCVC', 'RVMC', 'RVNM', 'RVNA', 'PDNG'];

/**
 * The group and payment information codes: RCVC when every transaction matches, RVCM
 * when some do not, PDNG while the check runs. The transaction codes of a deviation are
 * taken for RVCM as well.
 */
const AGGREGATE_CODES: Record<string, 'match' | 'deviation' | 'pending'> = {
	RCVC: 'match',
	RVCM: 'deviation',
	RVMC: 'deviation',
	RVNM: 'deviation',
	RVNA: 'deviation',
	PDNG: 'pending',
};

/** The length of the first additional information line that holds a payee name */
const NAME_LINE_LENGTH = 105;

function unknownResult(code: string): Error {
	return new Error(`The bank reported the unknown Verification of Payee result '${code}'`);
}

/**
 * The status of the one transaction of a transfer in a pain.002: from its own entry,
 * or, when the report lists none, from the number of transactions per status, or from
 * the payment information or group status when that alone decides it
 */
function reportStatus(report: PaymentStatusReport): string | undefined {
	const aggregates = [report.paymentInfoStatus, report.groupStatus].filter(
		(code): code is string => !!code,
	);

	for (const code of aggregates) {
		if (!(code in AGGREGATE_CODES)) {
			throw unknownResult(code);
		}
	}

	const listed = report.transactions
		.map((transaction) => transaction.status)
		.filter((code): code is string => !!code);
	const counts = (
		report.paymentInfoStatusCounts.length
			? report.paymentInfoStatusCounts
			: report.groupStatusCounts
	).filter((entry) => entry.count > 0);
	let status: string | undefined;

	if (listed.length) {
		status = listed.find((code) => code !== 'RCVC') ?? 'RCVC';
	} else if (counts.length) {
		if (counts.length !== 1 || counts[0].count !== 1) {
			throw new Error('The payment status report does not name one Verification of Payee result');
		}
		status = counts[0].status;
	} else if (aggregates.length) {
		if (AGGREGATE_CODES[aggregates[0]] === 'deviation') {
			throw new Error(
				'The payment status report names a deviation without the result of the transaction',
			);
		}
		status = aggregates[0];
	}

	if (status === undefined) {
		return undefined;
	}

	if (!TRANSACTION_CODES.includes(status)) {
		throw unknownResult(status);
	}

	const kind = AGGREGATE_CODES[status];

	if (
		aggregates.some(
			(code) =>
				(AGGREGATE_CODES[code] === 'match' && kind !== 'match') ||
				(AGGREGATE_CODES[code] === 'deviation' && kind === 'match'),
		)
	) {
		throw new Error('The payment status report contradicts itself');
	}

	return status;
}

/**
 * The payee name of a close match: the first additional information line, continued
 * in the second when it is longer than 105 characters; the continuation begins with
 * the quote mark “, which is not part of the name
 */
function suggestedNameOf(transaction: PaymentTransactionStatus | undefined): string | undefined {
	const [first, second] = transaction?.reasons ?? [];

	if (first === undefined) {
		return undefined;
	}

	const continued =
		second !== undefined && (first.length >= NAME_LINE_LENGTH || second.startsWith('“'));
	return (continued ? first + second.replace(/^“/, '') : first).trim();
}

/**
 * Reads a Verification of Payee result from a single result and the complete pain.002
 * reports of a check, in the order they arrived. The latest report decides; an earlier
 * one only lends the details of a transaction with the status the latest one gives.
 */
function interpretVopResult(
	single: HIVPPSegment['singleResult'],
	reports: PaymentStatusReport[],
	notice: string | undefined,
	noticeStructured: boolean,
): VopResult {
	const report = reports.at(-1);
	const codes = [single?.result, report ? reportStatus(report) : undefined].filter(
		(code): code is string => !!code,
	);

	for (const code of codes) {
		if (!(code in VOP_RESULTS)) {
			throw unknownResult(code);
		}
	}

	const code = codes.length
		? ((codes.find((c) => c !== 'RCVC') ?? 'RCVC') as VopResultCode)
		: undefined;
	const transaction =
		[...reports]
			.reverse()
			.flatMap((r) => r.transactions)
			.find((t) => t.status === code) ?? report?.transactions[0];

	return {
		// The DK specification allows a HIVPP without a result where none can exist
		// ("notprovided" as the VoP ID); the caller still has to decide
		result: code ? VOP_RESULTS[code] : 'notApplicable',
		code,
		iban: single?.iban ?? transaction?.creditorIban,
		// In a pain.002 the payee bank's name for a close match is the transaction's
		// status reason line (DFÜ-Abkommen Anlage 3, 2.2.6)
		suggestedName:
			single?.closeMatchName ?? (code === 'RVMC' ? suggestedNameOf(transaction) : undefined),
		notApplicableReason:
			single?.notApplicableReason ?? (code === 'RVNA' ? transaction?.reasonCode : undefined),
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

/** What the answers to each segment of a transfer message are about */
const ROLES: Record<string, AnswerRole> = {
	[HKCCS.Id]: 'payment',
	[HKVPP.Id]: 'check',
	[HKVPA.Id]: 'authorization',
};

/**
 * What the transfer interactions share: the order state, the evaluation of every
 * answer against it, and holding the dialog open while the bank or the caller has
 * to act before the next message.
 *
 * Every answer goes into the order's evidence first; the interaction then reads what
 * the Verification of Payee allows next, and the evidence decides the outcome
 * (TransferEvidence). Nothing that can move money is sent without the caller seeing the
 * VoP result first, unless the bank itself executes the order on the first message (DK
 * VoP specification E.8.1 rule 2: codes 3091 and 3076). Anything unexpected ends the
 * transfer with `success: false` instead of sending another message.
 */
abstract class TransferOrderInteraction extends CustomerOrderInteraction {
	/** This interaction's segments in the message just sent */
	private sent: Segment[] = [];

	constructor(
		segId: string,
		public order: CreditTransferOrder,
	) {
		super(segId, HIVPP.Id);
	}

	override getSegments(config: FinTSConfig): Segment[] {
		this.sent = this.createSegments(config);
		return this.sent;
	}

	override getTanMessageSegments(_config: FinTSConfig): Segment[] {
		this.sent = this.createTanMessageSegments();
		return this.sent;
	}

	/** Segments to send in front of HKTAN in a TAN message */
	protected createTanMessageSegments(): Segment[] {
		return [];
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

		this.order.evidence.record(this.readAnswers(message, base, unreadable));
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

	/**
	 * The bank's answers by the segment they refer to. HKTAN follows this interaction's
	 * segments directly; every other segment, and HIRMG, stands for the message.
	 */
	private readAnswers(
		message: Message,
		base: ClientResponse,
		unreadable: string | undefined,
	): MessageAnswers {
		const tanSegNr = Math.max(2, ...this.sent.map((segment) => segment.header.segNr)) + 1;
		const roleOf = (refSegNr: number): AnswerRole => {
			const segment = this.sent.find((s) => s.header.segNr === refSegNr);
			return segment
				? (ROLES[segment.header.segId] ?? 'message')
				: refSegNr === tanSegNr
					? 'tan'
					: 'message';
		};

		return {
			answers: [
				...message
					.findAllSegments<HIRMGSegment>(HIRMG.Id)
					.flatMap((hirmg) => hirmg.answers.map((a) => ({ ...a, role: 'message' as const }))),
				...message
					.findAllSegments<HIRMSSegment>(HIRMS.Id)
					.flatMap((hirms) =>
						hirms.answers.map((a) => ({ ...a, role: roleOf(hirms.header.refSegNr ?? 0) })),
					),
			],
			carriesPayment: this.sent.some((segment) => segment.header.segId === HKCCS.Id),
			tanRequested: base.requiresTan || unreadable !== undefined,
			unreadable,
		};
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
	 * The answer to the TAN message, whichever step asked for the TAN
	 */
	protected evaluateTan(message: Message, base: ClientResponse): Proposal {
		const untrusted = this.order.takeNewerResult(findHivpp(message));

		if (untrusted) {
			return { stop: untrusted };
		}

		if (message.hasReturnCode(3945)) {
			// The bank voided the approval and wants HKVPA with the order (E.8.1 rule 5)
			if (this.order.vopParameters && this.order.vopId !== undefined && !this.order.confirmed) {
				return 'confirmation';
			}

			return { stop: 'The bank refused the approval (3945).' };
		}

		if (base.requiresTan) {
			// Decoupled approval still pending (3956), or another TAN asked for
			return 'tan';
		}

		if (message.hasReturnCode(3958)) {
			return { stop: 'The approval app does not support the approval of this order (3958).' };
		}

		return 'none';
	}

	/**
	 * The answer to the message that carries HKVPA, the caller's authorisation despite the
	 * result: the bank may still ask for the TAN
	 */
	protected evaluateAuthorization(message: Message, base: ClientResponse): Proposal {
		const untrusted = this.order.takeNewerResult(findHivpp(message));

		if (untrusted) {
			return { stop: untrusted };
		}

		if (message.hasReturnCode(3945)) {
			return { stop: 'The bank refused the authorisation (3945).' };
		}

		if (base.requiresTan) {
			// HKVPA has gone; the TAN message carries none
			this.order.sendVopAuthorizationWithTan = false;
			return 'tan';
		}

		return 'none';
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
			vop: this.order.vopResult,
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

	protected override createTanMessageSegments(): Segment[] {
		// After a match without 3091, HKVPA goes with the TAN (E.8.1, figure 3); only
		// with the first TAN message, not with the status requests of a decoupled method
		if (this.order.status === 'awaitingTan' && this.order.sendVopAuthorizationWithTan) {
			this.order.sendVopAuthorizationWithTan = false;
			return [this.order.createHkvpa()];
		}

		return [];
	}

	protected evaluate(message: Message, base: ClientResponse): Proposal {
		if (this.order.status === 'awaitingTan') {
			return this.evaluateTan(message, base);
		}

		if (this.step === 'confirm') {
			return this.evaluateAuthorization(message, base);
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
			return {
				stop: 'The bank reported a Verification of Payee its parameters do not announce for HKCCS; synchronize to update the bank parameters.',
			};
		}

		return base.requiresTan ? 'tan' : 'none';
	}

	private evaluateSubmitWithVop(message: Message, base: ClientResponse): Proposal {
		// Searched in every answer, not only the HKTAN's: Commerzbank attaches 3945
		// elsewhere (observed at that bank, reported in python-fints PR #223)
		const approvalVoided = message.hasReturnCode(3945);
		const hivpp = findHivpp(message);

		if (hivpp) {
			this.order.track(message, hivpp);
		}

		if (
			!base.requiresTan &&
			!approvalVoided &&
			message.hasReturnCode(3091) &&
			message.hasReturnCode(3076)
		) {
			// The bank waived the check and the strong authentication and executed the order
			// (E.8.1 rule 2; Hamburger Sparkasse does this, as reported to python-fints); the
			// result is for information only
			const result = hivpp ? this.order.readResult(hivpp) : undefined;
			this.order.vopResult = typeof result === 'object' ? result : undefined;
			return 'executed';
		}

		if (!hivpp) {
			return { stop: 'The bank answered without a Verification of Payee result.' };
		}

		if (hivpp.vopId === undefined) {
			// Atruvia banks check asynchronously: polling ID, touchdown point (3040) and
			// code 3905 instead of a challenge (observed there, reported in python-fints
			// PR #223). A TAN request before the result is complete is not expected.
			return this.order.canPoll() && !base.requiresTan
				? 'poll'
				: { stop: 'The bank sent a Verification of Payee result without a VoP ID.' };
		}

		const result = this.order.readResult(hivpp);

		if (typeof result === 'string') {
			return { stop: result };
		}

		this.order.vopId = hivpp.vopId;
		this.order.vopResult = result;

		// The codes decide the flow, not the result (E.8.1): 3945 voids the approval
		// even for a match
		if (base.requiresTan && !approvalVoided && result.result === 'match') {
			// 3091: the bank needs no HKVPA, the TAN alone answers the challenge (rule 3)
			this.order.sendVopAuthorizationWithTan = !message.hasReturnCode(3091);
			return 'tan';
		}

		// A match the bank holds and needs no SCA for: the caller decides, and HKVPA alone
		// authorises the held order
		this.order.authorizationOnly =
			!base.requiresTan &&
			!approvalVoided &&
			result.result === 'match' &&
			message.hasReturnCode(3076) &&
			!message.hasReturnCode(3091);

		if (this.order.authorizationOnly) {
			this.order.evidence.hold();
		}

		// A deviation, or a match the bank wants confirmed: the caller decides. A TAN
		// the bank asked for anyway is dropped; the confirm step brings a new one.
		return 'confirmation';
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
		return this.order.status === 'awaitingTan'
			? this.evaluateTan(message, base)
			: this.evaluateAuthorization(message, base);
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

		this.order.track(message, hivpp);

		if (hivpp.vopId === undefined) {
			// The VoP ID comes with the final part of the result (C.10.7.1.1)
			return this.order.canPoll()
				? 'poll'
				: { stop: 'The bank sent a Verification of Payee result without a VoP ID.' };
		}

		const result = this.order.readResult(hivpp);

		if (typeof result === 'string') {
			return { stop: result };
		}

		this.order.vopId = hivpp.vopId;
		this.order.vopResult = result;

		// No challenge was issued yet, so even a match goes back to the caller: the
		// confirm step may execute the order straight away where no TAN is needed
		return 'confirmation';
	}
}
