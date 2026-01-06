import type { TanProcess } from '../codes.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import { Dat } from '../dataElements/Dat.js';
import { Time } from '../dataElements/Time.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import type { TimeStamp } from '../dataGroups/TimeStamp.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HITANSegment = Segment & {
	tanProcess: TanProcess;
	orderHash?: string;
	orderReference?: string;
	challenge?: string;
	challengeHhdUc?: string;
	challengeValidUntil?: TimeStamp;
	tanMedia?: string;
};

/**
 * TAN response
 */
export class HITAN extends SegmentDefinition {
	static Id = 'HITAN';
	version = 7;
	constructor() {
		super(HITAN.Id);
	}
	elements = [
		new AlphaNumeric('tanProcess', 1, 1, 1),
		new Binary('orderHash', 0, 1, 256),
		new AlphaNumeric('orderReference', 0, 1, 35),
		new AlphaNumeric('challenge', 0, 1, 2048),
		new Binary('challengeHhdUc', 0, 1, 128),
		new DataGroup('challengeValidUntil', [new Dat('date', 1, 1), new Time('time', 1, 1)], 0, 1),
		new AlphaNumeric('tanMedia', 0, 1, 32),
	];
}
