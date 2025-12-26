import { Identification } from '../dataElements/Identification.js';
import { Numeric } from '../dataElements/Numeric.js';
import type { Bank } from '../dataGroups/Account.js';
import { BankIdentification } from '../dataGroups/BankIdentification.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKIDNSegment = Segment & {
	bank: Bank;
	customerId: string;
	systemId: string;
	systemIdRequired: number;
};

/**
 * Identification
 */
export class HKIDN extends SegmentDefinition {
	static Id = 'HKIDN';
	static Version = 2;
	constructor() {
		super(HKIDN.Id);
	}
	version = HKIDN.Version;
	elements = [
		new BankIdentification('bank', 1, 1),
		new Identification('customerId', 1, 1),
		new Identification('systemId', 1, 1),
		new Numeric('systemIdRequired', 1, 1, 1),
	];
}
