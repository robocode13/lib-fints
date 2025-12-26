import { DataElement } from './DataElement.js';

export class Time extends DataElement {
	constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(name, minCount, maxCount, minVersion, maxVersion);
	}

	encode(value: Date): string {
		if (!value) {
			return '';
		}
		return value.toISOString().substring(11, 19).replaceAll(':', '');
	}

	decode(text: string): Date {
		return new Date(
			`1970-01-01T${text.substring(0, 2)}:${text.substring(2, 4)}:${text.substring(4)}Z`,
		);
	}

	toString(value: Date) {
		return super.toString(value?.toTimeString());
	}
}
