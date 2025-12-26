import { HashAlgorithm } from './codes.js';
import { splitBySeparator } from './parser.js';
import { HNHBS, HNHBSSegment } from './segments/HNHBS.js';
import { HNHBK, HNHBKSegment } from './segments/HNHBK.js';
import { HNVSK, HNVSKSegment } from './segments/HNVSK.js';
import { HNSHK, HNSHKSegment } from './segments/HNSHK.js';
import { HNVSD, HNVSDSegment } from './segments/HNVSD.js';
import { HNSHA, HNSHASegment } from './segments/HNSHA.js';
import { HIRMS, HIRMSSegment } from './segments/HIRMS.js';
import { HIRMG, HIRMGSegment } from './segments/HIRMG.js';
import { BankAnswer } from './bankAnswer.js';
import { Segment } from './segment.js';
import { UnknownSegment, UnkownId } from './unknownSegment.js';
import { decode, encode, segmentToString } from './segment.js';
import { SegmentDefinition } from './segmentDefinition.js';
import { PARTED, PartedSegment } from './partedSegment.js';
import { getSegmentDefinition } from './segments/registry.js';

export class Message {
	constructor(public segments: Segment[]) {}

	findSegment<T extends Segment>(segmentId: string): T | undefined {
		const segments = this.findAllSegments<T>(segmentId);
		return segments.length > 0 ? segments[0] : undefined;
	}

	findAllSegments<T extends Segment>(segmentId: string): T[] {
		return this.segments.filter((segment) => segment.header.segId === segmentId) as T[];
	}

	findAllUnknownSegments(segmentId: string): UnknownSegment[] {
		const unknownSegments = this.segments.filter(
			(segment) => segment.header.segId === UnkownId,
		) as UnknownSegment[];
		return unknownSegments.filter((segment) => segment.originalId === segmentId);
	}

	hasReturnCode(code: number): boolean {
		const hirmg = this.findSegment<HIRMGSegment>(HIRMG.Id);
		const hirmsList = this.findAllSegments<HIRMSSegment>(HIRMS.Id);
		return (
			(hirmg && hirmg.answers.some((answer) => answer.code === code)) ||
			hirmsList.some((hirms) => hirms.answers.some((answer) => answer.code === code))
		);
	}

	getHighestReturnCode(): number {
		const hirmg = this.findSegment<HIRMGSegment>(HIRMG.Id);
		const hirmsList = this.findAllSegments<HIRMSSegment>(HIRMS.Id);
		const allAnswers = hirmg ? [...hirmg.answers] : [];
		hirmsList.forEach((hirms) => allAnswers.push(...hirms.answers));
		return allAnswers.reduce((max, answer) => (answer.code > max ? answer.code : max), 0);
	}

	getBankAnswers(): BankAnswer[] {
		let bankAnswers: BankAnswer[] = [];
		const hirmgSegments = this.findAllSegments<HIRMGSegment>(HIRMG.Id);

		hirmgSegments.forEach((hirmg) =>
			bankAnswers.push(
				...hirmg.answers.map((message) => ({
					code: message.code,
					text: message.text,
					params: message.params,
				})),
			),
		);

		const hirmsSegments = this.findAllSegments<HIRMSSegment>(HIRMS.Id);

		hirmsSegments.forEach((hirms) =>
			bankAnswers.push(
				...hirms.answers.map((message) => ({
					code: message.code,
					text: message.text,
					params: message.params,
				})),
			),
		);

		return bankAnswers;
	}

	static decode(text: string, partedResponseSegId?: string): Message {
		const segmentTexts = splitBySeparator(text, "'").filter((text) => !!text);
		let segments = segmentTexts.map((text) => Message.decodeSegment(text, partedResponseSegId));

		const hnvskIndex = segments.findIndex((segment) => segment.header.segId === HNVSK.Id);
		const hnvsdIndex = segments.findIndex((segment) => segment.header.segId === HNVSD.Id);
		const isEncrypted = hnvskIndex !== -1 && hnvsdIndex !== -1 && hnvsdIndex - hnvskIndex === 1;
		if (isEncrypted) {
			const hnvsd = segments[hnvsdIndex] as HNVSDSegment;
			const hnvsdSegmentTexts = splitBySeparator(hnvsd.encryptedData, "'").filter((text) => !!text);
			const hnvsdSegments = hnvsdSegmentTexts.map((text) =>
				Message.decodeSegment(text, partedResponseSegId),
			);
			segments.splice(hnvskIndex, 2, ...hnvsdSegments);
		}

		const message = new Message(segments);
		return message;
	}

	static decodeSegment(text: string, partedResponseSegId?: string): Segment {
		if (partedResponseSegId && text.startsWith(partedResponseSegId)) {
			const partedSegment: PartedSegment = {
				header: { ...SegmentDefinition.header.decode(text, 1), segId: PARTED.Id },
				originalId: partedResponseSegId,
				rawData: text,
			};

			return partedSegment;
		}

		return decode(text);
	}

	toString(includeUnknown = false): string {
		let text = `Message with ${this.segments.length} segments:\n`;
		text += this.segments
			.filter((segment) => includeUnknown || segment.header.segId !== UnkownId)
			.map((segment) => segmentToString(segment))
			.join('\n');
		return text;
	}
}

