import { SyncMode } from '../codes.js';
import { Numeric } from '../dataElements/Numeric.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKSYNSegment = Segment & {
	mode: SyncMode;
};

/**
 * Synchonisation
 */
export class HKSYN extends SegmentDefinition {
	static Id = 'HKSYN';
	static Version = 3;
	constructor() {
		super(HKSYN.Id);
	}
	version = HKSYN.Version;
	elements = [new Numeric('mode', 1, 1, 1)];
}
