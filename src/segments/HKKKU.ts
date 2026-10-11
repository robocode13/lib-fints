import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Dat } from '../dataElements/Dat.js';
import { Identification } from '../dataElements/Identification.js';
import { Numeric } from '../dataElements/Numeric.js';
import {
	type InternationalAccount,
	InternationalAccountGroup,
} from '../dataGroups/InternationalAccount.js';
import type { SegmentWithContinuationMark } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKKKUSegment = SegmentWithContinuationMark & {
	/** Only sent when the bank sets `accountRequired` in its HIKKUS parameters */
	account?: InternationalAccount;
	cardNumber: string;
	subAccountId?: string;
	from?: Date;
	to?: Date;
	maxEntries?: number;
};

/**
 * Request credit card transactions (DK G112 / CR 538), the standardized successor of DKKKU
 */
export class HKKKU extends SegmentDefinition {
	static Id = 'HKKKU';
	static Version = 1;
	constructor() {
		super(HKKKU.Id);
	}
	version = HKKKU.Version;
	elements = [
		new InternationalAccountGroup('account', 0, 1),
		new Identification('cardNumber', 1, 1),
		new Identification('subAccountId', 0, 1),
		new Dat('from', 0, 1),
		new Dat('to', 0, 1),
		new Numeric('maxEntries', 0, 1, 4),
		new AlphaNumeric('continuationMark', 0, 1, 35),
	];
}
