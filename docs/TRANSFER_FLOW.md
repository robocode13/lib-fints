# SEPA-Überweisung Ablauf mit lib-fints

## 📊 Übersicht: Schritt-für-Schritt

```
┌─────────────────────────────────────────────────────────────────┐
│                    1. INITIALISIERUNG                            │
├─────────────────────────────────────────────────────────────────┤
│ • FinTSClient erstellen                                          │
│ • Config mit Bankdaten laden                                     │
│ • Optional: Gespeicherte BankingInformation laden                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    2. SYNCHRONISATION                            │
├─────────────────────────────────────────────────────────────────┤
│ • client.synchronize()                                           │
│ • TAN-Methode auswählen                                          │
│ • Konten abrufen (UPD)                                           │
│ • BankingInformation speichern für nächstes Mal                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│               3. UNTERSTÜTZUNG PRÜFEN                            │
├─────────────────────────────────────────────────────────────────┤
│ • client.canTransfer() → Bank unterstützt HKCCS?                │
│ • client.canTransfer(accountNumber) → Konto erlaubt Überweisung?│
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              4. ÜBERWEISUNG VORBEREITEN                          │
├─────────────────────────────────────────────────────────────────┤
│ TransferRequest erstellen:                                       │
│   • recipientName (WICHTIG: Exakter Name für Namensabgleich!)   │
│   • recipientIban                                                │
│   • recipientBic (optional)                                      │
│   • amount                                                       │
│   • currency                                                     │
│   • purpose                                                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              5. ÜBERWEISUNG EINREICHEN                           │
├─────────────────────────────────────────────────────────────────┤
│ response = await client.transfer(accountNumber, transferRequest)│
│                                                                   │
│ Mögliche Ergebnisse:                                             │
│   • success=true, requiresTan=false  → ✅ Fertig!                │
│   • success=true, requiresTan=true   → ➡️ Weiter zu Schritt 6   │
│   • success=false                    → ➡️ Weiter zu Schritt 7   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  6. TAN-BESTÄTIGUNG                              │
├─────────────────────────────────────────────────────────────────┤
│ if (response.requiresTan):                                       │
│   • tanChallenge anzeigen → Benutzer um TAN bitten              │
│   • TAN eingeben                                                 │
│   • response = await client.transferWithTan(tanReference, tan)  │
│                                                                   │
│ Bei decoupled TAN:                                               │
│   • App-Benachrichtigung an Benutzer                             │
│   • Polling: transferWithTan() bis requiresTan=false            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                7. FEHLERBEHANDLUNG                               │
├─────────────────────────────────────────────────────────────────┤
│ if (!response.success):                                          │
│   • Fehlercode 9076? → Namensabgleich fehlgeschlagen            │
│     → Empfängername korrigieren lassen                           │
│     → Zurück zu Schritt 4                                        │
│   • Fehlercode 9230? → Unzureichendes Guthaben                   │
│   • Fehlercode 9210? → Ungültige IBAN/Daten                      │
│   • Andere Fehler? → response.bankAnswers anzeigen               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    8. ERFOLG!                                    │
├─────────────────────────────────────────────────────────────────┤
│ if (response.success):                                           │
│   • Erfolgsmeldung anzeigen                                      │
│   • Optional: Referenznummer (response.referenceNumber) speichern│
│   • Kontostand aktualisieren (optional)                          │
└─────────────────────────────────────────────────────────────────┘
```

## 💻 Code-Beispiel: Vollständiger Ablauf

