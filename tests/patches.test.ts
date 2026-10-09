import { describe, expect, it } from 'vitest';
import { deserializeWorld, serializeWorld, stateHash } from '../src/engine/serialize';
import { smallWorld } from './helpers';

const fertHash = (w: ReturnType<typeof smallWorld>) => Array.from(w.grid.fert).reduce((a, v, i) => (a + v * (i + 1)) % 1e9, 0);

describe('dynamiczne plamy żyzności', () => {
  it('bez dryfu i cyklu życia mapa żyzności jest stała', () => {
    const w = smallWorld(3);
    const h0 = fertHash(w);
    w.run(600);
    expect(fertHash(w)).toBe(h0);
    expect(w.fertVersion).toBe(0);
  });

  it('dryf przesuwa plamy, zwiększa wersję mapy i zachowuje je w granicach świata', () => {
    const w = smallWorld(3, {}, { patchDrift: 0.5 });
    const h0 = fertHash(w);
    const x0 = w.patches.map((p) => p.x);
    w.run(1200);
    expect(fertHash(w)).not.toBe(h0);
    expect(w.fertVersion).toBeGreaterThan(0);
    expect(w.patches.some((p, i) => Math.abs(p.x - x0[i]) > 20)).toBe(true);
    for (const p of w.patches) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(w.setup.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(w.setup.height);
    }
    for (let c = 0; c < w.grid.cells; c++) {
      expect(w.grid.fert[c]).toBeGreaterThanOrEqual(0);
      expect(w.grid.fert[c]).toBeLessThanOrEqual(1);
    }
  });

  it('cykl życia: plamy odradzają się w nowych miejscach', () => {
    const w = smallWorld(4, {}, { patchLife: 600 });
    const before = w.patches.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    w.run(1500);
    const after = w.patches.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    expect(after.filter((s, i) => s !== before[i]).length).toBeGreaterThan(0);
    expect(w.patches.every((p) => p.life > 0)).toBe(true);
  });

  it('bilans energii zachowany przy zmieniającej się mapie żyzności', () => {
    const w = smallWorld(5, {}, { patchDrift: 0.4, patchLife: 800 });
    w.run(3000);
    const t = w.totalEnergy();
    const L = w.ledger;
    const out = L.outBasal + L.outMove + L.outSense + L.outUpkeep + L.outEat + L.outAttack + L.outDigest + L.outRepro + L.outCorpse + L.outDecay + L.outEvent;
    const expected = L.initial + L.inRegrowth + L.inManual - out;
    expect(Math.abs(t.food + t.organisms - expected)).toBeLessThan(1e-6 * Math.max(1, expected));
  });

  it('deterministyczne i odtwarzalne po zapisie', () => {
    const mk = () => smallWorld(8, {}, { patchDrift: 0.3, patchLife: 700 });
    const a = mk();
    const b = mk();
    a.run(900);
    b.run(900);
    expect(stateHash(a)).toBe(stateHash(b));
    const c = deserializeWorld(serializeWorld(a));
    a.run(600);
    c.run(600);
    expect(stateHash(c)).toBe(stateHash(a));
    expect(fertHash(c)).toBe(fertHash(a));
  });

  it('wyłączenie cyklu życia w trakcie przywraca pełną amplitudę plam', () => {
    const w = smallWorld(9, {}, { patchLife: 500 });
    w.run(300);
    w.applyCommand({ type: 'setParam', key: 'patchLife', value: 0 });
    const w2 = smallWorld(9);
    // plamy bez cyklu mają amplitudę 1 — max żyzności w komórkach dużych plam powinien być wysoki
    const max = (x: typeof w) => Math.max(...Array.from(x.grid.fert));
    expect(max(w)).toBeGreaterThan(0.5);
    expect(w.patches.every((p) => p.life === 0)).toBe(true);
    expect(max(w2)).toBeGreaterThan(0.5);
  });
});
