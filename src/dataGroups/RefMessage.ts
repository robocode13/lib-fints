import { Numeric } from '../dataElements/Numeric.js';
import { DataGroup } from './DataGroup.js';
import { Identification } from '../dataElements/Identification.js';

export type RefMessage = {
  dialogId: string;
  msgNr: number;
};

export class RefMessageGroup extends DataGroup {
  constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
    super(
      name,
      [new Identification('dialogId', 1, 1), new Numeric('msgNr', 1, 1, 4)],
      minCount,
      maxCount,
      minVersion,
      maxVersion
    );
  }
}
