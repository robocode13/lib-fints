import { ClientResponse, CustomerOrderInteraction, StatementResponse } from './customerInteraction.js';
import { Message } from '../message.js';
import { HKCAZ, HKCAZSegment } from '../segments/HKCAZ.js';
import { HICAZ, HICAZSegment } from '../segments/HICAZ.js';
import { CamtParser } from '../camtParser.js';
import { Statement } from '../statement.js';
import { Segment } from '../segment.js';
import { FinTSConfig } from '../config.js';

export class StatementInteractionCAMT extends CustomerOrderInteraction {
  private acceptedCamtFormats: string[] = ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'];

  constructor(public accountNumber: string, public from?: Date, public to?: Date) {
    super(HKCAZ.Id, HICAZ.Id);
  }

  createSegments(init: FinTSConfig): Segment[] {
    const bankAccount = init.getBankAccount(this.accountNumber);
    const version = init.getMaxSupportedTransactionVersion(HKCAZ.Id);
    if (!version) {
      throw Error(`There is no supported version for business transaction '${HKCAZ.Id}'`);
    }

    const hkcaz: HKCAZSegment = {
      header: { segId: HKCAZ.Id, segNr: 0, version: version },
      account: bankAccount,
      acceptedCamtFormats: this.acceptedCamtFormats,
      allAccounts: false,
      from: this.from,
      to: this.to,
    };

    return [hkcaz];
  }

  handleResponse(response: Message, clientResponse: StatementResponse) {
    const hicaz = response.findSegment<HICAZSegment>(HICAZ.Id);
    if (hicaz && hicaz.bookedTransactions && hicaz.bookedTransactions.length > 0) {
      try {
        // Parse all CAMT messages (one per booking day) and combine statements
        const allStatements: Statement[] = [];
        for (const camtMessage of hicaz.bookedTransactions) {
          const parser = new CamtParser(camtMessage);
          const statements = parser.parse();
          allStatements.push(...statements);
        }
        clientResponse.statements = allStatements;
      } catch (error) {
        console.warn('CAMT parsing failed:', error);
        clientResponse.statements = [];
      }
    } else {
      clientResponse.statements = [];
    }
  }
}
