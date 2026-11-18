[![Node.js CI with pnpm](https://github.com/robocode13/lib-fints/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/robocode13/lib-fints/actions/workflows/ci.yml)

# Lib-FinTS

A Typescript/Javascript client library for Online-Banking via the FinTS 3.0 protocol with PIN/TAN, supporting PSD2 and decoupled TAN methods.

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

Installation is straight forward by simply adding the npm package.

```
npm i lib-fints
```

**Dependencies**: The library includes the `fast-xml-parser` package for robust CAMT statement parsing but has no other runtime dependencies.

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

// Account-specific methods accept either an account number or a BankAccount.
// Pass the account object when multiple accounts share the same number.

// fetch the current balance
const balanceResponse = await client.getAccountBalance(account);

// fetch all available statements
const statementResponse = await client.getAccountStatements(account);

// or fetch portfolio from a securities account
client.getPortfolio(account);
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

let response = await client.getAccountStatements(account);

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

**chipTAN optisch / flicker codes**

For chipTAN methods the bank sends the challenge data for the TAN generator in the HITAN segment. The response exposes it unchanged as `tanChallengeHhdUc` (a string with the HHD 1.3/1.4 start code and data elements), so that a client can render the optical flicker animation; `tanPhoto` only applies to photoTAN banks that put an image container into the same field.

### SEPA credit transfers

Until transfers were added, this library only read data from the bank. `transfer()` deliberately changes that: it is the only method that can move money. All other methods still only read, so an application that never calls `transfer()` never sends an order that moves money.

A transfer is a single SEPA credit transfer (HKCCS), executed as soon as possible. Where the bank requires Verification of Payee (VoP) for transfers, as all banks in the euro area must since October 2025, the bank first checks the payee's name against the IBAN, and the application gets the result before the transfer can be executed:

```typescript
if (!client.canTransfer(account)) {
  return;
}

let response = await client.transfer(account, {
  name: 'Max Mustermann',
  iban: 'DE02120300000000202051',
  amount: 42.5,
  purpose: 'Invoice 2026-001',
  endToEndId: 'INVOICE-2026-001',
});

if (response.requiresVopConfirmation) {
  const vop = response.vop!;
  console.log(`Verification of Payee: ${vop.result}`);
  if (vop.suggestedName) {
    console.log(`The payee's bank holds the name ${vop.suggestedName}`);
  }
  // the bank's notice must be shown before the user decides
  console.log(vop.notice);

  if ((await rl.question('Send the transfer anyway? (yes/no) ')) !== 'yes') {
    await client.cancelTransfer(response.transferId);
    return;
  }
  response = await client.confirmTransfer(response.transferId);
}

while (response.requiresTan) {
  // with a decoupled TAN method, the user approves in the app and just presses enter
  const tan = await rl.question(response.tanChallenge + ': ');
  response = await client.transferWithTan(response.tanReference!, tan || undefined);
}

