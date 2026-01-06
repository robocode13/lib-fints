import { AlphaNumeric } from './AlphaNumeric.js';

export class Identification extends AlphaNumeric {
	constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(name, minCount, maxCount, 30, minVersion, maxVersion);
	}
}
