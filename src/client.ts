import { Dialog } from './dialog.js';
import { StatementInteractionMT940 } from './interactions/statementInteractionMT940.js';
import { StatementInteractionCAMT } from './interactions/statementInteractionCAMT.js';
import { StatementResponse } from './interactions/customerInteraction.js';
import { AccountBalanceResponse, BalanceInteraction } from './interactions/balanceInteraction.js';
import { PortfolioResponse, PortfolioInteraction } from './interactions/portfolioInteraction.js';
import { FinTSConfig } from './config.js';
import { ClientResponse, CustomerOrderInteraction } from './interactions/customerInteraction.js';
import { TanMethod } from './tanMethod.js';
import { HKSAL } from './segments/HKSAL.js';
import { HKKAZ } from './segments/HKKAZ.js';
import { HKCAZ } from './segments/HKCAZ.js';
import { HKWPD } from './segments/HKWPD.js';
import { DKKKU } from './segments/DKKKU.js';
import { InitResponse } from './interactions/initDialogInteraction.js';
import { CreditCardStatementInteraction } from './interactions/creditcardStatementInteraction.js';
import { HKIDN } from './segments/HKIDN.js';

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
    const response = await this.startCustomerOrderInteraction(new BalanceInteraction(accountNumber));
    return response as AccountBalanceResponse;
  }

  /**
   * Continues the account balance fetching when a TAN is required
   * @param tanReference The TAN reference provided in the first call's response
   * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
   * @returns the account balance response
   */
  async getAccountBalanceWithTan(tanReference: string, tan?: string): Promise<AccountBalanceResponse> {
    return (await this.continueCustomerInteractionWithTan([HKSAL.Id], tanReference, tan)) as AccountBalanceResponse;
  }

  /**
   * Checks if the bank supports fetching account statements in general or for the given account number when provided
   * @param accountNumber when the account number is provided, checks if the account supports fetching of statements
   * @returns true if the bank (and account) supports fetching account statements
   */
  canGetAccountStatements(accountNumber?: string): boolean {
    if (accountNumber) {
      // Check if either CAMT or MT940 is supported for this account
      return (
        this.config.isAccountTransactionSupported(accountNumber, HKCAZ.Id) ||
        this.config.isAccountTransactionSupported(accountNumber, HKKAZ.Id)
      );
    } else {
      // Check if either CAMT or MT940 is supported by the bank
      return this.config.isTransactionSupported(HKCAZ.Id) || this.config.isTransactionSupported(HKKAZ.Id);
    }
  }

  /**
   * Fetches the account statements for the given account number
   * @param accountNumber - the account number to fetch the statements for, must be an account available in the config.baningInformation.UPD.accounts
   * @param from - an optional start date of the period to fetch the statements for
   * @param to - an optional end date of the period to fetch the statements for
   * @param preferCamt - whether to prefer CAMT format over MT940 when both are supported (default: true)
   * @returns an account statements response containing an array of statements
   */
  async getAccountStatements(
    accountNumber: string,
    from?: Date,
    to?: Date,
    preferCamt: boolean = true
  ): Promise<StatementResponse> {
    // Check what formats the bank supports
    const camtSupported = this.config.isAccountTransactionSupported(accountNumber, 'HKCAZ');
    const mt940Supported = this.config.isAccountTransactionSupported(accountNumber, 'HKKAZ');

    if (!camtSupported && !mt940Supported) {
      throw Error(`Account ${accountNumber} does not support account statements`);
    }

    // Choose format based on support and preference
    const useCAMT = (preferCamt && camtSupported) || (!mt940Supported && camtSupported);

    if (useCAMT) {
      return (await this.startCustomerOrderInteraction(
        new StatementInteractionCAMT(accountNumber, from, to)
      )) as StatementResponse;
    } else {
      return (await this.startCustomerOrderInteraction(
        new StatementInteractionMT940(accountNumber, from, to)
      )) as StatementResponse;
    }
  }

  /**
   * Continues the account statements fetching when a TAN is required
   * @param tanReference The TAN reference provided in the first call's response
   * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
   * @returns an account statements response containing an array of statements
   */
  async getAccountStatementsWithTan(tanReference: string, tan?: string): Promise<StatementResponse> {
    return (await this.continueCustomerInteractionWithTan(
      [HKCAZ.Id, HKKAZ.Id],
      tanReference,
      tan
    )) as StatementResponse;
  }

  /**
   * Checks if the bank supports fetching portfolio information in general or for the given account number when provided
   * @param accountNumber when the account number is provided, checks if the account supports fetching of portfolio information
   * @returns true if the bank (and account) supports fetching portfolio information
   */
  canGetPortfolio(accountNumber?: string): boolean {
    return accountNumber
      ? this.config.isAccountTransactionSupported(accountNumber, HKWPD.Id)
      : this.config.isTransactionSupported(HKWPD.Id);
  }

  /**
   * Fetches the portfolio information for the given depot account number
   * @param accountNumber - the depot account number to fetch the portfolio for, must be an account available in the config.bankingInformation.UPD.accounts
   * @param currency - optional currency filter for the portfolio statement
   * @param priceQuality - optional price quality filter ('1' for real-time, '2' for delayed)
   * @param maxEntries - optional maximum number of entries to retrieve
   * @returns a portfolio response containing holdings and total value
   */
  async getPortfolio(
    accountNumber: string,
    currency?: string,
    priceQuality?: '1' | '2',
    maxEntries?: number
  ): Promise<PortfolioResponse> {
    return (await this.startCustomerOrderInteraction(
      new PortfolioInteraction(accountNumber, currency, priceQuality, maxEntries)
    )) as PortfolioResponse;
  }

  /**
	 * Continues the portfolio fetching when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response

	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns a portfolio response containing holdings and total value
	 */
  async getPortfolioWithTan(tanReference: string, tan?: string): Promise<PortfolioResponse> {
    return (await this.continueCustomerInteractionWithTan([HKWPD.Id], tanReference, tan)) as PortfolioResponse;
  }

  /**
   * Checks if the bank supports fetching credit card statements in general or for the given account number
   * @param accountNumber when the account number is provided, checks if the account supports fetching of statements
   * @returns true if the bank (and account) supports fetching credit card statements
   */
  canGetCreditCardStatements(accountNumber?: string): boolean {
    return accountNumber
      ? this.config.isAccountTransactionSupported(accountNumber, DKKKU.Id)
      : this.config.isTransactionSupported(DKKKU.Id);
  }

  /**
   * Fetches the credit card statements for the given account number
   * @param accountNumber - the account number to fetch the statements for, must be a credit card account available
   * in the config.baningInformation.UPD.accounts
   * @param from - an optional start date of the period to fetch the statements for
   * @param to - an optional end date of the period to fetch the statements for
   * @returns an account statements response containing an array of statements
   */
  async getCreditCardStatements(accountNumber: string, from?: Date): Promise<StatementResponse> {
    return (await this.startCustomerOrderInteraction(
      new CreditCardStatementInteraction(accountNumber, from)
    )) as StatementResponse;
  }

  /**
   * Continues the credit card statements fetching when a TAN is required
   * @param tanReference The TAN reference provided in the first call's response
   * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
   * @returns a credit card statements response containing an array of statements
   */
  async getCreditCardStatementsWithTan(tanReference: string, tan?: string): Promise<StatementResponse> {
    return (await this.continueCustomerInteractionWithTan([DKKKU.Id], tanReference, tan)) as StatementResponse;
  }

  private async startCustomerOrderInteraction(interaction: CustomerOrderInteraction): Promise<ClientResponse> {
    this.currentDialog = new Dialog(this.config, false);
    this.currentDialog.addCustomerInteraction(interaction);
    const responses = await this.currentDialog.start();

    const response = responses.get(interaction.segId);
    if (response) {
      return response;
    } else {
      return [...responses.values()].at(-1)!;
    }
  }

  private async continueCustomerInteractionWithTan(
    segIds: string[],
    tanReference: string,
    tan?: string
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

    return [...responses.values()].at(-1)!;
  }
}
