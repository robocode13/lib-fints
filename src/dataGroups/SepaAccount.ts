import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { DataGroup } from './DataGroup.js';
import { Identification } from '../dataElements/Identification.js';
import { BankIdentification } from './BankIdentification.js';
import { Account } from './Account.js';
import { YesNo } from '../dataElements/YesNo.js';

export type SepaAccount = Account & {
	isSepaAccount?: boolean;
	iban?: string;
	bic?: string;
};

export class SepaAccountGroup extends DataGroup {
	constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(
			name,
			[
				new YesNo('isSepaAccount', 1, 1),
				new AlphaNumeric('iban', 0, 1, 34),
				new AlphaNumeric('bic', 0, 1, 11),
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
