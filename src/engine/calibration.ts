/** Reproducible whole-world controls; no search or selection of favourable seeds. */
import { World } from './world';
import type { WorldParams, WorldSetup } from './config';
import { summarize, type RunSummary } from './experiment';
import { deserializeWorld, serializeWorld, stateHash } from './serialize';
import { pairedSeedTest } from './statsutil';

export const CALIBRATION_SETUP: Partial<WorldSetup> = { width: 400, height: 400, initialPopulation: 100, capacity: 800 };
export const CALIBRATION_PARAMS: Partial<WorldParams> = { maxPopulation: 600, plantBShare: 0.45, communication: 1, sexual: 1, mateChoice: 1, plasticityRate: 0.025, viewCos: 0, nicheRate: 0.3, biomes: 1 };
export const CALIBRATION_CONDITIONS: { id: string; label: string; patch: Partial<WorldParams> }[] = [
  { id: 'control', label: 'Wszystkie badane mechaniki', patch: {} },
  { id: 'communication-off', label: 'Bez komunikacji', patch: { communication: 0 } },
  { id: 'mate-choice-off', label: 'Bez wyboru partnera', patch: { mateChoice: 0 } },
  { id: 'learning-off', label: 'Bez uczenia', patch: { plasticityRate: 0 } },
  { id: 'perception-off', label: 'Widzenie 360°', patch: { viewCos: -1 } },
  { id: 'cultivation-off', label: 'Bez konstrukcji niszy', patch: { nicheRate: 0 } },
  { id: 'biomes-off', label: 'Bez biomów', patch: { biomes: 0 } },
];
export interface CalibrationRun {
  condition: string; summary: RunSummary; initialHash: number; finalHash: number;
  energyImbalance: number; observationsImmutable: boolean; resumeExact: boolean | null;
  biomes: ReturnType<World['biomeSnapshot']>; counters: Record<string, number>;
}
export function calibrationRun(seed: number, ticks: number, patch: Partial<WorldParams>, auditResume = false,
  setup: Partial<WorldSetup> = CALIBRATION_SETUP, params: Partial<WorldParams> = CALIBRATION_PARAMS): Omit<CalibrationRun, 'condition'> {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(ticks) || ticks < 1) throw new Error('Nieprawidłowy seed lub liczba ticków.');
  const w = new World({ ...setup, seed }, { ...params, ...patch });
  const initialHash = stateHash(w);
  const halfway = Math.floor(ticks / 2);
  w.run(halfway);
  const resumed = auditResume ? deserializeWorld(serializeWorld(w)) : null;
  w.run(ticks - w.tick);
  resumed?.run(ticks - resumed.tick);
  const finalHash = stateHash(w);
  const summary = summarize(w), biomes = w.biomeSnapshot();
  const counters = Object.fromEntries(['meanSignal', 'mateRejected', 'plasticChange', 'nicheMean', 'biomeMigrations', 'foodFrac', 'foodB'].map(k => [k, w.stats.last(k)]));
  if (Object.values(counters).some(value => !Number.isFinite(value))) throw new Error('Brak lub nieprawidłowa metryka kalibracji.');
  return { summary, initialHash, finalHash, energyImbalance: w.energyImbalance(), observationsImmutable: finalHash === stateHash(w), resumeExact: resumed ? finalHash === stateHash(resumed) : null, biomes, counters };
}
export function calibrationComparisons(runs: readonly CalibrationRun[]) {
  const control = runs.filter(r => r.condition === 'control');
  const metrics = ['finalPop', 'meanPop', 'totalBirths', 'totalDeaths'] as const;
  return CALIBRATION_CONDITIONS.filter(c => c.id !== 'control').filter(c => runs.some(r => r.condition === c.id)).map(c => ({
    condition: c.id, label: c.label,
    metrics: Object.fromEntries(metrics.map(key => [key, pairedSeedTest(control.map(r => ({ seed: r.summary.seed, value: r.summary[key] })), runs.filter(r => r.condition === c.id).map(r => ({ seed: r.summary.seed, value: r.summary[key] })), r => r.value)])),
  }));
}
