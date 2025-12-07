# FinTS Banking Protocol Library - AI Coding Guidelines

This TypeScript library implements the German FinTS 3.0 banking protocol for secure online banking communication with PIN/TAN authentication.

## Architecture Overview

### Core Components

- **`FinTSClient`**: Main API - handles account balances, statements, portfolios, and credit card data
- **`FinTSConfig`**: Configuration factory with two modes: `forFirstTimeUse()` and `fromBankingInformation()`
- **Segments**: FinTS protocol message units (see `src/segments/`) - each has request/response pairs (e.g., `HKSAL`/`HISAL`)
- **Interactions**: High-level transaction orchestrators (see `src/interactions/`) that combine multiple segments
- **Dialog**: Session management for multi-step TAN authentication flows

### Type System Pattern

The library implements a sophisticated encoding/decoding system:

- **DataElements** (`src/dataElements/`): Primitive types (Amount, Digits, Text, Binary, etc.)
- **DataGroups** (`src/dataGroups/`): Composite types (Account, Balance, Money, etc.)
- **Segments**: Protocol message definitions using DataElement/DataGroup compositions

### Critical Workflow: TAN Authentication

All transactions may require two-step TAN process:

```typescript
let response = await client.getAccountStatements(account);
if (response.requiresTan) {
	response = await client.getAccountStatementsWithTan(response.tanReference, userTAN);
}
```

## Development Patterns

### Segment Registration

All segments must be registered in `src/segments/registry.ts` - the `registerSegments()` call in `index.ts` is critical for protocol functionality.

### DataElement maxCount Rules

**Critical encoding constraint**: DataElements with `maxCount > 1` can only be the **last element** in a DataGroup or segment. This is a FinTS protocol requirement for proper parsing.

**Correct patterns**:

```typescript
// ✅ DataGroup with maxCount=1, internal element has maxCount>1 and is last
new DataGroup('acceptedFormats', [new Text('format', 1, 99)], 1, 1);

// ✅ Direct element with maxCount>1 as last element in segment
elements = [
	new Text('someField', 1, 1),
	new Binary('transactions', 0, 10000), // Last element can have maxCount>1
];
```

**Incorrect patterns**:

```typescript
// ❌ DataElement with maxCount>1 not as last element
elements = [
	new Text('formats', 1, 99), // maxCount>1 but not last!
	new YesNo('someFlag', 1, 1), // This breaks parsing
];
```

### Testing Approach

- Use Vitest with mock patterns for `Dialog.prototype` methods
- Mock external HTTP communication, not internal protocol logic
- Test files follow `*.test.ts` naming in `src/tests/`
- Run tests: `pnpm test`

### Error Handling

Bank communication errors come via `response.bankAnswers` array with numeric codes. Success/failure is indicated by `response.success` boolean, not exceptions.

### State Management

- `bankingInformation` contains session state (BPD/UPD) and should be persisted between sessions
- Check `bankingInformationUpdated` flag in responses and re-persist when true
- `systemId` assignment is permanent per bank relationship

## Key Integration Points

### Bank Communication Flow

1. **Initialization**: Create config → Initialize dialog → Send HKIDN/HKVVB/HKSYN segments
2. **TAN Method Selection**: Required before most transactions - available methods in BPD
3. **Transaction Execution**: Send business segment → Handle TAN challenge → Complete with TAN
4. **Session Cleanup**: Always call `dialog.end()` to properly close bank sessions

### Protocol Encoding Rules

- Messages use specific separators: `'` (segments), `+` (elements), `:` (sub-elements)
- Binary data uses `@length@data` format
- Escape character is `?` for literal separators
- See `parser.ts` and `encoder.ts`/`decoder.ts` for implementation details

### Transaction Support Matrix

Check capability with `can*()` methods (e.g., `canGetAccountBalance()`). Not all banks support all transactions.

## Development Commands

- **Build**: TypeScript compilation to ES2022
- **Test**: `pnpm test` (Vitest)
- **Dependencies**: Zero runtime dependencies - self-contained protocol implementation

## Important Constraints

- **FinTS 3.0 only** - older protocol versions not supported
- **PIN/TAN authentication only** - no certificate-based auth
- **No payment transactions** - read-only operations (balances, statements, portfolios)
- **German banking focus** - country code defaults to 280

When extending functionality, follow the established segment definition pattern and ensure proper registration in the registry.