```typescript
import { FinTSClient, FinTSConfig, TransferRequest } from 'lib-fints';

async function executeTransfer() {
  // ═══════════════════════════════════════════════════════════════
  // 1. INITIALISIERUNG
  // ═══════════════════════════════════════════════════════════════

  // Erste Verwendung:
  const config = FinTSConfig.forFirstTimeUse(
    process.env.FINTS_PRODUCT_ID!,
    '1.0',
    process.env.FINTS_BANK_URL!,
    process.env.FINTS_BANK_ID!,
    process.env.FINTS_USER_ID!,
    process.env.FINTS_PIN!
  );

  // ODER: Mit gespeicherten Daten (empfohlen ab 2. Mal):
  // const config = FinTSConfig.fromBankingInformation(
  //   productId, productVersion, savedBankingInfo, userId, pin, tanMethodId
  // );

  const client = new FinTSClient(config);

  // Optional: Debug aktivieren
  config.debugEnabled = true;

  try {
    // ═══════════════════════════════════════════════════════════════
    // 2. SYNCHRONISATION (nur beim ersten Mal oder bei Änderungen)
    // ═══════════════════════════════════════════════════════════════

    console.log('🔄 Synchronisiere mit Bank...');
    let syncResponse = await client.synchronize();

    // TAN für Sync?
    if (syncResponse.requiresTan) {
      const tan = await getTanFromUser(syncResponse.tanChallenge!);
      syncResponse = await client.synchronizeWithTan(syncResponse.tanReference!, tan);
    }

    if (!syncResponse.success) {
      throw new Error('Synchronisation fehlgeschlagen');
    }

    // TAN-Methode wählen (nur beim ersten Mal)
    if (config.bankingInformation?.bpd?.availableTanMethodIds?.length) {
      const tanMethodId = config.bankingInformation.bpd.availableTanMethodIds[0];
      client.selectTanMethod(tanMethodId);

      // Zweite Sync mit TAN-Methode
      syncResponse = await client.synchronize();
      if (syncResponse.requiresTan) {
        const tan = await getTanFromUser(syncResponse.tanChallenge!);
        syncResponse = await client.synchronizeWithTan(syncResponse.tanReference!, tan);
      }
    }

    // WICHTIG: BankingInformation speichern für nächstes Mal!
    await saveBankingInformation(config.bankingInformation);

    // ═══════════════════════════════════════════════════════════════
    // 3. UNTERSTÜTZUNG PRÜFEN
    // ═══════════════════════════════════════════════════════════════

    const accounts = config.bankingInformation?.upd?.bankAccounts || [];
    const account = accounts[0]; // Erstes Konto wählen

    if (!client.canTransfer(account.accountNumber)) {
      throw new Error('Dieses Konto unterstützt keine SEPA-Überweisungen');
    }

    console.log('✅ SEPA-Überweisungen werden unterstützt');

    // ═══════════════════════════════════════════════════════════════
    // 4. ÜBERWEISUNG VORBEREITEN
    // ═══════════════════════════════════════════════════════════════

    const transfer: TransferRequest = {
      recipientName: 'Max Mustermann',    // EXAKTER Name für Namensabgleich!
      recipientIban: 'DE89370400440532013000',
      recipientBic: 'COBADEFFXXX',        // Optional
      amount: 100.00,
      currency: 'EUR',
      purpose: 'Rechnung 12345',
      endToEndId: 'TXN-' + Date.now(),    // Optional, für Tracking
      // debtorName wird automatisch aus account.holder1 genommen
    };

    // Bestätigung vom Benutzer einholen
    console.log('\n📋 Überweisungsdetails:');
    console.log(`   An: ${transfer.recipientName}`);
    console.log(`   IBAN: ${transfer.recipientIban}`);
    console.log(`   Betrag: ${transfer.amount} ${transfer.currency}`);
    console.log(`   Zweck: ${transfer.purpose}`);

    const confirmed = await askUserConfirmation('Überweisung ausführen?');
    if (!confirmed) {
      console.log('❌ Abgebrochen');
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    // 5. ÜBERWEISUNG EINREICHEN
    // ═══════════════════════════════════════════════════════════════

    console.log('💸 Führe Überweisung aus...');
    let response = await client.transfer(account.accountNumber, transfer);

    // ═══════════════════════════════════════════════════════════════
    // 6. TAN-BESTÄTIGUNG (falls erforderlich)
    // ═══════════════════════════════════════════════════════════════

    if (response.requiresTan) {
      console.log('🔐 TAN erforderlich');
      console.log(`   Challenge: ${response.tanChallenge}`);

      // Standard TAN (per SMS, App, etc.)
      const tan = await getTanFromUser(response.tanChallenge!);
      response = await client.transferWithTan(response.tanReference!, tan);

      // ODER: Decoupled TAN (automatische Freigabe per App)
      // console.log('Bitte Überweisung in Ihrer Banking-App freigeben...');
      // while (response.requiresTan) {
      //   await sleep(2000); // 2 Sekunden warten
      //   response = await client.transferWithTan(response.tanReference!);
      // }
    }

    // ═══════════════════════════════════════════════════════════════
    // 7. FEHLERBEHANDLUNG
    // ═══════════════════════════════════════════════════════════════

    if (!response.success) {
      // Spezifische Fehler behandeln
      const errorCode = response.bankAnswers[0]?.code;

      switch (errorCode) {
        case 9076:
          // Namensabgleich fehlgeschlagen
          console.error('❌ Namensabgleich fehlgeschlagen!');
          console.error('Der Empfängername stimmt nicht mit der IBAN überein.');
          console.error('Bitte korrigieren Sie den Namen und versuchen Sie es erneut.');
          // → Zurück zu Schritt 4 mit korrigiertem Namen
          break;

        case 9230:
          // Unzureichendes Guthaben
          console.error('❌ Unzureichendes Guthaben');
          break;

        case 9210:
          // Ungültige Daten (IBAN, etc.)
          console.error('❌ Ungültige Überweisungsdaten');
          break;

        default:
          // Allgemeiner Fehler
          console.error('❌ Überweisung fehlgeschlagen:');
          response.bankAnswers.forEach(answer => {
            console.error(`   [${answer.code}] ${answer.text}`);
          });
      }

      return;
    }

    // ═══════════════════════════════════════════════════════════════
    // 8. ERFOLG!
    // ═══════════════════════════════════════════════════════════════

    console.log('✅ Überweisung erfolgreich!');

    if (response.referenceNumber) {
      console.log(`📝 Referenznummer: ${response.referenceNumber}`);
      // Referenznummer speichern für spätere Nachverfolgung
      await saveTransferReference(transfer, response.referenceNumber);
    }

    // Optional: Kontostand aktualisieren
    const balanceResponse = await client.getAccountBalance(account.accountNumber);
    if (balanceResponse.success && balanceResponse.balance) {
      console.log(`💰 Neuer Kontostand: ${balanceResponse.balance.balance} ${balanceResponse.balance.currency}`);
    }

  } catch (error) {
    console.error('❌ Fehler:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN
// ═══════════════════════════════════════════════════════════════

async function getTanFromUser(challenge: string): Promise<string> {
  // In Browser: showModal mit Input-Feld
  // In CLI: readline.question()
  return prompt(`TAN eingeben (${challenge}): `);
}

async function askUserConfirmation(message: string): Promise<boolean> {
  const answer = prompt(`${message} (ja/nein): `);
  return answer?.toLowerCase() === 'ja';
}

async function saveBankingInformation(info: any): Promise<void> {
  // In Datenbank oder localStorage speichern
  localStorage.setItem('bankingInfo', JSON.stringify(info));
}

async function saveTransferReference(transfer: TransferRequest, reference: string): Promise<void> {
  // Für Audit-Log oder Nachverfolgung
  console.log(`Referenz ${reference} gespeichert`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════
// AUSFÜHREN
// ═══════════════════════════════════════════════════════════════

executeTransfer().catch(console.error);
```

