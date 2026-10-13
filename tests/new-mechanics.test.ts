import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { B2_OFF, GENOME_LEN, IN_FOOD_B_AMOUNT, IN_SIGNAL, N_HID, N_MEM, N_TRAITS, OUT_CULTIVATE, OUT_EAT, OUT_MEM, OUT_SIGNAL, OUT_THRUST, TRAIT_MATE_PREFERENCE, TRAIT_MATE_SELECTIVITY, TRAIT_NICHE, TRAIT_PLANT, TRAIT_PLASTICITY, W1_OFF, W2_OFF } from '../src/engine/constants';
import type { WorldParams } from '../src/engine/config';
import { deserializeWorld, legacyGeneIndex, serializeWorld, stateHash, validateSaveLayout } from '../src/engine/serialize';
import { World, ledgerIn, ledgerOut } from '../src/engine/world';

const FREE: Partial<WorldParams> = { basalCoef: 0, moveCoef: 0, turnCoef: 0, senseCoef: 0, brainCoef: 0, eatCoef: 0, coldUpkeepCoef: 0, attackCoef: 0, signalCoef: 0, learnCoef: 0, cultivationCoef: 0, accidentRate: 0, mutationRate: 0, regrowthRate: 0, foodDecay: 0, predationPower: 0 };
function genome(): Float32Array {
  const g = new Float32Array(GENOME_LEN);
  g.fill(0.5, 0, N_TRAITS); g[5] = 0; g[10] = 0;
  g[B2_OFF + OUT_THRUST] = -6; g[B2_OFF + OUT_EAT] = 6;
  g[B2_OFF + OUT_CULTIVATE] = -6;
  return g;
}
function world(genomes: Float32Array[] = [genome()], params: Partial<WorldParams> = {}, energy = 0.2): World {
  const w = new World({ seed: 3, width: 200, height: 200, initialPopulation: 1, capacity: 100, fertilityPattern: 'uniform', cellSize: 10 }, { ...FREE, ...params });
  w.grid.food.fill(0); w.grid.foodB.fill(0);
  w.seedPopulation(genomes, energy);
  for (let i = 0; i < genomes.length; i++) { w.pool.x[i] = 85 + i * 10; w.pool.y[i] = 85; w.pool.hx[i] = 1; w.pool.hy[i] = 0; }
  return w;
}
function rebase(w: World): void { const t = w.totalEnergy(); w.ledger.initial = t.food + t.organisms - ledgerIn(w.ledger) + ledgerOut(w.ledger); }

