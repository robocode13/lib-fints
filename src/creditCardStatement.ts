export type CreditCardStatement = {
	// Date on which credit card was used
	transactionDate: Date;

	// The value date is the date on which the bank transaction actually takes effect
	// for interest calculation or balance purposes.
	valueDate: Date;

	currency: string;
	amount: number;
	purpose: string;
	// Not every bank reports the original amount, e.g. for payments in the account currency (HKKKU)
	originalCurrency?: string;
	originalAmount?: number;
	exchangeRate?: number;

	// Only reported via HKKKU
	// Date on which the merchant submitted the transaction
	receiptDate?: Date;
	// Merchant name
	remoteName?: string;
	country?: string;
	// Whether the transaction is already part of a credit card statement
	billed?: boolean;
	reference?: string;
};
