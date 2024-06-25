import { Binary } from '../dataElements/Binary.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';
import { SegmentHeader } from '../segmentHeader.js';

export type HNVSDSegment = Segment & {
  header: SegmentHeader & { segNr: 999 };
  encryptedData: string;
};

/**
 * Encrypted data
 */
export class HNVSD extends SegmentDefinition {
  static Id = this.name;
  static Version = 1;
  version = HNVSD.Version;
  elements = [new Binary('encryptedData', 1, 1)];
}
