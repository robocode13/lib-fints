import { YesNo } from '../dataElements/YesNo.js';
import { Binary } from '../dataElements/Binary.js';
import { Numeric } from '../dataElements/Numeric.js';
import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { InternationalAccount, InternationalAccountGroup } from '../dataGroups/InternationalAccount.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';
import { TanProcess } from '../codes.js';

export type HKTANSegment = Segment & {
	tanProcess: TanProcess;
	segId: string;
	customerAccount?: InternationalAccount;
	orderHash?: string;
	orderRef?: string;
	nextTan?: boolean;
	cancelOrder?: boolean;
	smsAccount?: InternationalAccount;
	challengeClass?: number;
	challengeClassParam?: string[];
	tanMedia?: string;
	hhducResponse?: HhducResponse;
};

export type HhducResponse = {
	atc: string;
	appCryptoAc: string;
	efIdData: string;
	cvr: string;
	chipTanVersion: string;
};

/**
 * Two-Step TAN
 */
export class HKTAN extends SegmentDefinition {
	static Id = this.name;
	static Version = 7;
	version = HKTAN.Version;
	elements = [
		new AlphaNumeric('tanProcess', 1, 1, 1),
		new AlphaNumeric('segId', 0, 1, 6),
		new InternationalAccountGroup('customerAccount', 0, 1),
		new Binary('orderHash', 0, 1, 256),
		new AlphaNumeric('orderRef', 0, 1, 35),
		new YesNo('nextTan', 0, 1),
		new YesNo('cancelOrder', 0, 1),
		new InternationalAccountGroup('smsAccount', 0, 1),
		new Numeric('challengeClass', 0, 1, 2),
		new DataGroup('challengeClassParam', [new AlphaNumeric('param', 0, 1, 999)], 0, 1),
		new AlphaNumeric('tanMedia', 0, 1, 32),
		new DataGroup(
			'hhducResponse',
			[
				new AlphaNumeric('atc', 1, 1, 5),
				new Binary('appCryptoAc', 1, 1, 256),
				new Binary('efIdData', 1, 1, 256),
				new Binary('cvr', 1, 1, 256),
				new Binary('chipTanVersion', 1, 1, 256),
			],
			0,
			1
		),
	];
}
