import { DataElement } from './DataElement.js';

export class Binary extends DataElement {
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

	encode(value: string): string {
		if (!value) {
			return '';
		}

		if (this.maxLength && value.length > this.maxLength) {
			throw Error(`the Binary value '${this.name}' must not exceed its maximum length`);
		}

		return `@${value.length}@${value}`;
	}

	decode(text: string) {
		return text.slice(text.indexOf('@', 1) + 1);
	}
}
