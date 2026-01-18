import type { BankAccount } from './bankAccount.js';
import type { BankingInformation } from './bankingInformation.js';
import { getSegmentDefinition } from './segments/registry.js';
import type { TanMethod } from './tanMethod.js';

/**
 * Configuration for the FinTS client
 */
export class FinTSConfig {
	bankingInformation: BankingInformation;
	debugEnabled = false;

	private constructor(
		public productId: string,
		public productVersion: string,
		private url?: string,
		private bankIdentification?: string,
		public userId?: string,
		public pin?: string,
		bankingInformation?: BankingInformation,
		public tanMethodId?: number,
		public tanMediaName?: string,
		public customerId?: string,
		private country = 280,
	) {
		if (!productId) {
			throw Error('productId needs to be provided in configuration');
		}

		if (!bankingInformation) {
			this.bankingInformation = {
				systemId: '0',
				bankMessages: [],
			};
		} else {
			this.bankingInformation = bankingInformation;
		}

		if (!this.bankingUrl) {
			throw Error('bank URL needs to be provided in configuration');
		}

		if (!this.countryCode) {
			throw Error('countryCode needs to be provided in configuration');
		}

		if (!this.bankId) {
			throw Error('bank ID (BLZ) needs to be provided in configuration');
		}

		if (tanMethodId) {
			this.selectTanMethod(tanMethodId);
		}

		if (tanMediaName) {
			this.selectTanMedia(tanMediaName);
		}
	}

	/**
	 * Factory method to create a configuration for the first time use i.e. no previous banking information is available
	 * @param productId The product ID obtained by registering with ZKA, see https://www.hbci-zka.de/register/prod_register.htm
	 * @param productVersion The version of your end product
	 * @param url The banks FinTS endpoint URL
	 * @param bankId The bank ID (BLZ)
	 * @param userId The user ID
	 * @param pin The PIN to authenticate the user
	 * @param customerId An optional customer ID when this is not the same as the user ID
	 * @param countryCode The country code of the bank, defaults to 280 (Germany)
	 * @returns a FinTS configuration
	 */
	static forFirstTimeUse(
		productId: string,
		productVersion: string,
		url: string,
		bankId: string,
		userId?: string,
		pin?: string,
		customerId?: string,
		countryCode: number = 280,
	): FinTSConfig {
		return new FinTSConfig(
			productId,
			productVersion,
			url,
			bankId,
			userId,
			pin,
			undefined,
			undefined,
			undefined,
			customerId,
			countryCode,
		);
	}

	/**
	 * Factory method to create a configuration from existing banking information
	 * @param productId The product ID obtained by registering with ZKA, see https://www.hbci-zka.de/register/prod_register.htm
	 * @param productVersion The version of your end product
	 * @param bankingInformation The banking information obtained from a previous synchronization
	 * @param userId The user ID
	 * @param pin The PIN to authenticate the user
	 * @param tanMethodId The ID of the TAN method to use, see config.availableTanMethods
	 * @param tanMediaName The name of the TAN media to use, see config.selectedTanMethod.activeTanMedia
	 * @param customerId An optional customer ID when this is not the same as the user ID
	 * @param countryCode The country code of the bank, defaults to 280 (Germany)
	 * @returns a FinTS configuration
	 */
	static fromBankingInformation(
		productId: string,
		productVersion: string,
		bankingInformation: BankingInformation,
		userId?: string,
		pin?: string,
		tanMethodId?: number,
		tanMediaName?: string,
		customerId?: string,
		countryCode: number = 280,
	): FinTSConfig {
		return new FinTSConfig(
			productId,
			productVersion,
			undefined,
			undefined,
			userId,
			pin,
			bankingInformation,
			tanMethodId,
			tanMediaName,
			customerId,
			countryCode,
		);
	}

	/**
	 * The FinTS URL of the bank
	 */
	get bankingUrl(): string {
		return this.bankingInformation.bpd?.url ?? this.url ?? '';
	}

	/**
	 * The country code of the bank
	 */
	get countryCode(): number {
		return this.bankingInformation.bpd?.countryCode ?? this.country ?? 280;
	}

