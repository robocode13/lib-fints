import { MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinTSClient } from '../client.js';
import { Dialog } from '../dialog.js';
import { InitDialogInteraction, InitResponse } from '../interactions/initDialogInteraction.js';
import { FinTSConfig } from '../config.js';

describe('FinTSClient', () => {
  let dialogInitializeMock: MockInstance<[interaction: InitDialogInteraction], Promise<InitResponse>>;
  let dialogEndMock: MockInstance<[], Promise<boolean>>;

  beforeEach(() => {
    dialogInitializeMock = vi.spyOn(Dialog.prototype, 'initialize');
    dialogEndMock = vi.spyOn(Dialog.prototype, 'end');
  });

  afterEach(() => {
    dialogInitializeMock.mockRestore();
    dialogEndMock.mockRestore();
  });

  it('sends a message', async () => {
    const client = new FinTSClient(
      FinTSConfig.forFirstTimeUse('product', '1.0', 'http://localhost', '12030000', 'user')
    );

    dialogInitializeMock.mockResolvedValueOnce({
      dialogId: 'DIALOG1',
      success: true,
      requiresTan: false,
      bankingInformationUpdated: true,
      bankingInformation: { systemId: 'SYSTEM01', bankMessages: [] },
      bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
    });

    const response = await client.synchronize();

    expect(response.success).toBe(true);
    expect(response.requiresTan).toBe(false);
    expect(response.bankingInformation).toBeDefined();
    expect(dialogInitializeMock).toHaveBeenCalledOnce();
    expect(dialogEndMock).toHaveBeenCalledOnce();
  });
});
