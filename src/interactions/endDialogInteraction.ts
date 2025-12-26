import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HKEND, type HKENDSegment } from '../segments/HKEND.js';
import {
	type ClientResponse,
	CustomerInteraction,
	CustomerOrderInteraction,
} from './customerInteraction.js';

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
