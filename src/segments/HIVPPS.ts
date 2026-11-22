import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Numeric } from '../dataElements/Numeric.js';
import { YesNo } from '../dataElements/YesNo.js';
import {
	BusinessTransactionParameter,
	type BusinessTransactionParameterSegment,
} from './businessTransactionParameter.js';

export type HIVPPSSegment = BusinessTransactionParameterSegment<HIVPPSParameter>;

export type HIVPPSParameter = {
	maxEntriesOptIn: number;
	infoTextFormatted: boolean;
	reportDelivery: string;
	multipleAllowed: boolean;
	entryCountAllowed: boolean;
	/** Supported payment status report formats, separated by ';' */
	supportedReports: string;
	/** The payment orders (HK...) that need a name check */
	orders?: string[];
};

/**
 * Parameters for HKVPP - Verification of Payee
 */
export class HIVPPS extends BusinessTransactionParameter {
	static Id = 'HIVPPS';
	version = 1;

	constructor() {
		super(HIVPPS.Id, [
			new Numeric('maxEntriesOptIn', 1, 1, 7),
			new YesNo('infoTextFormatted', 1, 1),
			new AlphaNumeric('reportDelivery', 1, 1, 1),
			new YesNo('multipleAllowed', 1, 1),
			new YesNo('entryCountAllowed', 1, 1),
			new AlphaNumeric('supportedReports', 1, 1, 1024),
			new AlphaNumeric('orders', 0, 999, 6),
		]);
	}
}
