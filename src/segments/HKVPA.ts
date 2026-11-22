import { Binary } from '../dataElements/Binary.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKVPASegment = Segment & {
	vopId: string;
};

/**
 * Verification of Payee: release the payment order after the name check
 * (Namensabgleich Ausführungsauftrag). Sent together with the order again.
 */
export class HKVPA extends SegmentDefinition {
	static Id = 'HKVPA';
	static Version = 1;
	constructor() {
		super(HKVPA.Id);
	}
	version = HKVPA.Version;
	elements = [new Binary('vopId', 1, 1)];
}
