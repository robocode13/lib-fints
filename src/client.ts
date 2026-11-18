import { internationalAccount } from './accountDescriptor.js';
import { type AccountRef, describeAccount } from './bankAccount.js';
import { FinTSConfig } from './config.js';
import { Dialog } from './dialog.js';
import {
	type AccountBalanceResponse,
	BalanceInteraction,
} from './interactions/balanceInteraction.js';
import { CreditCardStatementInteraction } from './interactions/creditcardStatementInteraction.js';
import { CreditCardStatementInteractionHKKKU } from './interactions/creditcardStatementInteractionHKKKU.js';
import {
	CreditTransferInteraction,
	CreditTransferOrder,
	type PreparedTransfer,
	type TransferResponse,
	VopAuthorizationInteraction,
	type VopParameters,
	VopPollInteraction,
} from './interactions/creditTransferInteraction.js';
import type {
	ClientResponse,
	CustomerOrderInteraction,
	StatementResponse,
} from './interactions/customerInteraction.js';
import {
	ElectronicStatementInteraction,
	type ElectronicStatementOptions,
	type ElectronicStatementResponse,
} from './interactions/electronicStatementInteraction.js';
import type { InitResponse } from './interactions/initDialogInteraction.js';
import {
	PortfolioInteraction,
	type PortfolioResponse,
} from './interactions/portfolioInteraction.js';
import { StatementInteractionCAMT } from './interactions/statementInteractionCAMT.js';
import { StatementInteractionMT940 } from './interactions/statementInteractionMT940.js';
import { buildPain001, type CreditTransfer, selectPain001Format } from './pain001Builder.js';
import { DKKKU } from './segments/DKKKU.js';
import type { HISPASParameter } from './segments/HISPAS.js';
import type { HIVPPSParameter } from './segments/HIVPPS.js';
import { HKCAZ } from './segments/HKCAZ.js';
import { HKCCS } from './segments/HKCCS.js';
import { HKEKA } from './segments/HKEKA.js';
import { HKIDN } from './segments/HKIDN.js';
import { HKKAZ } from './segments/HKKAZ.js';
import { HKKKU } from './segments/HKKKU.js';
import { HKSAL } from './segments/HKSAL.js';
import { HKSPA } from './segments/HKSPA.js';
import { HKVPA } from './segments/HKVPA.js';
import { HKVPP } from './segments/HKVPP.js';
import { HKWPD } from './segments/HKWPD.js';
import type { TanMethod } from './tanMethod.js';

export interface SynchronizeResponse extends InitResponse {}

/** How long the bank may take for a Verification of Payee result, counting the waits between polls */
const VOP_TIMEOUT_SECONDS = 60;
/** The wait between polls when the bank names none (python-fints uses the same) */
const VOP_DEFAULT_WAIT_SECONDS = 2;
/** The format the DK VoP specification names, for a bank whose HIVPPS lists none */
const VOP_DEFAULT_REPORT_FORMAT = 'urn:iso:std:iso:20022:tech:xsd:pain.002.001.10';

type PendingTransfer = {
	order: CreditTransferOrder;
	dialog: Dialog;
	lastResponse?: TransferResponse;
	/** Whether a step of the transfer has been sent and its answer is not handled yet */
	inFlight: boolean;
};

const STEP_IN_FLIGHT =
	'the transfer is still waiting for the answer to its previous step; wait for that response';

/**
 * A client to communicate with a bank over the FinTS protocol
 */
export class FinTSClient {
	private currentDialog: Dialog | undefined;
	private currentTransfer: PendingTransfer | undefined;

	/**
	 * Creates a new FinTS client
	 * @param config - the configuration for the client, use the static factory methods FinTSConfig.forFirstTimeUse or FinTSConfig.fromBankingInformation to create a configuration
	 */
	constructor(public config: FinTSConfig) {
		if (!config) {
			throw new Error('configuration must be provided when creating a FinTSClient');
		}

		if (!(config instanceof FinTSConfig)) {
			throw new Error('configuration must be an instance of class FinTSConfig');
		}
	}

	/**
	 * Selects a TAN method by its ID
	 * @param tanMethodId - the ID of the TAN method to select, get the ID from FinTSClient.config.availableTanMethods
	 * @returns the selected TAN method
	 */
	selectTanMethod(tanMethodId: number): TanMethod {
		return this.config.selectTanMethod(tanMethodId);
	}

