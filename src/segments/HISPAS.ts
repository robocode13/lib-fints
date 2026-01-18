import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Numeric } from '../dataElements/Numeric.js';
import { YesNo } from '../dataElements/YesNo.js';
import {
	BusinessTransactionParameter,
	type BusinessTransactionParameterSegment,
} from './businessTransactionParameter.js';

export type HISPASSegment = BusinessTransactionParameterSegment<HISPASParameter>;

export type HISPASParameter = {
	individualAccountRetrievalAllowed: boolean;
	nationalAccountAllowed: boolean;
	structuredPurposeAllowed: boolean;
	maxEntriesAllowed?: boolean; // version 2+
	reservedPurposePositions?: number; // version 3+
	supportedSepaFormats?: string[]; // optional, up to 99 entries
};

/**
 * Parameters for HKSPA business transaction - SEPA account connection request
 * Version 3 supports all parameters including reserved purpose positions
 */
export class HISPAS extends BusinessTransactionParameter {
	static Id = 'HISPAS';
	version = 3;

	constructor() {
		super(
			HISPAS.Id,
			[
				new YesNo('individualAccountRetrievalAllowed', 1, 1),
				new YesNo('nationalAccountAllowed', 1, 1),
				new YesNo('structuredPurposeAllowed', 1, 1),
				new YesNo('maxEntriesAllowed', 1, 1, 2), // version 2+
				new Numeric('reservedPurposePositions', 1, 1, 2, 3), // version 3+
				new AlphaNumeric('supportedSepaFormats', 0, 99, 256), // optional, up to 99 entries
			],
			1, // secClassMinVersion
		);
	}
}
