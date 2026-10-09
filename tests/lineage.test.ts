import { describe, expect, it } from 'vitest';
import { GENOME_LEN } from '../src/engine/constants';
import { deserializeWorld, serializeWorld } from '../src/engine/serialize';
import { smallWorld } from './helpers';

describe('genealogia', () => {
  it('odtworzony z mutacji genom żyjącego organizmu jest identyczny z rzeczywistym', () => {
    const w = smallWorld(11);
    w.run(2500);
    expect(w.pool.n).toBeGreaterThan(10);
    let checked = 0;
    for (let i = 0; i < w.pool.n; i += 5) {
      const node = w.pool.lin[i];
      const rec = w.lineage.reconstruct(node)!;
      expect(rec).not.toBeNull();
      const real = w.pool.genomes.subarray(i * GENOME_LEN, (i + 1) * GENOME_LEN);
      expect(Array.from(rec)).toEqual(Array.from(real));
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  });

  it('każdy żyjący organizm ma ścieżkę do założyciela; pokolenia rosną o 1', () => {
    const w = smallWorld(12);
    w.run(2500);
    for (let i = 0; i < w.pool.n; i++) {
      const path = w.lineage.ancestry(w.pool.lin[i]);
      const root = path[path.length - 1];
      expect(w.lineage.parent[root]).toBe(-1);
      expect(w.lineage.gen[root]).toBe(0);
      for (let k = 0; k + 1 < path.length; k++) expect(w.lineage.gen[path[k]]).toBe(w.lineage.gen[path[k + 1]] + 1);
      expect(w.lineage.gen[path[0]]).toBe(w.pool.generation[i]);
    }
  });

  it('martwy organizm pozostaje w genealogii, jeśli ma żyjących potomków', () => {
    const w = smallWorld(13);
    w.run(3000);
    const founders = [...w.lineage.founders.keys()];
    const deadWithKids = founders.filter((n) => w.lineage.death[n] >= 0 && w.lineage.refs[n] > 0);
    // historia przodków nie znika po ich śmierci
    expect(deadWithKids.length).toBeGreaterThan(0);
    for (const n of deadWithKids) expect(w.lineage.indexOf(w.lineage.id[n])).toBe(n);
  });

  it('przycinanie usuwa wymarłe linie, ale nie przodków żyjących; pamięć jest ograniczona', () => {
    const w = smallWorld(14);
    w.lineageRetention = 200;
    w.run(6000);
    const L = w.lineage;
    expect(L.totalPruned).toBeGreaterThan(0);
    expect(L.liveNodes).toBeLessThan(L.totalRecorded);
    for (let i = 0; i < w.pool.n; i++) {
      for (const n of L.ancestry(w.pool.lin[i])) expect(L.death[n]).not.toBe(-2);
    }
  });

  it('zapięty organizm zachowuje przodków mimo śmierci', () => {
    const w = smallWorld(15);
    w.lineageRetention = 50;
    w.run(1500);
    const id = w.pool.id[0];
    w.select(id);
    const node = w.lineage.indexOf(id);
    const path = w.lineage.ancestry(node);
    w.run(6000);
    for (const n of path) expect(w.lineage.death[n]).not.toBe(-2);
  });

  it('scalanie łańcuchów jednokrotnych zmniejsza genealogię, ale genomy przodków pozostają dokładne', () => {
    const mk = (compact: boolean) => {
      const w = smallWorld(16);
      w.lineageRetention = 300;
      w.lineage.compactEnabled = compact;
      w.run(9000);
      return w;
    };
    const a = mk(true);
    const b = mk(false);
    expect(a.lineage.totalSpliced).toBeGreaterThan(0);
    expect(a.lineage.liveNodes).toBeLessThan(b.lineage.liveNodes);
    const p = a.pool;
    for (let i = 0; i < p.n; i++) {
      const rec = a.lineage.reconstruct(p.lin[i])!;
      expect(Array.from(rec)).toEqual(Array.from(p.genomes.subarray(i * GENOME_LEN, (i + 1) * GENOME_LEN)));
      // ścieżka do założyciela nadal istnieje, a numery pokoleń maleją ściśle
      const path = a.lineage.ancestry(p.lin[i]);
      expect(a.lineage.parent[path[path.length - 1]]).toBe(-1);
      for (let k = 0; k + 1 < path.length; k++) expect(a.lineage.gen[path[k]]).toBeGreaterThan(a.lineage.gen[path[k + 1]]);
    }
    // zapis i odczyt zachowuje licznik scalonych węzłów
    expect(deserializeWorld(serializeWorld(a)).lineage.totalSpliced).toBe(a.lineage.totalSpliced);
  });
});
