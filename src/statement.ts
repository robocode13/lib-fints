export interface Statement {
	transactionReference?: string;
	relatedReference?: string;
	account?: string;
	number?: string;
	openingBalance: Balance;
	transactions: Transaction[];
	closingBalance: Balance;
	availableBalance?: Balance;
	forwardBalances?: Balance[];
}

export interface Transaction {
	valueDate: Date;
	entryDate: Date;
	fundsCode: string;
	amount: number;
	transactionType: string;
	customerReference: string;
	bankReference: string;
	transactionCode?: string;
	bookingText?: string;
	primeNotesNr?: string;
	purpose?: string;
	remoteBankId?: string;
	remoteAccountNumber?: string;
	remoteName?: string;
	remoteIdentifier?: string;
	client?: string;
	e2eReference?: string;
	mandateReference?: string;
	textKeyExtension?: string;
	additionalInformation?: string;
}

export interface Balance {
	date: Date;
	currency: string;
	value: number;
}
