import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { BankingInformation } from '../bankingInformation.js';
import type { BPD } from '../bpd.js';
import { Language } from '../codes.js';
import { FinTSConfig } from '../config.js';
import { Dialog } from '../dialog.js';
import type { ClientResponse } from '../interactions/customerInteraction.js';
import { TransferInteraction } from '../interactions/transferInteraction.js';
import { type CustomerMessage, Message } from '../message.js';
import { decode, encode, type Segment } from '../segment.js';
import { HIVPP, type HIVPPSegment } from '../segments/HIVPP.js';
import { HKVPP, type HKVPPSegment } from '../segments/HKVPP.js';
import { registerSegments } from '../segments/registry.js';
import type { UPD } from '../upd.js';

vi.mock('../httpClient.js', () => ({
	HttpClient: class MockHttpClient {
		sendMessage = vi.fn();
	},
}));

registerSegments();

const REPORT_10 = 'urn:iso:std:iso:20022:tech:xsd:pain.002.001.10';
const REPORT_10_ESC = 'urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.002.001.10';
const POLLING_ID = 'c0f5c2a4-ebb7-4e72-be44-c68742177a2b';
const VOP_ID = '5e3b5c99-df27-4d42-835b-18b35d0c66ff';

// Bank answers recorded from Atruvia (Volksbanken), taken from phpFinTS' tests
const POLLING_NEEDED =
	"HIRMG:3:2+3060::Bitte beachten Sie die enthaltenen Warnungen/Hinweise.+3905::Es wurde keine Challenge erzeugt.'" +
	"HIRMS:4:2:5+3040::Es liegen weitere Informationen vor.:staticscrollref'" +
	"HIRMS:5:2:4+3945::Freigabe ohne VOP-Bestätigung nicht möglich.'" +
	`HIVPP:6:1:5+++@36@${POLLING_ID}+++++2'`;
const report = (group: string, tx?: string) =>
	"<?xml version='1.0' encoding='UTF-8'?><Document><CstmrPmtStsRpt><OrgnlGrpInfAndSts>" +
	`<OrgnlNbOfTxs>1</OrgnlNbOfTxs><GrpSts>${group}</GrpSts></OrgnlGrpInfAndSts>` +
	(tx
		? `<OrgnlPmtInfAndSts><TxInfAndSts><TxSts>${tx}</TxSts></TxInfAndSts></OrgnlPmtInfAndSts>`
		: '') +
	'</CstmrPmtStsRpt></Document>';
const withReport = (answers: string, xml: string, infoText = '') =>
	`${answers}HIVPP:5:1:3+@36@${VOP_ID}+++${REPORT_10_ESC}+@${xml.length}@${xml}++${infoText}'`;
const MATCH = withReport(
	"HIRMG:3:2+0010::Nachricht entgegengenommen.'HIRMS:4:2:3+0020::Auftrag ausgeführt.+0025::Keine Namensabweichung.'",
	report('RCVC'),
);
const NO_MATCH = withReport(
	"HIRMG:3:2+3060::Bitte beachten Sie die enthaltenen Warnungen/Hinweise.'HIRMS:4:2:3+3090::Ergebnis des Namensabgleichs prüfen.'",
	report('RVCM', 'RVNM'),
	'Der Name stimmt <b>nicht</b> überein.',
);
const CONFIRMED =
	"HIRMG:3:2+3060::Bitte beachten Sie die enthaltenen Warnungen/Hinweise.'" +
	"HIRMS:4:2:4+0020::Ausführungsbestätigung nach Namensabgleich erhalten.'" +
	"HIRMS:5:2:5+3955::Sicherheitsfreigabe erfolgt über anderen Kanal.'" +
	"HITAN:6:7:5+4++1234567890123456789012345678+Bitte bestätigen Sie den Vorgang in Ihrer SecureGo plus App'";

