/**
 * Eksperymenty: tryb headless, serie z różnymi seedami, podsumowania i eksport (CSV/JSON).
 * Moduł nie zależy od DOM ani od React — działa w Node, w Web Workerze i w przeglądarce.
 */
import type { WorldParams, WorldSetup } from './config';
import { ENGINE_VERSION, GENOME_LEN, N_TRAITS, TRAIT_NAMES } from './constants';
import { STAT_COLUMNS, STAT_INDEX } from './stats';
import { World, ledgerIn, ledgerOut } from './world';

export interface RunSummary {
  seed: number;
  ticks: number;
  status: 'running' | 'extinct';
  extinctionTick: number | null;
  finalPop: number;
  meanPop: number;
  minPop: number;
  maxPop: number;
  maxGeneration: number;
  meanTraits: Record<string, number>;
  diversity: number;
  /** udział drapieżników (dieta > 0,3) i największego kladu na końcu */
  carnFrac: number;
  cladeTop: number;
  cladeCount: number;
  /** zgony z rąk drapieżników na 1000 ticków (ostatnie okno) */
  predRate: number;
  totalBirths: number;
  totalDeaths: number;
}

export function summarize(w: World): RunSummary {
  const s = w.stats;
  const pop = s.column('pop');
  let sum = 0, mn = Infinity, mx = 0;
  for (const v of pop) {
    sum += v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const meanTraits: Record<string, number> = {};
  for (const t of TRAIT_NAMES) meanTraits[t] = s.last(`m_${t}`);
  const births = s.column('births');
  const deaths = s.column('deaths');
  let tb = 0, td = 0;
  for (let i = 0; i < births.length; i++) {
    tb += births[i];
    td += deaths[i];
  }
  const ext = w.eventLog.find((e) => e.kind === 'extinction');
  return {
    seed: w.setup.seed,
    ticks: w.tick,
    status: w.status,
    extinctionTick: ext ? ext.tick : null,
    finalPop: w.pool.n,
    meanPop: pop.length ? sum / pop.length : 0,
    minPop: pop.length ? mn : 0,
    maxPop: mx,
    maxGeneration: s.last('maxGen'),
    meanTraits,
    diversity: s.last('diversity'),
    carnFrac: s.last('carnFrac'),
    cladeTop: s.last('cladeTop'),
    cladeCount: s.last('cladeCount'),
    predRate: s.recentRate('dPred'),
    totalBirths: tb,
    totalDeaths: td,
  };
}

export interface HeadlessOptions {
  ticks: number;
  /** wywoływane co `progressEvery` ticków; zwrócenie `false` przerywa bieg */
  onProgress?: (w: World) => boolean | void;
  progressEvery?: number;
}

export function runHeadless(setup: Partial<WorldSetup>, params: Partial<WorldParams>, opts: HeadlessOptions): { world: World; summary: RunSummary } {
  const w = new World(setup, params);
  const every = opts.progressEvery ?? 1000;
  while (w.tick < opts.ticks && w.status === 'running') {
    w.run(Math.min(every, opts.ticks - w.tick));
    if (opts.onProgress && opts.onProgress(w) === false) break;
  }
  return { world: w, summary: summarize(w) };
}

/** Seria: ta sama konfiguracja, różne seedy. */
export function runSeries(
  setup: Partial<WorldSetup>,
  params: Partial<WorldParams>,
  seeds: number[],
  ticks: number,
  onRun?: (done: number, total: number, s: RunSummary) => void,
): RunSummary[] {
  const out: RunSummary[] = [];
  seeds.forEach((seed, k) => {
    const { summary } = runHeadless({ ...setup, seed }, params, { ticks });
    out.push(summary);
    onRun?.(k + 1, seeds.length, summary);
  });
  return out;
}

/** Metryki wybierane w przeszukiwaniu parametrów i testach A/B. */
export const SWEEP_METRICS: { key: string; label: string; get: (r: RunSummary) => number }[] = [
  { key: 'finalPop', label: 'Populacja końcowa', get: (r) => r.finalPop },
  { key: 'meanPop', label: 'Średnia populacja', get: (r) => r.meanPop },
  { key: 'maxGeneration', label: 'Liczba pokoleń', get: (r) => r.maxGeneration },
  { key: 'diversity', label: 'Różnorodność cech', get: (r) => r.diversity },
  { key: 'extinct', label: 'Wymarcie (0/1)', get: (r) => (r.status === 'extinct' ? 1 : 0) },
  { key: 'carnFrac', label: 'Udział drapieżników', get: (r) => r.carnFrac },
  { key: 'cladeCount', label: 'Liczba kladów', get: (r) => r.cladeCount },
  { key: 'predRate', label: 'Zgony z rąk drapieżników /1000t', get: (r) => r.predRate },
  ...TRAIT_NAMES.filter((t) => t !== 'hue').map((t) => ({ key: `trait:${t}`, label: `Średnia cecha: ${t}`, get: (r: RunSummary) => r.meanTraits[t] })),
];

export interface SweepAxis {
  /** nazwa parametru świata (WorldParams) lub pola konfiguracji (WorldSetup) */
  key: string;
  values: number[];
}

export interface SweepResult {
  x: SweepAxis;
  y: SweepAxis | null;
  seeds: number[];
  ticks: number;
  /** cells[iy][ix] = podsumowania dla kolejnych seedów */
  cells: RunSummary[][][];
}

const SETUP_KEYS = new Set(['initialPopulation', 'patchCount', 'width', 'height', 'founderDietMax', 'founderWeightSd', 'initialFoodFraction', 'founderEnergyFraction']);

function applyAxis(setup: Partial<WorldSetup>, params: Partial<WorldParams>, key: string, value: number): void {
  if (SETUP_KEYS.has(key)) (setup as Record<string, number>)[key] = value;
  else (params as Record<string, number>)[key] = value;
}

/**
 * Przeszukiwanie siatki parametrów: dla każdej kombinacji (x, y) uruchamia `seeds.length` przebiegów headless.
 * Wynik można zredukować dowolną metryką z SWEEP_METRICS (średnia ± przedział ufności, test Welcha między komórkami).
 */
export function runSweep(
  setup: Partial<WorldSetup>,
  params: Partial<WorldParams>,
  x: SweepAxis,
  y: SweepAxis | null,
  seeds: number[],
  ticks: number,
  onCell?: (done: number, total: number) => void,
): SweepResult {
  const ys = y ? y.values : [0];
  const cells: RunSummary[][][] = [];
  const total = ys.length * x.values.length * seeds.length;
  let done = 0;
  for (let iy = 0; iy < ys.length; iy++) {
    const row: RunSummary[][] = [];
    for (let ix = 0; ix < x.values.length; ix++) {
      const cell: RunSummary[] = [];
      for (const seed of seeds) {
        const s2: Partial<WorldSetup> = { ...setup, seed };
        const p2: Partial<WorldParams> = { ...params };
        applyAxis(s2, p2, x.key, x.values[ix]);
        if (y) applyAxis(s2, p2, y.key, ys[iy]);
        cell.push(runHeadless(s2, p2, { ticks }).summary);
        onCell?.(++done, total);
      }
      row.push(cell);
    }
    cells.push(row);
  }
  return { x, y, seeds, ticks, cells };
}

/** CSV wyniku przeszukiwania: jeden wiersz na przebieg. */
export function sweepToCsv(r: SweepResult): string {
  const head = ['x', ...(r.y ? ['y'] : []), 'seed', 'status', 'finalPop', 'maxGeneration', 'diversity', 'carnFrac', 'cladeCount', ...TRAIT_NAMES.filter((t) => t !== 'hue').map((t) => `mean_${t}`)];
  const lines = [head.join(',')];
  r.cells.forEach((row, iy) =>
    row.forEach((cell, ix) =>
      cell.forEach((s) => {
        lines.push([r.x.values[ix], ...(r.y ? [r.y.values[iy]] : []), s.seed, s.status, s.finalPop, s.maxGeneration, s.diversity.toFixed(4), s.carnFrac.toFixed(4), s.cladeCount, ...TRAIT_NAMES.filter((t) => t !== 'hue').map((t) => s.meanTraits[t].toFixed(4))].join(','));
      }),
    ),
  );
  return lines.join('\n');
}

export function seriesToCsv(rows: RunSummary[]): string {
  const head = ['seed', 'ticks', 'status', 'extinctionTick', 'finalPop', 'meanPop', 'minPop', 'maxPop', 'maxGeneration', 'diversity', 'totalBirths', 'totalDeaths', ...TRAIT_NAMES.map((t) => `mean_${t}`)];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push(
      [r.seed, r.ticks, r.status, r.extinctionTick ?? '', r.finalPop, r.meanPop.toFixed(2), r.minPop, r.maxPop, r.maxGeneration, r.diversity.toFixed(4), r.totalBirths, r.totalDeaths, ...TRAIT_NAMES.map((t) => r.meanTraits[t].toFixed(4))].join(','),
    );
  }
  return lines.join('\n');
}

