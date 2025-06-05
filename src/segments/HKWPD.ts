import { SegmentHeader } from '../segmentHeader.js';
import { Account, AccountGroup } from '../dataGroups/Account.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Numeric } from '../dataElements/Numeric.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKWPDSegment = {
  header: SegmentHeader;
  /**
   * Depot
   */
  depot: Account;
  /**
   * Optional: Currency of the portfolio statement
   */
  currency?: string;
  /**
   * Optional: Price quality
   * 1 = Current prices (Realtime)
   * 2 = Delayed prices (Delayed)
   */
  priceQuality?: '1' | '2';
  /**
   * Optional: Maximum number of entries
   */
  maxEntries?: number;
  /**
   * Pagination marker
   * Optional: If a pagination marker was previously returned
   */
  paginationMarker?: string;
};

/**
 * Geschäftsvorfälle: C.4.3.1 Depotaufstellung
 * Version: 6
 */
export class HKWPD extends SegmentDefinition {
  static Id = this.name;
  static Version = 6;
  version = HKWPD.Version;
  elements = [
    new AccountGroup('depot', 1, 1),
    new AlphaNumeric('currency', 0, 1, 3),
    new AlphaNumeric('priceQuality', 0, 1, 1),
    new Numeric('maxEntries', 0, 1, 4),
    new AlphaNumeric('paginationMarker', 0, 1, 35),
  ];
}
