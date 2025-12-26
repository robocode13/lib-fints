import { Numeric } from '../dataElements/Numeric.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { type Account, AccountGroup } from '../dataGroups/Account.js';
import type { SegmentWithContinuationMark } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKSPASegment = SegmentWithContinuationMark & {
	accounts?: Account[]; // optional, up to 999 accounts
	maxEntries?: number; // version 2+, conditional
};

/**
 * Request SEPA account connections (IBAN/BIC information)
 * Version 3 - supports account specification, max entries and continuation
 */
export class HKSPA extends SegmentDefinition {
	static Id = 'HKSPA';
	static Version = 3;
	constructor() {
		super(HKSPA.Id);
	}
	version = HKSPA.Version;
	elements = [
		new AccountGroup('accounts', 0, 999),
		new Numeric('maxEntries', 0, 1, 4, 2),
		new AlphaNumeric('continuationMark', 0, 1, 35, 2),
	];
}
