/**
 * Zapis i odczyt pełnego stanu świata (binarny kontener z wersjonowanym nagłówkiem JSON).
 *
 * Układ pliku:
 *   [8 B magic "GENESIS\0"] [u32 formatVersion] [u32 headerLen] [nagłówek JSON UTF-8] [wyrównanie do 8 B] [sekcje binarne]
 * Sekcje (food, żyzność, pula organizmów, genealogia, statystyki) opisane są w nagłówku.
 * Wznowiona symulacja jest bit-w-bit identyczna z nieprzerwaną (patrz tests/serialize.test.ts).
 */
import { ENGINE_VERSION, FORMAT_VERSION, GENOME_LEN, N_TRAITS, W1_OFF, B1_OFF, W2_OFF, B2_OFF, N_IN, N_MEM } from './constants';
import { LineageStore } from './lineage';
import { N_STATS, StatsHistory } from './stats';
import { OrganismPool } from './pool';
import type { Command, ActiveEvent, Ledger, LogEntry } from './world';
import type { Patch } from './resources';
import { World } from './world';
import type { RngState } from './rng';
import { mergeParams, type WorldParams, type WorldSetup } from './config';

const MAGIC = 'GENESIS\0';

type Dtype = 'f64' | 'f32' | 'u32' | 'i32' | 'u16' | 'u8';
interface SectionDesc {
  name: string;
  dtype: Dtype;
  length: number;
  offset: number;
}

export interface SaveHeader {
  formatVersion: number;
  engineVersion: string;
  savedAt: number;
  label?: string;
  setup: WorldSetup;
  params: WorldParams;
  tick: number;
  status: 'running' | 'extinct';
  rng: RngState;
  nextId: number;
  ledger: Ledger;
  activeEvents: ActiveEvent[];
  eventLog: LogEntry[];
  commandLog: { tick: number; cmd: Command }[];
  paramHistory: { tick: number; key: string; from: number; to: number }[];
  schedIdx: number;
  temperature: number;
  growthMult: number;
  environmentTick: number;
  acc: { births: number; predEnergy: number; deaths: number[]; inMark: number; outMark: number };
  patches: Patch[];
  envRng: RngState;
  cladeLogged: number;
  nextSampleTick: number;
  lastSampleTick: number;
  prevPop: number;
  pinnedNode: number;
  poolN: number;
  mating: World["mating"];
  biomeCounters: World['biomeCounters'];
  lineageRetention: number;
  lineageMaxRecords: number;
  lineage: Record<string, number>;
  stats: { count: number; interval: number; version: number; maxRows: number };
  sections: SectionDesc[];
}

function dtypeOf(a: ArrayBufferView): Dtype {
  if (a instanceof Float64Array) return 'f64';
  if (a instanceof Float32Array) return 'f32';
  if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Int32Array) return 'i32';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Uint8Array) return 'u8';
  throw new Error('Nieobsługiwany typ sekcji');
}

const SIZE: Record<Dtype, number> = { f64: 8, f32: 4, u32: 4, i32: 4, u16: 2, u8: 1 };

function makeView(dtype: Dtype, buf: ArrayBuffer, offset: number, length: number): ArrayBufferView {
  switch (dtype) {
    case 'f64': return new Float64Array(buf, offset, length);
    case 'f32': return new Float32Array(buf, offset, length);
    case 'u32': return new Uint32Array(buf, offset, length);
    case 'i32': return new Int32Array(buf, offset, length);
    case 'u16': return new Uint16Array(buf, offset, length);
    default: return new Uint8Array(buf, offset, length);
  }
}

const align8 = (n: number) => (n + 7) & ~7;

