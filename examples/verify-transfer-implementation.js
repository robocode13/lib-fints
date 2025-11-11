// Schnelle Verifikation dass alles implementiert ist

import { FinTSClient } from './dist/index.js';

console.log('=== Verifikation der Transfer-Implementierung ===\n');

// Prüfe ob Client-Methoden existieren
const methodsToCheck = ['canTransfer', 'transfer', 'transferWithTan'];
const clientPrototype = FinTSClient.prototype;

let allMethodsExist = true;
methodsToCheck.forEach(method => {
  if (typeof clientPrototype[method] === 'function') {
    console.log(`✓ FinTSClient.${method}() existiert`);
  } else {
    console.error(`✗ FinTSClient.${method}() FEHLT!`);
    allMethodsExist = false;
  }
});

console.log('\n=== Methoden-Signaturen ===\n');
console.log('canTransfer(accountNumber?: string): boolean');
console.log('  - Prüft ob die Bank SEPA-Überweisungen unterstützt');
console.log('  - Optional: Prüft ob ein bestimmtes Konto Überweisungen unterstützt\n');

console.log('transfer(accountNumber: string, transfer: TransferRequest): Promise<TransferResponse>');
console.log('  - Führt eine SEPA-Überweisung aus');
console.log('  - Gibt TransferResponse zurück mit requiresTan=true wenn TAN erforderlich\n');

console.log('transferWithTan(tanReference: string, tan?: string): Promise<TransferResponse>');
console.log('  - Bestätigt die Überweisung mit TAN');
console.log('  - tan-Parameter optional bei decoupled TAN-Verfahren\n');

console.log('=== TransferRequest Interface ===\n');
console.log(`interface TransferRequest {
  recipientName: string;       // Name des Empfängers
  recipientIban: string;        // IBAN des Empfängers
  recipientBic?: string;        // BIC (optional für SEPA)
  amount: number;               // Betrag
  currency: string;             // Währung (z.B. 'EUR')
  purpose: string;              // Verwendungszweck
  endToEndId?: string;          // End-to-End Referenz (optional)
  debtorName?: string;          // Name Auftraggeber (optional)
}\n`);

console.log('=== TransferResponse Interface ===\n');
console.log(`interface TransferResponse extends ClientResponse {
  referenceNumber?: string;     // Referenznummer von der Bank
  // plus alle ClientResponse Felder:
  // - success: boolean
  // - requiresTan: boolean
  // - tanReference?: string
  // - tanChallenge?: string
  // - bankAnswers: BankAnswer[]
}\n`);

if (allMethodsExist) {
  console.log('✅ Alle Transfer-Komponenten sind implementiert und verfügbar!');
  console.log('\n📦 Integration in deine Anwendung:');
  console.log('   1. npm publish oder npm pack für lokale Installation');
  console.log('   2. In deiner App: npm install lib-fints@latest');
  console.log('   3. Verwende: import { FinTSClient, TransferRequest, TransferResponse } from "lib-fints"');
} else {
  console.error('\n❌ Einige Methoden fehlen!');
}