describe('GENESIS 0.4 mechaniki', () => {
  it('dwa pokarmy dzielą pojemność i początkową energię, a B ma rzadsze siedliska', () => {
    const setup = { seed: 31, width: 200, height: 200, initialPopulation: 5, capacity: 100, fertilityPattern: 'uniform' as const };
    const a = new World(setup), b = new World(setup, { plantBShare: 0.8 });
    expect(b.totalEnergy().food).toBeCloseTo(a.totalEnergy().food, 8);
    expect(b.grid.foodB.some(v => v > 0)).toBe(true);
    const shares = new Set(Array.from(b.grid.foodB, (v, c) => Math.round(v / (v + b.grid.food[c]) * 100)));
    expect(shares.size).toBe(2);
  });

  it('specjalizacja B poprawia jego trawienie i zmniejsza toksyczność kosztem trawienia A', () => {
    const trial = (specialization: number, b: boolean) => {
      const g = genome(); g[TRAIT_PLANT] = specialization;
      const w = world([g], { plantBShare: 0.8, plantBToxicity: 0.1 });
      (b ? w.grid.foodB : w.grid.food).fill(10); rebase(w);
      const initial = w.pool.energy[0]; w.step();
      expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-7);
      return { gain: w.pool.energy[0] - initial, health: w.pool.health[0] };
    };
    expect(trial(1, true).gain).toBeGreaterThan(trial(0, true).gain * 3);
    expect(trial(1, true).health).toBeGreaterThan(trial(0, true).health);
    expect(trial(0, false).gain).toBeGreaterThan(trial(1, false).gain * 3);
  });

  it('pole widzenia usuwa pokarm z tyłu i pozwala odkryć go po obrocie', () => {
    const w = world(undefined, { viewCos: 0 });
    w.grid.food[w.grid.cellAt(65, 85)] = 20;
    const id = w.pool.id[0];
    expect(w.inspect(id)!.inputs[4]).toBe(0);
    w.pool.hx[0] = -1;
    expect(w.inspect(id)!.inputs[4]).toBeGreaterThan(0);
  });

  it('przeszkoda zasłania oba pokarmy i sąsiada, a jej usunięcie przywraca widoczność', () => {
    const w = world([genome(), genome()], { obstacles: 1 });
    w.grid.obstacles.fill(0); w.grid.obstacles[w.grid.cellAt(105, 85)] = 1;
    w.pool.x[1] = 125;
    w.grid.food[w.grid.cellAt(125, 85)] = 20; w.grid.foodB[w.grid.cellAt(125, 85)] = 20;
    const id = w.pool.id[0];
    expect(w.inspect(id)!.inputs[4]).toBe(0);
    expect(w.inspect(id)!.inputs[IN_FOOD_B_AMOUNT]).toBe(0);
    expect(w.inspect(id)!.inputs[6]).toBe(0);
    w.grid.obstacles.fill(0);
    expect(w.inspect(id)!.inputs[4]).toBeGreaterThan(0);
    expect(w.inspect(id)!.inputs[6]).toBeGreaterThan(0);
  });

  it('ruch odbija organizm przed przeszkodą z uwzględnieniem promienia', () => {
    const g = genome(); g[B2_OFF + OUT_THRUST] = 6;
    const w = world([g], { obstacles: 1 }); w.grid.obstacles.fill(0);
    w.grid.obstacles[w.grid.cellAt(105, 85)] = 1;
    w.run(30);
    expect(w.pool.x[0] + w.pool.radius[0]).toBeLessThanOrEqual(100);
    expect(w.grid.blocked(w.pool.x[0], w.pool.y[0], w.pool.radius[0])).toBe(false);
  });

  it('sygnał jest lokalny, kosztowny i odbierany dopiero w kolejnym ticku', () => {
    const emitter = genome(); emitter[B2_OFF + OUT_SIGNAL] = 6;
    const receiver = genome(); receiver[W1_OFF + IN_SIGNAL] = 6; receiver[W2_OFF + OUT_MEM * N_HID] = 6;
    const w = world([emitter, receiver], { communication: 1, signalCoef: 0.2 });
    const initial = w.pool.energy[0];
    w.step();
    expect(w.pool.mem[N_MEM]).toBe(0);
    expect(w.pool.energy[0]).toBeLessThan(initial);
    expect(w.ledger.outSignal).toBeGreaterThan(0);
    w.step(); expect(w.pool.mem[N_MEM]).toBeGreaterThan(0);
    expect(w.observe(w.pool.id[1])!.signalReceived).toBeGreaterThan(0);
    expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-7);
    w.pool.x[1] = 190; expect(w.inspect(w.pool.id[1])!.inputs[IN_SIGNAL]).toBe(0);
  });

  it('odbiór sygnału nie wymaga widzenia nadawcy, a ablacja usuwa informację', () => {
    const w = world([genome(), genome()], { communication: 1, viewCos: 0 });
    w.pool.signal[1] = 1; w.pool.x[1] = 65;
    expect(w.inspect(w.pool.id[0])!.inputs[6]).toBe(0);
    expect(w.inspect(w.pool.id[0])!.inputs[IN_SIGNAL]).toBe(1);
    w.ablate = 'communication';
    expect(w.inspect(w.pool.id[0])!.inputs[IN_SIGNAL]).toBe(0);
  });

  it('preferencje partnera wymagają wzajemnej zgody, a hue pozostaje neutralne', () => {
    const a = genome(), b = genome(); a[TRAIT_PLANT] = 0; b[TRAIT_PLANT] = 1;
    a[TRAIT_MATE_PREFERENCE] = 0; b[TRAIT_MATE_PREFERENCE] = 0.7;
    a[TRAIT_MATE_SELECTIVITY] = 1; b[TRAIT_MATE_SELECTIVITY] = 1;
    const w = world([a, b], { sexual: 1, mateChoice: 1 }, 0.95);
    expect(w.mateCompatibility(0, 1)).toBe(false);
    w.pool.mateSelectivity[0] = 0;
    expect(w.mateCompatibility(0, 1)).toBe(false); // second parent still rejects
    w.pool.mateSelectivity[1] = 0;
    expect(w.mateCompatibility(0, 1)).toBe(true);
    w.pool.genomes[8] = 0; w.pool.genomes[GENOME_LEN + 8] = 1;
    expect(w.mateCompatibility(0, 1)).toBe(true);
  });

  it('rejestruje rzeczywiste odrzucenia i rozród między grupami', () => {
    const a = genome(), b = genome(); a[TRAIT_PLANT] = 0; b[TRAIT_PLANT] = 1;
    a[TRAIT_MATE_PREFERENCE] = 0; b[TRAIT_MATE_PREFERENCE] = 0.7;
    a[TRAIT_MATE_SELECTIVITY] = b[TRAIT_MATE_SELECTIVITY] = 1;
    const w = world([a, b], { sexual: 1, mateChoice: 1 }, 0.95);
    w.tick = 100; w.pool.age[0] = w.pool.age[1] = 100;
    w.step(); expect(w.pool.n).toBe(2); expect(w.mating.rejectedBetween).toBeGreaterThan(0);
    w.params.mateChoice = 0; w.step(); expect(w.pool.n).toBe(3); expect(w.mating.between).toBe(1);
    expect(w.observe(1)!.crossGroupBirths).toBe(1);
    expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-7);
  });

  it('plastyczność zmienia wagi efektywne, ale nie genom i nie dziedziczy się', () => {
    const g = genome(); g[TRAIT_PLASTICITY] = 1; g[B2_OFF + OUT_EAT] = 1;
    const w = world([g], { plasticityRate: 0.1, learnCoef: 0.05 });
    w.grid.food.fill(50); rebase(w); const inherited = w.pool.genomes.slice(0, GENOME_LEN);
    w.run(20);
    expect(w.pool.somaticWeights.slice(0, GENOME_LEN).some(v => Math.abs(v) > 1e-8)).toBe(true);
    expect(w.ledger.outLearning).toBeGreaterThan(0);
    expect(Array.from(w.pool.genomes.slice(0, GENOME_LEN))).toEqual(Array.from(inherited));
    const view = w.inspect(1)!; expect(Array.from(view.learnedWeights)).not.toEqual(Array.from(view.genome));
    w.tick = 100; w.pool.age[0] = 100; w.pool.energy[0] = w.pool.maxE[0]; rebase(w); w.step();
    const child = w.pool.indexOfId(2); expect(child).toBeGreaterThanOrEqual(0);
    expect(Array.from(w.pool.genomes.slice(child * GENOME_LEN, (child + 1) * GENOME_LEN))).toEqual(Array.from(inherited));
    expect(w.pool.somaticWeights.slice(child * GENOME_LEN, (child + 1) * GENOME_LEN).every(v => v === 0)).toBe(true);
    expect(w.pool.eligibility.slice(child * GENOME_LEN, (child + 1) * GENOME_LEN).every(v => v === 0)).toBe(true);
    expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-7);
  });

  it('kultywacja płaci energią, przenosi zalążki i zachowuje wpływ po zmianie plam', () => {
    const g = genome(); g[TRAIT_NICHE] = 1; g[B2_OFF + OUT_CULTIVATE] = 6;
    const w = world([g], { plantBShare: 0.8, nicheRate: 1, cultivationCoef: 0.2, nicheDecay: 0 });
    w.grid.foodB.fill(20); rebase(w); w.step(); expect(w.pool.seedLoad[0]).toBeGreaterThan(0);
    w.pool.x[0] += 20; const destination = w.grid.cellAt(w.pool.x[0], w.pool.y[0]);
    w.step(); expect(w.grid.seedBank[destination]).toBeGreaterThan(0); expect(w.grid.niche[destination]).toBeGreaterThan(0);
    expect(w.ledger.outCultivation).toBeGreaterThan(0); expect(w.observe(1)!.seedsMoved).toBeGreaterThan(0);
    const niche = w.grid.niche[destination]; w.params.nicheRate = 0; w.grid.fert[destination] = 0;
    w.step(); expect(w.grid.niche[destination]).toBe(niche); expect(w.foodCapacity(destination)).toBeGreaterThan(0);
    expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-7);
  });

  it('pomiary ruchu, żerowania i powrotów wynikają z rzeczywistych wydarzeń', () => {
    const w = world(); w.grid.food.fill(10); rebase(w);
    w.step(); const a = w.observe(1)!;
    expect(a.observedTicks).toBe(1); expect(a.feedingTicks).toBe(1); expect(a.foodEnergy).toBeGreaterThan(0); expect(a.distance).toBe(0);
    w.pool.x[0] += 10; w.step(); w.pool.x[0] -= 10; w.step(); expect(w.observe(1)!.revisits).toBe(1);
    w.pool.genomes[B2_OFF + OUT_THRUST] = 6; w.step(); expect(w.observe(1)!.distance).toBeGreaterThan(0);
  });

  it('kontrolowane próby zachowują mapę i tick, rozróżniają seed, resetują uczenie i bilans', () => {
    const w = new World({ seed: 9, width: 200, height: 200, initialPopulation: 2, capacity: 100 }); w.run(10);
    const a = deserializeWorld(serializeWorld(w)), b = deserializeWorld(serializeWorld(w)), c = deserializeWorld(serializeWorld(w));
    a.seedPopulation([genome(), genome()], 0.6, 1); b.seedPopulation([genome(), genome()], 0.6, 1); c.seedPopulation([genome(), genome()], 0.6, 2);
    expect(stateHash(a)).toBe(stateHash(b)); expect(Array.from(a.pool.x.slice(0, 2))).not.toEqual(Array.from(c.pool.x.slice(0, 2)));
    expect(a.tick).toBe(w.tick); expect(Array.from(a.grid.food)).toEqual(Array.from(w.grid.food)); expect(a.setup.seed).toBe(w.setup.seed);
    expect(Math.abs(a.energyImbalance())).toBeLessThan(1e-8);
    expect(a.pool.somaticWeights.every(v => v === 0)).toBe(true);
    expect(() => a.seedPopulation([new Float32Array(1)])).toThrow(); expect(() => a.seedPopulation([genome()], 0.6, NaN)).toThrow();
  });


  it('wyłączone mechaniki nie emitują sygnałów, nie uczą ani nie zmieniają żyzności', () => {
    const g = genome(); g[B2_OFF + OUT_SIGNAL] = 6; g[B2_OFF + OUT_CULTIVATE] = 6; g[TRAIT_PLASTICITY] = g[TRAIT_NICHE] = 1;
    const w = world([g]); w.grid.food.fill(10); rebase(w); w.run(12);
    expect(w.pool.signal[0]).toBe(0); expect(w.ledger.outSignal).toBe(0); expect(w.ledger.outLearning).toBe(0); expect(w.ledger.outCultivation).toBe(0);
    expect(w.pool.somaticWeights.every(v => v === 0)).toBe(true); expect(w.grid.niche.every(v => v === 0)).toBe(true);
    expect(w.grid.foodB.every(v => v === 0)).toBe(true);
  });

  it('drapieżnictwo i reprodukcja nie przekraczają bariery w bezpośrednim kontakcie', () => {
    const a = genome(), b = genome(); a[10] = 1; a[B2_OFF + 3] = 6;
    const w = world([a,b], { obstacles: 1, predationPower: 4, sexual: 1 }, 0.95);
    w.grid.obstacles.fill(0); w.grid.obstacles[w.grid.cellAt(105,85)] = 1;
    w.pool.x[0] = 99; w.pool.x[1] = 111; // test contact LOS independently of normal collision placement
    w.pool.radius[0] = w.pool.radius[1] = 6;
    w.tick = 100; w.pool.age[0] = w.pool.age[1] = 100; w.step();
    expect(w.pool.n).toBe(2); expect(w.pool.meatEnergy[0]).toBe(0); expect(w.mating.within + w.mating.between).toBe(0);
  });

  it('stan somatyczny wnosi koszt utrzymania nawet przy wyłączonym uczeniu', () => {
    const w = world(undefined, { brainCoef: 0.01 });
    const off = W1_OFF; w.pool.somaticWeights[off] = 2;
    const expected = w.inspect(1)!.physiology.sumAbsW * w.params.brainCoef;
    w.step(); expect(w.ledger.outSense).toBeCloseTo(expected, 6); expect(w.pool.somaticWeights[off]).toBe(2);
    expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-7);
  });

  it('sparowane próby różnych rozmiarów zaczynają się w identycznych pozycjach także przy barierach', () => {
    const small = genome(), big = genome(); small[0] = 0; big[0] = 1;
    const a = new World({seed: 8, width: 200, height: 200, initialPopulation: 1, capacity: 100}, {obstacles: 1});
    const b = deserializeWorld(serializeWorld(a));
    a.seedPopulation(Array.from({length: 8}, () => small), 0.6, 41); b.seedPopulation(Array.from({length: 8}, () => big), 0.6, 41);
    expect(Array.from(a.pool.x.slice(0,8))).toEqual(Array.from(b.pool.x.slice(0,8)));
    expect(Array.from(a.pool.y.slice(0,8))).toEqual(Array.from(b.pool.y.slice(0,8)));
    expect(Array.from(a.pool.hx.slice(0,8))).toEqual(Array.from(b.pool.hx.slice(0,8)));
    expect(a.stats.last('cladeCount')).toBe(8);
  });

  it('wszystkie mechaniki działają deterministycznie razem i wznawiają pełny stan', () => {
    const params: Partial<WorldParams> = { plantBShare: 0.7, plantBToxicity: 0.01, viewCos: 0, obstacles: 1, communication: 1, mateChoice: 1, sexual: 1, plasticityRate: 0.08, nicheRate: 1, patchDrift: 0.1, patchLife: 300 };
    const a = new World({ seed: 42, width: 200, height: 200, initialPopulation: 30, capacity: 150 }, params);
    const b = new World({ seed: 42, width: 200, height: 200, initialPopulation: 30, capacity: 150 }, params);
    a.run(300); for (let i = 0; i < 30; i++) b.run(10); expect(stateHash(a)).toBe(stateHash(b));
    a.lineageRetention = 123; const restored = deserializeWorld(serializeWorld(a)); expect(restored.lineageRetention).toBe(123);
    a.run(250); restored.run(250); expect(stateHash(restored)).toBe(stateHash(a));
    expect(Math.abs(a.energyImbalance())).toBeLessThan(1e-6);
    expect(a.grid.niche.some(v => v > 0)).toBe(true); expect(a.ledger.outSignal).toBeGreaterThan(0); expect(a.ledger.outLearning).toBeGreaterThan(0);
    for (let c = 0; c < a.grid.cells; c++) { expect(a.grid.food[c]).toBeGreaterThanOrEqual(0); expect(a.grid.foodB[c]).toBeGreaterThanOrEqual(0); }
  });
});

