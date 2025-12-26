import type { LimitType } from '../codes.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Currency } from '../dataElements/Currency.js';
import { Identification } from '../dataElements/Identification.js';
import { Numeric } from '../dataElements/Numeric.js';
import { type Account, AccountGroup } from '../dataGroups/Account.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { type Money, MoneyGroup } from '../dataGroups/Money.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HIUPDSegment = Segment & {
	account: Account;
	iban: string;
	customerId: string;
	accountType: number;
	currency: string;
	accountHolder1: string;
	accountHolder2?: string;
	accountProduct?: string;
	accountLimit?: AccountLimit;
	allowedTransactions?: AllowedTransactions[];
	accountExtension?: string;
};

export type AccountLimit = {
	limitType: LimitType;
	limitAmount: Money;
	limitDays: number;
};

export type AllowedTransactions = {
	transId: string;
	numSignatures: number;
	limitType?: LimitType;
	limitAmount?: Money;
	limitDays?: number;
};

/**
 * User parameters account information
 */
export class HIUPD extends SegmentDefinition {
	static Id = 'HIUPD';
	version = 6;
	constructor() {
		super(HIUPD.Id);
	}
	elements = [
		new AccountGroup('account', 0, 1),
		new AlphaNumeric('iban', 0, 1, 34),
		new Identification('customerId', 1, 1),
		new Numeric('accountType', 0, 1, 2),
		new Currency('currency', 0, 1),
		new AlphaNumeric('accountHolder1', 1, 1, 27),
		new AlphaNumeric('accountHolder2', 0, 1, 27),
		new AlphaNumeric('accountProduct', 0, 1, 30),
		new DataGroup(
			'accountLimit',
			[
				new AlphaNumeric('limitType', 1, 1, 1),
				new MoneyGroup('limitAmount', 0, 1),
				new Numeric('limitDays', 0, 1, 3),
			],
			0,
			1,
		),
		new DataGroup(
			'allowedTransactions',
			[
				new AlphaNumeric('transId', 1, 1, 6),
				new Numeric('numSignatures', 1, 1, 2),
				new AlphaNumeric('limitType', 0, 1, 1),
				new MoneyGroup('limitAmount', 0, 1),
				new Numeric('limitDays', 0, 1, 3),
			],
			0,
			999,
		),
		new AlphaNumeric('accountExtension', 0, 1, 2048),
	];
}
