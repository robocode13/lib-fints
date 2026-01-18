import type { HICAZSParameter } from './segments/HICAZS.js';
import type { HIKAZSParameter } from './segments/HIKAZS.js';
import type { HISPASParameter } from './segments/HISPAS.js';

export type BankTransaction = {
	transId: string;
	tanRequired: boolean;
	versions: number[];
	params?: unknown;
};

export type SepaBankTransaction = BankTransaction & {
	transId: 'HKSPA';
	params: HISPASParameter;
};

export type StatementTransactionMT940 = BankTransaction & {
	transId: 'HKKAZ';
	params: HIKAZSParameter;
};

export type StatementTransactionCAMT = BankTransaction & {
	transId: 'HKCAZ';
	params: HICAZSParameter;
};
