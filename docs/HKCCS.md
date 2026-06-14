# HKCCS / HKIPZ — SEPA Credit Transfer

## What this is

`HKCCS` (Einreichung SEPA-Überweisung) is the FinTS 3.0 segment used to
initiate a single SEPA wire transfer. Together with its companion segment
`HKVPP` it forms the minimum writable payment surface of FinTS PIN/TAN.
`HKIPZ` is the SEPA Instant ("Echtzeitüberweisung", SCT Inst) variant.

`lib-fints` historically focused on read operations (balance, statements,
securities) and did not register these segments. They are now first-class
built-ins so consumers can issue transfers without patching `node_modules`
or doing deep `registry.set()` tricks at runtime.

## Why these are built-ins

Runtime registration against `registry.js` works in Node.js but breaks in
Deno: the `npm:` resolver enforces the package's `exports` field, and
without a wildcard subpath the deep import `lib-fints/dist/segments/registry.js`
is blocked. Every Deno-based consumer (edge functions, Deno Deploy,
Cloudflare Workers with Node compat) hits this the moment it tries to add
HKCCS. Baking the segments in removes the failure mode.

## Usage

```ts
import { Dialog, FinTSClient, FinTSConfig } from 'lib-fints';
import { CustomerOrderInteraction } from 'lib-fints/dist/interactions/customerInteraction.js';

class TransferInteraction extends CustomerOrderInteraction {
	constructor(
		private senderIban: string,
		private senderBic: string,
		private painXml: string,
		private bankResponses: { code: number; text: string }[],
	) {
		super('HKCCS', 'HIRMS');
	}

	createSegments(cfg: FinTSConfig) {
		const version = cfg.getMaxSupportedTransactionVersion('HKCCS') ?? 1;
		return [
			{
				header: { segId: 'HKVPP', segNr: 0, version: 1 },
				sepaDescriptor: 'urn:iso:std:iso:20022:tech:xsd:pain.002.001.10',
			},
			{
				header: { segId: 'HKCCS', segNr: 0, version },
				account: { iban: this.senderIban, bic: this.senderBic },
				sepaDescriptor: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09',
				sepaPainMessage: this.painXml,
			},
		];
	}

	handleResponse(_r: unknown, cr: { bankAnswers?: { code: number; text: string }[] }) {
		for (const a of cr.bankAnswers ?? []) {
			this.bankResponses.push({ code: a.code, text: a.text });
		}
	}
}
```

For SEPA Instant, submit `HKIPZ` in place of `HKCCS` (no `HKVPP` prefix is
required); settlement is asynchronous, so poll `HKIPS` until a terminal
state. See the inline documentation in `src/segments/HKIPZ.ts` for the full
set of bank response codes.

## Sparkasse Berlin quirks

Validated against real transfers on a Sparkasse Berlin account. The notes
below were observed on Sparkasse Berlin and may differ at other institutions.

### pain.001 version
Use `urn:iso:std:iso:20022:tech:xsd:pain.001.001.09` (version 9). Older
schemas are silently rejected.

### pain.002 descriptor in HKVPP
Declare `urn:iso:std:iso:20022:tech:xsd:pain.002.001.10` as the status
report descriptor. HKVPP must immediately precede HKCCS in the same
dialog — without it the bank rejects the whole submission before
processing the pain.001 payload.

### `ReqdExctnDt` sentinel
Sparkasse rejects real execution dates with code **9150** ("Ausführungsdatum
ungültig"). Use the sentinel `1999-01-01` to mean "execute immediately".
Example:

```xml
<ReqdExctnDt><Dt>1999-01-01</Dt></ReqdExctnDt>
```

### TAN method
pushTAN (method id **923**) is the only method currently accepted for
credit transfers. Poll for approval at ~3 s intervals; the bank's
internal timeout is around 120 s.

### Successful response signature
A completed transfer returns two HIRMS messages with code **10**:

```json
[
  { "code": 10, "text": "Nachricht entgegengenommen." },
  { "code": 10, "text": "Der Auftrag wurde entgegengenommen." }
]
```

### Failure codes worth handling explicitly
| Code | Meaning |
|------|---------|
| **3040** | Auftrag nur teilweise ausgeführt (partial execution — treat as failure) |
| **3945** | Freigabe kann nicht erteilt werden (pushTAN approval denied) |
| **9150** | Ausführungsdatum ungültig (use `1999-01-01` sentinel) |
| **9xxx** | Hard errors — abort the dialog |
