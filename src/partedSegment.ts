import { Text } from './dataElements/Text.js';
import type { Segment } from './segment.js';
import { SegmentDefinition } from './segmentDefinition.js';

export type PartedSegment = Segment & {
	originalId: string;
	rawData: string;
};

export class PARTED extends SegmentDefinition {
	static Id = 'PARTED';
	constructor() {
		super(PARTED.Id);
	}
	version = 1;
	elements = [new Text('rawData', 0, 1)];
}

export const PartedId = PARTED.Id;
