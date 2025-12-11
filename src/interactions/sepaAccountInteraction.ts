import { ClientResponse, CustomerInteraction, CustomerOrderInteraction } from './customerInteraction.js';
import { Message } from '../message.js';
import { Segment } from '../segment.js';
import { HISPA, HISPASegment } from '../segments/HISPA.js';
import { HKSPA, HKSPASegment } from '../segments/HKSPA.js';
import { InternationalAccount } from '../dataGroups/InternationalAccount.js';
import { FinTSConfig } from '../config.js';

export interface SepaAccountResponse extends ClientResponse {
	sepaAccounts?: InternationalAccount[];
}

export class SepaAccountInteraction extends CustomerOrderInteraction {
	constructor(
		public accounts?: string[], // optional specific account numbers
		public maxEntries?: number
	) {
		super(HKSPA.Id, HISPA.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		if (!init.isTransactionSupported(this.segId)) {
			throw Error(`Business transaction '${this.segId}' is not supported by this bank`);
		}

		const version = init.getMaxSupportedTransactionVersion(HKSPA.Id);

		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKSPA.Id}'`);
		}

		const accounts = this.accounts?.map((accountNumber) => {
			return init.getBankAccount(accountNumber);
		});

		const hkspa: HKSPASegment = {
			header: { segId: HKSPA.Id, segNr: 0, version: version },
			accounts: accounts,
			maxEntries: this.maxEntries,
		};

		return [hkspa];
	}

	handleResponse(response: Message, clientResponse: SepaAccountResponse) {
		const hispa = response.findSegment<HISPASegment>(HISPA.Id);
		if (hispa) {
			clientResponse.sepaAccounts = hispa.sepaAccounts || [];
		}
	}
}
