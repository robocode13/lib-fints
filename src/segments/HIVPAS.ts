import { Numeric } from '../dataElements/Numeric.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HIVPASSegment = Segment & {
	maxTrans: number;
	minSigs: number;
	secClass: number;
};

/**
 * Parameters for the HKVPA business transaction (Verification of Payee, execution order)
 *
 * HIVPAS has no transaction specific parameters.
 */
export class HIVPAS extends SegmentDefinition {
	static Id = 'HIVPAS';
	static Version = 1;
	constructor() {
		super(HIVPAS.Id);
	}
	version = HIVPAS.Version;
	elements = [
		new Numeric('maxTrans', 1, 1, 3),
		new Numeric('minSigs', 1, 1, 1),
		new Numeric('secClass', 1, 1, 1),
	];
}
