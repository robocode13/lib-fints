import { describe, it, expect } from 'vitest';
import { registerSegments } from '../segments/registry.js';
import { HKWPD, HKWPDSegment } from '../segments/HKWPD.js';
import { decode, encode } from '../segment.js';

registerSegments();

describe('HKWPD', () => {
  it('decode and encode roundtrip matches with all fields', () => {
    const text =
      "HKWPD:2:6+12345678901234567890:EUR:276:280+EUR+1+100+NextMarkerABC123'";
    const segment = decode(text) as HKWPDSegment;

    expect(segment.depot.accountNumber).toBe('12345678901234567890');
    expect(segment.depot.subAccountId).toBe('EUR');
    expect(segment.depot.bank.country).toBe(276);
    expect(segment.depot.bank.bankId).toBe('280');
    expect(segment.currency).toBe('EUR');
    expect(segment.priceQuality).toBe('1');
    expect(segment.maxEntries).toBe(100);
    expect(segment.paginationMarker).toBe('NextMarkerABC123');

    expect(encode(segment)).toBe(text);
  });

  it('decode and encode roundtrip matches with minimal fields', () => {
    const text = "HKWPD:1:6+9876543210::276:280'";
    const segment = decode(text) as HKWPDSegment;

    expect(segment.depot.accountNumber).toBe('9876543210');
    expect(segment.depot.subAccountId).toBeUndefined();
    expect(segment.depot.bank.country).toBe(276);
    expect(segment.depot.bank.bankId).toBe('280');
    expect(segment.currency).toBeUndefined();
    expect(segment.priceQuality).toBeUndefined();
    expect(segment.maxEntries).toBeUndefined();
    expect(segment.paginationMarker).toBeUndefined();

    const encoded = encode(segment);
    expect(encoded).toBe("HKWPD:1:6+9876543210::276:280'");

    const decodedAgain = decode(encoded) as HKWPDSegment;
    expect(decodedAgain.depot.accountNumber).toBe('9876543210');
    expect(decodedAgain.depot.subAccountId).toBeUndefined();
    expect(decodedAgain.depot.bank.country).toBe(276);
    expect(decodedAgain.depot.bank.bankId).toBe('280');
  });
});
