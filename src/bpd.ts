import { BankTransaction } from './bankTransaction.js';
import { Language } from './codes.js';
import { TanMethod } from './tanMethod.js';

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
