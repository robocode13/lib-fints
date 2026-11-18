import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * The status of one transaction in a payment status report
 */
export type PaymentTransactionStatus = {
	/** The end-to-end reference of the transaction the status is for */
	endToEndId?: string;
	/** The status code, for Verification of Payee one of RCVC, RVMC, RVNM, RVNA, PDNG */
	status?: string;
	/**
	 * The additional information lines of the status reason, e.g. the payee's actual name,
	 * as they stand, spaces at their edges included
	 */
	reasons: string[];
	/** The status reason code, for a check that was not possible AB11 or AG03 */
	reasonCode?: string;
	/** The payee name as submitted in the order */
	creditorName?: string;
	/** The payee IBAN as submitted in the order */
	creditorIban?: string;
};

/**
 * How many transactions have one status (NbOfTxsPerSts)
 */
export type StatusCount = {
	status: string;
	count: number;
};

/**
 * A pain.002 payment status report, as banks send it as the result of Verification of Payee
 */
export type PaymentStatusReport = {
	/** The status of the whole order (group): RCVC, RVCM (with mismatches) or PDNG */
	groupStatus?: string;
	/** The additional information lines of the group status reason, each starting with the
	 * transaction status it is about, such as the bank's notice for the payer */
	groupReasons: string[];
	/** The number of transactions per transaction status in the whole order */
	groupStatusCounts: StatusCount[];
	/** The status of the payment information block, as groupStatus */
	paymentInfoStatus?: string;
	/** The additional information lines of the payment information status reason */
	paymentInfoReasons: string[];
	/** The number of transactions per transaction status in the payment information block */
	paymentInfoStatusCounts: StatusCount[];
	/** The statuses of the individual transactions, empty when the bank only reports group status */
	transactions: PaymentTransactionStatus[];
};

export class Pain002ParsingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'Pain002ParsingError';
	}
}

type XmlNode = Record<string, unknown>;

/**
 * Parses a pain.002 payment status report (any version from pain.002.001.03 on; the
 * elements read here have kept their names and positions).
 * @param xml the document as text
 * @throws Pain002ParsingError when the document is not well-formed or not a payment status report
 */
export function parsePain002(xml: string): PaymentStatusReport {
	const validationResult = XMLValidator.validate(xml);
	if (validationResult !== true) {
		throw new Pain002ParsingError(`Invalid pain.002 XML: ${validationResult.err.msg}`);
	}

	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@',
		textNodeName: '#text',
		removeNSPrefix: true,
		parseAttributeValue: false,
		// Spaces at the edges of a value are kept: a payee name continued on a second line
		// may begin or end with one
		trimValues: false,
		parseTagValue: false,
		processEntities: true,
		// Decodes numeric character references such as &#252; as well
		htmlEntities: true,
		allowBooleanAttributes: false,
	});

	const document = node(parser.parse(xml)?.Document);
	const report = node(document?.CstmrPmtStsRpt);

	if (!report) {
		throw new Pain002ParsingError('Document does not contain a CstmrPmtStsRpt element');
	}

	// The group information is a single element in every version, but tolerate a list
	const groupInfo = list(report.OrgnlGrpInfAndSts)[0];
	const paymentInfos = list(report.OrgnlPmtInfAndSts);

	const transactions: PaymentTransactionStatus[] = [];
	let paymentInfoStatus: string | undefined;
	const paymentInfoReasons: string[] = [];
	const paymentInfoStatusCounts: StatusCount[] = [];

	for (const paymentInfo of paymentInfos) {
		paymentInfoStatus ??= text(paymentInfo.PmtInfSts);
		paymentInfoReasons.push(...reasons(paymentInfo.StsRsnInf));
		paymentInfoStatusCounts.push(...statusCounts(paymentInfo.NbOfTxsPerSts));

		for (const transaction of list(paymentInfo.TxInfAndSts)) {
			const originalReference = node(transaction.OrgnlTxRef);
			const creditor = node(originalReference?.Cdtr);
			// From pain.002.001.08 on, the creditor is wrapped in Pty; before that it is not
			const creditorName = text(node(creditor?.Pty)?.Nm) ?? text(creditor?.Nm);
			const creditorIban = text(node(node(originalReference?.CdtrAcct)?.Id)?.IBAN);

			transactions.push({
				endToEndId: text(transaction.OrgnlEndToEndId),
				status: text(transaction.TxSts),
				reasons: reasons(transaction.StsRsnInf),
				reasonCode: list(transaction.StsRsnInf)
					.map((reason) => text(node(reason.Rsn)?.Cd))
					.find((code) => !!code),
				creditorName,
				creditorIban,
			});
		}
	}

	return {
		groupStatus: text(groupInfo?.GrpSts),
		groupReasons: reasons(groupInfo?.StsRsnInf),
		groupStatusCounts: statusCounts(groupInfo?.NbOfTxsPerSts),
		paymentInfoStatus,
		paymentInfoReasons,
		paymentInfoStatusCounts,
		transactions,
	};
}

function reasons(statusReasons: unknown): string[] {
	return list(statusReasons).flatMap((reason) =>
		toArray(reason.AddtlInf)
			.map(rawText)
			.filter((line): line is string => line !== undefined && line.trim() !== ''),
	);
}

function statusCounts(counts: unknown): StatusCount[] {
	return list(counts).flatMap((entry) => {
		const status = text(entry.DtldSts);
		const count = Number(text(entry.DtldNbOfTxs));
		return status && Number.isInteger(count) ? [{ status, count }] : [];
	});
}

function node(value: unknown): XmlNode | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as XmlNode)
		: undefined;
}

function list(value: unknown): XmlNode[] {
	return toArray(value)
		.map(node)
		.filter((item): item is XmlNode => !!item);
}

function toArray(value: unknown): unknown[] {
	if (value === undefined || value === null) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
}

/**
 * The text of an element, trimmed, as for codes, references and names
 */
function text(value: unknown): string | undefined {
	return rawText(value)?.trim() || undefined;
}

/**
 * The text of an element as it stands
 */
function rawText(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	const textNode = node(value)?.['#text'];
	return typeof textNode === 'string' ? textNode : undefined;
}
