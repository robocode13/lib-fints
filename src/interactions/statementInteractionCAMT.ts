import { CamtParser } from '../camtParser.js';
import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HICAZ, type HICAZSegment } from '../segments/HICAZ.js';
import type { HICAZSParameter } from '../segments/HICAZS.js';
import { HKCAZ, type HKCAZSegment } from '../segments/HKCAZ.js';
import type { Statement } from '../statement.js';
import { CustomerOrderInteraction, type StatementResponse } from './customerInteraction.js';

export class StatementInteractionCAMT extends CustomerOrderInteraction {
	constructor(
		public accountNumber: string,
		public from?: Date,
		public to?: Date,
	) {
		super(HKCAZ.Id, HICAZ.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		const bankAccount = init.getBankAccount(this.accountNumber);
		const version = init.getMaxSupportedTransactionVersion(HKCAZ.Id);
		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKCAZ.Id}'`);
		}

		let acceptedCamtFormats = ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'];

		const params = init.getTransactionParameters<HICAZSParameter>(HKCAZ.Id);

		if (params && params.supportedCamtFormats.length > 0) {
			acceptedCamtFormats = params.supportedCamtFormats.filter((format) =>
				format.startsWith('urn:iso:std:iso:20022:tech:xsd:camt.052.001.'),
			);
		}

		const hkcaz: HKCAZSegment = {
			header: { segId: HKCAZ.Id, segNr: 0, version: version },
			account: bankAccount,
			acceptedCamtFormats: acceptedCamtFormats,
			allAccounts: false,
			from: this.from,
			to: this.to,
		};

		return [hkcaz];
	}

	handleResponse(response: Message, clientResponse: StatementResponse) {
		const hicaz = response.findSegment<HICAZSegment>(HICAZ.Id);
		if (hicaz?.bookedTransactions && hicaz.bookedTransactions.length > 0) {
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
