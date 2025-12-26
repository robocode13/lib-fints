import { TanMediaRequirement, TanProcess } from './codes.js';
import type { FinTSConfig } from './config.js';
import { HttpClient } from './httpClient.js';
import {
	type ClientResponse,
	type CustomerInteraction,
	CustomerOrderInteraction,
} from './interactions/customerInteraction.js';
import { EndDialogInteraction } from './interactions/endDialogInteraction.js';
import { InitDialogInteraction, InitResponse } from './interactions/initDialogInteraction.js';
import { CustomerMessage, CustomerOrderMessage, type Message } from './message.js';
import { PARTED, type PartedSegment } from './partedSegment.js';
import type { SegmentWithContinuationMark } from './segment.js';
import { decode } from './segment.js';
import { HKIDN } from './segments/HKIDN.js';
import { HKTAN, type HKTANSegment } from './segments/HKTAN.js';
import { HNHBK, type HNHBKSegment } from './segments/HNHBK.js';

export class Dialog {
	dialogId: string = '0';
	lastMessageNumber = 0;
	interactions: CustomerInteraction[] = [];
	responses: Map<string, ClientResponse> = new Map();
	currentInteractionIndex = 0;
	isInitialized = false;
	hasEnded = false;
	httpClient: HttpClient;

	constructor(
		public config: FinTSConfig,
		syncSystemId: boolean = false,
	) {
		if (!this.config) {
			throw new Error('configuration must be provided');
		}

		this.httpClient = this.getHttpClient();
		this.interactions.push(new InitDialogInteraction(this.config, syncSystemId));
		this.interactions.push(new EndDialogInteraction());
		this.interactions.forEach((interaction) => {
			interaction.dialog = this;
		});
	}

	get currentInteraction(): CustomerInteraction {
		return this.interactions[this.currentInteractionIndex];
	}

	async start(): Promise<Map<string, ClientResponse>> {
		if (this.isInitialized) {
			throw new Error('dialog has already been initialized');
		}

		if (this.hasEnded) {
			throw Error('cannot start a dialog that has already ended');
		}

		if (this.lastMessageNumber > 0) {
			throw new Error('dialog start can only be called on a new dialog');
		}

		let clientResponse: ClientResponse;

		do {
			const message = this.createCurrentCustomerMessage();
			const responseMessage = await this.httpClient.sendMessage(message);
			await this.handlePartedMessages(message, responseMessage, this.currentInteraction);
			clientResponse = this.currentInteraction.handleClientResponse(responseMessage);
			this.checkEnded(clientResponse);
			this.dialogId = clientResponse.dialogId;
			this.responses.set(this.currentInteraction.segId, clientResponse);

			if (clientResponse.success && !clientResponse.requiresTan) {
				this.currentInteractionIndex++;

				if (this.currentInteractionIndex > 0) {
					this.isInitialized = true;
				}
			}
		} while (
			!this.hasEnded &&
			this.currentInteractionIndex < this.interactions.length &&
			clientResponse.success &&
			!clientResponse.requiresTan
		);

		return this.responses;
	}

	async continue(tanOrderReference: string, tan?: string): Promise<Map<string, ClientResponse>> {
		if (!tanOrderReference) {
			throw Error('tanOrderReference must be provided to continue a customer order with a TAN');
		}

		if (!this.config.selectedTanMethod?.isDecoupled && !tan) {
			throw Error('TAN must be provided for non-decoupled TAN methods');
		}

		if (this.hasEnded) {
			throw Error('cannot continue a customer order when dialog has already ended');
		}

		if (!this.currentInteraction) {
			throw new Error('there is no running customer interaction in this dialog to continue');
		}

		let clientResponse: ClientResponse;

		let isFirstMessage = true;

		do {
			const message = isFirstMessage
				? this.createCurrentTanMessage(tanOrderReference, tan)
				: this.createCurrentCustomerMessage();
			const responseMessage = await this.httpClient.sendMessage(message);
			await this.handlePartedMessages(message, responseMessage, this.currentInteraction);
			clientResponse = this.currentInteraction.handleClientResponse(responseMessage);
			this.checkEnded(clientResponse);
			this.dialogId = clientResponse.dialogId;
			this.responses.set(this.currentInteraction.segId, clientResponse);

			if (clientResponse.success && !clientResponse.requiresTan) {
				this.currentInteractionIndex++;

				if (this.currentInteractionIndex > 0) {
					this.isInitialized = true;
				}
			}

			isFirstMessage = false;
		} while (
			!this.hasEnded &&
			this.currentInteractionIndex < this.interactions.length &&
			clientResponse.success &&
			!clientResponse.requiresTan
		);

		return this.responses;
	}

	addCustomerInteraction(interaction: CustomerInteraction, afterCurrent = false): void {
		if (this.hasEnded) {
			throw Error('cannot queue another customer interaction when dialog has already ended');
		}

		const isCustomerOrder = interaction instanceof CustomerOrderInteraction;

		if (isCustomerOrder && !this.config.isTransactionSupported(interaction.segId)) {
			throw Error(
				`customer order transaction ${interaction.segId} is not supported according to the BPD`,
			);
		}

		interaction.dialog = this;

		if (afterCurrent) {
			this.interactions.splice(this.currentInteractionIndex + 1, 0, interaction);
			return;
		}

		this.interactions.splice(this.interactions.length - 1, 0, interaction);
	}

