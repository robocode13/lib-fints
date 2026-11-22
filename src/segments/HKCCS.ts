import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import {
	type InternationalAccount,
	InternationalAccountGroup,
} from '../dataGroups/InternationalAccount.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKCCSSegment = Segment & {
	account: InternationalAccount;
	sepaDescriptor: string;
	sepaPainMessage: string;
};

/**
 * SEPA single credit transfer (SEPA-Einzelüberweisung)
 */
export class HKCCS extends SegmentDefinition {
	static Id = 'HKCCS';
	static Version = 1;
	constructor() {
		super(HKCCS.Id);
	}
	version = HKCCS.Version;
	elements = [
		new InternationalAccountGroup('account', 1, 1),
		new AlphaNumeric('sepaDescriptor', 1, 1, 256),
		new Binary('sepaPainMessage', 1, 1),
	];
}
