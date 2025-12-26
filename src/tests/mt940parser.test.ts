import { describe, expect, it } from 'vitest';
import { Mt940Parser } from '../mt940parser.js';

describe('parse', () => {
	it('parses a MT940 input string', () => {
		const input =
			':20:1234567\r\n' +
			':21:9876543210\r\n' +
			':25:10020030/1234567\r\n' +
			':28C:5/1\r\n' +
			':60F:C021101EUR2187,95\r\n' +
			':61:0211011102DR800,NSTONONREF//55555\r\n' +
			':86:008?00DAUERAUFTRAG?100599?20Miete Nov\r\n' +
			'ember?3010020030?31234567\r\n' +
			'?32MUELLER?3433\r\n' +
			'9\r\n' +
			':61:0211021102CR3000,NTRFNONREF//55555\r\n' +
			'Additional Information\r\n' +
			':86:051?00UEBERWEISUNG?100599?20EREF+53XA\r\n' +
			'QC7FDN1K2FO1\r\n' +
			'?21SVWZ+Gehalt?22CRED+Arbeitgeber?3050060400?31084\r\n' +
			'7564700?32MUELLER?34339\r\n' +
			':62F:C021131EUR4387,95\r\n';

		const parser = new Mt940Parser(input);
		const statements = parser.parse();
		const statement = statements[0];

		expect(statement.transactionReference).toBe('1234567');
		expect(statement.relatedReference).toBe('9876543210');
		expect(statement.account).toBe('10020030/1234567');
		expect(statement.number).toBe('5/1');
		expect(statement.openingBalance?.date).toEqual(new Date('2002-11-01T00:00'));
		expect(statement.openingBalance?.currency).toBe('EUR');
		expect(statement.openingBalance?.value).toBe(2187.95);
		expect(statement.closingBalance?.date).toEqual(new Date('2002-11-31T00:00'));
		expect(statement.closingBalance?.currency).toBe('EUR');
		expect(statement.closingBalance?.value).toBe(4387.95);
		expect(statement.transactions).toHaveLength(2);
		expect(statement.transactions[0].valueDate).toEqual(new Date('2002-11-01T00:00'));
		expect(statement.transactions[0].entryDate).toEqual(new Date('2002-11-02T00:00'));
		expect(statement.transactions[0].fundsCode).toBe('R');
		expect(statement.transactions[0].amount).toBe(-800);
		expect(statement.transactions[0].transactionType).toBe('NSTO');
		expect(statement.transactions[0].customerReference).toBe('NONREF');
		expect(statement.transactions[0].bankReference).toBe('55555');
		expect(statement.transactions[0].transactionCode).toBe('008');
		expect(statement.transactions[0].bookingText).toBe('DAUERAUFTRAG');
		expect(statement.transactions[0].primeNotesNr).toBe('0599');
		expect(statement.transactions[0].purpose).toBe('Miete November');
		expect(statement.transactions[0].remoteBankId).toBe('10020030');
		expect(statement.transactions[0].remoteAccountNumber).toBe('234567');
		expect(statement.transactions[0].remoteName).toBe('MUELLER');
		expect(statement.transactions[0].textKeyExtension).toBe('339');

		expect(statement.transactions[1].purpose).toBe('Gehalt');
		expect(statement.transactions[1].e2eReference).toBe('53XAQC7FDN1K2FO1');
		expect(statement.transactions[1].remoteIdentifier).toBe('Arbeitgeber');
		expect(statement.transactions[1].additionalInformation).toBe('Additional Information');
	});
});
