import { describe, it, expect } from 'vitest';
import { BankIdentification } from '../dataGroups/BankIdentification.js';

describe('BankIdentification', () => {
  it('encodes correctly', () => {
    const id = new BankIdentification('bank', 1, 1);
    expect(id.encode({ country: 280, bankId: '12030000' }, [], 1)).toBe('280:12030000');
  });
});
