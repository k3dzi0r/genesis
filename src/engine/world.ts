/**
 * Świat GENESIS: jawne reguły fizyki i bilansu energii + dziedziczenie z mutacjami.
 *
 * Kolejność jednego ticku (deterministyczna):
 *  0. zdarzenia zaplanowane, środowisko (pory roku, temperatura, mnożniki), dryf i cykl życia plam żyzności
 *  1. odnowa zasobów: wzrost logistyczny ∝ biomasa (jedyne źródło energii poza ręcznym dosypaniem)
 *  2. przebudowa siatki przestrzennej
 *  3. percepcja + decyzja mózgu (na stanie z początku ticku — kolejność organizmów nie ma znaczenia);
 *     aktualizacja pamięci rekurencyjnej
 *  4. ruch i koszty fizjologiczne (energia → ciepło)
 *  5. żerowanie: zasób komórki dzielony proporcjonalnie do zamiaru · (promień/4)^k (rywalizacja kontaktowa)
 *  5b. drapieżnictwo: odbieranie energii ofiarom w kontakcie (podział proporcjonalny, bez faworyzowania indeksów)
 *  6. starzenie i śmierć, a następnie reprodukcja (bezpłciowa lub płciowa)
 *  7. usunięcie zmarłych (zwłoki wracają jako pokarm), statystyki, przycinanie genealogii
 *
 * Bilans: energia(pokarm)+energia(organizmy) = początkowa + wpływy − rozproszenie (Ledger).
 */
import { think } from './brain';
import { storageScale } from './mathx';
import {
  ENGINE_VERSION, GENOME_LEN, IN_MEM, IN_NB_DIET, IN_NB_SIZE, N_HID, N_IN, N_MEM, N_OUT, N_TRAITS, OUT_ATTACK, OUT_EAT, OUT_MEM, OUT_THRUST, OUT_TURN,
  PHYSIO, TRAIT_DIET, TRAIT_HUE, TRAIT_MEMORY, TRAIT_PLANT, TRAIT_MATE_PREFERENCE, TRAIT_MATE_SELECTIVITY, TRAIT_PLASTICITY, TRAIT_NICHE, IN_FOOD_B_FWD, IN_FOOD_B_LAT, IN_FOOD_B_AMOUNT, IN_SIGNAL, IN_SIGNAL_FWD, IN_SIGNAL_LAT, OUT_SIGNAL, OUT_CULTIVATE, W1_OFF, B1_OFF, W2_OFF, B2_OFF, MAX_WEIGHT, TRAIL_LEN,
} from './constants';
import {
  type EventSpec, type WorldParams, type WorldSetup, mergeParams, validateSetup,
} from './config';
import { crossover, diffGenomes, inheritWithMutation, makeMutationScratch, randomGenome, sumAbsWeights } from './genome';
import { LineageStore, type LineageInfo } from './lineage';
import { clamp, cosSmall, pow025, pow075, sinSmall, triangleWave } from './mathx';
import { OrganismPool } from './pool';
import { type Patch, ResourceGrid, assignPhase, generateFertility, renderPatches, stepPatches } from './resources';
import { Rng } from './rng';
import { SpatialGrid } from './spatial';
import { N_STATS, STAT_INDEX, StatsHistory } from './stats';

export const CAUSE_STARVE = 0;
export const CAUSE_AGE = 1;
export const CAUSE_HEALTH = 2;
export const CAUSE_ACCIDENT = 3;
export const CAUSE_CULL = 4;
export const CAUSE_PREDATION = 5;
export const CAUSE_NAMES = ['głód', 'starość', 'zdrowie', 'wypadek', 'katastrofa', 'drapieżnik'] as const;
export const N_CAUSES = CAUSE_NAMES.length;

/** Grupy wejść, które można „wyłączyć” w teście ablacji (patrz analysis.ts). */
export type AblationGroup = 'memory' | 'food' | 'neighbors' | 'walls' | 'energy' | 'temperature' | 'communication';

export type Command =
  | { type: 'setParam'; key: keyof WorldParams; value: number }
  | { type: 'event'; spec: EventSpec }
  | { type: 'addFood'; amount: number; x?: number; y?: number; radius?: number };

export interface ActiveEvent {
  spec: EventSpec;
  start: number;
  end: number;
}

export interface LogEntry {
  tick: number;
  kind: string;
  text: string;
}

export interface Ledger {
  initial: number;
  inRegrowth: number;
  inManual: number;
  outBasal: number;
  outMove: number;
  outSense: number;
  outUpkeep: number;
  outEat: number;
  outAttack: number;
  outDigest: number;
  outRepro: number;
  outCorpse: number;
  outDecay: number;
  outEvent: number;
  outSignal: number;
  outLearning: number;
  outCultivation: number;
}

function newLedger(): Ledger {
  return {
    initial: 0, inRegrowth: 0, inManual: 0, outBasal: 0, outMove: 0, outSense: 0, outUpkeep: 0,
    outEat: 0, outAttack: 0, outDigest: 0, outRepro: 0, outCorpse: 0, outDecay: 0, outEvent: 0, outSignal: 0, outLearning: 0, outCultivation: 0,
  };
}

export function ledgerIn(l: Ledger): number {
  return l.inRegrowth + l.inManual;
}
export function ledgerOut(l: Ledger): number {
  return l.outBasal + l.outMove + l.outSense + l.outUpkeep + l.outEat + l.outAttack + l.outDigest + l.outRepro + l.outCorpse + l.outDecay + l.outEvent + l.outSignal + l.outLearning + l.outCultivation;
}

export interface Accumulators {
  births: number;
  /** energia przejęta przez drapieżniki w bieżącym przedziale statystyk */
  predEnergy: number;
  deaths: number[];
  inMark: number;
  outMark: number;
}

/** Measurements describe experienced events, never labels inferred from genes. */
export interface ObservedBehavior {
  biomeTransitions: number;
  observedTicks: number; distance: number; feedingTicks: number; foodEnergy: number;
  foodAConsumed: number; foodBConsumed: number; meatEnergy: number; attacks: number; successfulAttacks: number;
  revisits: number; threatExposure: number; threatEscape: number; neighborTicks: number;
  signalEmitted: number; signalReceived: number; cultivated: number; seedsMoved: number;
  mateAttempts: number; mateRejected: number; sexualBirths: number; crossGroupBirths: number;
  trail: { tick: number; x: number; y: number; energy: number }[];
}

export interface OrganismView {
  id: number;
  slot: number;
  x: number;
  y: number;
  hx: number;
  hy: number;
  age: number;
  maxAge: number;
  energy: number;
  maxEnergy: number;
  health: number;
  generation: number;
  birthTick: number;
  offspring: number;
  parentId: number | null;
  traits: number[];
  physiology: {
    radius: number; mass: number; maxSpeed: number; senseRange: number; biteCap: number; assim: number;
    reproThresh: number; investFrac: number; maturity: number; coldTol: number; sumAbsW: number;
    diet: number; memDecay: number; plantSpecialization: number; assimB: number; matePreference: number; mateSelectivity: number; plasticity: number; nicheInvestment: number;
  };
  mem: number[];
  parent2Id: number | null;
  clade: number;
  costs: { basal: number; sense: number; brain: number; upkeep: number; idle: number };
  expectedLifespan: number;
  starvationIn: number;
  inputs: number[];
  hidden: number[];
  outputs: number[];
  genome: Float32Array;
  learnedWeights: Float32Array;
  somaticWeights: Float32Array;
  observations: ObservedBehavior;
  signal: number;
  seedLoad: number;
  lineage: LineageInfo | null;
}

const SCHEDULE_SORT = (a: { tick: number }, b: { tick: number }) => a.tick - b.tick;

export const BIOME_LABELS = ['Umiarkowany', 'Chłodny', 'Ciepły'] as const;
export interface LocalEnvironment {
  biome: number; temperature: number; growthMult: number; fertility: number; foodBShare: number;
}
export interface BiomeSnapshot {
  enabled: boolean; contrast: number;
  biomes: { id: number; label: string; cells: number; population: number; foodA: number; foodB: number; meanTemperature: number; births: number; deaths: number; entries: number; exits: number }[];
  migrations: number[][];
}
export function newBiomeCounters(): { births: number[]; deaths: number[]; migrations: number[] } {
  return { births: [0, 0, 0], deaths: [0, 0, 0], migrations: new Array<number>(9).fill(0) };
}

export class World {
  readonly setup: WorldSetup;
  params: WorldParams;
  tick = 0;
  status: 'running' | 'extinct' = 'running';
  rng: Rng;
  readonly grid: ResourceGrid;
  readonly pool: OrganismPool;
  readonly spatial: SpatialGrid;
  lineage: LineageStore;
  stats: StatsHistory;
  ledger: Ledger = newLedger();
  nextId = 1;
  mating = { within: 0, between: 0, rejectedWithin: 0, rejectedBetween: 0 };
  biomeCounters = newBiomeCounters();
  activeEvents: ActiveEvent[] = [];
  eventLog: LogEntry[] = [];
  commandLog: { tick: number; cmd: Command }[] = [];
  paramHistory: { tick: number; key: string; from: number; to: number }[] = [];
  schedIdx = 0;
  temperature = 1;
  growthMult = 1;
  /** Phase used by the last environment update (tick increments after movement). */
  environmentTick = 0;
  acc: Accumulators = { births: 0, predEnergy: 0, deaths: new Array<number>(N_CAUSES).fill(0), inMark: 0, outMark: 0 };
  nextSampleTick = 0;
  lastSampleTick = 0;
  /** Parametry retencji genealogii (nie wpływają na dynamikę świata). */
  lineageRetention = 20000;
  lineageMaxRecords = 600_000;
  private pinnedNode = -1;
  /** żyzne plamy (wzorzec `patches`); mogą dryfować i się odradzać */
  patches: Patch[] = [];
  /** osobny strumień losowości środowiska (dryf i odradzanie plam) */
  envRng: Rng;
  /** zwiększane przy każdym przeliczeniu mapy żyzności (renderer odświeża teksturę) */
  fertVersion = 0;
  /** najwyższy zalogowany próg dominacji kladu: 0, 1 (>50 %), 2 (>90 %) */
  cladeLogged = 0;
  /** test ablacji: wejścia danej grupy są zastępowane stałą średnią populacji (nie jest zapisywane) */
  ablate: AblationGroup | null = null;
  /** średnie wejścia sieci w populacji — wartości podstawiane przy ablacji */
  readonly ablationMeans = new Float64Array(N_IN);
  /** gdy true, ablacja dotyczy tylko organizmów o nieparzystym id (test kohortowy) */
  ablateOddOnly = false;

  // bufory robocze (stan pochodny — nie są zapisywane)
  private readonly inp = new Float64Array(N_IN);
  private readonly hid = new Float64Array(N_HID);
  private readonly out = new Float64Array(N_OUT);
  private readonly outTurn: Float64Array;
  private readonly outEatBuf: Float64Array;
  private readonly desire: Float64Array;
  private readonly desireB: Float64Array;
  private readonly demandB: Float64Array;
  private readonly signalBuf: Float64Array;
  private readonly cultivationBuf: Float64Array;
  private readonly startEnergy: Float64Array;
  private readonly threatX: Float64Array;
  private readonly threatY: Float64Array;
  private readonly threatFlag: Uint8Array;
  /** organizm nie pokrył kosztów metabolicznych w tym ticku → głód (nawet jeśli coś zje) */
  private readonly starved: Uint8Array;
  private readonly atkBuf: Float64Array;
  private readonly atkTarget: Int32Array;
  private readonly atkDemand: Float64Array;
  private readonly drain: Float64Array;
  private readonly predRatio: Float64Array;
  private readonly predTaken: Float64Array;
  private readonly predGain: Float64Array;
  private readonly hunted: Uint8Array;
  private readonly dying: Uint8Array;
  private readonly mated: Uint8Array;
  private readonly tmpGenome = new Float32Array(GENOME_LEN);
  private readonly cladeCount: Int32Array;
  private readonly cellOf: Int32Array;
  private readonly demand: Float64Array;
  private readonly scratch = makeMutationScratch();
  private readonly statRow = new Float64Array(N_STATS);
  private readonly tSum = new Float64Array(N_TRAITS);
  private readonly tSq = new Float64Array(N_TRAITS);
  private deadList: number[] = [];
  private deadCause: number[] = [];

