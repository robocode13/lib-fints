import { Digits } from './Digits.js';

export class Country extends Digits {
	constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(name, minCount, maxCount, 3, minVersion, maxVersion);
	}
}
