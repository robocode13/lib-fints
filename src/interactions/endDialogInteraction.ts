import {
	ClientResponse,
	CustomerInteraction,
	CustomerOrderInteraction,
} from './customerInteraction.js';
import { Message } from '../message.js';
import { Segment } from '../segment.js';
import { FinTSConfig } from '../config.js';
import { HKEND, HKENDSegment } from '../segments/HKEND.js';

export interface TanMediaResponse extends ClientResponse {
	tanMediaList: string[];
}

export class EndDialogInteraction extends CustomerInteraction {
	constructor() {
		super(HKEND.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		const hkend: HKENDSegment = {
			header: { segId: HKEND.Id, segNr: 0, version: HKEND.Version },
			dialogId: this.dialog!.dialogId,
		};

		return [hkend];
	}

	handleResponse(response: Message, clientResponse: ClientResponse) {
		// no special response handling needed
	}
}