describe('VoP segments', () => {
	it('HKVPP encodes the report format and, when polling, polling id and Aufsetzpunkt', () => {
		const segment: HKVPPSegment = {
			header: { segId: HKVPP.Id, segNr: 3, version: 1 },
			supportedReports: [REPORT_10],
			pollingId: POLLING_ID,
			continuationMark: 'staticscrollref',
		};
		expect(encode(segment)).toBe(`HKVPP:3:1+${REPORT_10_ESC}+@36@${POLLING_ID}++staticscrollref'`);
	});

	it('HIVPP decodes a polling answer and a report', () => {
		const polling = decode(`HIVPP:6:1:5+++@36@${POLLING_ID}+++++2'`) as HIVPPSegment;
		expect(polling).toMatchObject({ pollingId: POLLING_ID, waitSeconds: 2 });
		expect(polling.vopId).toBeUndefined();

		const single = decode(
			"HIVPP:5:1:3+@3@abc+++++DE00ABCDEFGH1234567890::Testempfaenger GmbH::RVMC+Der Name weicht ab.'",
		) as HIVPPSegment;
		expect(single.header.segId).toBe(HIVPP.Id);
		expect(single.result).toMatchObject({ differentName: 'Testempfaenger GmbH', result: 'RVMC' });
	});
});

