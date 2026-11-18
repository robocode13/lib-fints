import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import { Numeric } from '../dataElements/Numeric.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { type TimeStamp, TimeStampGroup } from '../dataGroups/TimeStamp.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

/**
 * The result of a check of a single transfer, an alternative to the pain.002 report
 */
export type VopSingleResult = {
	/** The payee's IBAN as checked */
	iban: string;
	ibanAdditionalInfo?: string;
	/** For a close match: the name the payee's bank holds */
	closeMatchName?: string;
	/** Which other identification (such as an LEI) was checked instead of the name */
	otherIdentification?: string;
	/** RCVC (match), RVMC (close match), RVNM (no match), RVNA (not applicable) or PDNG (pending) */
	result: string;
	/** For RVNA: why the check was not possible */
	notApplicableReason?: string;
};

export type HIVPPSegment = Segment & {
	/** Present once the result has been delivered completely, the bank's reference for HKVPA */
	vopId?: string;
	vopIdValidUntil?: TimeStamp;
	/** Present while the result is still being produced, to be sent back in HKVPP */
	pollingId?: string;
	paymentStatusReportDescriptor?: string;
	/** A pain.002 document with the result, as a byte string */
	paymentStatusReport?: string;
	singleResult?: VopSingleResult;
	/** The text the customer confirms when authorising despite a deviation, must be shown */
	notice?: string;
	/** How many seconds to wait before asking again */
	waitSeconds?: number;
};

/**
 * Verification of Payee, check result (Namensabgleich Prüfergebnis), DK VoP spec C.10.7
 */
export class HIVPP extends SegmentDefinition {
	static Id = 'HIVPP';
	static Version = 1;
	constructor() {
		super(HIVPP.Id);
	}
	version = HIVPP.Version;
	elements = [
		new Binary('vopId', 0, 1),
		new TimeStampGroup('vopIdValidUntil', 0, 1),
		new Binary('pollingId', 0, 1),
		new AlphaNumeric('paymentStatusReportDescriptor', 0, 1, 256),
		new Binary('paymentStatusReport', 0, 1),
		new DataGroup(
			'singleResult',
			[
				new AlphaNumeric('iban', 1, 1, 34),
				new AlphaNumeric('ibanAdditionalInfo', 0, 1, 140),
				new AlphaNumeric('closeMatchName', 0, 1, 140),
				new AlphaNumeric('otherIdentification', 0, 1, 256),
				new AlphaNumeric('result', 1, 1, 4),
				new AlphaNumeric('notApplicableReason', 0, 1, 256),
			],
			0,
			1,
		),
		new AlphaNumeric('notice', 0, 1, 65535),
		new Numeric('waitSeconds', 0, 1, 1),
	];
}
