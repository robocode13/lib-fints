import { ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';
import { Message } from '../message.js';
import { DKKKU, DKKKUSegment } from '../segments/DKKKU.js';
import { DIKKU, DIKKUSegment } from '../segments/DIKKU.js';
import { Segment } from '../segment.js';
import { CreditCardStatement } from '../creditCardStatement.js'
import { FinTSConfig } from '../config.js';
import {AccountBalance} from "../accountBalance.js";

export interface CreditCardStatementResponse extends ClientResponse {
  balance: AccountBalance;
  statements: CreditCardStatement[];
}

export class CreditCardStatementInteraction extends CustomerOrderInteraction {
  constructor(public accountNumber: string, public from?: Date) {
    super(DKKKU.Id, DIKKU.Id);
  }

  createSegments(init: FinTSConfig): Segment[] {
    const bankAccount = init.getBankAccount(this.accountNumber);
    if (!init.isAccountTransactionSupported(this.accountNumber, this.segId)) {
      throw Error(`Account ${this.accountNumber} does not support business transaction '${this.segId}'`);
    }

    const account = { ...bankAccount, iban: undefined };

    const version = 2;

    const dkkku: DKKKUSegment = {
      header: { segId: DKKKU.Id, segNr: 0, version: version },
      account,
      accountNumber: account.accountNumber,
      subAccountId: account.subAccountId,
      from: this.from,
    };

    return [dkkku];
  }

  handleResponse(response: Message, clientResponse: CreditCardStatementResponse) {
    function parseGermanFloat(value: string): number {
      const valueFloatStr = value.replaceAll('.', '').replaceAll(',', '.');
      return parseFloat(valueFloatStr);
    }

    const dikku = response.findSegment<DIKKUSegment>(DIKKU.Id);
    if (dikku) {
      const creditDebit = dikku.balance.creditDebit;
      const balanceAmount = dikku.balance.amount.value * (creditDebit === 'D' ? -1 : 1);
      const balanceCurrency = dikku.balance.amount.currency;
      const balanceDateTime = dikku.balance.date;
      if (dikku.balance.time) {
        balanceDateTime.setUTCHours(dikku.balance.time.getUTCHours());
        balanceDateTime.setUTCMinutes(dikku.balance.time.getUTCMinutes());
        balanceDateTime.setUTCSeconds(dikku.balance.time.getUTCSeconds());
      }
      clientResponse.balance = {
        balance: balanceAmount,
        date: balanceDateTime,
        currency: balanceCurrency,
      }
      clientResponse.statements = [];
      for (let i = 0 ; i < dikku.transactions.length; i++) {
        const parts = dikku.transactions[i].split(':');
        // const accountNumber = parts[0];
        const transactionDateStr = parts[1];
        const valueDateStr = parts[2];
        const currencyOrig = parts[5];
        const depositMarkerOrig = parts[6];
        const amountOrig = parseGermanFloat(parts[4]) * (depositMarkerOrig === 'D' ? -1 : 1);
        const exchangeRate = parseGermanFloat(parts[7]);

        const currency = parts[9];
        const depositMarker = parts[10];
        const amount = parseGermanFloat(parts[8]) * (depositMarker === 'D' ? -1 : 1);

        const tYear = parseInt(transactionDateStr.substring(0, 4));
        const tMonth = parseInt(transactionDateStr.substring(4, 6));
        const tDay = parseInt(transactionDateStr.substring(6, 8));
        const vYear = parseInt(valueDateStr.substring(0, 4));
        const vMonth = parseInt(valueDateStr.substring(4, 6));
        const vDay = parseInt(valueDateStr.substring(6, 8));
        let purpose = '';
        let pIdx = 11;
        do {
          let partPurpose = parts[pIdx].trim();
          if (partPurpose === 'J') {
            break;
          }
          purpose = purpose + partPurpose;
          if (purpose.endsWith('Betrag?')) {
            purpose = purpose.slice(0, purpose.length - 7) + ' Betrag ';
          } else if (purpose[purpose.length - 1] === '?') {
            purpose = purpose.slice(0, purpose.length - 1) + ' ';
          } else {
            break;
          }
          pIdx += 1;
        } while (pIdx < 21);
        const statement: CreditCardStatement = {
          transactionDate: new Date(tYear, tMonth - 1, tDay),
          valueDate: new Date(vYear, vMonth - 1, vDay),
          currency: currency,
          amount: amount,
          purpose: purpose,
          originalCurrency: currencyOrig,
          originalAmount: amountOrig,
          exchangeRate: exchangeRate,
        }
        clientResponse.statements = clientResponse.statements.concat(statement);
      }
    } else {
      clientResponse.statements = [];
    }
  }
}
