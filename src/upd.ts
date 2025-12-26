import { BankAccount } from './bankAccount.js';
import { UpdUsage } from './codes.js';

export type UPD = {
	version: number;
	usage: UpdUsage;
	bankAccounts: BankAccount[];
};