  constructor(setup: Partial<WorldSetup> = {}, params: Partial<WorldParams> = {}, init = true) {
    this.setup = validateSetup(setup);
    this.setup.schedule.sort(SCHEDULE_SORT);
    this.params = mergeParams(params);
    this.rng = new Rng(this.setup.seed, 0);
    this.envRng = new Rng(this.setup.seed, 3);
    this.grid = new ResourceGrid(this.setup.width, this.setup.height, this.setup.cellSize);
    this.pool = new OrganismPool(this.setup.capacity);
    this.spatial = new SpatialGrid(this.setup.width, this.setup.height, 40, this.setup.capacity);
    this.lineage = new LineageStore();
    this.stats = new StatsHistory();
    const cap = this.setup.capacity;
    this.outTurn = new Float64Array(cap * 2);
    this.outEatBuf = new Float64Array(cap);
    this.desire = new Float64Array(cap);
    this.desireB = new Float64Array(cap);
    this.demandB = new Float64Array(this.grid.cells);
    this.signalBuf = new Float64Array(cap);
    this.cultivationBuf = new Float64Array(cap);
    this.startEnergy = new Float64Array(cap);
    this.threatX = new Float64Array(cap);
    this.threatY = new Float64Array(cap);
    this.threatFlag = new Uint8Array(cap);
    this.starved = new Uint8Array(cap);
    this.atkBuf = new Float64Array(cap);
    this.atkTarget = new Int32Array(cap);
    this.atkDemand = new Float64Array(cap);
    this.drain = new Float64Array(cap);
    this.predRatio = new Float64Array(cap);
    this.predTaken = new Float64Array(cap);
    this.predGain = new Float64Array(cap);
    this.hunted = new Uint8Array(cap);
    this.dying = new Uint8Array(cap);
    this.mated = new Uint8Array(cap);
    this.cladeCount = new Int32Array(cap);
    this.cellOf = new Int32Array(cap);
    this.demand = new Float64Array(this.grid.cells);
    if (init) this.initialize();
  }

  // ——— inicjalizacja ———

  private initialize(): void {
    const { setup, grid, pool } = this;
    grid.generateBiomes(setup.seed);
    this.patches = generateFertility(setup, grid, new Rng(setup.seed, 1));
    if (this.params.patchLife > 0) {
      for (const pt of this.patches) assignPhase(pt, this.params.patchLife, this.envRng);
      renderPatches(setup, grid, this.patches);
    }
    if (this.params.obstacles >= 0.5) grid.generateObstacles(setup.seed);
    let foodSum = 0;
    for (let c = 0; c < grid.cells; c++) {
      const total = setup.initialFoodFraction * this.foodCapacity(c);
      grid.foodB[c] = total * this.foodBPartition(c);
      grid.food[c] = total - grid.foodB[c];
      foodSum += total;
    }
    const init = new Rng(setup.seed, 2);
    let orgSum = 0;
    for (let k = 0; k < setup.initialPopulation; k++) {
      const i = pool.n++;
      randomGenome(init, pool.genomes, i * GENOME_LEN, setup.founderWeightSd, setup.founderDietMax);
      pool.id[i] = this.nextId++;
      pool.x[i] = init.float() * setup.width;
      pool.y[i] = init.float() * setup.height;
      this.randomHeading(i, init);
      this.derivePhysiology(i);
      this.placeClear(i);
      pool.currentBiome[i] = this.params.biomes >= 0.5 ? grid.biome[grid.cellAt(pool.x[i], pool.y[i])] : 255;
      pool.energy[i] = setup.founderEnergyFraction * pool.maxE[i];
      orgSum += pool.energy[i];
      pool.health[i] = 1;
      pool.age[i] = Math.floor(init.float() * 0.3 * pool.maturity[i]);
      pool.birth[i] = 0;
      pool.maxAge[i] = Math.floor(this.params.lifespanBase * pow025(pool.mass[i]));
      pool.generation[i] = 0;
      pool.clade[i] = k;
      pool.lastRepro[i] = 0;
      pool.offspring[i] = 0;
      pool.lin[i] = this.lineage.add(pool.id[i], -1, 0, 0, pool.genomes, i * GENOME_LEN, null, null, 0);
    }
    this.ledger.initial = foodSum + orgSum;
    this.updateEnvironment();
    this.nextSampleTick = this.stats.interval;
    this.sample();
    this.log('start', `Start eksperymentu: seed ${setup.seed}, ${setup.initialPopulation} założycieli, silnik ${ENGINE_VERSION}`);
  }

  private randomHeading(i: number, rng: Rng): void {
    let x: number, y: number, d: number;
    do {
      x = rng.float() * 2 - 1;
      y = rng.float() * 2 - 1;
      d = x * x + y * y;
    } while (d > 1 || d < 1e-6);
    const inv = 1 / Math.sqrt(d);
    this.pool.hx[i] = x * inv;
    this.pool.hy[i] = y * inv;
  }

  /** Oblicza cechy pochodne od genomu (nie zależą od parametrów świata). */
  derivePhysiology(i: number): void {
    const p = this.pool;
    const g = p.genomes;
    const o = i * GENOME_LEN;
    const P = PHYSIO;
    const radius = P.radiusMin + (P.radiusMax - P.radiusMin) * g[o + 0];
    const mass = (radius * radius) / 16;
    p.radius[i] = radius;
    p.mass[i] = mass;
    p.m075[i] = pow075(mass);
    p.maxSpeed[i] = P.speedMin + (P.speedMax - P.speedMin) * g[o + 1];
    p.senseRange[i] = P.senseMin + (P.senseMax - P.senseMin) * g[o + 2];
    p.reproThresh[i] = P.reproThreshMin + (P.reproThreshMax - P.reproThreshMin) * g[o + 3];
    p.investFrac[i] = P.investMin + (P.investMax - P.investMin) * g[o + 4];
    p.maturity[i] = P.maturityMin + (P.maturityMax - P.maturityMin) * g[o + 5];
    p.coldTol[i] = g[o + 6];
    const bite = g[o + 7];
    const diet = g[o + TRAIT_DIET];
    p.biteCap[i] = (P.biteMin + (P.biteMax - P.biteMin) * bite) * p.m075[i];
    // sprawność trawienia roślin: maleje z kęsem i z dietą mięsożerną
    p.assim[i] = (P.assimMax - (P.assimMax - P.assimMin) * bite) * (1 - P.dietPlantPenalty * diet);
    p.diet[i] = diet;
    p.plantSpecialization[i] = g[o + TRAIT_PLANT];
    p.matePreference[i] = g[o + TRAIT_MATE_PREFERENCE];
    p.mateSelectivity[i] = g[o + TRAIT_MATE_SELECTIVITY];
    p.plasticity[i] = g[o + TRAIT_PLASTICITY];
    p.nicheInvestment[i] = g[o + TRAIT_NICHE];
    p.assimB[i] = p.assim[i] * (0.2 + 0.8 * p.plantSpecialization[i]);
    p.memDecay[i] = P.memDecayMin + (P.memDecayMax - P.memDecayMin) * g[o + TRAIT_MEMORY];
    p.sumAbsW[i] = sumAbsWeights(g, o);
    p.maxE[i] = P.energyPerMass * storageScale(mass, p.m075[i]);
  }

  // ——— środowisko, zdarzenia i polecenia ———

  private log(kind: string, text: string): void {
    this.eventLog.push({ tick: this.tick, kind, text });
    if (this.eventLog.length > 2000) this.eventLog.splice(100, 200);
  }

  private updateEnvironment(): void {
    this.environmentTick = this.tick;
    const P = this.params;
    let growth = 1;
    let dT = 0;
    const keep: ActiveEvent[] = [];
    for (const ev of this.activeEvents) {
      if (this.tick >= ev.end) {
        this.log('event-end', `Koniec zdarzenia: ${ev.spec.kind}`);
        continue;
      }
      keep.push(ev);
      const dur = ev.end - ev.start;
      const ramp = Math.max(1, Math.min(50, dur / 4));
      const f = Math.min(1, (this.tick - ev.start + 1) / ramp, (ev.end - this.tick) / ramp);
      const s = ev.spec.severity;
      if (ev.spec.kind === 'drought') growth *= 1 - s * f;
      else if (ev.spec.kind === 'bloom') growth *= 1 + 4 * s * f;
      else if (ev.spec.kind === 'coldSnap') dT -= 0.8 * s * f;
    }
    this.activeEvents = keep;
    if (P.seasonPeriod > 0) {
      const w = triangleWave(this.tick, P.seasonPeriod);
      growth *= 1 - P.seasonGrowthAmp * (1 - w);
      dT -= P.seasonTempAmp * (1 - w);
    }
    this.growthMult = growth;
    this.temperature = clamp(P.baseTemperature + dT, 0, 1.2);
  }

  private renderFert(): void {
    if (!this.patches.length) return;
    renderPatches(this.setup, this.grid, this.patches);
    this.fertVersion++;
  }

  /** Zmiany parametrów i interwencje są stosowane między tickami i zapisywane w dzienniku. */
  applyCommand(cmd: Command): void {
    this.commandLog.push({ tick: this.tick, cmd });
    if (this.commandLog.length > 20000) this.commandLog.splice(0, 5000);
    switch (cmd.type) {
      case 'setParam': {
        const from = this.params[cmd.key];
        if (from === cmd.value || !Number.isFinite(cmd.value)) return;
        this.params[cmd.key] = cmd.value;
        this.paramHistory.push({ tick: this.tick, key: cmd.key, from, to: cmd.value });
        if (this.paramHistory.length > 5000) this.paramHistory.splice(0, 1000);
        this.log('param', `Parametr ${cmd.key}: ${from} → ${cmd.value}`);
        if (cmd.key === 'plantBShare' && cmd.value <= 0) {
          // A source switch is an energy-preserving conversion, never an energy injection.
          for (let c = 0; c < this.grid.cells; c++) { this.grid.food[c] += this.grid.foodB[c]; this.grid.foodB[c] = 0; }
          this.fertVersion++;
        }
        if (cmd.key === 'biomes') {
          for (let i = 0; i < this.pool.n; i++) this.pool.currentBiome[i] = cmd.value >= 0.5 ? this.grid.biome[this.grid.cellAt(this.pool.x[i], this.pool.y[i])] : 255;
          this.fertVersion++;
        }
        if (cmd.key === 'biomeContrast') this.fertVersion++;
        if (cmd.key === 'patchLife' && cmd.value <= 0) {
          for (const pt of this.patches) {
            pt.life = 0;
            pt.age = 0;
          }
          this.renderFert();
        }
        if (cmd.key === 'obstacles') {
          if (cmd.value >= 0.5) this.grid.generateObstacles(this.setup.seed);
          else this.grid.obstacles.fill(0);
          for (let i = 0; i < this.pool.n; i++) this.placeClear(i);
          this.fertVersion++;
        }
        this.updateEnvironment();
        break;
      }
      case 'event':
        this.triggerEvent(cmd.spec);
        break;
      case 'addFood':
        this.addFood(cmd.amount, cmd.x, cmd.y, cmd.radius);
        break;
    }
  }

