import { encodeElements } from './encoder.js';
import { DataElement } from './dataElements/DataElement.js';
import { Segment } from './segment.js';
import { SegmentHeaderGroup } from './segmentHeader.js';

export abstract class SegmentDefinition {
  id = this.constructor.name;

  abstract version: number;
  static header = new SegmentHeaderGroup();
  abstract elements: DataElement[];

  encode(data: Segment) {
    const headerText = SegmentDefinition.header.encode(data.header, [data.header.segId], data.header.version);
    const elementsText = encodeElements(data, this.elements, '+', data.header.version, [data.header.segId]);
    return `${headerText}+${elementsText}'`;
  }
}
