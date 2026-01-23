import { describe, expect, it } from 'vitest';
import { Mt535Parser } from '../mt535parser.js';
import { Mt535Parser2 } from '../mt535parser2.js';

describe('Mt535Parser', () => {
	it('parses a MT535 input string with depot value and multiple holdings', () => {
		const input =
			':16R:ADDINFO\r\n' +
			'EUR125000,50\r\n' +
			':16S:ADDINFO\r\n' +
			// Holding 1 (BMW)
			':16R:FIN\r\n' +
			':35B:ISIN DE0005190003/DE/519000BAY.MOTOREN WERKE AG ST:\r\n' +
			':70E::HOLD//100STK275,30+EUR\r\n' +
			':90B::PREFIX_11_CEUR100,50:\r\n' +
			':93B::QTY/AVALBLX100,:\r\n' +
			':98A::SETT//DTE20231101:\r\n' +
			':16S:FIN\r\n' +
			// Holding 2 (Apple)
			':16R:FIN\r\n' +
			':35B:ISIN US0378331005/US/037833Apple Inc. Common Stock:\r\n' +
			':70E::HOLD//50STK2150,75+USD\r\n' +
			':90A::PRIC/RATE_X85,50:\r\n' +
			':93B::QTY/AVALBLX50,:\r\n' +
			':98C::TRADTE20231101143000:\r\n' +
			':16S:FIN\r\n';

		const parser = new Mt535Parser2(input);
		const statement = parser.parse();

		// Test depot value
		expect(statement.totalValue).toBe(125000.5);
		expect(statement.holdings).toHaveLength(2);

		// Test first holding (BMW)
		const bmwHolding = statement.holdings[0];
		expect(bmwHolding.isin).toBe('DE0005190003');
		expect(bmwHolding.wkn).toBe('519000');
		expect(bmwHolding.name).toBe('BAY.MOTOREN WERKE AG ST');
		expect(bmwHolding.acquisitionPrice).toBe(75.3);
		expect(bmwHolding.price).toBe(100.5);
		expect(bmwHolding.currency).toBe('EUR');
		expect(bmwHolding.amount).toBe(100);
		expect(bmwHolding.value).toBe(10050);
		expect(bmwHolding.date).toEqual(new Date(2023, 10, 1, 0, 0, 0));

		// Test second holding (Apple)
		const appleHolding = statement.holdings[1];
		expect(appleHolding.isin).toBe('US0378331005');
		expect(appleHolding.wkn).toBe('037833');
		expect(appleHolding.name).toBe('Apple Inc. Common Stock');
		expect(appleHolding.acquisitionPrice).toBe(150.75);
		expect(appleHolding.price).toBe(0.855);
		expect(appleHolding.currency).toBe('%');
		expect(appleHolding.amount).toBe(50);
		expect(appleHolding.value).toBe(42.75);
		expect(appleHolding.date).toEqual(new Date(2023, 10, 1, 14, 30, 0));
	});

	it('parses MT535 with @@ dividers and different data points', () => {
		const input =
			':16R:ADDINFO@@' +
			'EUR50000,25@@' +
			':16S:ADDINFO@@' +
			':16R:FIN@@' +
			':35B:ISIN DE0007164600/DE/716460SAP SE:@@' +
			':70E::HOLD//25STK2120,80+EUR@@' +
			':90B::UNKNOWNVALXEUR115,75:@@' +
			':93B::SOMESTATUS_25,:@@' +
			':98A::REGD//DTE20231215:@@' +
			':16S:FIN@@';

		const parser = new Mt535Parser(input);
		const statement = parser.parse();

		expect(statement.totalValue).toBe(50000.25);
		expect(statement.holdings).toHaveLength(1);

		const holding = statement.holdings[0];
		expect(holding.isin).toBe('DE0007164600');
		expect(holding.wkn).toBe('716460');
		expect(holding.name).toBe('SAP SE');
		expect(holding.acquisitionPrice).toBe(120.8);
		expect(holding.price).toBe(115.75);
		expect(holding.currency).toBe('EUR');
		expect(holding.amount).toBe(25);
		expect(holding.value).toBe(2893.75);
		expect(holding.date).toEqual(new Date(2023, 11, 15));
	});

	it('handles empty input', () => {
		const parser = new Mt535Parser('');
		const statement = parser.parse();
		expect(statement.totalValue).toBeUndefined();
		expect(statement.holdings).toHaveLength(0);
	});

	it('handles input without depot value', () => {
		const input =
			':16R:FIN\r\n' +
			':35B:ISIN DE0005190003/DE/519000SOME OTHER AG ST:\r\n' +
			':90B::PREFIX_11_CEUR100,50:\r\n' +
			':93B::QTY/AVALBLX100,:\r\n' +
			':98A::SETT//DTE20231101:\r\n' +
			':16S:FIN\r\n';

		const parser = new Mt535Parser(input);
		const statement = parser.parse();

		expect(statement.totalValue).toBeUndefined();
		expect(statement.holdings).toHaveLength(1);
		expect(statement.holdings[0].isin).toBe('DE0005190003');
		expect(statement.holdings[0].name).toBe('SOME OTHER AG ST');
		expect(statement.holdings[0].price).toBe(100.5);
		expect(statement.holdings[0].amount).toBe(100);
	});

	it('handles input without holdings', () => {
		const input = ':16R:ADDINFO\r\n' + 'EUR75000,00\r\n' + ':16S:ADDINFO\r\n';
		const parser = new Mt535Parser(input);
		const statement = parser.parse();
		expect(statement.totalValue).toBe(75000.0);
		expect(statement.holdings).toHaveLength(0);
	});

	it('handles holding with minimal data (only security identification)', () => {
		const input =
			':16R:FIN\r\n' + ':35B:ISIN FR0000120271/FR/120271AIR LIQUIDE SA: \r\n' + ':16S:FIN\r\n';

		const parser = new Mt535Parser(input);
		const statement = parser.parse();

		expect(statement.holdings).toHaveLength(1);
		const holding = statement.holdings[0];
		expect(holding.isin).toBe('FR0000120271');
		expect(holding.wkn).toBe('120271');
		expect(holding.name).toBe('AIR LIQUIDE SA');
		expect(holding.price).toBeUndefined();
		expect(holding.amount).toBeUndefined();
		expect(holding.value).toBeUndefined();
		expect(holding.date).toBeUndefined();
	});

	it('calculates value correctly for percentage currency when price is from :90A', () => {
		const input =
			':16R:FIN\r\n' +
			':35B:ISIN US0378331005/US/037833Apple Inc. Common Stock:\r\n' +
			':90A::PRIC/RATE_X85,50:\r\n' +
			':93B::QTY/AVALBLX100,:\r\n' +
			':16S:FIN\r\n';

		const parser = new Mt535Parser(input);
		const statement = parser.parse();

		const holding = statement.holdings[0];
		expect(holding.currency).toBe('%');
		expect(holding.price).toBe(0.855);
		expect(holding.amount).toBe(100);
		expect(holding.value).toBe(85.5);
	});

	it('correctly parses date and time for :98C', () => {
		const input =
			':16R:FIN\r\n' +
			':35B:ISIN DE000BASF111/DE/BASF11BASF SE:\r\n' +
			':98C::QUALIF20240115093045:\r\n' +
			':16S:FIN\r\n';
		const parser = new Mt535Parser(input);
		const statement = parser.parse();
		const holding = statement.holdings[0];
		expect(holding.date).toEqual(new Date(2024, 0, 15, 9, 30, 45));
	});

	it('correctly parses date for :98A (time defaults to 00:00:00)', () => {
		const input =
			':16R:FIN\r\n' +
			':35B:ISIN DE000BAY0017/DE/BAY001BAYER AG:\r\n' +
			':98A::SETT//DTE20231005:\r\n' +
			':16S:FIN\r\n';
		const parser = new Mt535Parser(input);
		const statement = parser.parse();
		const holding = statement.holdings[0];
		expect(holding.date).toEqual(new Date(2023, 9, 5, 0, 0, 0));
	});

	it('parse DKB statement correctly', () => {
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

		const parser = new Mt535Parser2(input);
		const statement = parser.parse();

		expect(statement.totalValue).toBe(18669.64);
		expect(statement.currency).toBe('EUR');
		expect(statement.holdings).toHaveLength(1);
		const holding = statement.holdings[0];
		expect(holding.isin).toBe('LU0950674332');
		expect(holding.wkn).toBe('A1W3CQ');
		expect(holding.name).toBe('UBS MSCI WORLD SOC.RES. NAMENS-ANTEILE A ACC. USD O.N.');
		expect(holding.acquisitionDate).toEqual(new Date('2022-09-02T12:00'));
		expect(holding.acquisitionPrice).toBe(21.2012438);
		expect(holding.amount).toBe(652);
		expect(holding.price).toBe(33.22);
		expect(holding.currency).toBe('EUR');
		expect(holding.value).toBe(18669.64);
		expect(holding.date).toEqual(new Date(2026, 0, 9, 21, 2, 44));
	});
});
