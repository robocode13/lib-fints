import { Language } from '../codes.js';
import { Numeric } from '../dataElements/Numeric.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { SegmentDefinition } from '../segmentDefinition.js';
import { Segment } from '../segment.js';
import { Bank } from '../dataGroups/Account.js';
import { BankIdentification } from '../dataGroups/BankIdentification.js';

export type HIBPASegment = Segment & {
  bpdVersion: number;
  bank: Bank;
  bankName: string;
  maxNumTransactions: number;
  supportedLanguages: Language[];
  supportedHbciVersions: number[];
  maxMessageSizeInKb?: number;
  minTimeoutSecs?: number;
  maxTimeoutSecs?: number;
};

/**
 * General bank parameters
 */
export class HIBPA extends SegmentDefinition {
  static Id = this.name;
  version = 3;
  elements = [
    new Numeric('bpdVersion', 1, 1, 3),
    new BankIdentification('bank', 1, 1),
    new AlphaNumeric('bankName', 1, 1, 60),
    new Numeric('maxNumTransactions', 1, 1, 3),
    new DataGroup('supportedLanguages', [new Numeric('lang', 1, 9, 3)], 1, 1),
    new DataGroup('supportedHbciVersions', [new Numeric('version', 1, 9, 3)], 1, 1),
    new Numeric('maxMessageSizeInKb', 0, 1, 4),
    new Numeric('minTimeoutSecs', 0, 1, 4),
    new Numeric('maxTimeoutSecs', 0, 1, 4),
  ];
}
