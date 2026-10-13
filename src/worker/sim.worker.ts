/// <reference lib="webworker" />
/**
 * Worker symulacji: cała logika świata działa tutaj, UI dostaje tylko migawki do rysowania.
 * Czas symulacji (ticki) jest niezależny od FPS — worker wykonuje tyle ticków, ile wynika z wybranego tempa.
 */
import { World, ledgerIn, ledgerOut, type Command } from '../engine/world';
import { WorldHistory, validCommand } from '../engine/history';
import { behaviorAtlas, speciesAnalysis, captureSpecimen, captureAncestorSpecimen } from '../engine/behavior';
import { runLabGenerator, type LabRequest } from '../engine/lab';
import { ENGINE_VERSION, GENOME_LEN, N_TRAITS, TRAIT_DIET, TRAIT_HUE, TRAIT_PLANT } from '../engine/constants';
import { N_STATS } from '../engine/stats';
import { deserializeWorld, gzip, serializeWorld } from '../engine/serialize';
import { exportExperimentJson, exportLineageJson, exportPopulationCsv } from '../engine/experiment';
import { genomeDistance } from '../engine/genome';
import { ablationSuite, clusterStrategies, probeBehavior } from '../engine/analysis';
import { colorOf } from './colors';
import type { CompareResult, FromWorker, LineageResult, LineageTreeNode, ToWorker, ViewFlags } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let world: World | null = null;
let history: WorldHistory | null = null;
let playing = false;
let tps = 30;
let acked = true;
let dirty = true;
let flags: ViewFlags = { colorMode: 'lineage', sensors: false, energy: false };
let selectedId: number | null = null;
let owed = 0;
let lastT = performance.now();
let msPerTick = 0.5;
let lastFrameT = 0;
let lastStatusT = 0;
let lastStatsT = 0;
let statsVersion = -1;
let fertSent = -1;
let statsSent = 0;
let autosaveEvery = 0;
let lastAutosaveTick = 0;
let winT = performance.now();
let winTick = 0;
let measuredTps = 0;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function announce(): void {
  if (!world) return;
  const g = world.grid;
  const fert = new Uint8Array(g.cells);
  for (let c = 0; c < g.cells; c++) fert[c] = Math.round(g.fert[c] * 255);
  post({ t: 'ready', setup: world.setup, nx: g.nx, ny: g.ny, fert }, [fert.buffer]);
  statsVersion = -1;
  statsSent = 0;
  fertSent = world.fertVersion;
  dirty = true;
  lastAutosaveTick = world.tick;
  winT = performance.now();
  winTick = world.tick;
}

function toNode(n: number): LineageTreeNode {
  const L = world!.lineage;
  const i = L.info(n);
  return { ...i };
}

