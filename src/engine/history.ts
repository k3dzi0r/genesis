/** Bounded, exact world history. Actions are ordered independently of the world's trimmed logs. */
import { ENGINE_VERSION } from './constants';
import { PARAM_META } from './config';
import { deserializeWorld, readHeader, serializeWorld, validateSaveLayout } from './serialize';
import { World, type Command, type LogEntry } from './world';

export interface HistoryOptions {
  interval: number;
  maxCheckpoints: number;
  maxBytes: number;
  maxActions: number;
}
export interface HistoryInfo {
  minTick: number;
  maxTick: number;
  viewTick: number;
  preview: boolean;
  interval: number;
  checkpoints: number;
  bytes: number;
  events: LogEntry[];
  selectedId: number | null;
}
interface Checkpoint { tick: number; bytes: Uint8Array; nextAction: number }
type Action = { tick: number; ordinal: number } & (
  { kind: 'command'; cmd: Command } | { kind: 'select'; id: number | null }
);
interface ArchiveHeader {
  version: 1;
  engine: string;
  options: HistoryOptions;
  checkpoints: { tick: number; size: number; nextAction: number }[];
  liveSize: number;
  actions: Action[];
  nextAction: number;
  events: LogEntry[];
}
const DEFAULTS: HistoryOptions = { interval: 1000, maxCheckpoints: 24, maxBytes: 64 * 1024 * 1024, maxActions: 20000 };
const MAGIC = new TextEncoder().encode('GHISTORY');
const MAX_ARCHIVE_BYTES = 160 * 1024 * 1024;
const MAX_HEADER_BYTES = 16 * 1024 * 1024;
const integer = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
function validateOptions(o: HistoryOptions): void {
  if (!o || !integer(o.interval, 1, 1000000) || !integer(o.maxCheckpoints, 1, 128) ||
      !integer(o.maxBytes, 1, 128 * 1024 * 1024) || !integer(o.maxActions, 1, 50000)) throw new Error('Nieprawidłowe ograniczenia historii.');
}
export function validCommand(cmd: Command, world: World): boolean {
  if (!cmd || typeof cmd !== 'object') return false;
  if (cmd.type === 'setParam') {
    const meta = PARAM_META[cmd.key];
    return Object.hasOwn(world.params, cmd.key) && !!meta && Number.isFinite(cmd.value) && cmd.value >= meta.min && cmd.value <= meta.max;
  }
  if (cmd.type === 'event') return !!cmd.spec && ['drought', 'bloom', 'coldSnap', 'cull', 'blight'].includes(cmd.spec.kind) &&
    Number.isFinite(cmd.spec.severity) && cmd.spec.severity >= 0 && cmd.spec.severity <= 1 &&
    (cmd.spec.duration === undefined || integer(cmd.spec.duration, 0, Number.MAX_SAFE_INTEGER)) &&
    [cmd.spec.x, cmd.spec.y, cmd.spec.radius].every(v => v === undefined || Number.isFinite(v)) && (cmd.spec.radius === undefined || cmd.spec.radius >= 0);
  if (cmd.type === 'addFood') return Number.isFinite(cmd.amount) && cmd.amount >= 0 && [cmd.x, cmd.y, cmd.radius].every(v => v === undefined || Number.isFinite(v)) && (cmd.radius === undefined || cmd.radius >= 0);
  return false;
}

export class WorldHistory {
  readonly options: HistoryOptions;
  private points: Checkpoint[] = [];
  private actions: Action[] = [];
  private nextAction = 0;
  private events: LogEntry[] = [];
  private previewWorld: World | null = null;

