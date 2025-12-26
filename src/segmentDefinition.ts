import { encodeElements } from './encoder.js';
import { DataElement } from './dataElements/DataElement.js';
import { Segment } from './segment.js';
import { SegmentHeaderGroup } from './segmentHeader.js';

export abstract class SegmentDefinition {
	id: string;

	constructor(id: string) {
		this.id = id;
	}

	abstract version: number;
	static header = new SegmentHeaderGroup();
	abstract elements: DataElement[];

	getElementsForVersion(version: number) {
		return this.elements.filter(
			(element) =>
				version >= (element.minVersion ?? 0) &&
				version <= (element.maxVersion ?? Number.MAX_SAFE_INTEGER),
		);
	}

	encode(data: Segment) {
		const headerText = SegmentDefinition.header.encode(
			data.header,
			[data.header.segId],
			data.header.version,
		);
		const elementsText = encodeElements(data, this.elements, '+', data.header.version, [
			data.header.segId,
		]);
		return `${headerText}+${elementsText}'`;
	}
}
