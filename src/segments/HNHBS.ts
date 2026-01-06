import { Numeric } from '../dataElements/Numeric.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HNHBSSegment = Segment & {
	msgNr: number;
};

/**
 * Message end
 */
export class HNHBS extends SegmentDefinition {
	static Id = 'HNHBS';
	static Version = 1;
	constructor() {
		super(HNHBS.Id);
	}
	version = HNHBS.Version;
	elements = [new Numeric('msgNr', 1, 1, 4)];
}
