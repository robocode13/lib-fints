import { YesNo } from '../dataElements/YesNo.js';
import { Numeric } from '../dataElements/Numeric.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { InternationalAccount, InternationalAccountGroup } from '../dataGroups/InternationalAccount.js';
import { Account, AccountGroup } from '../dataGroups/Account.js';
import { SegmentWithContinuationMark } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKSALSegment = SegmentWithContinuationMark & {
	account: Account | InternationalAccount;
	allAccounts: boolean;
	maxEntries?: number;
};

/**
 * Request Account balances
 */
export class HKSAL extends SegmentDefinition {
	static Id = 'HKSAL';
	static Version = 8;
	constructor() {
		super(HKSAL.Id);
	}
	version = HKSAL.Version;
	elements = [
		new AccountGroup('account', 1, 1, 1, 6),
		new InternationalAccountGroup('account', 1, 1, 7),
		new YesNo('allAccounts', 1, 1),
		new Numeric('maxEntries', 0, 1, 4),
		new AlphaNumeric('continuationMark', 0, 1, 35),
	];
}
