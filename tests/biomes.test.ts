import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { B2_OFF, GENOME_LEN, N_TRAITS, OUT_EAT, OUT_THRUST, IN_FOOD_B_AMOUNT, W1_OFF } from '../src/engine/constants';
import type { WorldParams } from '../src/engine/config';
import { WorldHistory } from '../src/engine/history';
import { ResourceGrid } from '../src/engine/resources';
import { deserializeWorld, readHeader, serializeWorld, stateHash } from '../src/engine/serialize';
import { N_STATS, STAT_INDEX } from '../src/engine/stats';
import { World, ledgerIn, ledgerOut } from '../src/engine/world';

const FREE: Partial<WorldParams> = { basalCoef: 0, moveCoef: 0, turnCoef: 0, senseCoef: 0, brainCoef: 0, eatCoef: 0, coldUpkeepCoef: 0, attackCoef: 0, signalCoef: 0, learnCoef: 0, cultivationCoef: 0, accidentRate: 0, mutationRate: 0, regrowthRate: 0, foodDecay: 0, predationPower: 0 };
const setup = { seed: 81, width: 200, height: 200, cellSize: 10, initialPopulation: 1, capacity: 100, fertilityPattern: 'uniform' as const };
function genome(): Float32Array {
  const g = new Float32Array(GENOME_LEN); g.fill(0.5, 0, N_TRAITS); g[5] = 0; g[6] = 0; g[10] = 0;
  g[B2_OFF + OUT_THRUST] = -6; g[B2_OFF + OUT_EAT] = 6;
  return g;
}
function trial(params: Partial<WorldParams> = {}, genomes = [genome()]): World {
  const w = new World(setup, { ...FREE, ...params });
  w.grid.food.fill(0); w.grid.foodB.fill(0); w.seedPopulation(genomes, 0.2);
  return w;
}
function rebase(w: World): void { const t = w.totalEnergy(); w.ledger.initial = t.food + t.organisms - ledgerIn(w.ledger) + ledgerOut(w.ledger); }
function center(w: World, slot: number, cell: number): void {
  w.pool.x[slot] = (cell % w.grid.nx + 0.5) * w.grid.cell;
  w.pool.y[slot] = (Math.floor(cell / w.grid.nx) + 0.5) * w.grid.cell;
  w.pool.hx[slot] = 1; w.pool.hy[slot] = 0;
}
function cell(w: World, biome: number): number { return w.grid.biome.findIndex(v => v === biome); }
function rawSections(bytes: Uint8Array): { header: any; sections: Record<string, Uint8Array> } {
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + length)));
  const start = (16 + length + 7) & ~7, sizes: Record<string, number> = { f64: 8, f32: 4, i32: 4, u32: 4, u16: 2, u8: 1 };
  const sections: Record<string, Uint8Array> = {};
  for (const d of header.sections) sections[d.name] = bytes.subarray(start + d.offset, start + d.offset + d.length * sizes[d.dtype]);
  return { header, sections };
}
function editHeader(bytes: Uint8Array, edit: (h: any) => void): Uint8Array {
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true), oldStart = (16 + length + 7) & ~7;
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + length))); edit(h);
  const json = new TextEncoder().encode(JSON.stringify(h)), start = (16 + json.length + 7) & ~7;
  const out = new Uint8Array(start + bytes.length - oldStart); out.set(bytes.subarray(0, 16));
  new DataView(out.buffer).setUint32(12, json.length, true); out.set(json, 16); out.set(bytes.subarray(oldStart), start); return out;
}

