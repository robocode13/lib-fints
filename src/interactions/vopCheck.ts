import { XMLValidator } from 'fast-xml-parser';
import type { Message } from '../message.js';
import type { Pain001Message } from '../pain001Builder.js';
import {
	type PaymentStatusReport,
	type PaymentTransactionStatus,
	parsePain002,
} from '../pain002Parser.js';
import type { HIVPPSegment } from '../segments/HIVPP.js';

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
	/**
	 * The pain.002 report, when the bank sent one. When the bank delivers a report in
	 * parts and the last one gives the transaction only as a count, the transaction and
	 * the reason lines of the part that detailed it are included.
	 */
	paymentStatusReport?: PaymentStatusReport;
}

/**
 * The codes that steer what follows a check (DK VoP specification E.8.1): 3076 no strong
 * authentication needed, 3091 no HKVPA needed, 3945 the approval was voided
 */
const FLOW_CODES = [3076, 3091, 3945] as const;
export type FlowCode = (typeof FLOW_CODES)[number];

/**
 * One Verification of Payee check of a transfer, from the answer that starts it to the
 * one that brings its result with the VoP ID: the codes that steer what follows, how
 * to ask for the rest, the pain.002 parts, the notice and the result. A result the bank
 * sends with a later answer is a new check and replaces this one whole.
 */
export class VopCheck {
	/** The VoP ID, once the bank has sent the final part of the result */
	vopId?: string;
	/** The result, once read and found to be about the order */
	result?: VopResult;
	pollingId?: string;
	/** The touchdown point of the latest answer (code 3040), absent when it gave none */
	touchdownPoint?: string;
	waitSeconds?: number;
	private readonly codes = new Set<number>();
	/** The complete pain.002 reports, in the order they arrived */
	private readonly reports: string[] = [];
	/**
	 * The part of a pain.002 received so far: a bank may cut a report into pieces it
	 * sends with successive answers, to be joined in that order (DK VoP specification)
	 */
	private fragment = '';
	/** The single result of the latest HIVPP that carried a result */
	private single?: HIVPPSegment['singleResult'];
	/** Whether the latest HIVPP that carried a result carried a report */
	private reported = false;
	private notice?: string;

	/**
	 * Takes in an answer of this check: the codes that steer what follows, and what its
	 * HIVPP says. The touchdown point comes with code 3040 and, like the wait time, is
	 * read from every answer anew; the optional polling ID is kept once the bank has sent
	 * one (DK VoP specification C.10.7.1.1).
	 */
	take(message: Message, hivpp: HIVPPSegment | undefined): void {
		for (const code of FLOW_CODES) {
			if (message.hasReturnCode(code)) {
				this.codes.add(code);
			}
		}

		this.touchdownPoint =
			message.getBankAnswers().find((answer) => answer.code === 3040)?.params?.[0] || undefined;

		if (!hivpp) {
			return;
		}

		if (hivpp.pollingId) {
			this.pollingId = hivpp.pollingId;
		}

		this.waitSeconds = hivpp.waitSeconds;

		if (hivpp.paymentStatusReport) {
			this.fragment += hivpp.paymentStatusReport;

			if (!this.fragment.trim()) {
				// White space after the end of a report belongs to it, not to a new one
				this.fragment = '';
			} else if (XMLValidator.validate(decodeReport(this.fragment)) === true) {
				this.reports.push(decodeReport(this.fragment));
				this.fragment = '';
			}
		}

		if (hivpp.paymentStatusReport || hivpp.singleResult) {
			this.single = hivpp.singleResult;
			this.reported = !!hivpp.paymentStatusReport;
		}

		if (hivpp.notice !== undefined) {
			this.notice = hivpp.notice;
		}

		if (hivpp.vopId !== undefined) {
			this.vopId = hivpp.vopId;
		}
	}

	/** Whether any answer of this check carried the code */
	has(code: FlowCode): boolean {
		return this.codes.has(code);
	}

	/**
	 * Whether the bank said how to ask for the rest of the result: a touchdown point in the
	 * latest answer. The polling ID goes along with it; alone it is no continuation.
	 */
	canPoll(): boolean {
		return !!this.touchdownPoint;
	}

