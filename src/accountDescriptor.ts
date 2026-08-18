import type { BankAccount } from './bankAccount.js';
import type { FinTSConfig } from './config.js';
import type { Account } from './dataGroups/Account.js';
import type { InternationalAccount } from './dataGroups/InternationalAccount.js';
import type { HISPASParameter } from './segments/HISPAS.js';
import { HKSPA } from './segments/HKSPA.js';

/**
 * Builds the account connection ("Kontoverbindung") a segment carries.
 *
 * FinTS has two forms, and segments pick one by version: the national form (KTV,
 * account number + sub-account + bank) and the international one (KTI, which adds
 * IBAN and BIC and makes every field optional). The international form allows the
 * national fields to be present as well, but only where the bank permits it — and
 * the bank says so in the HISPAS parameters, in `nationalAccountAllowed`.
 *
 * Filling both halves regardless is rejected by banks that set the flag to false.
 * Measured at comdirect (BLZ 2004xxxx), same account, same range, same session:
 *
 *   IBAN + BIC + number + sub-account + bank   →  3010 "Kontonummer ist ungültig", 0 statements
 *   IBAN + BIC                                 →  0020 "Auftrag ausgeführt", 19 statements
 *   IBAN                                       →  0020 "Auftrag ausgeführt", 19 statements
 *   number + sub-account + bank                →  3010 "Kontonummer ist ungültig", 0 statements
 *
 * The last line is why this is a rule about the national *fields* rather than about
 * the combination: the bank rejects them in a KTI even when no IBAN accompanies
 * them.
 */

/**
 * The national form. Built field by field rather than by spreading the account and
 * blanking what does not belong: the data group has exactly these three fields, and
 * saying so is clearer than relying on the encoder to ignore the rest.
 */
export function nationalAccount(account: BankAccount): Account {
	return {
		accountNumber: account.accountNumber,
		subAccountId: account.subAccountId,
		bank: account.bank,
	};
}

/**
 * The international form. IBAN and BIC always; the national fields only where the
 * bank's HISPAS parameters allow them.
 *
 * An account without an IBAN — a securities account, typically — has nothing else
 * to identify it with, so it keeps the national fields whatever the flag says. A
 * request the bank refuses is more useful than one it cannot resolve at all.
 *
 * When the bank announces no HISPAS at all the national fields are left out, which
 * is what the specification means by a "Kann"-field: absent permission is not
 * permission.
 */
export function internationalAccount(
	config: FinTSConfig,
	account: BankAccount,
): InternationalAccount {
	if (!account.iban) {
		return nationalAccount(account);
	}

	const hispas = config.getTransactionParameters<HISPASParameter>(HKSPA.Id);

	return hispas?.nationalAccountAllowed
		? {
				iban: account.iban,
				bic: account.bic,
				accountNumber: account.accountNumber,
				subAccountId: account.subAccountId,
				bank: account.bank,
			}
		: { iban: account.iban, bic: account.bic };
}