describe('migracja autentycznego zapisu v2', () => {
  it('przenosi stare geny, mutacje, założycieli i kolumny statystyk bez utraty informacji', () => {
    const expected = JSON.parse(readFileSync(new URL('./fixtures/world-v2.json', import.meta.url), 'utf8'));
    const w = deserializeWorld(readFileSync(new URL('./fixtures/world-v2.genesis', import.meta.url)));
    expect(w.tick).toBe(expected.tick); expect(w.pool.n).toBe(expected.n); expect(w.stats.last('maxGen')).toBeGreaterThan(1);
    expect(Array.from(w.stats.column('pop'))).toEqual(expected.pop); expect(Array.from(w.stats.column('s_size'))).toEqual(expected.s_size);
    for (let i = 0; i < w.pool.n; i++) {
      expect(w.pool.id[i]).toBe(expected.ids[i]);
      const reconstructed = w.lineage.reconstruct(w.pool.lin[i])!;
      for (let old = 0; old < 218; old++) {
        const current = legacyGeneIndex(old);
        expect(w.pool.genomes[i * GENOME_LEN + current] === expected.genomes[i * 218 + old]).toBe(true);
        expect(reconstructed[current] === expected.genomes[i * 218 + old]).toBe(true);
      }
      expect(Array.from(reconstructed)).toEqual(Array.from(w.pool.genomes.slice(i * GENOME_LEN, (i + 1) * GENOME_LEN)));
      expect(w.pool.genomes[i * GENOME_LEN + TRAIT_PLASTICITY]).toBe(0);
    }
    expect(w.pool.somaticWeights.every(v => v === 0)).toBe(true); expect(w.grid.foodB.every(v => v === 0)).toBe(true);
    expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-6);
    const b = deserializeWorld(serializeWorld(w)); w.run(100); b.run(100); expect(stateHash(w)).toBe(stateHash(b));
  });
});