function buildFrame(): void {
  const w = world!;
  const p = w.pool;
  const n = p.n;
  const data = new Float32Array(n * 8);
  const u32 = new Uint32Array(data.buffer);
  const ids = new Float64Array(n);
  let maxGen = 0;
  if (flags.colorMode === 'generation') for (let i = 0; i < n; i++) if (p.generation[i] > maxGen) maxGen = p.generation[i];
  let selected: import('./protocol').FrameSelection | null = null;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const ef = p.energy[i] / p.maxE[i];
    const g = i * GENOME_LEN;
    data[o] = p.x[i];
    data[o + 1] = p.y[i];
    data[o + 2] = p.radius[i];
    data[o + 3] = p.hx[i];
    data[o + 4] = p.hy[i];
    u32[o + 5] = colorOf({
      mode: flags.colorMode, hue: p.genomes[g + TRAIT_HUE], speed: p.genomes[g + 1], sense: p.genomes[g + 2], size: p.genomes[g],
      energyFrac: ef, generation: p.generation[i], maxGeneration: maxGen, age: p.age[i], maxAge: p.maxAge[i], diet: p.genomes[g + TRAIT_DIET], clade: p.clade[i],
      signal: p.signal[i], specialization: p.genomes[g + TRAIT_PLANT],
    });
    data[o + 6] = ef;
    data[o + 7] = p.senseRange[i];
    ids[i] = p.id[i];
    if (selectedId !== null && p.id[i] === selectedId)
      selected = { id: selectedId, x: p.x[i], y: p.y[i], radius: p.radius[i], sense: p.senseRange[i], hx: p.hx[i], hy: p.hy[i] };
  }
  const grid = w.grid;
  const food = new Uint8Array(grid.cells);
  const foodB = new Uint8Array(grid.cells);
  const obstacles = grid.obstacles.slice();
  const niche = new Uint8Array(grid.cells);
  const signals = p.signal.slice(0, n);
  const biome = grid.biome.slice();
  const localTemperature = new Float32Array(grid.cells);
  const inv = 255 / w.params.foodCapMax;
  for (let c = 0; c < grid.cells; c++) {
    localTemperature[c] = w.localTemperature(c);
    const v = grid.food[c] * inv;
    food[c] = v > 255 ? 255 : v;
    foodB[c] = Math.min(255, grid.foodB[c] * inv);
    niche[c] = Math.round(Math.min(1, Math.max(0, grid.niche[c])) * 255);
  }
  const transfer: Transferable[] = [data.buffer, ids.buffer, food.buffer, foodB.buffer, obstacles.buffer, niche.buffer, signals.buffer, biome.buffer, localTemperature.buffer];
  let fert: Uint8Array | undefined;
  if (w.fertVersion !== fertSent) {
    fert = new Uint8Array(grid.cells);
    for (let c = 0; c < grid.cells; c++) fert[c] = Math.round(grid.fert[c] * 255);
    transfer.push(fert.buffer);
    fertSent = w.fertVersion;
  }
  post({ t: 'frame', tick: w.tick, n, data, ids, food, foodB, obstacles, niche, signals, biome, localTemperature, fert, selected }, transfer);
  acked = false;
  dirty = false;
}

function sendStatus(): void {
  const w = world!;
  const te = w.totalEnergy();
  post({
    t: 'status',
    tick: w.tick,
    pop: w.pool.n,
    status: w.status,
    playing,
    tps,
    measuredTps,
    temperature: w.temperature,
    growthMult: w.growthMult,
    biomes: w.biomeSnapshot(),
    activeEvents: w.activeEvents,
    eventLog: w.eventLog.slice(-150),
    eventLogTotal: w.eventLog.length,
    paramHistory: w.paramHistory.slice(-100),
    params: w.params,
    setup: w.setup,
    energyImbalance: w.energyImbalance(),
    ledger: { totalIn: w.ledger.initial + ledgerIn(w.ledger), totalOut: ledgerOut(w.ledger), food: te.food, organisms: te.organisms },
    lineageNodes: w.lineage.liveNodes,
    lineageRecorded: w.lineage.totalRecorded,
    lineagePruned: w.lineage.totalPruned,
    lineageBytes: w.lineage.memoryBytes(),
    history: history!.info,
  });
}

function sendStats(force = false): void {
  const w = world!;
  const s = w.stats;
  if (!force && s.version === statsVersion && s.count === statsSent) return;
  const reset = s.version !== statsVersion || statsSent > s.count;
  const from = reset ? 0 : statsSent;
  const rows = s.rows.slice(from * N_STATS, s.count * N_STATS);
  post({ t: 'stats', reset, from, count: s.count, interval: s.interval, rows }, [rows.buffer]);
  statsVersion = s.version;
  statsSent = s.count;
}

function runChunk(k: number): void {
  const t0 = performance.now();
  history!.run(k);
  const dt = performance.now() - t0;
  msPerTick = 0.9 * msPerTick + 0.1 * (dt / Math.max(1, k));
}

async function doAutosave(): Promise<void> {
  const w = history!.live;
  lastAutosaveTick = w.tick;
  const meta = { label: `autozapis @${w.tick}`, tick: w.tick, pop: w.pool.n, seed: w.setup.seed };
  const raw = serializeWorld(w, meta.label);
  const bytes = await gzip(raw);
  post({ t: 'saved', req: 0, reason: 'auto', ...meta, bytes, engine: ENGINE_VERSION }, [bytes.buffer as ArrayBuffer]);
}