	/**
	 * Reads the result once the bank has sent its final part, with the VoP ID: from the
	 * latest HIVPP that carried a result, with the details of an earlier report when the
	 * latest one gives the transaction only as a count
	 * @returns the result, or why it cannot be trusted
	 */
	read(order: Pain001Message, noticeStructured: boolean): VopResult | string {
		if (this.vopId === undefined) {
			return 'The bank sent a Verification of Payee result without a VoP ID.';
		}

		let result: VopResult;

		try {
			if (this.fragment) {
				throw new Error('The bank did not deliver the complete payment status report');
			}

			result = interpretVopResult(
				this.single,
				this.reported ? this.reports.map(parsePain002) : [],
				this.notice,
				noticeStructured,
			);
		} catch (error) {
			return `${(error as Error).message}.`;
		}

		const foreign = checkOrder(result, order);

		if (foreign) {
			return foreign;
		}

		this.result = result;
		return result;
	}
}

/**
 * A result counts only for this order: the message and end-to-end references, the IBAN
 * and the payee name a pain.002 repeats from the order must be the submitted ones
 * @returns why the result is not about this order, if it is not
 */
function checkOrder(result: VopResult, order: Pain001Message): string | undefined {
	const report = result.paymentStatusReport;
	const transactions = report?.transactions ?? [];

	if (report?.originalMessageId !== undefined && report.originalMessageId !== order.messageId) {
		return 'The Verification of Payee result is for another order than the transfer.';
	}

	if (transactions.some((t) => t.endToEndId !== undefined && t.endToEndId !== order.endToEndId)) {
		return 'The Verification of Payee result is for another payment than the transfer.';
	}

	const ibans = [result.iban, ...transactions.map((t) => t.creditorIban)].filter(
		(iban): iban is string => !!iban,
	);

	if (ibans.some((iban) => iban.replace(/\s+/g, '').toUpperCase() !== order.creditorIban)) {
		return 'The Verification of Payee result is for another IBAN than the transfer.';
	}

	const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
	const names = transactions.map((t) => t.creditorName).filter((name): name is string => !!name);

	if (names.some((name) => normalizeName(name) !== normalizeName(order.creditorName))) {
		return 'The Verification of Payee result is for another payee name than the transfer.';
	}

	return undefined;
}

const VOP_RESULTS: Record<VopResultCode, VopResult['result']> = {
	RCVC: 'match',
	RVMC: 'closeMatch',
	RVNM: 'noMatch',
	RVNA: 'notApplicable',
};

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

function contradiction(): Error {
	return new Error('The payment status report contradicts itself');
}

/**
 * The status of the one transaction of a transfer in a pain.002: from its own entry,
 * or, when the report lists none, from the number of transactions per status, or from
 * the payment information or group status when that alone decides it. Every count the
 * report gives must name that one transaction with that status.
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
	const countSets = [report.groupStatusCounts, report.paymentInfoStatusCounts]
		.map((counts) => counts.filter((entry) => entry.count > 0))
		.filter((counts) => counts.length);

	if (countSets.some((counts) => counts.length !== 1 || counts[0].count !== 1)) {
		throw new Error('The payment status report does not name one Verification of Payee result');
	}

	const counted = countSets.map((counts) => counts[0].status);

	if (counted.some((code) => code !== counted[0])) {
		throw contradiction();
	}

	if (counted.length && listed.some((code) => code !== counted[0])) {
		throw contradiction();
	}

	let status = listed.length ? (listed.find((code) => code !== 'RCVC') ?? 'RCVC') : counted[0];

	if (status === undefined && aggregates.length) {
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
		throw contradiction();
	}

	return status;
}

/**
 * The latest report, and, when it gives the transaction only as a count, the transaction
 * and reason lines of the latest earlier report that details it with the same status
 */
function combineReports(
	reports: PaymentStatusReport[],
): { report: PaymentStatusReport; status?: string } | undefined {
	const latest = reports.at(-1);

	if (!latest) {
		return undefined;
	}

	const status = reportStatus(latest);

	if (latest.transactions.length || status === undefined) {
		return { report: latest, status };
	}

	const lender = reports
		.slice(0, -1)
		.reverse()
		.find((report) => report.transactions.some((t) => t.status === status));

	// The details lent must agree with everything else that report says
	if (!lender || reportStatus(lender) !== status) {
		return { report: latest, status };
	}

	const unique = (lines: string[]) => [...new Set(lines)];
	return {
		report: {
			...latest,
			groupReasons: unique([...lender.groupReasons, ...latest.groupReasons]),
			paymentInfoReasons: unique([...lender.paymentInfoReasons, ...latest.paymentInfoReasons]),
			transactions: lender.transactions,
		},
		status,
	};
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
	const combined = combineReports(reports);
	const report = combined?.report;
	const codes = [single?.result, combined?.status].filter((code): code is string => !!code);

	for (const code of codes) {
		if (!(code in VOP_RESULTS)) {
			throw unknownResult(code);
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

	return Buffer.from(bytes, 'latin1')
		.toString('utf8')
		.replace(/^\uFEFF/, '');
}