describe('transfer with Verification of Payee (Atruvia)', () => {
	let dialog: Dialog;
	let send: MockInstance;
	const sent: Segment[][] = [];
	const ids = (i: number) => sent[i].map((s) => s.header.segId).filter((id) => /^HK/.test(id));

	beforeEach(() => {
		const bankingInformation = {
			systemId: 'SYS',
			bankMessages: [],
			bpd: {
				version: 1,
				bankId: '12030000',
				bankName: 'Mock Bank',
				countryCode: 280,
				url: 'http://mock.bank.url',
				allowedTransactions: [
					{ transId: 'HKCCS', tanRequired: true, versions: [1] },
					{ transId: 'HKIPZ', tanRequired: true, versions: [1] },
					{
						transId: 'HKVPP',
						tanRequired: false,
						versions: [1],
						params: { supportedReports: REPORT_10 },
					},
					{ transId: 'HKVPA', tanRequired: false, versions: [1] },
				],
				supportedTanMethods: [
					{
						id: 946,
						name: 'SecureGo plus',
						version: 7,
						isDecoupled: true,
						activeTanMediaCount: 0,
						activeTanMedia: [],
						tanMediaRequirement: 0,
					},
				],
				availableTanMethodIds: [946],
				supportedLanguages: [Language.German],
				maxTransactionsPerMessage: 1,
			} as unknown as BPD,
			upd: {
				bankAccounts: [
					{
						accountNumber: '202051',
						bank: { country: 280, bankId: '12030000' },
						iban: 'DE89370400440532013000',
						allowedTransactions: [{ transId: 'HKCCS' }, { transId: 'HKIPZ' }],
					},
				],
			} as unknown as UPD,
		} as BankingInformation;
		const config = FinTSConfig.fromBankingInformation(
			'P',
			'1.0',
			bankingInformation,
			'u',
			'1',
			946,
		);

		dialog = new Dialog(config);
		const ok: ClientResponse = {
			dialogId: 'D1',
			success: true,
			requiresTan: false,
			bankingInformationUpdated: false,
			bankAnswers: [],
		};
		vi.spyOn(dialog.interactions[0], 'handleClientResponse').mockReturnValue(ok);
		vi.spyOn(dialog.interactions[1], 'handleClientResponse').mockReturnValue(ok);
		dialog.addCustomerInteraction(
			new TransferInteraction('202051', 'sepade:xsd:pain.001.001.09.xsd', '<Document/>'),
		);

		sent.length = 0;
		send = vi.mocked(dialog.httpClient.sendMessage);
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	const respond = (...answers: string[]) => {
		for (const text of answers) {
			send.mockImplementationOnce(async (msg: CustomerMessage) => {
				sent.push([...msg.segments]);
				return text ? Message.decode(text) : new Message([]);
			});
		}
	};
	const run = async <T>(work: Promise<T>) => {
		await vi.runAllTimersAsync();
		return work;
	};

	it('order first, TAN request, name check last; polls with Aufsetzpunkt; confirms; then TAN', async () => {
		respond('', POLLING_NEEDED, MATCH);
		const first = (await run(dialog.start())).get('HKCCS');
		expect(ids(1)).toEqual(['HKCCS', 'HKTAN', 'HKVPP']);
		expect(ids(2)).toEqual(['HKVPP']);
		const poll = sent[2].find((s) => s.header.segId === 'HKVPP') as HKVPPSegment;
		expect(poll).toMatchObject({ pollingId: POLLING_ID, continuationMark: 'staticscrollref' });
		expect(first?.requiresVopConfirmation).toBe(true);
		expect(first?.vop?.result).toBe('RCVC');
		expect(dialog.hasEnded).toBe(false);

		respond(CONFIRMED);
		const second = (await run(dialog.resume())).get('HKCCS');
		expect(ids(3)).toEqual(['HKCCS', 'HKVPA', 'HKTAN']);
		expect(sent[3].find((s) => s.header.segId === 'HKVPA')).toMatchObject({ vopId: VOP_ID });
		expect(second?.requiresTan).toBe(true);
		expect(second?.tanReference).toBe('1234567890123456789012345678');
	});

	it('a partial match in the report is read from the transaction status', async () => {
		respond('', POLLING_NEEDED, NO_MATCH);
		const response = (await run(dialog.start())).get('HKCCS');
		expect(response?.requiresVopConfirmation).toBe(true);
		expect(response?.vop).toMatchObject({
			result: 'RVNM',
			infoText: 'Der Name stimmt <b>nicht</b> überein.',
		});
	});

	it('3091: no confirmation, straight to the TAN', async () => {
		const noConfirmation = withReport(
			"HIRMG:3:2+0010::Nachricht entgegengenommen.'HIRMS:4:2:3+3091::VOP-Ausführungsauftrag nicht benötigt.+0025::Keine Namensabweichung.'",
			report('RCVC'),
		).replace(/'$/, "'HITAN:6:7:5+4++REF9+Bitte in der App bestätigen'");
		respond('', POLLING_NEEDED, noConfirmation);
		const response = (await run(dialog.start())).get('HKCCS');
		expect(response?.requiresVopConfirmation).toBeFalsy();
		expect(response?.requiresTan).toBe(true);
		expect(response?.tanReference).toBe('REF9');
	});

	it('3091 without challenge: the transfer is done at once', async () => {
		const done =
			"HIRMG:3:2+3060::Bitte beachten Sie die enthaltenen Warnungen/Hinweise.+3905::Es wurde keine Challenge erzeugt.'" +
			"HIRMS:4:2:5+3091::VOP-Ausführungsauftrag nicht benötigt.+0025::Keine Namensabweichung.'" +
			"HIRMS:5:2:4+3076::Keine starke Authentifizierung erforderlich.'" +
			`HIVPP:6:1:5+@36@${VOP_ID}+++${REPORT_10_ESC}'` +
			"HITAN:7:7:4+4++noref+nochallenge'" +
			"HIRMS:8:2:3+0020::*SEPA-Einzelüberweisung erfolgreich+0900::Freigabe erfolgreich'";
		respond('', done, '');
		const response = (await run(dialog.start())).get('HKCCS');
		expect(response?.success).toBe(true);
		expect(response?.requiresTan).toBe(false);
		expect(response?.requiresVopConfirmation).toBeFalsy();
	});

	it('instant: HKIPZ in place of HKCCS, same name check', async () => {
		dialog.interactions.splice(1, 1);
		dialog.addCustomerInteraction(
			new TransferInteraction('202051', 'sepade:xsd:pain.001.001.09.xsd', '<Document/>', true),
		);
		respond('', POLLING_NEEDED, MATCH);
		const first = (await run(dialog.start())).get('HKIPZ');
		expect(ids(1)).toEqual(['HKIPZ', 'HKTAN', 'HKVPP']);
		expect(sent[1].find((s) => s.header.segId === 'HKTAN')).toMatchObject({ segId: 'HKIPZ' });
		expect(first?.requiresVopConfirmation).toBe(true);
		respond(CONFIRMED);
		await run(dialog.resume());
		expect(ids(3)).toEqual(['HKIPZ', 'HKVPA', 'HKTAN']);
	});
});
