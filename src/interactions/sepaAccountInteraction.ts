import type { AccountRef } from '../bankAccount.js';
import type { FinTSConfig } from '../config.js';
import type { SepaAccount } from '../dataGroups/SepaAccount.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HISPA, type HISPASegment } from '../segments/HISPA.js';
import { HKSPA, type HKSPASegment } from '../segments/HKSPA.js';
import { type ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';

export interface SepaAccountResponse extends ClientResponse {
	sepaAccounts?: SepaAccount[];
}

export class SepaAccountInteraction extends CustomerOrderInteraction {
	constructor(
		public accounts?: AccountRef[], // optional: only these accounts
		public maxEntries?: number,
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

		const accounts = this.accounts?.map((account) => init.getBankAccount(account));

		const hkspa: HKSPASegment = {
			header: { segId: HKSPA.Id, segNr: 0, version: version },
			accounts: accounts,
			maxEntries: this.maxEntries,
		};

		return [hkspa];
	}

	handleResponse(response: Message, clientResponse: SepaAccountResponse) {
		// A response the bank spread over several messages arrives as several HISPA
		// segments, each carrying its own share of the accounts.
		const hispaSegments = response.findAllSegments<HISPASegment>(HISPA.Id);
		if (hispaSegments.length > 0) {
			clientResponse.sepaAccounts = hispaSegments.flatMap((segment) => segment.sepaAccounts ?? []);

			this.dialog?.config.bankingInformation.upd?.bankAccounts.forEach((bankAccount) => {
				bankAccount.isSepaAccount = false;
			});

			clientResponse.sepaAccounts.forEach((sepaAccount) => {
				// Matched, not resolved: this is the bank listing its own accounts, and at an
				// institution where two of them share a number, demanding an unambiguous
				// answer here would fail every dialog before it reached its order.
				const bankAccount = this.dialog?.config.matchBankAccount(sepaAccount);
				if (bankAccount && !bankAccount.isSepaAccount) {
					bankAccount.isSepaAccount = sepaAccount.isSepaAccount;
					bankAccount.iban = sepaAccount.iban;
					bankAccount.bic = sepaAccount.bic;
				}
			});
		}
	}
}
