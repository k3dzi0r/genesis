import { describe, expect, it } from 'vitest';
import { ABLATION_GROUPS, ablationSuite, clusterStrategies, probeBehavior } from '../src/engine/analysis';
import { B2_OFF, GENOME_LEN, N_HID, N_IN, OUT_ATTACK, OUT_EAT, OUT_THRUST, OUT_TURN, TRAIT_DIET, W1_OFF, W2_OFF } from '../src/engine/constants';
import { runSweep, sweepToCsv } from '../src/engine/experiment';
import { ci95, mean, sd, tCdf, tQuantile975, welchTest } from '../src/engine/statsutil';
import { smallWorld } from './helpers';

describe('statystyka', () => {
  it('rozkład t: wartości wzorcowe', () => {
    expect(tCdf(0, 5)).toBeCloseTo(0.5, 10);
    expect(tQuantile975(10)).toBeCloseTo(2.228, 3);
    expect(tQuantile975(4)).toBeCloseTo(2.776, 3);
    expect(tCdf(2.228, 10)).toBeCloseTo(0.975, 3);
  });

  it('przedział ufności i test Welcha', () => {
    const c = ci95([1, 2, 3, 4, 5]);
    expect(c.mean).toBe(3);
    expect(sd([1, 2, 3, 4, 5])).toBeCloseTo(1.5811, 3);
    expect(c.hi - c.mean).toBeCloseTo(1.963, 2);
    expect(welchTest([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]).p).toBeCloseTo(1, 6);
    expect(welchTest([1, 2, 3, 4, 5], [11, 12, 13, 14, 15]).p).toBeLessThan(1e-4);
    // wzorzec: a=[27.5,21,19,23.6,17,17.9,16.9,20.1,21.9,22.6,23.1,19.6,19,21.7,21.4], b=[27.1,22,20.8,23.4,23.4,23.5,25.8,22,24.8,20.2,21.9,22.1,22.9,20.5,24.4]
    const a = [27.5, 21, 19, 23.6, 17, 17.9, 16.9, 20.1, 21.9, 22.6, 23.1, 19.6, 19, 21.7, 21.4];
    const b = [27.1, 22, 20.8, 23.4, 23.4, 23.5, 25.8, 22, 24.8, 20.2, 21.9, 22.1, 22.9, 20.5, 24.4];
    const r = welchTest(a, b);
    expect(mean(b) - mean(a)).toBeCloseTo(r.diff, 10);
    // wartości policzone niezależnie (Python, całkowanie numeryczne gęstości t): t=2,45536, df=24,9885, p=0,021378
    expect(r.t).toBeCloseTo(2.45536, 4);
    expect(r.df).toBeCloseTo(24.9885, 3);
    expect(r.p).toBeCloseTo(0.021378, 4);
  });
});

describe('ablacja i klastrowanie', () => {
  it('zestaw ablacji kohortowej zwraca skończone wyniki dla każdej grupy i jest deterministyczny', () => {
    const w = smallWorld(21, { initialPopulation: 200 });
    w.run(1500);
    const a = ablationSuite(w, 200);
    const b = ablationSuite(w, 200);
    expect(a.rows).toHaveLength(ABLATION_GROUPS.length);
    for (const r of a.rows) {
      expect(Number.isFinite(r.dSurvival)).toBe(true);
      expect(Number.isFinite(r.zOffspring)).toBe(true);
      expect(r.ablated.n + r.intact.n).toBe(w.pool.n);
    }
    // czucie temperatury jest stałe (=1) → podstawienie średniej nic nie zmienia → efekt dokładnie zerowy
    const temp = a.rows.find((r) => r.group === 'temperature')!;
    expect(temp.dSurvival).toBeCloseTo(0, 12);
    expect(temp.dOffspring).toBeCloseTo(0, 12);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('zmysł pokarmu opłaca się organizmom z wbudowaną taksją (kohorta bez zmysłu przegrywa)', () => {
    // sieć „ręcznie” skonstruowana: skręt = foodLat; reszta wyjść stała. To test samej procedury pomiarowej.
    const w = smallWorld(25, { initialPopulation: 400, founderDietMax: 0 }, { mutationRate: 0, predationPower: 0, accidentRate: 0 });
    const p = w.pool;
    for (let i = 0; i < p.n; i++) {
      const o = i * GENOME_LEN;
      for (let g = W1_OFF; g < GENOME_LEN; g++) p.genomes[o + g] = 0;
      // ukryty neuron 0 = foodLat; wyjście skręt = +3·h0
      p.genomes[o + W1_OFF + 0 * N_IN + 3] = 4;
      p.genomes[o + W2_OFF + OUT_TURN * N_HID + 0] = 3;
      p.genomes[o + B2_OFF + OUT_THRUST] = 0.5; // powolny ruch
      p.genomes[o + B2_OFF + OUT_EAT] = 6; // zawsze je
      p.genomes[o + B2_OFF + OUT_ATTACK] = -6;
      w.derivePhysiology(i);
    }
    w.run(600);
    const s = ablationSuite(w, 500, ['food']);
    const r = s.rows[0];
    expect(r.intact.energy).toBeGreaterThan(r.ablated.energy);
  });

  it('ablacja nie zmienia świata, z którego startuje (działa na kopiach)', () => {
    const w = smallWorld(22, { initialPopulation: 150 });
    w.run(500);
    const before = w.tick;
    ablationSuite(w, 100, ['food']);
    expect(w.tick).toBe(before);
    expect(w.ablate).toBeNull();
  });

  it('klastrowanie rozdziela dwie wyraźnie różne grupy i jest deterministyczne', () => {
    const w = smallWorld(23, { initialPopulation: 120 }, { mutationRate: 0 });
    const p = w.pool;
    for (let i = 0; i < p.n; i++) {
      for (let t = 0; t < 8; t++) p.genomes[i * GENOME_LEN + t] = 0.5;
      p.genomes[i * GENOME_LEN + TRAIT_DIET] = i % 2 === 0 ? 0.05 : 0.95;
      w.derivePhysiology(i);
    }
    const c = clusterStrategies(w, 2);
    expect(c).toHaveLength(2);
    expect(c[0].share + c[1].share).toBeCloseTo(1, 10);
    expect(c.some((x) => x.label.includes('drapieżnik'))).toBe(true);
    expect(c.some((x) => !x.label.includes('drapieżnik'))).toBe(true);
    expect(JSON.stringify(clusterStrategies(w, 2))).toBe(JSON.stringify(c));
  });

  it('sondy zachowań zwracają komplet wyników', () => {
    const w = smallWorld(24, { initialPopulation: 150 });
    w.run(300);
    const r = probeBehavior(w);
    expect(r.results.length).toBeGreaterThanOrEqual(7);
    for (const x of r.results) expect(Number.isFinite(x.z)).toBe(true);
  });
});

describe('przeszukiwanie parametrów', () => {
  it('siatka 2×2 × 2 seedy daje komplet komórek i poprawny CSV', () => {
    const r = runSweep(
      { width: 240, height: 240, initialPopulation: 60, capacity: 600 },
      {},
      { key: 'regrowthRate', values: [0.05, 0.12] },
      { key: 'mutationRate', values: [0.02, 0.08] },
      [1, 2],
      400,
    );
    expect(r.cells).toHaveLength(2);
    expect(r.cells[0]).toHaveLength(2);
    expect(r.cells[0][0]).toHaveLength(2);
    const csv = sweepToCsv(r).split('\n');
    expect(csv).toHaveLength(1 + 8);
    expect(csv[0].startsWith('x,y,seed')).toBe(true);
  });
});
