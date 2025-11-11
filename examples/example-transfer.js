// Beispiel: SEPA-Überweisung mit lib-fints

import { FinTSClient, FinTSConfig } from './dist/index.js';

async function testTransfer() {
  // 1. Config erstellen (mit gespeicherten BankingInformation wenn vorhanden)
  const config = FinTSConfig.forFirstTimeUse(
    process.env.FINTS_PRODUCT_ID,
    '1.0',
    process.env.FINTS_BANK_URL,
    process.env.FINTS_BANK_ID,
    process.env.FINTS_USER_ID,
    process.env.FINTS_PIN
  );

  // Optional: Debug aktivieren
  config.debugEnabled = true;

  const client = new FinTSClient(config);

  try {
    // 2. Synchronisierung
    console.log('Synchronisiere mit Bank...');
    let syncResponse = await client.synchronize();

    if (syncResponse.requiresTan) {
      // TAN-Behandlung hier...
      console.log('TAN erforderlich:', syncResponse.tanChallenge);
      return;
    }

    if (!syncResponse.success) {
      console.error('Sync fehlgeschlagen:', syncResponse.bankAnswers);
      return;
    }

    // TAN-Methode wählen für zweite Sync
    if (config.bankingInformation?.bpd?.availableTanMethodIds?.length) {
      client.selectTanMethod(config.bankingInformation.bpd.availableTanMethodIds[0]);
      syncResponse = await client.synchronize();
    }

    // 3. Konten anzeigen
    const accounts = config.bankingInformation?.upd?.bankAccounts || [];
    console.log('\n=== Verfügbare Konten ===');
    accounts.forEach((account, idx) => {
      const canTransfer = client.canTransfer(account.accountNumber);
      console.log(`${idx + 1}. ${account.iban} - Überweisungen: ${canTransfer ? '✓' : '✗'}`);
    });

    // 4. Prüfe ob SEPA-Überweisungen generell unterstützt werden
    const bankSupportsTransfer = client.canTransfer();
    console.log('\n=== SEPA-Überweisung ===');
    console.log('Bank unterstützt HKCCS:', bankSupportsTransfer);

    if (!bankSupportsTransfer) {
      console.log('Bank unterstützt keine SEPA-Überweisungen über FinTS!');
      return;
    }

    // 5. Überweisung vorbereiten (NICHT AUSFÜHREN ohne Bestätigung!)
    const transferRequest = {
      recipientName: 'Max Mustermann',
      recipientIban: 'DE89370400440532013000',
      recipientBic: 'COBADEFFXXX', // optional
      amount: 0.01, // Testbetrag!
      currency: 'EUR',
      purpose: 'Test Überweisung - NICHT AUSFÜHREN',
      endToEndId: 'TEST-001',
    };

    console.log('\n⚠️  Überweisung VORBEREITET (nicht ausgeführt):');
    console.log(`   An: ${transferRequest.recipientName}`);
    console.log(`   IBAN: ${transferRequest.recipientIban}`);
    console.log(`   Betrag: ${transferRequest.amount} ${transferRequest.currency}`);
    console.log(`   Zweck: ${transferRequest.purpose}`);

    // KOMMENTIERE DIE FOLGENDEN ZEILEN EIN, UM WIRKLICH ZU ÜBERWEISEN:
    /*
    console.log('\n⚠️  FÜHRE ÜBERWEISUNG AUS...');
    let transferResponse = await client.transfer(accounts[0].accountNumber, transferRequest);

    if (transferResponse.requiresTan) {
      // Hier TAN vom User anfordern
      const tan = await getTanFromUser(transferResponse.tanChallenge);
      transferResponse = await client.transferWithTan(transferResponse.tanReference, tan);
    }

    if (transferResponse.success) {
      console.log('✅ Überweisung erfolgreich!');
      if (transferResponse.referenceNumber) {
        console.log('Referenz:', transferResponse.referenceNumber);
      }
    } else {
      console.error('❌ Überweisung fehlgeschlagen:');
      transferResponse.bankAnswers.forEach(answer => {
        console.error(`  [${answer.code}] ${answer.text}`);
      });
    }
    */

  } catch (error) {
    console.error('Fehler:', error);
  }
}

// Nur Info anzeigen, keine echte Überweisung
testTransfer();
