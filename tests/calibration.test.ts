import { describe, expect, it } from 'vitest';
import { calibrationComparisons, calibrationRun, type CalibrationRun } from '../src/engine/calibration';
import { SMALL } from './helpers';

describe('paired calibration audit', () => {
  it('preserves exact replay and observation source; identical controls reproduce', () => {
    const a = calibrationRun(19, 85, {}, true, SMALL), b = calibrationRun(19, 85, {}, false, SMALL);
    expect(a.resumeExact).toBe(true);
    expect(a.observationsImmutable).toBe(true);
    expect(a.finalHash).toBe(b.finalHash);
    expect(Math.abs(a.energyImbalance)).toBeLessThan(1e-5);
    expect(Object.values(a.counters).every(Number.isFinite)).toBe(true);
    expect(a.biomes.biomes.reduce((sum, x) => sum + x.population, 0)).toBe(a.summary.finalPop);
  });
  it('retains null and negative outcomes, pairing by seed rather than order', () => {
    const row = calibrationRun(1, 1, {}, false, { ...SMALL, initialPopulation: 0 });
    const records: CalibrationRun[] = [
      { ...row, condition: 'control', summary: { ...row.summary, seed: 1, finalPop: 10 } },
      { ...row, condition: 'control', summary: { ...row.summary, seed: 2, finalPop: 20 } },
      { ...row, condition: 'communication-off', summary: { ...row.summary, seed: 2, finalPop: 20 } },
      { ...row, condition: 'communication-off', summary: { ...row.summary, seed: 1, finalPop: 10 } },
      { ...row, condition: 'learning-off', summary: { ...row.summary, seed: 2, finalPop: 15 } },
      { ...row, condition: 'learning-off', summary: { ...row.summary, seed: 1, finalPop: 5 } },
    ];
    const result = calibrationComparisons(records);
    expect(result[0].metrics.finalPop).toMatchObject({ diff: 0, p: 1 });
    expect(result[1].metrics.finalPop).toMatchObject({ diff: -5 });
    expect(() => calibrationRun(NaN, 100, {})).toThrow();
    expect(() => calibrationRun(1, Infinity, {})).toThrow();
  });
});
