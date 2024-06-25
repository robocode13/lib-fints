import { Numeric } from '../dataElements/Numeric.js';
import { DataElement } from '../dataElements/DataElement.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type BusinessTransactionParameterSegment<TParams> = Segment & {
  maxTransactions: number;
  minSignatures: number;
  securityClass?: number;
  params: TParams;
};

/**
 * Base class for business transaction parameter segments
 */
export abstract class BusinessTransactionParameter extends SegmentDefinition {
  elements: DataElement[];

  constructor(public paramElements: DataElement[], secClassMinVersion = 1) {
    super();
    this.elements = [
      new Numeric('maxTrans', 1, 1, 3),
      new Numeric('minSigs', 1, 1, 1),
      new Numeric('secClass', 1, 1, 1, secClassMinVersion),
      new DataGroup('params', paramElements, 1, 1),
    ];
  }
}
