import { YesNo } from '../dataElements/YesNo.js';
import { Numeric } from '../dataElements/Numeric.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { BusinessTransactionParameter, BusinessTransactionParameterSegment } from './businessTransactionParameter.js';

export type HIPINSSegment = BusinessTransactionParameterSegment<HIPINSParameter>;

export type HIPINSParameter = {
  minPinLen: number;
  maxPinLen: number;
  maxTanLen: number;
  textUserId: string;
  textCustomerId: string;
  transactions: PinTanTransaction[];
};

export type PinTanTransaction = {
  transId: string;
  tanRequired: boolean;
};

/**
 * Parameters for PIN/TAN method
 */
export class HIPINS extends BusinessTransactionParameter {
  static Id = this.name;
  version = 1;

  constructor() {
    super([
      new Numeric('minPinLen', 0, 1, 2),
      new Numeric('maxPinLen', 0, 1, 2),
      new Numeric('maxTanLen', 0, 1, 2),
      new AlphaNumeric('textUserId', 0, 1, 30),
      new AlphaNumeric('textCustomerId', 0, 1, 30),
      new DataGroup('transactions', [new AlphaNumeric('transId', 1, 1, 6), new YesNo('tanRequired', 1, 1)], 0, 999),
    ]);
  }
}
