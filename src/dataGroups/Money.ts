import { DataGroup } from './DataGroup.js';
import { Amount } from '../dataElements/Amount.js';
import { Currency } from '../dataElements/Currency.js';

export type Money = {
	value: number;
	currency: string;
};

export class MoneyGroup extends DataGroup {
	constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(
			name,
			[new Amount('value', 1, 1), new Currency('currency', 1, 1)],
			minCount,
			maxCount,
			minVersion,
			maxVersion,
		);
	}
}
