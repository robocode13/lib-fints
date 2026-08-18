import { describe, expect, it } from 'vitest';
import { internationalAccount, nationalAccount } from '../accountDescriptor.js';
import { AccountType, type BankAccount } from '../bankAccount.js';
import { Language } from '../codes.js';
import { FinTSConfig } from '../config.js';
import type { BankTransaction } from '../bankTransaction.js';

const account: BankAccount = {
	accountNumber: '1234567890',
	subAccountId: 'Girokonto',
	bank: { country: 280, bankId: '10020030' },
	iban: 'DE89370400440532013000',
	bic: 'BANKDEFFXXX',
	customerId: 'customer1',
	accountType: AccountType.CheckingAccount,
	currency: 'EUR',
	holder1: 'Test User',
};

const depot: BankAccount = { ...account, accountNumber: '9876543210', iban: undefined, bic: undefined };

function configWith(allowedTransactions: BankTransaction[]): FinTSConfig {
	return FinTSConfig.fromBankingInformation('product', '1.0', {
		systemId: 'SYSTEM01',
		bpd: {
			version: 1,
			url: 'https://bank.example.com/fints',
			countryCode: 280,
			bankId: '10020030',
			bankName: 'Example Bank',
			allowedTransactions,
			maxTransactionsPerMessage: 1,
			supportedLanguages: [Language.German],
			supportedHbciVersions: [300],
			supportedTanMethods: [],
			availableTanMethodIds: [],
		},
		upd: { version: 1, usage: 0, bankAccounts: [account, depot] },
		bankMessages: [],
	});
}

const hispas = (nationalAccountAllowed: boolean): BankTransaction => ({
	transId: 'HKSPA',
	versions: [1],
	tanRequired: false,
	params: {
		individualAccountRetrievalAllowed: false,
		nationalAccountAllowed,
		structuredPurposeAllowed: false,
	},
});

describe('nationalAccount', () => {
	it('carries the three fields the data group has, and nothing else', () => {
		expect(nationalAccount(account)).toEqual({
			accountNumber: '1234567890',
			subAccountId: 'Girokonto',
			bank: { country: 280, bankId: '10020030' },
		});
	});
});

describe('internationalAccount', () => {
	it('leaves the national fields out when the bank forbids them', () => {
		const descriptor = internationalAccount(configWith([hispas(false)]), account);

		expect(descriptor).toEqual({ iban: 'DE89370400440532013000', bic: 'BANKDEFFXXX' });
	});

	it('includes the national fields when the bank allows them', () => {
		const descriptor = internationalAccount(configWith([hispas(true)]), account);

		expect(descriptor).toEqual({
			iban: 'DE89370400440532013000',
			bic: 'BANKDEFFXXX',
			accountNumber: '1234567890',
			subAccountId: 'Girokonto',
			bank: { country: 280, bankId: '10020030' },
		});
	});

	it('leaves them out when the bank announces no HISPAS at all', () => {
		// A "Kann"-field: no permission is not permission.
		const descriptor = internationalAccount(configWith([]), account);

		expect(descriptor).toEqual({ iban: 'DE89370400440532013000', bic: 'BANKDEFFXXX' });
	});

	it('keeps the national fields for an account without an IBAN, whatever the flag says', () => {
		// A securities account typically has none, and nothing else identifies it.
		const descriptor = internationalAccount(configWith([hispas(false)]), depot);

		expect(descriptor).toEqual({
			accountNumber: '9876543210',
			subAccountId: 'Girokonto',
			bank: { country: 280, bankId: '10020030' },
		});
	});
});
