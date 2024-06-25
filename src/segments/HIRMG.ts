import { Digits } from '../dataElements/Digits.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HIRMGSegment = Segment & {
  answers: Answer[];
};

export type Answer = {
  code: number;
  refElement?: string;
  text: string;
  params?: string[];
};

/**
 * Responses to the message
 */
export class HIRMG extends SegmentDefinition {
  static Id = this.name;
  static Version = 2;
  version = HIRMG.Version;
  elements = [
    new DataGroup(
      'answers',
      [
        new Digits('code', 1, 1, 4),
        new AlphaNumeric('refElement', 0, 1, 7),
        new AlphaNumeric('text', 1, 1, 80),
        new AlphaNumeric('params', 0, 10, 35),
      ],
      1,
      99
    ),
  ];
}