	/**
	 * Selects a TAN media by its name
	 * @param tanMediaName - the name of the TAN media to select corresponding to a name in TanMethod.activeTanMedia
	 */
	selectTanMedia(tanMediaName: string): void {
		this.config.selectTanMedia(tanMediaName);
	}

	/**
	 * Synchronizes information with the bank, updating config.bankingInformation
	 * @returns the synchronization response
	 */
	async synchronize(): Promise<SynchronizeResponse> {
		this.currentDialog = new Dialog(this.config, true);
		const responses = await this.currentDialog.start();
		return responses.get(HKIDN.Id) as SynchronizeResponse;
	}

	/**
	 * Continues the synchronization transaction when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response
	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns the synchronization response
	 */
	async synchronizeWithTan(tanReference: string, tan?: string): Promise<SynchronizeResponse> {
		return await this.continueCustomerInteractionWithTan([HKIDN.Id], tanReference, tan);
	}

	/**
	 * Checks if the bank supports fetching an account balance in general or for the given account number when provided
	 * @param account when the account number is provided, checks if the account supports fetching the balance
	 * @returns true if the bank (and account) supports fetching the account balance
	 */
	canGetAccountBalance(account?: AccountRef): boolean {
		return account
			? this.config.isAccountTransactionSupported(account, HKSAL.Id)
			: this.config.isTransactionSupported(HKSAL.Id);
	}

	/**
	 * Fetches the account balance for the given account number
	 * @param account - the account number to fetch the balance for, must be an account available in the config.baningInformation.UPD.accounts
	 * @returns the account balance response
	 */
	async getAccountBalance(account: AccountRef): Promise<AccountBalanceResponse> {
		const response = await this.startCustomerOrderInteraction(new BalanceInteraction(account));
		return response as AccountBalanceResponse;
	}

	/**
	 * Continues the account balance fetching when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response
	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns the account balance response
	 */
	async getAccountBalanceWithTan(
		tanReference: string,
		tan?: string,
	): Promise<AccountBalanceResponse> {
		return (await this.continueCustomerInteractionWithTan(
			[HKSAL.Id],
			tanReference,
			tan,
		)) as AccountBalanceResponse;
	}

	/**
	 * Checks if the bank supports fetching account statements in general or for the given account number when provided
	 * @param account when the account number is provided, checks if the account supports fetching of statements
	 * @returns true if the bank (and account) supports fetching account statements
	 */
	canGetAccountStatements(account?: AccountRef): boolean {
		if (account) {
			// Check if either CAMT or MT940 is supported for this account
			return (
				this.config.isAccountTransactionSupported(account, HKCAZ.Id) ||
				this.config.isAccountTransactionSupported(account, HKKAZ.Id)
			);
		} else {
			// Check if either CAMT or MT940 is supported by the bank
			return (
				this.config.isTransactionSupported(HKCAZ.Id) || this.config.isTransactionSupported(HKKAZ.Id)
			);
		}
	}

	/**
	 * Fetches the account statements for the given account number
	 * @param account - the account number to fetch the statements for, must be an account available in the config.baningInformation.UPD.accounts
	 * @param from - an optional start date of the period to fetch the statements for
	 * @param to - an optional end date of the period to fetch the statements for
	 * @param preferCamt - whether to prefer CAMT format over MT940 when both are supported (default: true)
	 * @returns an account statements response containing an array of statements
	 */
	async getAccountStatements(
		account: AccountRef,
		from?: Date,
		to?: Date,
		preferCamt: boolean = true,
	): Promise<StatementResponse> {
		// Check what formats the bank supports
		const camtSupported = this.config.isAccountTransactionSupported(account, 'HKCAZ');
		const mt940Supported = this.config.isAccountTransactionSupported(account, 'HKKAZ');

		if (!camtSupported && !mt940Supported) {
			throw Error(`Account ${describeAccount(account)} does not support account statements`);
		}

		// Choose format based on support and preference
		const useCAMT = (preferCamt && camtSupported) || (!mt940Supported && camtSupported);

		if (useCAMT) {
			return (await this.startCustomerOrderInteraction(
				new StatementInteractionCAMT(account, from, to),
			)) as StatementResponse;
		} else {
			return (await this.startCustomerOrderInteraction(
				new StatementInteractionMT940(account, from, to),
			)) as StatementResponse;
		}
	}

