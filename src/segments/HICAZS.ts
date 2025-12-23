import { YesNo } from '../dataElements/YesNo.js';
import { Numeric } from '../dataElements/Numeric.js';
import { BusinessTransactionParameter, BusinessTransactionParameterSegment } from './businessTransactionParameter.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';

export type HICAZSSegment = BusinessTransactionParameterSegment<HICAZSParameter>;

export type HICAZSParameter = {
	maxDays: number;
	entryCountAllowed: boolean;
	allAccountsAllowed: boolean;
	supportedCamtFormats: string[];
};

/**
 * Parameters for HKCAZ business transaction (CAMT format statement retrieval)
 */
export class HICAZS extends BusinessTransactionParameter {
	static Id = 'HICAZS';
	version = 1;

	constructor() {
		super(HICAZS.Id, [
			new Numeric('maxDays', 1, 1, 4),
			new YesNo('maxEntryCountAllowed', 1, 1),
			new YesNo('allAccountsAllowed', 1, 1),
			new AlphaNumeric('supportedCamtFormats', 1, 99),
		]);
	}
}
