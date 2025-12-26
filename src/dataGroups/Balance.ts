import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Dat } from '../dataElements/Dat.js';
import { Time } from '../dataElements/Time.js';
import { DataGroup } from './DataGroup.js';
import { type Money, MoneyGroup } from './Money.js';

export type Balance = {
	creditDebit: string;
	amount: Money;
	date: Date;
	time?: Date;
};

export class BalanceGroup extends DataGroup {
	constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(
			name,
			[
				new AlphaNumeric('creditDebit', 1, 1, 1),
				new MoneyGroup('amount', 1, 1),
				new Dat('date', 1, 1),
				new Time('time', 0, 1),
			],
			minCount,
			maxCount,
			minVersion,
			maxVersion,
		);
	}
}
