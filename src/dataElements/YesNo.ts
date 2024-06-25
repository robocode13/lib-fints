import { DataElement } from './DataElement.js';

export class YesNo extends DataElement {
  constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
    super(name, minCount, maxCount, minVersion, maxVersion);
  }

  encode(value: boolean): string {
    if (value === undefined || value === null) {
      return '';
    }

    return value ? 'J' : 'N';
  }

  decode(text: string) {
    if (text !== 'J' && text !== 'N') {
      throw Error(`the YesNo value '${this.name}' must be the character J or N`);
    }

    return text === 'J';
  }
}
