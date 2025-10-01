export type CreditCardStatement = {
  // Date on which credit card was used
  transactionDate: Date;

  // The value date is the date on which the bank transaction actually takes effect
  // for interest calculation or balance purposes.
  valueDate: Date;

  currency: string;
  amount: number;
  purpose: string;
  originalCurrency: string;
  originalAmount: number;
  exchangeRate: number;
};
