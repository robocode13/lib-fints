import type { Holding, StatementOfHoldings } from './mt535parser.js';

type Field = {
	tag: string;
	value: string;
};

export class Mt535Parser2 {
	constructor(private rawData: string) {}

	parse(): StatementOfHoldings {
		const result: StatementOfHoldings = {
			holdings: [],
		};

		const tokens = this.rawData.split(/:(\d{2}[A-Z]?):/);
		const fields: Field[] = [];

		for (let i = 1; i < tokens.length; i += 2) {
			const tag = tokens[i];
			const value = tokens[i + 1]?.trim() || '';
			fields.push({ tag, value });
		}

		const sequences = [];
		let currentSequence: string = '';
		let currentHolding: Holding | null = null;

		for (let i = 0; i < fields.length; i++) {
			const field = fields[i];

			switch (field.tag) {
				case '16R':
					currentSequence = field.value;
					sequences.push(currentSequence);

					if (currentSequence === 'FIN') {
						currentHolding = {};
						result.holdings.push(currentHolding);
					}
					break;
				case '16S':
					sequences.pop();
					currentSequence = sequences[sequences.length - 1] || '';
					break;
				case '19A': {
					const match = field.value.match(/:HOL[DPS]\/\/([A-Z]{3})(-?\d+(,\d*)?)/);
					if (match) {
						if (currentSequence === 'ADDINFO') {
							result.currency = match[1];
							result.totalValue = parseFloat(match[2].replace(',', '.'));
						} else if (currentSequence === 'FIN' && currentHolding) {
							currentHolding.currency = match[1];
							currentHolding.value = parseFloat(match[2].replace(',', '.'));
						}
					}
					break;
				}
				case '35B':
					if (currentHolding) {
						let lastIndex = 0;

						let match = field.value.match(/^ISIN (\w{12})/);
						if (match) {
							currentHolding.isin = match[1];
							lastIndex = match[0].length;
						}

						match = field.value.match(/\/[A-Z]{2}\/(\w*?)$/m);

						if (match) {
							currentHolding.wkn = match[1].trim();
							lastIndex = (match.index ?? 0) + match[0].length;
						}

						currentHolding.name = field.value.substring(lastIndex).replaceAll('\r\n', '').trim();
					}
					break;
				case '70E':
					if (currentHolding) {
						const match = field.value.match(
							/:HOLD\/\/\d(.*?)\+(.*?)\+(.*?)\+(.*?)\+(\d{4})(\d{2})(\d{2}).*?\d([\d,]+)\+([A-Z]{3})/s,
						);
						if (match) {
							currentHolding.acquisitionDate = new Date(
								`${match[5]}-${match[6]}-${match[7]}T12:00`,
							);
							currentHolding.acquisitionPrice = parseFloat(match[8].replace(',', '.'));
						}
					}
					break;
				case '93B':
					if (currentHolding) {
						const match = field.value.match(/:AGGR\/\/UNIT\/([\d,]+)/);
						if (match) {
							currentHolding.amount = parseFloat(match[1].replace(',', '.'));
						}
					}
					break;
				case '90B':
					if (currentHolding) {
						const match = field.value.match(/:MRKT\/\/ACTU\/([A-Z]{3})([\d,]+)/);
						if (match) {
							currentHolding.price = parseFloat(match[2].replace(',', '.'));
							currentHolding.currency = match[1];
						}
					}
					break;
				case '98C':
					if (currentHolding) {
						const matchDate = field.value.match(
							/:PRIC\/\/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,
						);
						if (matchDate) {
							currentHolding.date = new Date(
								`${matchDate[1]}-${matchDate[2]}-${matchDate[3]}T${matchDate[4]}:${matchDate[5]}:${matchDate[6]}`,
							);
						}
					}
					break;
			}
		}

		return result;
	}
}
