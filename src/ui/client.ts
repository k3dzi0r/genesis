/**
 * Klient świata po stronie UI: opakowuje Web Worker, trzyma statystyki i najnowszą migawkę.
 * Nie zawiera żadnej logiki biologicznej — tylko komunikację i bufory.
 */
import type { Command } from '../engine/world';
import type { WorldParams, WorldSetup } from '../engine/config';
import { N_STATS, STAT_COLUMNS, STAT_INDEX } from '../engine/stats';
import { gunzip, readHeader } from '../engine/serialize';
import { putSave, pruneAuto, downloadBytes } from '../storage/db';
import type {
  AblationDoneMsg, AblationRowMsg, CompareResult, FrameMsg, FromWorker, InspectResult, LineageResult, ProbeMsg, StatusMsg, StrategiesMsg, ToWorker, ViewFlags,
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

type Pending = (m: never) => void;

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
  view: ViewFlags = { colorMode: 'lineage', sensors: false, energy: false };
  speedLabel = '1×';
  /** czy świat został przeładowany/zresetowany — widok resetuje kamerę */
  worldEpoch = 0;
  private pending = new Map<number, Pending>();
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
        this.setup = m.setup;
        this.emit();
        break;
      case 'stats':
        this.stats.apply(m.rows, m.from, m.count, m.interval, m.reset);
        this.emit();
        break;
      case 'saved':
        this.onSaved(this, m);
        break;
      case 'ablationRow':
        this.rowHandlers.get(m.req)?.(m);
        break;
      case 'error':
        this.error = m.message;
        console.error('[worker]', m.message);
        this.emit();
        break;
      default: {
        const cb = this.pending.get((m as { req: number }).req);
        if (cb) {
          this.pending.delete((m as { req: number }).req);
          (cb as (x: unknown) => void)(m);
        }
      }
    }
  }

  send(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(m, transfer);
  }

  private request<T>(build: (req: number) => ToWorker): Promise<T> {
    const req = seq++;
    return new Promise<T>((resolve) => {
      this.pending.set(req, resolve as Pending);
      this.send(build(req));
    });
  }

  init(setup: Partial<WorldSetup>, params: Partial<WorldParams>): void {
    this.initialSetup = setup;
    this.initialParams = params;
    this.frame = null;
    this.stats.count = 0;
    this.stats.epoch++;
    this.selectedId = null;
    this.send({ t: 'init', setup, params });
  }
  load(bytes: Uint8Array): void {
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
    return new Promise((resolve) => {
      this.rowHandlers.set(req, onRow);
      this.pending.set(req, ((m: AblationDoneMsg) => {
        this.rowHandlers.delete(req);
        resolve(m);
      }) as Pending);
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
  dispose(): void {
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
