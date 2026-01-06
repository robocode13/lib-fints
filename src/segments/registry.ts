import { PARTED } from '../partedSegment.js';
import type { SegmentDefinition } from '../segmentDefinition.js';
import { UNKNOW } from '../unknownSegment.js';
import { DIKKU } from './DIKKU.js';
import { DKKKU } from './DKKKU.js';
import { HIBPA } from './HIBPA.js';
import { HICAZ } from './HICAZ.js';
import { HICAZS } from './HICAZS.js';
import { HIKAZ } from './HIKAZ.js';
import { HIKAZS } from './HIKAZS.js';
import { HIKIM } from './HIKIM.js';
import { HIKOM } from './HIKOM.js';
import { HIPINS } from './HIPINS.js';
import { HIRMG } from './HIRMG.js';
import { HIRMS } from './HIRMS.js';
import { HISAL } from './HISAL.js';
import { HISPA } from './HISPA.js';
import { HISPAS } from './HISPAS.js';
import { HISYN } from './HISYN.js';
import { HITAB } from './HITAB.js';
import { HITAN } from './HITAN.js';
import { HITANS } from './HITANS.js';
import { HIUPA } from './HIUPA.js';
import { HIUPD } from './HIUPD.js';
import { HIWPD } from './HIWPD.js';
import { HKCAZ } from './HKCAZ.js';
import { HKEND } from './HKEND.js';
import { HKIDN } from './HKIDN.js';
import { HKKAZ } from './HKKAZ.js';
import { HKSAL } from './HKSAL.js';
import { HKSPA } from './HKSPA.js';
import { HKSYN } from './HKSYN.js';
import { HKTAB } from './HKTAB.js';
import { HKTAN } from './HKTAN.js';
import { HKVVB } from './HKVVB.js';
import { HKWPD } from './HKWPD.js';
import { HNHBK } from './HNHBK.js';
import { HNHBS } from './HNHBS.js';
import { HNSHA } from './HNSHA.js';
import { HNSHK } from './HNSHK.js';
import { HNVSD } from './HNVSD.js';
import { HNVSK } from './HNVSK.js';

const registry = new Map<string, SegmentDefinition>();

export function registerSegments() {
	registerSegmentDefinition(new HNHBK());
	registerSegmentDefinition(new HNHBS());
	registerSegmentDefinition(new HNVSK());
	registerSegmentDefinition(new HNVSD());
	registerSegmentDefinition(new HNSHK());
	registerSegmentDefinition(new HNSHA());
	registerSegmentDefinition(new HKIDN());
	registerSegmentDefinition(new HKVVB());
	registerSegmentDefinition(new HKSYN());
	registerSegmentDefinition(new HKTAN());
	registerSegmentDefinition(new HKTAB());
	registerSegmentDefinition(new HIRMG());
	registerSegmentDefinition(new HIRMS());
	registerSegmentDefinition(new HIBPA());
	registerSegmentDefinition(new HIKOM());
	registerSegmentDefinition(new HIKIM());
	registerSegmentDefinition(new HISYN());
	registerSegmentDefinition(new HITAB());
	registerSegmentDefinition(new HIPINS());
	registerSegmentDefinition(new HITAN());
	registerSegmentDefinition(new HITANS());
	registerSegmentDefinition(new HIUPA());
	registerSegmentDefinition(new HIUPD());
	registerSegmentDefinition(new HKEND());
	registerSegmentDefinition(new HKSAL());
	registerSegmentDefinition(new HISAL());
	registerSegmentDefinition(new HKKAZ());
	registerSegmentDefinition(new DKKKU());
	registerSegmentDefinition(new DIKKU());
	registerSegmentDefinition(new HIKAZ());
	registerSegmentDefinition(new HIKAZS());
	registerSegmentDefinition(new HKCAZ());
	registerSegmentDefinition(new HICAZ());
	registerSegmentDefinition(new HICAZS());
	registerSegmentDefinition(new HKWPD());
	registerSegmentDefinition(new HIWPD());
	registerSegmentDefinition(new HKWPD());
	registerSegmentDefinition(new HIWPD());
	registerSegmentDefinition(new HKSPA());
	registerSegmentDefinition(new HISPA());
	registerSegmentDefinition(new HISPAS());
	registerSegmentDefinition(new UNKNOW());
	registerSegmentDefinition(new PARTED());
}

export function getSegmentDefinition(id: string): SegmentDefinition | undefined {
	return registry.get(id);
}

function registerSegmentDefinition(definition: SegmentDefinition) {
	registry.set(definition.id, definition);
}
