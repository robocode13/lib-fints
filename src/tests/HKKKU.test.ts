import { describe, expect, it } from 'vitest';
import { AccountType } from '../bankAccount.js';
import { Language } from '../codes.js';
import { FinTSConfig } from '../config.js';
import type { CreditCardStatementResponse } from '../interactions/creditcardStatementInteraction.js';
import { CreditCardStatementInteractionHKKKU } from '../interactions/creditcardStatementInteractionHKKKU.js';
import { Message } from '../message.js';
import { decode, encode } from '../segment.js';
import type { HIKKUSegment } from '../segments/HIKKU.js';
import type { HIKKUSSegment } from '../segments/HIKKUS.js';
import { HKKKU, type HKKKUSegment } from '../segments/HKKKU.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

const CARD = '5232000011112222';

/** One "Umsatz Kreditkartenkonto" group from its 25 positions */
function entry(fields: Record<number, string>): string {
	return Array.from({ length: 25 }, (_, i) => fields[i] ?? '').join(':');
}

// A purchase in EUR, one in USD with exchange rate, and a refund. Escaped ':' in the description.
const PURCHASE = entry({
	0: CARD,
	1: '20261001',
	2: '20261002',
	4: '20261002',
	9: '12,50',
	10: 'EUR',
	11: 'D',
	12: 'KAFFEEBAR AM MARKT',
	13: 'Filiale?: Mitte',
	20: 'DE',
	21: 'KAFFEEBAR',
	23: 'N',
	24: 'REF0001',
});
const FOREIGN = entry({
	0: CARD,
	1: '20260928',
	2: '20260930',
	3: '20261003',
	4: '20260930',
	5: '20,00',
	6: 'USD',
	7: 'D',
	8: '1,0852',
	9: '18,43',
	10: 'EUR',
	11: 'D',
	12: 'ONLINE SHOP INC',
	20: 'US',
	21: 'ONLINE SHOP',
	23: 'J',
	24: 'REF0002',
});
const REFUND = entry({
	0: CARD,
	2: '20261003',
	9: '1.234,00',
	10: 'EUR',
	11: 'C',
	12: 'GUTSCHRIFT',
});

const HIKKU_TEXT = `HIKKU:4:1:3+${CARD}++D:655,56:EUR:20261004+20261003+20261103+${PURCHASE}+${FOREIGN}'`;

function config(params?: string) {
	return FinTSConfig.fromBankingInformation('product', '1.0', {
		systemId: 'SYSTEM01',
		bpd: {
			version: 1,
			url: 'https://bank.example.com/fints',
			countryCode: 280,
			bankId: '10020030',
			bankName: 'Example Bank',
			allowedTransactions: [
				{
					transId: 'HKKKU',
					versions: [1],
					tanRequired: false,
					params: params ? (decode(params) as HIKKUSSegment).params : undefined,
				},
			],
			maxTransactionsPerMessage: 1,
			supportedLanguages: [Language.German],
			supportedHbciVersions: [300],
			supportedTanMethods: [],
			availableTanMethodIds: [],
		},
		upd: {
			version: 1,
			usage: 0,
			bankAccounts: [
				{
					accountNumber: CARD,
					bank: { bankId: '10020030', country: 280 },
					iban: 'DE89370400440532013002',
					customerId: 'customer1',
					accountType: AccountType.CreditCardAccount,
					currency: 'EUR',
					holder1: 'Test User',
					allowedTransactions: [{ transId: 'HKKKU', numSignatures: 1 }],
				},
			],
		},
		bankMessages: [],
	});
}

describe('HKKKU v1', () => {
	it('encode with account and period', () => {
		const segment: HKKKUSegment = {
			header: { segId: HKKKU.Id, segNr: 3, version: 1 },
			account: { iban: 'DE89370400440532013002', bic: 'BANKDEFF' },
			cardNumber: CARD,
			from: new Date('2026-09-01'),
			to: new Date('2026-10-04'),
		};

		expect(encode(segment)).toBe(
			`HKKKU:3:1+DE89370400440532013002:BANKDEFF+${CARD}++20260901+20261004'`,
		);
	});

	it('encode without account', () => {
		const segment: HKKKUSegment = {
			header: { segId: HKKKU.Id, segNr: 3, version: 1 },
			cardNumber: CARD,
		};

		expect(encode(segment)).toBe(`HKKKU:3:1++${CARD}'`);
	});

	it('decode and encode roundtrip matches', () => {
		const text = `HKKKU:3:1+DE89370400440532013002:BANKDEFF+${CARD}++20260901+20261004++AUFSETZ1'`;
		expect(encode(decode(text))).toBe(text);
	});
});

