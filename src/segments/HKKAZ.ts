import { Dat } from '../dataElements/Dat.js';
import { YesNo } from '../dataElements/YesNo.js';
import { Numeric } from '../dataElements/Numeric.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { InternationalAccountGroup } from '../dataGroups/InternationalAccount.js';
import { type Account, AccountGroup } from '../dataGroups/Account.js';
import type { SegmentWithContinuationMark } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKKAZSegment = SegmentWithContinuationMark & {
	account: Account;
	allAccounts: boolean;
	from?: Date;
	to?: Date;
	maxEntries?: number;
};

/**
 * Request account transactions in a given period
 */
export class HKKAZ extends SegmentDefinition {
	static Id = 'HKKAZ';
	static Version = 7;
	constructor() {
		super(HKKAZ.Id);
	}
	version = HKKAZ.Version;
	elements = [
		new AccountGroup('account', 1, 1, 1, 6),
		new InternationalAccountGroup('account', 1, 1, 7),
		new YesNo('allAccounts', 1, 1),
		new Dat('from', 0, 1),
		new Dat('to', 0, 1),
		new Numeric('maxEntries', 0, 1, 4),
		new AlphaNumeric('continuationMark', 0, 1, 35),
	];
}
