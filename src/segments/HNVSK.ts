import { Time } from '../dataElements/Time.js';
import { Dat } from '../dataElements/Dat.js';
import { Binary } from '../dataElements/Binary.js';
import { Numeric } from '../dataElements/Numeric.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { BankIdentification } from '../dataGroups/BankIdentification.js';
import { Identification } from '../dataElements/Identification.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';
import { SegmentHeader } from '../segmentHeader.js';
import { Certificate, Key, SecDateTime, SecIdentification, SecProfile } from './HNSHK.js';

export type HNVSKSegment = Segment & {
  header: SegmentHeader & { segNr: 998 };
  secProfile: SecProfile;
  secFunc: number;
  secRole: number;
  secId: SecIdentification;
  dateTime: SecDateTime;
  encryption: Encryption;
  key: Key;
  compressMethod: number;
  certificate?: Certificate;
};

export type Encryption = {
  use: number;
  mode: number;
  algorithm: number;
  keyParamValue: string;
  keyParamName: number;
  initParamName: number;
  initParamValue?: string;
};

/**
 * Encryption body
 */
export class HNVSK extends SegmentDefinition {
  static Id = this.name;
  static Version = 3;
  version = HNVSK.Version;
  elements = [
    new DataGroup('secProfile', [new AlphaNumeric('secMethod', 1, 1, 3), new Numeric('secVersion', 1, 1, 3)], 1, 1),
    new Numeric('secFunc', 1, 1, 3),
    new Numeric('secRole', 1, 1, 3),
    new DataGroup(
      'secId',
      [new Numeric('partyType', 1, 1, 3), new Binary('cid', 0, 1, 256), new Identification('partyID', 0, 1)],
      1,
      1
    ),
    new DataGroup('dateTime', [new Numeric('type', 1, 1, 3), new Dat('date', 0, 1), new Time('time', 0, 1)], 1, 1),
    new DataGroup(
      'encryption',
      [
        new Numeric('use', 1, 1, 3),
        new Numeric('mode', 1, 1, 3),
        new Numeric('algorithm', 1, 1, 3),
        new Binary('keyParamValue', 1, 1, 512),
        new Numeric('keyParamName', 1, 1, 3),
        new Numeric('initParamName', 1, 1, 3),
        new Binary('initParamValue', 0, 1, 512),
      ],
      1,
      1
    ),
    new DataGroup(
      'key',
      [
        new BankIdentification('bank', 1, 1),
        new Identification('userId', 1, 1),
        new AlphaNumeric('keyType', 1, 1, 1),
        new Numeric('keyNr', 1, 1, 3),
        new Numeric('keyVersion', 1, 1, 3),
      ],
      1,
      1
    ),
    new Numeric('compressMethod', 1, 1, 3),
    new DataGroup('certificate', [new Numeric('type', 1, 1, 3), new Binary('content', 1, 1, 4096)], 0, 1),
  ];

  setSegmentNumber(segmentNumber: number): number {
    return 0;
  }
}
