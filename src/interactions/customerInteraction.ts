import { TextEncoder } from 'node:util';
import { BankAnswer } from '../bankAnswer.js';
import { Dialog } from '../dialog.js';
import { FinTSConfig } from '../config.js';
import { Message } from '../message.js';
import { Segment } from '../segment.js';
import { HITAN, HITANSegment } from '../segments/HITAN.js';
import { HNHBK, HNHBKSegment } from '../segments/HNHBK.js';

export interface PhotoTan {
    mimeType: string;
    image: Uint8Array;
}

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
    tanPhoto?: PhotoTan;
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

    private parseHHDUC(tanChallengeHHDUC: string) : PhotoTan {
        let offset = 0;
        const hhducBytes = new TextEncoder().encode(tanChallengeHHDUC);
        const countAsString = Array.from(hhducBytes.slice(offset, 2), (b) => String(b)).join('');
        offset += 2;
        const count = parseInt(countAsString);
        const mimeType = Buffer.from(hhducBytes.slice(offset, offset + count)).toString('ascii');
        offset += count;
        offset += 2;  // Skip the length of the image data - use the full length of the buffer
        const image = hhducBytes.slice(offset);
        return { mimeType, image };
    }

	private handleBaseResponse(response: Message): ClientResponse {
		const hnhbk = response.findSegment<HNHBKSegment>(HNHBK.Id);
		const dialogId = hnhbk?.dialogId ?? '';
		const bankAnswers = response.getBankAnswers();

		if (
			response.hasReturnCode(30) ||
			response.hasReturnCode(3955) ||
			response.hasReturnCode(3956) ||
			response.hasReturnCode(3957)
		) {
			const hitan = response.findSegment<HITANSegment>(HITAN.Id);
			if (hitan) {
				return {
					dialogId,
					success: true,
					bankingInformationUpdated: false,
					bankAnswers: bankAnswers,
					requiresTan: true,
					tanReference: hitan.orderReference,
					tanChallenge:
						hitan.challenge ??
						bankAnswers.find((answer) => answer.code === 3955)?.text ??
						bankAnswers.find((answer) => answer.code === 3956)?.text ??
						bankAnswers.find((answer) => answer.code === 3957)?.text ??
						'',
                    tanPhoto : hitan.challengeHhdUc ? this.parseHHDUC(hitan.challengeHhdUc) : undefined,
                    tanMediaName: hitan.tanMedia,
				};
			} else {
				throw new Error('HITAN segment not found in response, despite return code indicating security approval');
			}
		}

		return {
			dialogId,
			success: response.getHighestReturnCode() < 9000,
			bankingInformationUpdated: false,
			bankAnswers: bankAnswers,
			requiresTan: false,
		};
	}
}

export abstract class CustomerOrderInteraction extends CustomerInteraction {
	constructor(segId: string, public responseSegId: string) {
		super(segId);
	}
}
