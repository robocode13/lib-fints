import { SegmentDefinition } from '../segmentDefinition.js';
import { HNHBK } from './HNHBK.js';
import { HNHBS } from './HNHBS.js';
import { HNVSK } from './HNVSK.js';
import { HNVSD } from './HNVSD.js';
import { HNSHK } from './HNSHK.js';
import { HNSHA } from './HNSHA.js';
import { HKIDN } from './HKIDN.js';
import { HKVVB } from './HKVVB.js';
import { HKSYN } from './HKSYN.js';
import { HKTAN } from './HKTAN.js';
import { HKTAB } from './HKTAB.js';
import { HIRMG } from './HIRMG.js';
import { HIRMS } from './HIRMS.js';
import { HIBPA } from './HIBPA.js';
import { HIKOM } from './HIKOM.js';
import { HIKIM } from './HIKIM.js';
import { HISYN } from './HISYN.js';
import { HIPINS } from './HIPINS.js';
import { HITAN } from './HITAN.js';
import { HITANS } from './HITANS.js';
import { HIUPA } from './HIUPA.js';
import { HIUPD } from './HIUPD.js';
import { HKEND } from './HKEND.js';
import { HKSAL } from './HKSAL.js';
import { HISAL } from './HISAL.js';
import { HKKAZ } from './HKKAZ.js';
import { HIKAZ } from './HIKAZ.js';
import { HIKAZS } from './HIKAZS.js';
import { HITAB } from './HITAB.js';
import { HKWPD } from './HKWPD.js';
import { HIWPD } from './HIWPD.js';
import { UNKNOW } from '../unknownSegment.js';
import { PARTED } from '../partedSegment.js';

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
  registerSegmentDefinition(new HIKAZ());
  registerSegmentDefinition(new HIKAZS());
  registerSegmentDefinition(new HKWPD());
  registerSegmentDefinition(new HIWPD());
  registerSegmentDefinition(new UNKNOW());
  registerSegmentDefinition(new PARTED());
}

export function getSegmentDefinition(
  id: string
): SegmentDefinition | undefined {
  return registry.get(id);
}

function registerSegmentDefinition(definition: SegmentDefinition) {
  registry.set(definition.id, definition);
}
