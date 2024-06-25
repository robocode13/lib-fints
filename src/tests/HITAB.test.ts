import { describe, it, expect } from 'vitest';
import { registerSegments } from '../segments/registry.js';
import { HITAB, HITABSegment } from '../segments/HITAB.js';
import { decode, encode } from '../segment.js';

registerSegments();

describe('HITAB', () => {
  it('decodes correctly', () => {
    const text = "HITAB:5:4:3+0+A:1:::::::::::Media1::::::::+A:1:::::::::::Media2::::::::'";
    const segment = decode(text) as HITABSegment;

    expect(segment.mediaList.length).toBe(2);
    expect(segment.mediaList[0].name).toBe('Media1');
  });

  it('decode and encode roundtrip matches', () => {
    HITAB.Id;

    const text = "HITAB:5:4:3+0+A:1:::::::::::Greenwood::::::::+A:1:::::::::::iPhone::::::::'";
    const segment = decode(text);
    expect(encode(segment)).toBe(text);
  });
});
