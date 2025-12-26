import { Dat } from '../dataElements/Dat.js';
import { Numeric } from '../dataElements/Numeric.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Account, AccountGroup } from '../dataGroups/Account.js';
import { SegmentWithContinuationMark } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';
import { Identification } from '../dataElements/Identification.js';

export type DKKKUSegment = SegmentWithContinuationMark & {
	account: Account;
	accountNumber: string;
	subAccountId: string | undefined;
	from?: Date;
	maxEntries?: number;
};

/**
 * Request credit card transactions in a given period
 */
export class DKKKU extends SegmentDefinition {
	static Id = 'DKKKU';
	static Version = 2;
	constructor() {
		super(DKKKU.Id);
	}
	version = DKKKU.Version;
	elements = [
		new AccountGroup('account', 1, 1, 1, 6),
		new Identification('accountNumber', 1, 1),
		new Identification('subAccountId', 1, 1),
		new Dat('from', 0, 1),
		new Numeric('maxEntries', 0, 1, 4),
		new AlphaNumeric('continuationMark', 0, 1, 35),
	];
}
