import { Numeric } from '../dataElements/Numeric.js';
import { YesNo } from '../dataElements/YesNo.js';
import {
	BusinessTransactionParameter,
	type BusinessTransactionParameterSegment,
} from './businessTransactionParameter.js';

export type HIKKUSSegment = BusinessTransactionParameterSegment<HIKKUSParameter>;

export type HIKKUSParameter = {
	/** How many days back the bank keeps credit card transactions */
	storagePeriodDays: number;
	/** Whether the number of entries may be limited */
	maxEntriesAllowed: boolean;
	/** Whether a period (from/to) may be requested */
	dateRangeAllowed: boolean;
	/** Whether the request must carry the account connection in addition to the card number */
	accountRequired: boolean;
};

/**
 * Parameters for the HKKKU business transaction (credit card transactions)
 */
export class HIKKUS extends BusinessTransactionParameter {
	static Id = 'HIKKUS';
	version = 1;

	constructor() {
		super(HIKKUS.Id, [
			new Numeric('storagePeriodDays', 1, 1, 4),
			new YesNo('maxEntriesAllowed', 1, 1),
			new YesNo('dateRangeAllowed', 1, 1),
			new YesNo('accountRequired', 1, 1),
		]);
	}
}
