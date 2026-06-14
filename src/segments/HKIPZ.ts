import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import { YesNo } from '../dataElements/YesNo.js';
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
	/**
	 * v2 only. When "J", the bank is permitted to fall back to a standard
	 * SEPA credit transfer if the receiver's bank is not reachable via SCT
	 * Inst or the amount exceeds the instant limit. Response code 3270
	 * signals that such a conversion occurred. Some banks require a
	 * separate agreement before this flag takes effect.
	 */
	allowConversionToSepa?: boolean;
};

/**
 * Submit SEPA instant credit transfer (SCT Inst / "Echtzeitüberweisung",
 * pain.001).
 *
 * Parallel of HKCCS: initiates a single SEPA transfer intended for
 * instant settlement (~10s). The recipient account, amount, reference
 * and sender live inside the pain.001 XML payload; this segment carries
 * the sender account, the SEPA format descriptor and the XML message.
 *
 * Response segment: HIIPZ (carries Auftragsidentifikation for subsequent
 * HKIPS status polls) plus HIRMS bank answers.
 *
 * Important bank response codes:
 *  - 0020: Auftrag ausgeführt / Geld für den Empfänger verfügbar (success)
 *  - 3045: SEPA-Instant Payment Statusabfrage HKIPS veranlassen
 *          (settlement is async — poll HKIPS until terminal state)
 *  - 3270: Auftrag wird als Standard-SEPA-Überweisung bearbeitet
 *          (bank auto-fell-back to normal SEPA — only with v2 +
 *          `allowConversionToSepa = true`)
 *  - 9210: Betrag zu groß / Empfänger-IBAN existiert nicht / etc.
 *  - 9230: Unzureichendes Guthaben
 *
 * See C.10.2.9 "SEPA-Instant Payment Einzelzahlung" in the FinTS 3.0
 * Geschäftsvorfälle specification (2022-04-15) for the full protocol.
 */
export class HKIPZ extends SegmentDefinition {
	static Id = 'HKIPZ';
	static Version = 2;
	constructor() {
		super(HKIPZ.Id);
	}
	version = HKIPZ.Version;
	elements = [
		new InternationalAccountGroup('account', 1, 1),
		new AlphaNumeric('sepaDescriptor', 1, 1, 256),
		new Binary('sepaPainMessage', 1, 1, 99999),
		// v2 only: "Umwandlung nach SEPA-Überweisung zulässig"
		new YesNo('allowConversionToSepa', 0, 1, 2),
	];
}
