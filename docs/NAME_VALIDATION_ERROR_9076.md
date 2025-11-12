# Namensabgleich (Fehler 9076) - Behandlung

## Problem

Seit Oktober 2025 führen Banken einen automatischen Namensabgleich durch:
- Der eingegebene **Empfängername** muss **exakt** mit dem bei der Empfängerbank registrierten Namen übereinstimmen
- Bei Abweichung: **Fehler 9076 - Namensabgleich erforderlich**

## Fehlerbehandlung in deiner Anwendung

### 1. Fehler 9076 erkennen

```typescript
const response = await client.transfer(accountNumber, transferRequest);

if (!response.success) {
  // Prüfe auf Namensabgleich-Fehler
  const nameError = response.bankAnswers.find(
    answer => answer.code === 9076
  );

  if (nameError) {
    // Zeige spezifische Fehlermeldung für Namensabgleich
    console.error('Namensabgleich fehlgeschlagen:', nameError.text);
    // → Benutzer auffordern, den Empfängernamen zu korrigieren
  }
}
```

### 2. Benutzer informieren

Zeige eine klare Fehlermeldung:

```
❌ Namensabgleich fehlgeschlagen

Der eingegebene Name stimmt nicht mit dem registrierten Namen
für diese IBAN überein.

Bitte überprüfen Sie:
- Ist der Name korrekt geschrieben?
- Stimmt der Name mit dem Kontoinhaber überein?
- Verwenden Sie evtl. Vor- und Nachname in falscher Reihenfolge?

IBAN: DE89370400440532013000
Eingegebener Name: Max Musterman
Möglicher Grund: Tippfehler (Musterman statt Mustermann)
```

### 3. Korrektur ermöglichen

```typescript
// In deinem Frontend:
if (transferResponse.error?.code === 9076) {
  showDialog({
    title: 'Namensabgleich fehlgeschlagen',
    message: 'Der Empfängername stimmt nicht mit der IBAN überein.',
    fields: [
      {
        label: 'Empfängername korrigieren',
        value: originalRecipientName,
        hint: 'Bitte exakten Namen des Kontoinhabers eingeben'
      }
    ],
    actions: [
      { label: 'Abbrechen', action: 'cancel' },
      { label: 'Erneut versuchen', action: 'retry' }
    ]
  });
}
```

### 4. Best Practices

**Vor der Überweisung:**
- Lass Benutzer den Empfängernamen **zweimal eingeben**
- Zeige eine Warnung bei ungewöhnlichen Zeichen (z.B. Umlaute, Sonderzeichen)
- Biete eine Vorschau: "Überweisung an [Name] IBAN [...]"

**Nach Fehler 9076:**
- Zeige die vollständige Fehlermeldung der Bank
- Biete Hilfe an (z.B. "Kontaktieren Sie den Empfänger für den korrekten Namen")
- Speichere die Überweisung als Entwurf zur späteren Korrektur

**Typische Fehlerquellen:**
- Tippfehler im Namen
- Vor-/Nachname vertauscht
- Titel vergessen (z.B. "Dr." oder "GmbH")
- Umlaute falsch geschrieben (ä → ae, ö → oe)
- Alte Namensform (z.B. nach Heirat)

## Code-Beispiel: Vollständige Fehlerbehandlung

```typescript
async function executeTransferWithNameValidation(
  client: FinTSClient,
  accountNumber: string,
  transfer: TransferRequest
): Promise<TransferResponse> {

  let response = await client.transfer(accountNumber, transfer);

  // TAN-Handling
  if (response.requiresTan) {
    const tan = await getTanFromUser(response.tanChallenge);
    response = await client.transferWithTan(response.tanReference!, tan);
  }

  // Erfolg?
  if (response.success) {
    return response;
  }

  // Fehleranalyse
  const errors = {
    nameValidation: response.bankAnswers.find(a => a.code === 9076),
    insufficientFunds: response.bankAnswers.find(a => a.code === 9230),
    invalidIban: response.bankAnswers.find(a => a.code === 9210),
    general: response.bankAnswers.filter(a => a.code >= 9000)
  };

  if (errors.nameValidation) {
    throw new NameValidationError(
      'Empfängername stimmt nicht mit IBAN überein',
      transfer.recipientName,
      transfer.recipientIban,
      errors.nameValidation.text
    );
  }

  if (errors.insufficientFunds) {
    throw new InsufficientFundsError('Nicht genügend Guthaben');
  }

  if (errors.invalidIban) {
    throw new InvalidIbanError('Ungültige IBAN', transfer.recipientIban);
  }

  // Allgemeiner Fehler
  throw new TransferError(
    'Überweisung fehlgeschlagen',
    response.bankAnswers
  );
}

// Custom Error Types
class NameValidationError extends Error {
  constructor(
    message: string,
    public recipientName: string,
    public recipientIban: string,
    public bankMessage: string
  ) {
    super(message);
    this.name = 'NameValidationError';
  }
}
```

## Was lib-fints NICHT kann

❌ Den korrekten Empfängernamen automatisch ermitteln
❌ Die Bank-Datenbank nach Namen durchsuchen
❌ Den Fehler "wegmachen" ohne Namenskorrektur

✅ Was lib-fints tut: Fehler 9076 korrekt zurückgeben mit Bank-Nachricht

## Weitere Informationen

- **Fehlercode 9076**: "Namensabgleich erforderlich. Bitte Software-Update prüfen."
- **Seit**: Oktober 2025 (EU-Verordnung)
- **Betrifft**: Alle SEPA-Überweisungen
- **Lösung**: Korrekten Empfängernamen verwenden

## Zusammenfassung

Der Fehler 9076 ist ein **Validierungs-Fehler**, der nur durch **korrekte Eingabe** des Empfängernamens behoben werden kann. Deine Anwendung muss:

1. Fehler erkennen (`bankAnswers` mit Code 9076)
2. Benutzer informieren (klare Fehlermeldung)
3. Korrektur ermöglichen (Namen neu eingeben lassen)
4. Erneut versuchen (mit korrigiertem Namen)

Die lib-fints Bibliothek gibt alle notwendigen Informationen zurück - die UX-Behandlung liegt bei deiner Anwendung.
