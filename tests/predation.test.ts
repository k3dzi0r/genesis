import { describe, expect, it } from 'vitest';
import { B2_OFF, GENOME_LEN, OUT_ATTACK, OUT_EAT, OUT_THRUST, PHYSIO, TRAIT_DIET, W1_OFF } from '../src/engine/constants';
import { CAUSE_PREDATION, World } from '../src/engine/world';
import { smallWorld } from './helpers';

const ZERO_COSTS = { basalCoef: 0, moveCoef: 0, turnCoef: 0, senseCoef: 0, brainCoef: 0, eatCoef: 0, coldUpkeepCoef: 0, attackCoef: 0, accidentRate: 0, mutationRate: 0 };

/** Układa n organizmów o zerowych wagach i stałych wyjściach: bez ruchu, bez jedzenia, atak zadany. */
function arena(attackers: { x: number; diet: number }[], victimEnergyFrac: number, victimX = 100) {
  const n = attackers.length + 1;
  const w = new World({ seed: 1, width: 200, height: 200, initialPopulation: n, capacity: 50, founderDietMax: 0 }, ZERO_COSTS);
  const p = w.pool;
  for (let i = 0; i < n; i++) {
    for (let g = W1_OFF; g < GENOME_LEN; g++) p.genomes[i * GENOME_LEN + g] = 0;
    const o = i * GENOME_LEN;
    p.genomes[o + B2_OFF + OUT_THRUST] = -6;
    p.genomes[o + B2_OFF + OUT_EAT] = -6;
    p.genomes[o + 0] = 0.5; // ten sam rozmiar
    const isVictim = i === n - 1;
    p.genomes[o + B2_OFF + OUT_ATTACK] = isVictim ? -6 : 6;
    p.genomes[o + TRAIT_DIET] = isVictim ? 0 : attackers[i].diet;
    p.x[i] = isVictim ? victimX : attackers[i].x;
    p.y[i] = 100;
    w.derivePhysiology(i);
    p.energy[i] = (isVictim ? victimEnergyFrac : 0.2) * p.maxE[i];
    p.age[i] = 0;
  }
  // ręcznie zmieniliśmy energie — ustaw księgę na nowy stan początkowy
  const t = w.totalEnergy();
  w.ledger.initial = t.food + t.organisms;
  return w;
}

describe('drapieżnictwo', () => {
  it('ofiara traci dokładnie tyle, ile napastnik odbiera; napastnik zyskuje take·sprawność mięsa, reszta to ciepło', () => {
    const w = arena([{ x: 96, diet: 1 }], 0.9);
    const p = w.pool;
    const eVictim = p.energy[1];
    const eAttacker = p.energy[0];
    const take = 1 * w.params.predationPower * 1 * p.m075[0] * ((2 * p.radius[0]) / (p.radius[0] + p.radius[1]));
    w.step();
    expect(eVictim - p.energy[1]).toBeCloseTo(take, 6);
    expect(p.energy[0] - eAttacker).toBeCloseTo(take * PHYSIO.meatAssimMax, 6);
    expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-6);
    expect(w.pool.n).toBe(2);
  });

  it('roślinożerca (dieta poniżej progu) nie potrafi atakować', () => {
    const w = arena([{ x: 96, diet: 0 }], 0.9);
    const p = w.pool;
    const before = p.energy[1];
    w.step();
    expect(p.energy[1]).toBe(before);
  });

  it('ofiara wyczerpana do zera ginie z przyczyny „drapieżnik”, a napastnik dostaje tylko to, co ofiara miała', () => {
    const w = arena([{ x: 96, diet: 1 }], 0.01);
    const p = w.pool;
    const eVictim = p.energy[1];
    const eAttacker = p.energy[0];
    w.step();
    expect(w.pool.n).toBe(1);
    expect(w.acc.deaths[CAUSE_PREDATION]).toBe(1);
    expect(p.energy[0] - eAttacker).toBeCloseTo(eVictim * PHYSIO.meatAssimMax, 6);
    expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-6);
  });

  it('dwóch napastników dzieli ofiarę po równo niezależnie od kolejności indeksów', () => {
    const w = arena([{ x: 96, diet: 1 }, { x: 104, diet: 1 }], 0.01);
    const p = w.pool;
    const e0 = [p.energy[0], p.energy[1]];
    w.step();
    expect(w.pool.n).toBe(2);
    const g0 = p.energy[0] - e0[0];
    const g1 = p.energy[1] - e0[1];
    expect(g0).toBeGreaterThan(0);
    expect(g0).toBeCloseTo(g1, 9);
  });

  it('w świecie z drapieżnikami bilans energii pozostaje zgodny, a drapieżnictwo faktycznie zachodzi', () => {
    const w = smallWorld(3, { founderDietMax: 0.9, initialPopulation: 250 }, { predationPower: 6 });
    w.run(2500);
    const preds = w.stats.column('dPred').reduce((a, b) => a + b, 0);
    expect(preds).toBeGreaterThan(0);
    const total = w.totalEnergy();
    const expected = w.ledger.initial + w.ledger.inRegrowth + w.ledger.inManual - (w.ledger.outBasal + w.ledger.outMove + w.ledger.outSense + w.ledger.outUpkeep + w.ledger.outEat + w.ledger.outAttack + w.ledger.outDigest + w.ledger.outRepro + w.ledger.outCorpse + w.ledger.outDecay + w.ledger.outEvent);
    expect(Math.abs(total.food + total.organisms - expected)).toBeLessThan(1e-6 * Math.max(1, expected));
  });

  it('predationPower = 0 wyłącza drapieżnictwo całkowicie', () => {
    const w = smallWorld(3, { founderDietMax: 0.9, initialPopulation: 250 }, { predationPower: 0 });
    w.run(1500);
    expect(w.stats.column('dPred').reduce((a, b) => a + b, 0)).toBe(0);
    expect(w.ledger.outAttack).toBe(0);
  });
});
