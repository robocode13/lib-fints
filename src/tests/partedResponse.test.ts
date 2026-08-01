import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankingInformation } from '../bankingInformation.js';
import type { BankTransaction } from '../bankTransaction.js';
import { FinTSConfig } from '../config.js';
import { Dialog } from '../dialog.js';
import { StatementInteractionCAMT } from '../interactions/statementInteractionCAMT.js';
import { CustomerOrderMessage, Message } from '../message.js';
import { HICAZ, type HICAZSegment } from '../segments/HICAZ.js';
import { HKCAZ, type HKCAZSegment } from '../segments/HKCAZ.js';
import { registerSegments } from '../segments/registry.js';

vi.mock('../httpClient.js', () => ({
	HttpClient: class MockHttpClient {
		constructor(
			public url: string,
			public debug = false,
			public debugRaw = false,
		) {}
		sendMessage = vi.fn();
	},
}));

registerSegments();

const CAMT_DESCRIPTOR = 'urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08';

/**
 * A HICAZ segment as the bank sends it. Every portion of a parted response is a
 * COMPLETE segment — it repeats account and descriptor before carrying its own share
 * of the CAMT documents.
 */
function hicazText(...camtDocuments: string[]): string {
	const booked = camtDocuments.map((doc) => `@${doc.length}@${doc}`).join(':');
	return `HICAZ:5:1+DE991234567123456:BANK12+${CAMT_DESCRIPTOR}+${booked}'`;
}

function responseMessage(hicaz: string, withContinuation: boolean): Message {
	const answers = withContinuation
		? "HIRMG:3:2+0010::Entgegengenommen.+3040::Es liegen weitere Umsaetze vor.:AUFSETZ_1'"
		: "HIRMG:3:2+0010::Entgegengenommen.+0020::Abfrage erfolgreich.'";
	return Message.decode(`${answers}${hicaz}`, HICAZ.Id);
}

describe('parted responses (bank answer code 3040)', () => {
	let config: FinTSConfig;
	let dialog: Dialog;

	beforeEach(() => {
		const bankingInformation: BankingInformation = {
			systemId: 'MOCK_SYSTEM_ID',
			bankMessages: [],
			bpd: {
				version: 1,
				bankId: '12030000',
				bankName: 'Mock Bank',
				countryCode: 280,
				url: 'http://mock.bank.url',
				allowedTransactions: [
					{ transId: 'HKCAZ', tanRequired: false, versions: [1] } as BankTransaction,
				],
				supportedTanMethods: [],
				availableTanMethodIds: [],
				maxTransactionsPerMessage: 1,
				supportedLanguages: [],
				supportedHbciVersions: [300],
			},
		} as unknown as BankingInformation;

		config = FinTSConfig.fromBankingInformation(
			'PRODUCT',
			'1.0',
			bankingInformation,
			'user',
			'pin',
		);
		dialog = new Dialog(config);
	});

	it('delivers every portion into the message the caller holds', async () => {
		const first = responseMessage(hicazText('<Doc>one</Doc>'), true);
		const second = responseMessage(hicazText('<Doc>two</Doc>', '<Doc>three</Doc>'), false);

		vi.mocked(dialog.httpClient.sendMessage).mockResolvedValueOnce(second);

		const interaction = new StatementInteractionCAMT('123');
		const request = new CustomerOrderMessage(HKCAZ.Id, HICAZ.Id);
		request.addSegment({
			header: { segId: HKCAZ.Id, segNr: 0, version: 1 },
			account: { iban: 'DE991234567123456', bic: 'BANK12' },
			acceptedCamtFormats: ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'],
			allAccounts: false,
		} as HKCAZSegment);

		// biome-ignore lint/suspicious/noExplicitAny: reaching into the private collector on purpose
		await (dialog as any).handlePartedMessages(request, first, interaction);

		// Before the fix this was a single unresolved PARTED segment and everything after
		// the first portion was lost without a trace.
		const segments = first.findAllSegments<HICAZSegment>(HICAZ.Id);
		expect(first.findAllSegments('PARTED')).toHaveLength(0);
		expect(segments).toHaveLength(2);
		expect(segments.flatMap((s) => s.bookedTransactions)).toEqual([
			'<Doc>one</Doc>',
			'<Doc>two</Doc>',
			'<Doc>three</Doc>',
		]);
	});

	it('leaves an unparted response untouched', async () => {
		const only = responseMessage(hicazText('<Doc>one</Doc>'), false);

		const interaction = new StatementInteractionCAMT('123');
		const request = new CustomerOrderMessage(HKCAZ.Id, HICAZ.Id);
		request.addSegment({
			header: { segId: HKCAZ.Id, segNr: 0, version: 1 },
			account: { iban: 'DE991234567123456', bic: 'BANK12' },
			acceptedCamtFormats: ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'],
			allAccounts: false,
		} as HKCAZSegment);

		// biome-ignore lint/suspicious/noExplicitAny: reaching into the private collector on purpose
		await (dialog as any).handlePartedMessages(request, only, interaction);

		expect(dialog.httpClient.sendMessage).not.toHaveBeenCalled();
		const segments = only.findAllSegments<HICAZSegment>(HICAZ.Id);
		expect(segments).toHaveLength(1);
		expect(segments[0].bookedTransactions).toEqual(['<Doc>one</Doc>']);
	});
});

