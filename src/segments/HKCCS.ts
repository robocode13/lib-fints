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
	/** The URN of the pain.001 schema the message follows, one of those listed in HISPAS */
	sepaDescriptor: string;
	/** The pain.001 document as a byte string (UTF-8 bytes, one character per byte) */
	sepaPainMessage: string;
};

/**
 * SEPA credit transfer, single (Einzelüberweisung), FinTS 3.0 C.10.2.1
 *
 * The segment carries only the debtor account, the schema descriptor and the pain.001
 * document. Payee, amount and remittance information live in the document, and its
 * debtor IBAN and BIC must match the account given here. An order to be executed as
 * soon as possible carries the requested execution date 1999-01-01; any other date is
 * rejected with 9150 (the specification says so, and PR #27 observed it at one bank,
 * Sparkasse Berlin). Scheduled transfers are a separate business transaction (HKCSE).
 *
 * The bank answers with return codes only, there is no data segment in the response.
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
