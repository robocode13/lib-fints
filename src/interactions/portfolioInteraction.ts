import { describeAccount, type AccountRef } from '../bankAccount.js';
import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import { type Holding, Mt535Parser, type StatementOfHoldings } from '../mt535parser.js';
import type { Segment } from '../segment.js';
import { HIWPD, type HIWPDSegment } from '../segments/HIWPD.js';
import { HKWPD, type HKWPDSegment } from '../segments/HKWPD.js';
import { type ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';

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
		public account: AccountRef,
		private currency?: string,
		private priceQuality?: '1' | '2',
		private maxEntries?: number,
		private paginationMarker?: string,
	) {
		super(HKWPD.Id, HIWPD.Id);
	}

	createSegments(config: FinTSConfig): Segment[] {
		const bankAccount = config.getBankAccount(this.account);
		if (!config.isAccountTransactionSupported(this.account, this.segId)) {
			throw Error(
				`Account ${describeAccount(this.account)} does not support business transaction '${this.segId}'`,
			);
		}

		const depotAccount = { ...bankAccount, iban: undefined }; // HKWPD uses KTV which doesn't have IBAN

		const version = config.getMaxSupportedTransactionVersion(HKWPD.Id);

		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKWPD.Id}'`);
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
		// A response the bank spread over several messages arrives as several HIWPD
		// segments carrying one continuous MT535 stream, so their payloads are joined.
		const portfolioStatement = response
			.findAllSegments<HIWPDSegment>(HIWPD.Id)
			.map((segment) => segment.portfolioStatement)
			.filter((statement) => !!statement)
			.join('');

		if (portfolioStatement) {
			try {
				// Parse the MT535 data
				const parser = new Mt535Parser(portfolioStatement);
				clientResponse.portfolioStatement = parser.parse();
			} catch (error) {
				console.warn('Failed to parse MT535 portfolio statement:', error);
				// Fallback: provide raw data if parsing fails
				clientResponse.rawMT535Data = portfolioStatement;
			}
		}
	}
}
