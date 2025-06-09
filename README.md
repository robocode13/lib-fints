[![Node.js CI with pnpm](https://github.com/robocode13/lib-fints/actions/workflows/build-test.yml/badge.svg?branch=main)](https://github.com/robocode13/lib-fints/actions/workflows/build-test.yml)
# Lib-FinTS

A Typescript/Javascript client library for Online-Banking via the FinTS 3.0 protocol with PIN/TAN, supporting PSD2 and decoupled TAN methods. The library has no dependencies on other libraries

## Getting Started

These instructions will show you how to install the library on your local machine and give a quick sample of how to use the library

### Prerequisites

#### Product Registration

In order to communicate with banks via the FinTS protocol you have to register a product ID with the german banking industry (Deutsche Kreditwirtschaft) which you need to pass as part of the configuration to the client:

> In order to fulfill the PSD2 requirements regarding transparency about the software used by customers, the German Banking Industry has established a process for registering FinTS products in order to be able to provide customers with information regarding FinTS usage.
> FinTS product registration is currently offered free of charge by the German Banking Industry.

[ZKA Registration Website](https://www.fints.org/de/hersteller/produktregistrierung)

### Runtime Environment

The library is written in Typescript and compiled to the ES2022 Javascript language standard which means a minimum Node version of 18 is required.

**A note about Browsers:**
In theory the library is compatible with a browser environment, but communicating directly from the front-end with a bank server will, apart from security considerations, most likely fail because of the imposed CORS restrictions from web browsers and the lack of corresponding CORS headers in bank server responses.

### Installing

Installation is straight forward by simply adding the npm package. The package has no further dependencies on other packages.

```
npm i lib-fints
```

### Sample Usage

The main public API of this library is the `FinTSClient` class and `FinTSConfig` class. In order to instantiate the client you need to provide a configuration instance. There are basically two ways to initialize a configuration object, one is when you communicate with a bank for the first time and the other when you already have banking information from a prevous session available (more on that later).

If you don't have any previous banking information available you can use the static `forFirstTimeUse()` factory method like this:

```typescript
const config = FinTSConfig.forFirstTimeUse(productId, productVersion, bankUrl, bankId, userId, pin);

const client = new FinTSClient(config);
```

Then you should first make a synchronization call to get banking and account information:

```typescript
let syncResponse = await client.synchronize();
```

you should always check the `success` and `requiresTan` properties of any response object because other data might only be available when `success=true` and `requiresTan=false`.
in any case you can also check the `bankAnswers` array for return messages from the bank which may contain the reasons for a failed request.

If the call is successfull the response will contain a `bankingInformation` object filled with all the relevant information provided by the bank from synchronization:

```typescript
export type BankingInformation = {
	systemId: string;
	bpd?: BPD;
	upd?: UPD;
	bankMessages: BankMessage[];
};
```

The BPD object (_BankParameterDaten_) contains general information (e.g. available TAN methods and allowed transactions) and the UPD object (_UserParameterDaten_) user-specific information which is mainly the list of the user's bank accounts.

Unfortunately with this first synchronization call most banks will likely only return the BPA information but no UPD (accounts) information, which is needed to fetch balances or statements. The reason for this is that you need to specify a TAN method before making the synchronization call, but you can only know which TAN methods are available from the BPA? This is why you need to make a second synchronization call with a TAN method selected from the `availableTanMethodIds`in the BPA, returned from the first synchronization call:

```typescript
// for simplicity, we just select the first available TAN method
client.selectTanMethod(syncResponse.bankingInformation.BPD.availableTanMethodIds[0]);
```

now you can repeat the syncronization call from above and it will return additional data including the UPD with the account information.

Finally you can start fetching balances or statements:

```typescript
// for simplicity, use the first account
const account = syncResponse.bankingInformation.upd.bankAccounts[0];

// fetch the current balance
const balanceResponse = await client.getAccountBalance(account.accountNumber);

// fetch all available statements
const statementResponse = await client.getAccountStatements(account.accountNumber);

// or fetch portfolio from a securities account
client.getPortfolio(account.accountNumber);
```

These are only the most basic steps needed to retrieve information from the bank. There are still some unanswered questions like "how to handle TANs" or "how to avoid synchronizations every time you start a new session". These are explained in the corresponding sections below.

## More detailed API Description

### Handle TAN challenges from the bank

Most transactions may require authorization with a two step TAN process. As mentioned above in the sample, every response may set the `requiresTan`property to `true` which means that the response does not include the expected transaction data, but some additional TAN related properties. You first need to handle this TAN challenge by asking the user for the TAN and sending it back to the bank to continue the process and retrieve the actual transaction result:

```typescript
// we use the node readline interface later to ask the user for a TAN
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

let response = await client.getAccountStatements(account.accountNumber);

if (!response.success) {
	return;
}

// need to check if a TAN is required to continue the transaction
if (response.requiresTan) {
	// asking the user for the TAN, using the tanChallenge property
	const tan = await rl.question(response.tanChallenge + ': ');
	// continue the transaction by providing the tanReference from the response and the entered TAN
	response = await client.getAccountStatementsWithTan(response.tanReference!, tan);
}
```

The `FinTSClient`contains for every transaction method like `synchronize()` or `getAccountStatements()` a corresponding `...WithTan()` method which needs to be called to continue the transaction with the given `tanReference` returned in the first response. The response object of this second call should now contain all transaction related data, assuming `success=true`.

**Decoupled TAN methods**

The library now also supports decoupled TAN methods where you don't actually have to provide a TAN entered by a user, but the approval is done "decoupled" on another device (e.g. mobile phone via banking app). The procedure explained above is still very similar, `requiresTan` will signal a required approval and you can continue with one of the `...WithTan()` methods where you can ommit the last `tan` parameter.

You could ask the user to confirm that the approval was given and then continue with the call or periodically call the method until it returns the transaction result (`requiresTan=false` and `success=true`). The continuation methods will keep returning `requiresTan=true` as long as the user hasn't approved the transaction.

see also the `decoupled` property on the `TanMethod` object for related parameters given by the bank.

### Starting a session from saved banking information

As mentioned earlier there is a second way to initialize the `FinTSClient` with a `FinTSConfig` when you already performed a synchronization in a previous session and this is by providing the `bankingInformation` object received from previous uses. This `bankingInformation` object, which contains the general bank (BPD) and accounts information (UPD), should be persisted after a session and reloaded in the next session.
This not only saves you from making the same synchronization requests every time before making a transaction, but the sychronization will also assign a `systemId` (a property in `bankingInformation`) to your client which should stay the same once assigned.

```typescript
const config = FinTSConfig.fromBankingInformation(
	productId,
	productVersion,
	bankingInformation,
	userId,
	pin,
	tanMethodId,
	tanMediaName // when also needed (see below)
);
const client = new FinTSClient(config);
```

You should also set the TAN method to use, by using the optional `tanMethodId` and `tanMediaName` parameters or calling `client.selectTanMethod()` before making the first transaction.

#### Tan Media

It might be the case that you have more than one active TAN media available (like multiple mobile phones) and the bank requires you to also specify which TAN media to use.
You can find out if this is the case by inspecting the `TanMethod` object in the BPD.
You can get a list of all available TAN methods from the `config.availableTanMethods` property or if you already selected a TAN method with `config.selectedTanMethod`.

```typescript
export type TanMethod = {
	id: number;
	name: string;
	version: number;
	activeTanMediaCount: number;
	activeTanMedia: string[];
	tanMediaRequirement: TanMediaRequirement;
};
```

The `TanMethod` object contains a property `tanMediaRequirement` and if this is set to `TanMediaRequirement.Required`, you also need to select a TAN media, either by providing the name in the configuration factory method `FinTSConfig.fromBankingInformation()` or by using `client.selectTanMedia()`.

The property `activeTanMedia` contains a list of the TAN media names you can use for selection.

#### Banking Information may be updated any time

The `bankingInformation` is primarily obtained through the `synchronize()` calls as demonstrated above. However, it is possible that the banking information may have changed since the last synchronization call. To address this, the BPD and UPD are versioned, and with every transaction made, not just synchronizations, the currently used versions are provided to the bank. If any changes have occurred, the bank will send back new versions of the BPD and UPD respectively. This process is managed by the client, but it is essential to check the `bankingInformationUpdated` property, which is available in every response. This property indicates if there have been any changes, and it is important to persist the new version for future sessions. The most up-to-date version of the `bankingInformation` object can always be retrieved using `config.bankingInformation`.

### Debugging

If you need to debug issues and the `response.bankAnswers` don't provide enough information, you can enable debugging of messages with:

```typescript
config.debugEnabled = true;
```

This will print out all sent messages and received responses to the console in a structured format.

## Limitations

- Only FinTS 3.0 is supported (older versions may not work)
- Only PIN/TAN security is supported (inluding decoupled TAN methods)
- Currently only the following transactions are supported:
  - Synchronize bank and account information
  - Fetching account balances
  - Fetching account statements
  - Fetching the portfolio of a securities account

Implementing further transactions should be straight forward and contributions are highly appreciated

### Successfully tested with the following banks

- DKB
- ING-DiBa
- Renault Bank Direkt

## Built With

- [Typescript](https://www.typescriptlang.org/) - Programming Language
- [Vitest](https://vitest.dev/) - Testing Framework
- [pnpm](https://pnpm.io/) - Package manager

## Contributing

Feel free to create an issue if you want to report a bug.

If you tested this library with some other bank it would be great to hear from you and update the information on this page

As this is a free-time project, a lot of things are still remaining which could be added to this library, especially other kinds of transactions. If you want to contribute with pull-requests this would be highly appreciated

## License

This project is licensed under the LGPL 3.0 License - see the [LICENSE](LICENSE) file for details

## References

- [Product Registration](https://www.hbci-zka.de/register/prod_register.htm)
- [FinTS 3.0 Specification](https://www.hbci-zka.de/spec/3_0.htm)
