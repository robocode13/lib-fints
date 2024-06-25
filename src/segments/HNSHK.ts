import { Time } from '../dataElements/Time.js';
import { Dat } from '../dataElements/Dat.js';
import { Binary } from '../dataElements/Binary.js';
import { Numeric } from '../dataElements/Numeric.js';
import { Text } from '../dataElements/Text.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Bank } from '../dataGroups/Account.js';
import { BankIdentification } from '../dataGroups/BankIdentification.js';
import { Identification } from '../dataElements/Identification.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HNSHKSegment = Segment & {
  secProfile: SecProfile;
  secFunc: number;
  secControlRef: string;
  secArea: number;
  secRole: number;
  secId: SecIdentification;
  secRefNum: number;
  dateTime: SecDateTime;
  hash: Hash;
  signature: Signature;
  key: Key;
  certificate?: Certificate;
};

export type SecProfile = {
  secMethod: string;
  secVersion: number;
};

export type SecIdentification = {
  partyType: number;
  cid?: string;
  partyId?: string;
};

export type SecDateTime = {
  type: number;
  date?: Date;
  time?: Date;
};

export type Hash = {
  use: number;
  algorithm: number;
  paramName: number;
  paramValue?: string;
};

export type Signature = {
  use: number;
  algorithm: number;
  mode: number;
};

export type Key = {
  bank: Bank;
  userId: string;
  keyType: string;
  keyNr: number;
  keyVersion: number;
};

export type Certificate = {
  type: number;
  content: string;
};

/**
 * Signature Header
 */
export class HNSHK extends SegmentDefinition {
  static Id = this.name;
  static Version = 4;
  version = HNSHK.Version;
  elements = [
    new DataGroup('secProfile', [new AlphaNumeric('secMethod', 1, 1, 3), new Numeric('secVersion', 1, 1, 3)], 1, 1),
    new Numeric('secFunc', 1, 1, 3),
    new AlphaNumeric('secControlRef', 1, 1, 14),
    new Numeric('secArea', 1, 1, 3),
    new Numeric('secRole', 1, 1, 3),
    new DataGroup(
      'secId',
      [new Numeric('partyType', 1, 1, 3), new Binary('cid', 0, 1, 256), new Identification('partyId', 0, 1)],
      1,
      1
    ),
    new Numeric('secRefNum', 1, 1, 16),
    new DataGroup('dateTime', [new Numeric('type', 1, 1, 3), new Dat('date', 0, 1), new Time('time', 0, 1)], 1, 1),
    new DataGroup(
      'hash',
      [
        new Numeric('use', 1, 1, 3),
        new Numeric('algorithm', 1, 1, 3),
        new Numeric('paramName', 1, 1, 3),
        new Binary('paramValue', 0, 1, 512),
      ],
      1,
      1
    ),
    new DataGroup(
      'signature',
      [new Numeric('use', 1, 1, 3), new Numeric('algorithm', 1, 1, 3), new Numeric('mode', 1, 1, 3)],
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
    new DataGroup('cert', [new Numeric('type', 1, 1, 3), new Text('content', 1, 1, 4096)], 0, 1),
  ];
}