export class CustomerMessage extends Message {
	lastSignatureNumber = 0;

	constructor(dialogId: string = '0', msgNr = 1) {
		const hnhbk: HNHBKSegment = {
			header: { segId: HNHBK.Id, segNr: 0, version: HNHBK.Version },
			messageLength: 0,
			hbciVersion: 300,
			dialogId: dialogId,
			msgNr: msgNr,
		};

		const hnhbs: HNHBSSegment = {
			header: { segId: HNHBS.Id, segNr: 0, version: HNHBS.Version },
			msgNr: msgNr,
		};

		super([hnhbk, hnhbs]);
	}

	encode(): string {
		if (this.segments.length < 3) {
			throw new Error('a message must contain at least three segments');
		}

		if (this.segments[0].header.segId !== HNHBK.Id) {
			throw new Error('the first segment in a message must always be of type HNHBK');
		}

		if (this.segments[this.segments.length - 1].header.segId !== HNHBS.Id) {
			throw new Error('the last segment in a message must always be of type HNHBS');
		}

		let segmentNumber = 1;

		this.segments.forEach((segment) => {
			segment.header.segNr = segmentNumber++;
		});

		let segments = this.segments;

		if (this.lastSignatureNumber > 0) {
			const firstSignature = this.findSegment<HNSHKSegment>(HNSHK.Id);

			const now = new Date();

			const hnvsk: HNVSKSegment = {
				header: { segId: HNVSK.Id, segNr: 998, version: HNVSK.Version },
				secProfile: { secMethod: 'PIN', secVersion: 1 },
				secFunc: 998,
				secRole: 1,
				secId: { partyType: 1, partyId: firstSignature!.secId.partyId },
				dateTime: { type: 1, date: now, time: now },
				encryption: {
					use: 2,
					mode: 2,
					algorithm: 13,
					keyParamValue: '00000000',
					keyParamName: 5,
					initParamName: 1,
				},
				key: {
					bank: firstSignature!.key.bank,
					userId: firstSignature!.key.userId,
					keyType: 'S',
					keyNr: 0,
					keyVersion: 0,
				},
				compressMethod: 0,
			};

			const innerSegments = segments.slice(1, -1);

			const hnvsd: HNVSDSegment = {
				header: { segId: HNVSD.Id, segNr: 999, version: HNVSD.Version },
				encryptedData: innerSegments.map((segment) => encode(segment)).join(''),
			};

			segments = [this.segments[0], hnvsk, hnvsd, this.segments[this.segments.length - 1]];
		}

		const encodedMessage = segments.map((segment) => encode(segment)).join('');
		const messageHeader = segments[0] as HNHBKSegment;
		messageHeader.messageLength = encodedMessage.length;
		const encodedHeader = encode(messageHeader);
		return encodedHeader + encodedMessage.substring(encodedHeader.length);
	}

	sign(
		countryCode: number,
		bankId: string,
		userId: string,
		pin: string,
		systemId?: string,
		tanMethodId?: number,
		tan?: string,
	) {
		const now = new Date();

		this.lastSignatureNumber++;

		const hnshk: HNSHKSegment = {
			header: { segId: HNSHK.Id, segNr: 0, version: HNSHK.Version },
			secProfile: { secMethod: 'PIN', secVersion: tanMethodId ? 2 : 1 },
			secFunc: tanMethodId ?? 999,
			secControlRef: this.lastSignatureNumber.toString(),
			secArea: 1,
			secRole: 1,
			secId: { partyType: 1, partyId: systemId ?? '0' },
			secRefNum: 1,
			dateTime: { type: 1, date: now, time: now },
			hash: { use: 1, algorithm: HashAlgorithm.SHA256, paramName: 1 },
			signature: { use: 6, algorithm: 10, mode: 16 },
			key: {
				bank: { country: countryCode, bankId: bankId },
				userId: userId,
				keyType: 'S',
				keyNr: 0,
				keyVersion: 0,
			},
		};

		this.segments.splice(1, 0, hnshk);

		const pinTan = { pin: pin, tan: tan };
		const hnsha: HNSHASegment = {
			header: { segId: HNSHA.Id, segNr: 0, version: HNSHA.Version },
			secControlRef: this.lastSignatureNumber.toString(),
			customSignature: pinTan,
		};

		this.segments.splice(this.segments.length - 1, 0, hnsha);
	}

	addSegment(segment: Segment) {
		let firstSignatureEndIndex = this.segments.findIndex(
			(segment) => segment.header.segId === HNSHA.Id,
		);
		if (firstSignatureEndIndex === -1) {
			firstSignatureEndIndex = this.segments.length - 1;
		}
		this.segments.splice(firstSignatureEndIndex, 0, segment);
	}
}

export class CustomerOrderMessage extends CustomerMessage {
	constructor(
		public orderSegId: string,
		public orderResponseSegId: string,
		dialogId: string = '0',
		msgNr = 1,
	) {
		super(dialogId, msgNr);
	}

	get supportsPartedResponseSegments(): boolean {
		const definition = getSegmentDefinition(this.orderSegId);
		return definition?.elements.some((element) => element.name === 'continuationMark') ?? false;
	}
}
