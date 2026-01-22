import { describe, expect, it } from 'vitest';
import { CamtParser } from '../camtParser.js';

describe('CamtParser', () => {
	it('should parse CAMT.052 XML with balances and transactions', () => {
		const camtXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">
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

		// Check all Statement fields
		expect(statement.account).toBe('DE06940594210000027227');
		expect(statement.number).toBe('camt052_ONLINEBA');
		expect(statement.transactionReference).toBe('00001');

		// Verify optional fields that are not set
		expect(statement.relatedReference).toBeUndefined();
		expect(statement.availableBalance).toBeUndefined();
		expect(statement.forwardBalances).toBeUndefined();

		// Check balances with all fields
		expect(statement.openingBalance).toBeDefined();
		expect(statement.openingBalance.value).toBe(1000.0);
		expect(statement.openingBalance.currency).toBe('EUR');
		expect(statement.openingBalance.date).toBeInstanceOf(Date);
		expect(statement.openingBalance.date.getFullYear()).toBe(2013);
		expect(statement.openingBalance.date.getMonth()).toBe(9); // October (0-based)
		expect(statement.openingBalance.date.getDate()).toBe(31);

		expect(statement.closingBalance).toBeDefined();
		expect(statement.closingBalance.value).toBe(1500.0);
		expect(statement.closingBalance.currency).toBe('EUR');
		expect(statement.closingBalance.date).toBeInstanceOf(Date);
		expect(statement.closingBalance.date.getFullYear()).toBe(2013);
		expect(statement.closingBalance.date.getMonth()).toBe(10); // November (0-based)
		expect(statement.closingBalance.date.getDate()).toBe(4);

		// Check transactions
		expect(statement.transactions).toHaveLength(1);

		const transaction = statement.transactions[0];

		// Check all Transaction fields filled by the parser
		expect(transaction.amount).toBe(500.0);
		expect(transaction.customerReference).toBe('E2E123');
		expect(transaction.bankReference).toBe('TXN001');
		expect(transaction.purpose).toBe('Test payment');
		expect(transaction.remoteName).toBe('John Doe');
		expect(transaction.remoteAccountNumber).toBe('DE12345678901234567890');
		expect(transaction.remoteBankId).toBe('BYLADEM1001'); // Credit transaction uses DbtrAgt BIC
		expect(transaction.e2eReference).toBe('E2E123');
		expect(transaction.mandateReference).toBe('MANDT001');

		// Check date fields
		expect(transaction.valueDate).toBeInstanceOf(Date);
		expect(transaction.valueDate.getFullYear()).toBe(2013);
		expect(transaction.valueDate.getMonth()).toBe(10); // November (0-based)
		expect(transaction.valueDate.getDate()).toBe(1);
		expect(transaction.entryDate).toBeInstanceOf(Date);
		expect(transaction.entryDate.getFullYear()).toBe(2013);
		expect(transaction.entryDate.getMonth()).toBe(10); // November (0-based)
		expect(transaction.entryDate.getDate()).toBe(1);

		// Check transaction type and code fields
		expect(transaction.fundsCode).toBe('CRDT'); // Credit/debit indicator
		expect(transaction.transactionType).toBe(''); // Should be empty as no family code in BkTxCd
		expect(transaction.transactionCode).toBe(''); // Parser only handles structured BkTxCd, not Prtry format

		// Check additional information fields
		expect(transaction.additionalInformation).toBe(''); // No AddtlNtryInf in this test
		expect(transaction.bookingText).toBe(''); // Should match additionalInformation

		// Verify optional fields not set in this test
		expect(transaction.primeNotesNr).toBeUndefined();
		expect(transaction.remoteIdentifier).toBeUndefined();
		expect(transaction.client).toBeUndefined();
		expect(transaction.textKeyExtension).toBeUndefined();
	});

	it('should handle debit transactions correctly', () => {
		const camtXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">
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

		// Comprehensive Transaction field checks for debit transaction
		expect(transaction.purpose).toBe('Test payment');
		expect(transaction.remoteName).toBe('John Doe');
		expect(transaction.remoteAccountNumber).toBe('DE12345678901234567890');
		expect(transaction.remoteBankId).toBe('DEUTDEFF'); // Debit transaction uses CdtrAgt BIC

		// Check all other fields for debit transaction
		expect(transaction.customerReference).toBe('485315597247918');
		expect(transaction.bankReference).toBe('TXN002');
		expect(transaction.e2eReference).toBe('485315597247918');
		expect(transaction.mandateReference).toBe(''); // No MndtId in this test

		// Date fields
		expect(transaction.valueDate).toBeInstanceOf(Date);
		expect(transaction.valueDate.getFullYear()).toBe(2013);
		expect(transaction.entryDate).toBeInstanceOf(Date);
		expect(transaction.entryDate.getFullYear()).toBe(2013);

		// Transaction type indicators
		expect(transaction.fundsCode).toBe('DBIT'); // Debit indicator
		expect(transaction.transactionType).toBe(''); // No family code
		expect(transaction.transactionCode).toBe(''); // No BkTxCd in this test

		// Additional info fields
		expect(transaction.additionalInformation).toBe('Additional Info');
		expect(transaction.bookingText).toBe('Additional Info');
	});

	it('should handle empty or invalid XML gracefully', () => {
		const parser = new CamtParser('invalid xml');
		expect(() => parser.parse()).toThrow(); // Should throw error for invalid XML
	});

	it('should handle multiple reports', () => {
		const camtXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">
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

	it('should parse comprehensive CAMT XML with all possible fields and bank transaction codes', () => {
		const camtXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">
  <BkToCstmrAcctRpt>
    <GrpHdr>
      <MsgId>comprehensive_test</MsgId>
      <CreDtTm>2023-12-22T14:30:00+01:00</CreDtTm>
    </GrpHdr>
    <Rpt>
      <Id>COMPREHENSIVE_TEST</Id>
      <ElctrncSeqNb>987654321</ElctrncSeqNb>
      <CreDtTm>2023-12-22T14:30:00+01:00</CreDtTm>
      <Acct>
        <Id>
          <IBAN>DE89370400440532013000</IBAN>
        </Id>
        <Ccy>EUR</Ccy>
      </Acct>
      <Bal>
        <Tp>
          <CdOrPrtry>
            <Cd>PRCD</Cd>
          </CdOrPrtry>
        </Tp>
        <Amt Ccy="EUR">5000.50</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt>
          <Dt>2023-12-21</Dt>
        </Dt>
      </Bal>
      <Bal>
        <Tp>
          <CdOrPrtry>
            <Cd>CLBD</Cd>
          </CdOrPrtry>
        </Tp>
        <Amt Ccy="EUR">4750.75</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt>
          <Dt>2023-12-22</Dt>
        </Dt>
      </Bal>
      <Bal>
        <Tp>
          <CdOrPrtry>
            <Cd>ITBD</Cd>
          </CdOrPrtry>
        </Tp>
        <Amt Ccy="EUR">4500.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt>
          <Dt>2023-12-22</Dt>
        </Dt>
      </Bal>
      <Ntry>
        <Amt>249.75</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt>
          <Dt>2023-12-22</Dt>
        </BookgDt>
        <ValDt>
          <Dt>2023-12-22</Dt>
        </ValDt>
        <AcctSvcrRef>BANK-REF-123456</AcctSvcrRef>
        <BkTxCd>
          <Domn>
            <Cd>PMNT</Cd>
            <Fmly>
              <Cd>ICDT</Cd>
              <SubFmlyCd>ESCT</SubFmlyCd>
            </Fmly>
          </Domn>
        </BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>NOTPROVIDED</EndToEndId>
              <TxId>TXN-ID-789</TxId>
              <MndtId>MANDATE-REF-456</MndtId>
            </Refs>
            <AmtDtls>
              <TxAmt>
                <Amt Ccy="EUR">249.75</Amt>
              </TxAmt>
            </AmtDtls>
            <RmtInf>
              <Ustrd>SEPA Instant Transfer Payment Reference Text</Ustrd>
            </RmtInf>
            <RltdPties>
              <Dbtr>
                <Nm>Max Mustermann</Nm>
              </Dbtr>
              <DbtrAcct>
                <Id>
                  <IBAN>DE89370400440532013000</IBAN>
                </Id>
              </DbtrAcct>
              <Cdtr>
                <Nm>Erika Musterfrau</Nm>
              </Cdtr>
              <CdtrAcct>
                <Id>
                  <IBAN>DE12500105170648489890</IBAN>
                </Id>
              </CdtrAcct>
            </RltdPties>
            <RltdAgts>
              <DbtrAgt>
                <FinInstnId>
                  <BIC>COBADEFFXXX</BIC>
                </FinInstnId>
              </DbtrAgt>
              <CdtrAgt>
                <FinInstnId>
                  <BIC>INGDDEFFXXX</BIC>
                </FinInstnId>
              </CdtrAgt>
            </RltdAgts>
            <Purp>
              <Cd>CBFF</Cd>
            </Purp>
          </TxDtls>
        </NtryDtls>
        <AddtlNtryInf>Additional payment information from bank</AddtlNtryInf>
      </Ntry>
    </Rpt>
  </BkToCstmrAcctRpt>
</Document>`;

		const parser = new CamtParser(camtXml);
		const statements = parser.parse();

		expect(statements).toHaveLength(1);
		const statement = statements[0];

		// Test all Statement fields with comprehensive data
		expect(statement.account).toBe('DE89370400440532013000');
		expect(statement.number).toBe('COMPREHENSIVE_TEST');
		expect(statement.transactionReference).toBe('987654321');
		expect(statement.relatedReference).toBeUndefined();
		expect(statement.forwardBalances).toBeUndefined();

		// Test opening balance with exact date parsing
		expect(statement.openingBalance).toBeDefined();
		expect(statement.openingBalance.value).toBe(5000.5);
		expect(statement.openingBalance.currency).toBe('EUR');
		expect(statement.openingBalance.date.getFullYear()).toBe(2023);
		expect(statement.openingBalance.date.getMonth()).toBe(11); // December (0-based)
		expect(statement.openingBalance.date.getDate()).toBe(21);

		// Test closing balance
		expect(statement.closingBalance).toBeDefined();
		expect(statement.closingBalance.value).toBe(4750.75);
		expect(statement.closingBalance.currency).toBe('EUR');
		expect(statement.closingBalance.date.getFullYear()).toBe(2023);
		expect(statement.closingBalance.date.getMonth()).toBe(11); // December (0-based)
		expect(statement.closingBalance.date.getDate()).toBe(22);

		// Test available balance (ITBD)
		expect(statement.availableBalance).toBeDefined();
		expect(statement.availableBalance?.value).toBe(4500.0);
		expect(statement.availableBalance?.currency).toBe('EUR');

		// Test transaction with comprehensive fields
		expect(statement.transactions).toHaveLength(1);
		const transaction = statement.transactions[0];

		// Amount and basic fields
		expect(transaction.amount).toBe(-249.75); // Negative for debit
		expect(transaction.customerReference).toBe('NOTPROVIDED');
		expect(transaction.bankReference).toBe('BANK-REF-123456');
		expect(transaction.purpose).toBe('SEPA Instant Transfer Payment Reference Text');

		// Party information (debit transaction - creditor is remote party)
		expect(transaction.remoteName).toBe('Erika Musterfrau');
		expect(transaction.remoteAccountNumber).toBe('DE12500105170648489890');
		expect(transaction.remoteBankId).toBe('INGDDEFFXXX'); // CdtrAgt BIC for debit

		// Reference fields
		expect(transaction.e2eReference).toBe('NOTPROVIDED');
		expect(transaction.mandateReference).toBe('MANDATE-REF-456');

		// Date fields with exact verification
		expect(transaction.valueDate).toBeInstanceOf(Date);
		expect(transaction.valueDate.getFullYear()).toBe(2023);
		expect(transaction.valueDate.getMonth()).toBe(11); // December
		expect(transaction.valueDate.getDate()).toBe(22);
		expect(transaction.entryDate).toBeInstanceOf(Date);
		expect(transaction.entryDate.getFullYear()).toBe(2023);
		expect(transaction.entryDate.getMonth()).toBe(11);
		expect(transaction.entryDate.getDate()).toBe(22);

		// Bank transaction code structure
		expect(transaction.fundsCode).toBe('PMNT'); // Domain code
		expect(transaction.transactionType).toBe('ICDT'); // Family code
		expect(transaction.transactionCode).toBe('ESCT'); // SubFamily code

		// Additional information
		expect(transaction.additionalInformation).toBe('Additional payment information from bank');
		expect(transaction.bookingText).toBe('Additional payment information from bank');

		// Verify undefined optional fields
		expect(transaction.primeNotesNr).toBeUndefined();
		expect(transaction.remoteIdentifier).toBeUndefined();
		expect(transaction.client).toBeUndefined();
		expect(transaction.textKeyExtension).toBeUndefined();
	});

	it('should handle edge cases and missing optional fields correctly', () => {
		const camtXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">
  <BkToCstmrAcctRpt>
    <Rpt>
      <Id>edge-case-test</Id>
      <Acct>
        <Id>
          <IBAN>DE99999999999999999999</IBAN>
        </Id>
        <Ccy>USD</Ccy>
      </Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="USD">0.01</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Dt><Dt>20231222</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="USD">999.99</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>20231222</Dt></Dt>
      </Bal>
      <Ntry>
        <Amt>1000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>20231222</Dt></BookgDt>
        <ValDt><Dt>20231221</Dt></ValDt>
        <AcctSvcrRef></AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId></EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd></Ustrd>
            </RmtInf>
            <RltdPties>
              <Dbtr>
                <Nm></Nm>
              </Dbtr>
            </RltdPties>
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

		// Test edge case balances
		expect(statement.openingBalance.value).toBe(-0.01); // Negative due to DBIT indicator
		expect(statement.openingBalance.currency).toBe('USD');
		expect(statement.closingBalance.value).toBe(999.99);
		expect(statement.closingBalance.currency).toBe('USD');

		// Test date parsing from YYYYMMDD format
		expect(statement.openingBalance.date.getFullYear()).toBe(2023);
		expect(statement.openingBalance.date.getMonth()).toBe(11); // December
		expect(statement.openingBalance.date.getDate()).toBe(22);

		// Test transaction with mostly empty/missing fields
		expect(statement.transactions).toHaveLength(1);
		const transaction = statement.transactions[0];

		expect(transaction.amount).toBe(1000.0);
		expect(transaction.customerReference).toBe(''); // Empty EndToEndId
		expect(transaction.bankReference).toBe(''); // Empty AcctSvcrRef
		expect(transaction.purpose).toBe(''); // Empty Ustrd
		expect(transaction.remoteName).toBe(''); // Empty Nm
		expect(transaction.remoteAccountNumber).toBe(''); // No IBAN provided
		expect(transaction.remoteBankId).toBe(''); // No BIC provided
		expect(transaction.e2eReference).toBe(''); // Empty EndToEndId
		expect(transaction.mandateReference).toBe(''); // No MndtId

		// Test date parsing consistency
		expect(transaction.valueDate.getDate()).toBe(21); // Different from entry date
		expect(transaction.entryDate.getDate()).toBe(22);

		// Test transaction type fields with no BkTxCd
		expect(transaction.fundsCode).toBe('CRDT');
		expect(transaction.transactionType).toBe('');
		expect(transaction.transactionCode).toBe('');

		expect(transaction.additionalInformation).toBe('');
		expect(transaction.bookingText).toBe('');
	});

	it('should handle party structure variations in XML (Dbtr.Pty.Nm format)', () => {
		const camtXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">
  <BkToCstmrAcctRpt>
    <Rpt>
      <Id>party-structure-test</Id>
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
        <Amt Ccy="EUR">1200.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2013-11-01</Dt></Dt>
      </Bal>
      <Ntry>
        <Amt>200.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2013-11-01</Dt></BookgDt>
        <ValDt><Dt>2013-11-01</Dt></ValDt>
        <AcctSvcrRef>TXN003</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>PARTY-TEST-123</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>Payment with party structure</Ustrd>
            </RmtInf>
            <RltdPties>
              <Dbtr>
                <Pty>
                  <Nm>John Smith Bank Format</Nm>
                </Pty>
              </Dbtr>
              <DbtrAcct>
                <Id>
                  <IBAN>DE12345678901234567890</IBAN>
                </Id>
              </DbtrAcct>
              <Cdtr>
                <Pty>
                  <Nm>Jane Smith Bank Format</Nm>
                </Pty>
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
                  <BICFI>BANKABC1XXX</BICFI>
                </FinInstnId>
              </DbtrAgt>
              <CdtrAgt>
                <FinInstnId>
                  <BICFI>BANKDEF2XXX</BICFI>
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
		expect(statements[0].transactions).toHaveLength(1);

		const transaction = statements[0].transactions[0];

		// Verify that the party name is correctly extracted from Dbtr.Pty.Nm structure
		expect(transaction.remoteName).toBe('John Smith Bank Format');
		expect(transaction.remoteAccountNumber).toBe('DE12345678901234567890');
		expect(transaction.remoteBankId).toBe('BANKABC1XXX'); // Credit transaction uses DbtrAgt BIC
		expect(transaction.purpose).toBe('Payment with party structure');
		expect(transaction.amount).toBe(200.0);
	});

	it('should handle multiple entries in RmtInf (Ustrd)', () => {
		const camtXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08 camt.052.001.08.xsd">
  <BkToCstmrAcctRpt>
    <GrpHdr>
      <MsgId>52D20260106T1009246445830N000000000</MsgId>
      <CreDtTm>2026-01-06T10:09:24.0+01:00</CreDtTm>
    </GrpHdr>
    <Rpt>
      <Id>0752D522026010610092464000001000</Id>
      <RptPgntn>
        <PgNb>1</PgNb>
        <LastPgInd>true</LastPgInd>
      </RptPgntn>
      <ElctrncSeqNb>000000000</ElctrncSeqNb>
      <CreDtTm>2026-01-06T10:09:24.0+01:00</CreDtTm>
      <Acct>
        <Id>
          <IBAN>DE06940594210000027227</IBAN>
        </Id>
        <Ccy>EUR</Ccy>
        <Ownr>
          <Nm>John Doe</Nm>
        </Ownr>
        <Svcr>
          <FinInstnId>
            <BICFI>BANKABC1XXX</BICFI>
            <Nm>ABC Bank</Nm>
            <Othr>
              <Id>DE 123456789</Id>
              <Issr>UmsStId</Issr>
            </Othr>
          </FinInstnId>
        </Svcr>
      </Acct>
      <Bal>
        <Tp>
          <CdOrPrtry>
            <Cd>OPBD</Cd>
          </CdOrPrtry>
        </Tp>
        <Amt Ccy="EUR">27.31</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Dt>
          <Dt>2026-01-05</Dt>
        </Dt>
      </Bal>
      <Bal>
        <Tp>
          <CdOrPrtry>
            <Cd>CLBD</Cd>
          </CdOrPrtry>
        </Tp>
        <Amt Ccy="EUR">234.81</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Dt>
          <Dt>2026-01-05</Dt>
        </Dt>
      </Bal>
      <Ntry>
        <Amt Ccy="EUR">179.46</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>
          <Cd>BOOK</Cd>
        </Sts>
        <BookgDt>
          <Dt>2026-01-05</Dt>
        </BookgDt>
        <ValDt>
          <Dt>2026-01-05</Dt>
        </ValDt>
        <AcctSvcrRef>TXN003</AcctSvcrRef>
        <BkTxCd>
          <Domn>
            <Cd>PMNT</Cd>
            <Fmly>
              <Cd>ICDT</Cd>
              <SubFmlyCd>ESCT</SubFmlyCd>
            </Fmly>
          </Domn>
          <Prtry>
            <Cd>NTRF+116+02089</Cd>
            <Issr>DK</Issr>
          </Prtry>
        </BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <MsgId>test msgid</MsgId>
              <PmtInfId>VG 2025 QUARTAL IV 12345678</PmtInfId>
              <EndToEndId>VG 2025 QUARTAL IV</EndToEndId>
            </Refs>
            <Amt Ccy="EUR">179.46</Amt>
            <BkTxCd>
              <Domn>
                <Cd>PMNT</Cd>
                <Fmly>
                  <Cd>ICDT</Cd>
                  <SubFmlyCd>ESCT</SubFmlyCd>
                </Fmly>
              </Domn>
              <Prtry>
                <Cd>NTRF+116+02189</Cd>
                <Issr>DK</Issr>
              </Prtry>
            </BkTxCd>
            <RltdPties>
              <Dbtr>
                <Pty>
                  <Nm>DOE</Nm>
                </Pty>
              </Dbtr>
              <DbtrAcct>
                <Id>
                  <IBAN>DE12345678901234567890</IBAN>
                </Id>
              </DbtrAcct>
              <Cdtr>
                <Pty>
                  <Nm>ABC Bank</Nm>
                </Pty>
              </Cdtr>
              <CdtrAcct>
                <Id>
                  <IBAN>DE12345678901234567891</IBAN>
                </Id>
              </CdtrAcct>
            </RltdPties>
            <RltdAgts>
              <CdtrAgt>
                <FinInstnId>
                  <BICFI>BANKABC1XXX</BICFI>
                </FinInstnId>
              </CdtrAgt>
            </RltdAgts>
            <RmtInf>
              <Ustrd>28,65EUR EREF: VG 2025 QUARTAL IV IBAN</Ustrd>
              <Ustrd>: DE12345678901234567891 BIC: BANKABC1XXX</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
        <AddtlNtryInf>ENTGELT gem. Vereinbarung</AddtlNtryInf>
      </Ntry>
    </Rpt>
  </BkToCstmrAcctRpt>
</Document>`;

		const parser = new CamtParser(camtXml);
		const statements = parser.parse();

		expect(statements).toHaveLength(1);
		const statement = statements[0];
		expect(statement.transactions).toHaveLength(1);

		const transaction = statement.transactions[0];

		// Check all Transaction fields filled by the parser
		expect(transaction.amount).toBe(-179.46);
		expect(transaction.customerReference).toBe('VG 2025 QUARTAL IV');
		expect(transaction.bankReference).toBe('TXN003');
		expect(transaction.purpose).toBe(
			'28,65EUR EREF: VG 2025 QUARTAL IV IBAN\n: DE12345678901234567891 BIC: BANKABC1XXX',
		);
		expect(transaction.remoteName).toBe('ABC Bank');
		expect(transaction.remoteAccountNumber).toBe('DE12345678901234567891');
		expect(transaction.remoteBankId).toBe('BANKABC1XXX');
		expect(transaction.e2eReference).toBe('VG 2025 QUARTAL IV');

		// Check date fields
		expect(transaction.valueDate).toBeInstanceOf(Date);
		expect(transaction.valueDate.getFullYear()).toBe(2026);
		expect(transaction.valueDate.getMonth()).toBe(0); // November (0-based)
		expect(transaction.valueDate.getDate()).toBe(5);
		expect(transaction.entryDate).toBeInstanceOf(Date);
		expect(transaction.entryDate.getFullYear()).toBe(2026);
		expect(transaction.entryDate.getMonth()).toBe(0); // November (0-based)
		expect(transaction.entryDate.getDate()).toBe(5);

		// Check transaction type and code fields
		expect(transaction.fundsCode).toBe('PMNT');
		expect(transaction.transactionType).toBe('ICDT');
		expect(transaction.transactionCode).toBe('ESCT');

		// Check additional information fields
		expect(transaction.additionalInformation).toBe('ENTGELT gem. Vereinbarung');
		expect(transaction.bookingText).toBe('ENTGELT gem. Vereinbarung'); // Should match additionalInformation

		// Verify optional fields not set in this test
		expect(transaction.primeNotesNr).toBeUndefined();
		expect(transaction.remoteIdentifier).toBeUndefined();
		expect(transaction.client).toBeUndefined();
		expect(transaction.textKeyExtension).toBeUndefined();
	});

	it('should handle full iso date time in value date', () => {
		// this is an example from comdirect bank in 2026-01
		const camtXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.02">
    <BkToCstmrAcctRpt>
        <GrpHdr>
            <MsgId>BD5F4D36X95740C4B89D967367217C16</MsgId>
            <CreDtTm>2026-01-22T10:35:25.369+01:00</CreDtTm>
            <MsgPgntn>
                <PgNb>0</PgNb>
                <LastPgInd>true</LastPgInd>
            </MsgPgntn>
        </GrpHdr>
        <Rpt>
            <Id>563916B991DD4EB18894EF4ABB730A5C</Id>
            <FrToDt>
                <FrDtTm>2025-12-10T00:00:00.000+01:00</FrDtTm>
                <ToDtTm>2026-01-22T00:00:00.000+01:00</ToDtTm>
            </FrToDt>
            <Acct>
                <Id>
                    <IBAN>DE06940594210000027227</IBAN>
                </Id>
            </Acct>
            <Bal>
                <Tp>
                    <CdOrPrtry>
                        <Cd>OPBD</Cd>
                    </CdOrPrtry>
                </Tp>
                <Amt Ccy="EUR">94.010000000021</Amt>
                <CdtDbtInd>CRDT</CdtDbtInd>
                <Dt>
                    <DtTm>2025-12-10T00:00:00.000+01:00</DtTm>
                </Dt>
            </Bal>
            <Bal>
                <Tp>
                    <CdOrPrtry>
                        <Cd>CLBD</Cd>
                    </CdOrPrtry>
                </Tp>
                <Amt Ccy="EUR">101.960000000017</Amt>
                <CdtDbtInd>CRDT</CdtDbtInd>
                <Dt>
                    <DtTm>2026-01-22T00:00:00.000+01:00</DtTm>
                </Dt>
            </Bal>
            <Ntry>
                <NtryRef>5J3C21XL0470L56V/39761</NtryRef>
                <Amt Ccy="EUR">101.5</Amt>
                <CdtDbtInd>DBIT</CdtDbtInd>
                <Sts>BOOK</Sts>
                <BookgDt>
                    <Dt>2025-12-10+01:00</Dt>
                </BookgDt>
                <ValDt>
                    <DtTm>2025-12-10T00:00:00.000+01:00</DtTm>
                </ValDt>
                <AcctSvcrRef>5J2C21XL0470L56V/39761</AcctSvcrRef>
                <BkTxCd>
                    <Prtry>
                        <Cd>005</Cd>
                        <Issr></Issr>
                    </Prtry>
                </BkTxCd>
                <NtryDtls>
                    <TxDtls>
                        <RltdPties>
                            <Cdtr>
                                <Nm>AMAZON EU S.A R.L., NIEDERL ASSUNG DEUTSCHLAND</Nm>
                            </Cdtr>
                            <CdtrAcct>
                                <Id/>
                            </CdtrAcct>
                        </RltdPties>
                        <RmtInf>
                            <Ustrd>028-1234567-XXXXXXX Amazon.de 2ABCD</Ustrd>
                            <Ustrd>EF9GFP28</Ustrd>
                            <Ustrd>End-to-End-Ref.:</Ustrd>
                            <Ustrd>2ABCDEF9GHIJKL28</Ustrd>
                            <Ustrd>CORE / Mandatsref.:</Ustrd>
                            <Ustrd>7829857lkklag</Ustrd>
                            <Ustrd>Gläubiger-ID:</Ustrd>
                            <Ustrd>DE24ABC00000123456</Ustrd>
                        </RmtInf>
                    </TxDtls>
                </NtryDtls>
            </Ntry>
        </Rpt>
    </BkToCstmrAcctRpt>
</Document>
`;

		const parser = new CamtParser(camtXml);
		const statements = parser.parse();

		expect(statements).toHaveLength(1);
		const statement = statements[0];
		expect(statement.transactions).toHaveLength(1);

		const transaction = statement.transactions[0];

		// Check all Transaction fields filled by the parser
		expect(transaction.amount).toBe(-101.5);
		expect(transaction.customerReference).toBe('');
		expect(transaction.bankReference).toBe('5J2C21XL0470L56V/39761');
		expect(transaction.purpose).toBe(
			'028-1234567-XXXXXXX Amazon.de 2ABCD\nEF9GFP28\nEnd-to-End-Ref.:\n2ABCDEF9GHIJKL28\nCORE / Mandatsref.:\n7829857lkklag\nGläubiger-ID:\nDE24ABC00000123456',
		);
		expect(transaction.remoteName).toBe('AMAZON EU S.A R.L., NIEDERL ASSUNG DEUTSCHLAND');
		expect(transaction.remoteAccountNumber).toBe('');
		expect(transaction.remoteBankId).toBe('');
		expect(transaction.e2eReference).toBe('');

		// Check date fields
		expect(transaction.valueDate).toBeInstanceOf(Date);
		expect(transaction.valueDate.getFullYear()).toBe(2025);
		expect(transaction.valueDate.getMonth()).toBe(11); // November (0-based)
		expect(transaction.valueDate.getDate()).toBe(10);
		expect(transaction.entryDate).toBeInstanceOf(Date);
		expect(transaction.entryDate.getFullYear()).toBe(2025);
		expect(transaction.entryDate.getMonth()).toBe(11); // November (0-based)
		expect(transaction.entryDate.getDate()).toBe(10);

		// Check transaction type and code fields
		expect(transaction.fundsCode).toBe('DBIT');
		expect(transaction.transactionType).toBe('');
		expect(transaction.transactionCode).toBe('');

		// Check additional information fields
		expect(transaction.additionalInformation).toBe('');
		expect(transaction.bookingText).toBe(''); // Should match additionalInformation

		// Verify optional fields not set in this test
		expect(transaction.primeNotesNr).toBeUndefined();
		expect(transaction.remoteIdentifier).toBeUndefined();
		expect(transaction.client).toBeUndefined();
		expect(transaction.textKeyExtension).toBeUndefined();
	});
});
