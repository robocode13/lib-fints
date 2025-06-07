import { Digits } from '../dataElements/Digits.js';
import { Numeric } from '../dataElements/Numeric.js';
import { RefMessageGroup, RefMessage } from '../dataGroups/RefMessage.js';
import { Identification } from '../dataElements/Identification.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HNHBKSegment = Segment & {
	messageLength: number;
	hbciVersion: number;
	dialogId: string;
	msgNr: number;
	refMsg?: RefMessage;
};

/**
 * Message header
 */
export class HNHBK extends SegmentDefinition {
	static Id = 'HNHBK';
	static Version = 3;
	constructor() {
		super(HNHBK.Id);
	}
	version = HNHBK.Version;
	elements = [
		new Digits('messageLength', 1, 1, 12),
		new Numeric('hbciVersion', 1, 1, 3),
		new Identification('dialogId', 1, 1),
		new Numeric('msgNr', 1, 1, 4),
		new RefMessageGroup('refMsg', 0, 1),
	];
}