	/**
	 * Continues the account statements fetching when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response
	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns an account statements response containing an array of statements
	 */
	async getAccountStatementsWithTan(
		tanReference: string,
		tan?: string,
	): Promise<StatementResponse> {
		return (await this.continueCustomerInteractionWithTan(
			[HKCAZ.Id, HKKAZ.Id],
			tanReference,
			tan,
		)) as StatementResponse;
	}

	/**
	 * Checks if the bank supports fetching portfolio information in general or for the given account number when provided
	 * @param account when the account number is provided, checks if the account supports fetching of portfolio information
	 * @returns true if the bank (and account) supports fetching portfolio information
	 */
	canGetPortfolio(account?: AccountRef): boolean {
		return account
			? this.config.isAccountTransactionSupported(account, HKWPD.Id)
			: this.config.isTransactionSupported(HKWPD.Id);
	}

	/**
	 * Fetches the portfolio information for the given depot account number
	 * @param account - the depot account number to fetch the portfolio for, must be an account available in the config.bankingInformation.UPD.accounts
	 * @param currency - optional currency filter for the portfolio statement
	 * @param priceQuality - optional price quality filter ('1' for real-time, '2' for delayed)
	 * @param maxEntries - optional maximum number of entries to retrieve
	 * @returns a portfolio response containing holdings and total value
	 */
	async getPortfolio(
		account: AccountRef,
		currency?: string,
		priceQuality?: '1' | '2',
		maxEntries?: number,
	): Promise<PortfolioResponse> {
		return (await this.startCustomerOrderInteraction(
			new PortfolioInteraction(account, currency, priceQuality, maxEntries),
		)) as PortfolioResponse;
	}

	/**
	 * Continues the portfolio fetching when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response

	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns a portfolio response containing holdings and total value
	 */
	async getPortfolioWithTan(tanReference: string, tan?: string): Promise<PortfolioResponse> {
		return (await this.continueCustomerInteractionWithTan(
			[HKWPD.Id],
			tanReference,
			tan,
		)) as PortfolioResponse;
	}

	/**
	 * Checks if the bank supports fetching credit card statements in general or for the given account number
	 * @param account when the account number is provided, checks if the account supports fetching of statements
	 * @returns true if the bank (and account) supports fetching credit card statements
	 */
	canGetCreditCardStatements(account?: AccountRef): boolean {
		// HKKKU is the standardized successor of DKKKU; some banks (e.g. Postbank) only offer HKKKU
		return account
			? this.config.isAccountTransactionSupported(account, HKKKU.Id) ||
					this.config.isAccountTransactionSupported(account, DKKKU.Id)
			: this.config.isTransactionSupported(HKKKU.Id) ||
					this.config.isTransactionSupported(DKKKU.Id);
	}

	/**
	 * Fetches the credit card statements for the given account number
	 * @param account - the account number to fetch the statements for, must be a credit card account available
	 * in the config.baningInformation.UPD.accounts
	 * @param from - an optional start date of the period to fetch the statements for
	 * @param to - an optional end date of the period to fetch the statements for
	 * @returns an account statements response containing an array of statements
	 */
	async getCreditCardStatements(
		account: AccountRef,
		from?: Date,
		to?: Date,
	): Promise<StatementResponse> {
		// Prefer HKKKU where the bank offers it for this account; DKKKU has no end date
		if (this.config.isAccountTransactionSupported(account, HKKKU.Id)) {
			return (await this.startCustomerOrderInteraction(
				new CreditCardStatementInteractionHKKKU(account, from, to),
			)) as StatementResponse;
		}
		return (await this.startCustomerOrderInteraction(
			new CreditCardStatementInteraction(account, from),
		)) as StatementResponse;
	}

	/**
	 * Continues the credit card statements fetching when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response
	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns a credit card statements response containing an array of statements
	 */
	async getCreditCardStatementsWithTan(
		tanReference: string,
		tan?: string,
	): Promise<StatementResponse> {
		return (await this.continueCustomerInteractionWithTan(
			[HKKKU.Id, DKKKU.Id],
			tanReference,
			tan,
		)) as StatementResponse;
	}

	/**
	 * Checks if the bank supports fetching electronic account statements in general or for the given account number
	 * @param account when the account number is provided, checks if the account supports fetching of electronic statements
	 * @returns true if the bank (and account) supports fetching electronic account statements
	 */
	canGetElectronicStatements(account?: AccountRef): boolean {
		return account
			? this.config.isAccountTransactionSupported(account, HKEKA.Id)
			: this.config.isTransactionSupported(HKEKA.Id);
	}

