import type { AccountBalance } from '../accountBalance.js';
import { CreditDebit } from '../codes.js';
import { describeAccount, type AccountRef } from '../bankAccount.js';
import type { FinTSConfig } from '../config.js';
import type { Balance } from '../dataGroups/Balance.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HISAL, type HISALSegment } from '../segments/HISAL.js';
import { HKSAL, type HKSALSegment } from '../segments/HKSAL.js';
import { type ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';

export interface AccountBalanceResponse extends ClientResponse {
	balance?: AccountBalance;
}

export class BalanceInteraction extends CustomerOrderInteraction {
	constructor(public account: AccountRef) {
		super(HKSAL.Id, HISAL.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		const bankAccount = init.getBankAccount(this.account);
		if (!init.isAccountTransactionSupported(this.account, this.segId)) {
			throw Error(
				`Account ${describeAccount(this.account)} does not support business transaction '${this.segId}'`,
			);
		}

		const version = init.getMaxSupportedTransactionVersion(HKSAL.Id);

		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKSAL.Id}`);
		}

		const descriptor =
			version <= 6 ? { ...bankAccount, iban: undefined, bic: undefined } : bankAccount;

		const hksal: HKSALSegment = {
			header: { segId: HKSAL.Id, segNr: 0, version: version },
			account: descriptor,
			allAccounts: false,
		};

		return [hksal];
	}

	handleResponse(response: Message, clientResponse: AccountBalanceResponse) {
		const hisal = response.findSegment<HISALSegment>(HISAL.Id);
		if (hisal) {
			clientResponse.balance = {
				date: hisal.balance.date,
				currency: hisal.currency,
				balance: balanceToValue(hisal.balance),
				notedBalance: hisal.notedBalance ? balanceToValue(hisal.notedBalance) : undefined,
				creditLimit: hisal.creditLimit?.value,
				availableAmount: hisal.availableAmount?.value,
			};
		}
	}
}

function balanceToValue(balance: Balance): number {
	return balance.creditDebit === CreditDebit.Credit ? balance.amount.value : -balance.amount.value;
}
