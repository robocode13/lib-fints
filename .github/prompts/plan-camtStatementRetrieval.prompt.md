# Plan: Implement CAMT based statement retrieval with intelligent fallback

Enhance existing statement retrieval methods to automatically prefer CAMT format when supported by the bank, falling back to MT940 (HKKAZ) when CAMT is not available or when CAMT parsing fails. This maintains the current API while providing better data quality when possible.

## Steps

1. **Create CAMT segment definitions** - Implement [`HKCAZ`](src/segments/HKCAZ.ts), [`HICAZ`](src/segments/HICAZ.ts), and [`HICAZS`](src/segments/HICAZS.ts) following the same patterns as [`HKKAZ`](src/segments/HKKAZ.ts)/[`HIKAZ`](src/segments/HIKAZ.ts)/[`HIKAZS`](src/segments/HIKAZS.ts)

2. **Build CAMT XML parser** - Create [`camtParser.ts`](src/camtParser.ts) using built-in `DOMParser` that implements the same `parse(): Statement[]` interface as [`Mt940Parser`](src/mt940parser.ts), mapping CAMT.053 XML to existing `Statement`, `Transaction`, and `Balance` interfaces

3. **Enhance StatementInteraction with format selection** - Modify [`statementInteraction.ts`](src/interactions/statementInteraction.ts) to check CAMT support using `config.isAccountTransactionSupported(accountNumber, HKCAZ.Id)`, preferring CAMT when available and falling back to MT940 when not supported or parsing fails

4. **Update capability checking** - Modify [`canGetAccountStatements()`](src/client.ts) method to return true if either CAMT or MT940 is supported using `config.isTransactionSupported()` and `config.isAccountTransactionSupported()`, maintaining backward compatibility

5. **Register segments and exports** - Add CAMT segments to [`registry.ts`](src/segments/registry.ts) and export new CAMT parser from [`index.ts`](src/index.ts) for consistency

6. **Add comprehensive tests** - Create test files for segments, parser, and enhanced interaction logic with format fallback scenarios including XML parsing error handling

## Further Considerations

The CAMT parser will map XML elements to existing fields (e.g., CAMT's structured creditor/debtor information to `remoteName`/`remoteAccountNumber`, ISO references to `e2eReference`/`mandateReference`) ensuring users get richer data when available while maintaining identical API surface.

## Implementation Details

### CAMT Segment Structure

- **HKCAZ**: Request segment similar to HKKAZ but for CAMT format
  - Same elements: account, date range, allAccounts, maxEntries, continuationMark
  - Different segment ID to indicate CAMT format preference
- **HICAZ**: Response segment containing CAMT.053 XML data
  - Binary field with CAMT XML content instead of MT940 text
- **HICAZS**: Business transaction parameters for HKCAZ
  - Similar to HIKAZS with CAMT-specific capabilities

### Format Selection Logic

```typescript
// In StatementInteraction.createSegments()
const supportsCamt = config.isAccountTransactionSupported(accountNumber, HKCAZ.Id);
const supportsMt940 = config.isAccountTransactionSupported(accountNumber, HKKAZ.Id);

if (supportsCamt) {
	// Use HKCAZ segment
} else if (supportsMt940) {
	// Use HKKAZ segment
} else {
	// Throw error - no statement format supported
}
```

### Error Handling Strategy

```typescript
// In StatementInteraction.handleResponse()
if (hicaz) {
	try {
		const parser = new CamtParser(hicaz.camtData);
		clientResponse.statements = parser.parse();
	} catch (error) {
		// If CAMT parsing fails and MT940 is supported, fallback
		if (config.isAccountTransactionSupported(accountNumber, HKKAZ.Id)) {
			// Retry with MT940 format
		} else {
			throw error;
		}
	}
}
```

### CAMT to Statement Mapping

- **Statement level**: Map CAMT account statement to `Statement`
- **Transaction level**: Map CAMT transaction entries to `Transaction[]`
- **Balance level**: Map CAMT balance information to `Balance`
- **Party information**: Map structured CAMT party data to `remoteName`/`remoteAccountNumber`
- **Reference handling**: Map CAMT references to existing reference fields

### Backward Compatibility

- Existing `canGetAccountStatements()` returns true if either format is supported
- `StatementResponse.statements` remains `Statement[]` type
- No new client methods - transparent upgrade
- All existing MT940 functionality preserved as fallback