	/**
	 * Fetches an electronic account statement (Elektronischer Kontoauszug) for the given account number
	 *
	 * This returns the statement document the bank files in the customer's electronic mailbox,
	 * usually a PDF, not a list of transactions. The bank hands out one statement per call and
	 * announces a waiting successor in `nextOffset`; pass that value back in `options.offset` to
	 * fetch the next one. Banks that set `receiptRequired` in their HIEKAS parameters keep
	 * offering a statement until it has been acknowledged with its receipt.
	 *
	 * @param account - the account number to fetch the statement for, must be an account available in the config.bankingInformation.upd.accounts
	 * @param options - optional format, statement number and year, entry limit and offset
	 * @returns a response containing the statement documents and the offset of a waiting successor
	 */
	async getElectronicStatements(
		account: AccountRef,
		options?: ElectronicStatementOptions,
	): Promise<ElectronicStatementResponse> {
		return (await this.startCustomerOrderInteraction(
			new ElectronicStatementInteraction(account, options),
		)) as ElectronicStatementResponse;
	}

	/**
	 * Continues the electronic account statement fetching when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response
	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns a response containing the statement documents
	 */
	async getElectronicStatementsWithTan(
		tanReference: string,
		tan?: string,
	): Promise<ElectronicStatementResponse> {
		return (await this.continueCustomerInteractionWithTan(
			[HKEKA.Id],
			tanReference,
			tan,
		)) as ElectronicStatementResponse;
	}