	/**
	 * The bank ID (BLZ)
	 */
	get bankId(): string {
		return this.bankingInformation.bpd?.bankId ?? this.bankIdentification ?? '';
	}

	/**
	 * A list of all available TAN methods for the user
	 */
	get availableTanMethods(): TanMethod[] {
		return (
			this.bankingInformation.bpd?.supportedTanMethods?.filter((m) =>
				this.bankingInformation.bpd?.availableTanMethodIds?.includes(m.id),
			) ?? []
		);
	}

	/**
	 * Selects a TAN method by its ID for the user, see also FinTSConfig#availableTanMethods
	 * @param tanMethodId The ID of the TAN method to select, corresponding to an ID in availableTanMethods
	 */
	selectTanMethod(tanMethodId: number): TanMethod {
		const tanMethod = this.availableTanMethods.find((method) => method.id === tanMethodId);
		if (!tanMethod) {
			throw new Error(`TAN Method '${tanMethodId}' is not supported`);
		}

		this.tanMethodId = tanMethodId;
		return tanMethod;
	}

	/**
	 * Selects a TAN media by its name for the user
	 * @param tanMediaName The name of the TAN media, corresponding to a name in selectedTanMethod.activeTanMedia
	 */
	selectTanMedia(tanMediaName: string) {
		if (tanMediaName && !this.tanMethodId) {
			throw new Error('tanMediaName can only be used when a TAN method is also selected');
		}

		if (tanMediaName && !this.selectedTanMethod?.activeTanMedia?.includes(tanMediaName)) {
			throw new Error(
				`TAN media '${tanMediaName}' not found in the active TAN media list for the selected TAN method`,
			);
		}

		this.tanMediaName = tanMediaName;
	}

	/**
	 * The currently selected TAN method for the user
	 */
	get selectedTanMethod(): TanMethod | undefined {
		return this.availableTanMethods.find((t) => t.id === this.tanMethodId);
	}

	/**
	 * Gets the transaction parameters for a specific transaction ID
	 * @param transId The transaction ID
	 * @returns The transaction parameters or undefined if not available
	 */
	getTransactionParameters<T>(transId: string): T | undefined {
		const transaction = this.bankingInformation.bpd?.allowedTransactions.find(
			(t) => t.transId === transId,
		);
		return transaction?.params as T | undefined;
	}

	/**
	 * Checks if a transaction is supported by the bank
	 * @param transId The transaction ID
	 */
	isTransactionSupported(transId: string): boolean {
		return (
			this.bankingInformation.bpd?.allowedTransactions.find((t) => t.transId === transId) !==
			undefined
		);
	}

	/**
	 * Checks if a transaction is supported for a specific account
	 * @param accountNumber The account number
	 * @param transId The transaction ID
	 */
	isAccountTransactionSupported(accountNumber: string, transId: string): boolean {
		const bankAccount = this.getBankAccount(accountNumber);
		return !!bankAccount.allowedTransactions?.find((t) => t.transId === transId);
	}

	/**
	 * Gets the maximum supported transaction version of a transaction, considering this client's support and the bank's support
	 * @param transId The transaction ID
	 */
	getMaxSupportedTransactionVersion(transId: string): number | undefined {
		const definition = getSegmentDefinition(transId);

		if (!definition) {
			throw new Error(`segment definition for ${transId} not registered`);
		}

		const allowedVersions =
			this.bankingInformation.bpd?.allowedTransactions.find((t) => t.transId === transId)
				?.versions ?? [];
		const maxSupportedversion =
			allowedVersions.sort().findLast((version) => version <= definition.version) ?? undefined;

		return maxSupportedversion;
	}

	/**
	 * Gets the bank account information for a specific account number
	 * @param accountNumber The account number
	 */
	getBankAccount(accountNumber: string): BankAccount {
		const bankAccount = this.bankingInformation.upd?.bankAccounts.find(
			(a) => a.accountNumber === accountNumber,
		);

		if (!bankAccount) {
			throw Error(`Account ${accountNumber} not found in UPD`);
		}

		return bankAccount;
	}
}