function tick(): void {
  const now = performance.now();
  if (world) {
    if (playing && !history?.preview && world.status === 'running') {
      const dtSec = Math.min(0.1, (now - lastT) / 1000);
      const start = performance.now();
      if (tps >= 1e8) {
        while (performance.now() - start < 24) runChunk(Math.max(1, Math.floor(6 / Math.max(msPerTick, 0.001))));
      } else {
        owed += dtSec * tps;
        const maxOwed = tps * 0.25 + 2;
        if (owed > maxOwed) owed = maxOwed;
        while (owed >= 1 && performance.now() - start < 12 && world.status === 'running') {
          const k = Math.min(Math.floor(owed), Math.max(1, Math.floor(6 / Math.max(msPerTick, 0.001))));
          runChunk(k);
          owed -= k;
        }
      }
      dirty = true;
      if (world.status !== 'running') playing = false;
      if (autosaveEvery > 0 && world.tick - lastAutosaveTick >= autosaveEvery) void doAutosave().catch(e => post({ t: 'error', message: e instanceof Error ? e.message : String(e) }));
    } else owed = 0;
    lastT = now;

    if (now - winT >= 1000) {
      measuredTps = ((world.tick - winTick) * 1000) / (now - winT);
      winT = now;
      winTick = world.tick;
    }
    if (acked && dirty && now - lastFrameT >= 30) {
      lastFrameT = now;
      buildFrame();
    }
    if (now - lastStatusT >= 250) {
      lastStatusT = now;
      sendStatus();
    }
    if (now - lastStatsT >= 500) {
      lastStatsT = now;
      sendStats();
    }
  }
  setTimeout(tick, playing ? 0 : 25);
}

function applyCommand(cmd: Command): void {
  if (!world) return;
  history!.command(cmd);
  dirty = true;
  lastStatusT = 0;
}

function lineageQuery(id: number, req: number): LineageResult | null {
  const w = world!;
  const L = w.lineage;
  const node = L.indexOf(id);
  if (node < 0) return null;
  const ancestors = L.ancestry(node, 4000).reverse().map(toNode);
  const descendants: LineageTreeNode[] = [];
  let living = 0;
  let visited = 0;
  let truncated = false;
  const queue: number[] = [...L.children(node)];
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    visited++;
    if (L.death[c] === -1) living++;
    if (descendants.length < 140) descendants.push(toNode(c));
    else truncated = true;
    if (visited > 300000) {
      truncated = true;
      break;
    }
    for (const k of L.children(c)) queue.push(k);
  }
  return { t: 'lineage', req, ancestors, descendants, descendantsTruncated: truncated, livingDescendants: living };
}

function compareQuery(aId: number, bId: number, req: number): CompareResult {
  const L = world!.lineage;
  const a = L.indexOf(aId);
  const b = L.indexOf(bId);
  const empty: CompareResult = { t: 'compare', req, a: null, b: null, traitDelta: [], traitDistance: 0, weightDistance: 0, mutationsBetween: null, generationsBetween: null, changedWeights: [], genomeA: null, genomeB: null };
  if (a < 0 || b < 0) return empty;
  const ga = L.reconstruct(a);
  const gb = L.reconstruct(b);
  if (!ga || !gb) return empty;
  const d = genomeDistance(ga, 0, gb, 0);
  const traitDelta: number[] = [];
  for (let t = 0; t < N_TRAITS; t++) traitDelta.push(gb[t] - ga[t]);
  const changed: { gene: number; from: number; to: number }[] = [];
  for (let g = N_TRAITS; g < GENOME_LEN; g++) if (ga[g] !== gb[g]) changed.push({ gene: g, from: ga[g], to: gb[g] });
  changed.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from));
  let mutationsBetween: number | null = null;
  let generationsBetween: number | null = null;
  const path = L.ancestry(b);
  const ia = path.indexOf(a);
  if (ia >= 0) {
    mutationsBetween = 0;
    for (let k = 0; k < ia; k++) mutationsBetween += L.mutCount[path[k]];
    // numery pokoleń są zachowane po scaleniu łańcuchów, więc to dokładna liczba pokoleń między organizmami
    generationsBetween = L.gen[b] - L.gen[a];
  }
  return { t: 'compare', req, a: toNode(a), b: toNode(b), traitDelta, traitDistance: d.traits, weightDistance: d.weights, mutationsBetween, generationsBetween, changedWeights: changed.slice(0, 14), genomeA: ga, genomeB: gb };
}

