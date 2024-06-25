import { Identification } from '../dataElements/Identification.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKENDSegment = Segment & {
  dialogId: string;
};

/**
 * Dialog end
 */
export class HKEND extends SegmentDefinition {
  static Id = this.name;
  static Version = 1;
  version = HKEND.Version;
  elements = [new Identification('dialogId', 1, 1)];
}
