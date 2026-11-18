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
import type { HKIDNSegment } from '../segments/HKIDN.js';
import { HKVPA, type HKVPASegment } from '../segments/HKVPA.js';
import type { HKVVBSegment } from '../segments/HKVVB.js';
import { registerSegments } from '../segments/registry.js';

// Mock HttpClient to prevent real HTTP calls
vi.mock('../httpClient.js', () => ({
	HttpClient: class MockHttpClient {
		constructor(
			public url: string,
			public debug = false,
			public debugRaw = false,
		) {}

		sendMessage = vi.fn();
	},
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

	describe('awaitsCaller()', () => {
		let waiting: SepaAccountInteraction;

		beforeEach(() => {
			waiting = new SepaAccountInteraction();
			vi.spyOn(waiting, 'handleClientResponse').mockReturnValue(successResponse());
			vi.spyOn(waiting, 'awaitsCaller').mockReturnValue(true);
			dialog.addCustomerInteraction(waiting);
		});

		it('stops the dialog for a decision of the caller and keeps it open', async () => {
			const responses = await dialog.start();

			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(2);
			expect(responses.get(waiting.segId)?.success).toBe(true);
			expect(dialog.currentInteraction).toBe(waiting);
			expect(dialog.isInitialized).toBe(true);
			expect(dialog.hasEnded).toBe(false);
		});

		it('is not consulted for responses that failed or need a TAN', async () => {
			vi.mocked(waiting.handleClientResponse).mockReturnValue({
				...successResponse(),
				success: false,
			});

			await dialog.start();

			expect(waiting.awaitsCaller).not.toHaveBeenCalled();
		});
	});

	describe('synchronization', () => {
		const hkvvbOf = (syncSystemId: boolean) =>
			new InitDialogInteraction(config, syncSystemId)
				.createSegments(config)
				.find((segment) => segment.header.segId === 'HKVVB') as HKVVBSegment;
		const hkidnOf = () =>
			new InitDialogInteraction(config, true)
				.createSegments(config)
				.find((segment) => segment.header.segId === 'HKIDN') as HKIDNSegment;
		const addHkvpp = (params?: unknown, versions = [1]) => {
			config.bankingInformation.bpd?.allowedTransactions.push({
				transId: 'HKVPP',
				tanRequired: false,
				versions,
				params,
			});
		};

		it('asks for the whole BPD again when the cached HKVPP lacks its parameters', () => {
			// As an earlier release saved it: the version of HIVPPS, but not its content
			addHkvpp();

			expect(hkvvbOf(true).bpdVersion).toBe(0);
			expect(hkidnOf().systemId).toBe('MOCK_SYSTEM_ID');
		});

		it('keeps the cached BPD version for an HIVPPS version this library cannot read', () => {
			addHkvpp(undefined, [2]);

			expect(hkvvbOf(true).bpdVersion).toBe(1);
		});

		it('keeps the cached BPD version when the HKVPP parameters are there', () => {
			addHkvpp({ vopRequiredTransactions: ['HKCCS'] });

			expect(hkvvbOf(true).bpdVersion).toBe(1);
		});
	});

	describe('continueWith()', () => {
		let waiting: SepaAccountInteraction;

		beforeEach(async () => {
			waiting = new SepaAccountInteraction();
			vi.spyOn(waiting, 'handleClientResponse').mockReturnValue(successResponse());
			vi.spyOn(waiting, 'awaitsCaller').mockReturnValue(true);
			dialog.addCustomerInteraction(waiting);
		});

		it('sends the given interaction next and then ends the dialog', async () => {
			await dialog.start();

			const next = new SepaAccountInteraction();
			const handleNext = vi.spyOn(next, 'handleClientResponse').mockReturnValue(successResponse());

			await dialog.continueWith(next);

			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(4);
			expect(handleNext).toHaveBeenCalledTimes(1);
			expect(dialog.interactions.indexOf(next)).toBe(dialog.interactions.indexOf(waiting) + 1);
			expect(dialog.hasEnded).toBe(true);
		});

		it('stops again when the next interaction awaits the caller', async () => {
			await dialog.start();

			const next = new SepaAccountInteraction();
			vi.spyOn(next, 'handleClientResponse').mockReturnValue(successResponse());
			vi.spyOn(next, 'awaitsCaller').mockReturnValue(true);

			await dialog.continueWith(next);

			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(3);
			expect(dialog.currentInteraction).toBe(next);
			expect(dialog.hasEnded).toBe(false);
		});

		it('throws when the dialog has not been initialized', async () => {
			await expect(dialog.continueWith(new SepaAccountInteraction())).rejects.toThrow(
				'cannot continue a dialog that has not been initialized',
			);
		});

		it('throws before sending anything while the current interaction waits for a TAN', async () => {
			vi.mocked(waiting.handleClientResponse).mockReturnValue({
				...successResponse(),
				requiresTan: true,
				tanReference: 'TAN-REF-1',
			});
			await dialog.start();
			const calls = httpClientSendMessageMock.mock.calls.length;

			await expect(dialog.continueWith(new SepaAccountInteraction())).rejects.toThrow(
				'cannot continue a dialog whose current interaction does not wait for the caller',
			);
			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(calls);
			expect(dialog.currentInteraction).toBe(waiting);
		});

		it('throws when the dialog has ended', async () => {
			await dialog.start();
			dialog.hasEnded = true;

			await expect(dialog.continueWith(new SepaAccountInteraction())).rejects.toThrow(
				'cannot continue a dialog that has already ended',
			);
		});
	});

	describe('end()', () => {
		it('ends an open dialog with HKEND and skips queued interactions', async () => {
			const waiting = new SepaAccountInteraction();
			vi.spyOn(waiting, 'handleClientResponse').mockReturnValue(successResponse());
			vi.spyOn(waiting, 'awaitsCaller').mockReturnValue(true);
			dialog.addCustomerInteraction(waiting);
			const queued = new SepaAccountInteraction();
			const handleQueued = vi.spyOn(queued, 'handleClientResponse');
			dialog.addCustomerInteraction(queued);

			await dialog.start();
			await dialog.end();

			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(3);
			expect(sentSegmentIds(2)).toContain('HKEND');
			expect(handleQueued).not.toHaveBeenCalled();
			expect(dialog.hasEnded).toBe(true);
		});

		it('marks the dialog as ended even when HKEND fails', async () => {
			const waiting = new SepaAccountInteraction();
			vi.spyOn(waiting, 'handleClientResponse').mockReturnValue(successResponse());
			vi.spyOn(waiting, 'awaitsCaller').mockReturnValue(true);
			dialog.addCustomerInteraction(waiting);
			await dialog.start();
			httpClientSendMessageMock.mockRejectedValueOnce(new Error('network down'));

			await expect(dialog.end()).rejects.toThrow('network down');
			expect(dialog.hasEnded).toBe(true);
		});

		it('only marks a dialog as ended that has not sent a message', async () => {
			await dialog.end();

			expect(httpClientSendMessageMock).not.toHaveBeenCalled();
			expect(dialog.hasEnded).toBe(true);
		});

		it('does nothing when the dialog has already ended', async () => {
			await dialog.start();
			const calls = httpClientSendMessageMock.mock.calls.length;

			await dialog.end();

			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(calls);
		});
	});

	describe('getTanMessageSegments()', () => {
		it('sends the segments of the interaction along with the TAN, before HKTAN', async () => {
			vi.spyOn(dialog.currentInteraction, 'handleClientResponse').mockReturnValue({
				...successResponse(),
				requiresTan: true,
				tanReference: 'TAN_REF_123',
			});
			await dialog.start();

			const hkvpa: HKVPASegment = {
				header: { segId: HKVPA.Id, segNr: 0, version: HKVPA.Version },
				vopId: 'VOP-ID-1',
			};
			vi.spyOn(dialog.currentInteraction, 'getTanMessageSegments').mockReturnValue([hkvpa]);
			vi.spyOn(dialog.currentInteraction, 'handleClientResponse').mockReturnValue(
				successResponse(),
			);

			await dialog.continue('TAN_REF_123', '123456');

			expect(sentSegmentIds(1)).toEqual(['HNHBK', 'HNSHK', 'HKVPA', 'HKTAN', 'HNSHA', 'HNHBS']);
		});

		it('sends only HKTAN by default', async () => {
			vi.spyOn(dialog.currentInteraction, 'handleClientResponse').mockReturnValue({
				...successResponse(),
				requiresTan: true,
				tanReference: 'TAN_REF_123',
			});
			await dialog.start();
			vi.spyOn(dialog.currentInteraction, 'handleClientResponse').mockReturnValue(
				successResponse(),
			);

			await dialog.continue('TAN_REF_123', '123456');

			expect(sentSegmentIds(1)).toEqual(['HNHBK', 'HNSHK', 'HKTAN', 'HNSHA', 'HNHBS']);
		});
	});

	function successResponse(): ClientResponse {
		return {
			dialogId: 'MOCK_DIALOG_123',
			success: true,
			requiresTan: false,
			bankingInformationUpdated: false,
			bankAnswers: [{ code: 20, text: 'Success' }],
		};
	}

	function sentSegmentIds(callIndex: number): string[] {
		const message = httpClientSendMessageMock.mock.calls[callIndex][0] as Message;
		return message.segments.map((segment) => segment.header.segId);
	}
});
