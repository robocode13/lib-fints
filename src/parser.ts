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
