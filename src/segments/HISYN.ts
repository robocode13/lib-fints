import { Identification } from '../dataElements/Identification.js';
import { Numeric } from '../dataElements/Numeric.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HISYNSegment = Segment & {
	systemId?: string;
	msgNr?: number;
	secRefNrKey?: number;
	secRefNrSignature?: number;
};

/**
 * Synchonisation response
 */
export class HISYN extends SegmentDefinition {
	static Id = 'HISYN';
	version = 4;
	constructor() {
		super(HISYN.Id);
	}
	elements = [
		new Identification('systemId', 0, 1),
		new Numeric('msgNr', 0, 1, 4),
		new Numeric('secRefNrKey', 0, 1, 16),
		new Numeric('secRefNrSignature', 0, 1, 16),
	];
}
