import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Numeric } from '../dataElements/Numeric.js';
import {
	type InternationalAccount,
	InternationalAccountGroup,
} from '../dataGroups/InternationalAccount.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

/**
 * Format of the electronic account statement.
 * The bank announces the formats it supports in the HIEKAS parameters.
 */
export enum StatementFormat {
	MT940 = '1',
	ISO8583 = '2',
	PDF = '3',
}

export type HKEKASegment = Segment & {
	account: InternationalAccount;
	statementFormat?: StatementFormat;
	/** The sequential number of the statement to fetch, only allowed when the bank sets `indexAllowed` */
	statementNumber?: number;
	/** The year the statement number refers to */
	statementYear?: number;
	maxEntries?: number;
	/**
	 * The offset ("Aufsetzpunkt") the bank returned with answer code 3040, to fetch the
	 * next statement.
	 *
	 * This is deliberately NOT named `continuationMark`: for HKEKA the bank does not split
	 * one oversized response across messages, it announces that a *further document* is
	 * waiting. Naming it `continuationMark` would make the generic parted-message handling
	 * splice two complete HIEKA segments into one corrupt segment.
	 */
	offset?: string;
};

/**
 * Request an electronic account statement (Elektronischer Kontoauszug)
 *
 * Unlike HKKAZ/HKCAZ this does not return individual transactions but the statement
 * document the bank files in the customer's electronic mailbox — for most banks a PDF.
 *
 * A statement is handed out once: the bank keeps track of which statements have already
 * been fetched and announces remaining ones with answer code 3040 plus an offset. Banks
 * that set `receiptRequired` in their HIEKAS parameters expect each statement to be
 * acknowledged before they consider it delivered.
 */
export class HKEKA extends SegmentDefinition {
	static Id = 'HKEKA';
	static Version = 5;
	constructor() {
		super(HKEKA.Id);
	}
	version = HKEKA.Version;
	elements = [
		new InternationalAccountGroup('account', 1, 1),
		new AlphaNumeric('statementFormat', 0, 1, 1),
		new Numeric('statementNumber', 0, 1, 5),
		new Numeric('statementYear', 0, 1, 4),
		new Numeric('maxEntries', 0, 1, 4),
		new AlphaNumeric('offset', 0, 1, 35),
	];
}
