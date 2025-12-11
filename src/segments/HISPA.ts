import { InternationalAccount, InternationalAccountGroup } from '../dataGroups/InternationalAccount.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HISPASegment = Segment & {
	sepaAccounts: InternationalAccount[];
};

/**
 * SEPA account connection response - returns IBAN/BIC information
 * Version 3 - returns SEPA account data in ktz format
 */
export class HISPA extends SegmentDefinition {
	static Id = 'HISPA';
	version = 3;
	constructor() {
		super(HISPA.Id);
	}
	elements = [new InternationalAccountGroup('sepaAccounts', 0, 999)];
}
