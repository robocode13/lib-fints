import { SyncMode } from '../codes.js';
import { Numeric } from '../dataElements/Numeric.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKSYNSegment = Segment & {
  mode: SyncMode;
};

/**
 * Synchonisation
 */
export class HKSYN extends SegmentDefinition {
  static Id = this.name;
  static Version = 3;
  version = HKSYN.Version;
  elements = [new Numeric('mode', 1, 1, 1)];
}
