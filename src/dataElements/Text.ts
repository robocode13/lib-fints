import { DataElement } from './DataElement.js';
import { finTsDecode, finTsEncode } from '../format.js';

export class Text extends DataElement {
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
			throw Error('a Text value must not exceed its maximum length');
		}

		return finTsEncode(value.trim());
	}

	decode(text: string) {
		return finTsDecode(text);
	}
}
