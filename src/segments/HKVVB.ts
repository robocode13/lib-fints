import type { Language } from '../codes.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Numeric } from '../dataElements/Numeric.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKVVBSegment = Segment & {
	bpdVersion: number;
	updVersion: number;
	dialogLanguage: Language;
	productId: string;
	productVersion: string;
};

/**
 * Identification
 */
export class HKVVB extends SegmentDefinition {
	static Id = 'HKVVB';
	static Version = 3;
	constructor() {
		super(HKVVB.Id);
	}
	version = HKVVB.Version;
	elements = [
		new Numeric('bpdVersion', 1, 1, 3),
		new Numeric('updVersion', 1, 1, 3),
		new Numeric('dialogLanguage', 1, 1),
		new AlphaNumeric('productId', 1, 1, 25),
		new AlphaNumeric('productVersion', 1, 1, 5),
	];
}
