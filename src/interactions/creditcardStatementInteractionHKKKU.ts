import { type AccountRef, describeAccount } from '../bankAccount.js';
import type { FinTSConfig } from '../config.js';
import type { CreditCardStatement } from '../creditCardStatement.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HIKKU, type HIKKUSegment } from '../segments/HIKKU.js';
import type { HIKKUSParameter } from '../segments/HIKKUS.js';
import { HKKKU, type HKKKUSegment } from '../segments/HKKKU.js';
import type { CreditCardStatementResponse } from './creditcardStatementInteraction.js';
import { CustomerOrderInteraction } from './customerInteraction.js';

/**
 * Splits one raw data element group at unescaped ':' and resolves the escape character '?'
 */
function splitGroup(raw: string): string[] {
	const parts: string[] = [];
	let current = '';
	for (let i = 0; i < raw.length; i++) {
		const c = raw[i];
		if (c === '?' && i + 1 < raw.length) {
			current += raw[i + 1];
			i++;
		} else if (c === ':') {
			parts.push(current);
			current = '';
		} else {
			current += c;
		}
	}
	parts.push(current);
	return parts;
}

function parseGermanFloat(value: string): number {
	return Number.parseFloat(value.replaceAll('.', '').replaceAll(',', '.'));
}

function parseDate(value: string | undefined): Date | undefined {
	if (!value || value.length < 8) {
		return undefined;
	}
	return new Date(
		Number.parseInt(value.substring(0, 4), 10),
		Number.parseInt(value.substring(4, 6), 10) - 1,
		Number.parseInt(value.substring(6, 8), 10),
	);
}

function signed(value: string, creditDebit: string): number {
	const amount = parseGermanFloat(value);
	return creditDebit === 'D' ? -amount : amount;
}

/**
 * Credit card transactions via HKKKU/HIKKU (DK G112 / CR 538), the successor of DKKKU.
 *
 * Entry layout ("Umsatz Kreditkartenkonto"): 0 card number, 1 receipt date, 2 booking date,
 * 3 statement date, 4 value date, 5..7 original amount (value, currency, D/C), 8 exchange rate,
 * 9..11 booking amount (value, currency, D/C), 12..19 description lines, 20 country,
 * 21 merchant name, 22 terminal, 23 billed (J/N), 24 booking reference.
 */
export class CreditCardStatementInteractionHKKKU extends CustomerOrderInteraction {
	constructor(
		public account: AccountRef,
		public from?: Date,
		public to?: Date,
	) {
		super(HKKKU.Id, HIKKU.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		const bankAccount = init.getBankAccount(this.account);
		if (!init.isAccountTransactionSupported(this.account, this.segId)) {
			throw Error(
				`Account ${describeAccount(this.account)} does not support business transaction '${this.segId}'`,
			);
		}

		// Without parameters send the account and the period, which is what banks allow most often
		const params = init.getTransactionParameters<HIKKUSParameter>(HKKKU.Id);
		const accountRequired = params?.accountRequired ?? true;
		const dateRangeAllowed = params?.dateRangeAllowed ?? true;

		const hkkku: HKKKUSegment = {
			header: { segId: HKKKU.Id, segNr: 0, version: HKKKU.Version },
			account: accountRequired
				? {
						iban: bankAccount.iban,
						bic: bankAccount.bic,
						accountNumber: bankAccount.accountNumber,
						subAccountId: bankAccount.subAccountId,
						bank: bankAccount.bank,
					}
				: undefined,
			cardNumber: bankAccount.accountNumber,
			subAccountId: bankAccount.subAccountId,
			from: dateRangeAllowed ? this.from : undefined,
			to: dateRangeAllowed ? this.to : undefined,
		};

		return [hkkku];
	}

	handleResponse(response: Message, clientResponse: CreditCardStatementResponse) {
		// A response the bank spread over several messages arrives as several HIKKU segments.
		// The balance is the same in each, the entries are not.
		const segments = response.findAllSegments<HIKKUSegment>(HIKKU.Id);
		clientResponse.statements = [];

		const first = segments[0];
		if (!first) {
			return;
		}

		// HKSAL is often not offered for credit card accounts, so the balance from HIKKU matters
		if (first.balance) {
			const date = first.balance.date;
			if (first.balance.time) {
				date.setUTCHours(first.balance.time.getUTCHours());
				date.setUTCMinutes(first.balance.time.getUTCMinutes());
				date.setUTCSeconds(first.balance.time.getUTCSeconds());
			}
			clientResponse.balance = {
				balance: first.balance.amount.value * (first.balance.creditDebit === 'D' ? -1 : 1),
				date,
				currency: first.balance.amount.currency,
			};
		}

		for (const segment of segments) {
			for (const raw of segment.entries ?? []) {
				const p = splitGroup(raw);
				const bookingDate = parseDate(p[2]);
				const receiptDate = parseDate(p[1]);
				const transactionDate = bookingDate ?? receiptDate;
				if (!transactionDate) {
					continue;
				}

				const statement: CreditCardStatement = {
					transactionDate,
					receiptDate,
					valueDate: parseDate(p[4]) ?? transactionDate,
					currency: p[10],
					amount: signed(p[9], p[11]),
					purpose: p
						.slice(12, 20)
						.map((x) => x.trim())
						.filter((x) => x)
						.join(' '),
					remoteName: p[21]?.trim() || undefined,
					country: p[20]?.trim() || undefined,
					originalCurrency: p[6] || undefined,
					originalAmount: p[5] ? signed(p[5], p[7]) : undefined,
					exchangeRate: p[8] ? parseGermanFloat(p[8]) : undefined,
					billed: p[23] === 'J' ? true : p[23] === 'N' ? false : undefined,
					reference: p[24] || undefined,
				};
				clientResponse.statements.push(statement);
			}
		}
	}
}
