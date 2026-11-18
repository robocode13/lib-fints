export function splitBySeparator(text: string, separator: string): string[] {
	const result: string[] = [];

	let pos = 0;

	for (let index = 0; index < text.length; index++) {
		const char = text[index];

		// Read from left to right, so that a ? inside binary data, which is skipped as a
		// whole, does not escape the separator after it
		if (char === '?') {
			index++;
		} else if (char === '@') {
			const next = text.indexOf('@', index + 1);
			const size = Number.parseInt(text.slice(index + 1, next), 10);
			if (size) {
				index = next + size;
			}
		} else if (char === separator) {
			result.push(text.slice(pos, index));
			pos = index + 1;
		}
	}

	if (pos < text.length) {
		result.push(text.slice(pos));
	}

	return result;
}
