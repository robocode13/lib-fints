import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { DataGroup } from './DataGroup.js';
import { Country } from '../dataElements/Country.js';

export class BankIdentification extends DataGroup {
	constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(
			name,
			[new Country('country', 1, 1), new AlphaNumeric('bankId', 1, 1, 30)],
			minCount,
			maxCount,
			minVersion,
			maxVersion,
		);
	}
}
