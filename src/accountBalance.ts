export type AccountBalance = {
	date: Date;
	currency: string;
	balance: number;
	notedBalance?: number;
	creditLimit?: number;
	availableAmount?: number;
};