function refreshHistorical(w: World): void {
  world = w; selectedId = history!.info.selectedId;
  statsVersion = -1; statsSent = 0; fertSent = -1; dirty = true;
  lastStatusT = 0; lastStatsT = 0;
  winTick = w.tick; winT = performance.now(); measuredTps = 0;
  sendStatus(); sendStats(true);
}

let labRun: { req: number; cancelled: boolean } | null = null;
function cancelLaboratory(): void { if (labRun) labRun.cancelled = true; }
async function runLaboratory(req: number, request: LabRequest): Promise<void> {
  if (labRun && !labRun.cancelled) { post({ t: 'error', req, message: 'Próba laboratoryjna już trwa.' }); return; }
  const run = { req, cancelled: false };
  labRun = run;
  const generator = runLabGenerator(request);
  try {
    for (;;) {
      if (run.cancelled) { post({ t: 'error', req, code: 'cancelled', message: 'Anulowano próbę laboratoryjną.' }); return; }
      const next = generator.next();
      if (next.done) { post({ t: 'lab', req, result: next.value }); return; }
      post({ t: 'labProgress', req, ...next.value });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } catch (e) {
    post({ t: 'error', req, message: e instanceof Error ? e.message : String(e) });
  } finally {
    generator.return(undefined as never);
    if (labRun === run) labRun = null;
  }
}

let ablating = false;

/** Test ablacji w tle: grupy liczone kolejno, między nimi oddajemy sterowanie pętli symulacji. */
async function runAblation(req: number, ticks: number): Promise<void> {
  if (!world || ablating) { post({ t: 'error', req, message: 'Świat nie jest gotowy lub trwa inny test ablacji.' }); return; }
  ablating = true;
  try {
    const w = world;
    const suite = ablationSuite(w, ticks, undefined, (row, done, total) => post({ t: 'ablationRow', req, row, done, total }));
    post({ t: 'ablationDone', req, suite });
  } catch (e) {
    post({ t: 'error', req, message: e instanceof Error ? e.message : String(e) });
  } finally {
    ablating = false;
  }
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    if ('req' in m && !world && m.t !== 'loadHistory' && m.t !== 'cancelLab') throw new Error('Świat nie jest gotowy.');
    switch (m.t) {
      case 'init':
        cancelLaboratory();
        world = new World(m.setup, m.params);
        history = new WorldHistory(world);
        selectedId = null;
        playing = false;
        announce();
        break;
      case 'load':
        cancelLaboratory();
        world = deserializeWorld(m.bytes);
        history = new WorldHistory(world);
        selectedId = null;
        playing = false;
        announce();
        break;
      case 'loadHistory': {
        cancelLaboratory();
        history = WorldHistory.fromArchive(m.bytes);
        world = history.live;
        selectedId = history.info.selectedId;
        playing = false; owed = 0;
        announce();
        post({ t: 'history', req: m.req, info: history.info });
        break;
      }
      case 'historySeek':
        if (!history) throw new Error('Świat nie jest gotowy.');
        playing = false; owed = 0;
        refreshHistorical(history.seek(m.tick));
        post({ t: 'history', req: m.req, info: history.info });
        break;
      case 'historyLive':
        if (!history) throw new Error('Świat nie jest gotowy.');
        playing = false; owed = 0;
        refreshHistorical(history.returnLive());
        post({ t: 'history', req: m.req, info: history.info });
        break;
      case 'historyExport': {
        if (!history) throw new Error('Świat nie jest gotowy.');
        const raw = history.serializeArchive();
        void gzip(raw).then(bytes => post({ t: 'historyBytes', req: m.req, kind: 'archive', bytes }, [bytes.buffer as ArrayBuffer])).catch(e => post({ t: 'error', req: m.req, message: String(e) }));
        break;
      }
      case 'historicalWorld': {
        if (!history) throw new Error('Świat nie jest gotowy.');
        const bytes = serializeWorld(history.worldAt(m.tick));
        post({ t: 'historyBytes', req: m.req, kind: 'world', bytes }, [bytes.buffer as ArrayBuffer]);
        break;
      }
      case 'play':
        if (m.playing && history?.preview) throw new Error('Wróć do teraźniejszości lub rozwidl wybrany moment przed uruchomieniem.');
        playing = m.playing && !!world && world.status === 'running';
        lastT = performance.now();
        dirty = true;
        lastStatusT = 0;
        break;
      case 'step':
        if (world) {
          playing = false;
          history!.run(Math.max(1, Math.min(100000, Math.floor(m.n))));
          dirty = true;
          lastStatusT = 0;
        }
        break;
      case 'speed':
        tps = m.tps;
        lastStatusT = 0;
        break;
      case 'command':
        applyCommand(m.cmd);
        break;
      case 'commands': {
        if (!history || history.preview) throw new Error('Wróć do teraźniejszości lub rozwidl wybrany moment przed zmianą parametrów.');
        if (!Array.isArray(m.commands) || m.commands.length > 100 || m.commands.some(cmd => !validCommand(cmd, world!))) throw new Error('Nieprawidłowy zestaw poleceń.');
        for (const cmd of m.commands) applyCommand(cmd);
        sendStatus(); sendStats();
        post({ t: 'commands', req: m.req, tick: world!.tick, applied: m.commands.length });
        break;
      }
      case 'select':
        selectedId = m.id;
        history?.select(m.id);
        dirty = true;
        break;
      case 'view':
        flags = m.flags;
        dirty = true;
        break;
      case 'ack':
        acked = true;
        break;
      case 'inspect': {
        if (!world) break;
        const live = world.inspect(m.id);
        let archived = null;
        if (!live) {
          const n = world.lineage.indexOf(m.id);
          if (n >= 0) archived = { info: world.lineage.info(n), genome: world.lineage.reconstruct(n) };
        }
        post({ t: 'inspect', req: m.req, live, archived });
        break;
      }
      case 'lineage': {
        if (!world) break;
        const r = lineageQuery(m.id, m.req);
        if (r) post(r);
        else post({ t: 'lineage', req: m.req, ancestors: [], descendants: [], descendantsTruncated: false, livingDescendants: 0 });
        break;
      }
      case 'compare':
        if (world) post(compareQuery(m.a, m.b, m.req));
        break;
      case 'save': {
        if (!world) break;
        const w = world;
        const meta = { tick: w.tick, pop: w.pool.n, seed: w.setup.seed };
        const raw = serializeWorld(w, m.label);
        void gzip(raw).then(bytes => post({ t: 'saved', req: m.req, reason: m.reason, label: m.label, bytes, ...meta, engine: ENGINE_VERSION }, [bytes.buffer as ArrayBuffer])).catch(e => post({ t: 'error', req: m.req, message: String(e) }));
        break;
      }
      case 'export': {
        if (!world) break;
        const text =
          m.kind === 'stats-csv' ? world.stats.toCsv()
          : m.kind === 'experiment-json' ? exportExperimentJson(world)
          : m.kind === 'lineage-json' ? exportLineageJson(world)
          : exportPopulationCsv(world);
        post({ t: 'export', req: m.req, kind: m.kind, text });
        break;
      }
      case 'probe':
        if (world) {
          const r = probeBehavior(world);
          post({ t: 'probe', req: m.req, n: r.n, results: r.results });
        }
        break;
      case 'strategies':
        if (world) post({ t: 'strategies', req: m.req, n: world.pool.n, clusters: clusterStrategies(world, m.k) });
        break;
      case 'ablation':
        if (world) void runAblation(m.req, m.ticks);
        break;
      case 'atlas':
        post({ t: 'atlas', req: m.req, atlas: behaviorAtlas(world!), species: speciesAnalysis(world!) });
        break;
      case 'captureSpecimen':
        post({ t: 'specimen', req: m.req, specimen: m.archived ? captureAncestorSpecimen(world!, m.id) : captureSpecimen(world!, m.id) });
        break;
      case 'lab':
        void runLaboratory(m.req, m.request);
        break;
      case 'cancelLab':
        if (labRun && (m.req === undefined || m.req === labRun.req)) cancelLaboratory();
        break;
      case 'autosave':
        autosaveEvery = m.everyTicks;
        break;
      case 'sendStats':
        if (world) sendStats(true);
        break;
    }
  } catch (e) {
    post({ t: 'error', req: 'req' in m ? m.req : undefined, message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
  }
};

tick();
