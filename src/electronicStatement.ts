/**
 * An electronic account statement (Elektronischer Kontoauszug) as handed out by the bank.
 *
 * Unlike {@link Statement} this is not a list of parsed transactions but the statement
 * document itself — the same document the bank files in the customer's electronic mailbox,
 * usually a PDF.
 */
export type ElectronicStatement = {
	/** The format of {@link document}, as announced by the bank in the HIEKAS parameters */
	format: string;

	/** Start of the period the statement covers */
	from?: Date;

	/** End of the period the statement covers */
	to?: Date;

	/** The date the statement was created by the bank */
	date?: Date;

	/** The year the statement number refers to, statement numbers restart every year */
	year?: number;

	/** The sequential number of the statement within its year */
	number?: number;

	/** The statement document itself */
	document: Uint8Array;

	/** Information about the closing of the accounting period, when the bank provides it */
	closingInfo?: string;

	/** Information about the conditions of the account, when the bank provides it */
	conditionsInfo?: string;

	/** Advertising text, when the bank provides it */
	advertisement?: string;

	iban?: string;
	bic?: string;

	/** The account holder's name, joined from the up to three name lines the bank sends */
	accountName?: string;

	/**
	 * The receipt for this statement. When the bank requires acknowledgement
	 * (`receiptRequired` in the HIEKAS parameters), it only stops handing out a statement
	 * once it has been acknowledged with this receipt.
	 */
	receipt?: string;
};
