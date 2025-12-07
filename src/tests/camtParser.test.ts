import { describe, it, expect } from 'vitest';
import { CamtParser } from '../camtParser.js';

describe('CamtParser', () => {
	it('should parse CAMT.052 XML with balances and transactions', () => {
		const camtXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.02">
  <BkToCstmrAcctRpt>
    <GrpHdr>
      <MsgId>camt52_20131118101510__ONLINEBA</MsgId>
      <CreDtTm>2013-11-18T10:15:10+01:00</CreDtTm>
    </GrpHdr>
    <Rpt>
      <Id>camt052_ONLINEBA</Id>
      <ElctrncSeqNb>00001</ElctrncSeqNb>
      <CreDtTm>2013-11-18T10:15:10+01:00</CreDtTm>
      <Acct>
        <Id>
          <IBAN>DE06940594210000027227</IBAN>
        </Id>
        <Ccy>EUR</Ccy>
      </Acct>
      <Bal>
        <Tp>
          <CdOrPrtry>
            <Cd>PRCD</Cd>
          </CdOrPrtry>
        </Tp>
        <Amt Ccy="EUR">1000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt>
          <Dt>2013-10-31</Dt>
        </Dt>
      </Bal>
      <Bal>
        <Tp>
          <CdOrPrtry>
            <Cd>CLBD</Cd>
          </CdOrPrtry>
        </Tp>
        <Amt Ccy="EUR">1500.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt>
          <Dt>2013-11-04</Dt>
        </Dt>
      </Bal>
      <Ntry>
        <Amt>500.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt>
          <Dt>2013-11-01</Dt>
        </BookgDt>
        <ValDt>
          <Dt>2013-11-01</Dt>
        </ValDt>
        <AcctSvcrRef>TXN001</AcctSvcrRef>
        <BkTxCd>
          <Prtry>
            <Cd>TRF</Cd>
          </Prtry>
        </BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>E2E123</EndToEndId>
              <MndtId>MANDT001</MndtId>
            </Refs>
            <RmtInf>
              <Ustrd>Test payment</Ustrd>
            </RmtInf>
            <RltdPties>
              <Dbtr>
                <Nm>John Doe</Nm>
              </Dbtr>
              <DbtrAcct>
                <Id>
                  <IBAN>DE12345678901234567890</IBAN>
                </Id>
              </DbtrAcct>
              <Cdtr>
								<Nm>Jane Doe</Nm>
							</Cdtr>
							<CdtrAcct>
								<Id>
                  <IBAN>DE12345678901234567891</IBAN>
								</Id>
							</CdtrAcct>
            </RltdPties>
						<RltdAgts>
							<DbtrAgt>
								<FinInstnId>
									<BIC>BYLADEM1001</BIC>
								</FinInstnId>
							</DbtrAgt>
							<CdtrAgt>
								<FinInstnId>
									<BIC>DEUTDEFF</BIC>
								</FinInstnId>
							</CdtrAgt>
						</RltdAgts>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Rpt>
  </BkToCstmrAcctRpt>
</Document>`;

		const parser = new CamtParser(camtXml);
		const statements = parser.parse();

		expect(statements).toHaveLength(1);

		const statement = statements[0];
		expect(statement.account).toBe('DE06940594210000027227');
		expect(statement.number).toBe('camt052_ONLINEBA');
		expect(statement.transactionReference).toBe('00001');

		// Check balances
		expect(statement.openingBalance).toBeDefined();
		expect(statement.openingBalance.value).toBe(1000.0);
		expect(statement.openingBalance.currency).toBe('EUR');

		expect(statement.closingBalance).toBeDefined();
		expect(statement.closingBalance.value).toBe(1500.0);
		expect(statement.closingBalance.currency).toBe('EUR');

		// Check transactions
		expect(statement.transactions).toHaveLength(1);

		const transaction = statement.transactions[0];
		expect(transaction.amount).toBe(500.0);
		expect(transaction.customerReference).toBe('E2E123');
		expect(transaction.bankReference).toBe('TXN001');
		expect(transaction.purpose).toBe('Test payment');
		expect(transaction.remoteName).toBe('John Doe');
		expect(transaction.remoteAccountNumber).toBe('DE12345678901234567890');
		expect(transaction.remoteBankId).toBe('BYLADEM1001'); // Credit transaction uses DbtrAgt BIC
		expect(transaction.e2eReference).toBe('E2E123');
		expect(transaction.mandateReference).toBe('MANDT001');
	});

	it('should handle debit transactions correctly', () => {
		const camtXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.02">
  <BkToCstmrAcctRpt>
    <Rpt>
      <Id>test</Id>
      <Acct>
        <Id>
          <IBAN>DE06940594210000027227</IBAN>
        </Id>
      </Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">1000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2013-10-31</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">800.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2013-11-01</Dt></Dt>
      </Bal>
      <Ntry>
        <Amt>200.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2013-11-01</Dt></BookgDt>
        <ValDt><Dt>2013-11-01</Dt></ValDt>
        <AcctSvcrRef>TXN002</AcctSvcrRef>
        <NtryDtls>
					<TxDtls>
						<Refs>
							<EndToEndId>485315597247918</EndToEndId>
						</Refs>
						<AmtDtls>
							<TxAmt>
								<Amt Ccy="EUR">5.83</Amt>
							</TxAmt>
						</AmtDtls>
						<RltdPties>
							<Dbtr>
								<Nm>Jane Doe</Nm>
							</Dbtr>
							<DbtrAcct>
								<Id>
                  <IBAN>DE12345678901234567891</IBAN>
								</Id>
							</DbtrAcct>
							<Cdtr>
								<Nm>John Doe</Nm>
							</Cdtr>
							<CdtrAcct>
								<Id>
                  <IBAN>DE12345678901234567890</IBAN>
								</Id>
							</CdtrAcct>
						</RltdPties>
						<RltdAgts>
							<DbtrAgt>
								<FinInstnId>
									<BIC>SOGEDEFF</BIC>
								</FinInstnId>
							</DbtrAgt>
							<CdtrAgt>
								<FinInstnId>
									<BIC>DEUTDEFF</BIC>
								</FinInstnId>
							</CdtrAgt>
						</RltdAgts>
						<Purp>
							<Cd>IDCP</Cd>
						</Purp>
						<RmtInf>
							<Ustrd>Test payment</Ustrd>
						</RmtInf>
					</TxDtls>
				</NtryDtls>
				<AddtlNtryInf>Additional Info</AddtlNtryInf>
      </Ntry>
    </Rpt>
  </BkToCstmrAcctRpt>
</Document>`;

		const parser = new CamtParser(camtXml);
		const statements = parser.parse();

		expect(statements).toHaveLength(1);
		expect(statements[0].transactions).toHaveLength(1);
		expect(statements[0].transactions[0].amount).toBe(-200.0); // Should be negative for debit

		const transaction = statements[0].transactions[0];
		expect(transaction.purpose).toBe('Test payment');
		expect(transaction.remoteName).toBe('John Doe');
		expect(transaction.remoteAccountNumber).toBe('DE12345678901234567890');
		expect(transaction.remoteBankId).toBe('DEUTDEFF'); // Debit transaction uses CdtrAgt BIC
	});

	it('should handle empty or invalid XML gracefully', () => {
		const parser = new CamtParser('invalid xml');
		const statements = parser.parse();
		expect(statements).toHaveLength(0); // Should return empty array instead of throwing
	});

	it('should handle multiple reports', () => {
		const camtXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.02">
  <BkToCstmrAcctRpt>
    <Rpt>
      <Id>report1</Id>
      <Acct><Id><IBAN>DE11111111111111111111</IBAN></Id></Acct>
      <Bal><Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2023-01-01</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">200.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2023-01-01</Dt></Dt></Bal>
    </Rpt>
    <Rpt>
      <Id>report2</Id>
      <Acct><Id><IBAN>DE22222222222222222222</IBAN></Id></Acct>
      <Bal><Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2023-01-01</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">400.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2023-01-01</Dt></Dt></Bal>
    </Rpt>
  </BkToCstmrAcctRpt>
</Document>`;

		const parser = new CamtParser(camtXml);
		const statements = parser.parse();

		expect(statements).toHaveLength(2);
		expect(statements[0].account).toBe('DE11111111111111111111');
		expect(statements[1].account).toBe('DE22222222222222222222');
	});
});
