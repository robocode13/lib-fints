import { TanMediaClass, TanMediaType } from '../codes.js';
import { Numeric } from '../dataElements/Numeric.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKTABSegment = Segment & {
  mediaType: TanMediaType;
  mediaClass: TanMediaClass;
};

/**
 * Request TAN media
 */
export class HKTAB extends SegmentDefinition {
  static Id = this.name;
  static Version = 5;
  version = HKTAB.Version;
  elements = [new Numeric('mediaType', 1, 1, 1), new AlphaNumeric('mediaClass', 1, 1, 1)];
}
