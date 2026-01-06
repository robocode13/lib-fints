import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { BankingInformation } from '../bankingInformation.js';
import type { BankTransaction } from '../bankTransaction.js';
import type { BPD } from '../bpd.js';
import { Language } from '../codes.js';
import { FinTSConfig } from '../config.js';
import { Dialog } from '../dialog.js';
import type {
	ClientResponse,
	CustomerOrderInteraction,
} from '../interactions/customerInteraction.js';
import { InitDialogInteraction } from '../interactions/initDialogInteraction.js';
import { SepaAccountInteraction } from '../interactions/sepaAccountInteraction.js';
import { Message } from '../message.js';
import { registerSegments } from '../segments/registry.js';

// Mock HttpClient to prevent real HTTP calls
vi.mock('../httpClient.js', () => ({
	HttpClient: vi.fn().mockImplementation(() => ({
		sendMessage: vi.fn(),
	})),
}));

describe('Dialog', () => {
	let config: FinTSConfig;
	let dialog: Dialog;
	let httpClientSendMessageMock: MockInstance;

	registerSegments();

	beforeEach(() => {
		const bankingInformation: BankingInformation = {
			systemId: 'MOCK_SYSTEM_ID',
			bankMessages: [],
			bpd: {
				version: 1,
				bankId: '12030000',
				bankName: 'Mock Bank',
				countryCode: 280,
				url: 'http://mock.bank.url',
				allowedTransactions: [
					{
						transId: 'HKSPA',
						tanRequired: false,
						versions: [1, 2, 3],
					} as BankTransaction,
				],
				supportedTanMethods: [
					{
						id: 940,
						name: 'ChipTAN',
						version: 1,
						isDecoupled: false,
						activeTanMediaCount: 1,
						activeTanMedia: ['TAN-Generator 123'],
						tanMediaRequirement: 0,
					},
					{
						id: 941,
						name: 'pushTAN',
						version: 1,
						isDecoupled: true,
						activeTanMediaCount: 1,
						activeTanMedia: ['Mobile App'],
						tanMediaRequirement: 1,
					},
				],
				availableTanMethodIds: [940, 941],
				supportedLanguages: [Language.German],
				maxTransactionsPerMessage: 1,
			} as BPD,
		};

		config = FinTSConfig.fromBankingInformation(
			'TestProduct',
			'1.0',
			bankingInformation,
			'testuser',
			'12345',
			940, // tanMethodId
			'TAN-Generator 123', // tanMediaName
		);

		// Create dialog instance
		dialog = new Dialog(config);

		vi.spyOn(dialog.currentInteraction, 'handleClientResponse').mockReturnValue({
			dialogId: 'MOCK_DIALOG_123',
			success: true,
			requiresTan: false,
			bankAnswers: [{ code: 20, text: 'Success' }],
		} as ClientResponse);

		vi.spyOn(
			dialog.interactions[dialog.interactions.length - 1],
			'handleClientResponse',
		).mockReturnValue({
			dialogId: 'MOCK_DIALOG_123',
			success: true,
			requiresTan: false,
			bankAnswers: [{ code: 100, text: 'Dialog ended' }],
		} as ClientResponse);

		// Mock the HttpClient.sendMessage method
		httpClientSendMessageMock = vi.mocked(dialog.httpClient.sendMessage);
		const responseMessage: Message = new Message([]);
		httpClientSendMessageMock.mockResolvedValue(responseMessage);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('constructor', () => {
		it('creates a new dialog with provided config', () => {
			expect(dialog.config).toBe(config);
			expect(dialog.dialogId).toBe('0');
			expect(dialog.lastMessageNumber).toBe(0);
			expect(dialog.interactions).toHaveLength(2);
			expect(dialog.interactions[0]).toBeInstanceOf(InitDialogInteraction);
			expect(dialog.currentInteractionIndex).toBe(0);
			expect(dialog.isInitialized).toBe(false);
			expect(dialog.hasEnded).toBe(false);
			expect(dialog.httpClient.sendMessage).toBeDefined();
		});

		it('creates dialog with syncSystemId option', () => {
			const syncDialog = new Dialog(config, true);
			const initDialogInteraction = syncDialog.interactions[0] as InitDialogInteraction;
			expect(initDialogInteraction).toBeInstanceOf(InitDialogInteraction);
			expect(initDialogInteraction.syncSystemId).toBe(true);
		});

		it('throws error when no config is provided', () => {
			expect(() => new Dialog(null as unknown as FinTSConfig)).toThrow(
				'configuration must be provided',
			);
		});
	});

	describe('currentInteraction getter', () => {
		it('returns the current interaction', () => {
			expect(dialog.currentInteraction).toBeInstanceOf(InitDialogInteraction);
		});
	});

	describe('start()', () => {
		it('successfully starts and ends a dialog', async () => {
			const sepaInteraction = new SepaAccountInteraction();

			vi.spyOn(sepaInteraction, 'handleClientResponse').mockReturnValue({
				dialogId: 'MOCK_DIALOG_123',
				success: true,
				requiresTan: false,
				bankAnswers: [{ code: 20, text: 'Success' }],
			} as ClientResponse);

			dialog.addCustomerInteraction(sepaInteraction);
			const responses = await dialog.start();

			expect(dialog.dialogId).toBe('MOCK_DIALOG_123');
			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(3);
			expect(responses).toBeInstanceOf(Map);
			expect(responses.size).toBe(3);
			expect(dialog.currentInteraction).toBeUndefined();
			expect(dialog.hasEnded).toBe(true);
		});

		it('throws error when dialog is already initialized', async () => {
			dialog.isInitialized = true;

			await expect(dialog.start()).rejects.toThrow('dialog has already been initialized');
		});

		it('throws error when dialog has ended', async () => {
			dialog.hasEnded = true;

			await expect(dialog.start()).rejects.toThrow('cannot start a dialog that has already ended');
		});

		it('throws error when lastMessageNumber > 0', async () => {
			dialog.lastMessageNumber = 1;

			await expect(dialog.start()).rejects.toThrow(
				'dialog start can only be called on a new dialog',
			);
		});

		it('handles TAN requirement correctly', async () => {
			vi.spyOn(dialog.currentInteraction, 'handleClientResponse').mockReturnValue({
				dialogId: 'MOCK_DIALOG_123',
				success: true,
				requiresTan: true,
				tanReference: 'TAN_REF_123',
				bankAnswers: [{ code: 3955, text: 'TAN required' }],
			} as ClientResponse);

			const responses = await dialog.start();

			expect(dialog.currentInteraction).toBeInstanceOf(InitDialogInteraction);
			expect(dialog.isInitialized).toBe(false);
			expect(dialog.hasEnded).toBe(false);
			const response = responses.get(dialog.currentInteraction.segId);
			expect(response).toBeDefined();
			expect(response?.requiresTan).toBe(true);
			expect(response?.tanReference).toBe('TAN_REF_123');
		});
	});

	describe('continue()', () => {
		beforeEach(async () => {
			vi.spyOn(dialog.currentInteraction, 'handleClientResponse').mockReturnValue({
				dialogId: 'MOCK_DIALOG_123',
				success: true,
				requiresTan: true,
				tanReference: 'TAN_REF_123',
				bankAnswers: [{ code: 3955, text: 'TAN required' }],
			} as ClientResponse);

			await dialog.start();

			vi.spyOn(dialog.currentInteraction, 'handleClientResponse').mockReturnValue({
				dialogId: 'MOCK_DIALOG_123',
				success: true,
				requiresTan: false,
				bankAnswers: [{ code: 20, text: 'Dialog initialized' }],
			} as ClientResponse);
		});

		it('successfully continues with TAN', async () => {
			const responses = await dialog.continue('TAN_REF_123', '123456');

			expect(responses).toBeInstanceOf(Map);
			expect(dialog.dialogId).toBe('MOCK_DIALOG_123');
			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(3);
			expect(responses).toBeInstanceOf(Map);
			expect(responses.size).toBe(2);
			expect(dialog.currentInteraction).toBeUndefined();
			expect(dialog.hasEnded).toBe(true);
		});

		it('successfully continues decoupled TAN method without TAN', async () => {
			config.selectTanMethod(941);
			const responses = await dialog.continue('TAN_REF_123');
			expect(responses).toBeInstanceOf(Map);
			expect(responses.size).toBe(2);
			expect(dialog.currentInteraction).toBeUndefined();
			expect(dialog.hasEnded).toBe(true);
		});

		it('throws error when tanOrderReference is missing', async () => {
			await expect(dialog.continue('')).rejects.toThrow(
				'tanOrderReference must be provided to continue a customer order with a TAN',
			);
		});

		it('throws error when TAN is missing for non-decoupled method', async () => {
			// The default config already has a non-decoupled TAN method
			await expect(dialog.continue('TAN_REF_123')).rejects.toThrow(
				'TAN must be provided for non-decoupled TAN methods',
			);
		});

		it('throws error when dialog has ended', async () => {
			dialog.hasEnded = true;

			await expect(dialog.continue('TAN_REF_123', '123456')).rejects.toThrow(
				'cannot continue a customer order when dialog has already ended',
			);
		});

		it('throws error when no current interaction', async () => {
			dialog.currentInteractionIndex = dialog.interactions.length;

			await expect(dialog.continue('TAN_REF_123', '123456')).rejects.toThrow(
				'there is no running customer interaction in this dialog to continue',
			);
		});
	});

	describe('addCustomerInteraction()', () => {
		let sepaAccountInteraction: CustomerOrderInteraction;

		beforeEach(() => {
			sepaAccountInteraction = new SepaAccountInteraction();
		});

		it('adds interaction to the end but before dialog end interaction by default', () => {
			const initialLength = dialog.interactions.length;

			dialog.addCustomerInteraction(sepaAccountInteraction);

			expect(dialog.interactions).toHaveLength(initialLength + 1);
			expect(dialog.interactions[dialog.interactions.length - 2]).toBe(sepaAccountInteraction);
			expect(sepaAccountInteraction.dialog).toBe(dialog);
		});

		it('adds interaction after current when afterCurrent is true', () => {
			const initialLength = dialog.interactions.length;
			const currentIndex = dialog.currentInteractionIndex;

			dialog.addCustomerInteraction(sepaAccountInteraction, true);

			expect(dialog.interactions).toHaveLength(initialLength + 1);
			expect(dialog.interactions[currentIndex + 1]).toBe(sepaAccountInteraction);
		});

		it('throws error when dialog has ended', () => {
			dialog.hasEnded = true;

			expect(() => dialog.addCustomerInteraction(sepaAccountInteraction)).toThrow(
				'cannot queue another customer interaction when dialog has already ended',
			);
		});

		it('throws error for unsupported transaction', () => {
			// Mock unsupported transaction
			sepaAccountInteraction.segId = 'UNSUPPORTED';

			expect(() => dialog.addCustomerInteraction(sepaAccountInteraction)).toThrow(
				'customer order transaction UNSUPPORTED is not supported according to the BPD',
			);
		});
	});
});
