import { DataElement } from './DataElement.js';
import { finTsDecode, finTsEncode } from '../format.js';

export class AlphaNumeric extends DataElement {
  constructor(
    name: string,
    minCount = 0,
    maxCount = 1,
    public maxLength?: number,
    minVersion?: number,
    maxVersion?: number
  ) {
    super(name, minCount, maxCount, minVersion, maxVersion);
  }

  encode(value: string): string {
    if (!value) {
      return '';
    }

    if (value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
      throw Error(`the AlphaNumeric value '${this.name}' must not contain CR or LF characters`);
    }

    if (this.maxLength && value.toString().length > this.maxLength) {
      throw Error(`the AlphaNumeric value '${this.name}' must not exceed its maximum length`);
    }

    return finTsEncode(value.trim());
  }

  decode(text: string): string {
    return finTsDecode(text);
  }
}
