import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Dat } from '../dataElements/Dat.js';
import { Numeric } from '../dataElements/Numeric.js';
import { Text } from '../dataElements/Text.js';
import { YesNo } from '../dataElements/YesNo.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import {
	type InternationalAccount,
	InternationalAccountGroup,
} from '../dataGroups/InternationalAccount.js';
import type { SegmentWithContinuationMark } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKCAZSegment = SegmentWithContinuationMark & {
	account: InternationalAccount;
	acceptedCamtFormats: string[];
	allAccounts: boolean;
	from?: Date;
	to?: Date;
	maxEntries?: number;
};

/**
 * Request account transactions in a given period (CAMT format)
 */
export class HKCAZ extends SegmentDefinition {
	static Id = 'HKCAZ';
	static Version = 1;
	constructor() {
		super(HKCAZ.Id);
	}
	version = HKCAZ.Version;
	elements = [
		new InternationalAccountGroup('account', 1, 1),
		new DataGroup('acceptedCamtFormats', [new Text('camtFormat', 1, 99)], 1, 1), // Support multiple camt-formats
		new YesNo('allAccounts', 1, 1),
		new Dat('from', 0, 1),
		new Dat('to', 0, 1),
		new Numeric('maxEntries', 0, 1, 4),
		new AlphaNumeric('continuationMark', 0, 1, 35),
	];
}
