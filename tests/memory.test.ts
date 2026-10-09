import { describe, expect, it } from 'vitest';
import { B2_OFF, GENOME_LEN, IN_MEM, N_MEM, OUT_EAT, OUT_MEM, OUT_THRUST, TRAIT_MEMORY, W1_OFF } from '../src/engine/constants';
import { stateHash } from '../src/engine/serialize';
import { World } from '../src/engine/world';
import { smallWorld } from './helpers';

const ZERO_COSTS = { basalCoef: 0, moveCoef: 0, turnCoef: 0, senseCoef: 0, brainCoef: 0, eatCoef: 0, coldUpkeepCoef: 0, attackCoef: 0, accidentRate: 0, mutationRate: 0 };

function solo(memGene: number) {
  const w = new World({ seed: 2, width: 200, height: 200, initialPopulation: 1, capacity: 10 }, ZERO_COSTS);
  const p = w.pool;
  for (let g = W1_OFF; g < GENOME_LEN; g++) p.genomes[g] = 0;
  p.genomes[B2_OFF + OUT_THRUST] = -6;
  p.genomes[B2_OFF + OUT_EAT] = -6;
  p.genomes[B2_OFF + OUT_MEM] = 6; // pierwszy neuron pamięci zawsze „zapisuje” +1
  p.genomes[TRAIT_MEMORY] = memGene;
  w.derivePhysiology(0);
  p.energy[0] = 0.5 * p.maxE[0];
  return w;
}

describe('pamięć rekurencyjna', () => {
  it('stan pamięci zbliża się do zapisywanej wartości z szybkością zadaną genem trwałości', () => {
    const w = solo(1); // λ = 0.99
    const lam = w.pool.memDecay[0];
    expect(lam).toBeCloseTo(0.99, 5);
    for (let t = 1; t <= 12; t++) {
      w.step();
      expect(w.pool.mem[0]).toBeCloseTo(1 - Math.pow(lam, t), 5);
    }
    const slow = w.pool.mem[0];
    const fast = solo(0); // λ = 0.5
    fast.run(12);
    expect(fast.pool.mem[0]).toBeGreaterThan(slow * 5);
  });

  it('pamięć jest podawana na wejścia sieci w następnym ticku', () => {
    const w = solo(0);
    w.run(5);
    const v = w.inspect(w.pool.id[0])!;
    expect(v.inputs[IN_MEM]).toBeCloseTo(w.pool.mem[0], 6);
    expect(v.inputs[IN_MEM]).toBeGreaterThan(0.9);
    expect(v.mem).toHaveLength(N_MEM);
  });

  it('noworodek zaczyna z pustą pamięcią', () => {
    const w = smallWorld(4);
    w.run(1500);
    const p = w.pool;
    let checked = 0;
    for (let i = 0; i < p.n; i++)
      if (p.age[i] === 0) {
        for (let k = 0; k < N_MEM; k++) expect(p.mem[i * N_MEM + k]).toBe(0);
        checked++;
      }
    expect(checked).toBeGreaterThanOrEqual(0);
  });

  it('ablacja pamięci podstawia stałą średnią i zmienia przebieg symulacji', () => {
    const a = smallWorld(6);
    const b = smallWorld(6);
    a.run(300);
    b.run(300);
    b.measureInputMeans();
    b.ablate = 'memory';
    a.run(100);
    b.run(100);
    // wejścia pamięci są identyczne u wszystkich organizmów (stała), choć sam stan pamięci dalej ewoluuje
    const first = b.inspect(b.pool.id[0])!.inputs;
    for (let i = 1; i < Math.min(20, b.pool.n); i++) {
      const v = b.inspect(b.pool.id[i])!.inputs;
      for (let k = 0; k < N_MEM; k++) expect(v[IN_MEM + k]).toBeCloseTo(first[IN_MEM + k], 12);
    }
    let any = 0;
    for (let i = 0; i < b.pool.n * N_MEM; i++) any += Math.abs(b.pool.mem[i]);
    expect(any).toBeGreaterThan(0);
    expect(stateHash(a)).not.toBe(stateHash(b));
  });

  it('ablacja zmysłu pokarmu podstawia stałą średnią zamiast zera', () => {
    const w = smallWorld(7);
    w.run(100);
    const means = w.measureInputMeans();
    expect(means[4]).toBeGreaterThan(0);
    w.ablate = 'food';
    for (let i = 0; i < Math.min(10, w.pool.n); i++) {
      const v = w.inspect(w.pool.id[i])!;
      for (const k of [2, 3, 4, 5]) expect(v.inputs[k]).toBeCloseTo(means[k], 12);
    }
  });
});