if (response.success) {
  console.log(`The bank accepted the transfer ${response.endToEndId}`);
} else {
  console.log(response.failureReason, response.bankAnswers);
}
```

Each call returns a `TransferResponse`:

| Response                                   | Meaning                                                                 | Next call                               |
| ------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------- |
| `success` and `requiresVopConfirmation`    | The bank has checked the payee and waits for a decision; see `vop`      | `confirmTransfer(transferId)` or `cancelTransfer(transferId)` |
| `success` and `requiresTan`                | The bank asks for the TAN                                               | `transferWithTan()` or `cancelTransfer(transferId)` |
| `success`, neither flag                    | The bank has accepted the transfer                                      | -                                       |
| `success: false`                           | The transfer stopped; `failureReason` and `bankAnswers` say why         | -                                       |
| `success: false` and `outcomeUncertain`    | The bank did not say whether it executed the transfer (such as code 9000, or 0020 next to an error) | Check the account before sending it again |

The transfer is done only when `success` is true and neither `requiresTan` nor `requiresVopConfirmation` is.

The result in `vop`:

| `vop.result`    | Code | Meaning                                                                                  |
| --------------- | ---- | ---------------------------------------------------------------------------------------- |
| `match`         | RCVC | The name matches the account                                                             |
| `closeMatch`    | RVMC | The name almost matches; `suggestedName` is the name the payee's bank holds              |
| `noMatch`       | RVNM | The name does not match                                                                  |
| `notApplicable` | RVNA | The check was not possible, for example because the payee's bank does not take part     |

`vop.notice` is the bank's explanation of what authorising a transfer despite a deviation means; the DK specification requires showing it before the user decides. Authorising anyway may send the money to someone else, and the payer's bank is then not liable for that.

Things to know before using it:

- **Nothing is confirmed automatically.** The library never calls `confirmTransfer()` itself. For a match, banks usually ask for the TAN straight away; a bank that still asks for a confirmation of a match may be confirmed by the application without asking the user again. Every other result needs the user's decision.
- **The first call can be final.** A bank may execute the transfer without a confirmation and without a TAN, for example after a match when it requires no strong authentication (codes 3091 and 3076). Call `transfer()` only once the user has decided to send the money.
- **Input is checked, never changed.** `transfer()` throws a `SepaValidationError` naming the `field` before anything is sent: the IBAN (its characters, the length for its country and the check digits), the BIC, the amount (positive, at most two decimal places, at most 999,999,999.99 EUR), the lengths and the allowed characters. Nothing is transliterated or shortened.
- **Unexpected answers stop the transfer.** An unknown result code, a missing VoP ID or another answer the library does not expect ends the transfer with `success: false` and the bank answers, instead of guessing.
- **An exception after the first message leaves the outcome unknown.** If, for example, the connection fails while the order is at the bank, the bank may have executed it. Check the account (the `endToEndId` identifies the transfer) before sending it again.
- **One transfer at a time.** A client handles one transfer at a time, in its own dialog, which stays open while the client waits for the decision or the TAN. Banks end idle dialogs after some minutes. Every response carries the `transferId` of its transfer; `confirmTransfer()` and `cancelTransfer()` take it, and `transferWithTan()` takes only the `tanReference` of the challenge outstanding, so that a late decision cannot act on another transfer. A call made while the previous one still waits for the bank throws without sending anything.
- **Synchronize once after upgrading.** A `bankingInformation` saved by an earlier release of this library lacks the bank's Verification of Payee parameters (HIVPPS), and `canTransfer()` stays false without them. `synchronize()` then asks the bank for its whole BPD again, keeping the system ID; persist the updated `bankingInformation` afterwards.
- **Asynchronous checks are polled for up to 60 seconds.** Some banks deliver the VoP result only after a while; `transfer()` waits as long as the bank says before asking again, and stops the transfer, unexecuted, when it would have to wait more than 60 seconds in total.

The transfer flow has been tested against mocked bank answers only. The behaviour of individual banks it handles comes from the DK specification and from what other FinTS libraries report; reports from real banks are welcome.

The pain.001 builder (`buildPain001()`) and the pain.002 parser (`parsePain002()`) are exported for applications that need them on their own.

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

## Supported Transactions

The following table shows all transactions supported by the FinTSClient interface:

| Transaction                | Method                                                               | Description                                                                     | FinTS Segment(s)           | TAN Support | Account-Specific |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------- | ----------- | ---------------- |
| **Synchronization**        | `synchronize()`                                                      | Synchronizes bank and account information, updating config.bankingInformation   | HKIDN, HKVVB, HKSYN, HKTAB | ✓           | ❌               |
| **Account Balance**        | `getAccountBalance(account: AccountRef)`                              | Fetches the current balance for a specific account                              | HKSAL                      | ✓           | ✓                |
| **Account Statements**     | `getAccountStatements(account: AccountRef, from?, to?)`               | Fetches account transactions/statements for a date range (MT940 or CAMT format) | HKKAZ, HKCAZ               | ✓           | ✓                |
| **Portfolio**              | `getPortfolio(account: AccountRef, currency?, priceQuality?, maxEntries?)` | Fetches securities portfolio information for depot accounts                  | HKWPD                      | ✓           | ✓                |
| **Credit Card Statements** | `getCreditCardStatements(account: AccountRef, from?, to?)`            | Fetches credit card statements for credit card accounts                         | HKKKU, DKKKU               | ✓           | ✓                |
| **Electronic Statements**  | `getElectronicStatements(account: AccountRef, options?)`              | Fetches the statement document from the electronic mailbox, usually a PDF       | HKEKA                      | ✓           | ✓                |
| **SEPA Credit Transfer**   | `transfer(account: AccountRef, transfer: CreditTransfer)`             | Sends a SEPA credit transfer, executed as soon as possible, with Verification of Payee where the bank requires it (see [SEPA credit transfers](#sepa-credit-transfers)) | HKCCS, HKVPP, HKVPA        | ✓           | ✓                |
| **TAN Method Selection**   | `selectTanMethod(tanMethodId)`                                       | Selects a TAN method by ID from available methods                               | -                          | ❌          | ❌               |
| **TAN Media Selection**    | `selectTanMedia(tanMediaName)`                                       | Selects a specific TAN media device by name                                     | -                          | ❌          | ❌               |

### Transaction Support Checking

For each account-specific transaction, the client provides corresponding `can*` methods to check if the bank or specific account supports the transaction:

| Support Check Method                         | Purpose                                                         |
| -------------------------------------------- | --------------------------------------------------------------- |
| `canGetAccountBalance(account?: AccountRef)`       | Checks if account balance fetching is supported                 |
| `canGetAccountStatements(account?: AccountRef)`    | Checks if account statements fetching is supported (MT940/CAMT) |
| `canGetPortfolio(account?: AccountRef)`            | Checks if portfolio information fetching is supported           |
| `canGetCreditCardStatements(account?: AccountRef)` | Checks if credit card statements fetching is supported          |
| `canGetElectronicStatements(account?: AccountRef)` | Checks if electronic account statements fetching is supported   |
| `canTransfer(account?: AccountRef)`                | Checks if SEPA credit transfers are supported                   |

### Transaction Parameters

The configuration object provides methods to access transaction-specific parameters and capabilities provided by the bank:

#### `config.getTransactionParameters<T>(transId: string): T | undefined`

Returns the bank-specific parameters for a transaction type, if available. These parameters contain transaction limits, supported formats, and other bank-specific constraints.

```typescript
// Get parameters for account statements (MT940)
const mt940Params = config.getTransactionParameters<HIKAZSParameter>('HKKAZ');

