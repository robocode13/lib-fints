import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import { Numeric } from '../dataElements/Numeric.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKVPPSegment = Segment & {
	/** pain.002 formats the client can read; the group holds just the list */
	supportedReports: string[];
	pollingId?: string;
	maxEntries?: number;
	continuationMark?: string;
};

/**
 * Verification of Payee: request the name check (Namensabgleich Prüfauftrag).
 * Sent in the same message as the payment order it checks, before it.
 */
export class HKVPP extends SegmentDefinition {
	static Id = 'HKVPP';
	static Version = 1;
	constructor() {
		super(HKVPP.Id);
	}
	version = HKVPP.Version;
	elements = [
		new DataGroup('supportedReports', [new AlphaNumeric('descriptors', 1, 99, 256)], 1, 1),
		new Binary('pollingId', 0, 1),
		new Numeric('maxEntries', 0, 1, 4),
		new AlphaNumeric('continuationMark', 0, 1, 35),
	];
}
