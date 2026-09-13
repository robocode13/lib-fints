import { describe, expect, it } from 'vitest';
import { AccountType, type BankAccount, describeAccount } from '../bankAccount.js';
import { Language } from '../codes.js';
import { FinTSConfig } from '../config.js';
import { HKSAL } from '../segments/HKSAL.js';
import { HKWPD } from '../segments/HKWPD.js';

// A bank that gives a securities account and the current account it settles through
// the same number, distinguishing them only by sub-account id. That is within the
// specification: FinTS identifies an account by both together.

const checkingAccount: BankAccount = {
	accountNumber: '1234567890',
	subAccountId: 'Girokonto',
	bank: { country: 280, bankId: '10020030' },
	iban: 'DE89370400440532013000',
	bic: 'BANKDEFFXXX',
	customerId: 'customer1',
	accountType: AccountType.Miscellaneous,
	currency: 'EUR',
	holder1: 'Test User',
	allowedTransactions: [{ transId: HKSAL.Id, numSignatures: 0 }],
};

const securitiesAccount: BankAccount = {
	...checkingAccount,
	subAccountId: 'Depot',
	iban: undefined,
	bic: undefined,
	allowedTransactions: [{ transId: HKWPD.Id, numSignatures: 0 }],
};

const singleAccount: BankAccount = {
	...checkingAccount,
	accountNumber: '5555555555',
	subAccountId: undefined,
};

function configWith(accounts: BankAccount[]): FinTSConfig {
	return FinTSConfig.fromBankingInformation('product', '1.0', {
		systemId: 'SYSTEM01',
		bpd: {
			version: 1,
			url: 'https://bank.example.com/fints',
			countryCode: 280,
			bankId: '10020030',
			bankName: 'Example Bank',
			allowedTransactions: [],
			maxTransactionsPerMessage: 1,
			supportedLanguages: [Language.German],
			supportedHbciVersions: [300],
			supportedTanMethods: [],
			availableTanMethodIds: [],
		},
		upd: { version: 1, usage: 0, bankAccounts: accounts },
		bankMessages: [],
	});
}

describe('addressing an account by number', () => {
	it('resolves a number that only one account has', () => {
		const config = configWith([checkingAccount, singleAccount]);
		expect(config.getBankAccount('5555555555').subAccountId).toBeUndefined();
	});

	it('refuses a number two accounts share, instead of picking one', () => {
		// Picking the first is what makes the failure invisible: a balance comes back,
		// it is the other account's, and nothing in the response says so.
		const config = configWith([checkingAccount, securitiesAccount]);
		expect(() => config.getBankAccount('1234567890')).toThrow(/not unique/);
	});

	it('names the sub-account ids, so the caller can tell them apart', () => {
		const config = configWith([checkingAccount, securitiesAccount]);
		expect(() => config.getBankAccount('1234567890')).toThrow(/Girokonto, Depot/);
	});

	it('still says so when the number matches nothing', () => {
		expect(() => configWith([checkingAccount]).getBankAccount('0000000000')).toThrow(/not found in UPD/);
	});
});

describe('addressing an account by the account itself', () => {
	it('reaches the one a shared number cannot', () => {
		const config = configWith([checkingAccount, securitiesAccount]);
		expect(config.getBankAccount(securitiesAccount).subAccountId).toBe('Depot');
		expect(config.getBankAccount(checkingAccount).subAccountId).toBe('Girokonto');
	});

	it('decides what that account may do, not what the other one may', () => {
		const config = configWith([checkingAccount, securitiesAccount]);
		expect(config.isAccountTransactionSupported(securitiesAccount, HKWPD.Id)).toBe(true);
		expect(config.isAccountTransactionSupported(checkingAccount, HKWPD.Id)).toBe(false);
		expect(config.isAccountTransactionSupported(checkingAccount, HKSAL.Id)).toBe(true);
	});

	it('resolves against the UPD rather than trusting what it was handed', () => {
		// A caller may hold an account from a persisted earlier session. The entry the
		// bank sent this time is the one carrying the current allowed transactions.
		const staleAccount: BankAccount = { ...securitiesAccount, allowedTransactions: [] };
		const config = configWith([checkingAccount, securitiesAccount]);
		expect(config.isAccountTransactionSupported(staleAccount, HKWPD.Id)).toBe(true);
	});

	it('refuses an account the bank did not report', () => {
		const config = configWith([checkingAccount]);
		const unreportedAccount: BankAccount = { ...checkingAccount, subAccountId: 'Sparkonto' };
		expect(() => config.getBankAccount(unreportedAccount)).toThrow(/not found in UPD/);
	});
});

describe('naming an account in an error', () => {
	it('reads as the number alone where that is all there is', () => {
		expect(describeAccount('1234567890')).toBe('1234567890');
		expect(describeAccount(singleAccount)).toBe('5555555555');
	});

	it('adds the sub-account id where there is one', () => {
		// Otherwise an account passed as an object prints as [object Object].
		expect(describeAccount(securitiesAccount)).toBe('1234567890 (Depot)');
	});
});

describe('matching an account the bank itself named', () => {
	it('uses the sub-account id where the bank repeated it', () => {
		const config = configWith([checkingAccount, securitiesAccount]);
		expect(
			config.matchBankAccount({ accountNumber: '1234567890', subAccountId: 'Depot' })?.subAccountId,
		).toBe('Depot');
	});

	it('still finds an account whose number only it has, sub-account id or not', () => {
		// Banks are not consistent about repeating it, and a number only one account
		// has identifies that account either way.
		const config = configWith([checkingAccount, singleAccount]);
		expect(config.matchBankAccount({ accountNumber: '5555555555' })?.accountNumber).toBe(
			'5555555555',
		);
	});

	it('gives up quietly where it cannot tell, rather than throwing', () => {
		// This runs for entries the bank supplied — HISPA travels with every dialog —
		// so throwing here would fail every request at a bank that shares numbers,
		// before any of them reached its order. That is exactly what happened once.
		const config = configWith([checkingAccount, securitiesAccount]);
		expect(config.matchBankAccount({ accountNumber: '1234567890' })).toBeUndefined();
	});
});
