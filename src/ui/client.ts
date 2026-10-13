/**
 * Klient świata po stronie UI: opakowuje Web Worker, trzyma statystyki i najnowszą migawkę.
 * Nie zawiera żadnej logiki biologicznej — tylko komunikację i bufory.
 */
import type { Command } from '../engine/world';
import { gunzipHistory, type HistoryInfo } from '../engine/history';
import type { LabRequest } from '../engine/lab';
import type { WorldParams, WorldSetup } from '../engine/config';
import { N_STATS, STAT_COLUMNS, STAT_INDEX } from '../engine/stats';
import { gunzip, readHeader } from '../engine/serialize';
import { putSave, pruneAuto, downloadBytes } from '../storage/db';
import type {
  AblationDoneMsg, AblationRowMsg, AtlasMsg, CommandsMsg, CompareResult, FrameMsg, FromWorker, HistoryBytesMsg, HistoryMsg, InspectResult, LabMsg, LineageResult, ProbeMsg, SpecimenMsg, StatusMsg, StrategiesMsg, ToWorker, ViewFlags,
} from '../worker/protocol';

export class StatsClient {
  count = 0;
  interval = 20;
  /** zwiększane po każdym przeładowaniu danych (scalenie historii) */
  epoch = 0;
  private cols: Float64Array[] = Array.from({ length: N_STATS }, () => new Float64Array(256));

  apply(rows: Float64Array, from: number, count: number, interval: number, reset: boolean): void {
    if (reset) this.epoch++;
    this.interval = interval;
    const n = count - from;
    if (count > this.cols[0].length) {
      const cap = Math.max(count, this.cols[0].length * 2);
      this.cols = this.cols.map((c) => {
        const b = new Float64Array(cap);
        b.set(c.subarray(0, this.count));
        return b;
      });
    }
    for (let r = 0; r < n; r++) for (let c = 0; c < N_STATS; c++) this.cols[c][from + r] = rows[r * N_STATS + c];
    this.count = count;
  }

  column(key: string): Float64Array {
    return this.cols[STAT_INDEX[key]].subarray(0, this.count);
  }

  /** wartość na 1000 ticków (dla kolumn sumowanych w przedziale) */
  rate(key: string): Float64Array {
    const v = this.column(key);
    const t = this.column('tick');
    const out = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const dt = i === 0 ? Math.max(1, t[0]) : Math.max(1, t[i] - t[i - 1]);
      out[i] = (v[i] / dt) * 1000;
    }
    return out;
  }

  last(key: string): number {
    return this.count ? this.cols[STAT_INDEX[key]][this.count - 1] : 0;
  }

  /** Wygładzona wartość na 1000 ticków z ostatnich `rows` wierszy (średnia ważona czasem). */
  recentRate(key: string, rows = 12): number {
    const n = this.count;
    if (n < 2) return 0;
    const v = this.column(key);
    const t = this.column('tick');
    const from = Math.max(1, n - rows);
    let sum = 0;
    for (let i = from; i < n; i++) sum += v[i];
    const dt = t[n - 1] - t[from - 1];
    return dt > 0 ? (sum / dt) * 1000 : 0;
  }
}

type Pending = { resolve: (m: unknown) => void; reject: (error: Error) => void };

let seq = 1;

export class WorldClient {
  readonly worker: Worker;
  readonly stats = new StatsClient();
  info: StatusMsg | null = null;
  setup: WorldSetup | null = null;
  grid: { nx: number; ny: number; fert: Uint8Array } = { nx: 1, ny: 1, fert: new Uint8Array(1) };
  frame: FrameMsg | null = null;
  frameSeq = 0;
  ready = false;
  error: string | null = null;
  selectedId: number | null = null;
  history: HistoryInfo | null = null;
  /** Increments when time is navigated; renderer clears trajectories without resetting camera. */
  historyEpoch = 0;
  view: ViewFlags = { colorMode: 'lineage', sensors: false, energy: false };
  speedLabel = '1×';
  /** czy świat został przeładowany/zresetowany — widok resetuje kamerę */
  worldEpoch = 0;
  private pending = new Map<number, Pending>();
  private labProgressHandlers = new Map<number, (done: number, total: number) => void>();
  private labRequest: number | null = null;
  private rowHandlers = new Map<number, (m: AblationRowMsg) => void>();
  private listeners = new Set<() => void>();
  private frameListeners = new Set<(f: FrameMsg) => void>();
  autosaveEvery = 25000;
  /** konfiguracja z chwili utworzenia — do resetu i bliźniaków */
  initialSetup: Partial<WorldSetup> | null = null;
  initialParams: Partial<WorldParams> | null = null;

