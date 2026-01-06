import type { BankAccount } from './bankAccount.js';
import type { UpdUsage } from './codes.js';

export type UPD = {
	version: number;
	usage: UpdUsage;
	bankAccounts: BankAccount[];
};