## ⚡ Quick Reference: Wichtigste Methoden

| Schritt | Methode | Zweck |
|---------|---------|-------|
| Sync | `client.synchronize()` | Kontoinformationen abrufen |
| Prüfen | `client.canTransfer(accountNumber)` | SEPA-Unterstützung prüfen |
| Überweisung | `client.transfer(accountNumber, transfer)` | Überweisung einreichen |
| TAN | `client.transferWithTan(tanRef, tan)` | Mit TAN bestätigen |
| Sync-TAN | `client.synchronizeWithTan(tanRef, tan)` | Sync mit TAN bestätigen |

## 🔴 Kritische Punkte

1. **Namensabgleich (Fehler 9076)**
   - Empfängername muss **exakt** mit registriertem Namen übereinstimmen
   - Keine Tippfehler, keine Abkürzungen!

2. **BankingInformation speichern**
   - Nach erfolgreicher Sync: `config.bankingInformation` speichern
   - Beim nächsten Mal: `fromBankingInformation()` verwenden
   - Spart Zeit und vermeidet unnötige Syncs

3. **TAN-Handling**
   - Immer `requiresTan` prüfen!
   - Bei `true`: TAN-Flow durchführen
   - Bei decoupled: Polling bis `requiresTan=false`

4. **Fehlerbehandlung**
   - `response.success` prüfen
   - `response.bankAnswers` analysieren
   - Spezifische Fehler (9076, 9230, 9210) gesondert behandeln

## 📚 Weitere Ressourcen

- `docs/NAME_VALIDATION_ERROR_9076.md` - Namensabgleich-Fehler
- `examples/example-transfer.js` - Vollständiges Beispiel
- `examples/verify-transfer-implementation.js` - Verifikation

Viel Erfolg! 🚀