  triggerEvent(spec: EventSpec): void {
    const s = clamp(spec.severity, 0, 1);
    switch (spec.kind) {
      case 'drought':
      case 'bloom':
      case 'coldSnap': {
        const duration = Math.max(1, Math.round(spec.duration ?? 1500));
        this.activeEvents.push({ spec: { ...spec, severity: s, duration }, start: this.tick, end: this.tick + duration });
        this.log('event', `Zdarzenie: ${spec.kind} (siła ${s.toFixed(2)}, ${duration} ticków)`);
        this.updateEnvironment();
        break;
      }
      case 'cull': {
        const killed = this.cull(spec, s);
        this.log('event', `Katastrofa: zginęło ${killed} organizmów (siła ${s.toFixed(2)})`);
        break;
      }
      case 'blight': {
        let removed = 0;
        const food = this.grid.food;
        for (let c = 0; c < food.length; c++) {
          const d = food[c] * s;
          const db = this.grid.foodB[c] * s;
          food[c] -= d;
          this.grid.foodB[c] -= db;
          removed += db;
          removed += d;
        }
        this.ledger.outEvent += removed;
        this.log('event', `Zaraza zasobów: usunięto ${removed.toFixed(0)} energii (siła ${s.toFixed(2)})`);
        break;
      }
    }
  }

  private cull(spec: EventSpec, s: number): number {
    const p = this.pool;
    const region = spec.radius !== undefined && spec.x !== undefined && spec.y !== undefined;
    const dead: number[] = [];
    const causes: number[] = [];
    for (let i = 0; i < p.n; i++) {
      if (region) {
        const dx = p.x[i] - spec.x!;
        const dy = p.y[i] - spec.y!;
        if (dx * dx + dy * dy > spec.radius! * spec.radius!) continue;
      }
      if (this.rng.float() < s) {
        dead.push(i);
        causes.push(CAUSE_CULL);
      }
    }
    this.removeOrganisms(dead, causes);
    return dead.length;
  }

  /** Dosypuje energię do gleby (ręczna interwencja — księgowana jako wpływ `inManual`). */
  addFood(amount: number, x?: number, y?: number, radius?: number): void {
    const g = this.grid;
    const cells: number[] = [];
    if (x !== undefined && y !== undefined && radius !== undefined) {
      for (let gy = 0; gy < g.ny; gy++)
        for (let gx = 0; gx < g.nx; gx++) {
          const dx = (gx + 0.5) * g.cell - x;
          const dy = (gy + 0.5) * g.cell - y;
          if (dx * dx + dy * dy <= radius * radius) cells.push(gy * g.nx + gx);
        }
    } else for (let c = 0; c < g.cells; c++) cells.push(c);
    if (!cells.length || amount <= 0) return;
    const each = amount / cells.length;
    for (const c of cells) g.food[c] += each;
    this.ledger.inManual += amount;
    this.log('event', `Dosypano zasobów: ${amount.toFixed(0)} energii (${cells.length} komórek)`);
  }

  // ——— główny krok ———

  run(ticks: number): void {
    for (let k = 0; k < ticks && this.status === 'running'; k++) this.step();
  }

  step(): void {
    if (this.status !== 'running') return;
    const { setup, grid, pool: p, params: P } = this;

    while (this.schedIdx < setup.schedule.length && setup.schedule[this.schedIdx].tick <= this.tick) {
      this.triggerEvent(setup.schedule[this.schedIdx].spec);
      this.schedIdx++;
    }
    this.updateEnvironment();
    if (this.patches.length && stepPatches(this.patches, setup, P.patchDrift, P.patchLife, this.envRng) && this.tick % 20 === 0) this.renderFert();
    this.regrow();

    const n0 = p.n;
    this.spatial.build(p.x, p.y, n0);

    // ——— 3. percepcja, decyzja i pamięć ———
    const out = this.out;
    const turnBuf = this.outTurn;
    const eatBuf = this.outEatBuf;
    const atkBuf = this.atkBuf;
    for (let i = 0; i < n0; i++) {
      this.startEnergy[i] = p.energy[i];
      this.perceive(i);
      p.observedTicks[i]++;
      if (this.inp[6] > 0) p.neighborTicks[i]++;
      if (this.threatFlag[i]) p.threatExposure[i]++;
      p.signalReceived[i] += Math.abs(this.inp[IN_SIGNAL]);
      p.sumAbsW[i] = think(p.genomes, i * GENOME_LEN, this.inp, this.hid, out, p.somaticWeights);
      this.signalBuf[i] = P.communication >= 0.5 ? out[OUT_SIGNAL] : 0;
      this.cultivationBuf[i] = P.nicheRate > 0 ? (out[OUT_CULTIVATE] + 1) * 0.5 * p.nicheInvestment[i] : 0;
      if (P.plasticityRate > 0) this.traceLearning(i);
      turnBuf[i * 2] = out[OUT_TURN];
      turnBuf[i * 2 + 1] = (out[OUT_THRUST] + 1) * 0.5; // ciąg 0..1
      eatBuf[i] = (out[OUT_EAT] + 1) * 0.5; // wysiłek jedzenia 0..1
      atkBuf[i] = (out[OUT_ATTACK] + 1) * 0.5; // wysiłek ataku 0..1
      // pamięć: wygładzone wyjścia wracają na wejścia w następnym ticku
      const lam = p.memDecay[i];
      const mo = i * N_MEM;
      for (let k = 0; k < N_MEM; k++) p.mem[mo + k] = lam * p.mem[mo + k] + (1 - lam) * out[OUT_MEM + k];
    }

    // ——— 4. ruch i koszty ———
    const L = this.ledger;
    const demand = this.demand;
    demand.fill(0);
    this.demandB.fill(0);
    const W = setup.width;
    const H = setup.height;
    const cs = grid.cell;
    const contestK = Math.max(0, Math.min(3, Math.round(P.contestPower)));
    const predOn = P.predationPower > 0;
    let cBasal = 0, cMove = 0, cSense = 0, cUpkeep = 0, cEat = 0, cAtk = 0, cSignal = 0, cLearning = 0, cCultivation = 0;
    for (let i = 0; i < n0; i++) {
      const turn = turnBuf[i * 2];
      const thrust = turnBuf[i * 2 + 1];
      const effort = eatBuf[i];
      const th = turn * PHYSIO.maxTurn;
      const c = cosSmall(th);
      const s = sinSmall(th);
      let hx = p.hx[i] * c - p.hy[i] * s;
      let hy = p.hx[i] * s + p.hy[i] * c;
      const inv = 1 / Math.sqrt(hx * hx + hy * hy);
      hx *= inv;
      hy *= inv;
      const hf = 0.5 + 0.5 * p.health[i];
      const speed = thrust * p.maxSpeed[i] * hf;
      let x = p.x[i] + hx * speed;
      let y = p.y[i] + hy * speed;
      const r = p.radius[i];
      if (x < r) { x = r; hx = Math.abs(hx); } else if (x > W - r) { x = W - r; hx = -Math.abs(hx); }
      if (y < r) { y = r; hy = Math.abs(hy); } else if (y > H - r) { y = H - r; hy = -Math.abs(hy); }
      const oldX = p.x[i], oldY = p.y[i];
      if (P.obstacles >= 0.5 && (grid.blocked(x, y, r) || !grid.visible(oldX, oldY, x, y))) {
        if (!grid.blocked(x, oldY, r) && grid.visible(oldX, oldY, x, oldY)) { y = oldY; hy = -hy; }
        else if (!grid.blocked(oldX, y, r) && grid.visible(oldX, oldY, oldX, y)) { x = oldX; hx = -hx; }
        else { x = oldX; y = oldY; hx = -hx; hy = -hy; }
      }
      const movedX = x - oldX, movedY = y - oldY;
      p.distance[i] += Math.sqrt(movedX * movedX + movedY * movedY);
      if (this.threatFlag[i] && movedX * this.threatX[i] + movedY * this.threatY[i] < 0) p.threatEscape[i]++;
      p.x[i] = x;
      p.y[i] = y;
      this.recordBiomeMovement(i, grid.cellAt(oldX, oldY), grid.cellAt(x, y));
      p.hx[i] = hx;
      p.hy[i] = hy;

      // zimno: obciążenie = deficyt temperatury ponad tolerancję genetyczną
      let coldLoad = Math.max(0, 1 - this.localTemperature(grid.cellAt(x, y))) - PHYSIO.coldTolSpan * p.coldTol[i];
      if (coldLoad < 0) coldLoad = 0;
      const m075 = p.m075[i];
      const R = p.senseRange[i];
      const basal = P.basalCoef * m075 * (1 + P.coldMetabK * coldLoad);
      const sense = P.senseCoef * R * R + P.brainCoef * p.sumAbsW[i];
      const upkeep = P.coldUpkeepCoef * p.coldTol[i] * m075;
      const move = P.moveCoef * m075 * speed * speed + P.turnCoef * m075 * Math.abs(turn);
      const eat = P.eatCoef * effort * p.biteCap[i];
      // wysiłek ataku kosztuje tylko organizmy zdolne do ataku (dieta ≥ próg)
      const canAttack = predOn && p.diet[i] >= PHYSIO.dietAttackMin;
      const atk = canAttack ? P.attackCoef * atkBuf[i] * m075 : 0;
      if (!canAttack) atkBuf[i] = 0;
      const signal = P.signalCoef * Math.abs(this.signalBuf[i]) * m075;
      const learning = P.plasticityRate > 0 ? P.learnCoef * p.plasticity[i] * m075 : 0;
      const cultivation = P.cultivationCoef * this.cultivationBuf[i] * m075;
      const total = basal + sense + upkeep + move + eat + atk + signal + learning + cultivation;
      let e = p.energy[i];
      if (total >= e) {
        this.starved[i] = 1;
        const f = total > 0 ? e / total : 0;
        cBasal += basal * f; cSense += sense * f; cUpkeep += upkeep * f; cMove += move * f; cEat += eat * f; cAtk += atk * f; cSignal += signal * f; cLearning += learning * f; cCultivation += cultivation * f;
        this.signalBuf[i] *= f; this.cultivationBuf[i] *= f;
        e = 0;
      } else {
        this.starved[i] = 0;
        cBasal += basal; cSense += sense; cUpkeep += upkeep; cMove += move; cEat += eat; cAtk += atk; cSignal += signal; cLearning += learning; cCultivation += cultivation;
        e -= total;
      }
      p.energy[i] = e;
      p.signal[i] = this.signalBuf[i];
      p.signalEmitted[i] += Math.abs(p.signal[i]);
      if (coldLoad > 0) p.health[i] -= P.coldDamage * coldLoad * coldLoad;

      // zamiar jedzenia: nie więcej niż zmieści się w zbiorniku energii
      const maxE = p.maxE[i];
      let want = effort * p.biteCap[i] * hf;
      // Each source receives its own bounded demand; both share one bite and storage budget.
      let cx = (x / cs) | 0;
      let cy = (y / cs) | 0;
      if (cx >= grid.nx) cx = grid.nx - 1;
      if (cy >= grid.ny) cy = grid.ny - 1;
      const cell = cy * grid.nx + cx;
      this.cellOf[i] = cell;
      const spec = p.plantSpecialization[i];
      const fa = grid.food[cell] * (1 - 0.8 * spec);
      const fb = grid.foodB[cell] * (0.2 + 0.8 * spec);
      const shareB = fb > 0 ? fb / (fa + fb) : 0;
      const assimA = this.plantAssim(i, false), assimB = this.plantAssim(i, true);
      const efficiency = (1 - shareB) * assimA + shareB * assimB;
      const room = (maxE - e) / efficiency;
      if (want > room) want = room;
      this.desire[i] = want * (1 - shareB);
      this.desireB[i] = want * shareB;
      let wgt = 1;
      for (let j = 0; j < contestK; j++) wgt *= r * 0.25;
      demand[cell] += this.desire[i] * wgt;
      this.demandB[cell] += this.desireB[i] * wgt;
      this.cultivate(i, cell);
      this.recordLocation(i, cell);
    }
    L.outBasal += cBasal; L.outMove += cMove; L.outSense += cSense; L.outUpkeep += cUpkeep; L.outEat += cEat; L.outAttack += cAtk; L.outSignal += cSignal; L.outLearning += cLearning; L.outCultivation += cCultivation;

    // ——— 5. żerowanie (sprawiedliwy, proporcjonalny podział zasobu komórki) ———
    let digestLoss = 0;
    for (let i = 0; i < n0; i++) {
      let consumed = 0;
      for (let source = 0; source < 2; source++) {
        const isB = source === 1;
        const d = isB ? this.desireB[i] : this.desire[i];
        if (!(d > 0)) continue;
        const c = this.cellOf[i];
        const food = isB ? grid.foodB : grid.food;
        const demands = isB ? this.demandB : demand;
        const f = food[c];
        let wgt = 1;
        for (let j = 0; j < contestK; j++) wgt *= p.radius[i] * 0.25;
        const dw = d * wgt, D = demands[c];
        let eaten = D > 1e-12 ? (dw * f) / D : d;
        eaten = Math.max(0, Math.min(d, f, eaten));
        food[c] = f - eaten;
        demands[c] = D > dw ? D - dw : 0;
        const gain = eaten * this.plantAssim(i, isB);
        p.energy[i] += gain;
        p.foodEnergy[i] += gain;
        consumed += eaten;
        digestLoss += eaten - gain;
        if (isB) {
          p.foodBConsumed[i] += eaten;
          p.health[i] -= P.plantBToxicity * eaten * (1 - p.plantSpecialization[i]) / p.m075[i];
          if (eaten > 0 && p.seedLoad[i] < 1) {
            if (p.seedLoad[i] === 0) p.seedSource[i] = c;
            p.seedLoad[i] = Math.min(1, p.seedLoad[i] + eaten * 0.02);
          }
        } else p.foodAConsumed[i] += eaten;
      }
      if (consumed > 1e-9) p.feedingTicks[i]++;
    }
    L.outDigest += digestLoss;

    // ——— 5b. drapieżnictwo ———
    this.hunted.fill(0, 0, n0);
    this.spatial.build(p.x, p.y, n0); // pozycje po ruchu (potrzebne też do szukania partnera)
    if (predOn) this.predation(n0);
    if (P.plasticityRate > 0) for (let i = 0; i < n0; i++) this.learn(i);
    for (let i = 0; i < n0; i++) this.recordTrail(i);

    // ——— 6a. starzenie i śmierć ———
    const tick = this.tick;
    const dead = this.deadList;
    const causes = this.deadCause;
    dead.length = 0;
    causes.length = 0;
    const dying = this.dying;
    for (let i = 0; i < n0; i++) {
      p.age[i]++;
      const me = p.maxE[i];
      const e = p.energy[i];
      // senescencja obniża pułap zdrowia po 60% długości życia
      const ratio = p.age[i] / p.maxAge[i];
      const ceil = ratio > 0.6 ? 1 - Math.min(1, (ratio - 0.6) / 0.4) * 0.7 : 1;
      let h = p.health[i];
      if (h > ceil) h = ceil;
      else if (e > 0.5 * me) h = Math.min(ceil, h + 0.002);
      p.health[i] = h;

      let cause = -1;
      if (e <= 0 || this.starved[i] === 1) cause = this.hunted[i] === 1 ? CAUSE_PREDATION : CAUSE_STARVE;
      else if (h <= 0) cause = CAUSE_HEALTH;
      else if (p.age[i] >= p.maxAge[i]) cause = CAUSE_AGE;
      else if (P.accidentRate > 0 && this.rng.float() < P.accidentRate) cause = CAUSE_ACCIDENT;
      if (cause >= 0) {
        dead.push(i);
        causes.push(cause);
        dying[i] = 1;
      } else dying[i] = 0;
    }

    // ——— 6b. reprodukcja ———
    const maxPop = Math.min(P.maxPopulation, p.capacity);
    const sexual = P.sexual >= 0.5;
    if (sexual) this.mated.fill(0, 0, n0);
    for (let i = 0; i < n0; i++) {
      if (dying[i] === 1 || (sexual && this.mated[i] === 1)) continue;
      if (p.n >= maxPop || p.age[i] < p.maturity[i] || tick - p.lastRepro[i] < PHYSIO.reproCooldown) continue;
      const me = p.maxE[i];
      const e = p.energy[i];
      const invest = p.investFrac[i] * me;
      if (!sexual) {
        const cost = invest * (1 + P.reproOverhead);
        const need = Math.max(p.reproThresh[i] * me, cost + PHYSIO.reproReserve * me);
        if (e >= need) this.spawnChild(i, invest, cost);
      } else {
        const need = Math.max(p.reproThresh[i] * me, 0.5 * invest * (1 + P.reproOverhead) + PHYSIO.reproReserve * me);
        if (e < need) continue;
        const j = this.findMate(i);
        if (j >= 0) this.spawnSexual(i, j);
      }
    }

    // ——— 7. porządki ———
    this.removeOrganisms(dead, causes);
    this.tick++;
    if (this.tick >= this.nextSampleTick) {
      this.sample();
      this.nextSampleTick = this.tick + this.stats.interval;
    }
    if (this.tick % 1000 === 0) this.lineage.prune(this.tick, this.lineageRetention, this.lineageMaxRecords);
    if (p.n === 0) {
      this.status = 'extinct';
      this.log('extinction', `WYMARCIE populacji w ticku ${this.tick}`);
      if (this.tick !== this.lastSampleTick) this.sample();
    }
  }

