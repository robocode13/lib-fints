import { Dialog } from './dialog.js';
import { HKTAB } from './segments/HKTAB.js';
import { StatementResponse, StatementInteraction } from './interactions/statementInteraction.js';
import { AccountBalanceResponse, BalanceInteraction } from './interactions/balanceInteraction.js';
import { FinTSConfig } from './config.js';
import { ClientResponse, CustomerInteraction, CustomerOrderInteraction } from './interactions/customerInteraction.js';
import { TanMediaInteraction, TanMediaResponse } from './interactions/tanMediaInteraction.js';
import { TanMethod } from './tanMethod.js';
import { HKSAL } from './segments/HKSAL.js';
import { HKKAZ } from './segments/HKKAZ.js';
import { InitDialogInteraction, InitResponse } from './interactions/initDialogInteraction.js';

export interface SynchronizeResponse extends InitResponse {}

/**
 * A client to communicate with a bank over the FinTS protocol
 */
export class FinTSClient {
	private openCustomerInteractions = new Map<string, CustomerInteraction>();

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
		this.config.selectTanMethod(tanMethodId);
		return this.config.selectedTanMethod!;
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
		const dialog = new Dialog(this.config);

		const syncResponse = await this.initDialog(dialog, true);

		if (!syncResponse.success || syncResponse.requiresTan) {
			return syncResponse;
		}

		if (this.config.selectedTanMethod && this.config.isTransactionSupported(HKTAB.Id)) {
			const tanMediaResponse = await dialog.startCustomerOrderInteraction<TanMediaResponse>(new TanMediaInteraction());

			let tanMethod = this.config.selectedTanMethod;
			if (tanMethod) {
				tanMethod.activeTanMedia = tanMediaResponse.tanMediaList;
			}

			syncResponse.bankAnswers.push(...tanMediaResponse.bankAnswers);
		}

		await dialog.end();
		return syncResponse;
	}

	/**
	 * Continues the synchronization transaction when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response
	 * @param tan The TAN entered by the user
	 * @returns the synchronization response
	 */
	async synchronizeWithTan(tanReference: string, tan: string): Promise<SynchronizeResponse> {
		return this.continueCustomerInteractionWithTan(tanReference, tan);
	}

	/**
	 * Checks if the bank supports fetching an account balance in general or for the given account number when provided
	 * @param accountNumber when the account number is provided, checks if the account supports fetching the balance
	 * @returns true if the bank (and account) supports fetching the account balance
	 */
	canGetAccountBalance(accountNumber?: string): boolean {
		return accountNumber
			? this.config.isAccountTransactionSupported(accountNumber, HKSAL.Id)
			: this.config.isTransactionSupported(HKSAL.Id);
	}

	/**
	 * Fetches the account balance for the given account number
	 * @param accountNumber - the account number to fetch the balance for, must be an account available in the config.baningInformation.UPD.accounts
	 * @returns the account balance response
	 */
	async getAccountBalance(accountNumber: string): Promise<AccountBalanceResponse> {
		return this.startCustomerOrderInteraction(new BalanceInteraction(accountNumber));
	}

	/**
	 * Continues the account balance fetching when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response
	 * @param tan The TAN entered by the user
	 * @returns the account balance response
	 */
	async getAccountBalanceWithTan(tanReference: string, tan: string): Promise<AccountBalanceResponse> {
		return this.continueCustomerInteractionWithTan(tanReference, tan);
	}

	/**
	 * Checks if the bank supports fetching account statements in general or for the given account number when provided
	 * @param accountNumber when the account number is provided, checks if the account supports fetching of statements
	 * @returns true if the bank (and account) supports fetching account statements
	 */
	canGetAccountStatements(accountNumber?: string): boolean {
		return accountNumber
			? this.config.isAccountTransactionSupported(accountNumber, HKKAZ.Id)
			: this.config.isTransactionSupported(HKKAZ.Id);
	}

	/**
	 * Fetches the account statements for the given account number
	 * @param accountNumber - the account number to fetch the statements for, must be an account available in the config.baningInformation.UPD.accounts
	 * @param from - an optional start date of the period to fetch the statements for
	 * @param to - an optional end date of the period to fetch the statements for
	 * @returns an account statements response containing an array of statements
	 */
	async getAccountStatements(accountNumber: string, from?: Date, to?: Date): Promise<StatementResponse> {
		return this.startCustomerOrderInteraction(new StatementInteraction(accountNumber, from, to));
	}

	/**
	 * Continues the account statements fetching when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response
	 * @param tan The TAN entered by the user
	 * @returns an account statements response containing an array of statements
	 */
	async getAccountStatementsWithTan(tanReference: string, tan: string): Promise<StatementResponse> {
		return this.continueCustomerInteractionWithTan(tanReference, tan);
	}

	private async startCustomerOrderInteraction<TClientResponse extends ClientResponse>(
		interaction: CustomerOrderInteraction
	): Promise<TClientResponse> {
		const dialog = new Dialog(this.config);
		const syncResponse = await this.initDialog(dialog, false, interaction);

		if (!syncResponse.success || syncResponse.requiresTan) {
			return syncResponse as TClientResponse;
		}

		const clientResponse = await dialog.startCustomerOrderInteraction<TClientResponse>(interaction);

		if (clientResponse.requiresTan) {
			this.openCustomerInteractions.set(clientResponse.tanReference!, interaction);
		} else {
			await dialog.end();
		}

		return clientResponse;
	}

	private async continueCustomerInteractionWithTan<TClientResponse extends ClientResponse>(
		tanReference: string,
		tan: string
	): Promise<TClientResponse> {
		const interaction = this.openCustomerInteractions.get(tanReference);

		if (!interaction) {
			throw new Error('No open customer interaction found for TAN reference: ' + tanReference);
		}

		const dialog = interaction.dialog!;
		let responseMessage = await dialog.sendTanMessage(interaction.segId, tanReference, tan);
		let clientResponse = interaction.getClientResponse(responseMessage) as TClientResponse;

		this.openCustomerInteractions.delete(tanReference);

		if (!clientResponse.success) {
			await dialog.end();
			return clientResponse;
		}

		if (clientResponse.requiresTan) {
			this.openCustomerInteractions.set(clientResponse.tanReference!, interaction);
			return clientResponse;
		}

		const initDialogInteraction = interaction as InitDialogInteraction;
		if (initDialogInteraction.followUpInteraction) {
			clientResponse = await dialog.startCustomerOrderInteraction<TClientResponse>(
				initDialogInteraction.followUpInteraction
			);

			if (clientResponse.requiresTan) {
				this.openCustomerInteractions.set(clientResponse.tanReference!, initDialogInteraction.followUpInteraction);
				return clientResponse;
			}
		}

		await dialog.end();
		return clientResponse;
	}

	private async initDialog(
		dialog: Dialog,
		syncSystemId = false,
		followUpInteraction?: CustomerOrderInteraction
	): Promise<InitResponse> {
		const interaction = new InitDialogInteraction(this.config, syncSystemId, followUpInteraction);
		const initResponse = await dialog.initialize(interaction);

		if (initResponse.requiresTan) {
			this.openCustomerInteractions.set(initResponse.tanReference!, interaction);
		}

		return initResponse;
	}
}
