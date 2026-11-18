import { Binary } from '../dataElements/Binary.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKVPASegment = Segment & {
	/** The VoP ID from the final HIVPP */
	vopId: string;
};

/**
 * Verification of Payee, execution order (Namensabgleich Ausführungsauftrag), DK VoP spec C.10.7
 *
 * Authorises the payment order the bank has checked. It goes in the same message as
 * the identical payment order (and HKTAN), or, after a match where the bank asks for a
 * TAN straight away, with the TAN. The bank answers with return codes only.
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
