import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Numeric } from '../dataElements/Numeric.js';
import { YesNo } from '../dataElements/YesNo.js';
import { DataGroup } from './DataGroup.js';

export type SepaAccountParameters = {
	individualAccountRetrievalAllowed: boolean;
	nationalAccountAllowed: boolean;
	structuredPurposeAllowed: boolean;
	maxEntriesAllowed?: boolean; // version 2+
	reservedPurposePositions?: number; // version 3+
	supportedSepaFormats?: string[]; // optional, up to 99 entries
};

export class SepaAccountParametersGroup extends DataGroup {
	constructor(name: string, minCount = 1, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(
			name,
			[
				new YesNo('individualAccountRetrievalAllowed', 1, 1),
				new YesNo('nationalAccountAllowed', 1, 1),
				new YesNo('structuredPurposeAllowed', 1, 1),
				new YesNo('maxEntriesAllowed', 1, 1, 2), // version 2+
				new Numeric('reservedPurposePositions', 1, 1, 2, 3), // version 3+
				new AlphaNumeric('supportedSepaFormats', 0, 99, 256), // optional, up to 99 entries
			],
			minCount,
			maxCount,
			minVersion,
			maxVersion,
		);
	}
}
