/** Protokół komunikacji UI ⇄ Worker symulacji. Czysto typy — brak logiki biologicznej. */
import type { Command, LogEntry, OrganismView, ActiveEvent } from '../engine/world';
import type { WorldParams, WorldSetup } from '../engine/config';
import type { LineageInfo } from '../engine/lineage';
import type { RunSummary } from '../engine/experiment';
import type { AblationRow, AblationSuite, ProbeResult, StrategyCluster } from '../engine/analysis';
import type { SweepResult } from '../engine/experiment';

export type ColorMode = 'lineage' | 'strategy' | 'energy' | 'generation' | 'age' | 'diet' | 'clade';

export interface ViewFlags {
  colorMode: ColorMode;
  sensors: boolean;
  energy: boolean;
}

export type ToWorker =
  | { t: 'init'; setup: Partial<WorldSetup>; params: Partial<WorldParams> }
  | { t: 'load'; bytes: Uint8Array }
  | { t: 'play'; playing: boolean }
  | { t: 'step'; n: number }
  | { t: 'speed'; tps: number }
  | { t: 'command'; cmd: Command }
  | { t: 'select'; id: number | null }
  | { t: 'view'; flags: ViewFlags }
  | { t: 'ack' }
  | { t: 'inspect'; id: number; req: number }
  | { t: 'lineage'; id: number; req: number }
  | { t: 'compare'; a: number; b: number; req: number }
  | { t: 'save'; label: string; req: number; reason: 'manual' | 'export' | 'fork' }
  | { t: 'export'; kind: 'stats-csv' | 'experiment-json' | 'lineage-json' | 'population-csv'; req: number }
  | { t: 'autosave'; everyTicks: number }
  | { t: 'probe'; req: number }
  | { t: 'ablation'; req: number; ticks: number }
  | { t: 'strategies'; req: number; k: number }
  | { t: 'sendStats' };

export interface FrameSelection {
  id: number;
  x: number;
  y: number;
  radius: number;
  sense: number;
  hx: number;
  hy: number;
}

export interface FrameMsg {
  t: 'frame';
  tick: number;
  n: number;
  /** x,y,radius,hx,hy,color(u32),energyFrac,sense — stride 8 */
  data: Float32Array;
  ids: Float64Array;
  food: Uint8Array;
  /** mapa żyzności — tylko gdy zmieniła się od ostatniej klatki (dryf plam) */
  fert?: Uint8Array;
  selected: FrameSelection | null;
}

export interface StatusMsg {
  t: 'status';
  tick: number;
  pop: number;
  status: 'running' | 'extinct';
  playing: boolean;
  tps: number;
  measuredTps: number;
  temperature: number;
  growthMult: number;
  activeEvents: ActiveEvent[];
  eventLog: LogEntry[];
  eventLogTotal: number;
  paramHistory: { tick: number; key: string; from: number; to: number }[];
  params: WorldParams;
  setup: WorldSetup;
  energyImbalance: number;
  ledger: { totalIn: number; totalOut: number; food: number; organisms: number };
  lineageNodes: number;
  lineageRecorded: number;
  lineagePruned: number;
  lineageBytes: number;
}

export interface StatsMsg {
  t: 'stats';
  reset: boolean;
  /** indeks pierwszego przesyłanego wiersza */
  from: number;
  count: number;
  interval: number;
  rows: Float64Array;
}

export interface InitMsg {
  t: 'ready';
  setup: WorldSetup;
  nx: number;
  ny: number;
  fert: Uint8Array;
}

export interface InspectResult {
  t: 'inspect';
  req: number;
  live: OrganismView | null;
  /** widok archiwalny, gdy organizm już nie żyje, ale jest w genealogii */
  archived: { info: LineageInfo; genome: Float32Array | null } | null;
}

export interface LineageTreeNode {
  id: number;
  parentId: number | null;
  parent2Id: number | null;
  generation: number;
  birthTick: number;
  deathTick: number | null;
  offspring: number;
  mutations: number;
  alive: boolean;
  traits: number[];
}

export interface LineageResult {
  t: 'lineage';
  req: number;
  /** od założyciela do wybranego organizmu */
  ancestors: LineageTreeNode[];
  /** potomkowie (BFS, ograniczona liczba) */
  descendants: LineageTreeNode[];
  descendantsTruncated: boolean;
  livingDescendants: number;
}

export interface CompareResult {
  t: 'compare';
  req: number;
  a: LineageTreeNode | null;
  b: LineageTreeNode | null;
  traitDelta: number[];
  traitDistance: number;
  weightDistance: number;
  /** liczba zmian genów wzdłuż ścieżki (gdy a jest przodkiem b) */
  mutationsBetween: number | null;
  generationsBetween: number | null;
  changedWeights: { gene: number; from: number; to: number }[];
  genomeA: Float32Array | null;
  genomeB: Float32Array | null;
}

export interface SavedMsg {
  t: 'saved';
  req: number;
  reason: 'manual' | 'export' | 'fork' | 'auto';
  label: string;
  bytes: Uint8Array;
  tick: number;
  pop: number;
  seed: number;
  engine: string;
}

export interface ProbeMsg {
  t: 'probe';
  req: number;
  n: number;
  results: ProbeResult[];
}

export interface AblationRowMsg {
  t: 'ablationRow';
  req: number;
  row: AblationRow;
  done: number;
  total: number;
}

export interface AblationDoneMsg {
  t: 'ablationDone';
  req: number;
  suite: AblationSuite;
}

export interface StrategiesMsg {
  t: 'strategies';
  req: number;
  n: number;
  clusters: StrategyCluster[];
}

export interface ExportMsg {
  t: 'export';
  req: number;
  kind: string;
  text: string;
}

export interface ErrorMsg {
  t: 'error';
  message: string;
}

export type FromWorker = FrameMsg | StatusMsg | StatsMsg | InitMsg | InspectResult | LineageResult | CompareResult | SavedMsg | ExportMsg | ProbeMsg | AblationRowMsg | AblationDoneMsg | StrategiesMsg | ErrorMsg;

// — seria (osobny worker) —
export type ToSeries =
  | { t: 'run'; setup: Partial<WorldSetup>; params: Partial<WorldParams>; seeds: number[]; ticks: number }
  | {
      t: 'sweep';
      setup: Partial<WorldSetup>;
      params: Partial<WorldParams>;
      x: { key: string; values: number[] };
      y: { key: string; values: number[] } | null;
      seeds: number[];
      ticks: number;
    };
export type FromSeries =
  | { t: 'progress'; done: number; total: number; summary: RunSummary }
  | { t: 'done'; results: RunSummary[] }
  | { t: 'sweepProgress'; done: number; total: number }
  | { t: 'sweepDone'; result: SweepResult }
  | { t: 'error'; message: string };
