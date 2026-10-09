/**
 * Zapis i odczyt pełnego stanu świata (binarny kontener z wersjonowanym nagłówkiem JSON).
 *
 * Układ pliku:
 *   [8 B magic "GENESIS\0"] [u32 formatVersion] [u32 headerLen] [nagłówek JSON UTF-8] [wyrównanie do 8 B] [sekcje binarne]
 * Sekcje (food, żyzność, pula organizmów, genealogia, statystyki) opisane są w nagłówku.
 * Wznowiona symulacja jest bit-w-bit identyczna z nieprzerwaną (patrz tests/serialize.test.ts).
 */
import { ENGINE_VERSION, FORMAT_VERSION } from './constants';
import { LineageStore } from './lineage';
import { N_STATS, StatsHistory } from './stats';
import type { Command, ActiveEvent, Ledger, LogEntry } from './world';
import type { Patch } from './resources';
import { World } from './world';
import type { RngState } from './rng';
import type { WorldParams, WorldSetup } from './config';

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
  acc: { births: number; predEnergy: number; deaths: number[]; inMark: number; outMark: number };
  patches: Patch[];
  envRng: RngState;
  cladeLogged: number;
  nextSampleTick: number;
  lastSampleTick: number;
  prevPop: number;
  pinnedNode: number;
  poolN: number;
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
    acc: w.acc,
    patches: w.patches,
    envRng: w.envRng.getState(),
    cladeLogged: w.cladeLogged,
    nextSampleTick: w.nextSampleTick,
    lastSampleTick: w.lastSampleTick,
    prevPop: w.prevPop,
    pinnedNode: w.pinned,
    poolN: w.pool.n,
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
  // v2 jest wersją bieżącą — brak migracji.
  return h;
}

export function readHeader(bytes: Uint8Array): SaveHeader {
  for (let i = 0; i < 8; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error('To nie jest plik zapisu GENESIS');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(8, true);
  const len = dv.getUint32(12, true);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + len))) as SaveHeader;
  return migrate(h, version);
}

export function deserializeWorld(input: Uint8Array): World {
  const bytes = input.byteOffset % 8 === 0 && input.byteLength === input.buffer.byteLength ? input : input.slice();
  const h = readHeader(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataStart = align8(16 + dv.getUint32(12, true));
  const base = bytes.byteOffset + dataStart;
  const sec: Record<string, ArrayBufferView> = {};
  for (const d of h.sections) sec[d.name] = makeView(d.dtype, bytes.buffer as ArrayBuffer, base + d.offset, d.length);

  const w = new World(h.setup, h.params, false);
  w.tick = h.tick;
  w.status = h.status;
  w.rng.setState(h.rng);
  w.nextId = h.nextId;
  w.ledger = h.ledger;
  w.activeEvents = h.activeEvents;
  w.eventLog = h.eventLog;
  w.commandLog = h.commandLog;
  w.paramHistory = h.paramHistory;
  w.schedIdx = h.schedIdx;
  w.temperature = h.temperature;
  w.growthMult = h.growthMult;
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
  w.pool.importSections(h.poolN, sec);
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
  const s = `${w.tick}|${w.nextId}|${w.rng.getState().join(',')}|${w.pool.n}`;
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
