import { Text } from './dataElements/Text.js';
import { Segment } from './segment.js';
import { SegmentDefinition } from './segmentDefinition.js';

export type UnknownSegment = Segment & {
  originalId: string;
  rawData: string;
};

export class UNKNOW extends SegmentDefinition {
  static Id = this.name;
  version = 1;
  elements = [new Text('rawData', 0, 1)];
}

export const UnkownId = UNKNOW.Id;
