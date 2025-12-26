import type { DataElement } from './dataElements/DataElement.js';

export function decodeElements(
	text: string,
	elements: DataElement[],
	separator: string,
	version: number,
	context: string,
) {
	const isResultArray = elements.length === 1 && elements[0].maxCount > 1;
	let result: any = isResultArray ? [] : {};

	const textValues = splitBySeparator(text, separator);
	let valueIndex = 0;
	let elementIndex = 0;
	let elementCount = 0;

	while (elementIndex < elements.length) {
		const element = elements[elementIndex];

		if (element.isInVersion(version)) {
			let textValue: string;

			if (separator === ':') {
				textValue = textValues
					.slice(valueIndex, valueIndex + element.maxValueCount(version))
					.join(':');
				valueIndex += element.maxValueCount(version);
			} else {
				textValue = textValues[valueIndex];
				valueIndex++;
			}

			let value;

			if (!textValue) {
				value = undefined;
				if (elementCount < element.minCount) {
					throw new Error(
						`Mandatory value is missing for element '${element.name}' in '${context}'`,
					);
				}
			} else {
				value = element.decode(textValue, version);
			}

			if (isResultArray) {
				if (element.maxCount > 1) {
					if (elements.length === 1) {
						result = [...result, value];
					} else {
						result[elementIndex] = result[elementIndex]
							? [...result[elementIndex], value]
							: [value];
					}
				} else {
					result[elementIndex] = value;
				}
			} else {
				if (element.maxCount > 1) {
					result[element.name] = result[element.name] ? [...result[element.name], value] : [value];
				} else {
					result[element.name] = value;
				}
			}
		}

		elementCount++;

		if (valueIndex >= textValues.length) {
			if (
				elements
					.slice(elementIndex + 1)
					.some((element) => element.isInVersion(version) && element.minCount > 0)
			) {
				throw new Error(
					`Not all mandatory values are present in '${context}', expected a value for element '${
						elements[elementIndex + 1].name
					}'`,
				);
			} else {
				break;
			}
		}

		if (elementCount >= element.maxCount) {
			elementIndex++;
			elementCount = 0;
		}
	}

	return result;
}

export function splitBySeparator(text: string, separator: string): string[] {
	const result: string[] = [];

	let pos = 0;

	for (let index = 0; index < text.length; index++) {
		const char = text[index];

		if (char === '@' && !isEscaped(text, index)) {
			const next = text.indexOf('@', index + 1);
			const size = Number.parseInt(text.slice(index + 1, next), 10);
			if (size) {
				index = next + size;
			}
		} else if (char === separator && !isEscaped(text, index)) {
			result.push(text.slice(pos, index));
			pos = index + 1;
		}
	}

	if (pos < text.length) {
		result.push(text.slice(pos));
	}

	return result;
}

function isEscaped(text: string, pos: number) {
	let count = 0;

	while (pos > 0 && text[pos - 1] === '?') {
		count++;
		pos--;
	}

	return count % 2 === 1;
}