	/**
	 * Checks if the bank supports SEPA credit transfers in general or from the given account when provided:
	 * HKCCS in a version this library speaks, a pain.001 format it builds, and, where the bank requires
	 * Verification of Payee for transfers, readable VoP parameters (HIVPPS)
	 * @param account when the account number is provided, checks if the account allows transfers and has an IBAN
	 * @returns true if the bank (and account) supports SEPA credit transfers
	 */
	canTransfer(account?: AccountRef): boolean {
		if (account) {
			// An unknown account is a mistake of the caller, as for the other can... methods
			this.config.getBankAccount(account);
		}

		try {
			this.checkTransferSupport(account);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Starts a SEPA credit transfer (HKCCS), executed as soon as possible.
	 *
	 * This is the only method of this library that can move money. The input is checked before
	 * anything is sent: an invalid IBAN, BIC, amount or text throws a `SepaValidationError`, and
	 * nothing is transliterated or shortened.
	 *
	 * Where the bank requires Verification of Payee, it checks the payee's name against the IBAN
	 * first, and the response carries the result in `vop`. Then:
	 * - `requiresVopConfirmation`: the bank waits for a decision. Show `vop` (with `vop.notice`
	 *   and, for a close match, `vop.suggestedName`) to the user, then call
	 *   `confirmTransfer(transferId)` to authorise the transfer anyway, or
	 *   `cancelTransfer(transferId)` to drop it. Nothing is confirmed
	 *   automatically, whatever the result.
	 * - `requiresTan`: the payee matched (or the bank requires no check) and the bank asks for
	 *   the TAN; continue with `transferWithTan()`, or drop the transfer with
	 *   `cancelTransfer(transferId)`.
	 * - `success` and neither flag: the bank accepted the transfer.
	 * - `success: false`: the transfer stopped; `bankAnswers` and `failureReason` say why. Anything
	 *   unexpected, such as an unknown result code or a missing VoP ID, ends it this way. With
	 *   `outcomeUncertain` the bank did not say whether it executed the order (such as code
	 *   9000, or 0020 to the order next to an error): check the account before sending it again.
	 *
	 * While the bank is still checking the payee, the call asks again until the result is
	 * there; `bankAnswers` then holds the answers to every one of these messages.
	 *
	 * Only one transfer can be in progress per client. Every response carries the same
	 * `transferId` for it.
	 *
	 * @param account - the account to transfer from, must be an account available in the config.bankingInformation.upd.bankAccounts with an IBAN
	 * @param transfer - the payee, amount and purpose
	 * @returns the transfer response
	 * @throws SepaValidationError when the transfer data is invalid
	 * @throws Error when a transfer is already in progress, the account cannot transfer, or the
	 * connection fails; an error after the first message was sent leaves the outcome unknown,
	 * check the account before trying again
	 */
	async transfer(account: AccountRef, transfer: CreditTransfer): Promise<TransferResponse> {
		if (this.currentTransfer) {
			throw new Error(
				'a transfer is already in progress; continue it or call cancelTransfer() first',
			);
		}

		const order = new CreditTransferOrder(() => this.prepareTransfer(account, transfer));
		const dialog = new Dialog(this.config, false);
		dialog.addCustomerInteraction(new CreditTransferInteraction(order, 'submit'));
		const pending: PendingTransfer = { order, dialog, inFlight: false };
		this.currentTransfer = pending;

		return this.driveTransfer(pending, () => dialog.start());
	}

	/**
	 * Authorises the transfer despite the Verification of Payee result, after the user has seen
	 * `vop` and decided to go ahead. Only callable when the last response had
	 * `requiresVopConfirmation`. The bank may then ask for a TAN (`requiresTan`).
	 *
	 * Authorising a transfer to a payee whose name does not match may mean the money goes to
	 * someone else, and the payer's bank is then not liable for that.
	 * @param transferId the `transferId` of the response the user decided on
	 * @returns the transfer response
	 * @throws Error when that transfer is not the one waiting for a confirmation
	 */
	async confirmTransfer(transferId: string): Promise<TransferResponse> {
		const transfer = this.currentTransfer;

		if (transfer?.inFlight) {
			throw new Error(STEP_IN_FLIGHT);
		}

		if (
			!transfer ||
			transfer.order.transferId !== transferId ||
			transfer.order.status !== 'awaitingConfirmation'
		) {
			throw new Error(
				'no transfer is waiting for a confirmation of its Verification of Payee result',
			);
		}

		transfer.order.confirmed = true;

		return this.driveTransfer(transfer, () =>
			transfer.dialog.continueWith(
				transfer.order.authorizationOnly
					? new VopAuthorizationInteraction(transfer.order)
					: new CreditTransferInteraction(transfer.order, 'confirm'),
			),
		);
	}

	/**
	 * Continues the transfer when a TAN is required. With a decoupled TAN method, call it again
	 * while the response still has `requiresTan`, after the user has approved in their app.
	 * @param tanReference The TAN reference provided in the previous response
	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns the transfer response
	 */
	async transferWithTan(tanReference: string, tan?: string): Promise<TransferResponse> {
		const transfer = this.currentTransfer;

		if (transfer?.inFlight) {
			throw new Error(STEP_IN_FLIGHT);
		}

		if (!transfer?.lastResponse?.requiresTan) {
			throw new Error('no transfer is waiting for a TAN');
		}

		if (transfer.lastResponse.tanReference !== tanReference) {
			throw new Error(
				'the TAN reference does not belong to the challenge of the transfer in progress',
			);
		}

		if (!this.config.selectedTanMethod?.isDecoupled && !tan) {
			throw new Error('TAN must be provided for non-decoupled TAN methods');
		}

		return this.driveTransfer(transfer, () => transfer.dialog.continue(tanReference, tan));
	}

	/**
	 * Drops the transfer in progress without executing it and ends its dialog. Call it after a
	 * response with `requiresVopConfirmation` or `requiresTan` when the user decides against the
	 * transfer. Does nothing when that transfer is no longer in progress.
	 * @param transferId the `transferId` of the transfer to drop
	 * @throws Error while a step of the transfer still waits for the bank's answer: that
	 * answer may already have executed it
	 */
	async cancelTransfer(transferId: string): Promise<void> {
		const transfer = this.currentTransfer;

		if (!transfer || transfer.order.transferId !== transferId) {
			return;
		}

		if (transfer.inFlight) {
			throw new Error(STEP_IN_FLIGHT);
		}

		this.currentTransfer = undefined;

		if (!transfer.dialog.hasEnded) {
			await transfer.dialog.end();
		}
	}

	private async startCustomerOrderInteraction(
		interaction: CustomerOrderInteraction,
	): Promise<ClientResponse> {
		this.currentDialog = new Dialog(this.config, false);
		this.currentDialog.addCustomerInteraction(interaction);
		const responses = await this.currentDialog.start();

		const response = responses.get(interaction.segId);
		if (response) {
			return response;
		} else {
			const lastResponse = [...responses.values()].at(-1);
			if (lastResponse) {
				return lastResponse;
			} else {
				throw new Error(
					`No response received for customer interaction with segment ID '${interaction.segId}'`,
				);
			}
		}
	}

	private async continueCustomerInteractionWithTan(
		segIds: string[],
		tanReference: string,
		tan?: string,
	): Promise<ClientResponse> {
		if (!this.currentDialog) {
			throw new Error('no customer dialog was started which can continue');
		}

		const responses = await this.currentDialog.continue(tanReference, tan);

		for (const segId of segIds) {
			const response = responses.get(segId);
			if (response) {
				return response;
			}
		}

		const lastResponse = [...responses.values()].at(-1);
		if (lastResponse) {
			return lastResponse;
		} else {
			throw new Error(
				`No response received for customer interaction with segment IDs '${segIds.join(', ')}'`,
			);
		}
	}

	/**
	 * What canTransfer() checks, from the banking information as it is now
	 * @throws Error naming what does not allow the transfer
	 */
	private checkTransferSupport(account?: AccountRef) {
		const hkccsVersion = this.config.getMaxSupportedTransactionVersion(HKCCS.Id);

		if (!hkccsVersion) {
			throw new Error(
				'the bank does not support SEPA credit transfers (HKCCS) in a version this library supports',
			);
		}

		if (account && !this.config.isAccountTransactionSupported(account, HKCCS.Id)) {
			throw new Error(
				`account ${describeAccount(account)} does not allow SEPA credit transfers (HKCCS) according to the bank's account information (UPD)`,
			);
		}

		if (account && !this.config.getBankAccount(account).iban) {
			throw new Error(`account ${describeAccount(account)} has no IBAN to transfer from`);
		}

		const descriptor = this.selectTransferFormat();

		if (!descriptor) {
			throw new Error(
				'the bank supports none of the pain.001 formats this library builds (pain.001.001.09, pain.001.001.03)',
			);
		}

		return { hkccsVersion, descriptor, vopParameters: this.getVopParameters() };
	}

	/**
	 * Builds the order from the banking information as it is at the time of the call: once
	 * when the transfer is created, and again right before it is first sent, after the dialog
	 * initialisation may have brought new parameters
	 */
	private prepareTransfer(account: AccountRef, transfer: CreditTransfer): PreparedTransfer {
		const { hkccsVersion, descriptor, vopParameters } = this.checkTransferSupport(account);
		const bankAccount = this.config.getBankAccount(account);
		const pain = buildPain001(
			{
				name: transfer.debtorName ?? bankAccount.holder1,
				iban: bankAccount.iban ?? '',
				bic: bankAccount.bic,
			},
			transfer,
			descriptor,
		);

		return {
			account: internationalAccount(this.config, bankAccount),
			pain,
			hkccsVersion,
			vopParameters,
		};
	}

	private selectTransferFormat(): string | undefined {
		return selectPain001Format(
			this.config.getTransactionParameters<HISPASParameter>(HKSPA.Id)?.supportedSepaFormats,
		);
	}

	/**
	 * What the bank's parameters say about Verification of Payee for transfers
	 * @returns undefined when the bank does not require it for HKCCS
	 * @throws Error when the bank announces it but its parameters cannot be used
	 */
	private getVopParameters(): VopParameters | undefined {
		if (!this.config.isTransactionSupported(HKVPP.Id)) {
			return undefined;
		}

		const params = this.config.getTransactionParameters<HIVPPSParameter>(HKVPP.Id);

		// Unreadable parameters must not be taken for "no check required"
		if (!params || !Array.isArray(params.vopRequiredTransactions)) {
			throw new Error(
				'the bank announces Verification of Payee (HKVPP), but its parameters (HIVPPS) could not be read',
			);
		}

		if (!params.vopRequiredTransactions.includes(HKCCS.Id)) {
			return undefined;
		}

		const hkvppVersion = this.config.getMaxSupportedTransactionVersion(HKVPP.Id);
		const hkvpaVersion = this.config.getMaxSupportedTransactionVersion(HKVPA.Id);

		if (!hkvppVersion || !hkvpaVersion) {
			throw new Error(
				'the bank requires Verification of Payee for transfers, but not in a version of HKVPP and HKVPA this library supports',
			);
		}

		const reportFormats = (params.supportedReportFormats ?? '')
			.split(/[;,\s]+/)
			.filter((format) => !!format)
			.slice(0, 99);

		return {
			reportFormats: reportFormats.length ? reportFormats : [VOP_DEFAULT_REPORT_FORMAT],
			noticeStructured: !!params.noticeStructured,
			hkvppVersion,
			hkvpaVersion,
		};
	}

	/**
	 * Runs one step of the given transfer, then asks again for a Verification of Payee
	 * result for as long as the bank is still producing it. The transfer is marked in
	 * flight before anything is sent, so that no other step overlaps this one, and only
	 * this transfer is dropped when it ends.
	 */
	private async driveTransfer(
		transfer: PendingTransfer,
		step: () => Promise<Map<string, ClientResponse>>,
	): Promise<TransferResponse> {
		transfer.inFlight = true;

		try {
			return await this.runTransferStep(transfer, step);
		} finally {
			transfer.inFlight = false;
		}
	}

	private async runTransferStep(
		transfer: PendingTransfer,
		step: () => Promise<Map<string, ClientResponse>>,
	): Promise<TransferResponse> {
		const { order, dialog } = transfer;
		const release = () => {
			if (this.currentTransfer === transfer) {
				this.currentTransfer = undefined;
			}
		};
		let response: TransferResponse;

		try {
			order.lastResponse = undefined;
			await step();
			response = this.toTransferResponse(order, dialog);
			let waitedSeconds = 0;

			while (order.status === 'polling' && response.success) {
				const waitSeconds = Math.max(1, order.waitSeconds ?? VOP_DEFAULT_WAIT_SECONDS);

				if (waitedSeconds + waitSeconds > VOP_TIMEOUT_SECONDS) {
					order.status = 'failed';
					// After 3070 the bank processes the order whatever the check brings
					const processing = order.processingReference !== undefined;
					response = {
						...response,
						success: false,
						outcomeUncertain: processing,
						failureReason: `The bank did not deliver the Verification of Payee result within ${VOP_TIMEOUT_SECONDS} seconds. ${processing ? 'It processes the transfer under a reference (3070) and may execute it; check the account before sending the transfer again.' : 'The transfer was not executed.'}`,
					};
					break;
				}

				waitedSeconds += waitSeconds;
				await this.sleep(waitSeconds * 1000);
				order.lastResponse = undefined;
				await dialog.continueWith(new VopPollInteraction(order));
				// The caller sees what the bank said on every poll of this call
				const earlierAnswers = response.bankAnswers;
				response = this.toTransferResponse(order, dialog);
				response = { ...response, bankAnswers: [...earlierAnswers, ...response.bankAnswers] };
			}
		} catch (error) {
			release();

			// The bank accepted the order and only ending the dialog failed: still a success
			if (order.status === 'accepted' && order.lastResponse) {
				return order.lastResponse;
			}

			await this.endQuietly(dialog);
			throw error;
		}

		transfer.lastResponse = response;

		if (order.status === 'accepted') {
			// The dialog has already sent HKEND
			release();
		} else if (!response.success || order.status === 'failed') {
			release();
			await this.endQuietly(dialog);
		}

		return response;
	}

	/**
	 * The response of the transfer interaction, or, when the dialog stopped before the transfer
	 * was sent (a TAN or an error in the dialog initialisation or a step it queued, such as
	 * HKSPA), the response of the interaction it stopped at
	 */
	private toTransferResponse(order: CreditTransferOrder, dialog: Dialog): TransferResponse {
		if (order.lastResponse) {
			return order.lastResponse;
		}

		const segId = dialog.currentInteraction?.segId;
		const response = segId ? dialog.responses.get(segId) : undefined;

		if (!response) {
			throw new Error('No response received for the transfer');
		}

		const transferResponse: TransferResponse = {
			...response,
			requiresVopConfirmation: false,
			vop: order.vopResult,
			transferId: order.transferId,
			endToEndId: order.pain.endToEndId,
			outcomeUncertain: false,
		};

		if (response.requiresTan && response.success) {
			return transferResponse;
		}

		order.status = 'failed';
		return {
			...transferResponse,
			success: false,
			requiresTan: false,
			failureReason:
				'The dialog stopped before the transfer was sent, see bankAnswers. The transfer was not executed.',
		};
	}

	private async endQuietly(dialog: Dialog): Promise<void> {
		try {
			await dialog.end();
		} catch {
			// The dialog times out at the bank all the same
		}
	}

	private sleep(milliseconds: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, milliseconds));
	}
}
