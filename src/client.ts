import { describeAccount, type AccountRef } from './bankAccount.js';
import { FinTSConfig } from './config.js';
import { Dialog } from './dialog.js';
import {
	type AccountBalanceResponse,
	BalanceInteraction,
} from './interactions/balanceInteraction.js';
import { CreditCardStatementInteraction } from './interactions/creditcardStatementInteraction.js';
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
import { DKKKU } from './segments/DKKKU.js';
import { HKCAZ } from './segments/HKCAZ.js';
import { HKEKA } from './segments/HKEKA.js';
import { HKIDN } from './segments/HKIDN.js';
import { HKKAZ } from './segments/HKKAZ.js';
import { HKSAL } from './segments/HKSAL.js';
import { HKWPD } from './segments/HKWPD.js';
import type { TanMethod } from './tanMethod.js';

export interface SynchronizeResponse extends InitResponse {}

/**
 * A client to communicate with a bank over the FinTS protocol
 */
export class FinTSClient {
	private currentDialog: Dialog | undefined;

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
		const response = await this.startCustomerOrderInteraction(
			new BalanceInteraction(account),
		);
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
		return account
			? this.config.isAccountTransactionSupported(account, DKKKU.Id)
			: this.config.isTransactionSupported(DKKKU.Id);
	}

	/**
	 * Fetches the credit card statements for the given account number
	 * @param account - the account number to fetch the statements for, must be a credit card account available
	 * in the config.baningInformation.UPD.accounts
	 * @param from - an optional start date of the period to fetch the statements for
	 * @param to - an optional end date of the period to fetch the statements for
	 * @returns an account statements response containing an array of statements
	 */
	async getCreditCardStatements(account: AccountRef, from?: Date): Promise<StatementResponse> {
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
			[DKKKU.Id],
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
}
