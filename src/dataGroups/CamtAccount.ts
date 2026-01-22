import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { DataGroup } from './DataGroup.js';

export type CamtAccount = {
    iban?: string;
    bic?: string;
};

export class CamtAccountGroup extends DataGroup {
    constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
        super(
            name,
            [
                new AlphaNumeric('iban', 0, 1, 34),
                new AlphaNumeric('bic', 0, 1, 11),
            ],
            minCount,
            maxCount,
            minVersion,
            maxVersion,
        );
    }
}
