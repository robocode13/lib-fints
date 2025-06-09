import { SegmentHeader } from '../segmentHeader.js';
import { Binary } from '../dataElements/Binary.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HIWPDSegment = {
	header: SegmentHeader;
	/**
	 * Portfolio statement in S.W.I.F.T. format MT 535 or 571
	 */
	portfolioStatement: string;
};

/**
 * Geschäftsvorfälle: C.4.3.1 Kreditinstitutsrückmeldung
 * Version: 6
 */
export class HIWPD extends SegmentDefinition {
	static Id = 'HIWPD';
	static Version = 6;
	constructor() {
		super(HIWPD.Id);
	}
	version = HIWPD.Version;
	elements = [new Binary('portfolioStatement', 1, 1)];
}