describe('StatementInteractionCAMT with a parted response', () => {
	it('parses the CAMT documents of every segment, not just the first', () => {
		const camt = (id: string, amount: string) =>
			`<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">` +
			`<BkToCstmrAcctRpt><GrpHdr><MsgId>${id}</MsgId><CreDtTm>2026-07-01T10:00:00+02:00</CreDtTm></GrpHdr>` +
			`<Rpt><Id>${id}</Id><Acct><Id><IBAN>DE991234567123456</IBAN></Id><Ccy>EUR</Ccy></Acct>` +
			`<Bal><Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1000.00</Amt>` +
			`<CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-06-30</Dt></Dt></Bal>` +
			`<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">990.00</Amt>` +
			`<CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-07-01</Dt></Dt></Bal>` +
			`<Ntry><Amt>${amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd>` +
			`<BookgDt><Dt>2026-07-01</Dt></BookgDt><ValDt><Dt>2026-07-01</Dt></ValDt>` +
			`<AcctSvcrRef>TXN${id}</AcctSvcrRef>` +
			`<NtryDtls><TxDtls><RmtInf><Ustrd>Test ${id}</Ustrd></RmtInf></TxDtls></NtryDtls>` +
			`</Ntry></Rpt></BkToCstmrAcctRpt></Document>`;

		const message = Message.decode(
			`${hicazText(camt('A', '10.00'))}${hicazText(camt('B', '20.00'))}`,
		);
		expect(message.findAllSegments(HICAZ.Id)).toHaveLength(2);

		const interaction = new StatementInteractionCAMT('123');
		const clientResponse = { statements: [] } as never;
		interaction.handleResponse(message, clientResponse);

		const transactions = (
			clientResponse as unknown as { statements: { transactions: unknown[] }[] }
		).statements.flatMap((s) => s.transactions);
		expect(transactions).toHaveLength(2);
	});
});

describe('several response segments in one bank message', () => {
	it('resolves every portion, not just the first', async () => {
		// Eine Botschaft mit ZWEI HICAZ-Segmenten. Vorher wurde nur das erste aufgeloest;
		// das zweite blieb als PARTED im Baum und war fuer findAllSegments unsichtbar.
		const answers = "HIRMG:3:2+0010::Entgegengenommen.+0020::Abfrage erfolgreich.'";
		const message = Message.decode(
			`${answers}${hicazText('<Doc>one</Doc>')}${hicazText('<Doc>two</Doc>')}`,
			HICAZ.Id,
		);
		expect(message.findAllSegments('PARTED')).toHaveLength(2);

		const dialog = new Dialog(
			FinTSConfig.fromBankingInformation(
				'PRODUCT',
				'1.0',
				{
					systemId: 'X',
					bankMessages: [],
					bpd: {
						version: 1,
						bankId: '12030000',
						bankName: 'Mock',
						countryCode: 280,
						url: 'http://mock.bank.url',
						allowedTransactions: [{ transId: 'HKCAZ', tanRequired: false, versions: [1] }],
						supportedTanMethods: [],
						availableTanMethodIds: [],
						maxTransactionsPerMessage: 1,
						supportedLanguages: [],
						supportedHbciVersions: [300],
					},
					// biome-ignore lint/suspicious/noExplicitAny: schlanker Mock
				} as any,
				'user',
				'pin',
			),
		);

		const request = new CustomerOrderMessage(HKCAZ.Id, HICAZ.Id);
		request.addSegment({
			header: { segId: HKCAZ.Id, segNr: 0, version: 1 },
			account: { iban: 'DE991234567123456', bic: 'BANK12' },
			acceptedCamtFormats: ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'],
			allAccounts: false,
		} as HKCAZSegment);

		// biome-ignore lint/suspicious/noExplicitAny: private Sammelroutine, absichtlich
		await (dialog as any).handlePartedMessages(
			request,
			message,
			new StatementInteractionCAMT('123'),
		);

		expect(message.findAllSegments('PARTED')).toHaveLength(0);
		const segments = message.findAllSegments<HICAZSegment>(HICAZ.Id);
		expect(segments).toHaveLength(2);
		expect(segments.flatMap((s) => s.bookedTransactions)).toEqual([
			'<Doc>one</Doc>',
			'<Doc>two</Doc>',
		]);
	});

	it('does not mistake a parameter segment for a response segment', () => {
		// HICAZS begins like HICAZ. Without the colon in the comparison it would be held
		// back as PARTED and never decoded — the same for HIEKAS/HIEKA, HIKAZS/HIKAZ.
		const hicazs =
			"HICAZS:16:1:4+1+1+0+450:N:N:urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08'";
		const message = Message.decode(hicazs, HICAZ.Id);
		expect(message.findAllSegments('PARTED')).toHaveLength(0);
		expect(message.findAllSegments('HICAZS')).toHaveLength(1);
	});
});
