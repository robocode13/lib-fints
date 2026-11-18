import { describe, expect, it } from 'vitest';
import { Pain002ParsingError, parsePain002 } from '../pain002Parser.js';

// Synthetic reports, shaped like the payment status reports banks send for
// Verification of Payee (DK VoP specification, chapter on pain.002)

const closeMatchReport = `<?xml version='1.0' encoding='UTF-8'?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.10">
	<CstmrPmtStsRpt>
		<GrpHdr>
			<MsgId>REPORT-0001</MsgId>
			<CreDtTm>2026-11-18T09:05:08</CreDtTm>
		</GrpHdr>
		<OrgnlGrpInfAndSts>
			<OrgnlMsgId>a1b2c3</OrgnlMsgId>
			<OrgnlMsgNmId>pain.001.001.09</OrgnlMsgNmId>
			<GrpSts>RVMC</GrpSts>
			<StsRsnInf>
				<AddtlInf>RVMC Der Name weicht vom Kontoinhaber ab</AddtlInf>
			</StsRsnInf>
		</OrgnlGrpInfAndSts>
		<OrgnlPmtInfAndSts>
			<OrgnlPmtInfId>d4e5f6</OrgnlPmtInfId>
			<PmtInfSts>RVMC</PmtInfSts>
			<TxInfAndSts>
				<OrgnlEndToEndId>E2E-2026-0001</OrgnlEndToEndId>
				<TxSts>RVMC</TxSts>
				<StsRsnInf>
					<AddtlInf>Max Mustermann</AddtlInf>
				</StsRsnInf>
				<OrgnlTxRef>
					<Cdtr>
						<Pty>
							<Nm>Max Musterman</Nm>
						</Pty>
					</Cdtr>
					<CdtrAcct>
						<Id>
							<IBAN>DE02120300000000202051</IBAN>
						</Id>
					</CdtrAcct>
				</OrgnlTxRef>
			</TxInfAndSts>
		</OrgnlPmtInfAndSts>
	</CstmrPmtStsRpt>
</Document>`;

describe('parsePain002', () => {
	it('parses a close-match report', () => {
		const report = parsePain002(closeMatchReport);

		expect(report.groupStatus).toBe('RVMC');
		expect(report.groupReasons).toEqual(['RVMC Der Name weicht vom Kontoinhaber ab']);
		expect(report.paymentInfoStatus).toBe('RVMC');
		expect(report.paymentInfoReasons).toEqual([]);
		expect(report.transactions).toEqual([
			{
				endToEndId: 'E2E-2026-0001',
				status: 'RVMC',
				reasons: ['Max Mustermann'],
				creditorName: 'Max Musterman',
				creditorIban: 'DE02120300000000202051',
			},
		]);
	});

	it('parses a group-only report without transaction details', () => {
		const report = parsePain002(
			'<?xml version="1.0" encoding="UTF-8"?>' +
				'<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.10"><CstmrPmtStsRpt>' +
				'<GrpHdr><MsgId>REPORT-0002</MsgId></GrpHdr>' +
				'<OrgnlGrpInfAndSts><OrgnlMsgId>a1</OrgnlMsgId><GrpSts>RCVC</GrpSts></OrgnlGrpInfAndSts>' +
				'</CstmrPmtStsRpt></Document>',
		);

		expect(report).toEqual({
			groupStatus: 'RCVC',
			groupReasons: [],
			paymentInfoStatus: undefined,
			paymentInfoReasons: [],
			transactions: [],
		});
	});

	it('collects several reason lines and transactions', () => {
		const report = parsePain002(
			'<Document><CstmrPmtStsRpt><OrgnlGrpInfAndSts><GrpSts>RVNM</GrpSts>' +
				'<StsRsnInf><AddtlInf>RVNM Zeile 1</AddtlInf><AddtlInf>Zeile 2</AddtlInf></StsRsnInf>' +
				'<StsRsnInf><AddtlInf>Zeile 3</AddtlInf></StsRsnInf></OrgnlGrpInfAndSts>' +
				'<OrgnlPmtInfAndSts><PmtInfSts>RVNM</PmtInfSts>' +
				'<TxInfAndSts><OrgnlEndToEndId>A</OrgnlEndToEndId><TxSts>RCVC</TxSts></TxInfAndSts>' +
				'<TxInfAndSts><OrgnlEndToEndId>B</OrgnlEndToEndId><TxSts>RVNM</TxSts></TxInfAndSts>' +
				'</OrgnlPmtInfAndSts></CstmrPmtStsRpt></Document>',
		);

		expect(report.groupReasons).toEqual(['RVNM Zeile 1', 'Zeile 2', 'Zeile 3']);
		expect(report.transactions.map((tx) => [tx.endToEndId, tx.status])).toEqual([
			['A', 'RCVC'],
			['B', 'RVNM'],
		]);
	});

	it('reads the creditor name of versions before pain.002.001.08', () => {
		const report = parsePain002(
			'<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.03"><CstmrPmtStsRpt>' +
				'<OrgnlGrpInfAndSts><GrpSts>RVNM</GrpSts></OrgnlGrpInfAndSts><OrgnlPmtInfAndSts>' +
				'<TxInfAndSts><TxSts>RVNM</TxSts><OrgnlTxRef><Cdtr><Nm>Max Mustermann</Nm></Cdtr>' +
				'</OrgnlTxRef></TxInfAndSts></OrgnlPmtInfAndSts></CstmrPmtStsRpt></Document>',
		);

		expect(report.transactions[0].creditorName).toBe('Max Mustermann');
	});

	it('handles namespace prefixes and entities', () => {
		const report = parsePain002(
			'<p:Document xmlns:p="urn:iso:std:iso:20022:tech:xsd:pain.002.001.10"><p:CstmrPmtStsRpt>' +
				'<p:OrgnlGrpInfAndSts><p:GrpSts>RVMC</p:GrpSts></p:OrgnlGrpInfAndSts><p:OrgnlPmtInfAndSts>' +
				'<p:TxInfAndSts><p:TxSts>RVMC</p:TxSts><p:StsRsnInf><p:AddtlInf>M&amp;M GmbH</p:AddtlInf>' +
				'</p:StsRsnInf></p:TxInfAndSts></p:OrgnlPmtInfAndSts></p:CstmrPmtStsRpt></p:Document>',
		);

		expect(report.groupStatus).toBe('RVMC');
		expect(report.transactions[0].reasons).toEqual(['M&M GmbH']);
	});

	it('rejects malformed XML', () => {
		expect(() => parsePain002('<Document><CstmrPmtStsRpt></Document>')).toThrow(
			Pain002ParsingError,
		);
	});

	it('rejects documents that are not payment status reports', () => {
		expect(() =>
			parsePain002('<Document><CstmrCdtTrfInitn><GrpHdr/></CstmrCdtTrfInitn></Document>'),
		).toThrow('Document does not contain a CstmrPmtStsRpt element');
		expect(() => parsePain002('<Other/>')).toThrow(Pain002ParsingError);
	});
});
