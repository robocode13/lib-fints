import { Binary } from '../dataElements/Binary.js';
import { SegmentDefinition } from '../segmentDefinition.js';
import { Segment } from '../segment.js';
import {Identification} from "../dataElements/Identification.js";
import {Text} from "../dataElements/Text.js";
import {BalanceGroup, Balance} from "../dataGroups/Balance.js";

export type DIKKUSegment = Segment & {
	balance: Balance;
	transactions: string[];
};

/**
 * Credit card transactions within period response
 */
export class DIKKU extends SegmentDefinition {
	static Id = 'DIKKU';
	version = 2;
	constructor() {
		super(DIKKU.Id);
	}
	elements = [
		new Identification('accountNumber', 1, 1),
		new Text('Ignore', 0, 1),
		new BalanceGroup('balance', 1, 1),
		new Text('Ignore', 0, 1),
		new Text('Ignore', 0, 1),
		new Binary('transactions', 0, 10000, Number.MAX_SAFE_INTEGER),
	];
}
