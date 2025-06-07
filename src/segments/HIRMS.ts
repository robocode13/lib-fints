import { Digits } from '../dataElements/Digits.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';
import { Answer } from './HIRMG.js';

export type HIRMSSegment = Segment & {
	answers: Answer[];
};

/**
 * Responses to the message
 */
export class HIRMS extends SegmentDefinition {
	static Id = 'HIRMS';
	static Version = 2;
	constructor() {
		super(HIRMS.Id);
	}
	version = HIRMS.Version;
	elements = [
		new DataGroup(
			'answers',
			[
				new Digits('code', 1, 1, 4),
				new AlphaNumeric('refElement', 0, 1, 7),
				new AlphaNumeric('text', 1, 1, 80),
				new AlphaNumeric('params', 0, 10, 35),
			],
			1,
			99
		),
	];
}
