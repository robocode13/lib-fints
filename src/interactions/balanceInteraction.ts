import { ClientResponse, CustomerInteraction, CustomerOrderInteraction } from './customerInteraction.js';
import { CreditDebit } from '../codes.js';
import { Balance } from '../dataGroups/Balance.js';
import { Message } from '../message.js';
import { Segment } from '../segment.js';
import { HISAL, HISALSegment } from '../segments/HISAL.js';
import { HKSAL, HKSALSegment } from '../segments/HKSAL.js';
import { AccountBalance } from '../accountBalance.js';
import { FinTSConfig } from '../config.js';

export interface AccountBalanceResponse extends ClientResponse {
  balance?: AccountBalance;
}

export class BalanceInteraction extends CustomerOrderInteraction {
  constructor(public accountNumber: string) {
    super(HKSAL.Id, HISAL.Id);
  }

  createSegments(init: FinTSConfig): Segment[] {
    const bankAccount = init.getBankAccount(this.accountNumber);
    if (!init.isAccountTransactionSupported(this.accountNumber, this.segId)) {
      throw Error(`Account ${this.accountNumber} does not support business transaction '${this.segId}'`);
    }

    const version = init.getMaxSupportedTransactionVersion(HKSAL.Id);

    if (!version) {
      throw Error(`There is no supported version for business transaction '${HKSAL.Id}`);
    }

    const account = version <= 6 ? { ...bankAccount, iban: undefined, bic: undefined } : bankAccount;

    const hksal: HKSALSegment = {
      header: { segId: HKSAL.Id, segNr: 0, version: version },
      account,
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
        balance: balanceToValue(hisal.balance)!,
        notedBalance: balanceToValue(hisal.notedBalance),
        creditLimit: hisal.creditLimit?.value,
        availableAmount: hisal.availableAmount?.value,
      };
    }
  }
}

function balanceToValue(balance?: Balance): number | undefined {
  if (!balance) {
    return undefined;
  }
  return balance.creditDebit === CreditDebit.Credit ? balance.amount.value : -balance.amount.value;
}
