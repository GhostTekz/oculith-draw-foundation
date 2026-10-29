// The editor's composition is selected once at start-up.
import { edition as foundation } from './community.js';
import { assertEditionContract } from './contract.js';

export const edition = globalThis.__ocudrawEdition
  ? assertEditionContract(globalThis.__ocudrawEdition)
  : foundation;
