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

	/**
	 * A binary value arrives as `@<length>@<data>`. The length is authoritative: it is the
	 * only thing that tells data apart from the separators and escape characters that a
	 * binary payload — a PDF, for instance — is full of. Returning everything after the
	 * second `@` instead would hand out whatever the bank appended between the end of the
	 * data and the next separator.
	 */
	decode(text: string) {
		if (text[0] !== '@') {
			// Not length-prefixed — nothing to go by, take it as it is.
			return text;
		}

		const lengthEnd = text.indexOf('@', 1);
		if (lengthEnd < 0) {
			return text;
		}

		const dataStart = lengthEnd + 1;
		const length = Number.parseInt(text.slice(1, lengthEnd), 10);

		return Number.isNaN(length) ? text.slice(dataStart) : text.slice(dataStart, dataStart + length);
	}
}
