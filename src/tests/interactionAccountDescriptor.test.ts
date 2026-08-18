import { describe, expect, it } from 'vitest';
import { AccountType, type BankAccount } from '../bankAccount.js';
import type { BankTransaction } from '../bankTransaction.js';
import { Language } from '../codes.js';
import { FinTSConfig } from '../config.js';
import { BalanceInteraction } from '../interactions/balanceInteraction.js';
import { ElectronicStatementInteraction } from '../interactions/electronicStatementInteraction.js';
import { PortfolioInteraction } from '../interactions/portfolioInteraction.js';
import { StatementInteractionCAMT } from '../interactions/statementInteractionCAMT.js';
import { StatementInteractionMT940 } from '../interactions/statementInteractionMT940.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

// The layer between "the segment encodes correctly" and "the client picks the right
// interaction": what an interaction puts into the account connection. Nothing
// covered it before — the segment tests build their account by hand, and the client
// tests mock `Dialog.start`, which throws the built request away.

const GIRO = '1234567890';
const DEPOT = '9876543210';
const BANK = { country: 280, bankId: '10020030' };
const IBAN = 'DE89370400440532013000';

const konto = (accountNumber: string, transIds: string[], iban?: string): BankAccount => ({
	accountNumber,
	subAccountId: 'Girokonto',
	bank: BANK,
	iban,
	bic: iban ? 'BANKDEFFXXX' : undefined,
	customerId: 'customer1',
	accountType: AccountType.CheckingAccount,
	currency: 'EUR',
	holder1: 'Test User',
	allowedTransactions: transIds.map((transId) => ({ transId, numSignatures: 1 })),
});

function configFor(
	transactions: Record<string, number[]>,
	nationalAccountAllowed?: boolean,
): FinTSConfig {
	const allowedTransactions: BankTransaction[] = Object.entries(transactions).map(
		([transId, versions]) => ({ transId, versions, tanRequired: false }),
	);
	if (nationalAccountAllowed !== undefined) {
		allowedTransactions.push({
			transId: 'HKSPA',
			versions: [1],
			tanRequired: false,
			params: {
				individualAccountRetrievalAllowed: false,
				nationalAccountAllowed,
				structuredPurposeAllowed: false,
			},
		});
	}

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
		upd: {
			version: 1,
			usage: 0,
			bankAccounts: [
				konto(GIRO, ['HKSAL', 'HKKAZ', 'HKCAZ', 'HKEKA'], IBAN),
				konto(DEPOT, ['HKWPD'], undefined),
			],
		},
		bankMessages: [],
	});
}

// biome-ignore lint/suspicious/noExplicitAny: reading one field off a built segment
const account = (segment: any) => segment.account;

describe('HKCAZ — international at every version', () => {
	it('sends IBAN and BIC only when the bank forbids the national fields', () => {
		const config = configFor({ HKCAZ: [1] }, false);

		const [hkcaz] = new StatementInteractionCAMT(GIRO).createSegments(config);

		expect(account(hkcaz)).toEqual({ iban: IBAN, bic: 'BANKDEFFXXX' });
	});

	it('sends both halves when the bank allows them', () => {
		const config = configFor({ HKCAZ: [1] }, true);

		const [hkcaz] = new StatementInteractionCAMT(GIRO).createSegments(config);

		expect(account(hkcaz)).toEqual({
			iban: IBAN,
			bic: 'BANKDEFFXXX',
			accountNumber: GIRO,
			subAccountId: 'Girokonto',
			bank: BANK,
		});
	});
});

describe('HKSAL — national up to version 6, international from 7', () => {
	it('sends the national form at version 6, with no IBAN', () => {
		const [hksal] = new BalanceInteraction(GIRO).createSegments(configFor({ HKSAL: [6] }, false));

		expect(account(hksal)).toEqual({ accountNumber: GIRO, subAccountId: 'Girokonto', bank: BANK });
	});

	it('honours the flag at version 7 instead of filling both halves', () => {
		const [hksal] = new BalanceInteraction(GIRO).createSegments(configFor({ HKSAL: [7] }, false));

		expect(account(hksal)).toEqual({ iban: IBAN, bic: 'BANKDEFFXXX' });
	});
});

describe('HKKAZ — national up to version 6, international from 7', () => {
	it('sends the national form at version 6', () => {
		const [hkkaz] = new StatementInteractionMT940(GIRO).createSegments(configFor({ HKKAZ: [6] }, false));

		expect(account(hkkaz)).toEqual({ accountNumber: GIRO, subAccountId: 'Girokonto', bank: BANK });
	});

	it('honours the flag at version 7', () => {
		const [hkkaz] = new StatementInteractionMT940(GIRO).createSegments(configFor({ HKKAZ: [7] }, false));

		expect(account(hkkaz)).toEqual({ iban: IBAN, bic: 'BANKDEFFXXX' });
	});
});

describe('HKEKA — national up to version 3, international from 4', () => {
	it('sends the national form at version 3', () => {
		const [hkeka] = new ElectronicStatementInteraction(GIRO, {}).createSegments(
			configFor({ HKEKA: [3] }, false),
		);

		expect(account(hkeka)).toEqual({ accountNumber: GIRO, subAccountId: 'Girokonto', bank: BANK });
	});

	it('honours the flag at version 4', () => {
		const [hkeka] = new ElectronicStatementInteraction(GIRO, {}).createSegments(
			configFor({ HKEKA: [4] }, false),
		);

		expect(account(hkeka)).toEqual({ iban: IBAN, bic: 'BANKDEFFXXX' });
	});
});

describe('HKWPD — national at every version', () => {
	it('sends the national form, and the depot has no IBAN to send anyway', () => {
		const [hkwpd] = new PortfolioInteraction(DEPOT).createSegments(configFor({ HKWPD: [5] }, false));

		// biome-ignore lint/suspicious/noExplicitAny: reading one field off a built segment
		expect((hkwpd as any).depot).toEqual({
			accountNumber: DEPOT,
			subAccountId: 'Girokonto',
			bank: BANK,
		});
	});
});

// The two banks that pulled this in opposite directions. #19/#20 reduced the CAMT
// descriptor to IBAN and BIC because comdirect rejects anything more; #25 reported
// Postbank answering "Angaben zur nationalen Kontoverbindung für Identifikation
// erforderlich", and the reduction was reverted. Neither bank was wrong, and neither
// fix could hold, because the choice was hard-coded either way. It is data now.

describe('the two banks that pulled this in opposite directions', () => {
	it('a bank refusing the national fields gets IBAN and BIC only', () => {
		const [hkcaz] = new StatementInteractionCAMT(GIRO).createSegments(configFor({ HKCAZ: [1] }, false));

		expect(account(hkcaz)).toEqual({ iban: IBAN, bic: 'BANKDEFFXXX' });
	});

	it('a bank that says nothing keeps them, so nothing working today regresses', () => {
		const [hkcaz] = new StatementInteractionCAMT(GIRO).createSegments(configFor({ HKCAZ: [1] }));

		expect(account(hkcaz)).toEqual({
			iban: IBAN,
			bic: 'BANKDEFFXXX',
			accountNumber: GIRO,
			subAccountId: 'Girokonto',
			bank: BANK,
		});
	});
});
