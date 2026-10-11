import { Binary } from '../dataElements/Binary.js';
import { Dat } from '../dataElements/Dat.js';
import { Text } from '../dataElements/Text.js';
import { type Balance, BalanceGroup } from '../dataGroups/Balance.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HIKKUSegment = Segment & {
	cardNumber: string;
	accountId?: string;
	balance?: Balance;
	lastStatementDate?: Date;
	nextStatementDate?: Date;
	/** One raw data element group "Umsatz Kreditkartenkonto" per entry, split by the interaction */
	entries?: string[];
};

/**
 * Credit card transactions response (DK G112 / CR 538)
 */
export class HIKKU extends SegmentDefinition {
	static Id = 'HIKKU';
	version = 1;
	constructor() {
		super(HIKKU.Id);
	}
	elements = [
		new Text('cardNumber', 1, 1),
		new Text('accountId', 0, 1),
		new BalanceGroup('balance', 0, 1),
		new Dat('lastStatementDate', 0, 1),
		new Dat('nextStatementDate', 0, 1),
		new Binary('entries', 0, 10000, Number.MAX_SAFE_INTEGER),
	];
}