	private createCurrentCustomerMessage(): CustomerMessage {
		this.lastMessageNumber++;

		const isCustomerOrder = this.currentInteraction instanceof CustomerOrderInteraction;
		const message = isCustomerOrder
			? new CustomerOrderMessage(
					this.currentInteraction.segId,
					this.currentInteraction.responseSegId,
					this.dialogId,
					this.lastMessageNumber,
				)
			: new CustomerMessage(this.dialogId, this.lastMessageNumber);

		const tanMethod = this.config.selectedTanMethod;
		const isScaSupported = tanMethod && tanMethod.version >= 6;
		let isTanMethodNeeded = isScaSupported;

		if (isCustomerOrder) {
			const bankTransaction = this.config.bankingInformation.bpd?.allowedTransactions.find(
				(t) => t.transId === this.currentInteraction.segId,
			);

			isTanMethodNeeded = isScaSupported && bankTransaction?.tanRequired;
		}

		if (this.config.userId && this.config.pin) {
			message.sign(
				this.config.countryCode,
				this.config.bankId,
				this.config.userId,
				this.config.pin,
				this.config.bankingInformation.systemId,
				isScaSupported ? this.config.tanMethodId : undefined,
			);
		}

		const segments = this.currentInteraction.getSegments(this.config);
		segments.forEach((segment) => message.addSegment(segment));

		if (this.config.userId && this.config.pin && isTanMethodNeeded) {
			const hktan: HKTANSegment = {
				header: { segId: HKTAN.Id, segNr: 0, version: tanMethod!.version },
				tanProcess: TanProcess.Process4,
				segId: HKIDN.Id,
			};

			message.addSegment(hktan);
		}

		return message;
	}

	private createCurrentTanMessage(tanOrderReference: string, tan?: string): CustomerMessage {
		this.lastMessageNumber++;
		const message = new CustomerMessage(this.dialogId, this.lastMessageNumber);

		if (this.config.userId && this.config.pin) {
			message.sign(
				this.config.countryCode,
				this.config.bankId,
				this.config.userId,
				this.config.pin,
				this.config.bankingInformation!.systemId,
				this.config.tanMethodId,
				tan,
			);
		}

		if (this.config.userId && this.config.pin && this.config.tanMethodId) {
			const hktan: HKTANSegment = {
				header: { segId: HKTAN.Id, segNr: 0, version: this.config.selectedTanMethod!.version },
				tanProcess: this.config.selectedTanMethod?.isDecoupled
					? TanProcess.Status
					: TanProcess.Process2,
				segId: this.currentInteraction.segId,
				orderRef: tanOrderReference,
				nextTan: false,
				tanMedia:
					this.config.selectedTanMethod!.tanMediaRequirement >= TanMediaRequirement.Optional
						? this.config.tanMediaName
						: undefined,
			};

			message.addSegment(hktan);
		}
		return message;
	}

	private async handlePartedMessages(
		message: CustomerMessage,
		responseMessage: Message,
		interaction: CustomerInteraction,
	) {
		let partedSegment = responseMessage.findSegment<PartedSegment>(PARTED.Id);

		if (partedSegment) {
			while (responseMessage.hasReturnCode(3040)) {
				const answers = responseMessage.getBankAnswers();
				const segmentWithContinuation = message.segments.find(
					(s) => s.header.segId === interaction.segId,
				) as SegmentWithContinuationMark;
				if (!segmentWithContinuation) {
					throw new Error(
						`Response contains segment with further information, but corresponding segment could not be found or is not specified`,
					);
				}

				segmentWithContinuation.continuationMark = answers.find((a) => a.code === 3040)!.params![0];
				message.findSegment<HNHBKSegment>(HNHBK.Id)!.msgNr = ++this.lastMessageNumber;
				const nextResponseMessage = await this.httpClient.sendMessage(message);
				const nextPartedSegment = nextResponseMessage.findSegment<PartedSegment>(PARTED.Id);

				if (nextPartedSegment) {
					nextPartedSegment.rawData =
						partedSegment.rawData +
						nextPartedSegment.rawData.slice(nextPartedSegment.rawData.indexOf('+') + 1);
					partedSegment = nextPartedSegment;
				}

				responseMessage = nextResponseMessage;
			}

			const completeSegment = decode(partedSegment.rawData);
			const index = responseMessage.segments.indexOf(partedSegment);
			responseMessage.segments.splice(index, 1, completeSegment);
		}
	}

	private checkEnded(response: ClientResponse) {
		if (
			response.bankAnswers.some((answer) => answer.code === 100) ||
			response.bankAnswers.some((answer) => answer.code === 9000)
		) {
			this.hasEnded = true;
		}
	}

	private getHttpClient(): HttpClient {
		return new HttpClient(this.config.bankingUrl, this.config.debugEnabled);
	}
}