  /**
   * Drapieżnictwo: organizm zdolny do ataku (dieta ≥ próg) odbiera energię najbliższej istocie w kontakcie.
   * Podział jest dwufazowy (zamiar → proporcjonalna realizacja), więc kolejność indeksów nie faworyzuje nikogo.
   * Transfer: ofiara traci `take`, napastnik zyskuje `take · sprawność mięsa`, reszta jest ciepłem.
   */
  private predation(n0: number): void {
    const p = this.pool;
    const P = this.params;
    const sp = this.spatial;
    const target = this.atkTarget;
    const demand = this.atkDemand;
    const drain = this.drain;
    const pad = PHYSIO.contactPad;
    drain.fill(0, 0, n0);
    let any = false;
    for (let i = 0; i < n0; i++) {
      target[i] = -1;
      const diet = p.diet[i];
      const eff = this.atkBuf[i];
      if (diet < PHYSIO.dietAttackMin || eff < 0.05) continue;
      p.attacks[i]++;
      const ri = p.radius[i];
      const x = p.x[i];
      const y = p.y[i];
      const reach = ri + 6 + pad;
      const sx0 = Math.max(0, ((x - reach) / sp.cell) | 0);
      const sx1 = Math.min(sp.nx - 1, ((x + reach) / sp.cell) | 0);
      const sy0 = Math.max(0, ((y - reach) / sp.cell) | 0);
      const sy1 = Math.min(sp.ny - 1, ((y + reach) / sp.cell) | 0);
      let best = -1;
      let bestD = Infinity;
      for (let sy = sy0; sy <= sy1; sy++)
        for (let sx = sx0; sx <= sx1; sx++) {
          const c = sy * sp.nx + sx;
          for (let q = sp.start[c]; q < sp.start[c + 1]; q++) {
            const j = sp.items[q];
            if (j === i) continue;
            const dx = p.x[j] - x;
            const dy = p.y[j] - y;
            const d2 = dx * dx + dy * dy;
            const lim = ri + p.radius[j] + pad;
            if (d2 <= lim * lim && d2 < bestD && (P.obstacles < 0.5 || this.grid.visible(x, y, p.x[j], p.y[j]))) {
              bestD = d2;
              best = j;
            }
          }
        }
      if (best < 0) continue;
      const rj = p.radius[best];
      const power = eff * P.predationPower * diet * p.m075[i] * ((2 * ri) / (ri + rj));
      const meatEff = PHYSIO.meatAssimMax * diet;
      const room = (p.maxE[i] - p.energy[i]) / meatEff;
      const dem = power < room ? power : room;
      if (!(dem > 0)) continue;
      target[i] = best;
      demand[i] = dem;
      drain[best] += dem;
      any = true;
    }
    if (!any) return;

    const ratio = this.predRatio;
    const taken = this.predTaken;
    const gain = this.predGain;
    taken.fill(0, 0, n0);
    gain.fill(0, 0, n0);
    for (let j = 0; j < n0; j++) {
      if (drain[j] > 0) {
        const E = p.energy[j];
        ratio[j] = E >= drain[j] ? 1 : E / drain[j];
      }
    }
    let heat = 0;
    let moved = 0;
    for (let i = 0; i < n0; i++) {
      const j = target[i];
      if (j < 0) continue;
      const take = demand[i] * ratio[j];
      if (take <= 0) continue;
      const g = take * PHYSIO.meatAssimMax * p.diet[i];
      taken[j] += take;
      gain[i] += g;
      p.successfulAttacks[i]++;
      p.meatEnergy[i] += g;
      heat += take - g;
      moved += take;
    }
    for (let k = 0; k < n0; k++) {
      if (taken[k] === 0 && gain[k] === 0) continue;
      const before = p.energy[k];
      let after = before - taken[k] + gain[k];
      if (after < 0) after = 0;
      p.energy[k] = after;
      if (taken[k] > 0 && before - taken[k] <= 1e-9) this.hunted[k] = 1;
    }
    this.ledger.outDigest += heat;
    this.acc.predEnergy += moved;
  }

  /** Najbliższy gotowy do rozrodu partner w zasięgu (rozmnażanie płciowe); −1, gdy brak. */
  private findMate(i: number): number {
    const p = this.pool;
    const P = this.params;
    const sp = this.spatial;
    const tick = this.tick;
    const ri = p.radius[i];
    const x = p.x[i];
    const y = p.y[i];
    const reach = ri + 6 + P.mateRange;
    const sx0 = Math.max(0, ((x - reach) / sp.cell) | 0);
    const sx1 = Math.min(sp.nx - 1, ((x + reach) / sp.cell) | 0);
    const sy0 = Math.max(0, ((y - reach) / sp.cell) | 0);
    const sy1 = Math.min(sp.ny - 1, ((y + reach) / sp.cell) | 0);
    let best = -1;
    let bestD = Infinity;
    for (let sy = sy0; sy <= sy1; sy++)
      for (let sx = sx0; sx <= sx1; sx++) {
        const c = sy * sp.nx + sx;
        for (let q = sp.start[c]; q < sp.start[c + 1]; q++) {
          const j = sp.items[q];
          if (j === i || this.dying[j] === 1 || this.mated[j] === 1) continue;
          if (p.age[j] < p.maturity[j] || tick - p.lastRepro[j] < PHYSIO.reproCooldown) continue;
          const dx = p.x[j] - x;
          const dy = p.y[j] - y;
          const d2 = dx * dx + dy * dy;
          const lim = ri + p.radius[j] + P.mateRange;
          if (d2 > lim * lim || d2 >= bestD) continue;
          const mj = p.maxE[j];
          const costJ = 0.5 * p.investFrac[j] * mj * (1 + P.reproOverhead);
          if (p.energy[j] < Math.max(p.reproThresh[j] * mj, costJ + PHYSIO.reproReserve * mj)) continue;
          if (P.obstacles >= 0.5 && !this.grid.visible(x, y, p.x[j], p.y[j])) continue;
          p.mateAttempts[i]++;
          if (!this.mateCompatibility(i, j)) {
            p.mateRejected[i]++;
            if (this.mateGroup(i) === this.mateGroup(j)) this.mating.rejectedWithin++;
            else this.mating.rejectedBetween++;
            continue;
          }
          bestD = d2;
          best = j;
        }
      }
    return best;
  }

