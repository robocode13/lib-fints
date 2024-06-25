import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { DataGroup } from './DataGroup.js';
import { Identification } from '../dataElements/Identification.js';
import { BankIdentification } from './BankIdentification.js';
import { Bank } from './Account.js';

export type InternationalAccount = {
  iban?: string;
  bic?: string;
  accountNumber?: string;
  subAccountId?: string;
  bank?: Bank;
};

export class InternationalAccountGroup extends DataGroup {
  constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
    super(
      name,
      [
        new AlphaNumeric('iban', 0, 1, 34),
        new AlphaNumeric('bic', 0, 1, 11),
        new Identification('accountNumber', 0, 1),
        new Identification('subAccountId', 0, 1),
        new BankIdentification('bank', 0, 1),
      ],
      minCount,
      maxCount,
      minVersion,
      maxVersion
    );
  }
}