export function serializeWorld(w: World, label?: string): Uint8Array {
  const lin = w.lineage.exportState();
  const sections: Record<string, ArrayBufferView> = {
    'grid.food': w.grid.food,
    'grid.fert': w.grid.fert,
    'grid.foodB': w.grid.foodB,
    'grid.niche': w.grid.niche,
    'grid.seedBank': w.grid.seedBank,
    'grid.obstacles': w.grid.obstacles,
    'grid.biome': w.grid.biome,
    'grid.biomeTemperature': w.grid.biomeTemperature,
    'grid.biomeFertility': w.grid.biomeFertility,
    'grid.biomeFoodB': w.grid.biomeFoodB,
    'grid.biomeSeason': w.grid.biomeSeason,
    ...w.pool.exportSections(),
    ...lin.sections,
    'stats.rows': w.stats.rows.subarray(0, w.stats.count * N_STATS),
  };
  const descs: SectionDesc[] = [];
  let off = 0;
  for (const [name, arr] of Object.entries(sections)) {
    const dtype = dtypeOf(arr);
    const length = arr.byteLength / SIZE[dtype];
    descs.push({ name, dtype, length, offset: off });
    off = align8(off + arr.byteLength);
  }
  const header: SaveHeader = {
    formatVersion: FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    savedAt: Date.now(),
    label,
    setup: w.setup,
    params: w.params,
    tick: w.tick,
    status: w.status,
    rng: w.rng.getState(),
    nextId: w.nextId,
    ledger: w.ledger,
    activeEvents: w.activeEvents,
    eventLog: w.eventLog,
    commandLog: w.commandLog,
    paramHistory: w.paramHistory,
    schedIdx: w.schedIdx,
    temperature: w.temperature,
    growthMult: w.growthMult,
    environmentTick: w.environmentTick,
    acc: w.acc,
    patches: w.patches,
    envRng: w.envRng.getState(),
    cladeLogged: w.cladeLogged,
    nextSampleTick: w.nextSampleTick,
    lastSampleTick: w.lastSampleTick,
    prevPop: w.prevPop,
    pinnedNode: w.pinned,
    poolN: w.pool.n,
    mating: w.mating, lineageRetention: w.lineageRetention, lineageMaxRecords: w.lineageMaxRecords,
    biomeCounters: w.biomeCounters,
    lineage: lin.meta,
    stats: { count: w.stats.count, interval: w.stats.interval, version: w.stats.version, maxRows: w.stats.maxRows },
    sections: descs,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const dataStart = align8(16 + json.length);
  const out = new Uint8Array(dataStart + off);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) out[i] = MAGIC.charCodeAt(i);
  dv.setUint32(8, FORMAT_VERSION, true);
  dv.setUint32(12, json.length, true);
  out.set(json, 16);
  for (const d of descs) {
    const arr = sections[d.name];
    out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), dataStart + d.offset);
  }
  return out;
}

/** Migracje nagłówka ze starszych wersji formatu do bieżącej. Dodawać kolejne `case` przy zmianie FORMAT_VERSION. */
function migrate(h: SaveHeader, fromVersion: number): SaveHeader {
  if (fromVersion > FORMAT_VERSION) throw new Error(`Zapis pochodzi z nowszej wersji formatu (${fromVersion} > ${FORMAT_VERSION})`);
  if (fromVersion < 2)
    throw new Error(
      `Zapis w formacie v${fromVersion} (silnik ≤ 0.2) nie jest zgodny z silnikiem ${ENGINE_VERSION}: zmienił się układ genomu (pamięć, dieta, atak). Otwórz go starszą wersją aplikacji.`,
    );
  if (fromVersion === 2) {
    h.params = mergeParams(h.params);
    h.ledger = { ...h.ledger, outSignal: 0, outLearning: 0, outCultivation: 0 };
    h.mating = { within: 0, between: 0, rejectedWithin: 0, rejectedBetween: 0 };
    h.lineageRetention = 20000; h.lineageMaxRecords = 600000;
  }
  if (fromVersion < 4) {
    h.params = mergeParams(h.params);
    h.biomeCounters = { births: [0, 0, 0], deaths: [0, 0, 0], migrations: new Array<number>(9).fill(0) };
    h.environmentTick = h.tick;
  }
  return h;
}

