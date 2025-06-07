import { Language } from '../codes.js';
import { Numeric } from '../dataElements/Numeric.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Bank } from '../dataGroups/Account.js';
import { BankIdentification } from '../dataGroups/BankIdentification.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HIKOMSegment = Segment & {
	bankIdentification: Bank;
	defaultLanguage: Language;
	comParams: ComParams;
};

export type ComParams = {
	service: number;
	address: string;
	addressExt?: string;
	filter?: string;
	filterVer?: string;
};

/**
 *
 */
export class HIKOM extends SegmentDefinition {
	static Id = 'HIKOM';
	version = 4;
	constructor() {
		super(HIKOM.Id);
	}
	elements = [
		new BankIdentification('bank', 1, 1),
		new Numeric('defLang', 1, 1, 3),
		new DataGroup(
			'comParams',
			[
				new Numeric('service', 1, 1, 2),
				new AlphaNumeric('address', 1, 1, 512),
				new AlphaNumeric('addressExt', 0, 1, 512),
				new AlphaNumeric('filter', 0, 1, 3),
				new Numeric('filterVer', 0, 1, 3),
			],
			1,
			1
		),
	];
}
