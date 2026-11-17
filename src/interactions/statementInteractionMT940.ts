import { internationalAccount, nationalAccount } from '../accountDescriptor.js';
import type { AccountRef } from '../bankAccount.js';
import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import { Mt940Parser } from '../mt940parser.js';
import type { Segment } from '../segment.js';
import { HIKAZ, type HIKAZSegment } from '../segments/HIKAZ.js';
import { HKKAZ, type HKKAZSegment } from '../segments/HKKAZ.js';
import { CustomerOrderInteraction, type StatementResponse } from './customerInteraction.js';

export class StatementInteractionMT940 extends CustomerOrderInteraction {
	constructor(
		public account: AccountRef,
		public from?: Date,
		public to?: Date,
	) {
		super(HKKAZ.Id, HIKAZ.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		const bankAccount = init.getBankAccount(this.account);
		const version = init.getMaxSupportedTransactionVersion(HKKAZ.Id);

		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKKAZ.Id}'`);
		}

		const account =
			version <= 6 ? nationalAccount(bankAccount) : internationalAccount(init, bankAccount);

		const hkkaz: HKKAZSegment = {
			header: { segId: HKKAZ.Id, segNr: 0, version: version },
			account: account,
			allAccounts: false,
			from: this.from,
			to: this.to,
		};

		return [hkkaz];
	}

	handleResponse(response: Message, clientResponse: StatementResponse) {
		// A response the bank spread over several messages arrives as several HIKAZ
		// segments. Unlike CAMT these carry one continuous MT940 stream, so their
		// payloads are joined rather than listed.
		const bookedTransactions = response
			.findAllSegments<HIKAZSegment>(HIKAZ.Id)
			.map((segment) => segment.bookedTransactions)
			.filter((booked) => !!booked)
			.join('');

		if (bookedTransactions) {
			// A parse failure is thrown: an empty result would look like an account
			// without transactions.
			clientResponse.statements = new Mt940Parser(bookedTransactions).parse();
		} else {
			clientResponse.statements = [];
		}
	}
}
