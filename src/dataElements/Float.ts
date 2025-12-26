import { DataElement } from './DataElement.js';

export class Float extends DataElement {
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
		if (value < 0) {
			throw Error(`the Float value '${this.name}' must be positive`);
		}

		if (this.maxLength && value.toString().length > this.maxLength) {
			throw Error(`the Float value '${this.name}' must not exceed its maximum length`);
		}

		const text = value.toString().replace('.', ',');
		return text.indexOf(',') >= 0 ? text : text + ',';
	}

	decode(text: string) {
		return Number.parseFloat(text.replace(',', '.'));
	}
}
