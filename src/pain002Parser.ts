import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * The status of one transaction in a payment status report
 */
export type PaymentTransactionStatus = {
	/** The end-to-end reference of the transaction the status is for */
	endToEndId?: string;
	/** The status code, for Verification of Payee one of RCVC, RVMC, RVNM, RVNA, PDNG */
	status?: string;
	/** The additional information lines of the status reason, e.g. the payee's actual name */
	reasons: string[];
	/** The payee name as submitted in the order */
	creditorName?: string;
	/** The payee IBAN as submitted in the order */
	creditorIban?: string;
};

/**
 * A pain.002 payment status report, as banks send it as the result of Verification of Payee
 */
export type PaymentStatusReport = {
	/** The status of the whole order (group) */
	groupStatus?: string;
	/** The additional information lines of the group status reason */
	groupReasons: string[];
	/** The status of the payment information block */
	paymentInfoStatus?: string;
	/** The additional information lines of the payment information status reason */
	paymentInfoReasons: string[];
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
		trimValues: true,
		parseTagValue: false,
		processEntities: true,
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

	for (const paymentInfo of paymentInfos) {
		paymentInfoStatus ??= text(paymentInfo.PmtInfSts);
		paymentInfoReasons.push(...reasons(paymentInfo.StsRsnInf));

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
				creditorName,
				creditorIban,
			});
		}
	}

	return {
		groupStatus: text(groupInfo?.GrpSts),
		groupReasons: reasons(groupInfo?.StsRsnInf),
		paymentInfoStatus,
		paymentInfoReasons,
		transactions,
	};
}

function reasons(statusReasons: unknown): string[] {
	return list(statusReasons).flatMap((reason) =>
		toArray(reason.AddtlInf)
			.map(text)
			.filter((line): line is string => !!line),
	);
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

function text(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value || undefined;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	const textNode = node(value)?.['#text'];
	return typeof textNode === 'string' && textNode ? textNode : undefined;
}