  /** Total energetic carrying capacity; the niche layer survives moving fertility patches. */
  foodCapacity(cell: number): number {
    if (this.params.obstacles >= 0.5 && this.grid.obstacles[cell]) return 0;
    const mult = this.params.biomes >= 0.5 ? 1 + clamp(this.params.biomeContrast, 0, 1) * (this.grid.biomeFertility[cell] - 1) : 1;
    return this.params.foodCapMax * Math.min(2, this.grid.fert[cell] * mult + this.grid.niche[cell]);
  }

  foodBPartition(cell: number): number {
    const habitat = ((Math.imul(cell + 1, 1664525) + this.setup.seed) >>> 0) % 4 === 0 ? 1 : 0.15;
    const mult = this.params.biomes >= 0.5 ? 1 + clamp(this.params.biomeContrast, 0, 1) * (this.grid.biomeFoodB[cell] - 1) : 1;
    return clamp(this.params.plantBShare * habitat * mult, 0, 0.95);
  }

  /** Includes local season response and global cold events without double applying the season. */
  localTemperature(cell: number): number {
    if (this.params.biomes < 0.5 || this.params.biomeContrast <= 0) return this.temperature;
    const contrast = clamp(this.params.biomeContrast, 0, 1);
    const seasonal = this.params.seasonPeriod > 0 ? 1 - triangleWave(this.environmentTick, this.params.seasonPeriod) : 0;
    // temperature is clipped globally; reconstruct the unclipped event baseline for local clipping.
    let global = this.params.baseTemperature;
    for (const ev of this.activeEvents) if (ev.spec.kind === 'coldSnap') {
      const ramp = Math.max(1, Math.min(50, (ev.end - ev.start) / 4));
      global -= 0.8 * ev.spec.severity * Math.min(1, (this.environmentTick - ev.start + 1) / ramp, (ev.end - this.environmentTick) / ramp);
    }
    const season = 1 + contrast * (this.grid.biomeSeason[cell] - 1);
    return clamp(global + contrast * this.grid.biomeTemperature[cell] - this.params.seasonTempAmp * seasonal * season, 0, 1.2);
  }

  private localGrowth(cell: number): number {
    if (this.params.biomes < 0.5 || this.params.biomeContrast <= 0 || this.params.seasonPeriod <= 0) return this.growthMult;
    const seasonal = 1 - triangleWave(this.environmentTick, this.params.seasonPeriod);
    const globalSeason = 1 - this.params.seasonGrowthAmp * seasonal;
    const localSeason = 1 - this.params.seasonGrowthAmp * seasonal * (1 + clamp(this.params.biomeContrast, 0, 1) * (this.grid.biomeSeason[cell] - 1));
    // Reconstruct event multiplier even at a fully dormant global season (globalSeason = 0).
    let events = 1;
    for (const ev of this.activeEvents) {
      const ramp = Math.max(1, Math.min(50, (ev.end - ev.start) / 4));
      const f = Math.min(1, (this.environmentTick - ev.start + 1) / ramp, (ev.end - this.environmentTick) / ramp);
      if (ev.spec.kind === 'drought') events *= 1 - ev.spec.severity * f;
      if (ev.spec.kind === 'bloom') events *= 1 + 4 * ev.spec.severity * f;
    }
    return Math.max(0, localSeason) * (globalSeason > 0 ? this.growthMult / globalSeason : events);
  }

  localEnvironment(cell: number): LocalEnvironment {
    if (!Number.isInteger(cell) || cell < 0 || cell >= this.grid.cells) throw new Error('Nieprawidłowa komórka środowiska');
    const mult = this.params.biomes >= 0.5 ? 1 + clamp(this.params.biomeContrast, 0, 1) * (this.grid.biomeFertility[cell] - 1) : 1;
    return { biome: this.grid.biome[cell], temperature: this.localTemperature(cell), growthMult: this.localGrowth(cell), fertility: Math.min(2, this.grid.fert[cell] * mult + this.grid.niche[cell]), foodBShare: this.foodBPartition(cell) };
  }

  biomeSnapshot(): BiomeSnapshot {
    const biomes: BiomeSnapshot['biomes'] = BIOME_LABELS.map((label, id) => ({ id, label, cells: 0, population: 0, foodA: 0, foodB: 0, meanTemperature: 0, births: this.biomeCounters.births[id], deaths: this.biomeCounters.deaths[id], entries: 0, exits: 0 }));
    for (let c = 0; c < this.grid.cells; c++) {
      const b = biomes[this.grid.biome[c]]; b.cells++; b.foodA += this.grid.food[c]; b.foodB += this.grid.foodB[c]; b.meanTemperature += this.localTemperature(c);
    }
    for (let i = 0; i < this.pool.n; i++) biomes[this.grid.biome[this.grid.cellAt(this.pool.x[i], this.pool.y[i])]].population++;
    const migrations = biomes.map((_, a) => biomes.map((_, dest) => this.biomeCounters.migrations[a * 3 + dest]));
    for (let a = 0; a < 3; a++) {
      biomes[a].meanTemperature /= Math.max(1, biomes[a].cells);
      for (let b = 0; b < 3; b++) { biomes[a].exits += migrations[a][b]; biomes[a].entries += migrations[b][a]; }
    }
    return { enabled: this.params.biomes >= 0.5, contrast: this.params.biomeContrast, biomes, migrations };
  }

  private recordBiomeMovement(i: number, fromCell: number, toCell: number): void {
    const p = this.pool;
    if (this.params.biomes < 0.5) { p.currentBiome[i] = 255; return; }
    const from = this.grid.biome[fromCell], to = this.grid.biome[toCell];
    if (from !== to) { this.biomeCounters.migrations[from * 3 + to]++; p.biomeTransitions[i]++; }
    p.currentBiome[i] = to;
  }

  private plantAssim(i: number, isB: boolean): number {
    const p = this.pool;
    return isB ? p.assimB[i] : p.assim[i] * (this.params.plantBShare > 0 ? 1 - 0.7 * p.plantSpecialization[i] : 1);
  }

  private placeClear(i: number, clearance = this.pool.radius[i]): void {
    const p = this.pool, r = clearance, grid = this.grid;
    p.x[i] = clamp(p.x[i], r, this.setup.width - r);
    p.y[i] = clamp(p.y[i], r, this.setup.height - r);
    if (this.params.obstacles < 0.5 || !grid.blocked(p.x[i], p.y[i], r)) return;
    let best = -1, distance = Infinity;
    for (let c = 0; c < grid.cells; c++) {
      const x = (c % grid.nx + 0.5) * grid.cell, y = (Math.floor(c / grid.nx) + 0.5) * grid.cell;
      if (x < r || y < r || x > this.setup.width - r || y > this.setup.height - r || grid.blocked(x, y, r)) continue;
      const dx = p.x[i] - x, dy = p.y[i] - y, d = dx * dx + dy * dy;
      if (d < distance) { distance = d; best = c; }
    }
    if (best >= 0) { p.x[i] = (best % grid.nx + 0.5) * grid.cell; p.y[i] = (Math.floor(best / grid.nx) + 0.5) * grid.cell; }
  }

  private inView(x: number, y: number, hx: number, hy: number, tx: number, ty: number): boolean {
    const dx = tx - x, dy = ty - y, d2 = dx * dx + dy * dy;
    if (d2 > 1e-9 && (dx * hx + dy * hy) / Math.sqrt(d2) < this.params.viewCos) return false;
    return this.params.obstacles < 0.5 || this.grid.visible(x, y, tx, ty);
  }

  /** Coarse ecological groups for measured mating flows, not declared species. */
  mateGroup(i: number): 0 | 1 { return this.pool.plantSpecialization[i] < 0.5 ? 0 : 1; }

  mateCompatibility(a: number, b: number): boolean {
    const p = this.pool;
    if (a < 0 || b < 0 || a >= p.n || b >= p.n || a === b) return false;
    if (this.params.mateChoice < 0.5) return true;
    const phenotypeA = 0.7 * p.plantSpecialization[a] + 0.3 * p.diet[a];
    const phenotypeB = 0.7 * p.plantSpecialization[b] + 0.3 * p.diet[b];
    const toleranceA = 1 - 0.95 * p.mateSelectivity[a];
    const toleranceB = 1 - 0.95 * p.mateSelectivity[b];
    return Math.abs(phenotypeB - p.matePreference[a]) <= toleranceA && Math.abs(phenotypeA - p.matePreference[b]) <= toleranceB;
  }

  private traceLearning(i: number): void {
    const p = this.pool, off = i * GENOME_LEN, trace = p.eligibility;
    for (let h = 0; h < N_HID; h++) {
      for (let j = 0; j < N_IN; j++) {
        const k = off + W1_OFF + h * N_IN + j;
        trace[k] = 0.9 * trace[k] + 0.1 * this.inp[j] * this.hid[h];
      }
      const bias = off + B1_OFF + h;
      trace[bias] = 0.9 * trace[bias] + 0.1 * this.hid[h];
    }
    for (let o = 0; o < N_OUT; o++) {
      for (let h = 0; h < N_HID; h++) {
        const k = off + W2_OFF + o * N_HID + h;
        trace[k] = 0.9 * trace[k] + 0.1 * this.hid[h] * this.out[o];
      }
      const bias = off + B2_OFF + o;
      trace[bias] = 0.9 * trace[bias] + 0.1 * this.out[o];
    }
  }

  private learn(i: number): void {
    const p = this.pool, off = i * GENOME_LEN;
    // Reward is net energetic gain before paying reproduction costs.
    const reward = clamp((p.energy[i] - this.startEnergy[i]) * 10 / p.maxE[i], -1, 1);
    const rate = this.params.plasticityRate * p.plasticity[i] * reward;
    for (let g = W1_OFF; g < GENOME_LEN; g++) {
      const k = off + g, inherited = p.genomes[k];
      const effective = clamp(inherited + p.somaticWeights[k] + rate * p.eligibility[k], -MAX_WEIGHT, MAX_WEIGHT);
      p.somaticWeights[k] = effective - inherited;
    }
    let magnitude = 0;
    for (let g = W1_OFF; g < GENOME_LEN; g++) magnitude += Math.abs(p.genomes[off + g] + p.somaticWeights[off + g]);
    p.sumAbsW[i] = magnitude;
  }

  private cultivate(i: number, cell: number): void {
    const p = this.pool, grid = this.grid, effort = this.cultivationBuf[i];
    if (!(effort > 0) || this.starved[i]) return;
    // The investment is paid even at saturation. Fertility is capacity, not energy.
    const investment = this.params.cultivationCoef * effort * p.m075[i];
    p.cultivated[i] += investment;
    grid.niche[cell] = Math.min(1, grid.niche[cell] + this.params.nicheRate * investment * 0.01);
    if (p.seedLoad[i] > 0 && p.seedSource[i] !== cell) {
      const deposited = p.seedLoad[i] * Math.min(1, effort * 0.1);
      grid.seedBank[cell] = Math.min(4, grid.seedBank[cell] + deposited);
      p.seedLoad[i] -= deposited;
      p.seedsMoved[i] += deposited;
      if (p.seedLoad[i] < 1e-6) { p.seedLoad[i] = 0; p.seedSource[i] = -1; }
    }
    if (this.tick % 20 === 0) this.fertVersion++;
  }

  private recordLocation(i: number, cell: number): void {
    const p = this.pool;
    if (p.lastCell[i] === cell) return;
    const off = i * TRAIL_LEN;
    let seen = false;
    for (let k = 0; k < p.visitedCount[i]; k++) if (p.visitedCells[off + k] === cell) { seen = true; break; }
    if (seen) p.revisits[i]++;
    else {
      p.visitedCells[off + p.visitedCursor[i]] = cell;
      p.visitedCursor[i] = (p.visitedCursor[i] + 1) % TRAIL_LEN;
      p.visitedCount[i] = Math.min(TRAIL_LEN, p.visitedCount[i] + 1);
    }
    p.lastCell[i] = cell;
  }

