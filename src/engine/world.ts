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
  PHYSIO, TRAIT_DIET, TRAIT_HUE, TRAIT_MEMORY,
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
export type AblationGroup = 'memory' | 'food' | 'neighbors' | 'walls' | 'energy' | 'temperature';

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
}

function newLedger(): Ledger {
  return {
    initial: 0, inRegrowth: 0, inManual: 0, outBasal: 0, outMove: 0, outSense: 0, outUpkeep: 0,
    outEat: 0, outAttack: 0, outDigest: 0, outRepro: 0, outCorpse: 0, outDecay: 0, outEvent: 0,
  };
}

export function ledgerIn(l: Ledger): number {
  return l.inRegrowth + l.inManual;
}
export function ledgerOut(l: Ledger): number {
  return l.outBasal + l.outMove + l.outSense + l.outUpkeep + l.outEat + l.outAttack + l.outDigest + l.outRepro + l.outCorpse + l.outDecay + l.outEvent;
}

export interface Accumulators {
  births: number;
  /** energia przejęta przez drapieżniki w bieżącym przedziale statystyk */
  predEnergy: number;
  deaths: number[];
  inMark: number;
  outMark: number;
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
    diet: number; memDecay: number;
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
  lineage: LineageInfo | null;
}

const SCHEDULE_SORT = (a: { tick: number }, b: { tick: number }) => a.tick - b.tick;

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
  activeEvents: ActiveEvent[] = [];
  eventLog: LogEntry[] = [];
  commandLog: { tick: number; cmd: Command }[] = [];
  paramHistory: { tick: number; key: string; from: number; to: number }[] = [];
  schedIdx = 0;
  temperature = 1;
  growthMult = 1;
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
    this.cladeCount = new Int32Array(Math.max(1, this.setup.initialPopulation));
    this.cellOf = new Int32Array(cap);
    this.demand = new Float64Array(this.grid.cells);
    if (init) this.initialize();
  }

  // ——— inicjalizacja ———

  private initialize(): void {
    const { setup, grid, pool } = this;
    this.patches = generateFertility(setup, grid, new Rng(setup.seed, 1));
    if (this.params.patchLife > 0) {
      for (const pt of this.patches) assignPhase(pt, this.params.patchLife, this.envRng);
      renderPatches(setup, grid, this.patches);
    }
    let foodSum = 0;
    for (let c = 0; c < grid.cells; c++) {
      grid.food[c] = setup.initialFoodFraction * this.params.foodCapMax * grid.fert[c];
      foodSum += grid.food[c];
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
        if (cmd.key === 'patchLife' && cmd.value <= 0) {
          for (const pt of this.patches) {
            pt.life = 0;
            pt.age = 0;
          }
          this.renderFert();
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
          food[c] -= d;
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
      this.perceive(i);
      think(p.genomes, i * GENOME_LEN, this.inp, this.hid, out);
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
    const W = setup.width;
    const H = setup.height;
    const cs = grid.cell;
    const deficit = Math.max(0, 1 - this.temperature);
    const contestK = Math.max(0, Math.min(3, Math.round(P.contestPower)));
    const predOn = P.predationPower > 0;
    let cBasal = 0, cMove = 0, cSense = 0, cUpkeep = 0, cEat = 0, cAtk = 0;
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
      p.x[i] = x;
      p.y[i] = y;
      p.hx[i] = hx;
      p.hy[i] = hy;

      // zimno: obciążenie = deficyt temperatury ponad tolerancję genetyczną
      let coldLoad = deficit - PHYSIO.coldTolSpan * p.coldTol[i];
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
      const total = basal + sense + upkeep + move + eat + atk;
      let e = p.energy[i];
      if (total >= e) {
        this.starved[i] = 1;
        const f = total > 0 ? e / total : 0;
        cBasal += basal * f; cSense += sense * f; cUpkeep += upkeep * f; cMove += move * f; cEat += eat * f; cAtk += atk * f;
        e = 0;
      } else {
        this.starved[i] = 0;
        cBasal += basal; cSense += sense; cUpkeep += upkeep; cMove += move; cEat += eat; cAtk += atk;
        e -= total;
      }
      p.energy[i] = e;
      if (coldLoad > 0) p.health[i] -= P.coldDamage * coldLoad * coldLoad;

      // zamiar jedzenia: nie więcej niż zmieści się w zbiorniku energii
      const maxE = p.maxE[i];
      let want = effort * p.biteCap[i] * hf;
      const room = (maxE - e) / p.assim[i];
      if (want > room) want = room;
      let cx = (x / cs) | 0;
      let cy = (y / cs) | 0;
      if (cx >= grid.nx) cx = grid.nx - 1;
      if (cy >= grid.ny) cy = grid.ny - 1;
      const cell = cy * grid.nx + cx;
      this.cellOf[i] = cell;
      this.desire[i] = want;
      let wgt = 1;
      for (let j = 0; j < contestK; j++) wgt *= r * 0.25;
      demand[cell] += want * wgt;
    }
    L.outBasal += cBasal; L.outMove += cMove; L.outSense += cSense; L.outUpkeep += cUpkeep; L.outEat += cEat; L.outAttack += cAtk;

    // ——— 5. żerowanie (sprawiedliwy, proporcjonalny podział zasobu komórki) ———
    const food = grid.food;
    let digestLoss = 0;
    for (let i = 0; i < n0; i++) {
      const d = this.desire[i];
      if (d <= 0) continue;
      const c = this.cellOf[i];
      const f = food[c];
      // udział w zasobie ∝ zamiar · (promień/4)^k (większe osobniki wygrywają rywalizację kontaktową)
      let wgt = 1;
      for (let j = 0; j < contestK; j++) wgt *= p.radius[i] * 0.25;
      const dw = d * wgt;
      const D = demand[c];
      // D bywa po zaokrągleniach ≈ 0 lub nieznacznie ujemne — zabezpieczenie przed ±∞
      let eaten = D > 1e-12 ? (dw * f) / D : d;
      if (eaten > d) eaten = d;
      if (eaten > f) eaten = f;
      if (eaten < 0) eaten = 0;
      food[c] = f - eaten;
      demand[c] = D > dw ? D - dw : 0;
      const gain = eaten * p.assim[i];
      p.energy[i] += gain;
      digestLoss += eaten - gain;
    }
    L.outDigest += digestLoss;

    // ——— 5b. drapieżnictwo ———
    this.hunted.fill(0, 0, n0);
    this.spatial.build(p.x, p.y, n0); // pozycje po ruchu (potrzebne też do szukania partnera)
    if (predOn) this.predation(n0);

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
            if (d2 <= lim * lim && d2 < bestD) {
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
          bestD = d2;
          best = j;
        }
      }
    return best;
  }

  private regrow(): void {
    const { food, fert } = this.grid;
    const P = this.params;
    const capMax = P.foodCapMax;
    const rate = P.regrowthRate * this.growthMult;
    const seed = P.foodSeed;
    const decay = P.foodDecay;
    let inn = 0;
    let dec = 0;
    for (let c = 0; c < food.length; c++) {
      const cap = capMax * fert[c];
      const f = food[c];
      if (f < cap) {
        // wzrost logistyczny: ∝ (biomasa + zalążek) · (1 − biomasa/pojemność)
        const g = rate * (f + seed * cap) * (1 - f / cap);
        food[c] = f + g;
        inn += g;
      } else if (f > cap) {
        const d = decay * (f - cap);
        food[c] = f - d;
        dec += d;
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
    let total = 0;
    const food = g.food;
    for (let gy = gy0; gy <= gy1; gy++) {
      const dy = (gy + 0.5) * cs - y;
      const row = gy * g.nx;
      for (let gx = gx0; gx <= gx1; gx++) {
        const f = food[row + gx];
        if (f < 0.05) continue;
        const dx = (gx + 0.5) * cs - x;
        const d2 = dx * dx + dy * dy;
        if (d2 > lim2) continue;
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
          count++;
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
    const px = Math.max(0, 1 - x / wr) - Math.max(0, 1 - (W - x) / wr);
    const py = Math.max(0, 1 - y / wr) - Math.max(0, 1 - (H - y) / wr);

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
    inp[11] = this.temperature;
    const mo = i * N_MEM;
    for (let k = 0; k < N_MEM; k++) inp[IN_MEM + k] = p.mem[mo + k];
    // cechy najbliższego sąsiada: względny rozmiar i dieta (czy to potencjalny drapieżnik/ofiara)
    inp[IN_NB_SIZE] = bj >= 0 ? (p.radius[bj] - p.radius[i]) / 4 : 0;
    inp[IN_NB_DIET] = bj >= 0 ? p.diet[bj] : 0;
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
        set(2); set(3); set(4); set(5);
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
      let cx = (p.x[i] / grid.cell) | 0;
      let cy = (p.y[i] / grid.cell) | 0;
      if (cx >= grid.nx) cx = grid.nx - 1;
      if (cy >= grid.ny) cy = grid.ny - 1;
      grid.food[cy * grid.nx + cx] += e * P.corpseRecycling;
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
    const capMax = this.params.foodCapMax;
    for (let c = 0; c < g.cells; c++) {
      foodSum += g.food[c];
      capSum += capMax * g.fert[c];
    }
    row[I.food] = foodSum;
    row[I.foodFrac] = capSum > 0 ? foodSum / capSum : 0;
    row[I.temp] = this.temperature;
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
    for (let c = 0; c < this.grid.cells; c++) f += this.grid.food[c];
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
    think(p.genomes, i * GENOME_LEN, this.inp, this.hid, this.out);
    const P = this.params;
    const me = p.maxE[i];
    const basal = P.basalCoef * p.m075[i];
    const sense = P.senseCoef * p.senseRange[i] * p.senseRange[i];
    const brain = P.brainCoef * p.sumAbsW[i];
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
        biteCap: p.biteCap[i], assim: p.assim[i], reproThresh: p.reproThresh[i], investFrac: p.investFrac[i],
        maturity: p.maturity[i], coldTol: p.coldTol[i], sumAbsW: p.sumAbsW[i],
        diet: p.diet[i], memDecay: p.memDecay[i],
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
      lineage: this.lineage.info(node),
    };
  }
}