  constructor(readonly live: World, options: Partial<HistoryOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
    validateOptions(this.options);
    this.checkpoint();
    this.collectEvents();
  }
  get displayed(): World { return this.previewWorld ?? this.live; }
  get preview(): boolean { return this.previewWorld !== null; }
  get info(): HistoryInfo {
    const w = this.displayed;
    return {
      minTick: this.points[0].tick, maxTick: this.live.tick, viewTick: w.tick, preview: this.preview,
      interval: this.options.interval, checkpoints: this.points.length,
      bytes: this.points.reduce((n, p) => n + p.bytes.byteLength, 0),
      events: this.events.slice(-200).map(e => ({ ...e })),
      selectedId: w.pinned >= 0 ? w.lineage.id[w.pinned] : null,
    };
  }
  private assertLive(): void {
    if (this.preview) throw new Error('Podgląd historii: wróć do teraźniejszości lub rozwidl ten moment przed zmianą świata.');
  }
  private collectEvents(): void {
    const counts = new Map<string, number>(), encountered = new Map<string, number>();
    for (const e of this.events) {
      const key = `${e.tick}|${e.kind}|${e.text}`; counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const e of this.live.eventLog) {
      const key = `${e.tick}|${e.kind}|${e.text}`, occurrence = (encountered.get(key) ?? 0) + 1;
      encountered.set(key, occurrence);
      if (e.tick >= this.points[0].tick && occurrence > (counts.get(key) ?? 0)) this.events.push({ ...e });
    }
    this.events = this.events.filter(e => e.tick >= this.points[0].tick).slice(-2000);
  }
  private checkpoint(): void {
    const point = { tick: this.live.tick, bytes: serializeWorld(this.live), nextAction: this.nextAction };
    if (this.points.at(-1)?.tick === point.tick) this.points[this.points.length - 1] = point;
    else this.points.push(point);
    let bytes = this.points.reduce((n, p) => n + p.bytes.byteLength, 0);
    while (this.points.length > 1 && (this.points.length > this.options.maxCheckpoints || bytes > this.options.maxBytes)) {
      bytes -= this.points.shift()!.bytes.byteLength;
    }
    const first = this.points[0];
    this.actions = this.actions.filter(a => a.ordinal >= first.nextAction);
    this.events = this.events.filter(e => e.tick >= first.tick);
  }
  run(n: number): void {
    this.assertLive();
    if (!integer(n, 0, 1000000)) throw new Error('Nieprawidłowa liczba ticków.');
    const target = this.live.tick + n;
    if (!Number.isSafeInteger(target)) throw new Error('Tick przekracza zakres historii.');
    while (this.live.tick < target && this.live.status === 'running') {
      const next = (Math.floor(this.live.tick / this.options.interval) + 1) * this.options.interval;
      this.live.run(Math.min(target, next) - this.live.tick);
      this.collectEvents();
      if (this.live.tick === next || (this.live.status as string) === 'extinct') this.checkpoint();
    }
  }
  command(cmd: Command): void {
    this.assertLive();
    if (!validCommand(cmd, this.live)) throw new Error('Nieprawidłowe polecenie historii.');
    const copy = structuredClone(cmd);
    this.live.applyCommand(copy);
    this.actions.push({ tick: this.live.tick, ordinal: this.nextAction++, kind: 'command', cmd: copy });
    this.collectEvents();
    this.boundActions();
  }
  select(id: number | null): void {
    if (id !== null && !integer(id, 1, Number.MAX_SAFE_INTEGER)) throw new Error('Nieprawidłowe id organizmu.');
    if (this.previewWorld) { this.previewWorld.select(id); return; }
    this.live.select(id);
    this.actions.push({ tick: this.live.tick, ordinal: this.nextAction++, kind: 'select', id });
    this.boundActions();
  }
  private boundActions(): void {
    if (this.actions.length > this.options.maxActions) {
      // Anchor current state before releasing actions needed by older points.
      this.checkpoint();
      this.points = [this.points.at(-1)!];
      this.actions = [];
      this.events = this.events.filter(e => e.tick >= this.live.tick);
    }
  }
  worldAt(tick: number): World {
    if (!integer(tick, this.points[0].tick, this.live.tick)) throw new Error('Ten tick jest poza zachowaną historią.');
    let point = this.points[0];
    for (const p of this.points) if (p.tick <= tick) point = p; else break;
    const world = deserializeWorld(point.bytes);
    // Custom retention matters for genealogy exactness, though it is not part of old save headers.
    const saved = readHeader(point.bytes) as ReturnType<typeof readHeader> & { lineageRetention?: number; lineageMaxRecords?: number };
    if (saved.lineageRetention === undefined) world.lineageRetention = this.live.lineageRetention;
    if (saved.lineageMaxRecords === undefined) world.lineageMaxRecords = this.live.lineageMaxRecords;
    for (const action of this.actions) {
      if (action.ordinal < point.nextAction) continue;
      if (action.tick > tick) break;
      world.run(action.tick - world.tick);
      if (world.tick !== action.tick) throw new Error('Historia kończy się wymarciem przed wskazanym tickiem.');
      if (action.kind === 'command') world.applyCommand(structuredClone(action.cmd));
      else world.select(action.id);
    }
    world.run(tick - world.tick);
    if (world.tick !== tick) throw new Error('Nie można odtworzyć wskazanego ticku.');
    return world;
  }
  seek(tick: number): World {
    this.previewWorld = this.worldAt(tick);
    return this.previewWorld;
  }
  returnLive(): World { this.previewWorld = null; return this.live; }
  serializeArchive(): Uint8Array {
    const live = serializeWorld(this.live);
    const header: ArchiveHeader = {
      version: 1, engine: ENGINE_VERSION, options: this.options,
      checkpoints: this.points.map(p => ({ tick: p.tick, size: p.bytes.byteLength, nextAction: p.nextAction })),
      liveSize: live.byteLength, actions: this.actions, nextAction: this.nextAction, events: this.events,
    };
    // Preserve custom retention limits without embedding unbounded history in an ordinary .genesis.
    const json = new TextEncoder().encode(JSON.stringify({ ...header, lineageRetention: this.live.lineageRetention, lineageMaxRecords: this.live.lineageMaxRecords }));
    const size = 12 + json.byteLength + live.byteLength + this.points.reduce((n, p) => n + p.bytes.byteLength, 0);
    if (json.byteLength > MAX_HEADER_BYTES || size > MAX_ARCHIVE_BYTES) throw new Error('Archiwum historii przekracza limit 160 MiB.');
    const out = new Uint8Array(size);
    out.set(MAGIC); new DataView(out.buffer).setUint32(8, json.byteLength, true); out.set(json, 12);
    let offset = 12 + json.byteLength;
    for (const point of this.points) { out.set(point.bytes, offset); offset += point.bytes.byteLength; }
    out.set(live, offset);
    return out;
  }
  static fromArchive(bytes: Uint8Array): WorldHistory {
    if (bytes.byteLength < 12 || bytes.byteLength > MAX_ARCHIVE_BYTES || !MAGIC.every((v, i) => bytes[i] === v)) throw new Error('To nie jest archiwum historii GENESIS.');
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
    if (length > MAX_HEADER_BYTES || 12 + length > bytes.byteLength) throw new Error('Nieprawidłowy nagłówek historii.');
    const h = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + length))) as ArchiveHeader & { lineageRetention?: number; lineageMaxRecords?: number };
    if (h.version !== 1 || h.engine !== ENGINE_VERSION) throw new Error('Archiwum wymaga tej samej wersji silnika GENESIS.');
    validateOptions(h.options);
    if (!Array.isArray(h.checkpoints) || h.checkpoints.length < 1 || h.checkpoints.length > h.options.maxCheckpoints ||
        !Array.isArray(h.actions) || h.actions.length > h.options.maxActions || !integer(h.nextAction, 0, Number.MAX_SAFE_INTEGER) ||
        !Array.isArray(h.events) || h.events.length > 2000 || !integer(h.liveSize, 16, MAX_ARCHIVE_BYTES)) throw new Error('Nieprawidłowe dane historii.');
    let offset = 12 + length;
    let previousTick = -1;
    let previousAction = -1;
    const points: Checkpoint[] = h.checkpoints.map(p => {
      if (!integer(p.tick, 0, Number.MAX_SAFE_INTEGER) || p.tick <= previousTick || !integer(p.size, 16, MAX_ARCHIVE_BYTES) ||
          offset + p.size > bytes.length || !integer(p.nextAction, 0, h.nextAction) || p.nextAction < previousAction) throw new Error('Nieprawidłowy punkt kontrolny.');
      const raw = bytes.slice(offset, offset + p.size); offset += p.size;
      const saved = validateSaveLayout(raw);
      if (saved.tick !== p.tick || saved.engineVersion !== ENGINE_VERSION) throw new Error('Niezgodny tick lub silnik punktu kontrolnego.');
      previousTick = p.tick; previousAction = p.nextAction;
      return { tick: p.tick, bytes: raw, nextAction: p.nextAction };
    });
    const pointBytes = points.reduce((n, p) => n + p.bytes.byteLength, 0);
    if ((points.length > 1 && pointBytes > h.options.maxBytes) || offset + h.liveSize !== bytes.length) throw new Error('Niezgodny rozmiar historii.');
    const live = deserializeWorld(bytes.slice(offset));
    if (live.tick < previousTick || !integer(live.tick, 0, Number.MAX_SAFE_INTEGER)) throw new Error('Nieprawidłowy koniec historii.');
    if (h.lineageRetention !== undefined) {
      if (!integer(h.lineageRetention, 0, Number.MAX_SAFE_INTEGER)) throw new Error('Nieprawidłowa retencja genealogii.');
      live.lineageRetention = h.lineageRetention;
    }
    if (h.lineageMaxRecords !== undefined) {
      if (!integer(h.lineageMaxRecords, 1, Number.MAX_SAFE_INTEGER)) throw new Error('Nieprawidłowy limit genealogii.');
      live.lineageMaxRecords = h.lineageMaxRecords;
    }
    previousTick = points[0].tick; previousAction = points[0].nextAction - 1;
    for (const action of h.actions) {
      if (!integer(action.tick, previousTick, live.tick) || !integer(action.ordinal, previousAction + 1, h.nextAction - 1) ||
          action.ordinal !== previousAction + 1 || (action.kind !== 'select' && action.kind !== 'command') ||
          (action.kind === 'select' && action.id !== null && !integer(action.id, 1, Number.MAX_SAFE_INTEGER)) ||
          (action.kind === 'command' && !validCommand(action.cmd, live))) throw new Error('Nieprawidłowy dziennik historii.');
      previousTick = action.tick; previousAction = action.ordinal;
    }
    if (previousAction + 1 !== h.nextAction) throw new Error('Niekompletny dziennik historii.');
    for (const point of points) {
      if (h.actions.some(a => a.ordinal < point.nextAction ? a.tick > point.tick : a.tick < point.tick)) throw new Error('Niezgodna kolejność dziennika i punktów kontrolnych.');
    }
    for (const e of h.events) if (!e || !integer(e.tick, points[0].tick, live.tick) || typeof e.kind !== 'string' || e.kind.length > 100 || typeof e.text !== 'string' || e.text.length > 10000) throw new Error('Nieprawidłowe zdarzenie historii.');
    const history = new WorldHistory(live, h.options);
    history.points = points; history.actions = h.actions; history.nextAction = h.nextAction; history.events = h.events;
    return history;
  }
}

/** Read gzip incrementally, bounding decompressed archives before accumulating their bytes. */
export async function gunzipHistory(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Archiwum historii przekracza limit 160 MiB.');
  if (input[0] !== 0x1f || input[1] !== 0x8b) return input;
  const reader = new Blob([input as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_ARCHIVE_BYTES) { await reader.cancel(); throw new Error('Archiwum historii przekracza limit 160 MiB po rozpakowaniu.'); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}
