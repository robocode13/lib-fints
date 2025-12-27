import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HKEND, type HKENDSegment } from '../segments/HKEND.js';
import { type ClientResponse, CustomerInteraction } from './customerInteraction.js';

export interface TanMediaResponse extends ClientResponse {
	tanMediaList: string[];
}

export class EndDialogInteraction extends CustomerInteraction {
	constructor() {
		super(HKEND.Id);
	}

	createSegments(_config: FinTSConfig): Segment[] {
		const hkend: HKENDSegment = {
			header: { segId: HKEND.Id, segNr: 0, version: HKEND.Version },
			dialogId: this.dialog?.dialogId ?? '0',
		};

		return [hkend];
	}

	handleResponse(_response: Message, _clientResponse: ClientResponse) {
		// no special response handling needed
	}
}
