import { MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinTSClient } from '../client.js';
import { Dialog } from '../dialog.js';
import { FinTSConfig } from '../config.js';
import { Language } from '../codes.js';
import { AccountBalanceResponse, ClientResponse } from '../index.js';

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
        allowedTransactions: [{ transId: 'HKSAL', versions: [6, 7], tanRequired: false }],
        maxTransactionsPerMessage: 1,
        supportedLanguages: [Language.German],
        supportedHbciVersions: [300],
        supportedTanMethods: [
          {
            id: 1,
            name: 'ChipTAN',
            version: 1,
            isDecoupled: false,
            activeTanMediaCount: 0,
            activeTanMedia: [],
            tanMediaRequirement: 0,
          },
        ],
        availableTanMethodIds: [1],
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
});