export function readHeader(bytes: Uint8Array): SaveHeader {
  if (bytes.byteLength < 16) throw new Error('Uszkodzony nagłówek zapisu');
  for (let i = 0; i < 8; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error('To nie jest plik zapisu GENESIS');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(8, true);
  if (version > FORMAT_VERSION) throw new Error(`Zapis pochodzi z nowszej wersji formatu (${version} > ${FORMAT_VERSION})`);
  const len = dv.getUint32(12, true);
  if (len > bytes.length - 16 || len > 16000000) throw new Error('Uszkodzony rozmiar nagłówka');
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + len))) as SaveHeader;
  const setup = h.setup;
  if (!setup || !Number.isInteger(setup.width) || setup.width < 100 || setup.width > 4000 || !Number.isInteger(setup.height) || setup.height < 100 || setup.height > 4000 || !Number.isInteger(setup.capacity) || setup.capacity < 10 || setup.capacity > 100000 || !Number.isFinite(setup.cellSize) || setup.cellSize < 4 || setup.cellSize > 100 || !Number.isInteger(h.poolN) || h.poolN < 0 || h.poolN > setup.capacity || !Number.isInteger(h.lineage?.size) || h.lineage.size < 0 || h.lineage.size > 2000000 || !Number.isInteger(h.stats?.maxRows) || h.stats.maxRows < 1 || h.stats.maxRows > 100000 || !Number.isInteger(h.stats.count) || h.stats.count < 0 || h.stats.count > h.stats.maxRows) throw new Error('Nieprawidłowe wymiary świata w zapisie');
  if (!Number.isSafeInteger(h.tick) || h.tick < 0 || !Number.isSafeInteger(h.nextId) || h.nextId < 1 || !['running', 'extinct'].includes(h.status) || !Array.isArray(h.rng) || h.rng.length !== 4 || !h.rng.every(v => Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff) || !Number.isInteger(h.lineage.mutTop) || h.lineage.mutTop < 0 || h.lineage.mutTop > 50000000) throw new Error('Nieprawidłowy stan świata');
  if (!Array.isArray(h.sections) || h.sections.length > 200) throw new Error('Nieprawidłowe sekcje zapisu');
  const start = align8(16 + len), names = new Set<string>();
  for (const d of h.sections) {
    if (!d || typeof d.name !== 'string' || names.has(d.name) || !Object.hasOwn(SIZE, d.dtype) || !Number.isInteger(d.length) || d.length < 0 || !Number.isInteger(d.offset) || d.offset < 0 || d.offset % 8 !== 0 || d.length * SIZE[d.dtype] > bytes.byteLength - start - d.offset) throw new Error('Uszkodzona sekcja zapisu');
    names.add(d.name);
  }
  const spans = h.sections.filter(d => d.length > 0).map(d => ({ start: d.offset, end: d.offset + d.length * SIZE[d.dtype] })).sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) if (spans[i].start < spans[i - 1].end) throw new Error('Nakładające się sekcje zapisu');
  if (h.formatVersion !== version) throw new Error('Niezgodna wersja nagłówka');
  validateSections(h, version);
  if (version >= 4) {
    // Check new numeric maps and identifiers using views, before allocating a World/pool.
    const dataBase = align8(16 + len);
    for (const name of ['grid.biome', 'pool.currentBiome']) {
      const d = h.sections.find(section => section.name === name)!;
      const values = bytes.subarray(dataBase + d.offset, dataBase + d.offset + d.length);
      if (!values.every(v => v < 3 || (name === 'pool.currentBiome' && v === 255))) throw new Error(`Nieprawidłowa sekcja ${name}`);
    }
    for (const name of ['biomeTemperature', 'biomeFertility', 'biomeFoodB', 'biomeSeason']) {
      const d = h.sections.find(section => section.name === `grid.${name}`)!;
      for (let c = 0; c < d.length; c++) {
        const value = dv.getFloat32(dataBase + d.offset + c * 4, true);
        if (!Number.isFinite(value) || (name === 'biomeTemperature' ? Math.abs(value) > 1.2 : value < 0 || value > 4)) throw new Error(`Nieprawidłowa mapa ${name}`);
      }
    }
  }
  return migrate(h, version);
}

/** Structural validation is allocation-independent and shared by world/history imports. */
export function validateSaveLayout(bytes: Uint8Array): SaveHeader { return readHeader(bytes); }

