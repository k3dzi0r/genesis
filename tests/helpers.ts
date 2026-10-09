import type { WorldParams, WorldSetup } from '../src/engine/config';
import { World } from '../src/engine/world';

export const SMALL: Partial<WorldSetup> = { width: 400, height: 400, initialPopulation: 150, capacity: 1500 };

export function smallWorld(seed = 1, setup: Partial<WorldSetup> = {}, params: Partial<WorldParams> = {}): World {
  return new World({ ...SMALL, seed, ...setup }, params);
}
