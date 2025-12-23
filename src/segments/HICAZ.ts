import { Binary } from '../dataElements/Binary.js';
import { Text } from '../dataElements/Text.js';
import { InternationalAccount, InternationalAccountGroup } from '../dataGroups/InternationalAccount.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { SegmentDefinition } from '../segmentDefinition.js';
import { Segment } from '../segment.js';

export type HICAZSegment = Segment & {
	account: InternationalAccount;
	camtDescriptor: string;
	bookedTransactions: string[];
	notedTransactions?: string[];
};

/**
 * Account transactions within period response (CAMT format)
 */
export class HICAZ extends SegmentDefinition {
	static Id = 'HICAZ';
	static Version = 1;
	constructor() {
		super(HICAZ.Id);
	}
	version = HICAZ.Version;
	elements = [
		new InternationalAccountGroup('account', 1, 1),
		new Text('camtDescriptor', 1, 1), // camt-Descriptor (single format used)
		new DataGroup('bookedTransactions', [new Binary('camtMessage', 1, 99)], 1, 1), // Booked CAMT transactions
		new DataGroup('notedTransactions', [new Binary('camtMessage', 1, 99)], 0, 1), // Noted CAMT transactions
	];
}
