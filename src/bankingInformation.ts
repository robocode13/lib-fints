import { BPD } from './bpd.js';
import { UPD } from './upd.js';

/**
 * Information returned by the bank
 * @property systemId The system ID provided by the bank for this client/product
 * @property bpd The BPD (BankParameterDaten) contain general information
 * @property upd The UPD (UserParameterDaten) contain user-specific information like the banking accounts
 * @property bankMessages Messages from the bank which should be displayed to the user
 */
export type BankingInformation = {
  systemId: string;
  bpd?: BPD;
  upd?: UPD;
  bankMessages: BankMessage[];
};

export type BankMessage = {
  subject: string;
  text: string;
};