// Get parameters for account statements (CAMT)  
const camtParams = config.getTransactionParameters<HICAZSParameter>('HKCAZ');

// Get parameters for SEPA transactions
const sepaParams = config.getTransactionParameters<HISPASParameter>('HKSPA');
```

#### `config.isTransactionSupported(transId: string): boolean`

Checks whether a specific transaction type is supported by the bank.

```typescript
if (config.isTransactionSupported('HKWPD')) {
  console.log('Bank supports portfolio requests');
}
```

#### `config.isAccountTransactionSupported(account: AccountRef, transId: string): boolean`

Checks whether a specific transaction type is supported for a particular account.

```typescript
if (config.isAccountTransactionSupported(account, 'HKWPD')) {
  console.log('Account supports portfolio requests');
}
```

**Note**: Transaction IDs correspond to the FinTS segment names (e.g., 'HKKAZ' for account statements, 'HKWPD' for portfolio, 'HKSAL' for balance).

### TAN Continuation Methods

Every transaction that supports TAN authentication has a corresponding `*WithTan` method for continuing the transaction after TAN entry:

- `synchronizeWithTan(tanReference, tan?)`
- `getAccountBalanceWithTan(tanReference, tan?)`
- `getAccountStatementsWithTan(tanReference, tan?)`
- `getPortfolioWithTan(tanReference, tan?)`
- `getCreditCardStatementsWithTan(tanReference, tan?)`
- `transferWithTan(tanReference, tan?)`

The `tan` parameter can be omitted when using decoupled TAN methods.

A transfer can also stop for the user's decision on the Verification of Payee result, before any TAN; `confirmTransfer(transferId)` and `cancelTransfer(transferId)` continue it from there (see [SEPA credit transfers](#sepa-credit-transfers)).

## Limitations

- Only FinTS 3.0 is supported (older versions may not work)
- Only PIN/TAN security is supported (including decoupled TAN methods)
- The only payment is a single SEPA credit transfer executed as soon as possible; instant payments (HKIPZ), batch transfers (HKCCM), scheduled transfers (HKCSE), standing orders and direct debits are not supported yet

Implementing further transactions should be straight forward and contributions are highly appreciated

### Successfully tested with the following banks

- comdirect
- DKB
- ING-DiBa
- Renault Bank Direkt

## Built With

- [Typescript](https://www.typescriptlang.org/) - Programming Language
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) - XML parsing for CAMT statements and pain.002 payment status reports
- [Vitest](https://vitest.dev/) - Testing Framework
- [pnpm](https://pnpm.io/) - Package manager

## Contributing

Feel free to create an issue if you want to report a bug.

If you tested this library with some other bank it would be great to hear from you and update the information on this page

As this is a free-time project, a lot of things are still remaining which could be added to this library, especially other kinds of transactions. If you want to contribute with pull-requests this would be highly appreciated

## License

This project is licensed under the LGPL-2.1-or-later License - see the [LICENSE](LICENSE) file for details

## References

- [Product Registration](https://www.hbci-zka.de/register/prod_register.htm)
- [FinTS 3.0 Specification](https://www.hbci-zka.de/spec/3_0.htm)
