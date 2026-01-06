import { Numeric } from '../dataElements/Numeric.js';
import { YesNo } from '../dataElements/YesNo.js';
import {
	BusinessTransactionParameter,
	type BusinessTransactionParameterSegment,
} from './businessTransactionParameter.js';

export type HKKAZSegment = BusinessTransactionParameterSegment<HIKAZSParameter>;

export type HIKAZSParameter = {
	maxDays: number;
	entryCountAllowed: boolean;
	allAccountsAllowed: boolean;
};

/**
 * Parameters for HKKAZ business transaction
 */
export class HIKAZS extends BusinessTransactionParameter {
	static Id = 'HIKAZS';
	version = 7;

	constructor() {
		super(
			HIKAZS.Id,
			[
				new Numeric('maxDays', 1, 1, 4),
				new YesNo('entryCountAllowed', 1, 1),
				new YesNo('allAccountsAllowed', 1, 1, 5),
			],
			6,
		);
	}
}