describe('local biomes 0.5', () => {
  it('generates three contiguous habitats deterministically without consuming simulation RNG', () => {
    const a = new ResourceGrid(200, 200, 10), b = new ResourceGrid(200, 200, 10), c = new ResourceGrid(200, 200, 10);
    a.generateBiomes(81); b.generateBiomes(81); c.generateBiomes(82);
    expect(a.biome).toEqual(b.biome); expect(a.biome).not.toEqual(c.biome);
    expect(new Set(a.biome)).toEqual(new Set([0, 1, 2]));
    const off = new World(setup), on = new World(setup, { biomes: 1 });
    expect(off.rng.getState()).toEqual(on.rng.getState()); expect(off.envRng.getState()).toEqual(on.envRng.getState());
    expect(off.pool.genomes).toEqual(on.pool.genomes); expect(off.pool.x).toEqual(on.pool.x);
  });
  it('disabled and zero-contrast biomes preserve homogeneous physics exactly', () => {
    const params = { ...FREE, seasonPeriod: 100, seasonGrowthAmp: 0.7, seasonTempAmp: 0.5, regrowthRate: 0.01, plantBShare: 0.4 };
    const off = new World(setup, params), neutral = new World(setup, { ...params, biomes: 1, biomeContrast: 0 });
    for (const w of [off, neutral]) { w.triggerEvent({ kind: 'coldSnap', severity: 0.3, duration: 40 }); w.triggerEvent({ kind: 'bloom', severity: 0.8, duration: 90 }); }
    off.run(80); neutral.run(80);
    expect(off.pool.x).toEqual(neutral.pool.x); expect(off.pool.energy).toEqual(neutral.pool.energy); expect(off.grid.food).toEqual(neutral.grid.food); expect(off.ledger).toEqual(neutral.ledger);
    for (let c = 0; c < off.grid.cells; c++) {
      expect(off.localTemperature(c)).toBe(off.temperature); expect(neutral.localTemperature(c)).toBe(neutral.temperature);
      expect(neutral.localEnvironment(c).growthMult).toBe(neutral.growthMult);
    }
    expect(off.biomeSnapshot().enabled).toBe(false); expect(off.biomeCounters.migrations.every(v => v === 0)).toBe(true);
  });
  it('senses local temperature and pays actual local cold metabolic cost', () => {
    const w = trial({ biomes: 1, biomeContrast: 1, basalCoef: 0.2, coldDamage: 0 }, [genome(), genome()]);
    center(w, 0, cell(w, 1)); center(w, 1, cell(w, 2));
    const ids = [w.pool.id[0], w.pool.id[1]], initial = w.pool.energy[0];
    const cold = w.inspect(ids[0])!, warm = w.inspect(ids[1])!;
    expect(cold.inputs[11]).toBeLessThan(warm.inputs[11]); expect(cold.costs.basal).toBeGreaterThan(warm.costs.basal);
    w.step();
    expect(initial - w.pool.energy[0]).toBeCloseTo(cold.costs.basal, 8);
    expect(initial - w.pool.energy[1]).toBeCloseTo(warm.costs.basal, 8);
    expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-8);
  });
  it('local fertility and food partition change availability within finite total capacity', () => {
    const w = trial({ biomes: 1, biomeContrast: 1, plantBShare: 0.6 });
    const cells = [1, 2].map(id => w.grid.biome.findIndex((v, c) => v === id && ((Math.imul(c + 1, 1664525) + w.setup.seed) >>> 0) % 4 === 0));
    expect(w.foodCapacity(cells[1])).toBeGreaterThan(w.foodCapacity(cells[0]));
    expect(w.foodBPartition(cells[1])).toBeGreaterThan(w.foodBPartition(cells[0]));
    w.params.regrowthRate = 0.05; w.run(300);
    expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-8);
    for (let c = 0; c < w.grid.cells; c++) expect(w.grid.food[c] + w.grid.foodB[c]).toBeLessThanOrEqual(w.foodCapacity(c) + 1e-8);
  });
  it('local seasons change growth and temperature including zero global seasonal growth', () => {
    const w = trial({ biomes: 1, biomeContrast: 1, seasonPeriod: 100, seasonGrowthAmp: 1, seasonTempAmp: 0.2 });
    const cold = w.localEnvironment(cell(w, 1)), warm = w.localEnvironment(cell(w, 2));
    expect(w.growthMult).toBe(0); expect(cold.growthMult).toBe(0); expect(warm.growthMult).toBe(0.5);
    expect(cold.temperature).toBeLessThan(warm.temperature);
    w.triggerEvent({ kind: 'drought', severity: 0.7, duration: 40 });
    expect(w.localEnvironment(cell(w, 2)).growthMult).toBeLessThan(warm.growthMult);
  });
  it('snapshot and Inspector retain the environmental phase used in the last tick', () => {
    const w = trial({ biomes: 1, biomeContrast: 1, seasonPeriod: 100, seasonGrowthAmp: 0.5, seasonTempAmp: 0.3 });
    center(w, 0, cell(w, 1)); const c = w.grid.cellAt(w.pool.x[0], w.pool.y[0]);
    const before = w.localEnvironment(c); w.step();
    expect(w.environmentTick).toBe(0); expect(w.tick).toBe(1); expect(w.localEnvironment(c)).toEqual(before);
    expect(w.inspect(w.pool.id[0])!.inputs[11]).toBe(before.temperature);
    const copy = deserializeWorld(serializeWorld(w)); expect(copy.localEnvironment(c)).toEqual(before);
    const hash = stateHash(copy); copy.environmentTick = 1; expect(stateHash(copy)).not.toBe(hash);
    copy.environmentTick = 0; copy.temperature += 0.01; expect(stateHash(copy)).not.toBe(hash);
    w.step(); expect(w.environmentTick).toBe(1); expect(w.localEnvironment(c).temperature).toBeGreaterThan(before.temperature);
  });
  it('counts actual boundary movement, not enable/disable or spawn placement', () => {
    const g = genome(); g[1] = 1; g[B2_OFF + OUT_THRUST] = 6;
    const w = trial({ biomes: 1 }, [g]);
    for (let c = 0; c < w.grid.cells; c++) w.grid.biome[c] = c % w.grid.nx < 10 ? 1 : 2;
    w.pool.x[0] = 99.9; w.pool.y[0] = 85; w.pool.hx[0] = 1; w.pool.hy[0] = 0;
    w.step(); expect(w.biomeCounters.migrations[1 * 3 + 2]).toBe(1); expect(w.observe(w.pool.id[0])!.biomeTransitions).toBe(1);
    const counters = structuredClone(w.biomeCounters);
    w.applyCommand({ type: 'setParam', key: 'biomes', value: 0 }); w.step();
    expect(w.pool.currentBiome[0]).toBe(255);
    w.applyCommand({ type: 'setParam', key: 'biomes', value: 1 }); w.step();
    expect(w.biomeCounters).toEqual(counters); expect(w.pool.currentBiome[0]).toBe(2);
    const snapshot = w.biomeSnapshot(); expect(snapshot.biomes[1].exits).toBe(1); expect(snapshot.biomes[2].entries).toBe(1);
  });
  it('retains individual migration counters through swap removal, counts local deaths and resets gardens', () => {
    const w = trial({ biomes: 1 }, [genome(), genome()]);
    center(w, 0, cell(w, 1)); center(w, 1, cell(w, 2));
    w.pool.biomeTransitions[1] = 9; w.pool.currentBiome[1] = 2;
    const kept = w.pool.id[1];
    w.triggerEvent({ kind: 'cull', severity: 1, x: w.pool.x[0], y: w.pool.y[0], radius: 1 });
    expect(w.pool.n).toBe(1); expect(w.pool.id[0]).toBe(kept); expect(w.pool.biomeTransitions[0]).toBe(9); expect(w.pool.currentBiome[0]).toBe(2); expect(w.biomeCounters.deaths[1]).toBe(1);
    const map = w.grid.biome.slice(), tick = w.tick; w.seedPopulation([genome()], 0.5, 72);
    expect(w.grid.biome).toEqual(map); expect(w.tick).toBe(tick); expect(w.biomeCounters.deaths).toEqual([0, 0, 0]); expect(w.pool.biomeTransitions[0]).toBe(0);
  });
  it('newborns start local counters at zero while births are measured at their location', () => {
    const g = genome(); g[3] = 0; const w = trial({ biomes: 1 }, [g]);
    w.tick = 100; w.pool.energy[0] = w.pool.maxE[0]; w.pool.age[0] = w.pool.maturity[0]; w.pool.lastRepro[0] = 0; w.pool.biomeTransitions[0] = 7; rebase(w);
    w.step(); expect(w.pool.n).toBeGreaterThan(1); expect(w.pool.biomeTransitions[1]).toBe(0);
    expect(w.biomeCounters.births.reduce((a, b) => a + b, 0)).toBe(w.pool.n - 1);
    expect(w.biomeCounters.migrations.every(v => v === 0)).toBe(true);
  });
  it('combined mechanics serialize, retain bounded stats and resume exactly', () => {
    const w = new World({ ...setup, initialPopulation: 25 }, { biomes: 1, plantBShare: 0.6, communication: 1, plasticityRate: 0.01, nicheRate: 0.5, obstacles: 1, mateChoice: 1, sexual: 1, seasonPeriod: 200 });
    w.run(400); const b = deserializeWorld(serializeWorld(w)); expect(stateHash(b)).toBe(stateHash(w)); expect(b.biomeSnapshot()).toEqual(w.biomeSnapshot());
    w.run(300); b.run(300); expect(stateHash(b)).toBe(stateHash(w)); expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-7);
    expect(w.stats.rows.length).toBe(w.stats.maxRows * N_STATS); expect(w.stats.last('biomeMigrations')).toBeLessThanOrEqual(w.biomeCounters.migrations.reduce((a, b) => a + b, 0));
    expect(STAT_INDEX.tempMax).toBe(N_STATS - 1);
  });
});

