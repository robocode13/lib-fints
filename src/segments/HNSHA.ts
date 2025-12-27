import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HNSHASegment = Segment & {
	secControlRef: string;
	valResult?: string;
	customSignature?: CustomSignature;
};

export type CustomSignature = {
	pin: string;
	tan?: string;
};

/**
 * Signature end
 */
export class HNSHA extends SegmentDefinition {
	static Id = 'HNSHA';
	static Version = 2;
	constructor() {
		super(HNSHA.Id);
	}
	version = HNSHA.Version;
	elements = [
		new AlphaNumeric('secControlRef', 1, 1, 14),
		new Binary('valResult', 0, 1, 512),
		new DataGroup(
			'customSignature',
			[new AlphaNumeric('pin', 1, 1), new AlphaNumeric('tan', 0, 1)],
			0,
			1,
		),
	];
}
