import { DataElement } from '../dataElements/DataElement.js';
import { decodeElements } from '../decoder.js';
import { encodeElements } from '../encoder.js';

export class DataGroup extends DataElement {
  constructor(
    name: string,
    public elements: DataElement[],
    minCount = 0,
    maxCount = 1,
    minVersion?: number,
    maxVersion?: number
  ) {
    super(name, minCount, maxCount, minVersion, maxVersion);

    if (!Array.isArray(elements)) {
      throw new Error('a FinTS data group must be initialized with an array');
    }

    if (elements.length <= 0) {
      throw new Error('cannot create a FinTS data group with no elements');
    }
  }

  maxValueCount(version: number): number {
    return this.elements.reduce((count, element) => count + element.maxValueCount(version), 0);
  }

  encode(values: any, context: string[], version: number): string {
    if (!version) {
      throw new Error('version is required for encoding an element group');
    }

    const isSingleArray = this.elements.length === 1 && this.elements[0].maxCount > 1;
    return encodeElements(isSingleArray ? [values] : values, this.elements, ':', version, [...context, this.name]);
  }

  decode(text: string, version: number): any {
    if (!text.replaceAll(':', '')) {
      return undefined;
    }

    if (!version) {
      throw new Error('version is required for decoding an element group');
    }

    return decodeElements(text, this.elements, ':', version, this.name);
  }

  toString(values: any) {
    if (!values) {
      return '';
    }

    let texts = this.elements.map((element) => {
      if (element.maxCount > 1) {
        if (this.elements.length === 1) {
          return values.map((value: any) => element.toString(value)).join('; ');
        } else {
          return values[element.name]?.map((value: any) => element.toString(value)).join('; ') ?? '';
        }
      } else {
        return element.toString(values[element.name]);
      }
    });

    return `[${texts.filter((text) => !!text).join(', ')}]`;
  }
}
