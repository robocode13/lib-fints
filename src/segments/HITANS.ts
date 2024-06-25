import { TanMediaRequirement } from '../codes.js';
import { YesNo } from '../dataElements/YesNo.js';
import { Numeric } from '../dataElements/Numeric.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Identification } from '../dataElements/Identification.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { BusinessTransactionParameter, BusinessTransactionParameterSegment } from './businessTransactionParameter.js';

export type HITANSSegment = BusinessTransactionParameterSegment<HITANSParameter>;

export type HITANSParameter = {
  oneStepAllowed: boolean;
  multipleTansactions: boolean;
  hashMethod: number;
  tanMethods: HitansTanMethod[];
};

export type HitansTanMethod = {
  secFunc: number;
  tanProcess: number;
  methodId: string;
  zkaMethod: string;
  zkaVersion: string;
  methodName: string;
  tanMaxLen: number;
  format: number;
  challengeText: string;
  maxChallengeLen: number;
  multipleTans: boolean;
  tanDialogOptions: number;
  cancellation: boolean;
  smsAccountRequired: number;
  customerAccountRequired: number;
  challengeClass: boolean;
  challengeStructured: boolean;
  initMode: string;
  tanMediaRequired: TanMediaRequirement;
  hdducRequired: boolean;
  activeTanMedia: number;
};

/**
 * Parameters for two-step TAN methods
 */
export class HITANS extends BusinessTransactionParameter {
  static Id = this.name;
  version = 6;

  constructor() {
    super([
      new YesNo('oneStepAllowed', 1, 1),
      new YesNo('multipleTansactions', 1, 1),
      new Numeric('hashMethod', 1, 1, 1),
      new Numeric('secProfile', 1, 1, 1, 1, 1),
      new DataGroup(
        'tanMethods',
        [
          new Numeric('secFunc', 1, 1, 3, 1),
          new Numeric('tanProcess', 1, 1, 1, 1),
          new Identification('methodId', 1, 1, 1),
          new AlphaNumeric('zkaMethod', 0, 1, 32, 4),
          new AlphaNumeric('zkaVersion', 0, 1, 10, 4),
          new AlphaNumeric('methodName', 1, 1, 30, 1),
          new Numeric('tanMaxLen', 1, 1, 2, 1),
          new Numeric('format', 1, 1, 1, 1),
          new AlphaNumeric('challengeText', 1, 1, 30, 1),
          new Numeric('maxChallengeLen', 1, 1, 4, 1),
          new Numeric('supportedActiveTanLists', 0, 1, 1, 1, 5),
          new YesNo('multipleTans', 1, 1, 1),
          new YesNo('tanDelayedAllowed', 1, 1, 1, 1),
          new Numeric('tanDialogOptions', 1, 1, 1, 2),
          new Numeric('tanListNrRequired', 1, 1, 1, 2, 5),
          new YesNo('cancellation', 1, 1, 2),
          new Numeric('smsAccountRequired', 1, 1, 1, 4),
          new Numeric('customerAccountRequired', 1, 1, 1, 5),
          new YesNo('challengeClass', 1, 1, 2),
          new YesNo('challengeAmountRequired', 1, 1, 2, 4),
          new YesNo('challengeStructured', 1, 1, 4),
          new AlphaNumeric('initMode', 1, 1, 2, 3),
          new Numeric('tanMediaRequired', 1, 1, 1, 3),
          new YesNo('hdducRequired', 1, 1, 6),
          new Numeric('activeTanMedia', 0, 1, 1, 3),
        ],
        1,
        98
      ),
    ]);
  }
}
