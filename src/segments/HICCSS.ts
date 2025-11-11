import { Numeric } from '../dataElements/Numeric.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HICCSSSegment = Segment & {
	maxTransactions: number;
	minSignatures: number;
	securityClass: number;
};

/**
 * SEPA Credit Transfer Parameters
 * According to spec, no business-specific parameters exist
 */
export class HICCSS extends SegmentDefinition {
	static Id = 'HICCSS';
	static Version = 1;

	constructor() {
		super(HICCSS.Id);
	}

	version = HICCSS.Version;
	elements = [
		new Numeric('maxTransactions', 1, 1, 3),
		new Numeric('minSignatures', 1, 1, 1),
		new Numeric('securityClass', 1, 1, 1),
	];
}
