import { Numeric } from '../dataElements/Numeric.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HICCSSSegment = Segment & {
	maxTrans: number;
	minSigs: number;
	secClass: number;
};

/**
 * Parameters for the HKCCS business transaction (SEPA credit transfer, single)
 *
 * HICCSS has no transaction specific parameters, only the three elements every
 * parameter segment starts with. The SEPA formats a bank accepts are announced in
 * HISPAS.
 */
export class HICCSS extends SegmentDefinition {
	static Id = 'HICCSS';
	static Version = 1;
	constructor() {
		super(HICCSS.Id);
	}
	version = HICCSS.Version;
	elements = [
		new Numeric('maxTrans', 1, 1, 3),
		new Numeric('minSigs', 1, 1, 1),
		new Numeric('secClass', 1, 1, 1),
	];
}
