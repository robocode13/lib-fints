import { Float } from './Float.js';

export class Amount extends Float {
	constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(name, minCount, maxCount, 15, minVersion, maxVersion);
	}
}
