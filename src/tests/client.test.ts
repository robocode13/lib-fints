import { MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinTSClient } from '../client.js';
import { Dialog } from '../dialog.js';
import { FinTSConfig } from '../config.js';

describe('FinTSClient', () => {
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

	it('sends a message', async () => {
		const client = new FinTSClient(
			FinTSConfig.forFirstTimeUse('product', '1.0', 'http://localhost', '12030000', 'user')
		);

		dialogStartMock.mockResolvedValueOnce(
			new Map([
				[
					'HKIDN',
					{
						dialogId: 'DIALOG1',
						success: true,
						requiresTan: false,
						bankingInformationUpdated: true,
						bankingInformation: { systemId: 'SYSTEM01', bankMessages: [] },
						bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
					},
				],
			])
		);

		const response = await client.synchronize();

		expect(response.success).toBe(true);
		expect(response.requiresTan).toBe(false);
		expect(response.bankingInformation).toBeDefined();
		expect(dialogStartMock).toHaveBeenCalledOnce();
		expect(dialogContinueMock).toHaveBeenCalledTimes(0);
	});
});
