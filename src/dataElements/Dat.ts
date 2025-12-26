import { DataElement } from './DataElement.js';

export class Dat extends DataElement {
	constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(name, minCount, maxCount, minVersion, maxVersion);
	}

	encode(value: Date): string {
		if (!value) {
			return '';
		}
		return value.toISOString().substring(0, 10).replaceAll('-', '');
	}

	decode(text: string): Date {
		return new Date(`${text.substring(0, 4)}-${text.substring(4, 6)}-${text.substring(6)}`);
	}

	toString(value: Date) {
		return super.toString(value?.toDateString());
	}
}
