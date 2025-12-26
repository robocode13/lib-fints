import { DataElement } from './DataElement.js';

export class Numeric extends DataElement {
	constructor(
		name: string,
		minCount = 0,
		maxCount = 1,
		public maxLength?: number,
		minVersion?: number,
		maxVersion?: number,
	) {
		super(name, minCount, maxCount, minVersion, maxVersion);
	}

	encode(value: number): string {
		if (value === undefined || value === null) {
			return '';
		}

		if (!Number.isInteger(value) || value < 0) {
			throw Error(`the Numeric value '${this.name}' must be a positive integer`);
		}

		if (this.maxLength && value.toString().length > this.maxLength) {
			throw Error(`the Numeric value '${this.name}' must not exceed its maximum length`);
		}

		return value.toString();
	}

	decode(text: string) {
		return Number.parseInt(text);
	}

	static decode(text: string): number {
		return Number.parseInt(text);
	}
}
