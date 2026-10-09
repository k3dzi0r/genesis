import { describe, expect, it } from 'vitest';
import { GENOME_LEN, MAX_WEIGHT, N_TRAITS } from '../src/engine/constants';
import { genomeDistance, inheritWithMutation, makeMutationScratch, randomGenome } from '../src/engine/genome';
import { Rng } from '../src/engine/rng';

function founder(seed = 1): Float32Array {
  const g = new Float32Array(GENOME_LEN);
  randomGenome(new Rng(seed), g, 0, 0.6);
  return g;
}

describe('genom i mutacje', () => {
  it('bez mutacji potomek jest identyczną kopią rodzica', () => {
    const p = founder();
    const c = new Float32Array(GENOME_LEN);
    const sc = makeMutationScratch();
    inheritWithMutation(p, 0, c, 0, new Rng(5), 0, 0.2, 0.05, sc);
    expect(Array.from(c)).toEqual(Array.from(p));
    expect(sc.count).toBe(0);
  });

  it('rejestr mutacji dokładnie opisuje różnicę dziecko vs rodzic', () => {
    const p = founder(2);
    const c = new Float32Array(GENOME_LEN);
    const sc = makeMutationScratch();
    inheritWithMutation(p, 0, c, 0, new Rng(6), 0.2, 0.3, 0.1, sc);
    expect(sc.count).toBeGreaterThan(0);
    const rebuilt = p.slice();
    for (let k = 0; k < sc.count; k++) rebuilt[sc.idx[k]] = sc.val[k];
    expect(Array.from(rebuilt)).toEqual(Array.from(c));
    const diff = [...c].map((v, i) => (v !== p[i] ? i : -1)).filter((i) => i >= 0);
    expect(diff).toEqual(Array.from(sc.idx.subarray(0, sc.count)).sort((a, b) => a - b));
  });

  it('częstość mutacji odpowiada parametrowi', () => {
    const p = founder(3);
    const c = new Float32Array(GENOME_LEN);
    const sc = makeMutationScratch();
    const rng = new Rng(9);
    let total = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      inheritWithMutation(p, 0, c, 0, rng, 0.05, 0.2, 0.05, sc);
      total += sc.count;
    }
    expect(total / N / GENOME_LEN).toBeGreaterThan(0.04);
    expect(total / N / GENOME_LEN).toBeLessThan(0.06);
  });

  it('cechy pozostają w [0,1], wagi w [-MAX,MAX] nawet przy ogromnych mutacjach', () => {
    let g = founder(4);
    const sc = makeMutationScratch();
    const rng = new Rng(11);
    for (let i = 0; i < 300; i++) {
      const c = new Float32Array(GENOME_LEN);
      inheritWithMutation(g, 0, c, 0, rng, 1, 50, 5, sc);
      g = c;
      for (let t = 0; t < N_TRAITS; t++) {
        expect(g[t]).toBeGreaterThanOrEqual(0);
        expect(g[t]).toBeLessThanOrEqual(1);
      }
      for (let k = N_TRAITS; k < GENOME_LEN; k++) expect(Math.abs(g[k])).toBeLessThanOrEqual(MAX_WEIGHT);
    }
  });

  it('odległość genomów: 0 dla identycznych, >0 dla różnych', () => {
    const a = founder(1);
    const b = founder(2);
    expect(genomeDistance(a, 0, a, 0)).toEqual({ traits: 0, weights: 0 });
    const d = genomeDistance(a, 0, b, 0);
    expect(d.traits).toBeGreaterThan(0);
    expect(d.weights).toBeGreaterThan(0);
  });
});
