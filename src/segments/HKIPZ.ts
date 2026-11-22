import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import {
	type InternationalAccount,
	InternationalAccountGroup,
} from '../dataGroups/InternationalAccount.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKIPZSegment = Segment & {
	account: InternationalAccount;
	sepaDescriptor: string;
	sepaPainMessage: string;
};

/**
 * SEPA instant credit transfer (SEPA-Instant Payment Zahlung), built like HKCCS
 */
export class HKIPZ extends SegmentDefinition {
	static Id = 'HKIPZ';
	static Version = 1;
	constructor() {
		super(HKIPZ.Id);
	}
	version = HKIPZ.Version;
	elements = [
		new InternationalAccountGroup('account', 1, 1),
		new AlphaNumeric('sepaDescriptor', 1, 1, 256),
		new Binary('sepaPainMessage', 1, 1),
	];
}
