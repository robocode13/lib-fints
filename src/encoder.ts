import type { DataElement } from './dataElements/DataElement.js';

export function encodeElements(
	values: any,
	elements: DataElement[],
	separator: string,
	version: number,
	context: string[],
): string {
	const isArray = Array.isArray(values);

	if (
		!values ||
		(isArray && values.length === 0) ||
		(!isArray && Object.keys(values).length === 0)
	) {
		if (context.length >= 3) {
			return separator.repeat(
				elements.reduce((sum, element) => sum + element.maxValueCount(version), 0) - 1,
			);
		}
		return '';
	}

	if (isArray && values.length !== elements.length) {
		throw new Error(
			`Values to encode don't match number of elements (${values.length} <> ${
				elements.length
			}) when encoding '${context.join('->')}'`,
		);
	}

	const textValues = [];
	let elementIndex = 0;

	while (elementIndex < elements.length) {
		const element = elements[elementIndex];

		if (!element.isInVersion(version)) {
			elementIndex++;
			continue;
		}

		if (isArray) {
			if (elementIndex >= values.length) {
				if (elementIndex < element.minCount) {
					throw new Error(
						`There are not enough values for all mandatory elements when encoding '${context.join('->')}'`,
					);
				}
			}
			if (element.maxCount > 1) {
				textValues.push(
					values[elementIndex]
						?.map((value: any) => element.encode(value, context, version))
						.join(separator),
				);
			} else {
				textValues.push(element.encode(values[elementIndex], context, version));
			}
		} else {
			if (element.maxCount > 1) {
				textValues.push(
					values[element.name]
						?.map((value: any) => element.encode(value, context, version))
						.join(separator),
				);
			} else {
				textValues.push(element.encode(values[element.name], context, version));
			}
		}

		elementIndex++;
	}

	if (context.length < 3) {
		textValues.splice(textValues.findLastIndex((text) => !!text && text !== ':') + 1);
	}

	return textValues.join(separator);
}
