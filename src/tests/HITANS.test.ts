import { describe, it, expect } from 'vitest';
import { registerSegments } from '../segments/registry.js';
import { HITANS, HITANSSegment } from '../segments/HITANS.js';
import { decode, encode } from '../segment.js';

registerSegments();

describe('HITANS', () => {
  it('decode and encode roundtrip matches', () => {
    const text =
      "HITANS:163:6:4+1+1+1+J:N:0:910:2:HHD1.3.0:::chipTAN manuell:6:1:TAN-Nummer:3:J:2:N:0:0:N:N:00:0:N:1:911:2:HHD1.3.2OPT:HHDOPT1:1.3.2:chipTAN optisch:6:1:TAN-Nummer:3:J:2:N:0:0:N:N:00:0:N:1:912:2:HHD1.3.2USB:HHDUSB1:1.3.2:chipTAN-USB:6:1:TAN-Nummer:3:J:2:N:0:0:N:N:00:0:N:1:913:2:Q1S:Secoder_UC:1.2.0:chipTAN-QR:6:1:TAN-Nummer:3:J:2:N:0:0:N:N:00:0:N:1:920:2:smsTAN:::smsTAN:6:1:TAN-Nummer:3:J:2:N:0:0:N:N:00:2:N:5:921:2:TAN2go:::TAN2go:6:1:TAN-Nummer:3:J:2:N:0:0:N:N:00:2:N:2:900:2:iTAN:::iTAN:6:1:TAN-Nummer:3:J:2:N:0:0:N:N:00:0:N:0'";
    const segment = decode(text) as HITANSSegment;

    expect(segment.params.oneStepAllowed).toBe(true);
    expect(segment.params.tanMethods[0].methodName).toBe('chipTAN manuell');

    expect(encode(segment)).toBe(text);
  });

  it('decodes v1', () => {
    const text = 'HITANS:163:1:4+1+1+0+J:N:0:0:900:2:iTAN:iTAN:6:1:Index:3:1:N:N';
    const segment = decode(text) as unknown as HITANSSegment;

    expect(segment.params.tanMethods[0].methodId).toBe('iTAN');
    expect(segment.params.tanMethods[0].methodName).toBe('iTAN');
  });
});
