import { decodeElements } from './decoder.js';
import { SegmentDefinition } from './segmentDefinition.js';
import type { SegmentHeader } from './segmentHeader.js';
import { getSegmentDefinition } from './segments/registry.js';
import { type UnknownSegment, UnkownId } from './unknownSegment.js';

export type Segment = {
	header: SegmentHeader;
};

export type SegmentWithContinuationMark = Segment & {
	continuationMark?: string;
};

export function decode(text: string): Segment {
	const endMarkerIndex = text.lastIndexOf("'");
	if (endMarkerIndex === text.length - 1) {
		text = text.substring(0, text.length - 1);
	}

	const headerText = text.slice(0, text.indexOf('+'));
	const contentText = text.slice(text.indexOf('+') + 1);
	const header: SegmentHeader = SegmentDefinition.header.decode(headerText, 1) as SegmentHeader;
	const definition = getSegmentDefinition(header.segId);

	if (!definition || definition.version < header.version) {
		return <UnknownSegment>{
			header: { ...header, segId: UnkownId },
			originalId: header.segId,
			rawData: contentText,
		};
	}

	let data = decodeElements(
		contentText,
		definition.elements,
		'+',
		header.version,
		header.segId,
	) as Segment;

	data.header = header;

	if (Array.isArray(data)) {
		const object: Record<string, unknown> & Segment = { header: header };
		object[definition.elements[0].name] = data;
		data = object;
	}

	return data;
}

export function encode(data: Segment): string {
	const definition = getSegmentDefinition(data.header.segId);

	if (!definition) {
		throw new Error(`Encoding failed, no segment definition registered for '${data.header.segId}'`);
	}

	return definition.encode(data);
}

export function segmentToString(segment: Segment): string {
	const keyedSegment = segment as { [key: string]: unknown };

	const number = segment.header.segNr?.toString() ?? '?';
	const segId =
		segment.header.segId === UnkownId
			? (segment as UnknownSegment).originalId
			: segment.header.segId;

	let text = `${number.padStart(4, ' ')}. ${segId} v${segment.header.version}`;
	if (segment.header.refSegNr) {
		text += ` RefSeg: ${segment.header.refSegNr}`;
	}

	const segmentDefinition = getSegmentDefinition(segment.header.segId);

	if (!segmentDefinition) {
		return `${text} (unknown segment)`;
	}

	const texts = segmentDefinition.getElementsForVersion(segment.header.version).map((element) => {
		if (element.maxCount > 1) {
			const array = (keyedSegment[element.name] as unknown[]) ?? [];
			const texts = array.map((value: unknown) => element.toString(value));
			return texts.filter((text: string) => !!text).join('; ');
		} else {
			return element.toString(keyedSegment[element.name]);
		}
	});

	text += `; ${texts.filter((text) => !!text).join('; ')}`;
	return text;
}