  private recordTrail(i: number): void {
    if (this.tick % 10 !== 0 && this.pool.trailCount[i] > 0) return;
    const p = this.pool, k = i * TRAIL_LEN + p.trailCursor[i];
    p.trailTick[k] = this.tick + 1; p.trailX[k] = p.x[i]; p.trailY[k] = p.y[i]; p.trailEnergy[k] = p.energy[i];
    p.trailCursor[i] = (p.trailCursor[i] + 1) % TRAIL_LEN;
    p.trailCount[i] = Math.min(TRAIL_LEN, p.trailCount[i] + 1);
  }

  observe(id: number): ObservedBehavior | null {
    const p = this.pool, i = p.indexOfId(id);
    if (i < 0) return null;
    const trail: ObservedBehavior['trail'] = [];
    const first = p.trailCount[i] === TRAIL_LEN ? p.trailCursor[i] : 0;
    for (let j = 0; j < p.trailCount[i]; j++) {
      const k = i * TRAIL_LEN + (first + j) % TRAIL_LEN;
      trail.push({ tick: p.trailTick[k], x: p.trailX[k], y: p.trailY[k], energy: p.trailEnergy[k] });
    }
    return {
      biomeTransitions: p.biomeTransitions[i],
      observedTicks: p.observedTicks[i], distance: p.distance[i], feedingTicks: p.feedingTicks[i], foodEnergy: p.foodEnergy[i],
      foodAConsumed: p.foodAConsumed[i], foodBConsumed: p.foodBConsumed[i], meatEnergy: p.meatEnergy[i], attacks: p.attacks[i], successfulAttacks: p.successfulAttacks[i],
      revisits: p.revisits[i], threatExposure: p.threatExposure[i], threatEscape: p.threatEscape[i], neighborTicks: p.neighborTicks[i],
      signalEmitted: p.signalEmitted[i], signalReceived: p.signalReceived[i], cultivated: p.cultivated[i], seedsMoved: p.seedsMoved[i],
      mateAttempts: p.mateAttempts[i], mateRejected: p.mateRejected[i], sexualBirths: p.sexualBirths[i], crossGroupBirths: p.crossGroupBirths[i], trail,
    };
  }

  /** Controlled common-garden start: preserve environment and tick, reset organisms,
   * germline genealogy, runtime learning, history statistics and trial ledger/RNG. */
  seedPopulation(genomes: readonly Float32Array[], energyFraction = 0.6, seed = this.setup.seed): void {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Nieprawidłowy seed próby');
    if (!genomes.length || genomes.length > this.pool.capacity) throw new Error('Nieprawidłowa liczba okazów');
    if (!Number.isFinite(energyFraction) || energyFraction <= 0 || energyFraction > 1) throw new Error('Energia początkowa musi być w (0,1]');
    for (const genome of genomes) {
      if (genome.length !== GENOME_LEN) throw new Error('Nieprawidłowy układ genomu');
      for (let g = 0; g < GENOME_LEN; g++) if (!Number.isFinite(genome[g]) || (g < N_TRAITS ? genome[g] < 0 || genome[g] > 1 : Math.abs(genome[g]) > MAX_WEIGHT)) throw new Error('Nieprawidłowa wartość genu');
    }
    const p = this.pool;
    this.lineage = new LineageStore(); this.stats = new StatsHistory(); this.pinnedNode = -1;
    this.rng = new Rng(seed, 0); this.nextId = 1; p.n = genomes.length;
    this.mating = { within: 0, between: 0, rejectedWithin: 0, rejectedBetween: 0 };
    this.biomeCounters = newBiomeCounters();
    this.acc = { births: 0, predEnergy: 0, deaths: new Array<number>(N_CAUSES).fill(0), inMark: 0, outMark: 0 };
    for (let i = 0; i < p.n; i++) {
      p.genomes.set(genomes[i], i * GENOME_LEN); p.resetRuntime(i);
      this.derivePhysiology(i); p.id[i] = this.nextId++;
      // Use maximum body clearance for paired trials: genotype does not change starting coordinates.
      p.x[i] = PHYSIO.radiusMax + this.rng.float() * (this.setup.width - 2 * PHYSIO.radiusMax);
      p.y[i] = PHYSIO.radiusMax + this.rng.float() * (this.setup.height - 2 * PHYSIO.radiusMax);
      this.randomHeading(i, this.rng); this.placeClear(i, PHYSIO.radiusMax);
      p.currentBiome[i] = this.params.biomes >= 0.5 ? this.grid.biome[this.grid.cellAt(p.x[i], p.y[i])] : 255;
      p.energy[i] = energyFraction * p.maxE[i]; p.health[i] = 1; p.age[i] = 0; p.birth[i] = this.tick;
      p.maxAge[i] = Math.floor(this.params.lifespanBase * pow025(p.mass[i]));
      p.generation[i] = 0; p.clade[i] = i; p.lastRepro[i] = this.tick; p.offspring[i] = 0;
      p.lin[i] = this.lineage.add(p.id[i], -1, this.tick, 0, p.genomes, i * GENOME_LEN, null, null, 0);
    }
    this.ledger = newLedger(); const energy = this.totalEnergy(); this.ledger.initial = energy.food + energy.organisms;
    this.status = 'running'; this.cladeLogged = 0; this.prevPop = -1; this.lastSampleTick = this.tick;
    this.nextSampleTick = this.tick + this.stats.interval; this.ablate = null; this.ablateOddOnly = false;
    this.commandLog = []; this.paramHistory = []; this.eventLog = [];
    this.sample(); this.log('trial', `Kontrolowana populacja: ${p.n} okazów`);
  }

  private regrow(): void {
    const P = this.params, grid = this.grid;
    let inn = 0, dec = 0;
    for (let c = 0; c < grid.cells; c++) {
      grid.niche[c] *= 1 - Math.max(0, Math.min(1, P.nicheDecay));
      grid.seedBank[c] *= 0.9999;
      const totalCap = this.foodCapacity(c), shareB = this.foodBPartition(c);
      const rate = P.regrowthRate * this.localGrowth(c);
      for (let source = 0; source < 2; source++) {
        const food = source ? grid.foodB : grid.food;
        const cap = totalCap * (source ? shareB : 1 - shareB);
        const f = food[c];
        if (f < cap && cap > 0) {
          const seed = P.foodSeed + (source ? Math.min(0.3, grid.seedBank[c] * 0.05) : 0);
          const growth = rate * (f + seed * cap) * (1 - f / cap);
          food[c] = f + growth;
          inn += growth;
        } else if (f > cap) {
          const loss = P.foodDecay * (f - cap);
          food[c] = f - loss;
          dec += loss;
        }
      }
    }
    this.ledger.inRegrowth += inn;
    this.ledger.outDecay += dec;
  }

  /** Wypełnia `this.inp` wejściami czuciowymi organizmu `i` (układ egocentryczny). */
  private perceive(i: number): void {
    const p = this.pool;
    const inp = this.inp;
    const g = this.grid;
    const x = p.x[i];
    const y = p.y[i];
    const hx = p.hx[i];
    const hy = p.hy[i];
    const lx = -hy;
    const ly = hx;
    const R = p.senseRange[i];
    const cs = g.cell;

    // pokarm w zasięgu: ważony środek ciężkości kierunków
    const k = ((R + cs) / cs) | 0;
    let cx = (x / cs) | 0;
    let cy = (y / cs) | 0;
    if (cx >= g.nx) cx = g.nx - 1;
    if (cy >= g.ny) cy = g.ny - 1;
    const gx0 = cx - k < 0 ? 0 : cx - k;
    const gx1 = cx + k >= g.nx ? g.nx - 1 : cx + k;
    const gy0 = cy - k < 0 ? 0 : cy - k;
    const gy1 = cy + k >= g.ny ? g.ny - 1 : cy + k;
    const lim = R + cs * 0.5;
    const lim2 = lim * lim;
    const invCs2 = 1 / (cs * cs);
    let wsum = 0;
    let vx = 0;
    let vy = 0;
    let total = 0, bTotal = 0, bSum = 0, bVx = 0, bVy = 0;
    const food = g.food;
    for (let gy = gy0; gy <= gy1; gy++) {
      const dy = (gy + 0.5) * cs - y;
      const row = gy * g.nx;
      for (let gx = gx0; gx <= gx1; gx++) {
        const f = food[row + gx];
        const fB = g.foodB[row + gx];
        if (f < 0.05 && fB < 0.05) continue;
        const dx = (gx + 0.5) * cs - x;
        const d2 = dx * dx + dy * dy;
        if (d2 > lim2 || !this.inView(x, y, hx, hy, (gx + 0.5) * cs, (gy + 0.5) * cs)) continue;
        if (fB > 0) {
          const wb = fB / (1 + d2 * invCs2);
          bTotal += fB; bSum += wb;
          if (d2 > 1e-6) { const invd = 1 / Math.sqrt(d2); bVx += wb * dx * invd; bVy += wb * dy * invd; }
        }
        total += f;
        const w = f / (1 + d2 * invCs2);
        wsum += w;
        if (d2 > 1e-6) {
          const invd = 1 / Math.sqrt(d2);
          vx += w * dx * invd;
          vy += w * dy * invd;
        }
      }
    }
    let foodFwd = 0;
    let foodLat = 0;
    if (wsum > 0) {
      foodFwd = (vx * hx + vy * hy) / wsum;
      foodLat = (vx * lx + vy * ly) / wsum;
    }
    const here = food[cy * g.nx + cx];

    // sąsiedzi (siatka przestrzenna)
    const sp = this.spatial;
    const R2 = R * R;
    const sx0 = Math.max(0, ((x - R) / sp.cell) | 0);
    const sx1 = Math.min(sp.nx - 1, ((x + R) / sp.cell) | 0);
    const sy0 = Math.max(0, ((y - R) / sp.cell) | 0);
    const sy1 = Math.min(sp.ny - 1, ((y + R) / sp.cell) | 0);
    let count = 0;
    let signal = 0, signalWeight = 0, signalX = 0, signalY = 0;
    let threatD = Infinity;
    this.threatFlag[i] = 0;
    let best2 = R2;
    let bdx = 0;
    let bdy = 0;
    let bj = -1;
    for (let sy = sy0; sy <= sy1; sy++)
      for (let sx = sx0; sx <= sx1; sx++) {
        const c = sy * sp.nx + sx;
        for (let q = sp.start[c]; q < sp.start[c + 1]; q++) {
          const j = sp.items[q];
          if (j === i) continue;
          const dx = p.x[j] - x;
          const dy = p.y[j] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > R2) continue;
          // Local acoustic signal can be heard outside the visual cone, but not through a barrier.
          if (this.params.communication >= 0.5 && (this.params.obstacles < 0.5 || g.visible(x, y, p.x[j], p.y[j]))) {
            const sw = 1 - Math.sqrt(d2) / R;
            const sg = p.signal[j] * sw;
            signal += sg; signalWeight += sw;
            if (d2 > 1e-9) { const invd = 1 / Math.sqrt(d2); signalX += sg * dx * invd; signalY += sg * dy * invd; }
          }
          if (!this.inView(x, y, hx, hy, p.x[j], p.y[j])) continue;
          count++;
          if (p.diet[j] >= 0.3 && d2 < threatD) { threatD = d2; this.threatFlag[i] = 1; this.threatX[i] = dx; this.threatY[i] = dy; }
          if (d2 < best2) {
            best2 = d2;
            bdx = dx;
            bdy = dy;
            bj = j;
          }
        }
      }
    let nbF = 0;
    let nbL = 0;
    if (best2 < R2 && best2 > 1e-9) {
      const d = Math.sqrt(best2);
      const close = 1 - d / R;
      nbF = ((bdx * hx + bdy * hy) / d) * close;
      nbL = ((bdx * lx + bdy * ly) / d) * close;
    }