describe('optional modules and authentic v3 migration', () => {
  it('turning food B off atomically converts remaining energy and removes toxic inputs', () => {
    const w = trial({ plantBShare: 0.6, plantBToxicity: 0.2 }); center(w, 0, w.grid.cellAt(85, 85)); w.grid.foodB.fill(10); rebase(w);
    const total = w.totalEnergy().food, ledger = structuredClone(w.ledger);
    w.applyCommand({ type: 'setParam', key: 'plantBShare', value: 0 });
    expect(w.totalEnergy().food).toBe(total); expect(w.ledger).toEqual(ledger); expect(w.grid.foodB.every(v => v === 0)).toBe(true); expect(w.inspect(w.pool.id[0])!.inputs[IN_FOOD_B_AMOUNT]).toBe(0);
    w.step(); expect(w.pool.health[0]).toBe(1); expect(w.pool.foodBConsumed[0]).toBe(0); expect(Math.abs(w.energyImbalance())).toBeLessThan(1e-8);
  });
  it('learning and cultivation off preserve acquired state while stopping new costs/investments', () => {
    const w = trial({ plasticityRate: 0.1, nicheRate: 0.8, nicheDecay: 0 });
    const c = w.grid.cellAt(w.pool.x[0], w.pool.y[0]); w.grid.niche[c] = 0.8; w.grid.seedBank[c] = 1; w.pool.somaticWeights[W1_OFF] = 0.5;
    w.applyCommand({ type: 'setParam', key: 'plasticityRate', value: 0 }); w.applyCommand({ type: 'setParam', key: 'nicheRate', value: 0 });
    w.step(); expect(w.pool.somaticWeights[W1_OFF]).toBe(0.5); expect(w.grid.niche[c]).toBeCloseTo(0.8); expect(w.grid.seedBank[c]).toBeGreaterThan(0);
    expect(w.foodCapacity(c)).toBeGreaterThan(w.params.foodCapMax * w.grid.fert[c]); expect(w.ledger.outLearning).toBe(0); expect(w.ledger.outCultivation).toBe(0); expect(w.pool.cultivated[0]).toBe(0);
  });
  it('history and archives replay biome and food-module toggles and preserve the source world', () => {
    const h = new WorldHistory(new World({ ...setup, initialPopulation: 12 }, { biomes: 1, plantBShare: 0.6 }), { interval: 20 });
    h.run(30); h.command({ type: 'setParam', key: 'plantBShare', value: 0 }); h.command({ type: 'setParam', key: 'biomes', value: 0 }); h.run(10);
    h.command({ type: 'setParam', key: 'biomes', value: 1 }); const at40 = stateHash(h.live); h.run(30);
    const live = stateHash(h.live); expect(stateHash(h.seek(40))).toBe(at40); expect(stateHash(h.returnLive())).toBe(live);
    const restored = WorldHistory.fromArchive(h.serializeArchive()); expect(stateHash(restored.live)).toBe(live);
    expect(stateHash(restored.seek(40))).toBe(at40); restored.returnLive(); h.run(30); restored.run(30); expect(stateHash(restored.live)).toBe(stateHash(h.live));
  });
  it('authentic unmodified 0.4 v3 fixture preserves every original section and 67 stats columns', () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/world-v3.genesis', import.meta.url)));
    const old = rawSections(bytes), w = deserializeWorld(bytes), now = rawSections(serializeWorld(w));
    expect(old.header.formatVersion).toBe(3); expect(old.header.engineVersion).toBe('0.4.0'); expect(w.params.biomes).toBe(0); expect(w.pool.currentBiome.every(v => v === 255)).toBe(true);
    expect(w.biomeCounters).toEqual({ births: [0, 0, 0], deaths: [0, 0, 0], migrations: new Array(9).fill(0) });
    for (const name of Object.keys(old.sections)) if (name !== 'stats.rows') expect(now.sections[name], name).toEqual(old.sections[name]);
    const oldStats = new Float64Array(old.sections['stats.rows'].slice().buffer);
    for (let row = 0; row < w.stats.count; row++) expect(w.stats.rows.slice(row * N_STATS, row * N_STATS + 67)).toEqual(oldStats.slice(row * 67, (row + 1) * 67));
    expect(w.rng.getState()).toEqual(old.header.rng); expect(w.envRng.getState()).toEqual(old.header.envRng); expect(w.ledger).toEqual(old.header.ledger); expect(w.mating).toEqual(old.header.mating);
    const b = deserializeWorld(serializeWorld(w)); w.run(100); b.run(100); expect(stateHash(w)).toBe(stateHash(b));
  });
  it('v3 legacy food-off leftovers migrate by conservation-preserving conversion', () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/world-v3.genesis', import.meta.url)));
    const original = deserializeWorld(bytes), disabled = deserializeWorld(editHeader(bytes, h => { h.params.plantBShare = 0; }));
    expect(disabled.totalEnergy().food).toBeCloseTo(original.totalEnergy().food, 9); expect(disabled.ledger).toEqual(original.ledger);
    expect(disabled.grid.foodB.every(v => v === 0)).toBe(true); expect(disabled.inspect(disabled.pool.id[0])!.inputs[IN_FOOD_B_AMOUNT]).toBe(0);
  });
  it('rejects malformed biome counters, identifiers and nonfinite maps before world allocation', () => {
    const bytes = serializeWorld(new World(setup, { biomes: 1 }));
    expect(() => readHeader(editHeader(bytes, h => { h.biomeCounters.migrations[0] = -1; }))).toThrow(/liczniki/);
    const corrupt = (name: string, value: number) => {
      const b = bytes.slice(), { header } = rawSections(b), length = new DataView(b.buffer).getUint32(12, true), start = (16 + length + 7) & ~7;
      const d = header.sections.find((section: any) => section.name === name);
      if (d.dtype === 'u8') b[start + d.offset] = value; else new DataView(b.buffer).setFloat32(start + d.offset, value, true); return b;
    };
    expect(() => readHeader(corrupt('grid.biome', 3))).toThrow(/sekcja/); expect(() => readHeader(corrupt('pool.currentBiome', 4))).toThrow(/sekcja/);
    expect(() => readHeader(corrupt('grid.biomeFertility', Infinity))).toThrow(/mapa/);
  });
});
