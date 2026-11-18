import { TanMediaRequirement, TanProcess } from './codes.js';
import type { FinTSConfig } from './config.js';
import { HttpClient } from './httpClient.js';
import {
	type ClientResponse,
	type CustomerInteraction,
	CustomerOrderInteraction,
} from './interactions/customerInteraction.js';
import { EndDialogInteraction } from './interactions/endDialogInteraction.js';
import { InitDialogInteraction } from './interactions/initDialogInteraction.js';
import { CustomerMessage, CustomerOrderMessage, type Message } from './message.js';
import { PARTED, type PartedSegment } from './partedSegment.js';
import type { SegmentWithContinuationMark } from './segment.js';
import { decode } from './segment.js';
import { HKEND } from './segments/HKEND.js';
import { HKTAN, type HKTANSegment } from './segments/HKTAN.js';
import { HNHBK, type HNHBKSegment } from './segments/HNHBK.js';

/**
 * Whether a message can carry HKTAN for an order: it needs the PIN and a selected TAN
 * method of version 6 or later (PSD2 SCA)
 */
export function canSendTanSegment(config: FinTSConfig): boolean {
	return !!(config.userId && config.pin && (config.selectedTanMethod?.version ?? 0) >= 6);
}

export class Dialog {
	dialogId: string = '0';
	lastMessageNumber = 0;
	interactions: CustomerInteraction[] = [];
	responses: Map<string, ClientResponse> = new Map();
	currentInteractionIndex = 0;
	isInitialized = false;
	hasEnded = false;
	/** Whether the current interaction has held the dialog open for a decision of the caller */
	private awaitingCaller = false;
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

		return this.run(() => this.createCurrentCustomerMessage());
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

