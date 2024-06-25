import { Numeric } from './dataElements/Numeric.js';
import { AlphaNumeric } from './dataElements/AlphaNumeric.js';
import { DataGroup } from './dataGroups/DataGroup.js';

export type SegmentHeader = {
  segId: string;
  segNr: number;
  version: number;
  refSegNr?: number;
};

export class SegmentHeaderGroup extends DataGroup {
  constructor() {
    super(
      'segHeader',
      [
        new AlphaNumeric('segId', 1, 1, 6),
        new Numeric('segNr', 1, 1, 3),
        new Numeric('version', 1, 1, 3),
        new Numeric('refSegNr', 0, 1, 3),
      ],
      1,
      1
    );
  }
}
