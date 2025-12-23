import { Statement, Transaction, Balance } from './statement.js';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export class CamtParsingError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'CamtParsingError';
  }
}

export class CamtParser {
  private xmlData: string;
  private parser: XMLParser;

  constructor(xmlData: string) {
    this.xmlData = xmlData;
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      textNodeName: '#text',
      removeNSPrefix: true,
      parseAttributeValue: true,
      trimValues: true,
      parseTagValue: false, // Don't auto-parse values to preserve strings like "00001"
      processEntities: true,
      allowBooleanAttributes: false,
      numberParseOptions: {
        hex: false,
        leadingZeros: true,
        eNotation: true,
      },
    });
  }

  parse(): Statement[] {
    try {
      // Pre-validate XML
      const validationResult = XMLValidator.validate(this.xmlData);
      if (validationResult !== true) {
        throw new CamtParsingError(`Invalid CAMT XML structure: ${validationResult.err.msg}`);
      }

      // Parse XML to JavaScript object
      const document = this.parser.parse(this.xmlData);

      // Navigate to Document/BkToCstmrStmt/Stmt array
      const statements: Statement[] = [];
      const docObj = this.getDocumentObject(document);
      const reports = this.getReports(docObj);

      if (!reports || reports.length === 0) {
        return statements;
      }

      for (let i = 0; i < reports.length; i++) {
        try {
          const statement = this.parseReport(reports[i], i + 1);
          if (statement) {
            statements.push(statement);
          }
        } catch (error) {
          throw new CamtParsingError(
            `Failed to parse CAMT report ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error instanceof Error ? error : undefined
          );
        }
      }

      return statements;
    } catch (error) {
      if (error instanceof CamtParsingError) {
        throw error;
      }
      throw new CamtParsingError(
        `Failed to parse CAMT document: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getDocumentObject(document: any): any {
    // Handle different possible XML root structures
    if (document.Document) {
      return document.Document;
    }
    if (document.camt) {
      return document.camt;
    }
    // Look for any object with BkToCstmrAcctRpt property
    for (const key in document) {
      if (document[key] && document[key].BkToCstmrAcctRpt) {
        return document[key];
      }
    }
    throw new CamtParsingError('No valid CAMT document structure found');
  }

  private getReports(docObj: any): any[] {
    const bkToCstmrAcctRpt = docObj.BkToCstmrAcctRpt;
    if (!bkToCstmrAcctRpt) {
      throw new CamtParsingError('No BkToCstmrAcctRpt element found in CAMT document');
    }

    const rpt = bkToCstmrAcctRpt.Rpt;
    if (!rpt) {
      return [];
    }

    // Handle both single report and array of reports
    return Array.isArray(rpt) ? rpt : [rpt];
  }

  private parseReport(report: any, reportNumber: number): Statement | null {
    try {
      // Extract account information
      const account = this.getValueFromPath(report, 'Acct.Id.IBAN');

      // Extract statement number/ID
      const number = this.getValueFromPath(report, 'Id');

      // Extract transaction reference
      const transactionReference = this.getValueFromPath(report, 'ElctrncSeqNb');

      // Parse balances
      const balances = this.parseBalances(report, reportNumber);

      // Be more flexible with balance requirements - some banks only provide one balance
      let openingBalance = balances.openingBalance;
      let closingBalance = balances.closingBalance;

      // If we don't have both opening and closing, try to use what we have
      if (!openingBalance && !closingBalance) {
        // If we have available balance, use it as closing balance
        if (balances.availableBalance) {
          closingBalance = balances.availableBalance;
        } else {
          throw new CamtParsingError(`No balance information found in CAMT report ${reportNumber}`);
        }
      }

      // If missing opening balance, create a zero balance for the same date as closing
      if (!openingBalance && closingBalance) {
        openingBalance = {
          date: closingBalance.date,
          currency: closingBalance.currency,
          value: 0,
        };
      }

      // If missing closing balance, use opening balance as closing
      if (!closingBalance && openingBalance) {
        closingBalance = openingBalance;
      }

      // Parse transactions
      const transactions = this.parseTransactions(report, reportNumber);

      return {
        account,
        number,
        transactionReference,
        openingBalance: openingBalance!,
        closingBalance: closingBalance!,
        availableBalance: balances.availableBalance,
        transactions,
      };
    } catch (error) {
      if (error instanceof CamtParsingError) {
        throw error;
      }
      throw new CamtParsingError(
        `Failed to parse report ${reportNumber} content: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getValueFromPath(obj: any, path: string): string | undefined {
    const pathParts = path.split('.');
    let current = obj;

    for (const part of pathParts) {
      if (current && typeof current === 'object' && current[part] !== undefined) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    if (typeof current === 'string' || typeof current === 'number') {
      return String(current);
    }
    if (current && typeof current === 'object' && current['#text'] !== undefined) {
      return String(current['#text']);
    }

    return undefined;
  }

  private parseBalances(
    report: any,
    reportNumber: number
  ): {
    openingBalance?: Balance;
    closingBalance?: Balance;
    availableBalance?: Balance;
  } {
    try {
      let openingBalance: Balance | undefined;
      let closingBalance: Balance | undefined;
      let availableBalance: Balance | undefined;

      // Get balance array from report
      const balances = report.Bal;
      if (!balances) {
        return { openingBalance, closingBalance, availableBalance };
      }

      const balanceArray = Array.isArray(balances) ? balances : [balances];

      for (const balanceObj of balanceArray) {
        const typeCode = this.getValueFromPath(balanceObj, 'Tp.CdOrPrtry.Cd');

        // Extract amount and currency
        const currency = balanceObj.Amt?.['@Ccy'] || 'EUR';
        const value = parseFloat(this.getValueFromPath(balanceObj, 'Amt') || '0');

        const creditDebitInd = this.getValueFromPath(balanceObj, 'CdtDbtInd');
        const finalValue = creditDebitInd === 'DBIT' ? -value : value;

        const dateStr = this.getValueFromPath(balanceObj, 'Dt.Dt') || this.getValueFromPath(balanceObj, 'Dt');
        const date = dateStr ? this.parseDate(dateStr) : new Date();

        const balance: Balance = {
          date,
          currency,
          value: finalValue,
        };

        switch (typeCode) {
          case 'PRCD': // Previous closing date
          case 'OPBD': // Opening booked
          case 'OPAV': // Opening available
            openingBalance = balance;
            break;
          case 'CLBD': // Closing booked
          case 'CLAV': // Closing available
            closingBalance = balance;
            break;
          case 'ITBD': // Interim booked
          case 'ITAV': // Interim available
          case 'FWAV': // Forward available
          case 'BOOK': // Booked balance
            // Use as available balance, or as closing if we don't have one
            if (!availableBalance) {
              availableBalance = balance;
            }
            // If we don't have a closing balance, use this as closing
            if (!closingBalance && (typeCode === 'BOOK' || typeCode === 'ITBD')) {
              closingBalance = balance;
            }
            break;
          default:
            // Handle unknown balance types by using them as closing balance if we don't have one
            if (!closingBalance) {
              closingBalance = balance;
            }
            break;
        }
      }

      return { openingBalance, closingBalance, availableBalance };
    } catch (error) {
      throw new CamtParsingError(
        `Failed to parse balances in report ${reportNumber}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private parseTransactions(report: any, reportNumber: number): Transaction[] {
    const transactions: Transaction[] = [];
    const entries = report.Ntry;

    if (!entries) {
      return transactions;
    }

    const entryArray = Array.isArray(entries) ? entries : [entries];

    for (let i = 0; i < entryArray.length; i++) {
      try {
        const transaction = this.parseTransaction(entryArray[i], reportNumber, i + 1);
        if (transaction) {
          transactions.push(transaction);
        }
      } catch (error) {
        throw new CamtParsingError(
          `Failed to parse transaction ${i + 1} in report ${reportNumber}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          error instanceof Error ? error : undefined
        );
      }
    }

    return transactions;
  }

  private parseTransaction(entry: any, reportNumber: number, transactionNumber: number): Transaction | null {
    try {
      // Extract amount and credit/debit indicator
      const amountValue = parseFloat(this.getValueFromPath(entry, 'Amt') || '0');
      const creditDebitInd = this.getValueFromPath(entry, 'CdtDbtInd');
      const isDebit = creditDebitInd === 'DBIT';
      const amount = isDebit ? -amountValue : amountValue;

      // Extract dates
      const bookingDate = this.getValueFromPath(entry, 'BookgDt.Dt') || this.getValueFromPath(entry, 'BookgDt');
      const valueDate = this.getValueFromPath(entry, 'ValDt.Dt') || this.getValueFromPath(entry, 'ValDt');

      const entryDate = bookingDate ? this.parseDate(bookingDate) : new Date();
      const parsedValueDate = valueDate ? this.parseDate(valueDate) : entryDate;

      // Extract references
      const accountServicerRef = this.getValueFromPath(entry, 'AcctSvcrRef') || '';
      const endToEndId = this.getValueFromPath(entry, 'NtryDtls.TxDtls.Refs.EndToEndId') || '';
      const mandateId = this.getValueFromPath(entry, 'NtryDtls.TxDtls.Refs.MndtId') || '';

      // Extract transaction details
      const additionalEntryInfo = this.getValueFromPath(entry, 'AddtlNtryInf') || '';
      const remittanceInfo = this.getValueFromPath(entry, 'NtryDtls.TxDtls.RmtInf.Ustrd') || '';

      // Extract remote party information based on transaction type
      let remoteName = '';
      let remoteIBAN = '';
      let remoteBankId = '';

      const txDtls = entry.NtryDtls?.TxDtls;
      if (txDtls) {
        if (isDebit) {
          // For debit transactions, we want the creditor (receiving party)
          remoteName = this.extractPartyName(txDtls, 'RltdPties.Cdtr');
          remoteIBAN = this.getValueFromPath(txDtls, 'RltdPties.CdtrAcct.Id.IBAN') || '';
          remoteBankId = this.extractBankId(txDtls, 'RltdAgts.CdtrAgt.FinInstnId');
        } else {
          // For credit transactions, we want the debtor (sending party)
          remoteName = this.extractPartyName(txDtls, 'RltdPties.Dbtr');
          remoteIBAN = this.getValueFromPath(txDtls, 'RltdPties.DbtrAcct.Id.IBAN') || '';
          remoteBankId = this.extractBankId(txDtls, 'RltdAgts.DbtrAgt.FinInstnId');
        }
      }

      // Extract bank transaction code structure (BkTxCd) - can be at entry level or TxDtls level
      let bkTxCd = this.parseBankTransactionCode(entry);
      if (!bkTxCd.domainCode && !bkTxCd.familyCode && !bkTxCd.subFamilyCode && txDtls) {
        bkTxCd = this.parseBankTransactionCode(txDtls);
      }

      return {
        valueDate: parsedValueDate,
        entryDate,
        fundsCode: bkTxCd.domainCode || creditDebitInd || '',
        amount,
        transactionType: bkTxCd.familyCode || '',
        customerReference: endToEndId,
        bankReference: accountServicerRef,
        transactionCode: bkTxCd.subFamilyCode || '',
        purpose: remittanceInfo,
        remoteName,
        remoteAccountNumber: remoteIBAN,
        remoteBankId,
        e2eReference: endToEndId,
        mandateReference: mandateId,
        additionalInformation: additionalEntryInfo,
        bookingText: additionalEntryInfo,
      };
    } catch (error) {
      throw new CamtParsingError(
        `Failed to parse transaction details: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Extract party name from various possible CAMT structures
   * Handles both direct name (<Dbtr><Nm>) and party structure (<Dbtr><Pty><Nm>)
   */
  private extractPartyName(txDtls: any, partyPath: string): string {
    // Strategy 1: Direct name structure (e.g., RltdPties.Dbtr.Nm)
    let name = this.getValueFromPath(txDtls, `${partyPath}.Nm`);
    if (name) {
      return name;
    }

    // Strategy 2: Party structure (e.g., RltdPties.Dbtr.Pty.Nm)
    name = this.getValueFromPath(txDtls, `${partyPath}.Pty.Nm`);
    if (name) {
      return name;
    }

    // Strategy 3: Organization ID structure (e.g., RltdPties.Dbtr.Id.OrgId.Nm)
    name = this.getValueFromPath(txDtls, `${partyPath}.Id.OrgId.Nm`);
    if (name) {
      return name;
    }

    // Strategy 4: Private ID structure (e.g., RltdPties.Dbtr.Id.PrvtId.Nm)
    name = this.getValueFromPath(txDtls, `${partyPath}.Id.PrvtId.Nm`);
    if (name) {
      return name;
    }

    // Strategy 5: Try postal address line as fallback
    name = this.getValueFromPath(txDtls, `${partyPath}.PstlAdr.AdrLine`);
    if (name) {
      return name;
    }

    // Strategy 6: Try organization identification other
    name = this.getValueFromPath(txDtls, `${partyPath}.Id.OrgId.Othr.Id`);
    if (name) {
      return name;
    }

    return '';
  }

  /**
   * Extract bank identification code from various possible CAMT structures
   * Handles both BIC and BICFI elements
   */
  private extractBankId(txDtls: any, bankPath: string): string {
    // Strategy 1: Standard BIC element
    let bankId = this.getValueFromPath(txDtls, `${bankPath}.BIC`);
    if (bankId) {
      return bankId;
    }

    // Strategy 2: BICFI element (used by some banks)
    bankId = this.getValueFromPath(txDtls, `${bankPath}.BICFI`);
    if (bankId) {
      return bankId;
    }

    // Strategy 3: Try ClrSysMmbId (clearing system member identification)
    bankId = this.getValueFromPath(txDtls, `${bankPath}.ClrSysMmbId.MmbId`);
    if (bankId) {
      return bankId;
    }

    // Strategy 4: Try other identification
    bankId = this.getValueFromPath(txDtls, `${bankPath}.Othr.Id`);
    if (bankId) {
      return bankId;
    }

    return '';
  }

  private parseDate(dateStr: string): Date {
    // Parse ISO date format (YYYY-MM-DD)
    if (dateStr.length === 10 && dateStr.includes('-')) {
      return new Date(dateStr + 'T12:00:00'); // Set time to noon to avoid timezone issues
    }

    // Parse CAMT date format (YYYYMMDD)
    if (dateStr.length === 8) {
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10) - 1; // Month is 0-based
      const day = parseInt(dateStr.substring(6, 8), 10);
      return new Date(year, month, day, 12);
    }

    return new Date(dateStr);
  }

  private parseBankTransactionCode(entry: any): {
    domainCode?: string;
    familyCode?: string;
    subFamilyCode?: string;
  } {
    const bkTxCd = entry.BkTxCd;
    if (!bkTxCd) {
      return {};
    }

    // Extract Domain Code (first level - e.g., "PMNT")
    const domainCode = this.getValueFromPath(bkTxCd, 'Domn.Cd');

    // Extract Family Code (second level - e.g., "CCRD")
    const familyCode = this.getValueFromPath(bkTxCd, 'Domn.Fmly.Cd');

    // Extract SubFamily Code (third level - e.g., "POSD")
    const subFamilyCode = this.getValueFromPath(bkTxCd, 'Domn.Fmly.SubFmlyCd');

    return {
      domainCode,
      familyCode,
      subFamilyCode,
    };
  }
}
