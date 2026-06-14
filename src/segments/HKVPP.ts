import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKVPPSegment = Segment & {
	sepaDescriptor: string;
};

/**
 * SEPA pain.002 descriptor prefix for HKCCS credit transfers.
 *
 * Declares the pain.002 schema version that the client supports for
 * status reports. Sparkasse Berlin requires this segment immediately
 * before every HKCCS submission — without it, transfers are rejected
 * before the bank processes the pain.001 payload.
 */
export class HKVPP extends SegmentDefinition {
	static Id = 'HKVPP';
	static Version = 1;
	constructor() {
		super(HKVPP.Id);
	}
	version = HKVPP.Version;
	elements = [new AlphaNumeric('sepaDescriptor', 1, 1, 256)];
}