    // ściany: wektor odpychania skierowany do wnętrza
    const wr = PHYSIO.wallRange;
    const W = this.setup.width;
    const H = this.setup.height;
    let px = Math.max(0, 1 - x / wr) - Math.max(0, 1 - (W - x) / wr);
    let py = Math.max(0, 1 - y / wr) - Math.max(0, 1 - (H - y) / wr);
    if (this.params.obstacles >= 0.5) {
      const reach = Math.ceil(wr / cs);
      for (let yy = Math.max(0, cy - reach); yy <= Math.min(g.ny - 1, cy + reach); yy++)
        for (let xx = Math.max(0, cx - reach); xx <= Math.min(g.nx - 1, cx + reach); xx++) {
          if (!g.obstacles[yy * g.nx + xx]) continue;
          const dx = x - clamp(x, xx * cs, (xx + 1) * cs), dy = y - clamp(y, yy * cs, (yy + 1) * cs);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > 1e-6 && d < wr) { px += dx / d * (1 - d / wr); py += dy / d * (1 - d / wr); }
        }
      px = clamp(px, -1, 1); py = clamp(py, -1, 1);
    }

    const maxE = p.maxE[i];
    inp[0] = 1;
    inp[1] = p.energy[i] / maxE;
    inp[2] = foodFwd;
    inp[3] = foodLat;
    inp[4] = total / (total + PHYSIO.foodSat);
    inp[5] = here / (here + PHYSIO.foodSat * 0.5);
    inp[6] = count / (count + PHYSIO.crowdSat);
    inp[7] = nbF;
    inp[8] = nbL;
    inp[9] = px * hx + py * hy;
    inp[10] = px * lx + py * ly;
    inp[11] = this.localTemperature(g.cellAt(x, y));
    const mo = i * N_MEM;
    for (let k = 0; k < N_MEM; k++) inp[IN_MEM + k] = p.mem[mo + k];
    // cechy najbliższego sąsiada: względny rozmiar i dieta (czy to potencjalny drapieżnik/ofiara)
    inp[IN_NB_SIZE] = bj >= 0 ? (p.radius[bj] - p.radius[i]) / 4 : 0;
    inp[IN_NB_DIET] = bj >= 0 ? p.diet[bj] : 0;
    inp[IN_FOOD_B_FWD] = bSum > 0 ? (bVx * hx + bVy * hy) / bSum : 0;
    inp[IN_FOOD_B_LAT] = bSum > 0 ? (bVx * lx + bVy * ly) / bSum : 0;
    inp[IN_FOOD_B_AMOUNT] = bTotal / (bTotal + PHYSIO.foodSat);
    inp[IN_SIGNAL] = signalWeight > 0 ? signal / signalWeight : 0;
    inp[IN_SIGNAL_FWD] = signalWeight > 0 ? (signalX * hx + signalY * hy) / signalWeight : 0;
    inp[IN_SIGNAL_LAT] = signalWeight > 0 ? (signalX * lx + signalY * ly) / signalWeight : 0;
    if (this.ablate !== null && (!this.ablateOddOnly || p.id[i] % 2 === 1)) this.applyAblation();
  }

  /**
   * Zastępuje wejścia wybranej grupy stałą średnią populacji (`ablationMeans`).
   * Usuwa informację niesioną przez zmysł, ale nie przesuwa punktu pracy sieci (zerowanie zmieniałoby efektywny bias).
   */
  private applyAblation(): void {
    const inp = this.inp;
    const m = this.ablationMeans;
    const set = (k: number) => {
      inp[k] = m[k];
    };
    switch (this.ablate) {
      case 'memory':
        for (let k = 0; k < N_MEM; k++) set(IN_MEM + k);
        break;
      case 'food':
        set(2); set(3); set(4); set(5); set(IN_FOOD_B_FWD); set(IN_FOOD_B_LAT); set(IN_FOOD_B_AMOUNT);
        break;
      case 'neighbors':
        set(6); set(7); set(8); set(IN_NB_SIZE); set(IN_NB_DIET);
        break;
      case 'walls':
        set(9); set(10);
        break;
      case 'energy':
        set(1);
        break;
      case 'communication':
        set(IN_SIGNAL); set(IN_SIGNAL_FWD); set(IN_SIGNAL_LAT);
        break;
      case 'temperature':
        set(11);
        break;
    }
  }

  /** Mierzy średnie wejścia sieci po żywej populacji (bez ablacji) i zapisuje je w `ablationMeans`. */
  measureInputMeans(): Float64Array {
    const p = this.pool;
    const n = p.n;
    const m = this.ablationMeans;
    m.fill(0);
    if (n === 0) return m;
    this.spatial.build(p.x, p.y, n);
    const saved = this.ablate;
    this.ablate = null;
    for (let i = 0; i < n; i++) {
      this.perceive(i);
      for (let k = 0; k < N_IN; k++) m[k] += this.inp[k];
    }
    this.ablate = saved;
    for (let k = 0; k < N_IN; k++) m[k] /= n;
    return m;
  }

  /** Reprodukcja bezpłciowa: klon rodzica z mutacjami; rodzic płaci całość inwestycji. */
  private spawnChild(par: number, invest: number, cost: number): void {
    const p = this.pool;
    const P = this.params;
    const c = p.n++;
    const GL = GENOME_LEN;
    inheritWithMutation(p.genomes, par * GL, p.genomes, c * GL, this.rng, P.mutationRate, P.mutationStrength, P.traitMutationStrength, this.scratch);
    this.initChild(c, par, -1, invest);
    p.energy[par] -= cost;
    this.ledger.outRepro += cost - invest;
    p.lastRepro[par] = this.tick;
    p.offspring[par]++;
  }

  /**
   * Reprodukcja płciowa: dwoje rodziców, rekombinacja neuron po neuronie + mutacje.
   * Każdy rodzic wnosi połowę swojej inwestycji (i płaci połowę narzutu). Rejestr mutacji dziecka
   * opisuje różnice względem pierwszego rodzica (rekombinacja jest w nim zawarta).
   */
  private spawnSexual(a: number, b: number): void {
    const p = this.pool;
    const P = this.params;
    const GL = GENOME_LEN;
    const c = p.n++;
    const between = this.mateGroup(a) !== this.mateGroup(b);
    if (between) { this.mating.between++; p.crossGroupBirths[a]++; p.crossGroupBirths[b]++; }
    else this.mating.within++;
    p.sexualBirths[a]++; p.sexualBirths[b]++;
    crossover(p.genomes, a * GL, p.genomes, b * GL, this.tmpGenome, 0, this.rng);
    inheritWithMutation(this.tmpGenome, 0, p.genomes, c * GL, this.rng, P.mutationRate, P.mutationStrength, P.traitMutationStrength, this.scratch);
    diffGenomes(p.genomes, a * GL, p.genomes, c * GL, this.scratch);
    const invA = 0.5 * p.investFrac[a] * p.maxE[a];
    const invB = 0.5 * p.investFrac[b] * p.maxE[b];
    const costA = invA * (1 + P.reproOverhead);
    const costB = invB * (1 + P.reproOverhead);
    this.initChild(c, a, b, invA + invB);
    p.energy[a] -= costA;
    p.energy[b] -= costB;
    this.ledger.outRepro += costA + costB - (invA + invB);
    p.lastRepro[a] = p.lastRepro[b] = this.tick;
    p.offspring[a]++;
    p.offspring[b]++;
    this.mated[a] = this.mated[b] = 1;
  }

  /** Wspólna inicjalizacja noworodka (genom już zapisany w puli pod indeksem `c`). */
  private initChild(c: number, par: number, par2: number, invest: number): void {
    const p = this.pool;
    const P = this.params;
    const GL = GENOME_LEN;
    p.id[c] = this.nextId++;
    p.resetRuntime(c);
    this.derivePhysiology(c);
    const childMax = p.maxE[c];
    const given = invest < childMax ? invest : childMax;
    p.energy[c] = given;
    // nadwyżka ponad pojemność dziecka wraca do gleby (energia nie znika)
    const grid = this.grid;
    let pcx = (p.x[par] / grid.cell) | 0;
    let pcy = (p.y[par] / grid.cell) | 0;
    if (pcx >= grid.nx) pcx = grid.nx - 1;
    if (pcy >= grid.ny) pcy = grid.ny - 1;
    if (invest > given) grid.food[pcy * grid.nx + pcx] += invest - given;

    this.randomHeading(c, this.rng);
    const dist = p.radius[par] + p.radius[c] + 1;
    const r = p.radius[c];
    p.x[c] = clamp(p.x[par] + p.hx[c] * dist, r, this.setup.width - r);
    p.y[c] = clamp(p.y[par] + p.hy[c] * dist, r, this.setup.height - r);
    this.placeClear(c);
    p.currentBiome[c] = P.biomes >= 0.5 ? grid.biome[grid.cellAt(p.x[c], p.y[c])] : 255;
    if (P.biomes >= 0.5) this.biomeCounters.births[p.currentBiome[c]]++;
    // dziecko startuje z kierunkiem niezależnym od rodzica — drugi losowy wektor
    this.randomHeading(c, this.rng);
    p.health[c] = 1;
    p.age[c] = 0;
    p.birth[c] = this.tick;
    p.maxAge[c] = Math.floor(P.lifespanBase * pow025(p.mass[c]));
    p.generation[c] = Math.max(p.generation[par], par2 >= 0 ? p.generation[par2] : 0) + 1;
    p.clade[c] = p.clade[par];
    p.lastRepro[c] = this.tick;
    p.offspring[c] = 0;
    for (let k = 0; k < N_MEM; k++) p.mem[c * N_MEM + k] = 0;
    p.lin[c] = this.lineage.add(
      p.id[c], p.lin[par], this.tick, p.generation[c], p.genomes, c * GL,
      this.scratch.idx, this.scratch.val, this.scratch.count, par2 >= 0 ? p.lin[par2] : -1,
    );
    this.acc.births++;
  }

  /** Usuwa organizmy o podanych (rosnących) indeksach; ich energia wraca do gleby jako zwłoki. */
  private removeOrganisms(dead: number[], causes: number[]): void {
    const p = this.pool;
    const grid = this.grid;
    const P = this.params;
    for (let k = dead.length - 1; k >= 0; k--) {
      const i = dead[k];
      const e = p.energy[i];
      if (P.biomes >= 0.5) this.biomeCounters.deaths[grid.biome[grid.cellAt(p.x[i], p.y[i])]]++;
      let cx = (p.x[i] / grid.cell) | 0;
      let cy = (p.y[i] / grid.cell) | 0;
      if (cx >= grid.nx) cx = grid.nx - 1;
      if (cy >= grid.ny) cy = grid.ny - 1;
      grid.food[cy * grid.nx + cx] += e * P.corpseRecycling;
      grid.seedBank[cy * grid.nx + cx] = Math.min(4, grid.seedBank[cy * grid.nx + cx] + p.seedLoad[i]);
      this.ledger.outCorpse += e * (1 - P.corpseRecycling);
      this.lineage.markDead(p.lin[i], this.tick);
      this.acc.deaths[causes[k]]++;
      const last = p.n - 1;
      if (i !== last) p.move(last, i);
      p.n--;
    }
  }

  // ——— statystyki ———

  private sample(): void {
    const p = this.pool;
    const n = p.n;
    const row = this.statRow;
    const I = STAT_INDEX;
    row.fill(0);
    const a = this.acc;
    const dt = Math.max(1, this.tick - this.lastSampleTick);
    row[I.tick] = this.tick;
    row[I.pop] = n;
    row[I.births] = a.births;
    let deaths = 0;
    for (const d of a.deaths) deaths += d;
    row[I.deaths] = deaths;
    row[I.dStarve] = a.deaths[CAUSE_STARVE];
    row[I.dAge] = a.deaths[CAUSE_AGE];
    row[I.dHealth] = a.deaths[CAUSE_HEALTH];
    row[I.dAccident] = a.deaths[CAUSE_ACCIDENT];
    row[I.dCull] = a.deaths[CAUSE_CULL];
    row[I.dPred] = a.deaths[CAUSE_PREDATION];
    row[I.predEnergy] = a.predEnergy;

    let foodSum = 0;
    let capSum = 0;
    const g = this.grid;
    for (let c = 0; c < g.cells; c++) {
      foodSum += g.food[c] + g.foodB[c];
      capSum += this.foodCapacity(c);
    }
    row[I.food] = foodSum;
    row[I.foodFrac] = capSum > 0 ? foodSum / capSum : 0;
    let foodB = 0, niche = 0;
    for (let c = 0; c < g.cells; c++) { foodB += g.foodB[c]; niche += g.niche[c]; }
    row[I.foodB] = foodB; row[I.nicheMean] = niche / g.cells;
    row[I.mateWithin] = this.mating.within; row[I.mateBetween] = this.mating.between;
    row[I.mateRejected] = this.mating.rejectedWithin + this.mating.rejectedBetween;
    let signals = 0, plasticChange = 0;
    for (let i = 0; i < n; i++) {
      signals += Math.abs(p.signal[i]);
      for (let k = W1_OFF; k < GENOME_LEN; k++) plasticChange += Math.abs(p.somaticWeights[i * GENOME_LEN + k]);
    }
    row[I.meanSignal] = n > 0 ? signals / n : 0;
    row[I.plasticChange] = n > 0 ? plasticChange / n / (GENOME_LEN - N_TRAITS) : 0;
    row[I.temp] = this.temperature;
    const habitats = this.biomeSnapshot();
    for (let b = 0; b < 3; b++) row[I[`biomePop${b}`]] = habitats.biomes[b].population;
    row[I.biomeMigrations] = this.biomeCounters.migrations.reduce((a, b) => a + b, 0);
    let tMin = Infinity, tMax = -Infinity;
    for (let c = 0; c < g.cells; c++) { const t = this.localTemperature(c); tMin = Math.min(tMin, t); tMax = Math.max(tMax, t); }
    row[I.tempMin] = tMin; row[I.tempMax] = tMax;
    const inNow = ledgerIn(this.ledger);
    const outNow = ledgerOut(this.ledger);
    row[I.eIn] = inNow - a.inMark;
    row[I.eOut] = outNow - a.outMark;
    a.inMark = inNow;
    a.outMark = outNow;

    if (n > 0) {
      const tSum = this.tSum;
      const tSq = this.tSq;
      tSum.fill(0);
      tSq.fill(0);
      let sAge = 0, sE = 0, sGen = 0, mGen = 0, sOrg = 0, sW = 0, carn = 0;
      const G = p.genomes;
      const cc = this.cladeCount;
      cc.fill(0);
      for (let i = 0; i < n; i++) {
        if (p.diet[i] > 0.3) carn++;
        cc[p.clade[i]]++;
        sAge += p.age[i];
        sE += p.energy[i] / p.maxE[i];
        sOrg += p.energy[i];
        sGen += p.generation[i];
        if (p.generation[i] > mGen) mGen = p.generation[i];
        sW += p.sumAbsW[i];
        const o = i * GENOME_LEN;
        for (let t = 0; t < N_TRAITS; t++) {
          const v = G[o + t];
          tSum[t] += v;
          tSq[t] += v * v;
        }
      }
      row[I.meanAge] = sAge / n;
      row[I.meanEnergy] = sE / n;
      row[I.meanGen] = sGen / n;
      row[I.maxGen] = mGen;
      row[I.orgEnergy] = sOrg;
      row[I.brainCost] = sW / n;
      row[I.reproRate] = ((a.births * 1000) / dt) / n;
      row[I.carnFrac] = carn / n;
      let topC = 0;
      let topK = 0;
      let alive = 0;
      for (let k = 0; k < cc.length; k++) {
        if (cc[k] > 0) alive++;
        if (cc[k] > topC) {
          topC = cc[k];
          topK = k;
        }
      }
      row[I.cladeTop] = topC / n;
      row[I.cladeCount] = alive;
      this.logCladeSweep(topC / n, topK);
      let div = 0;
      for (let t = 0; t < N_TRAITS; t++) {
        const m = tSum[t] / n;
        const v = Math.max(0, tSq[t] / n - m * m);
        const sd = Math.sqrt(v);
        row[I.m_size + t] = m;
        row[I.s_size + t] = sd;
        if (t !== TRAIT_HUE) div += sd;
      }
      row[I.diversity] = div / (N_TRAITS - 1);
      if (n >= 2) {
        const m = Math.min(n, 64);
        let ss = 0;
        for (let k = 0; k < m; k++) {
          const ia = Math.floor((k * n) / m);
          const ib = (ia + 1 + ((k * 7) % (n - 1))) % n;
          let sq = 0;
          const oa = ia * GENOME_LEN;
          const ob = ib * GENOME_LEN;
          for (let q = 0; q < GENOME_LEN; q++) {
            const d = G[oa + q] - G[ob + q];
            sq += d * d;
          }
          ss += Math.sqrt(sq / GENOME_LEN);
        }
        row[I.genomeDist] = ss / m;
      }
    }
    a.births = 0;
    a.predEnergy = 0;
    a.deaths = new Array<number>(N_CAUSES).fill(0);
    this.lastSampleTick = this.tick;
    this.stats.push(row);
    this.detectEvents(row);
  }

  prevPop = -1;

  /** Wykrywanie wymiatania: jeden klad (potomkowie jednego założyciela) przejmuje populację. */
  private logCladeSweep(share: number, clade: number): void {
    if (this.pool.n < 30) return;
    if (share >= 0.9 && this.cladeLogged < 2) {
      this.cladeLogged = 2;
      this.log('sweep', `Klad założyciela #${clade + 1} stanowi ${(share * 100).toFixed(0)}% populacji (>90%)`);
    } else if (share >= 0.5 && this.cladeLogged < 1) {
      this.cladeLogged = 1;
      this.log('sweep', `Klad założyciela #${clade + 1} stanowi ${(share * 100).toFixed(0)}% populacji (>50%)`);
    } else if (share < 0.4) this.cladeLogged = 0;
  }

  /** Wykrywanie istotnych zdarzeń: gwałtowny spadek/wzrost populacji. */
  private detectEvents(row: Float64Array): void {
    const pop = row[STAT_INDEX.pop];
    if (this.prevPop > 50) {
      if (pop < this.prevPop * 0.6) this.log('crash', `Gwałtowny spadek populacji: ${this.prevPop} → ${pop}`);
      else if (pop > this.prevPop * 1.6) this.log('boom', `Gwałtowny wzrost populacji: ${this.prevPop} → ${pop}`);
    }
    this.prevPop = pop;
  }

  // ——— inspekcja ———

  totalEnergy(): { food: number; organisms: number } {
    let f = 0;
    for (let c = 0; c < this.grid.cells; c++) f += this.grid.food[c] + this.grid.foodB[c];
    let o = 0;
    for (let i = 0; i < this.pool.n; i++) o += this.pool.energy[i];
    return { food: f, organisms: o };
  }

  /** Różnica bilansu: powinna być ≈ 0 (błąd zaokrągleń). */
  energyImbalance(): number {
    const t = this.totalEnergy();
    const expected = this.ledger.initial + ledgerIn(this.ledger) - ledgerOut(this.ledger);
    return t.food + t.organisms - expected;
  }

  /** Zapina wybrany organizm w genealogii (jego przodkowie nie zostaną przycięci). */
  select(id: number | null): void {
    if (this.pinnedNode >= 0) {
      this.lineage.unpin(this.pinnedNode);
      this.pinnedNode = -1;
    }
    if (id === null) return;
    const n = this.lineage.indexOf(id);
    if (n >= 0) {
      this.lineage.pin(n);
      this.pinnedNode = n;
    }
  }

  get pinned(): number {
    return this.pinnedNode;
  }
  set pinned(v: number) {
    this.pinnedNode = v;
  }

  inspect(id: number): OrganismView | null {
    const p = this.pool;
    const i = p.indexOfId(id);
    if (i < 0) return null;
    this.spatial.build(p.x, p.y, p.n);
    this.perceive(i);
    const effectiveMagnitude = think(p.genomes, i * GENOME_LEN, this.inp, this.hid, this.out, p.somaticWeights);
    const P = this.params;
    const me = p.maxE[i];
    const coldLoad = Math.max(0, 1 - this.localTemperature(this.grid.cellAt(p.x[i], p.y[i])) - PHYSIO.coldTolSpan * p.coldTol[i]);
    const basal = P.basalCoef * p.m075[i] * (1 + P.coldMetabK * coldLoad);
    const sense = P.senseCoef * p.senseRange[i] * p.senseRange[i];
    const brain = P.brainCoef * effectiveMagnitude;
    const upkeep = P.coldUpkeepCoef * p.coldTol[i] * p.m075[i];
    const idle = basal + sense + brain + upkeep;
    const node = p.lin[i];
    const traits: number[] = [];
    for (let t = 0; t < N_TRAITS; t++) traits.push(p.genomes[i * GENOME_LEN + t]);
    const starvationIn = idle > 0 ? p.energy[i] / idle : Infinity;
    return {
      id,
      slot: i,
      x: p.x[i], y: p.y[i], hx: p.hx[i], hy: p.hy[i],
      age: p.age[i], maxAge: p.maxAge[i],
      energy: p.energy[i], maxEnergy: me, health: p.health[i],
      generation: p.generation[i], birthTick: p.birth[i], offspring: p.offspring[i],
      parentId: this.lineage.parent[node] >= 0 ? this.lineage.id[this.lineage.parent[node]] : null,
      traits,
      physiology: {
        radius: p.radius[i], mass: p.mass[i], maxSpeed: p.maxSpeed[i], senseRange: p.senseRange[i],
        biteCap: p.biteCap[i], assim: this.plantAssim(i, false), reproThresh: p.reproThresh[i], investFrac: p.investFrac[i],
        maturity: p.maturity[i], coldTol: p.coldTol[i], sumAbsW: effectiveMagnitude,
        diet: p.diet[i], memDecay: p.memDecay[i], plantSpecialization: p.plantSpecialization[i], assimB: this.plantAssim(i, true), matePreference: p.matePreference[i], mateSelectivity: p.mateSelectivity[i], plasticity: p.plasticity[i], nicheInvestment: p.nicheInvestment[i],
      },
      mem: Array.from(p.mem.subarray(i * N_MEM, (i + 1) * N_MEM)),
      parent2Id: this.lineage.parent2[node] >= 0 ? this.lineage.id[this.lineage.parent2[node]] : null,
      clade: p.clade[i],
      costs: { basal, sense, brain, upkeep, idle },
      expectedLifespan: Math.min(p.maxAge[i], p.age[i] + starvationIn),
      starvationIn,
      inputs: Array.from(this.inp),
      hidden: Array.from(this.hid),
      outputs: Array.from(this.out),
      genome: p.genomes.slice(i * GENOME_LEN, (i + 1) * GENOME_LEN),
      learnedWeights: p.genomes.slice(i * GENOME_LEN, (i + 1) * GENOME_LEN).map((v, g) => v + p.somaticWeights[i * GENOME_LEN + g]),
      somaticWeights: p.somaticWeights.slice(i * GENOME_LEN, (i + 1) * GENOME_LEN),
      observations: this.observe(id)!, signal: p.signal[i], seedLoad: p.seedLoad[i],
      lineage: this.lineage.info(node),
    };
  }
}
