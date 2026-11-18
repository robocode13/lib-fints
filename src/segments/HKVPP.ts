import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import { Numeric } from '../dataElements/Numeric.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKVPPSegment = Segment & {
	/** The URNs of the pain.002 schemas the client accepts for the result */
	supportedReports: string[];
	/** The polling ID from an earlier HIVPP, required when asking again for a pending result */
	pollingId?: string;
	/** Only allowed where HIVPPS says entryCountAllowed */
	maxEntries?: number;
	/** The touchdown point the bank returned with code 3040, required when asking again */
	touchdownPoint?: string;
};

/**
 * Verification of Payee, check request (Namensabgleich Prüfauftrag), DK VoP spec C.10.7
 *
 * Sent in the same message as, and right before, the payment order it checks
 * (followed by HKTAN). When the bank has not finished the check yet it hands out a
 * polling ID and a touchdown point (code 3040), and HKVPP alone is sent again with
 * both until a HIVPP with a VoP ID arrives.
 *
 * The touchdown point is deliberately not called `continuationMark`: the dialog
 * treats an order segment with that element as one whose response the bank may part,
 * and repeats the whole message on 3040. Repeating the message that carries the
 * payment order would submit it again and start a new check.
 */
export class HKVPP extends SegmentDefinition {
	static Id = 'HKVPP';
	static Version = 1;
	constructor() {
		super(HKVPP.Id);
	}
	version = HKVPP.Version;
	elements = [
		new DataGroup('supportedReports', [new AlphaNumeric('descriptor', 1, 99, 256)], 1, 1),
		new Binary('pollingId', 0, 1),
		new Numeric('maxEntries', 0, 1, 4),
		new AlphaNumeric('touchdownPoint', 0, 1, 35),
	];
}
