import { Account } from './dataGroups/Account.js';
import { AccountLimit, AllowedTransactions } from './segments/HIUPD.js';

export enum AccountType {
  CheckingAccount = 'CheckingAccount',
  SavingsAccount = 'SavingsAccount',
  FixedDepositAccount = 'FixedDepositAccount',
  SecuritiesAccount = 'SecuritiesAccount',
  LoanMortgageAccount = 'LoanMortgageAccount',
  CreditCardAccount = 'CreditCardAccount',
  InvestmentCompanyFund = 'InvestmentCompanyFund',
  HomeSavingsContract = 'HomeSavingsContract',
  InsurancePolicy = 'InsurancePolicy',
  Miscellaneous = 'Miscellaneous',
}

export type BankAccount = Account & {
  iban?: string;
  customerId: string;
  accountType: AccountType;
  currency: string;
  holder1: string;
  holder2?: string;
  product?: string;
  limit?: AccountLimit;
  allowedTransactions?: AllowedTransactions[];
};

export function finTsAccountTypeToEnum(accountType: number): AccountType {
  if (accountType >= 1 && accountType <= 9) return AccountType.CheckingAccount;
  if (accountType >= 10 && accountType <= 19) return AccountType.SavingsAccount;
  if (accountType >= 20 && accountType <= 29) return AccountType.FixedDepositAccount;
  if (accountType >= 30 && accountType <= 39) return AccountType.SecuritiesAccount;
  if (accountType >= 40 && accountType <= 49) return AccountType.LoanMortgageAccount;
  if (accountType >= 50 && accountType <= 59) return AccountType.CreditCardAccount;
  if (accountType >= 60 && accountType <= 69) return AccountType.InvestmentCompanyFund;
  if (accountType >= 70 && accountType <= 79) return AccountType.HomeSavingsContract;
  if (accountType >= 80 && accountType <= 89) return AccountType.InsurancePolicy;
  return AccountType.Miscellaneous;
}
