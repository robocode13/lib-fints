export enum Language {
	Default = 0,
	German = 1,
	English = 2,
	French = 3,
}

export enum Service {
	Tonline = 1,
	TcpIp = 2,
	Https = 3,
}

export enum HashAlgorithm {
	SHA1 = 1,
	SHA256 = 3,
	SHA384 = 4,
	SHA512 = 5,
	SHA256_256 = 6,
}

export enum SyncMode {
	NewSystemId = 0,
	LastProcessedMsgNr = 1,
	SignatureId = 2,
}

export enum LimitType {
	SingleOrder = 'E',
	Day = 'T',
	Week = 'W',
	Month = 'M',
	Time = 'Z',
}

export enum UpdUsage {
	MissingNotAllowed = 0,
	MissingUnknown = 1,
}

export enum CreditDebit {
	Credit = 'C',
	Debit = 'D',
}

export enum TanMediaType {
	All = 0,
	Active = 1,
	Available = 2,
}

export enum TanMediaClass {
	All = 'A',
	List = 'L',
	TanGenerator = 'G',
	Mobile = 'M',
	Secoder = 'S',
	Bilateral = 'B',
}

export enum TanMediaRequirement {
	NotAllowed = 0,
	Optional = 1,
	Required = 2,
}

export enum TanStatus {
	Active = 1,
	Available = 2,
	ActiveFollowUpCard = 3,
	AvailableFollowUpCard = 4,
}

export enum TanUsage {
	All = 0,
	Single = 1,
	MobileAndGenerator = 2,
}

export enum TanProcess {
	Process1 = '1',
	Process2 = '2',
	Process3 = '3',
	Process4 = '4',
	Status = 'S',
}
