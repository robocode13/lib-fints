import { ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';
import { Message } from '../message.js';
import { Segment } from '../segment.js';
import { HISPA, HISPASegment } from '../segments/HISPA.js';
import { HKSPA, HKSPASegment } from '../segments/HKSPA.js';
import { FinTSConfig } from '../config.js';
import { SepaAccount } from '../dataGroups/SepaAccount.js';

export interface SepaAccountResponse extends ClientResponse {
	sepaAccounts?: SepaAccount[];
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

			this.dialog!.config.bankingInformation.upd!.bankAccounts.forEach((bankAccount) => {
				bankAccount.isSepaAccount = false;
			});

			clientResponse.sepaAccounts.forEach((sepaAccount) => {
				const bankAccount = this.dialog!.config.getBankAccount(sepaAccount.accountNumber);
				if (bankAccount) {
					bankAccount.isSepaAccount = sepaAccount.isSepaAccount;
					bankAccount.iban = sepaAccount.iban;
					bankAccount.bic = sepaAccount.bic;
				}
			});
		}
	}
}
