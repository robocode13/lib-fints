export function finTsEncode(value: string): string {
	return value.replace(/([\?:\+'@])/g, '?$1');
}

export function finTsDecode(value: string): string {
	return value.replace(/\?([\?:\+'@])/g, '$1');
}
