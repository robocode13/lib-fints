import { Dat } from '../dataElements/Dat.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { InternationalAccountGroup } from '../dataGroups/InternationalAccount.js';
import { AccountGroup } from '../dataGroups/Account.js';
import { type Balance, BalanceGroup } from '../dataGroups/Balance.js';
import { type Money, MoneyGroup } from '../dataGroups/Money.js';
import { Currency } from '../dataElements/Currency.js';
import { type TimeStamp, TimeStampGroup } from '../dataGroups/TimeStamp.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HISALSegment = Segment & {
	account: InternationalAccountGroup | AccountGroup;
	product: string;
	currency: string;
	balance: Balance;
	notedBalance?: Balance;
	creditLimit?: Money;
	availableAmount?: Money;
	usedAmount?: Money;
	overDraft?: Money;
	timestamp?: TimeStamp;
	dueDate?: Date;
	seizable?: Money;
};

/**
 * Account balances response
 */
export class HISAL extends SegmentDefinition {
	static Id = 'HISAL';
	version = 8;
	constructor() {
		super(HISAL.Id);
	}
	elements = [
		new AccountGroup('account', 1, 1, 1, 6),
		new InternationalAccountGroup('account', 1, 1, 7),
		new AlphaNumeric('product', 1, 1, 30),
		new Currency('currency', 1, 1),
		new BalanceGroup('balance', 1, 1),
		new BalanceGroup('notedBalance', 0, 1),
		new MoneyGroup('creditLimit', 0, 1),
		new MoneyGroup('availableAmount', 0, 1),
		new MoneyGroup('usedAmount', 0, 1),
		new MoneyGroup('overDraft', 0, 1, 6),
		new TimeStampGroup('timestamp', 0, 1),
		new Dat('dueDate', 0, 1),
		new MoneyGroup('seizable', 0, 1, 8),
	];
}
