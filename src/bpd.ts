import type { BankTransaction } from './bankTransaction.js';
import type { Language } from './codes.js';
import type { TanMethod } from './tanMethod.js';

export type BPD = {
	version: number;
	countryCode: number;
	bankId: string;
	bankName: string;
	maxTransactionsPerMessage: number;
	supportedLanguages: Language[];
	supportedHbciVersions: number[];
	url?: string;
	supportedTanMethods: TanMethod[];
	availableTanMethodIds: number[];
	allowedTransactions: BankTransaction[];
};
