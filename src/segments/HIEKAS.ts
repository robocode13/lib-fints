import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { YesNo } from '../dataElements/YesNo.js';
import {
	BusinessTransactionParameter,
	type BusinessTransactionParameterSegment,
} from './businessTransactionParameter.js';

export type HIEKASSegment = BusinessTransactionParameterSegment<HIEKASParameter>;

export type HIEKASParameter = {
	/** Whether a specific statement may be requested by number and year */
	indexAllowed: boolean;
	/** Whether the bank expects each fetched statement to be acknowledged with its receipt */
	receiptRequired: boolean;
	/** Whether the number of entries may be limited */
	maxEntryCountAllowed: boolean;
	/** The statement formats the bank supports, see StatementFormat */
	supportedFormats: string[];
};

/**
 * Parameters for the HKEKA business transaction (electronic account statements)
 */
export class HIEKAS extends BusinessTransactionParameter {
	static Id = 'HIEKAS';
	version = 5;

	constructor() {
		super(HIEKAS.Id, [
			new YesNo('indexAllowed', 1, 1),
			new YesNo('receiptRequired', 1, 1),
			new YesNo('maxEntryCountAllowed', 1, 1),
			new AlphaNumeric('supportedFormats', 1, 9, 1),
		]);
	}
}
