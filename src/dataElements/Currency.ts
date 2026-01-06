import { AlphaNumeric } from './AlphaNumeric.js';

export class Currency extends AlphaNumeric {
	constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(name, minCount, maxCount, 3, minVersion, maxVersion);
	}
}
