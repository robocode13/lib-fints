import { describe, expect, it } from 'vitest';
import { Mt535Parser } from '../mt535parser.js';

describe('Mt535Parser', () => {
	it('handles empty input', () => {
		const parser = new Mt535Parser('');
		const statement = parser.parse();
		expect(statement.totalValue).toBeUndefined();
		expect(statement.holdings).toHaveLength(0);
	});

	it('parses holding with :90A:: percentage price (bonds)', () => {
		const input =
			':16R:FIN\r\n' +
			':35B:ISIN DE0001102580\r\n' +
			'/DE/110258\r\n' +
			'BUNDESREP.DEUTSCHLAND ANL.V.2021\r\n' +
			':90A::MRKT//PRCT/98,50\r\n' +
			':93B::AGGR//UNIT/10000,\r\n' +
			':19A::HOLD//EUR9850,00\r\n' +
			':16S:FIN\r\n';

		const parser = new Mt535Parser(input);
		const statement = parser.parse();

		expect(statement.holdings).toHaveLength(1);
		const holding = statement.holdings[0];
		expect(holding.isin).toBe('DE0001102580');
		expect(holding.wkn).toBe('110258');
		expect(holding.currency).toBe('%');
		expect(holding.price).toBe(0.985);
		expect(holding.amount).toBe(10000);
		expect(holding.value).toBe(9850);
	});

	it('parses holding with :90B:: absolute price', () => {
		const input =
			':16R:FIN\r\n' +
			':35B:ISIN DE0005190003\r\n' +
			'/DE/519000\r\n' +
			'BAY.MOTOREN WERKE AG ST\r\n' +
			':90B::MRKT//ACTU/EUR89,50\r\n' +
			':93B::AGGR//UNIT/50,\r\n' +
			':19A::HOLD//EUR4475,00\r\n' +
			':16S:FIN\r\n';

		const parser = new Mt535Parser(input);
		const statement = parser.parse();

		const holding = statement.holdings[0];
		expect(holding.isin).toBe('DE0005190003');
		expect(holding.currency).toBe('EUR');
		expect(holding.price).toBe(89.5);
		expect(holding.amount).toBe(50);
		expect(holding.value).toBe(4475);
	});

	it('parses 98A date-only field', () => {
		const input =
			':16R:FIN\r\n' +
			':35B:ISIN DE0007164600\r\n' +
			'/DE/716460\r\n' +
			'SAP SE\r\n' +
			':98A::SETT//20231215\r\n' +
			':16S:FIN\r\n';

		const parser = new Mt535Parser(input);
		const statement = parser.parse();

		const holding = statement.holdings[0];
		expect(holding.date).toEqual(new Date('2023-12-15T12:00'));
	});

	it('parses 98C date-time field', () => {
		const input =
			':16R:FIN\r\n' +
			':35B:ISIN DE0007164600\r\n' +
			'/DE/716460\r\n' +
			'SAP SE\r\n' +
			':98C::PRIC//20240115093045\r\n' +
			':16S:FIN\r\n';

		const parser = new Mt535Parser(input);
		const statement = parser.parse();

		const holding = statement.holdings[0];
		expect(holding.date).toEqual(new Date(2024, 0, 15, 9, 30, 45));
	});

	it('parses holding with minimal data (only ISIN)', () => {
		const input =
			':16R:FIN\r\n' + ':35B:ISIN FR0000120271\r\n' + 'AIR LIQUIDE SA\r\n' + ':16S:FIN\r\n';

		const parser = new Mt535Parser(input);
		const statement = parser.parse();

		expect(statement.holdings).toHaveLength(1);
		const holding = statement.holdings[0];
		expect(holding.isin).toBe('FR0000120271');
		expect(holding.name).toBe('AIR LIQUIDE SA');
		expect(holding.price).toBeUndefined();
		expect(holding.amount).toBeUndefined();
	});

	it('parses DKB statement correctly', () => {
		const input =
			':16R:GENL\r\n' +
			':28E:1/ONLY\r\n' +
			':20C::SEME//NONREF\r\n' +
			':23G:NEWM\r\n' +
			':98C::PREP//20260110153747\r\n' +
			':98A::STAT//20260110\r\n' +
			':22F::STTY//CUST\r\n' +
			':97A::SAFE//12030000/123456789\r\n' +
			':17B::ACTI//Y\r\n' +
			':16S:GENL\r\n' +
			':16R:FIN\r\n' +
			':35B:ISIN LU0950674332\r\n' +
			'/DE/A1W3CQ\r\n' +
			'UBS MSCI WORLD SOC.RES. NAMENS-ANTE\r\n' +
			'ILE A ACC. USD O.N.\r\n' +
			':90B::MRKT//ACTU/EUR33,22\r\n' +
			':98C::PRIC//20260109210244\r\n' +
			':93B::AGGR//UNIT/652,\r\n' +
			':16R:SUBBAL\r\n' +
			':93C::TAVI//UNIT/AVAI/652,\r\n' +
			':16S:SUBBAL\r\n' +
			':19A::HOLD//EUR18669,64\r\n' +
			':70E::HOLD//1STK++++20220902\r\n' +
			'221,2012438+EUR\r\n' +
			':16S:FIN\r\n' +
			':16R:ADDINFO\r\n' +
			':19A::HOLP//EUR18669,64\r\n' +
			':16S:ADDINFO\r\n';

		const parser = new Mt535Parser(input);
		const statement = parser.parse();

		expect(statement.totalValue).toBe(18669.64);
		expect(statement.currency).toBe('EUR');
		expect(statement.holdings).toHaveLength(1);
		const holding = statement.holdings[0];
		expect(holding.isin).toBe('LU0950674332');
		expect(holding.wkn).toBe('A1W3CQ');
		expect(holding.name).toBe('UBS MSCI WORLD SOC.RES. NAMENS-ANTE/ILE A ACC. USD O.N.');
		expect(holding.acquisitionDate).toEqual(new Date('2022-09-02T12:00'));
		expect(holding.acquisitionPrice).toBe(21.2012438);
		expect(holding.amount).toBe(652);
		expect(holding.price).toBe(33.22);
		expect(holding.currency).toBe('EUR');
		expect(holding.value).toBe(18669.64);
		expect(holding.date).toEqual(new Date(2026, 0, 9, 21, 2, 44));
	});

	it('parses Baader statement correctly', () => {
		const input =
			':16R:GENL\r\n' +
			':28E:1/ONLY\r\n' +
			':20C::SEME//NONREF\r\n' +
			':23G:NEWM\r\n' +
			':98A::PREP//20260108\r\n' +
			':98A::STAT//20260108\r\n' +
			':22F::STTY//CUST\r\n' +
			':97A::SAFE//70033100/12345678\r\n' +
			':17B::ACTI//Y\r\n' +
			':16S:GENL\r\n' +
			':16R:FIN\r\n' +
			':35B:ISIN IE000UQND7H4\r\n' +
			'HSBC ETF- WORLD DLA\r\n' +
			'HSBC MSCI WORLD UCITS ETF\r\n' +
			':93B::AGGR//UNIT/680\r\n' +
			':16R:SUBBAL\r\n' +
			':93C::TAVI//UNIT/AVAI/680\r\n' +
			':70C::SUBB//1 HSBC ETF- WORLD DLA\r\n' +
			'2\r\n' +
			'3 EDE 37.200000000EUR 2026-01-08T19:08:31.7\r\n' +
			'4 25875.56EUR IE000UQND7H4, 1/SO\r\n' +
			':16S:SUBBAL\r\n' +
			':19A::HOLD//EUR25296\r\n' +
			':70E::HOLD//1STK++++20260107\r\n' +
			'237,267+EUR\r\n' +
			':16S:FIN\r\n' +
			':16R:ADDINFO\r\n' +
			':19A::HOLP//EUR25296\r\n' +
			':16S:ADDINFO\r\n';

		const parser = new Mt535Parser(input);
		const statement = parser.parse();

		expect(statement.totalValue).toBe(25296);
		expect(statement.currency).toBe('EUR');
		expect(statement.holdings).toHaveLength(1);
		const holding = statement.holdings[0];
		expect(holding.isin).toBe('IE000UQND7H4');
		expect(holding.wkn).toBeUndefined();
		expect(holding.name).toBe('HSBC ETF- WORLD DLA/HSBC MSCI WORLD UCITS ETF');
		expect(holding.acquisitionDate).toEqual(new Date('2026-01-07T12:00'));
		expect(holding.acquisitionPrice).toBe(37.267);
		expect(holding.amount).toBe(680);
		expect(holding.price).toBe(37.2);
		expect(holding.currency).toBe('EUR');
		expect(holding.value).toBe(25296);
		expect(holding.date).toEqual(new Date(2026, 0, 8, 19, 8, 31, 700));
	});
});
