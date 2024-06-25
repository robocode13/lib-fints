import { UpdUsage } from '../codes.js';
import { Numeric } from '../dataElements/Numeric.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { SegmentDefinition } from '../segmentDefinition.js';
import { Segment } from '../segment.js';
import { Identification } from '../dataElements/Identification.js';

export type HIUPASegment = Segment & {
  internalUserId: string;
  updVersion: number;
  updUsage: UpdUsage;
  userName?: string;
  extension?: string;
};

/**
 * User parameters general
 */
export class HIUPA extends SegmentDefinition {
  static Id = this.name;
  version = 4;
  elements = [
    new Identification('internalUserId', 1, 1),
    new Numeric('updVersion', 1, 1, 3),
    new Numeric('updUsage', 1, 1, 1),
    new AlphaNumeric('userName', 0, 1, 35),
    new AlphaNumeric('extension', 0, 1, 2048),
  ];
}
