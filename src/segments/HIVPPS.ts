import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Numeric } from '../dataElements/Numeric.js';
import { YesNo } from '../dataElements/YesNo.js';
import {
	BusinessTransactionParameter,
	type BusinessTransactionParameterSegment,
} from './businessTransactionParameter.js';

export type HIVPPSSegment = BusinessTransactionParameterSegment<HIVPPSParameter>;

export type HIVPPSParameter = {
	/** The largest number of transactions in a batch that may be checked (opt-in) */
	maxOptInTransactions: number;
	/** Whether the notice text may contain formatting tags (<br>, <b>, <ul> and the like) */
	noticeStructured: boolean;
	/** How a pain.002 spread over several polls arrives: V complete each time, S in steps */
	reportDelivery: string;
	/** Whether a batch with a single transaction is allowed */
	batchWithSingleOrderAllowed: boolean;
	/** Whether HKVPP may limit the number of entries */
	entryCountAllowed: boolean;
	/** The pain.002 format the bank reports results in */
	supportedReportFormats: string;
	/** The payment orders that must be checked, by segment ID, such as HKCCS */
	vopRequiredTransactions: string[];
};

/**
 * Parameters for the HKVPP business transaction (Verification of Payee), DK VoP spec C.10.7
 */
export class HIVPPS extends BusinessTransactionParameter {
	static Id = 'HIVPPS';
	version = 1;

	constructor() {
		super(HIVPPS.Id, [
			new Numeric('maxOptInTransactions', 1, 1, 7),
			new YesNo('noticeStructured', 1, 1),
			new AlphaNumeric('reportDelivery', 1, 1, 1),
			new YesNo('batchWithSingleOrderAllowed', 1, 1),
			new YesNo('entryCountAllowed', 1, 1),
			new AlphaNumeric('supportedReportFormats', 1, 1, 1024),
			new AlphaNumeric('vopRequiredTransactions', 1, 999, 6),
		]);
	}
}
