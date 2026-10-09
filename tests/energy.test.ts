import { describe, expect, it } from 'vitest';
import { ledgerIn, ledgerOut } from '../src/engine/world';
import { smallWorld } from './helpers';

describe('bilans energii', () => {
  it('energia(pokarm)+energia(organizmy) = początkowa + wpływy − rozproszenie', () => {
    const w = smallWorld(1);
    for (let k = 0; k < 6; k++) {
      w.run(500);
      const total = w.totalEnergy();
      const expected = w.ledger.initial + ledgerIn(w.ledger) - ledgerOut(w.ledger);
      expect(Math.abs(total.food + total.organisms - expected)).toBeLessThan(1e-6 * Math.max(1, expected));
    }
    expect(w.pool.n).toBeGreaterThan(0);
  });

  it('bilans zachowany także przy zdarzeniach, dosypywaniu zasobów i zmianie parametrów', () => {
    const w = smallWorld(2);
    w.run(800);
    w.applyCommand({ type: 'addFood', amount: 5000 });
    w.applyCommand({ type: 'event', spec: { kind: 'cull', severity: 0.4 } });
    w.run(300);
    w.applyCommand({ type: 'event', spec: { kind: 'blight', severity: 0.5 } });
    w.applyCommand({ type: 'event', spec: { kind: 'coldSnap', severity: 0.8, duration: 400 } });
    w.applyCommand({ type: 'setParam', key: 'regrowthRate', value: 0.1 });
    w.applyCommand({ type: 'event', spec: { kind: 'drought', severity: 0.9, duration: 500 } });
    w.run(1200);
    w.applyCommand({ type: 'event', spec: { kind: 'bloom', severity: 1, duration: 300 } });
    w.run(600);
    const total = w.totalEnergy();
    const expected = w.ledger.initial + ledgerIn(w.ledger) - ledgerOut(w.ledger);
    expect(Math.abs(total.food + total.organisms - expected)).toBeLessThan(1e-6 * Math.max(1, expected));
  });

  it('zasoby i energia organizmów nigdy nie są ujemne ani NaN', () => {
    const w = smallWorld(3);
    for (let k = 0; k < 10; k++) {
      w.run(300);
      for (let c = 0; c < w.grid.cells; c++) {
        expect(Number.isFinite(w.grid.food[c])).toBe(true);
        expect(w.grid.food[c]).toBeGreaterThanOrEqual(-1e-9);
      }
      for (let i = 0; i < w.pool.n; i++) {
        expect(Number.isFinite(w.pool.energy[i])).toBe(true);
        expect(w.pool.energy[i]).toBeGreaterThanOrEqual(0);
        expect(w.pool.x[i]).toBeGreaterThanOrEqual(0);
        expect(w.pool.x[i]).toBeLessThanOrEqual(w.setup.width);
      }
    }
  });

  it('bez dopływu energii (regrowth=0) populacja wymiera, a bilans pozostaje zgodny', () => {
    const w = smallWorld(4, { initialFoodFraction: 0.05 }, { regrowthRate: 0 });
    w.run(20000);
    expect(w.status).toBe('extinct');
    expect(w.eventLog.some((e) => e.kind === 'extinction')).toBe(true);
    const total = w.totalEnergy();
    const expected = w.ledger.initial + ledgerIn(w.ledger) - ledgerOut(w.ledger);
    expect(Math.abs(total.food + total.organisms - expected)).toBeLessThan(1e-6 * Math.max(1, expected));
  });

  it('duże zagęszczenie (rywalizacja o pokarm w komórce) nie psuje arytmetyki zasobów', () => {
    for (const seed of [1, 2, 3, 4]) {
      const w = smallWorld(seed, { width: 240, height: 240, initialPopulation: 700, capacity: 1500 });
      for (let k = 0; k < 6; k++) {
        w.run(250);
        for (let c = 0; c < w.grid.cells; c++) {
          expect(Number.isFinite(w.grid.food[c])).toBe(true);
          expect(w.grid.food[c]).toBeGreaterThanOrEqual(-1e-9);
        }
        for (let i = 0; i < w.pool.n; i++) expect(Number.isFinite(w.pool.energy[i])).toBe(true);
      }
      const total = w.totalEnergy();
      const expected = w.ledger.initial + ledgerIn(w.ledger) - ledgerOut(w.ledger);
      expect(Math.abs(total.food + total.organisms - expected)).toBeLessThan(1e-6 * Math.max(1, expected));
    }
  });
});
