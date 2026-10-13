/** Mechanic controls are parameter bundles. Parameters remain the only source of truth. */
import type { WorldParams } from './config';

export type ModuleId = 'predation' | 'foodB' | 'perception' | 'barriers' | 'communication' | 'sexual' | 'mateChoice' | 'learning' | 'cultivation' | 'seasons' | 'biomes';
export interface MechanicModule {
  id: ModuleId; label: string; description: string; help: string;
  on: Partial<WorldParams>; off: Partial<WorldParams>; requires?: ModuleId[];
}
export const MODULES: readonly MechanicModule[] = [
  { id: 'predation', label: 'Drapieżnictwo', description: 'Atak, przejmowanie energii i presja drapieżników.', help: 'predation', on: { predationPower: 4 }, off: { predationPower: 0 } },
  { id: 'foodB', label: 'Dwa pokarmy', description: 'Specjalizacja A/B. Wyłączenie zamienia B w A, zachowując energię.', help: 'param.plantBShare', on: { plantBShare: 0.45 }, off: { plantBShare: 0 } },
  { id: 'perception', label: 'Ograniczone pole widzenia', description: 'Pokarm i sąsiedzi są widoczni w kierunku patrzenia.', help: 'activePerception', on: { viewCos: 0 }, off: { viewCos: -1 } },
  { id: 'barriers', label: 'Bariery', description: 'Przeszkody ograniczają ruch, wzrok i odbiór sygnału.', help: 'param.obstacles', on: { obstacles: 1 }, off: { obstacles: 0 } },
  { id: 'communication', label: 'Komunikacja', description: 'Kosztowne sygnały; ich znaczenie nie jest narzucone.', help: 'communication', on: { communication: 1 }, off: { communication: 0 } },
  { id: 'sexual', label: 'Rozród płciowy', description: 'Dwoje rodziców i rekombinacja genomów.', help: 'param.sexual', on: { sexual: 1 }, off: { sexual: 0 } },
  { id: 'mateChoice', label: 'Wybór partnera', description: 'Wzajemna zgodność. Włączenie uruchamia też rozród płciowy.', help: 'isolation', on: { mateChoice: 1 }, off: { mateChoice: 0 }, requires: ['sexual'] },
  { id: 'learning', label: 'Uczenie podczas życia', description: 'Wyłączenie zatrzymuje nowe zmiany, zachowuje nauczone wagi.', help: 'plasticity', on: { plasticityRate: 0.025 }, off: { plasticityRate: 0 } },
  { id: 'cultivation', label: 'Konstrukcja niszy', description: 'Wyłączenie zatrzymuje kultywację; wcześniejsze zmiany gleby pozostają.', help: 'cultivation', on: { nicheRate: 0.3 }, off: { nicheRate: 0 } },
  { id: 'seasons', label: 'Pory roku', description: 'Okresowe zmiany temperatury i odrastania zasobów.', help: 'seasons', on: { seasonPeriod: 8000 }, off: { seasonPeriod: 0 } },
  { id: 'biomes', label: 'Lokalne biomy', description: 'Trzy siedliska o różnych temperaturach, żyzności i udziale B.', help: 'biomes', on: { biomes: 1 }, off: { biomes: 0 } },
];
export type ModuleMemory = Partial<Record<ModuleId, Partial<WorldParams>>>;
export function moduleEnabled(params: WorldParams, id: ModuleId): boolean {
  if (id === 'perception') return params.viewCos > -1;
  const booleanKeys = { barriers: 'obstacles', communication: 'communication', sexual: 'sexual', mateChoice: 'mateChoice', biomes: 'biomes' } as const;
  if (id in booleanKeys) return params[booleanKeys[id as keyof typeof booleanKeys]] >= 0.5;
  const m = MODULES.find(x => x.id === id)!;
  return Object.keys(m.on).some(key => params[key as keyof WorldParams] > 0);
}
/** Preserve custom active values; remembered disabled values are only restoration hints. */
export function modulePatch(params: WorldParams, id: ModuleId, enabled: boolean, memory: ModuleMemory = {}): Partial<WorldParams> {
  const m = MODULES.find(x => x.id === id)!;
  const patch: Partial<WorldParams> = {};
  if (enabled) {
    for (const dep of m.requires ?? []) Object.assign(patch, modulePatch(params, dep, true, memory));
    if (!moduleEnabled(params, id)) Object.assign(patch, m.on, memory[id]);
  } else {
    Object.assign(patch, m.off);
    for (const dependent of MODULES.filter(x => x.requires?.includes(id))) Object.assign(patch, modulePatch(params, dependent.id, false, memory));
  }
  return patch;
}
export function rememberModules(params: WorldParams, memory: ModuleMemory): void {
  for (const m of MODULES) if (moduleEnabled(params, m.id)) memory[m.id] = Object.fromEntries(Object.keys(m.on).map(key => [key, params[key as keyof WorldParams]]));
}
export const MODULE_PROFILES: { id: string; label: string; ids: ModuleId[] }[] = [
  { id: 'basic', label: 'Podstawy', ids: ['predation'] },
  { id: 'ecology', label: 'Zróżnicowany świat', ids: ['predation', 'foodB', 'perception', 'barriers', 'seasons', 'biomes'] },
  { id: 'all', label: 'Wszystkie mechaniki', ids: MODULES.map(m => m.id) },
];
export function moduleProfilePatch(params: WorldParams, ids: readonly ModuleId[], memory: ModuleMemory = {}): Partial<WorldParams> {
  let next = { ...params };
  for (const m of MODULES) if (!ids.includes(m.id)) Object.assign(next, modulePatch(next, m.id, false, memory));
  for (const id of ids) Object.assign(next, modulePatch(next, id, true, memory));
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== params[key as keyof WorldParams]));
}
