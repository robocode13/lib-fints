import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import { Numeric } from '../dataElements/Numeric.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { TimeStampGroup } from '../dataGroups/TimeStamp.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

/** RCVC match, RVMC close match, RVNM no match, RVNA not applicable, RVCM partial (several), PDNG pending */
export type VopResultCode = 'RCVC' | 'RVMC' | 'RVNM' | 'RVNA' | 'RVCM' | 'PDNG';

export type HIVPPSegment = Segment & {
	vopId?: string;
	vopIdValidUntil?: { date: Date; time?: Date };
	pollingId?: string;
	reportDescriptor?: string;
	report?: string;
	result?: {
		iban: string;
		ibanAddition?: string;
		differentName?: string;
		otherIdentifier?: string;
		result: VopResultCode;
		reason?: string;
	};
	infoText?: string;
	waitSeconds?: number;
};

/**
 * Verification of Payee: result of the name check
 */
export class HIVPP extends SegmentDefinition {
	static Id = 'HIVPP';
	static Version = 1;
	constructor() {
		super(HIVPP.Id);
	}
	version = HIVPP.Version;
	elements = [
		new Binary('vopId', 0, 1, 1024),
		new TimeStampGroup('vopIdValidUntil', 0, 1),
		new Binary('pollingId', 0, 1),
		new AlphaNumeric('reportDescriptor', 0, 1, 256),
		new Binary('report', 0, 1),
		new DataGroup(
			'result',
			[
				new AlphaNumeric('iban', 1, 1, 34),
				new AlphaNumeric('ibanAddition', 0, 1, 140),
				new AlphaNumeric('differentName', 0, 1, 140),
				new AlphaNumeric('otherIdentifier', 0, 1, 256),
				new AlphaNumeric('result', 1, 1, 4),
				new AlphaNumeric('reason', 0, 1, 256),
			],
			0,
			1,
		),
		new AlphaNumeric('infoText', 0, 1, 65535),
		new Numeric('waitSeconds', 0, 1, 1),
	];
}
