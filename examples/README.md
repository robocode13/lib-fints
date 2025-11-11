# Examples

This folder contains example scripts demonstrating how to use the SEPA credit transfer functionality.

## Files

### verify-transfer-implementation.js

Quick verification script that checks if all transfer-related methods and types are properly exported and available.

**Usage:**
```bash
pnpm build
node examples/verify-transfer-implementation.js
```

### example-transfer.js

Comprehensive example showing how to:
- Initialize FinTS client
- Synchronize with bank
- Check if SEPA transfers are supported
- Prepare a transfer (NOT executed by default)
- Handle TAN authentication

**Usage:**
```bash
# Set environment variables
export FINTS_PRODUCT_ID="your-product-id"
export FINTS_BANK_URL="https://..."
export FINTS_BANK_ID="12345678"
export FINTS_USER_ID="username"
export FINTS_PIN="pin"

# Run example
pnpm build
node examples/example-transfer.js
```

⚠️ **Important:** The example script is configured to NOT execute actual transfers by default. Uncomment the relevant sections in the code if you want to test real transfers (use with caution and only on test accounts!).

## Integration

To use the transfer functionality in your application:

```typescript
import { FinTSClient, TransferRequest, TransferResponse } from 'lib-fints';

const transfer: TransferRequest = {
  recipientName: 'John Doe',
  recipientIban: 'DE89370400440532013000',
  recipientBic: 'COBADEFFXXX', // optional for SEPA
  amount: 100.00,
  currency: 'EUR',
  purpose: 'Invoice 12345',
  endToEndId: 'TXN-001', // optional
};

// Check support
if (client.canTransfer(accountNumber)) {
  // Execute transfer
  let response = await client.transfer(accountNumber, transfer);

  // Handle TAN if required
  if (response.requiresTan) {
    const tan = await getTanFromUser(response.tanChallenge);
    response = await client.transferWithTan(response.tanReference!, tan);
  }

  // Check result
  if (response.success) {
    console.log('Transfer successful!');
    if (response.referenceNumber) {
      console.log('Reference:', response.referenceNumber);
    }
  }
}
```
