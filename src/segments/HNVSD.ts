import { Binary } from '../dataElements/Binary.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';
import type { SegmentHeader } from '../segmentHeader.js';

export type HNVSDSegment = Segment & {
	header: SegmentHeader & { segNr: 999 };
	encryptedData: string;
};

/**
 * Encrypted data
 */
export class HNVSD extends SegmentDefinition {
	static Id = 'HNVSD';
	static Version = 1;
	constructor() {
		super(HNVSD.Id);
	}
	version = 1;
	elements = [new Binary('encryptedData', 1, 1)];
}
