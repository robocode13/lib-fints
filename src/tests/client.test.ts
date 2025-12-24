import { MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinTSClient } from '../client.js';
import { Dialog } from '../dialog.js';
import { FinTSConfig } from '../config.js';
import { Language } from '../codes.js';
import { AccountBalanceResponse, ClientResponse, StatementResponse, PortfolioResponse } from '../index.js';
import { AccountType } from '../bankAccount.js';

describe('FinTSClient', () => {
  const client = new FinTSClient(
    FinTSConfig.fromBankingInformation('product', '1.0', {
      systemId: 'SYSTEM01',
      bpd: {
        version: 1,
        url: 'https://bank.example.com/fints',
        countryCode: 280,
        bankId: '10020030',
        bankName: 'Example Bank',
        allowedTransactions: [
          { transId: 'HKSAL', versions: [6, 7], tanRequired: false },
          { transId: 'HKCAZ', versions: [1], tanRequired: false },
          { transId: 'HKKAZ', versions: [6], tanRequired: true },
          { transId: 'HKWPD', versions: [7], tanRequired: true },
          { transId: 'DKKKU', versions: [2], tanRequired: false },
        ],
        maxTransactionsPerMessage: 1,
        supportedLanguages: [Language.German],
        supportedHbciVersions: [300],
        supportedTanMethods: [
          {
            id: 1,
            name: 'ChipTAN',
            version: 1,
            isDecoupled: false,
            activeTanMediaCount: 1,
            activeTanMedia: ['TAN-Generator 123'],
            tanMediaRequirement: 0,
          },
          {
            id: 2,
            name: 'pushTAN',
            version: 1,
            isDecoupled: true,
            activeTanMediaCount: 1,
            activeTanMedia: ['Mobile App'],
            tanMediaRequirement: 1,
          },
        ],
        availableTanMethodIds: [1, 2],
      },
      upd: {
        version: 1,
        usage: 0,
        bankAccounts: [
          {
            accountNumber: '1234567890',
            bank: {
              bankId: '10020030',
              country: 280,
            },
            iban: 'DE89370400440532013000',
            customerId: 'customer1',
            accountType: AccountType.CheckingAccount,
            currency: 'EUR',
            holder1: 'Test User',
            allowedTransactions: [
              { transId: 'HKSAL', numSignatures: 1 },
              { transId: 'HKCAZ', numSignatures: 1 },
              { transId: 'HKKAZ', numSignatures: 1 },
            ],
          },
          {
            accountNumber: '9876543210',
            bank: {
              bankId: '10020030',
              country: 280,
            },
            iban: 'DE89370400440532013001',
            customerId: 'customer1',
            accountType: AccountType.SecuritiesAccount,
            currency: 'EUR',
            holder1: 'Test User',
            allowedTransactions: [{ transId: 'HKWPD', numSignatures: 1 }],
          },
          {
            accountNumber: '1111222233',
            bank: {
              bankId: '10020030',
              country: 280,
            },
            iban: 'DE89370400440532013002',
            customerId: 'customer1',
            accountType: AccountType.CreditCardAccount,
            currency: 'EUR',
            holder1: 'Test User',
            allowedTransactions: [{ transId: 'DKKKU', numSignatures: 1 }],
          },
        ],
      },
      bankMessages: [],
    })
  );

  let dialogStartMock: MockInstance;
  let dialogContinueMock: MockInstance;

  beforeEach(() => {
    dialogStartMock = vi.spyOn(Dialog.prototype, 'start');
    dialogContinueMock = vi.spyOn(Dialog.prototype, 'continue');
  });

  afterEach(() => {
    dialogStartMock.mockRestore();
    dialogContinueMock.mockRestore();
  });

  describe('getAccountBalance', () => {
    it('returns balance response when no TAN is required', async () => {
      dialogStartMock.mockResolvedValueOnce(
        new Map<string, ClientResponse | AccountBalanceResponse>([
          [
            'HKIDN',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
            },
          ],
          [
            'HKSAL',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
              balance: { date: new Date('2025-12-23'), currency: 'EUR', balance: 1000.0 },
            },
          ],
          [
            'HKEND',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 100, text: 'Dialog beendet' }],
            },
          ],
        ])
      );

      const response = (await client.getAccountBalance('1234567890')) as AccountBalanceResponse;

      expect(response.success).toBe(true);
      expect(response.requiresTan).toBe(false);
      expect(response.balance).toBeDefined();
      expect(dialogStartMock).toHaveBeenCalledOnce();
      expect(dialogContinueMock).toHaveBeenCalledTimes(0);
    });

    it('returns init dialog response when TAN is required', async () => {
      dialogStartMock.mockResolvedValueOnce(
        new Map<string, ClientResponse | AccountBalanceResponse>([
          [
            'HKIDN',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: true,
              tanReference: 'TANREF123',
              tanChallenge: 'Bitte geben Sie Ihre TAN ein.',
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
            },
          ],
        ])
      );

      const response = (await client.getAccountBalance('1234567890')) as AccountBalanceResponse;

      expect(response.success).toBe(true);
      expect(response.requiresTan).toBe(true);
      expect(response.tanReference).toBe('TANREF123');
      expect(dialogStartMock).toHaveBeenCalledOnce();
      expect(dialogContinueMock).toHaveBeenCalledTimes(0);
    });
  });

  describe('getAccountBalanceWithTan', () => {
    it('returns balance response when TAN is provided', async () => {
      dialogContinueMock.mockResolvedValueOnce(
        new Map<string, ClientResponse | AccountBalanceResponse>([
          [
            'HKSAL',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
              balance: { date: new Date('2025-12-23'), currency: 'EUR', balance: 2500.0 },
            },
          ],
          [
            'HKEND',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 100, text: 'Dialog beendet' }],
            },
          ],
        ])
      );

      const response = (await client.getAccountBalanceWithTan('TANREF123', '123456')) as AccountBalanceResponse;

      expect(response.success).toBe(true);
      expect(response.requiresTan).toBe(false);
      expect(response.balance).toBeDefined();
      expect(response.balance!.balance).toBe(2500.0);
      expect(dialogContinueMock).toHaveBeenCalledWith('TANREF123', '123456');
    });
  });

  describe('synchronize', () => {
    it('returns synchronization response when no TAN is required', async () => {
      dialogStartMock.mockResolvedValueOnce(
        new Map<string, ClientResponse>([
          [
            'HKIDN',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: true,
              bankAnswers: [{ code: 20, text: 'Synchronisierung erfolgreich' }],
            },
          ],
          [
            'HKEND',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 100, text: 'Dialog beendet' }],
            },
          ],
        ])
      );

      const response = await client.synchronize();

      expect(response.success).toBe(true);
      expect(response.requiresTan).toBe(false);
      expect(response.bankingInformationUpdated).toBe(true);
      expect(dialogStartMock).toHaveBeenCalledOnce();
    });

    it('returns sync response requiring TAN', async () => {
      dialogStartMock.mockResolvedValueOnce(
        new Map<string, ClientResponse>([
          [
            'HKIDN',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: true,
              tanReference: 'SYNCTAN123',
              tanChallenge: 'TAN für Synchronisation eingeben.',
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 3955, text: 'TAN erforderlich' }],
            },
          ],
        ])
      );

      const response = await client.synchronize();

      expect(response.success).toBe(true);
      expect(response.requiresTan).toBe(true);
      expect(response.tanReference).toBe('SYNCTAN123');
      expect(response.tanChallenge).toBe('TAN für Synchronisation eingeben.');
    });
  });

  describe('synchronizeWithTan', () => {
    it('completes synchronization with TAN', async () => {
      dialogContinueMock.mockResolvedValueOnce(
        new Map<string, ClientResponse>([
          [
            'HKIDN',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: true,
              bankAnswers: [{ code: 20, text: 'Synchronisierung erfolgreich' }],
            },
          ],
          [
            'HKEND',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 100, text: 'Dialog beendet' }],
            },
          ],
        ])
      );

      const response = await client.synchronizeWithTan('SYNCTAN123', '789012');

      expect(response.success).toBe(true);
      expect(response.requiresTan).toBe(false);
      expect(response.bankingInformationUpdated).toBe(true);
      expect(dialogContinueMock).toHaveBeenCalledWith('SYNCTAN123', '789012');
    });
  });

  describe('getAccountStatements', () => {
    it('fetches statements using CAMT format when available and preferred', async () => {
      dialogStartMock.mockResolvedValueOnce(
        new Map<string, ClientResponse | StatementResponse>([
          [
            'HKIDN',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
            },
          ],
          [
            'HKCAZ',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
              statements: [
                {
                  account: '1234567890',
                  transactions: [],
                  openingBalance: { date: new Date('2025-12-01'), currency: 'EUR', value: 500.0 },
                  closingBalance: { date: new Date('2025-12-23'), currency: 'EUR', value: 1500.0 },
                },
              ],
            },
          ],
          [
            'HKEND',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 100, text: 'Dialog beendet' }],
            },
          ],
        ])
      );

      const response = (await client.getAccountStatements('1234567890')) as StatementResponse;

      expect(response.success).toBe(true);
      expect(response.statements).toBeDefined();
      expect(response.statements!.length).toBe(1);
      expect(response.statements![0].account).toBe('1234567890');
    });

    it('throws error when account does not support statements', async () => {
      await expect(client.getAccountStatements('9999999999')).rejects.toThrow('Account 9999999999 not found in UPD');
    });

    it('uses MT940 when preferCamt is false', async () => {
      dialogStartMock.mockResolvedValueOnce(
        new Map<string, ClientResponse | StatementResponse>([
          [
            'HKIDN',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
            },
          ],
          [
            'HKKAZ',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
              statements: [
                {
                  account: '1234567890',
                  transactions: [],
                  openingBalance: { date: new Date('2025-12-01'), currency: 'EUR', value: 500.0 },
                  closingBalance: { date: new Date('2025-12-23'), currency: 'EUR', value: 1500.0 },
                },
              ],
            },
          ],
          [
            'HKEND',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 100, text: 'Dialog beendet' }],
            },
          ],
        ])
      );

      const response = (await client.getAccountStatements(
        '1234567890',
        undefined,
        undefined,
        false
      )) as StatementResponse;

      expect(response.success).toBe(true);
      expect(response.statements).toBeDefined();
      expect(response.statements!.length).toBe(1);
      expect(response.statements![0].account).toBe('1234567890');
    });
  });

  describe('getAccountStatementsWithTan', () => {
    it('continues statement fetching with TAN', async () => {
      dialogContinueMock.mockResolvedValueOnce(
        new Map<string, ClientResponse | StatementResponse>([
          [
            'HKCAZ',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
              statements: [
                {
                  account: '1234567890',
                  transactions: [],
                  openingBalance: { date: new Date('2025-12-01'), currency: 'EUR', value: 500.0 },
                  closingBalance: { date: new Date('2025-12-23'), currency: 'EUR', value: 1500.0 },
                },
              ],
            },
          ],
        ])
      );

      const response = (await client.getAccountStatementsWithTan('STATEMENTTAN123', '456789')) as StatementResponse;

      expect(response.success).toBe(true);
      expect(response.statements).toBeDefined();
      expect(dialogContinueMock).toHaveBeenCalledWith('STATEMENTTAN123', '456789');
    });
  });

  describe('getPortfolio', () => {
    it('fetches portfolio information', async () => {
      dialogStartMock.mockResolvedValueOnce(
        new Map<string, ClientResponse | PortfolioResponse>([
          [
            'HKIDN',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
            },
          ],
          [
            'HKWPD',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
              portfolioStatement: {
                currency: 'EUR',
                holdings: [
                  {
                    isin: 'DE0001234567',
                    price: 25.5,
                    currency: 'EUR',
                  },
                ],
                totalValue: 2550.0,
              },
            },
          ],
        ])
      );

      const response = (await client.getPortfolio('9876543210')) as PortfolioResponse;

      expect(response.success).toBe(true);
      expect(response.portfolioStatement?.holdings).toBeDefined();
      expect(response.portfolioStatement!.holdings.length).toBe(1);
      expect(response.portfolioStatement!.totalValue).toBe(2550.0);
    });

    it('fetches portfolio with optional parameters', async () => {
      dialogStartMock.mockResolvedValueOnce(
        new Map<string, ClientResponse | PortfolioResponse>([
          [
            'HKIDN',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
            },
          ],
          [
            'HKWPD',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
              portfolioStatement: {
                currency: 'EUR',
                holdings: [
                  {
                    isin: 'DE0001234567',
                    price: 25.5,
                  },
                ],
                totalValue: 1000.0,
              },
            },
          ],
        ])
      );

      const response = (await client.getPortfolio('9876543210', 'EUR', '1', 10)) as PortfolioResponse;

      expect(response.success).toBe(true);
      expect(response.portfolioStatement!.holdings).toBeDefined();
      expect(response.portfolioStatement!.holdings.length).toBe(1);
      expect(response.portfolioStatement!.holdings[0].isin).toBe('DE0001234567');
    });
  });

  describe('getPortfolioWithTan', () => {
    it('continues portfolio fetching with TAN', async () => {
      dialogContinueMock.mockResolvedValueOnce(
        new Map<string, ClientResponse | PortfolioResponse>([
          [
            'HKWPD',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
              portfolioStatement: {
                currency: 'EUR',
                holdings: [],
              },
            },
          ],
        ])
      );

      const response = (await client.getPortfolioWithTan('PORTFOLIOTAN123', '987654')) as PortfolioResponse;

      expect(response.success).toBe(true);
      expect(response.portfolioStatement).toBeDefined();
      expect(dialogContinueMock).toHaveBeenCalledWith('PORTFOLIOTAN123', '987654');
    });
  });

  describe('getCreditCardStatements', () => {
    it('fetches credit card statements', async () => {
      dialogStartMock.mockResolvedValueOnce(
        new Map<string, ClientResponse | StatementResponse>([
          [
            'HKIDN',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
            },
          ],
          [
            'DKKKU',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
              statements: [
                {
                  openingBalance: { date: new Date('2025-12-01'), currency: 'EUR', value: 0.0 },
                  closingBalance: { date: new Date('2025-12-23'), currency: 'EUR', value: -150.0 },
                  transactions: [],
                },
              ],
            },
          ],
        ])
      );

      const response = (await client.getCreditCardStatements('1111222233')) as StatementResponse;

      expect(response.success).toBe(true);
      expect(response.statements).toBeDefined();
      expect(response.statements!.length).toBe(1);
      expect(response.statements![0].closingBalance?.value).toBe(-150.0);
    });
  });

  describe('getCreditCardStatementsWithTan', () => {
    it('continues credit card statement fetching with TAN', async () => {
      dialogContinueMock.mockResolvedValueOnce(
        new Map<string, ClientResponse | StatementResponse>([
          [
            'DKKKU',
            {
              dialogId: 'DIALOG1',
              success: true,
              requiresTan: false,
              bankingInformationUpdated: false,
              bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
              statements: [],
            },
          ],
        ])
      );

      const response = (await client.getCreditCardStatementsWithTan('CCTAN123', '111222')) as StatementResponse;

      expect(response.success).toBe(true);
      expect(response.statements).toBeDefined();
      expect(dialogContinueMock).toHaveBeenCalledWith('CCTAN123', '111222');
    });
  });

  describe('capability checks', () => {
    describe('canGetAccountBalance', () => {
      it('returns true for general capability when bank supports it', () => {
        expect(client.canGetAccountBalance()).toBe(true);
      });

      it('returns true for specific account that supports balance checking', () => {
        expect(client.canGetAccountBalance('1234567890')).toBe(true);
      });

      it('returns false for account that does not support balance checking', () => {
        expect(client.canGetAccountBalance('9876543210')).toBe(false);
      });
    });

    describe('canGetAccountStatements', () => {
      it('returns true for general capability when bank supports it', () => {
        expect(client.canGetAccountStatements()).toBe(true);
      });

      it('returns true for account that supports statements', () => {
        expect(client.canGetAccountStatements('1234567890')).toBe(true);
      });

      it('returns false for account that does not support statements', () => {
        expect(client.canGetAccountStatements('1111222233')).toBe(false);
      });
    });

    describe('canGetPortfolio', () => {
      it('returns true for general capability when bank supports it', () => {
        expect(client.canGetPortfolio()).toBe(true);
      });

      it('returns true for depot account', () => {
        expect(client.canGetPortfolio('9876543210')).toBe(true);
      });

      it('returns false for non-depot account', () => {
        expect(client.canGetPortfolio('1234567890')).toBe(false);
      });
    });

    describe('canGetCreditCardStatements', () => {
      it('returns true for general capability when bank supports it', () => {
        expect(client.canGetCreditCardStatements()).toBe(true);
      });

      it('returns true for credit card account', () => {
        expect(client.canGetCreditCardStatements('1111222233')).toBe(true);
      });

      it('returns false for non-credit card account', () => {
        expect(client.canGetCreditCardStatements('1234567890')).toBe(false);
      });
    });
  });

  describe('TAN method and media selection', () => {
    describe('selectTanMethod', () => {
      it('selects TAN method by ID and returns the method', () => {
        const tanMethod = client.selectTanMethod(2);

        expect(tanMethod).toBeDefined();
        expect(tanMethod.id).toBe(2);
        expect(tanMethod.name).toBe('pushTAN');
        expect(client.config.selectedTanMethod).toBe(tanMethod);
      });

      it('throws error for invalid TAN method ID', () => {
        expect(() => client.selectTanMethod(999)).toThrow();
      });
    });

    describe('selectTanMedia', () => {
      it('selects TAN media by name', () => {
        // First select a TAN method that has TAN media
        client.selectTanMethod(1);

        expect(() => client.selectTanMedia('TAN-Generator 123')).not.toThrow();
      });

      it('throws error for invalid TAN media name', () => {
        client.selectTanMethod(1);

        expect(() => client.selectTanMedia('Invalid Media')).toThrow();
      });
    });
  });
});
