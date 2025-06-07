import {
  ClientResponse,
  CustomerOrderInteraction,
} from './customerInteraction.js';
import { FinTSConfig } from '../config.js';
import { Message } from '../message.js';
import { Segment } from '../segment.js';
import { HKWPD, HKWPDSegment } from '../segments/HKWPD.js';
import { HIWPD, HIWPDSegment } from '../segments/HIWPD.js';
import { Mt535Parser, StatementOfHoldings, Holding } from '../mt535parser.js';

/**
 * Represents a single holding within a stock portfolio.
 * This is an alias for the Holding interface from the MT535 parser.
 */
export type PortfolioHolding = Holding;

/**
 * Represents the structured portfolio data parsed from an MT535 message.
 * This is an alias for the StatementOfHoldings interface from the MT535 parser.
 */
export type ParsedPortfolioStatement = StatementOfHoldings;

export interface PortfolioResponse extends ClientResponse {
  /**
   * The parsed portfolio statement containing holdings and total value
   */
  portfolioStatement?: ParsedPortfolioStatement;
  /**
   * Raw MT535 data if parsing fails
   */
  rawMT535Data?: string;
}

/**
 * Interaction for requesting and parsing stock portfolio information (HKWPD/HIWPD)
 */
export class PortfolioInteraction extends CustomerOrderInteraction {
  constructor(
    public accountNumber: string,
    private currency?: string,
    private priceQuality?: '1' | '2',
    private maxEntries?: number,
    private paginationMarker?: string
  ) {
    super(HKWPD.Id, HIWPD.Id);
  }

  createSegments(config: FinTSConfig): Segment[] {
    const bankAccount = config.getBankAccount(this.accountNumber);
    if (!config.isAccountTransactionSupported(this.accountNumber, this.segId)) {
      throw Error(
        `Account ${this.accountNumber} does not support business transaction '${this.segId}'`
      );
    }

    const depotAccount = { ...bankAccount, iban: undefined }; // HKWPD uses KTV which doesn't have IBAN

    const version = config.getMaxSupportedTransactionVersion(HKWPD.Id);

    if (!version) {
      throw Error(
        `There is no supported version for business transaction '${HKWPD.Id}'`
      );
    }

    const hkwpd: HKWPDSegment = {
      header: { segId: HKWPD.Id, segNr: 0, version: version },
      depot: depotAccount,
      currency: this.currency,
      priceQuality: this.priceQuality,
      maxEntries: this.maxEntries,
      paginationMarker: this.paginationMarker,
    };

    return [hkwpd];
  }

  handleResponse(response: Message, clientResponse: PortfolioResponse): void {
    const hiwpdSegment = response.findSegment<HIWPDSegment>(HIWPD.Id);

    if (hiwpdSegment?.portfolioStatement) {
      try {
        // Parse the MT535 data
        const parser = new Mt535Parser(hiwpdSegment.portfolioStatement);
        clientResponse.portfolioStatement = parser.parse();
      } catch (error) {
        console.warn('Failed to parse MT535 portfolio statement:', error);
        // Fallback: provide raw data if parsing fails
        clientResponse.rawMT535Data = hiwpdSegment.portfolioStatement;
      }
    }
  }
}
