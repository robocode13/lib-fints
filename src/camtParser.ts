import { Statement, Transaction, Balance } from './statement.js';

export class CamtParser {
	private xmlData: string;

	constructor(xmlData: string) {
		this.xmlData = xmlData;
	}

	parse(): Statement[] {
		try {
			const statements: Statement[] = [];

			// Parse multiple reports using regex (CAMT.053 can contain multiple reports)
			const reportMatches = this.xmlData.match(/<Rpt>[\s\S]*?<\/Rpt>/g);
			if (!reportMatches) {
				return statements;
			}

			for (const reportXml of reportMatches) {
				const statement = this.parseReport(reportXml);
				if (statement) {
					statements.push(statement);
				}
			}

			return statements;
		} catch (error) {
			throw new Error(`Failed to parse CAMT data: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	private parseReport(reportXml: string): Statement | null {
		// Extract account information
		const account = this.extractTagValue(reportXml, 'IBAN');

		// Extract statement number/ID
		const number = this.extractTagValue(reportXml, 'Id');

		// Extract transaction reference
		const transactionReference = this.extractTagValue(reportXml, 'ElctrncSeqNb');

		// Parse balances
		const balances = this.parseBalances(reportXml);
		if (!balances.openingBalance || !balances.closingBalance) {
			return null; // Need at least opening and closing balance
		}

		// Parse transactions
		const transactions = this.parseTransactions(reportXml);

		return {
			account,
			number,
			transactionReference,
			openingBalance: balances.openingBalance,
			closingBalance: balances.closingBalance,
			availableBalance: balances.availableBalance,
			transactions,
		};
	}

	private parseBalances(reportXml: string): {
		openingBalance?: Balance;
		closingBalance?: Balance;
		availableBalance?: Balance;
	} {
		let openingBalance: Balance | undefined;
		let closingBalance: Balance | undefined;
		let availableBalance: Balance | undefined;

		// Extract all balance elements
		const balanceMatches = reportXml.match(/<Bal[\s\S]*?<\/Bal>/g);
		if (!balanceMatches) {
			return { openingBalance, closingBalance, availableBalance };
		}

		for (const balanceXml of balanceMatches) {
			const typeCode = this.extractTagValue(balanceXml, 'Cd');

			// Extract amount and currency
			const amtMatch = balanceXml.match(/<Amt\s+Ccy="([^"]+)">([^<]+)<\/Amt>/);
			const currency = amtMatch ? amtMatch[1] : 'EUR';
			const value = amtMatch ? parseFloat(amtMatch[2]) : 0;

			const creditDebitInd = this.extractTagValue(balanceXml, 'CdtDbtInd');
			const finalValue = creditDebitInd === 'DBIT' ? -value : value;

			const dateStr = this.extractTagValue(balanceXml, 'Dt');
			const date = dateStr ? this.parseDate(dateStr) : new Date();

			const balance: Balance = {
				date,
				currency,
				value: finalValue,
			};

			switch (typeCode) {
				case 'PRCD': // Previous closing date
					openingBalance = balance;
					break;
				case 'CLBD': // Closing booked
					closingBalance = balance;
					break;
				case 'ITBD': // Interim booked
				case 'FWAV': // Forward available
					availableBalance = balance;
					break;
			}
		}

		return { openingBalance, closingBalance, availableBalance };
	}

	private parseTransactions(reportXml: string): Transaction[] {
		const transactions: Transaction[] = [];
		const entryMatches = reportXml.match(/<Ntry[\s\S]*?<\/Ntry>/g);

		if (!entryMatches) {
			return transactions;
		}

		for (const entryXml of entryMatches) {
			const transaction = this.parseTransaction(entryXml);
			if (transaction) {
				transactions.push(transaction);
			}
		}

		return transactions;
	}

	private parseTransaction(entryXml: string): Transaction | null {
		try {
			// Extract amount and credit/debit indicator
			const amtMatch = entryXml.match(/<Amt[^>]*>([^<]+)<\/Amt>/);
			const amountValue = amtMatch ? parseFloat(amtMatch[1]) : 0;
			const creditDebitInd = this.extractTagValue(entryXml, 'CdtDbtInd');
			const isDebit = creditDebitInd === 'DBIT';
			const amount = isDebit ? -amountValue : amountValue;

			// Extract dates
			const bookingDate = this.extractNestedTagValue(entryXml, 'BookgDt', 'Dt');
			const valueDate = this.extractNestedTagValue(entryXml, 'ValDt', 'Dt');

			const entryDate = bookingDate ? this.parseDate(bookingDate) : new Date();
			const parsedValueDate = valueDate ? this.parseDate(valueDate) : entryDate;

			// Extract references
			const accountServicerRef = this.extractTagValue(entryXml, 'AcctSvcrRef') || '';
			const endToEndId = this.extractTagValue(entryXml, 'EndToEndId') || '';
			const mandateId = this.extractTagValue(entryXml, 'MndtId') || '';

			// Extract transaction details
			const additionalEntryInfo = this.extractTagValue(entryXml, 'AddtlNtryInf') || '';
			const remittanceInfo = this.extractTagValue(entryXml, 'Ustrd') || '';

			// Extract remote party information based on transaction type
			let remoteName = '';
			let remoteIBAN = '';
			let remoteBankId = '';

			if (isDebit) {
				// For debit transactions, we want the creditor (receiving party)
				const creditorNameMatch = entryXml.match(/<Cdtr>[\s\S]*?<Nm>([^<]+)<\/Nm>[\s\S]*?<\/Cdtr>/);
				remoteName = creditorNameMatch ? creditorNameMatch[1] : '';

				const creditorIbanMatch = entryXml.match(/<CdtrAcct>[\s\S]*?<IBAN>([^<]+)<\/IBAN>[\s\S]*?<\/CdtrAcct>/);
				remoteIBAN = creditorIbanMatch ? creditorIbanMatch[1] : '';

				// For debit, get creditor's bank BIC
				const creditorBicMatch = entryXml.match(/<CdtrAgt>[\s\S]*?<BIC>([^<]+)<\/BIC>[\s\S]*?<\/CdtrAgt>/);
				remoteBankId = creditorBicMatch ? creditorBicMatch[1] : '';
			} else {
				// For credit transactions, we want the debtor (sending party)
				const debtorNameMatch = entryXml.match(/<Dbtr>[\s\S]*?<Nm>([^<]+)<\/Nm>[\s\S]*?<\/Dbtr>/);
				remoteName = debtorNameMatch ? debtorNameMatch[1] : '';

				const debtorIbanMatch = entryXml.match(/<DbtrAcct>[\s\S]*?<IBAN>([^<]+)<\/IBAN>[\s\S]*?<\/DbtrAcct>/);
				remoteIBAN = debtorIbanMatch ? debtorIbanMatch[1] : '';

				// For credit, get debtor's bank BIC
				const debtorBicMatch = entryXml.match(/<DbtrAgt>[\s\S]*?<BIC>([^<]+)<\/BIC>[\s\S]*?<\/DbtrAgt>/);
				remoteBankId = debtorBicMatch ? debtorBicMatch[1] : '';
			}

			// Extract bank transaction code structure (BkTxCd)
			const bkTxCd = this.parseBankTransactionCode(entryXml);

			return {
				valueDate: parsedValueDate,
				entryDate,
				fundsCode: bkTxCd.domainCode || creditDebitInd || '',
				amount,
				transactionType: bkTxCd.familyCode || '',
				customerReference: endToEndId,
				bankReference: accountServicerRef,
				transactionCode: bkTxCd.subFamilyCode || '',
				purpose: remittanceInfo,
				remoteName,
				remoteAccountNumber: remoteIBAN,
				remoteBankId,
				e2eReference: endToEndId,
				mandateReference: mandateId,
				additionalInformation: additionalEntryInfo,
				bookingText: additionalEntryInfo,
			};
		} catch (error) {
			console.warn('Failed to parse CAMT transaction entry:', error);
			return null;
		}
	}

	private parseDate(dateStr: string): Date {
		// Parse ISO date format (YYYY-MM-DD)
		if (dateStr.length === 10 && dateStr.includes('-')) {
			return new Date(dateStr + 'T12:00:00'); // Set time to noon to avoid timezone issues
		}

		// Parse CAMT date format (YYYYMMDD)
		if (dateStr.length === 8) {
			const year = parseInt(dateStr.substring(0, 4), 10);
			const month = parseInt(dateStr.substring(4, 6), 10) - 1; // Month is 0-based
			const day = parseInt(dateStr.substring(6, 8), 10);
			return new Date(year, month, day, 12);
		}

		return new Date(dateStr);
	}

	private extractTagValue(xml: string, tagName: string): string | undefined {
		const pattern = new RegExp(`<${tagName}>([^<]*)<\\/${tagName}>`, 'i');
		const match = xml.match(pattern);
		return match ? match[1] : undefined;
	}

	private extractNestedTagValue(xml: string, parentTag: string, childTag: string): string | undefined {
		const parentPattern = new RegExp(`<${parentTag}[\\s\\S]*?<\\/${parentTag}>`, 'i');
		const parentMatch = xml.match(parentPattern);
		if (!parentMatch) {
			return undefined;
		}
		return this.extractTagValue(parentMatch[0], childTag);
	}

	private parseBankTransactionCode(entryXml: string): {
		domainCode?: string;
		familyCode?: string;
		subFamilyCode?: string;
	} {
		// Extract the entire BkTxCd block
		const bkTxCdMatch = entryXml.match(/<BkTxCd>[\s\S]*?<\/BkTxCd>/);
		if (!bkTxCdMatch) {
			return {};
		}

		const bkTxCdXml = bkTxCdMatch[0];

		// Extract Domain Code (first level - e.g., "PMNT")
		const domainCode = this.extractNestedTagValue(bkTxCdXml, 'Domn', 'Cd');

		// Extract Family Code (second level - e.g., "CCRD")
		const familyCode = this.extractNestedTagValue(bkTxCdXml, 'Fmly', 'Cd');

		// Extract SubFamily Code (third level - e.g., "POSD")
		const subFamilyCode = this.extractTagValue(bkTxCdXml, 'SubFmlyCd');

		return {
			domainCode,
			familyCode,
			subFamilyCode,
		};
	}
}
