import { Identification } from '../dataElements/Identification.js';
import { BankIdentification } from './BankIdentification.js';
import { DataGroup } from './DataGroup.js';

export type Bank = {
	country: number;
	bankId: string;
};

export type Account = {
	accountNumber: string;
	subAccountId?: string;
	bank: Bank;
};

export class AccountGroup extends DataGroup {
	constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(
			name,
			[
				new Identification('accountNumber', 1, 1),
				new Identification('subAccountId', 0, 1),
				new BankIdentification('bank', 1, 1),
			],
			minCount,
			maxCount,
			minVersion,
			maxVersion,
		);
	}
}
