import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import { Dat } from '../dataElements/Dat.js';
import { Numeric } from '../dataElements/Numeric.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';
import type { StatementFormat } from './HKEKA.js';

export type HIEKASegment = Segment & {
	format: StatementFormat;
	timeRange?: { from?: Date; to?: Date };
	date?: Date;
	year?: number;
	number?: number;
	/** The statement document itself — a PDF when format is '3' */
	booked: string;
	closingInfo?: string;
	conditionsInfo?: string;
	advertisement?: string;
	iban?: string;
	bic?: string;
	name?: string;
	name2?: string;
	name3?: string;
	/** Receipt to acknowledge the statement with, when the bank requires acknowledgement */
	receipt?: string;
};

/**
 * Electronic account statement response (Elektronischer Kontoauszug)
 *
 * The element order follows segment "KontoauszugRes5" of the FinTS 3.0 specification:
 * `booked` sits AFTER date/year/number, not before them. HIEKP v2 orders the same fields
 * differently (there `booked` comes first) — the order is specific to each segment and
 * cannot be carried over from one to the other.
 */
export class HIEKA extends SegmentDefinition {
	static Id = 'HIEKA';
	static Version = 5;
	constructor() {
		super(HIEKA.Id);
	}
	version = HIEKA.Version;
	elements = [
		new AlphaNumeric('format', 1, 1, 1),
		new DataGroup('timeRange', [new Dat('from', 0, 1), new Dat('to', 0, 1)], 1, 1),
		new Dat('date', 0, 1),
		new Numeric('year', 0, 1, 4),
		new Numeric('number', 0, 1, 5),
		new Binary('booked', 1, 1),
		new AlphaNumeric('closingInfo', 0, 1, 65536),
		new AlphaNumeric('conditionsInfo', 0, 1, 65536),
		new AlphaNumeric('advertisement', 0, 1, 65536),
		new AlphaNumeric('iban', 0, 1, 34),
		new AlphaNumeric('bic', 0, 1, 11),
		new AlphaNumeric('name', 0, 1, 35),
		new AlphaNumeric('name2', 0, 1, 35),
		new AlphaNumeric('name3', 0, 1, 35),
		new Binary('receipt', 0, 1),
	];
}