function validateSections(h: SaveHeader, version: number): void {
  const legacy = version === 2;
  const cells = Math.ceil(h.setup.width / h.setup.cellSize) * Math.ceil(h.setup.height / h.setup.cellSize);
  const checkSection = (name: string, length: number, dtype: Dtype): void => {
    const descriptor = h.sections.find(d => d.name === name);
    if (!descriptor || descriptor.length !== length || descriptor.dtype !== dtype) throw new Error(`Nieprawidłowy układ sekcji ${name}`);
  };
  checkSection('grid.food', cells, 'f64'); checkSection('grid.fert', cells, 'f32');
  checkSection('pool.genomes', h.poolN * (legacy ? 218 : GENOME_LEN), 'f32');
  checkSection('pool.mem', h.poolN * N_MEM, 'f32');
  checkSection('stats.rows', h.stats.count * (legacy ? 50 : version === 3 ? 67 : N_STATS), 'f64');
  for (const [key, dtype] of Object.entries({ id: 'f64', parent: 'i32', parent2: 'i32', firstChild: 'i32', nextSibling: 'i32', birth: 'u32', death: 'i32', gen: 'u32', kids: 'u32', refs: 'i32', mutStart: 'i32', mutCount: 'u16' }) as [string, Dtype][]) checkSection(`lin.${key}`, h.lineage.size, dtype);
  checkSection('lin.traits', h.lineage.size * (legacy ? 11 : N_TRAITS), 'f32');
  checkSection('lin.mutGene', h.lineage.mutTop, 'u16'); checkSection('lin.mutVal', h.lineage.mutTop, 'f32');
  const founders = h.sections.find(d => d.name === 'lin.founderNodes');
  if (!founders || founders.dtype !== 'i32' || founders.length > h.lineage.size) throw new Error('Nieprawidłowi założyciele');
  checkSection('lin.founderData', founders.length * (legacy ? 218 : GENOME_LEN), 'f32');
  if (!legacy) {
    checkSection('grid.foodB', cells, 'f64'); checkSection('grid.niche', cells, 'f32');
    checkSection('grid.seedBank', cells, 'f32'); checkSection('grid.obstacles', cells, 'u8');
  }
  if (version >= 4) {
    checkSection('grid.biome', cells, 'u8');
    for (const name of ['biomeTemperature', 'biomeFertility', 'biomeFoodB', 'biomeSeason']) checkSection(`grid.${name}`, cells, 'f32');
    const counters = h.biomeCounters;
    if (!h.params || ![h.params.biomes, h.params.biomeContrast].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('Nieprawidłowe parametry biomów');
    if (!Number.isSafeInteger(h.environmentTick) || h.environmentTick < 0 || h.environmentTick > h.tick) throw new Error('Nieprawidłowa faza środowiska');
    if (!counters || ![counters.births, counters.deaths, counters.migrations].every((a, i) => Array.isArray(a) && a.length === (i === 2 ? 9 : 3) && a.every(v => Number.isSafeInteger(v) && v >= 0))) throw new Error('Nieprawidłowe liczniki biomów');
  }
  const prototype = new OrganismPool(1); prototype.n = 1;
  const legacyKeys = new Set(['id','x','y','hx','hy','energy','health','maxE','age','birth','maxAge','generation','lastRepro','offspring','lin','clade','radius','mass','m075','senseRange','maxSpeed','biteCap','assim','reproThresh','investFrac','maturity','coldTol','sumAbsW','memDecay','diet','genomes','mem'].map(k => `pool.${k}`));
  for (const [name, array] of Object.entries(prototype.exportSections())) {
    if (version < 4 && ['pool.currentBiome', 'pool.biomeTransitions'].includes(name)) continue;
    if (legacy && !legacyKeys.has(name)) continue;
    if (name === 'pool.genomes' || name === 'pool.mem') continue;
    checkSection(name, array.byteLength / SIZE[dtypeOf(array)] * h.poolN, dtypeOf(array));
  }
 }

/** Map original 0.3 layout (11 traits, 17→8→7) into appended 0.4 channels. */
export function legacyGeneIndex(g: number): number {
  if (g < 11) return g;
  if (g < 147) { const k = g - 11; return W1_OFF + Math.floor(k / 17) * N_IN + k % 17; }
  if (g < 155) return B1_OFF + g - 147;
  if (g < 211) return W2_OFF + g - 155;
  return B2_OFF + g - 211;
}

function upgradeGenomes(old: Float32Array): Float32Array {
  if (old.length % 218 !== 0) throw new Error('Uszkodzony genom v2');
  const n = old.length / 218, out = new Float32Array(n * GENOME_LEN);
  for (let i = 0; i < n; i++) {
    out[i * GENOME_LEN + 11] = 0.5; out[i * GENOME_LEN + 12] = 0.5;
    for (let g = 0; g < 218; g++) out[i * GENOME_LEN + legacyGeneIndex(g)] = old[i * 218 + g];
  }
  return out;
}

function migrateLegacySections(sec: Record<string, ArrayBufferView>, h: SaveHeader): void {
  sec['pool.genomes'] = upgradeGenomes(sec['pool.genomes'] as Float32Array);
  sec['lin.founderData'] = upgradeGenomes(sec['lin.founderData'] as Float32Array);
  const oldTraits = sec['lin.traits'] as Float32Array;
  const traits = new Float32Array(h.lineage.size * N_TRAITS);
  for (let i = 0; i < h.lineage.size; i++) {
    traits.set(oldTraits.subarray(i * 11, i * 11 + 11), i * N_TRAITS);
    traits[i * N_TRAITS + 11] = 0.5; traits[i * N_TRAITS + 12] = 0.5;
  }
  sec['lin.traits'] = traits;
  sec['lin.mutGene'] = (sec['lin.mutGene'] as Uint16Array).map(legacyGeneIndex);
  const oldRows = sec['stats.rows'] as Float64Array;
  const rows = new Float64Array(h.stats.count * N_STATS);
  for (let i = 0; i < h.stats.count; i++) {
    rows.set(oldRows.subarray(i * 50, i * 50 + 28), i * N_STATS);
    rows.set(oldRows.subarray(i * 50 + 28, i * 50 + 39), i * N_STATS + 28);
    rows.set(oldRows.subarray(i * 50 + 39, i * 50 + 50), i * N_STATS + 28 + N_TRAITS);
    rows[i * N_STATS + 28 + 11] = 0.5; rows[i * N_STATS + 28 + 12] = 0.5;
  }
  sec['stats.rows'] = rows;
}

export function deserializeWorld(input: Uint8Array): World {
  const bytes = input.byteOffset % 8 === 0 && input.byteLength === input.buffer.byteLength ? input : input.slice();
  const h = readHeader(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataStart = align8(16 + dv.getUint32(12, true));
  const base = bytes.byteOffset + dataStart;
  const sec: Record<string, ArrayBufferView> = {};
  for (const d of h.sections) sec[d.name] = makeView(d.dtype, bytes.buffer as ArrayBuffer, base + d.offset, d.length);

  const legacy = dv.getUint32(8, true) === 2;
  if (legacy) migrateLegacySections(sec, h);
  const preBiomes = dv.getUint32(8, true) < 4;
  if (!legacy && preBiomes) {
    const oldRows = sec['stats.rows'] as Float64Array;
    const rows = new Float64Array(h.stats.count * N_STATS);
    for (let r = 0; r < h.stats.count; r++) rows.set(oldRows.subarray(r * 67, (r + 1) * 67), r * N_STATS);
    sec['stats.rows'] = rows;
  }
  const w = new World(h.setup, h.params, false);
  w.tick = h.tick;
  w.status = h.status;
  w.rng.setState(h.rng);
  w.nextId = h.nextId;
  w.mating = h.mating; w.lineageRetention = h.lineageRetention; w.lineageMaxRecords = h.lineageMaxRecords;
  w.biomeCounters = h.biomeCounters;
  w.ledger = h.ledger;
  w.activeEvents = h.activeEvents;
  w.eventLog = h.eventLog;
  w.commandLog = h.commandLog;
  w.paramHistory = h.paramHistory;
  w.schedIdx = h.schedIdx;
  w.temperature = h.temperature;
  w.growthMult = h.growthMult;
  w.environmentTick = h.environmentTick;
  w.acc = h.acc;
  w.patches = h.patches;
  w.envRng.setState(h.envRng);
  w.cladeLogged = h.cladeLogged;
  w.nextSampleTick = h.nextSampleTick;
  w.lastSampleTick = h.lastSampleTick;
  w.prevPop = h.prevPop;
  w.pinned = h.pinnedNode;
  w.grid.food.set(sec['grid.food'] as Float64Array);
  w.grid.fert.set(sec['grid.fert'] as Float32Array);
  for (const key of ['foodB', 'niche', 'seedBank', 'obstacles'] as const) {
    const src = sec[`grid.${key}`];
    if (src) w.grid[key].set(src as unknown as ArrayLike<number>);
    else if (!legacy) throw new Error(`Brak sekcji grid.${key}`);
  }
  if (w.params.plantBShare <= 0) for (let c = 0; c < w.grid.cells; c++) {
    w.grid.food[c] += w.grid.foodB[c]; w.grid.foodB[c] = 0;
  }
  if (preBiomes) {
    w.grid.generateBiomes(w.setup.seed);
    sec['pool.currentBiome'] = new Uint8Array(h.poolN).fill(255);
    sec['pool.biomeTransitions'] = new Uint32Array(h.poolN);
  } else {
    const biomes = sec['grid.biome'] as Uint8Array;
    if (!biomes.every(v => v < 3)) throw new Error('Nieprawidłowy identyfikator biomu');
    w.grid.biome.set(biomes);
    for (const key of ['biomeTemperature', 'biomeFertility', 'biomeFoodB', 'biomeSeason'] as const) {
      const src = sec[`grid.${key}`] as Float32Array;
      if (!src.every(v => Number.isFinite(v) && (key === 'biomeTemperature' ? Math.abs(v) <= 1.2 : v >= 0 && v <= 4))) throw new Error(`Nieprawidłowa mapa ${key}`);
      w.grid[key].set(src);
    }
    if (!(sec['pool.currentBiome'] as Uint8Array).every(v => v < 3 || v === 255)) throw new Error('Nieprawidłowy biom organizmu');
  }
  if (legacy) {
    w.pool.n = h.poolN;
    for (let i = 0; i < h.poolN; i++) w.pool.resetRuntime(i);
    const defaults = w.pool.exportSections();
    for (const key in defaults) if (!sec[key]) sec[key] = defaults[key];
  }
  w.pool.n = h.poolN;
  const poolLayout = w.pool.exportSections();
  for (const [name, expected] of Object.entries(poolLayout)) {
    const actual = sec[name];
    if (!actual || actual.constructor !== expected.constructor || actual.byteLength !== expected.byteLength) throw new Error(`Nieprawidłowy układ sekcji ${name}`);
  }
  w.pool.importSections(h.poolN, sec);
  if (legacy) for (let i = 0; i < h.poolN; i++) w.derivePhysiology(i);
  w.lineage = LineageStore.importState(h.lineage, sec);
  const st = new StatsHistory(h.stats.maxRows, h.stats.interval);
  st.rows.set(sec['stats.rows'] as Float64Array);
  st.count = h.stats.count;
  st.interval = h.stats.interval;
  st.version = h.stats.version;
  w.stats = st;
  return w;
}

/** Hash stanu świata (FNV-1a) — do testów determinizmu i odtwarzania. */
export function stateHash(w: World): number {
  const b = serializeWorld(w);
  // pomijamy savedAt: nagłówek zawiera znacznik czasu, więc hashujemy sekcje binarne + kluczowe skalary
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dataStart = align8(16 + dv.getUint32(12, true));
  let h = 0x811c9dc5;
  for (let i = dataStart; i < b.length; i++) {
    h ^= b[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const s = `${w.tick}|${w.environmentTick}|${w.temperature}|${w.growthMult}|${w.nextId}|${w.rng.getState().join(',')}|${w.pool.n}|${w.envRng.getState().join(',')}|${JSON.stringify(w.mating)}|${JSON.stringify(w.biomeCounters)}|${JSON.stringify(w.params)}|${JSON.stringify(w.ledger)}|${JSON.stringify(w.patches)}|${JSON.stringify(w.activeEvents)}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// — kompresja (przeglądarka i Node ≥ 18) —

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return data;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (data[0] !== 0x1f || data[1] !== 0x8b) return data;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
