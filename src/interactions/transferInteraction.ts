import { ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';
import { Message } from '../message.js';
import { Segment } from '../segment.js';
import { HKCCS, HKCCSSegment } from '../segments/HKCCS.js';
import { FinTSConfig } from '../config.js';
import { BankAccount } from '../bankAccount.js';

/**
 * Request data for a SEPA credit transfer
 */
export interface TransferRequest {
	/** Name of the recipient */
	recipientName: string;
	/** IBAN of the recipient */
	recipientIban: string;
	/** BIC of the recipient (optional for SEPA zone) */
	recipientBic?: string;
	/** Amount to transfer */
	amount: number;
	/** Currency code (e.g., 'EUR') */
	currency: string;
	/** Purpose / reference text for the transfer */
	purpose: string;
	/** End-to-end ID for tracking (optional) */
	endToEndId?: string;
	/** Debtor name (optional, will use account holder if not provided) */
	debtorName?: string;
}

/**
 * Response from a SEPA credit transfer request
 */
export interface TransferResponse extends ClientResponse {
	/** Reference number from the bank (if provided in response code 3070) */
	referenceNumber?: string;
}

/**
 * Interaction for executing a SEPA credit transfer
 */
export class TransferInteraction extends CustomerOrderInteraction {
	constructor(
		public accountNumber: string,
		public transfer: TransferRequest
	) {
		super(HKCCS.Id, HKCCS.Id); // HKCCS has no response segment
	}

	createSegments(config: FinTSConfig): Segment[] {
		const bankAccount = config.getBankAccount(this.accountNumber);

		if (!config.isAccountTransactionSupported(this.accountNumber, HKCCS.Id)) {
			throw Error(`Account ${this.accountNumber} does not support SEPA transfers`);
		}

		const version = config.getMaxSupportedTransactionVersion(HKCCS.Id);
		if (!version) {
			throw Error(`No supported version for '${HKCCS.Id}'`);
		}

		// Create SEPA pain.001 XML message
		const painMessage = this.createPainMessage(bankAccount, this.transfer);

		const hkccs: HKCCSSegment = {
			header: { segId: HKCCS.Id, segNr: 0, version },
			account: {
				iban: bankAccount.iban!,
				// BIC is optional for SEPA transfers within Europe
			},
			sepaDescriptor: 'urn:iso:std:iso:20022:tech:xsd:pain.001.003.03',
			sepaPainMessage: painMessage,
		};

		return [hkccs];
	}

	handleResponse(response: Message, clientResponse: TransferResponse) {
		// HKCCS returns no data segments, only return codes
		// Check for reference number in bank answers (code 3070)
		const refAnswer = clientResponse.bankAnswers.find((a) => a.code === 3070);
		if (refAnswer) {
			// Extract reference number from text like "Auftrag wird unter Referenz XXX verarbeitet"
			clientResponse.referenceNumber = this.extractReference(refAnswer.text);
		}
	}

	private createPainMessage(account: BankAccount, transfer: TransferRequest): string {
		const now = new Date();
		const messageId = `MSG-${now.getTime()}`;
		const endToEndId = transfer.endToEndId || 'NOTPROVIDED';
		const creationDateTime = now.toISOString();
		const debtorName = transfer.debtorName || 'Account Holder';

		// Format amount with 2 decimal places
		const formattedAmount = transfer.amount.toFixed(2);

		// Escape XML special characters in text fields
		const escapedDebtorName = this.escapeXml(debtorName);
		const escapedRecipientName = this.escapeXml(transfer.recipientName);
		const escapedPurpose = this.escapeXml(transfer.purpose);

		// Build pain.001.003.03 XML according to ISO 20022
		return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.003.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:pain.001.003.03 pain.001.003.03.xsd">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${messageId}</MsgId>
      <CreDtTm>${creationDateTime}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>${formattedAmount}</CtrlSum>
      <InitgPty>
        <Nm>${escapedDebtorName}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${messageId}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <ReqdExctnDt>1999-01-01</ReqdExctnDt>
      <Dbtr>
        <Nm>${escapedDebtorName}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${account.iban}</IBAN>
        </Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <Othr><Id>NOTPROVIDED</Id></Othr>
        </FinInstnId>
      </DbtrAgt>
      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${endToEndId}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="${transfer.currency}">${formattedAmount}</InstdAmt>
        </Amt>
        <CdtrAgt>
          <FinInstnId>
${transfer.recipientBic ? `            <BIC>${transfer.recipientBic}</BIC>` : '            <Othr><Id>NOTPROVIDED</Id></Othr>'}
          </FinInstnId>
        </CdtrAgt>
        <Cdtr>
          <Nm>${escapedRecipientName}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <IBAN>${transfer.recipientIban}</IBAN>
          </Id>
        </CdtrAcct>
        <RmtInf>
          <Ustrd>${escapedPurpose}</Ustrd>
        </RmtInf>
      </CdtTrfTxInf>
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;
	}

	private escapeXml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&apos;');
	}

	private extractReference(text: string): string | undefined {
		// Extract reference number from text like "Auftrag wird unter Referenz XXX verarbeitet"
		const match = text.match(/Referenz\s+(\S+)/i);
		return match?.[1];
	}
}
