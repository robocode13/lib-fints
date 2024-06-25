import { TanMediaRequirement } from './codes.js';

export type TanMethod = {
  id: number;
  name: string;
  version: number;
  activeTanMediaCount: number;
  activeTanMedia: string[];
  tanMediaRequirement: TanMediaRequirement;
};
