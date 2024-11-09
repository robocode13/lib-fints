import { TanMediaRequirement } from './codes.js';

/**
 * Represents a TAN (Transaction Authentication Number) method used to approve transactions.
 *
 * @property {number} id - The unique identifier for the TAN method.
 * @property {string} name - The name of the TAN method.
 * @property {number} version - The version of the TAN method.
 * @property {boolean} isDecoupled - Indicates if the TAN method is decoupled, in which case no real TAN needs to be provided.
 * @property {number} activeTanMediaCount - The number of active TAN media available for approval.
 * @property {string[]} activeTanMedia - The names of active TAN media.
 * @property {TanMediaRequirement} tanMediaRequirement - A value indicating wether a TAN media is required.
 * @property {DecoupledParams} [decoupled] - Optional parameters for decoupled TAN methods, is only set when isDecoupled is also true.
 */
export type TanMethod = {
	id: number;
	name: string;
	version: number;
	isDecoupled: boolean;
	activeTanMediaCount: number;
	activeTanMedia: string[];
	tanMediaRequirement: TanMediaRequirement;
	decoupled?: DecoupledParams;
};

export type DecoupledParams = {
	maxStatusRequests: number;
	waitingSecondsBeforeFirstStatusRequest: number;
	waitingSecondsBetweenStatusRequests: number;
	manualConfirmationAllowed: boolean;
	autoConfirmationAllowed: boolean;
};
