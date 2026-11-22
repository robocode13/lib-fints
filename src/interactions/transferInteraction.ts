import { internationalAccount } from '../accountDescriptor.js';
import { type AccountRef, describeAccount } from '../bankAccount.js';
import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HITAN, type HITANSegment } from '../segments/HITAN.js';
import { HIVPP, type HIVPPSegment, type VopResultCode } from '../segments/HIVPP.js';
import type { HIVPPSParameter } from '../segments/HIVPPS.js';
import { HKCCS, type HKCCSSegment } from '../segments/HKCCS.js';
import { HKIPZ } from '../segments/HKIPZ.js';
import { HKVPA, type HKVPASegment } from '../segments/HKVPA.js';
import { HKVPP, type HKVPPSegment } from '../segments/HKVPP.js';
import { type ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';

/** Used when the bank names no report format of its own in HIVPPS */
export const DEFAULT_VOP_REPORT = 'urn:iso:std:iso:20022:tech:xsd:pain.002.001.10';

/** Aufsetzpunkt: the bank is still checking, ask again */
const CONTINUE = 3040;
/** VOP-Ausführungsauftrag nicht benötigt: no HKVPA, the bank goes on by itself */
const NO_CONFIRMATION_NEEDED = 3091;

/**
 * A SEPA single credit transfer. The caller supplies the complete pain.001 document;
 * the bank only confirms or rejects it, so the result is in `bankAnswers`.
 *
 * Where the bank requires Verification of Payee (HKVPP in the BPD) the order of
 * messages follows recorded Atruvia traffic (phpFinTS):
 * 1. HKCCS + HKTAN + HKVPP. Usually answered with an Aufsetzpunkt (3040) and a
 *    polling id: the check is still running.
 * 2. HKVPP alone with polling id and Aufsetzpunkt, until HIVPP brings the VOP-ID and
 *    the result, either as a pain.002 report or as a single result.
 * 3. After the customer agrees (FinTSClient.confirmTransfer): HKCCS + HKVPA + HKTAN,
 *    then the usual TAN challenge.
 * Code 3091 says the bank needs no HKVPA; it then asks for the TAN (or is done) right away.
 */
export class TransferInteraction extends CustomerOrderInteraction {
	private vopId?: string;
	private polling?: { pollingId?: string; continuationMark?: string };
	private vopRequested = false;

	constructor(
		public account: AccountRef,
		public sepaDescriptor: string,
		public painMessage: string,
		/** SEPA Instant (HKIPZ) instead of a regular transfer (HKCCS); the pain.001 should say INST */
		public instant = false,
	) {
		super(instant ? HKIPZ.Id : HKCCS.Id, '');
	}

	createSegments(init: FinTSConfig): Segment[] {
		if (this.polling) {
			return [this.hkvpp(init)];
		}

		const bankAccount = init.getBankAccount(this.account);
		if (!init.isAccountTransactionSupported(this.account, this.segId)) {
			throw Error(
				`Account ${describeAccount(this.account)} does not support business transaction '${this.segId}'`,
			);
		}

		const version = init.getMaxSupportedTransactionVersion(this.segId);
		if (!version) {
			throw Error(`There is no supported version for business transaction '${this.segId}'`);
		}

		// HKIPZ v1 has the same elements as HKCCS v1.
		const hkccs: HKCCSSegment = {
			header: { segId: this.segId, segNr: 0, version },
			account: internationalAccount(init, bankAccount),
			sepaDescriptor: this.sepaDescriptor,
			sepaPainMessage: this.painMessage,
		};

		if (this.vopId) {
			const hkvpa: HKVPASegment = {
				header: { segId: HKVPA.Id, segNr: 0, version: HKVPA.Version },
				vopId: this.vopId,
			};
			return [hkccs, hkvpa];
		}
		return [hkccs];
	}

	getSegmentsAfterTan(init: FinTSConfig): Segment[] {
		if (this.polling || this.vopId || !init.isTransactionSupported(HKVPP.Id)) {
			return [];
		}
		this.vopRequested = true;
		return [this.hkvpp(init)];
	}

	private hkvpp(init: FinTSConfig): HKVPPSegment {
		return {
			header: { segId: HKVPP.Id, segNr: 0, version: HKVPP.Version },
			supportedReports: [vopReportFormat(init)],
			pollingId: this.polling?.pollingId,
			continuationMark: this.polling?.continuationMark,
		};
	}

	protected handleResponse(response: Message, clientResponse: ClientResponse): void {
		this.withoutTan = false;
		const hivpp = response.findSegment<HIVPPSegment>(HIVPP.Id);
		if (!this.vopRequested || (!hivpp && !this.polling)) {
			return;
		}

		const continuation = clientResponse.bankAnswers.find((a) => a.code === CONTINUE);
		if (continuation) {
			this.polling = { pollingId: hivpp?.pollingId, continuationMark: continuation.params?.[0] };
			this.withoutTan = true;
			clientResponse.vopPending = true;
			clientResponse.vopWaitSeconds = hivpp?.waitSeconds;
			return;
		}
		this.polling = undefined;

		if (!hivpp) {
			throw new Error('the bank ended the payee name check without a result (HIVPP)');
		}
		clientResponse.vop = {
			result: vopResult(hivpp),
			differentName: hivpp.result?.differentName,
			reason: hivpp.result?.reason,
			infoText: hivpp.infoText,
		};

		if (clientResponse.bankAnswers.some((a) => a.code === NO_CONFIRMATION_NEEDED)) {
			// The bank goes straight on: a TAN challenge, or nothing left to do.
			const hitan = response.findSegment<HITANSegment>(HITAN.Id);
			if (hitan?.orderReference && hitan.orderReference !== 'noref') {
				clientResponse.requiresTan = true;
				clientResponse.tanReference = hitan.orderReference;
				clientResponse.tanChallenge = hitan.challenge ?? '';
			}
			return;
		}

		if (!hivpp.vopId) {
			throw new Error('the bank sent the payee name check without a VOP-ID');
		}
		this.vopId = hivpp.vopId;
		clientResponse.requiresVopConfirmation = true;
	}
}

/**
 * The result from HIVPP: the single result group, or the status in the pain.002
 * report. For a single transfer the transaction status says more than the group
 * status (RVCM = "partial", i.e. close match or no match).
 */
function vopResult(hivpp: HIVPPSegment): VopResultCode | undefined {
	if (hivpp.result?.result) {
		return hivpp.result.result;
	}
	const report = hivpp.report ?? '';
	const group = /<GrpSts>\s*(\w{4})\s*<\/GrpSts>/.exec(report)?.[1];
	const single = /<OrgnlNbOfTxs>\s*1\s*<\/OrgnlNbOfTxs>/.test(report)
		? /<TxSts>\s*(\w{4})\s*<\/TxSts>/.exec(report)?.[1]
		: undefined;
	return (single ?? group) as VopResultCode | undefined;
}

/** The bank's first pain.002 format for the report, or the DK default */
function vopReportFormat(config: FinTSConfig): string {
	const params = config.getTransactionParameters<HIVPPSParameter>(HKVPP.Id);
	const formats = (params?.supportedReports ?? '')
		.split(';')
		.map((f) => f.trim())
		.filter(Boolean);
	return formats[0] ?? DEFAULT_VOP_REPORT;
}