  constructor(
    public readonly id: string,
    public name: string,
    private readonly onSaved: (c: WorldClient, m: Extract<FromWorker, { t: 'saved' }>) => void,
  ) {
    this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
    this.worker.onerror = (e) => {
      this.error = e.message;
      this.rejectPending(new Error(e.message));
      this.emit();
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onFrame(fn: (f: FrameMsg) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }

  private onMessage(m: FromWorker): void {
    switch (m.t) {
      case 'ready':
        this.setup = m.setup;
        this.grid = { nx: m.nx, ny: m.ny, fert: m.fert };
        this.ready = true;
        this.worldEpoch++;
        this.send({ t: 'view', flags: this.view });
        this.send({ t: 'autosave', everyTicks: this.autosaveEvery });
        this.emit();
        break;
      case 'frame':
        this.frame = m;
        this.frameSeq++;
        for (const f of this.frameListeners) f(m);
        break;
      case 'status':
        this.info = m;
        this.history = m.history;
        this.setup = m.setup;
        this.emit();
        break;
      case 'stats':
        this.stats.apply(m.rows, m.from, m.count, m.interval, m.reset);
        this.emit();
        break;
      case 'saved':
        this.onSaved(this, m);
        this.resolvePending(m.req, m);
        break;
      case 'history':
        this.history = m.info;
        this.selectedId = m.info.selectedId;
        this.historyEpoch++;
        this.error = null;
        this.resolvePending(m.req, m);
        this.emit();
        break;
      case 'ablationRow':
        this.rowHandlers.get(m.req)?.(m);
        break;
      case 'labProgress':
        this.labProgressHandlers.get(m.req)?.(m.done, m.total);
        break;
      case 'error':
        // Request errors are handled by their caller; the live world remains usable.
        if (m.req === undefined && m.code !== 'cancelled') { this.error = m.message; console.error('[worker]', m.message); }
        if (m.req !== undefined) {
          this.pending.get(m.req)?.reject(new Error(m.message));
          this.pending.delete(m.req);
          this.rowHandlers.delete(m.req);
          this.labProgressHandlers.delete(m.req);
          if (this.labRequest === m.req) this.labRequest = null;
        }
        this.emit();
        break;
      default: {
        this.resolvePending((m as { req: number }).req, m);
      }
    }
  }

  private resolvePending(req: number, message: unknown): void {
    const pending = this.pending.get(req);
    if (pending) { this.pending.delete(req); pending.resolve(message); }
  }
  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear(); this.rowHandlers.clear(); this.labProgressHandlers.clear(); this.labRequest = null;
  }

  send(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(m, transfer);
  }

  private request<T>(build: (req: number) => ToWorker): Promise<T> {
    const req = seq++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req, { resolve: resolve as (m: unknown) => void, reject });
      try { this.send(build(req)); }
      catch (e) { this.pending.delete(req); reject(e instanceof Error ? e : new Error(String(e))); }
    });
  }

  init(setup: Partial<WorldSetup>, params: Partial<WorldParams>): void {
    this.rejectPending(new Error('Świat został zresetowany.'));
    this.history = null; this.info = null; this.error = null;
    this.initialSetup = setup;
    this.initialParams = params;
    this.frame = null;
    this.stats.count = 0;
    this.stats.epoch++;
    this.selectedId = null;
    this.send({ t: 'init', setup, params });
  }
  load(bytes: Uint8Array): void {
    this.rejectPending(new Error('Świat został przeładowany.'));
    this.history = null; this.info = null; this.error = null;
    this.send({ t: 'load', bytes }, [bytes.buffer as ArrayBuffer]);
  }
  play(p: boolean): void {
    this.send({ t: 'play', playing: p });
  }
  step(n = 1): void {
    this.send({ t: 'step', n });
  }
  setSpeed(tps: number, label: string): void {
    this.speedLabel = label;
    this.send({ t: 'speed', tps });
    this.emit();
  }
  command(cmd: Command): void {
    this.send({ t: 'command', cmd });
  }
  /** Applies a validated batch between ticks; acknowledgement follows refreshed status. */
  commands(commands: readonly Command[]): Promise<CommandsMsg> {
    return this.request(req => ({ t: 'commands', commands, req }));
  }
  select(id: number | null): void {
    this.selectedId = id;
    this.send({ t: 'select', id });
    this.emit();
  }
  setView(patch: Partial<ViewFlags>): void {
    this.view = { ...this.view, ...patch };
    this.send({ t: 'view', flags: this.view });
    this.emit();
  }
  ack(): void {
    this.send({ t: 'ack' });
  }
  inspect(id: number): Promise<InspectResult> {
    return this.request((req) => ({ t: 'inspect', id, req }));
  }
  lineage(id: number): Promise<LineageResult> {
    return this.request((req) => ({ t: 'lineage', id, req }));
  }
  strategies(k = 4): Promise<StrategiesMsg> {
    return this.request((req) => ({ t: 'strategies', req, k }));
  }
  /** Test ablacji: wiersze przychodzą na bieżąco (`onRow`), a wynik końcowy w obietnicy. */
  ablation(ticks: number, onRow: (m: AblationRowMsg) => void): Promise<AblationDoneMsg> {
    const req = seq++;
    return new Promise((resolve, reject) => {
      this.rowHandlers.set(req, onRow);
      this.pending.set(req, { resolve: (value: unknown) => {
        const m = value as AblationDoneMsg;
        this.rowHandlers.delete(req);
        resolve(m);
      }, reject });
      this.send({ t: 'ablation', req, ticks });
    });
  }
  probe(): Promise<ProbeMsg> {
    return this.request((req) => ({ t: 'probe', req }));
  }
  compare(a: number, b: number): Promise<CompareResult> {
    return this.request((req) => ({ t: 'compare', a, b, req }));
  }
  save(label: string, reason: 'manual' | 'export' | 'fork' = 'manual'): Promise<Extract<FromWorker, { t: 'saved' }>> {
    return this.request((req) => ({ t: 'save', label, req, reason }));
  }
  async exportText(kind: 'stats-csv' | 'experiment-json' | 'lineage-json' | 'population-csv'): Promise<string> {
    const r = await this.request<Extract<FromWorker, { t: 'export' }>>((req) => ({ t: 'export', kind, req }));
    return r.text;
  }
  setAutosave(everyTicks: number): void {
    this.autosaveEvery = everyTicks;
    this.send({ t: 'autosave', everyTicks });
  }
  requestStats(): void {
    this.send({ t: 'sendStats' });
  }
  atlas(): Promise<AtlasMsg> {
    return this.request(req => ({ t: 'atlas', req }));
  }
  captureSpecimen(id: number, archived = false): Promise<SpecimenMsg> {
    return this.request(req => ({ t: 'captureSpecimen', id, archived, req }));
  }
  lab(request: LabRequest, onProgress: (done: number, total: number) => void): Promise<LabMsg> {
    if (this.labRequest !== null) return Promise.reject(new Error('Próba laboratoryjna już trwa.'));
    const req = seq++; this.labRequest = req;
    this.labProgressHandlers.set(req, onProgress);
    return new Promise<LabMsg>((resolve, reject) => {
      this.pending.set(req, { resolve: value => {
        this.labProgressHandlers.delete(req); this.labRequest = null; resolve(value as LabMsg);
      }, reject });
      try { this.send({ t: 'lab', req, request }); }
      catch (e) {
        this.pending.delete(req); this.labProgressHandlers.delete(req); this.labRequest = null;
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
  cancelLab(): void {
    if (this.labRequest !== null) this.send({ t: 'cancelLab', req: this.labRequest });
  }
  historySeek(tick: number): Promise<HistoryMsg> {
    return this.request(req => ({ t: 'historySeek', tick, req }));
  }
  historyLive(): Promise<HistoryMsg> {
    return this.request(req => ({ t: 'historyLive', req }));
  }
  async exportHistory(): Promise<Uint8Array> {
    const result = await this.request<HistoryBytesMsg>(req => ({ t: 'historyExport', req }));
    return result.bytes;
  }
  async historicalWorldBytes(tick: number): Promise<Uint8Array> {
    const result = await this.request<HistoryBytesMsg>(req => ({ t: 'historicalWorld', tick, req }));
    return result.bytes;
  }
  loadHistory(bytes: Uint8Array): Promise<HistoryMsg> {
    this.rejectPending(new Error('Wczytano inne archiwum historii.'));
    return this.request(req => ({ t: 'loadHistory', bytes, req }));
  }
  dispose(): void {
    this.rejectPending(new Error('Świat został zamknięty.'));
    this.worker.terminate();
    this.listeners.clear();
    this.frameListeners.clear();
  }
}

/** Menedżer światów: kilka niezależnych symulacji (każda we własnym Workerze). */
export class Manager {
  worlds: WorldClient[] = [];
  activeId: string | null = null;
  version = 0;
  private listeners = new Set<() => void>();
  private counter = 0;
  /** powiadomienia dla UI (np. zapis ukończony) */
  toasts: { id: number; text: string }[] = [];
  private toastSeq = 1;
  savesVersion = 0;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;
  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  get active(): WorldClient | null {
    return this.worlds.find((w) => w.id === this.activeId) ?? null;
  }

  toast(text: string): void {
    const id = this.toastSeq++;
    this.toasts = [...this.toasts, { id, text }];
    this.bump();
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.bump();
    }, 4500);
  }

  private nextName(): string {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const n = this.counter++;
    return n < 26 ? `Świat ${letters[n]}` : `Świat ${n + 1}`;
  }

  private make(name?: string): WorldClient {
    const c = new WorldClient(`w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name ?? this.nextName(), (cl, m) => void this.handleSaved(cl, m));
    c.subscribe(() => this.bump());
    this.worlds = [...this.worlds, c];
    this.activeId = c.id;
    return c;
  }

  create(setup: Partial<WorldSetup>, params: Partial<WorldParams>, name?: string): WorldClient {
    const c = this.make(name);
    c.init(setup, params);
    c.play(true);
    c.setSpeed(30, '1×');
    this.bump();
    return c;
  }

  /** Wczytuje świat z pliku/zapisu; przy niezgodnym formacie pokazuje komunikat i zwraca null. */
  async createFromBytes(bytes: Uint8Array, name?: string): Promise<WorldClient | null> {
    const raw = await gunzip(bytes);
    try {
      readHeader(raw);
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
      return null;
    }
    const c = this.make(name);
    c.load(raw);
    c.setSpeed(30, '1×');
    this.bump();
    return c;
  }

  async createFromHistoryBytes(bytes: Uint8Array, name?: string): Promise<WorldClient | null> {
    let c: WorldClient | null = null;
    let previousActive: string | null = null;
    try {
      if (bytes.byteLength > 160 * 1024 * 1024) throw new Error('Archiwum historii przekracza limit 160 MiB.');
      const raw = await gunzipHistory(bytes);
      if (raw.byteLength > 160 * 1024 * 1024) throw new Error('Archiwum historii przekracza limit 160 MiB.');
      previousActive = this.activeId;
      c = this.make(name ?? 'Historia (import)');
      await c.loadHistory(raw);
      c.setSpeed(30, '1×'); this.bump();
      return c;
    } catch (e) {
      if (c) {
        const wasActive = this.activeId === c.id;
        this.remove(c.id);
        if (wasActive && previousActive && this.worlds.some(w => w.id === previousActive)) this.setActive(previousActive);
      }
      this.toast(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /** Bliźniak: ta sama konfiguracja i seed od tick 0 (identyczne warunki początkowe). */
  twin(src: WorldClient): WorldClient | null {
    if (!src.info || !src.setup) return null;
    const initial = src.initialParams ?? src.info.params;
    return this.create(src.initialSetup ?? src.setup, initial, `${src.name} (bliźniak)`);
  }

  /** Rozwidlenie: kopia bieżącego stanu świata (kontrfaktyczny eksperyment od teraz). */
  async fork(src: WorldClient): Promise<WorldClient | null> {
    const saved = await src.save(`fork z ${src.name}`, 'fork');
    return this.createFromBytes(saved.bytes, `${src.name} (rozwidlenie @${saved.tick})`);
  }

  remove(id: string): void {
    const w = this.worlds.find((x) => x.id === id);
    if (!w) return;
    w.dispose();
    this.worlds = this.worlds.filter((x) => x.id !== id);
    if (this.activeId === id) this.activeId = this.worlds[0]?.id ?? null;
    this.bump();
  }

  setActive(id: string): void {
    this.activeId = id;
    this.bump();
  }

  private async handleSaved(c: WorldClient, m: Extract<FromWorker, { t: 'saved' }>): Promise<void> {
    if (m.reason === 'fork') return;
    const id = `${c.id}-${m.reason}-${m.tick}-${Date.now()}`;
    if (m.reason === 'export') {
      downloadBytes(`genesis-${c.name.replace(/\s+/g, '_')}-t${m.tick}.genesis`, m.bytes);
      return;
    }
    try {
      await putSave(
        { id, name: m.label, worldName: c.name, seed: m.seed, tick: m.tick, pop: m.pop, savedAt: Date.now(), kind: m.reason === 'auto' ? 'auto' : 'manual', size: m.bytes.byteLength, engine: m.engine },
        m.bytes,
      );
      if (m.reason === 'auto') await pruneAuto(c.name, 3);
      else this.toast(`Zapisano: ${m.label}`);
      this.savesVersion++;
      this.bump();
    } catch (e) {
      this.toast(`Błąd zapisu: ${String(e)}`);
    }
  }
}

export const manager = new Manager();
// do debugowania w konsoli przeglądarki
(globalThis as unknown as { __genesis?: Manager }).__genesis = manager;
export { STAT_COLUMNS };
