import { DataGroup } from './DataGroup.js';
import { Identification } from '../dataElements/Identification.js';

export class CreditCardAccountGroup extends DataGroup {
  constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
    super(
      name,
      [
        new Identification('accountNumber', 1, 1),
        new Identification('subAccountId', 0, 1),
      ],
      minCount,
      maxCount,
      minVersion,
      maxVersion
    );
  }
}
