import { describe, expect, it } from 'vitest';
import { B1_OFF, GENOME_LEN, N_HID, N_IN, N_OUT, N_TRAITS, W1_OFF, W2_OFF } from '../src/engine/constants';
import { crossover, randomGenome } from '../src/engine/genome';
import { Rng } from '../src/engine/rng';
import { deserializeWorld, serializeWorld, stateHash } from '../src/engine/serialize';
import { smallWorld } from './helpers';

describe('rozmnażanie płciowe', () => {
  it('rekombinacja: każdy neuron ukryty dziedziczy komplet wag od jednego rodzica, cechy od któregokolwiek', () => {
    const a = new Float32Array(GENOME_LEN);
    const b = new Float32Array(GENOME_LEN);
    randomGenome(new Rng(1), a, 0, 0.6);
    randomGenome(new Rng(2), b, 0, 0.6);
    const rng = new Rng(3);
    const fromA = new Array(N_HID).fill(0);
    const fromB = new Array(N_HID).fill(0);
    for (let trial = 0; trial < 80; trial++) {
      const c = new Float32Array(GENOME_LEN);
      crossover(a, 0, b, 0, c, 0, rng);
      for (let t = 0; t < N_TRAITS; t++) expect([a[t], b[t]]).toContain(c[t]);
      for (let h = 0; h < N_HID; h++) {
        const row = (g: Float32Array) => [
          ...Array.from(g.subarray(W1_OFF + h * N_IN, W1_OFF + (h + 1) * N_IN)),
          g[B1_OFF + h],
          ...Array.from({ length: N_OUT }, (_, o) => g[W2_OFF + o * N_HID + h]),
        ];
        const rc = row(c);
        const isA = rc.every((v, i) => v === row(a)[i]);
        const isB = rc.every((v, i) => v === row(b)[i]);
        expect(isA || isB).toBe(true);
        if (isA && !isB) fromA[h]++;
        if (isB && !isA) fromB[h]++;
      }
    }
    // oba rodzice wnoszą wkład do każdego neuronu
    for (let h = 0; h < N_HID; h++) {
      expect(fromA[h]).toBeGreaterThan(10);
      expect(fromB[h]).toBeGreaterThan(10);
    }
  });

  it('populacja płciowa przeżywa, ma dwoje rodziców, a genomy odtworzone z rejestru zgadzają się z rzeczywistymi', () => {
    const w = smallWorld(11, { initialPopulation: 250 }, { sexual: 1 });
    w.run(4000);
    expect(w.status).toBe('running');
    const L = w.lineage;
    const p = w.pool;
    let twoParents = 0;
    for (let i = 0; i < p.n; i++) {
      const node = p.lin[i];
      if (L.parent2[node] >= 0) {
        twoParents++;
        expect(L.gen[node]).toBe(Math.max(L.gen[L.parent[node]], L.gen[L.parent2[node]]) + 1);
        expect(L.info(node).parent2Id).not.toBeNull();
      }
      if (i % 7 === 0) {
        const rec = L.reconstruct(node)!;
        expect(Array.from(rec)).toEqual(Array.from(p.genomes.subarray(i * GENOME_LEN, (i + 1) * GENOME_LEN)));
      }
    }
    expect(twoParents).toBeGreaterThan(20);
  });

  it('tryb bezpłciowy nie zapisuje drugiego rodzica', () => {
    const w = smallWorld(11);
    w.run(1500);
    for (let i = 0; i < w.pool.n; i++) expect(w.lineage.parent2[w.pool.lin[i]]).toBe(-1);
  });

  it('drugi rodzic jest zachowany w genealogii dopóki żyje potomek', () => {
    const w = smallWorld(12, { initialPopulation: 250 }, { sexual: 1 });
    w.lineageRetention = 100;
    w.run(5000);
    const L = w.lineage;
    for (let i = 0; i < w.pool.n; i++) {
      const n2 = L.parent2[w.pool.lin[i]];
      if (n2 >= 0) expect(L.death[n2]).not.toBe(-2);
    }
  });

  it('deterministyczne i odtwarzalne po zapisie', () => {
    const mk = () => smallWorld(13, { initialPopulation: 200 }, { sexual: 1 });
    const a = mk();
    const b = mk();
    a.run(1500);
    b.run(1500);
    expect(stateHash(a)).toBe(stateHash(b));
    const c = deserializeWorld(serializeWorld(a));
    a.run(800);
    c.run(800);
    expect(stateHash(c)).toBe(stateHash(a));
  });

  it('bilans energii zachowany przy rozmnażaniu płciowym', () => {
    const w = smallWorld(14, { initialPopulation: 250 }, { sexual: 1 });
    w.run(3000);
    expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-5);
  });
});