		return this.run(() => this.createCurrentTanMessage(tanOrderReference, tan));
	}

	/**
	 * Continues a dialog that an interaction has held open for a decision of the caller
	 * (see `CustomerInteraction.awaitsCaller`) with a further interaction, sent next in the
	 * same dialog.
	 * @param interaction the interaction to run next
	 * @throws Error, before anything is sent, when the current interaction has not paused
	 * for the caller, such as while it waits for a TAN
	 */
	async continueWith(interaction: CustomerInteraction): Promise<Map<string, ClientResponse>> {
		if (this.hasEnded) {
			throw Error('cannot continue a dialog that has already ended');
		}

		if (!this.isInitialized) {
			throw Error('cannot continue a dialog that has not been initialized');
		}

		// A TAN challenge, for one, is continued with continue() or ended, never skipped
		if (!this.awaitingCaller) {
			throw Error(
				'cannot continue a dialog whose current interaction does not wait for the caller',
			);
		}

		this.addCustomerInteraction(interaction, true);
		this.currentInteractionIndex++;

		return this.run(() => this.createCurrentCustomerMessage());
	}

	/**
	 * Ends the dialog with HKEND, skipping any interactions still queued. A dialog that has
	 * not sent a message yet is only marked as ended.
	 */
	async end(): Promise<Map<string, ClientResponse>> {
		if (this.hasEnded) {
			return this.responses;
		}

		if (this.lastMessageNumber === 0) {
			this.hasEnded = true;
			return this.responses;
		}

		let endIndex = this.interactions.findIndex(
			(interaction) => interaction instanceof EndDialogInteraction,
		);

		if (endIndex < 0) {
			const endInteraction = new EndDialogInteraction();
			endInteraction.dialog = this;
			this.interactions.push(endInteraction);
			endIndex = this.interactions.length - 1;
		}

		this.currentInteractionIndex = endIndex;

		try {
			return await this.run(() => this.createCurrentCustomerMessage());
		} finally {
			this.hasEnded = true;
		}
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

	/**
	 * Sends the current interaction's message and moves on to the next interaction for as
	 * long as each one succeeds without asking for a TAN or for a decision of the caller.
	 * @param createFirstMessage creates the first message; every further one is the current interaction's
	 */
	private async run(
		createFirstMessage: () => CustomerMessage,
	): Promise<Map<string, ClientResponse>> {
		let createMessage = createFirstMessage;
		let proceed: boolean;

		do {
			const interaction = this.currentInteraction;
			this.awaitingCaller = false;
			const message = createMessage();
			createMessage = () => this.createCurrentCustomerMessage();

			const responseMessage = await this.send(message, interaction);
			await this.handlePartedMessages(message, responseMessage, interaction);
			const clientResponse = interaction.handleClientResponse(responseMessage);
			this.checkEnded(clientResponse);
			this.dialogId = clientResponse.dialogId;
			this.responses.set(interaction.segId, clientResponse);

			const settled = clientResponse.success && !clientResponse.requiresTan;
			this.awaitingCaller = settled && interaction.awaitsCaller(clientResponse);
			proceed = settled && !this.awaitingCaller;

			if (proceed) {
				this.currentInteractionIndex++;

				if (this.currentInteractionIndex > 0) {
					this.isInitialized = true;
				}
			}
		} while (!this.hasEnded && this.currentInteractionIndex < this.interactions.length && proceed);

		return this.responses;
	}

	/**
	 * Sends a message that has just taken the latest message number, once its interaction
	 * has seen it. A message the interaction refuses is not sent and gives its number back.
	 */
	private async send(message: CustomerMessage, interaction: CustomerInteraction): Promise<Message> {
		try {
			interaction.beforeSend(message);
		} catch (error) {
			this.lastMessageNumber--;
			throw error;
		}

		return this.httpClient.sendMessage(message);
	}

	private createCurrentCustomerMessage(): CustomerMessage {
		// First, so that an interaction refusing to build its segments leaves no gap in the
		// message numbers
		const segments = this.currentInteraction.getSegments(this.config);
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
		let isTanMethodNeeded = isScaSupported && this.currentInteraction.segId !== HKEND.Id;

		if (isCustomerOrder) {
			const bankTransaction = this.config.bankingInformation.bpd?.allowedTransactions.find(
				(t) => t.transId === this.currentInteraction.segId,
			);

			isTanMethodNeeded =
				isTanMethodNeeded &&
				this.currentInteraction.needsTanSegment(!!bankTransaction?.tanRequired);
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

		segments.forEach((segment) => {
			message.addSegment(segment);
		});

		if (isTanMethodNeeded && canSendTanSegment(this.config)) {
			const hktan: HKTANSegment = {
				header: { segId: HKTAN.Id, segNr: 0, version: tanMethod?.version ?? 0 },
				tanProcess: TanProcess.Process4,
				segId: this.currentInteraction.segId,
				tanMedia: this.getTanMediaName(),
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
				this.config.bankingInformation?.systemId,
				this.config.tanMethodId,
				tan,
			);
		}

		this.currentInteraction.getTanMessageSegments(this.config).forEach((segment) => {
			message.addSegment(segment);
		});

		if (this.config.userId && this.config.pin && this.config.tanMethodId) {
			const hktan: HKTANSegment = {
				header: { segId: HKTAN.Id, segNr: 0, version: this.config.selectedTanMethod?.version ?? 0 },
				tanProcess: this.config.selectedTanMethod?.isDecoupled
					? TanProcess.Status
					: TanProcess.Process2,
				segId: this.currentInteraction.segId,
				orderRef: tanOrderReference,
				nextTan: false,
				tanMedia: this.getTanMediaName(),
			};

			message.addSegment(hktan);
		}
		return message;
	}

	private getTanMediaName(): string | undefined {
		const requirement =
			this.config.selectedTanMethod?.tanMediaRequirement ?? TanMediaRequirement.NotAllowed;

		if (requirement === TanMediaRequirement.NotAllowed) {
			return undefined;
		}

		if (requirement === TanMediaRequirement.Required) {
			return this.config.tanMediaName ?? 'default';
		}

		return this.config.tanMediaName;
	}

	/**
	 * Collects a response that the bank spreads over several messages.
	 *
	 * When the bank cannot fit a response into one message it answers with code 3040 plus
	 * a continuation mark. Repeating the order with that mark yields the next portion —
	 * as a COMPLETE, self-contained response segment, not as a byte-wise continuation of
	 * the previous one. A HICAZ follow-up, for example, repeats the account and the CAMT
	 * descriptor before carrying its own share of the statements.
	 *
	 * Every portion is therefore decoded on its own and all of them are placed into the
	 * response message the caller holds. Combining their payloads needs to know what the
	 * payload means — one MT940 stream continues, a list of CAMT documents is appended —
	 * so that step belongs to the interaction, which does it via `findAllSegments`.
	 */
	private async handlePartedMessages(
		message: CustomerMessage,
		responseMessage: Message,
		interaction: CustomerInteraction,
	) {
		// ALL of them, not just the first: one bank message may well carry several
		// response segments. Taking only the first left the rest sitting in the tree as
		// PARTED, where `findAllSegments` cannot see them — lost without a trace.
		const partedSegments = responseMessage.findAllSegments<PartedSegment>(PARTED.Id);

		if (partedSegments.length === 0) {
			return;
		}

		// The message the caller holds — every portion has to end up in THIS one, not in
		// the last one we happen to receive.
		const callersMessage = responseMessage;
		const rawPortions = partedSegments.map((segment) => segment.rawData);

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

			const answer = answers.find((a) => a.code === 3040);

			if (!answer || !answer.params || answer.params.length === 0) {
				throw new Error('Expected bank answer to contain continuation mark parameters (code 3040)');
			}

			segmentWithContinuation.continuationMark = answer.params[0];
			const hnhbkSegment = message.findSegment<HNHBKSegment>(HNHBK.Id);
			if (!hnhbkSegment) {
				throw new Error('HNHBK segment not found in message');
			}
			hnhbkSegment.msgNr = ++this.lastMessageNumber;
			const nextResponseMessage = await this.send(message, interaction);
			rawPortions.push(
				...nextResponseMessage
					.findAllSegments<PartedSegment>(PARTED.Id)
					.map((segment) => segment.rawData),
			);

			responseMessage = nextResponseMessage;
		}

		// Every PARTED placeholder gives way to the decoded portions, at the position of
		// the first one so the segment order stays intact.
		const index = callersMessage.segments.indexOf(partedSegments[0]);
		const withoutPlaceholders = callersMessage.segments.filter(
			(segment) => segment.header.segId !== PARTED.Id,
		);
		withoutPlaceholders.splice(index, 0, ...rawPortions.map((raw) => decode(raw)));
		callersMessage.segments = withoutPlaceholders;
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