/** Pełny eksport eksperymentu do JSON (konfiguracja, historia parametrów, zdarzenia, statystyki). */
export function exportExperimentJson(w: World): string {
  const s = w.stats;
  const cols = STAT_COLUMNS.map((c) => c.key);
  const rows: number[][] = [];
  for (let r = 0; r < s.count; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols.length; c++) row.push(s.rows[r * cols.length + c]);
    rows.push(row);
  }
  return JSON.stringify(
    {
      format: 'genesis-experiment',
      engineVersion: ENGINE_VERSION,
      setup: w.setup,
      params: w.params,
      tick: w.tick,
      status: w.status,
      paramHistory: w.paramHistory,
      commandLog: w.commandLog,
      eventLog: w.eventLog,
      ledger: { ...w.ledger, totalIn: ledgerIn(w.ledger), totalOut: ledgerOut(w.ledger) },
      statsInterval: s.interval,
      statColumns: cols,
      stats: rows,
      summary: summarize(w),
    },
    null,
    1,
  );
}

/**
 * Eksport genealogii: węzły (id, rodzic, pokolenie, narodziny, śmierć, potomstwo, cechy).
 * Zawiera tylko to, co jest jeszcze w pamięci (patrz opis przycinania w lineage.ts).
 */
export function exportLineageJson(w: World, maxNodes = 200_000): string {
  const L = w.lineage;
  const nodes: unknown[] = [];
  for (let n = 0; n < L.size && nodes.length < maxNodes; n++) {
    if (L.death[n] === -2) continue;
    const info = L.info(n);
    nodes.push([info.id, info.parentId, info.generation, info.birthTick, info.deathTick, info.offspring, info.mutations, ...info.traits.map((v) => Math.round(v * 10000) / 10000)]);
  }
  return JSON.stringify({
    format: 'genesis-lineage',
    columns: ['id', 'parentId', 'generation', 'birthTick', 'deathTick', 'offspring', 'mutations', ...TRAIT_NAMES],
    totalRecorded: L.totalRecorded,
    totalPruned: L.totalPruned,
    nodes,
  });
}

/** Zrzut żyjącej populacji do CSV (cechy + parametry fizjologiczne). */
export function exportPopulationCsv(w: World): string {
  const p = w.pool;
  const lines = [['id', 'generation', 'age', 'energy', 'health', 'x', 'y', ...TRAIT_NAMES].join(',')];
  for (let i = 0; i < p.n; i++) {
    const tr: number[] = [];
    for (let t = 0; t < N_TRAITS; t++) tr.push(p.genomes[i * GENOME_LEN + t]);
    lines.push([p.id[i], p.generation[i], p.age[i], p.energy[i].toFixed(3), p.health[i].toFixed(3), p.x[i].toFixed(2), p.y[i].toFixed(2), ...tr.map((v) => v.toFixed(4))].join(','));
  }
  return lines.join('\n');
}

export { STAT_INDEX };
