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
 * Submit SEPA credit transfer (pain.001).
 *
 * Initiates a single SEPA wire transfer. The recipient account, amount
 * and reference are carried inside the pain.001 XML payload — the FinTS
 * segment itself only carries the sender account, the SEPA format
 * descriptor and the XML message.
 *
 * Sparkasse Berlin quirks (validated against a live transfer):
 *  - Must be preceded by HKVPP declaring the pain.002 response descriptor.
 *  - pain.001 `ReqdExctnDt` must be the sentinel `1999-01-01` (real dates
 *    are rejected with code 9150).
 *  - TAN method 923 (pushTAN) is required for all transfers.
 *
 * See docs/HKCCS.md for the full protocol notes.
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
		new Binary('sepaPainMessage', 1, 1, 99999),
	];
}
