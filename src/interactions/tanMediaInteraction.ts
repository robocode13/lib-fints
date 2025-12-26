import {
	type ClientResponse,
	CustomerInteraction,
	CustomerOrderInteraction,
} from './customerInteraction.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import type { FinTSConfig } from '../config.js';
import { HKTAB, type HKTABSegment } from '../segments/HKTAB.js';
import { HITAB, type HITABSegment } from '../segments/HITAB.js';
import { TanMediaClass, TanMediaType } from '../codes.js';

export interface TanMediaResponse extends ClientResponse {
	tanMediaList: string[];
}

export class TanMediaInteraction extends CustomerOrderInteraction {
	constructor() {
		super(HKTAB.Id, HITAB.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		const version = init.getMaxSupportedTransactionVersion(HKTAB.Id);

		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKTAB.Id}`);
		}

		const hktab: HKTABSegment = {
			header: { segId: HKTAB.Id, segNr: 0, version: version },
			mediaType: TanMediaType.Active,
			mediaClass: TanMediaClass.All,
		};

		return [hktab];
	}

	handleResponse(response: Message, clientResponse: TanMediaResponse) {
		const hitab = response.findSegment<HITABSegment>(HITAB.Id);
		if (hitab) {
			clientResponse.tanMediaList = (hitab.mediaList ?? [])
				.map((media) => media.name)
				.filter((name) => name) as string[];

			const tanMethod = this.dialog!.config.selectedTanMethod;
			if (tanMethod) {
				tanMethod.activeTanMedia = clientResponse.tanMediaList;
			}
		}
	}
}