describe('HIKKU v1', () => {
	it('decode', () => {
		const segment = decode(HIKKU_TEXT) as HIKKUSegment;

		expect(segment.cardNumber).toBe(CARD);
		expect(segment.balance?.creditDebit).toBe('D');
		expect(segment.balance?.amount.value).toBe(655.56);
		expect(segment.lastStatementDate).toEqual(new Date('2026-10-03'));
		expect(segment.nextStatementDate).toEqual(new Date('2026-11-03'));
		expect(segment.entries).toHaveLength(2);
	});
});

describe('HIKKUS v1', () => {
	it('decode and encode roundtrip matches', () => {
		const text = "HIKKUS:12:1:4+1+1+0+180:N:J:J'";
		const segment = decode(text) as HIKKUSSegment;

		expect(segment.params.storagePeriodDays).toBe(180);
		expect(segment.params.maxEntriesAllowed).toBe(false);
		expect(segment.params.dateRangeAllowed).toBe(true);
		expect(segment.params.accountRequired).toBe(true);

		expect(encode(segment)).toBe(text);
	});
});

describe('CreditCardStatementInteractionHKKKU', () => {
	function handle(message: Message) {
		const interaction = new CreditCardStatementInteractionHKKKU(CARD);
		const clientResponse = { bankAnswers: message.getBankAnswers() } as never;
		interaction.handleResponse(message, clientResponse);
		return clientResponse as unknown as CreditCardStatementResponse;
	}

	it('sends account and period by default', () => {
		const [segment] = new CreditCardStatementInteractionHKKKU(
			CARD,
			new Date('2026-09-01'),
			new Date('2026-10-04'),
		).createSegments(config()) as HKKKUSegment[];

		expect(segment.cardNumber).toBe(CARD);
		expect(segment.account?.iban).toBe('DE89370400440532013002');
		expect(segment.from).toEqual(new Date('2026-09-01'));
		expect(segment.to).toEqual(new Date('2026-10-04'));
	});

	it('leaves out account and period when the parameters do not allow them', () => {
		const [segment] = new CreditCardStatementInteractionHKKKU(
			CARD,
			new Date('2026-09-01'),
		).createSegments(config("HIKKUS:12:1:4+1+1+0+180:N:N:N'")) as HKKKUSegment[];

		expect(segment.account).toBeUndefined();
		expect(segment.from).toBeUndefined();
	});

	it('maps balance and entries', () => {
		const response = handle(Message.decode(`HIRMG:3:2+0010::Entgegengenommen.'${HIKKU_TEXT}`));

		expect(response.balance.balance).toBe(-655.56);
		expect(response.balance.currency).toBe('EUR');
		expect(response.statements).toHaveLength(2);

		const [purchase, foreign] = response.statements;
		expect(purchase).toEqual({
			transactionDate: new Date(2026, 9, 2),
			receiptDate: new Date(2026, 9, 1),
			valueDate: new Date(2026, 9, 2),
			currency: 'EUR',
			amount: -12.5,
			purpose: 'KAFFEEBAR AM MARKT Filiale: Mitte',
			remoteName: 'KAFFEEBAR',
			country: 'DE',
			originalCurrency: undefined,
			originalAmount: undefined,
			exchangeRate: undefined,
			billed: false,
			reference: 'REF0001',
		});
		expect(foreign.amount).toBe(-18.43);
		expect(foreign.originalAmount).toBe(-20);
		expect(foreign.originalCurrency).toBe('USD');
		expect(foreign.exchangeRate).toBe(1.0852);
		expect(foreign.billed).toBe(true);
	});

	it('merges the entries of several HIKKU segments', () => {
		const second = `HIKKU:5:1:3+${CARD}++D:655,56:EUR:20261004+20261003+20261103+${REFUND}'`;
		const response = handle(
			Message.decode(`HIRMG:3:2+0010::Entgegengenommen.'${HIKKU_TEXT}${second}`),
		);

		expect(response.statements).toHaveLength(3);
		const refund = response.statements[2];
		expect(refund.amount).toBe(1234);
		expect(refund.transactionDate).toEqual(new Date(2026, 9, 3));
		expect(refund.receiptDate).toBeUndefined();
		expect(refund.valueDate).toEqual(new Date(2026, 9, 3));
	});

	it('returns no statements without HIKKU', () => {
		const response = handle(Message.decode("HIRMG:3:2+0010::Entgegengenommen.'"));
		expect(response.statements).toEqual([]);
	});
});
