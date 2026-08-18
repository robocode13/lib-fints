import type { FinTSConfig } from '../config.js';
import { internationalAccount, nationalAccount } from '../accountDescriptor.js';
import type { ElectronicStatement } from '../electronicStatement.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HIEKA, type HIEKASegment } from '../segments/HIEKA.js';
import type { HIEKASParameter } from '../segments/HIEKAS.js';
import { HKEKA, type HKEKASegment, type StatementFormat } from '../segments/HKEKA.js';
import { type ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';

export interface ElectronicStatementResponse extends ClientResponse {
	statements: ElectronicStatement[];
	/**
	 * The offset to pass to the next call when the bank announced further documents
	 * (answer code 3040), undefined when no more statements are waiting.
	 */
	nextOffset?: string;
}

export interface ElectronicStatementOptions {
	/** The format to request, defaults to the first format the bank announces in HIEKAS */
	format?: StatementFormat;
	/** Fetch one specific statement, only allowed when the bank sets `indexAllowed` */
	number?: number;
	/** The year the statement number refers to */
	year?: number;
	maxEntries?: number;
	/** The offset from a previous response's `nextOffset` */
	offset?: string;
}

/**
 * Turns the latin1 string the parser produced back into the bytes the bank sent.
 */
function toBytes(binary: string): Uint8Array {
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i) & 0xff;
	}
	return bytes;
}

const PDF_MAGIC = '%PDF';

/**
 * Some banks base64-encode the document although the field is declared binary — a known
 * quirk of HIEKP v1 that may apply here as well.
 *
 * This only unwraps when it can prove the result: the payload must consist of base64
 * characters only AND decode to something that actually starts with a PDF header.
 * Anything else is passed through untouched, so a document is never silently mangled.
 */
function unwrapBase64(bytes: Uint8Array): Uint8Array {
	const text = new TextDecoder('latin1').decode(bytes);

	if (text.startsWith(PDF_MAGIC) || !/^[A-Za-z0-9+/\s]+={0,2}\s*$/.test(text)) {
		return bytes;
	}

	try {
		const decoded = Buffer.from(text, 'base64');
		return decoded.subarray(0, PDF_MAGIC.length).toString('latin1') === PDF_MAGIC
			? new Uint8Array(decoded)
			: bytes;
	} catch {
		return bytes;
	}
}

export class ElectronicStatementInteraction extends CustomerOrderInteraction {
	constructor(
		public accountNumber: string,
		public options: ElectronicStatementOptions = {},
	) {
		super(HKEKA.Id, HIEKA.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		const bankAccount = init.getBankAccount(this.accountNumber);
		const version = init.getMaxSupportedTransactionVersion(HKEKA.Id);
		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKEKA.Id}'`);
		}

		const params = init.getTransactionParameters<HIEKASParameter>(HKEKA.Id);
		const format =
			this.options.format ?? (params?.supportedFormats?.[0] as StatementFormat | undefined);

		const hkeka: HKEKASegment = {
			header: { segId: HKEKA.Id, segNr: 0, version: version },
			account:
				version <= 3 ? nationalAccount(bankAccount) : internationalAccount(init, bankAccount),
			statementFormat: format,
			statementNumber: this.options.number,
			statementYear: this.options.year,
			maxEntries: this.options.maxEntries,
			offset: this.options.offset,
		};

		return [hkeka];
	}

	handleResponse(response: Message, clientResponse: ElectronicStatementResponse) {
		const segments = response.findAllSegments<HIEKASegment>(HIEKA.Id);

		clientResponse.statements = segments.map((hieka) => {
			const names = [hieka.name, hieka.name2, hieka.name3].filter((name) => !!name);

			return {
				format: hieka.format,
				from: hieka.timeRange?.from,
				to: hieka.timeRange?.to,
				date: hieka.date,
				year: hieka.year,
				number: hieka.number,
				document: unwrapBase64(toBytes(hieka.booked ?? '')),
				closingInfo: hieka.closingInfo,
				conditionsInfo: hieka.conditionsInfo,
				advertisement: hieka.advertisement,
				iban: hieka.iban,
				bic: hieka.bic,
				accountName: names.length > 0 ? names.join(' ') : undefined,
				receipt: hieka.receipt,
			};
		});

		clientResponse.nextOffset = clientResponse.bankAnswers.find(
			(answer) => answer.code === 3040,
		)?.params?.[0];
	}
}