describe('walidacja zapisu przed alokacją świata', () => {
  const rewrite = (bytes: Uint8Array, edit: (header: any) => void): Uint8Array => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), len = view.getUint32(12,true);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(16,16+len))); edit(header);
    const json = new TextEncoder().encode(JSON.stringify(header)), start = (16+json.length+7)&~7, oldStart = (16+len+7)&~7;
    const out = new Uint8Array(start+bytes.length-oldStart); out.set(bytes.subarray(0,16)); new DataView(out.buffer).setUint32(12,json.length,true);
    out.set(json,16); out.set(bytes.subarray(oldStart),start); return out;
  };
  it('odrzuca błędne wymiary, typy, długości, brak i nakładanie sekcji', () => {
    const bytes = serializeWorld(world());
    for (const edit of [
      (h: any) => { h.setup.capacity = 100001; },
      (h: any) => { h.sections[0].dtype = '__proto__'; },
      (h: any) => { h.sections[0].length--; },
      (h: any) => { h.sections = h.sections.filter((d: any) => d.name !== 'pool.somaticWeights'); },
      (h: any) => { h.sections[1].offset = h.sections[0].offset; },
      (h: any) => { h.sections[0].offset = 999999999; },
      (h: any) => { h.poolN = h.setup.capacity + 1; },
      (h: any) => { h.lineage.size = 999999999; },
    ]) expect(() => validateSaveLayout(rewrite(bytes, edit))).toThrow();
    expect(() => validateSaveLayout(bytes)).not.toThrow();
  });
});
