import {
	BusinessTransactionParameter,
	BusinessTransactionParameterSegment,
} from './businessTransactionParameter.js';
import {
	SepaAccountParameters,
	SepaAccountParametersGroup,
} from '../dataGroups/SepaAccountParameters.js';

export type HISPASSegment = BusinessTransactionParameterSegment<SepaAccountParameters>;

export type HISPASParameter = SepaAccountParameters;

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
			[new SepaAccountParametersGroup('sepaAccountParams', 1, 1)],
			1, // secClassMinVersion
		);
	}
}
