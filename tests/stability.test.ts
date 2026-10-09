import { describe, expect, it } from 'vitest';
import { GENOME_LEN } from '../src/engine/constants';
import { N_STATS, StatsHistory } from '../src/engine/stats';
import { SpatialGrid } from '../src/engine/spatial';
import { Rng } from '../src/engine/rng';
import { runSeries, seriesToCsv } from '../src/engine/experiment';
import { smallWorld } from './helpers';

describe('stabilność długich symulacji', () => {
  it('40 000 ticków: brak NaN, ograniczona pamięć statystyk i genealogii', () => {
    const w = smallWorld(41, {}, {});
    w.lineageRetention = 3000;
    w.run(40000);
    expect(w.status).toBe('running');
    expect(w.stats.count).toBeLessThanOrEqual(w.stats.maxRows);
    expect(w.lineage.liveNodes).toBeLessThan(40000);
    expect(w.lineage.liveNodes).toBeLessThan(w.lineage.totalRecorded);
    const g = w.pool.genomes;
    for (let i = 0; i < w.pool.n * GENOME_LEN; i++) if (!Number.isFinite(g[i])) throw new Error('NaN w genomie');
    expect(w.pool.n).toBeLessThanOrEqual(w.setup.capacity);
  });

  it('historia statystyk jest scalana zamiast rosnąć bez końca', () => {
    const h = new StatsHistory(64, 10);
    const row = new Float64Array(N_STATS);
    for (let i = 0; i < 1000; i++) {
      row[0] = i;
      row[2] = 1; // births (sum)
      h.push(row);
    }
    expect(h.count).toBeLessThanOrEqual(64);
    expect(h.interval).toBeGreaterThan(10);
    expect(h.version).toBeGreaterThan(0);
    // suma narodzin jest zachowana przy scalaniu
    let sum = 0;
    for (const v of h.column('births')) sum += v;
    expect(sum).toBe(1000);
  });

  it('siatka przestrzenna zwraca dokładnie tych samych sąsiadów co naiwne O(n²)', () => {
    const rng = new Rng(5);
    const n = 600;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = rng.float() * 400;
      y[i] = rng.float() * 300;
    }
    const sp = new SpatialGrid(400, 300, 40, n);
    sp.build(x, y, n);
    for (let t = 0; t < 30; t++) {
      const i = rng.int(n);
      const R = 15 + rng.float() * 80;
      const brute: number[] = [];
      for (let j = 0; j < n; j++) if (j !== i && (x[j] - x[i]) ** 2 + (y[j] - y[i]) ** 2 <= R * R) brute.push(j);
      const fast: number[] = [];
      for (let cy = Math.max(0, ((y[i] - R) / 40) | 0); cy <= Math.min(sp.ny - 1, ((y[i] + R) / 40) | 0); cy++)
        for (let cx = Math.max(0, ((x[i] - R) / 40) | 0); cx <= Math.min(sp.nx - 1, ((x[i] + R) / 40) | 0); cx++) {
          const c = cy * sp.nx + cx;
          for (let q = sp.start[c]; q < sp.start[c + 1]; q++) {
            const j = sp.items[q];
            if (j !== i && (x[j] - x[i]) ** 2 + (y[j] - y[i]) ** 2 <= R * R) fast.push(j);
          }
        }
      expect(fast.sort((a, b) => a - b)).toEqual(brute);
    }
  });

  it('seria z różnymi seedami zwraca podsumowania i CSV', () => {
    const rows = runSeries({ width: 300, height: 300, initialPopulation: 80, capacity: 800 }, {}, [1, 2, 3], 1500);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.seed)).size).toBe(3);
    const csv = seriesToCsv(rows);
    expect(csv.split('\n')).toHaveLength(4);
  });

  it('katastrofa zabijająca wszystko kończy się wykrytym wymarciem', () => {
    const w = smallWorld(42);
    w.run(100);
    w.applyCommand({ type: 'event', spec: { kind: 'cull', severity: 1 } });
    w.run(5);
    expect(w.pool.n).toBe(0);
    expect(w.status).toBe('extinct');
    expect(w.eventLog.some((e) => e.kind === 'extinction')).toBe(true);
  });
});
