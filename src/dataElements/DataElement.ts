export abstract class DataElement {
  constructor(
    public name: string,
    public minCount = 0,
    public maxCount = 1,
    public minVersion?: number,
    public maxVersion?: number
  ) {
    if (minCount < 0 || maxCount < 0 || minCount > maxCount) {
      throw new Error('invalid count range');
    }

    if (minVersion && maxVersion && minVersion > maxVersion) {
      throw new Error('invalid version range');
    }
  }

  abstract encode(value: any, context: string[], version: number): string;
  abstract decode(text: string, version: number): any;

  maxValueCount(version: number): number {
    return this.isInVersion(version) ? 1 : 0;
  }

  isInVersion(version: number): boolean {
    return (!this.minVersion || version >= this.minVersion) && (!this.maxVersion || version <= this.maxVersion);
  }

  toString(value: any) {
    if (value !== undefined && value !== null && value !== '') {
      return `${this.name}: ${value}`;
    } else if (this.minCount > 0) {
      return `${this.name}: <MISSING>`;
    } else {
      return '';
    }
  }
}
