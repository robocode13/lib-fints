import { describe, expect, it } from 'vitest';
import type { StatementResponse } from '../interactions/customerInteraction.js';
import { StatementInteractionCAMT } from '../interactions/statementInteractionCAMT.js';
import { Message } from '../message.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

const CAMT_DESCRIPTOR = 'urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08';

function hicazResponse(camtDocument: string): Message {
	const hicaz = `HICAZ:5:1+DE991234567123456:BANK12+${CAMT_DESCRIPTOR}+@${camtDocument.length}@${camtDocument}'`;
	return Message.decode(`HIRMG:3:2+0020::Abfrage erfolgreich.'${hicaz}`);
}

describe('statement parse failures', () => {
	it('a CAMT document that cannot be parsed is an error, not an empty account', () => {
		const interaction = new StatementInteractionCAMT('123456');
		const clientResponse = { statements: [] } as unknown as StatementResponse;
		const broken = '<?xml version="1.0" encoding="UTF-8"?><Document><BkToCstmrAcctRpt><Rpt>';
		expect(() => interaction.handleResponse(hicazResponse(broken), clientResponse)).toThrow();
	});
});
