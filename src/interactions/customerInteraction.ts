import { BankAnswer } from '../bankAnswer.js';
import { Dialog } from '../dialog.js';
import { FinTSConfig } from '../config.js';
import { Message } from '../message.js';
import { Segment } from '../segment.js';
import { HITAN, HITANSegment } from '../segments/HITAN.js';
import { HNHBK, HNHBKSegment } from '../segments/HNHBK.js';

/**
 * The response from the client after a customer interaction
 * @property dialogId The dialog ID of the current dialog
 * @property success Whether the interaction was successful
 * @property bankingInformationUpdated Whether the banking information were updated
 * @property bankAnswers The answers from the bank
 * @property requiresTan Whether security approval is required to continue the transaction (a user entered TAN or decoupled approval)
 * @property tanReference A reference for the TAN which needs to be provided in the continuation method
 * @property tanChallenge A prompt provided by the bank which should be displayed to the user to enter the TAN
 * @property tanMediaName The name of the TAN media to use for the TAN input
 */
export interface ClientResponse {
	dialogId: string;
	success: boolean;
	bankingInformationUpdated: boolean;
	bankAnswers: BankAnswer[];
	requiresTan: boolean;
	tanReference?: string;
	tanChallenge?: string;
	tanMediaName?: string;
}

export abstract class CustomerInteraction {
	dialog?: Dialog;

	constructor(public segId: string) {}

	getSegments(init: FinTSConfig): Segment[] {
		return this.createSegments(init);
	}

	getClientResponse<TResponse extends ClientResponse>(message: Message): TResponse {
		const clientResponse = this.handleBaseResponse(message);

		if (clientResponse.success && !clientResponse.requiresTan) {
			this.handleResponse(message, clientResponse);
		}

		return clientResponse as TResponse;
	}

	protected abstract createSegments(init: FinTSConfig): Segment[];
	protected abstract handleResponse(response: Message, clientResponse: ClientResponse): void;

	private handleBaseResponse(response: Message): ClientResponse {
		const hnhbk = response.findSegment<HNHBKSegment>(HNHBK.Id);
		const dialogId = hnhbk?.dialogId ?? '';

		if (response.hasReturnCode(30)) {
			const hitan = response.findSegment<HITANSegment>(HITAN.Id);
			if (hitan) {
				return {
					dialogId,
					success: true,
					bankingInformationUpdated: false,
					bankAnswers: response.getBankAnswers(),
					requiresTan: true,
					tanReference: hitan.orderReference,
					tanChallenge: hitan.challenge,
					tanMediaName: hitan.tanMedia,
				};
			} else {
				throw new Error('HITAN segment not found in response, despite return code 30');
			}
		}

		return {
			dialogId,
			success: response.getHighestReturnCode() < 9000,
			bankingInformationUpdated: false,
			bankAnswers: response.getBankAnswers(),
			requiresTan: false,
		};
	}
}

export abstract class CustomerOrderInteraction extends CustomerInteraction {
	constructor(segId: string, public responseSegId: string) {
		super(segId);
	}
}
