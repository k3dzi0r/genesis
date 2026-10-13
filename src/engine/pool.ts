/**
 * Pula organizmów w układzie SoA (structure of arrays) — gęsta, bez dziur.
 * Usunięcie organizmu = „swap-remove” (ostatni trafia na jego miejsce), więc iteracja
 * po indeksach 0..n-1 jest zawsze deterministyczna i serializacja nie wymaga listy wolnych slotów.
 */
import { GENOME_LEN, N_MEM, TRAIL_LEN } from './constants';

export class OrganismPool {
  n = 0;
  readonly capacity: number;

  // stan dynamiczny (float64 — brak dryfu zaokrągleń w bilansie energii)
  id: Float64Array;
  x: Float64Array;
  y: Float64Array;
  hx: Float64Array;
  hy: Float64Array;
  energy: Float64Array;
  health: Float64Array;
  /** maksymalna pojemność energii (cache) */
  maxE: Float64Array;

  // zdarzenia życiowe
  age: Uint32Array;
  birth: Uint32Array;
  maxAge: Uint32Array;
  generation: Uint32Array;
  lastRepro: Uint32Array;
  offspring: Uint32Array;
  lin: Int32Array;
  /** indeks założyciela, z którego pochodzi linia (klad) */
  clade: Int32Array;

  // cechy pochodne od genomu (cache; nie zależą od parametrów świata)
  radius: Float32Array;
  mass: Float32Array;
  m075: Float32Array;
  senseRange: Float32Array;
  maxSpeed: Float32Array;
  biteCap: Float32Array;
  assim: Float32Array;
  reproThresh: Float32Array;
  investFrac: Float32Array;
  maturity: Float32Array;
  coldTol: Float32Array;
  sumAbsW: Float32Array;
  /** współczynnik zachowania stanu pamięci (λ) */
  memDecay: Float32Array;
  diet: Float32Array;

  signal: Float32Array;
  seedLoad: Float32Array;
  seedSource: Int32Array;
  plantSpecialization: Float32Array;
  matePreference: Float32Array;
  mateSelectivity: Float32Array;
  plasticity: Float32Array;
  nicheInvestment: Float32Array;
  assimB: Float32Array;
  observedTicks: Uint32Array;
  distance: Float64Array;
  feedingTicks: Uint32Array;
  foodEnergy: Float64Array;
  foodAConsumed: Float64Array;
  foodBConsumed: Float64Array;
  meatEnergy: Float64Array;
  attacks: Uint32Array;
  successfulAttacks: Uint32Array;
  revisits: Uint32Array;
  threatExposure: Uint32Array;
  threatEscape: Uint32Array;
  neighborTicks: Uint32Array;
  signalEmitted: Float64Array;
  signalReceived: Float64Array;
  cultivated: Float64Array;
  seedsMoved: Float64Array;
  mateAttempts: Uint32Array;
  mateRejected: Uint32Array;
  sexualBirths: Uint32Array;
  crossGroupBirths: Uint32Array;
  trailCount: Uint32Array;
  trailCursor: Uint32Array;
  visitedCount: Uint32Array;
  visitedCursor: Uint32Array;
  lastCell: Int32Array;
  currentBiome: Uint8Array;
  biomeTransitions: Uint32Array;
  somaticWeights: Float32Array;
  eligibility: Float32Array;
  trailX: Float32Array;
  trailY: Float32Array;
  trailEnergy: Float32Array;
  trailTick: Uint32Array;
  visitedCells: Int32Array;

  genomes: Float32Array;
  /** stan pamięci rekurencyjnej: N_MEM liczb na organizm */
  mem: Float32Array;

  private readonly arrays: Record<string, Float64Array | Float32Array | Uint32Array | Int32Array | Uint8Array>;
  private readonly list: (Float64Array | Float32Array | Uint32Array | Int32Array | Uint8Array)[];

  constructor(capacity: number) {
    this.capacity = capacity;
    this.id = new Float64Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.hx = new Float64Array(capacity);
    this.hy = new Float64Array(capacity);
    this.energy = new Float64Array(capacity);
    this.health = new Float64Array(capacity);
    this.maxE = new Float64Array(capacity);
    this.age = new Uint32Array(capacity);
    this.birth = new Uint32Array(capacity);
    this.maxAge = new Uint32Array(capacity);
    this.generation = new Uint32Array(capacity);
    this.lastRepro = new Uint32Array(capacity);
    this.offspring = new Uint32Array(capacity);
    this.lin = new Int32Array(capacity);
    this.clade = new Int32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.mass = new Float32Array(capacity);
    this.m075 = new Float32Array(capacity);
    this.senseRange = new Float32Array(capacity);
    this.maxSpeed = new Float32Array(capacity);
    this.biteCap = new Float32Array(capacity);
    this.assim = new Float32Array(capacity);
    this.reproThresh = new Float32Array(capacity);
    this.investFrac = new Float32Array(capacity);
    this.maturity = new Float32Array(capacity);
    this.coldTol = new Float32Array(capacity);
    this.sumAbsW = new Float32Array(capacity);
    this.memDecay = new Float32Array(capacity);
    this.diet = new Float32Array(capacity);
    this.mem = new Float32Array(capacity * N_MEM);
    this.genomes = new Float32Array(capacity * GENOME_LEN);
    this.signal = new Float32Array(capacity);
    this.seedLoad = new Float32Array(capacity);
    this.seedSource = new Int32Array(capacity);
    this.plantSpecialization = new Float32Array(capacity);
    this.matePreference = new Float32Array(capacity);
    this.mateSelectivity = new Float32Array(capacity);
    this.plasticity = new Float32Array(capacity);
    this.nicheInvestment = new Float32Array(capacity);
    this.assimB = new Float32Array(capacity);
    this.observedTicks = new Uint32Array(capacity);
    this.distance = new Float64Array(capacity);
    this.feedingTicks = new Uint32Array(capacity);
    this.foodEnergy = new Float64Array(capacity);
    this.foodAConsumed = new Float64Array(capacity);
    this.foodBConsumed = new Float64Array(capacity);
    this.meatEnergy = new Float64Array(capacity);
    this.attacks = new Uint32Array(capacity);
    this.successfulAttacks = new Uint32Array(capacity);
    this.revisits = new Uint32Array(capacity);
    this.threatExposure = new Uint32Array(capacity);
    this.threatEscape = new Uint32Array(capacity);
    this.neighborTicks = new Uint32Array(capacity);
    this.signalEmitted = new Float64Array(capacity);
    this.signalReceived = new Float64Array(capacity);
    this.cultivated = new Float64Array(capacity);
    this.seedsMoved = new Float64Array(capacity);
    this.mateAttempts = new Uint32Array(capacity);
    this.mateRejected = new Uint32Array(capacity);
    this.sexualBirths = new Uint32Array(capacity);
    this.crossGroupBirths = new Uint32Array(capacity);
    this.trailCount = new Uint32Array(capacity);
    this.trailCursor = new Uint32Array(capacity);
    this.visitedCount = new Uint32Array(capacity);
    this.visitedCursor = new Uint32Array(capacity);
    this.lastCell = new Int32Array(capacity);
    this.somaticWeights = new Float32Array(capacity * GENOME_LEN);
    this.eligibility = new Float32Array(capacity * GENOME_LEN);
    this.trailX = new Float32Array(capacity * TRAIL_LEN);
    this.trailY = new Float32Array(capacity * TRAIL_LEN);
    this.trailEnergy = new Float32Array(capacity * TRAIL_LEN);
    this.trailTick = new Uint32Array(capacity * TRAIL_LEN);
    this.visitedCells = new Int32Array(capacity * TRAIL_LEN);
    this.visitedCells.fill(-1);
    this.lastCell.fill(-1);
    this.seedSource.fill(-1);
    this.currentBiome = new Uint8Array(capacity); this.currentBiome.fill(255);
    this.biomeTransitions = new Uint32Array(capacity);
    this.arrays = {
      currentBiome: this.currentBiome, biomeTransitions: this.biomeTransitions,
      id: this.id, x: this.x, y: this.y, hx: this.hx, hy: this.hy, energy: this.energy, health: this.health, maxE: this.maxE,
      age: this.age, birth: this.birth, maxAge: this.maxAge, generation: this.generation,
      lastRepro: this.lastRepro, offspring: this.offspring, lin: this.lin, clade: this.clade,
      radius: this.radius, mass: this.mass, m075: this.m075, senseRange: this.senseRange,
      maxSpeed: this.maxSpeed, biteCap: this.biteCap, assim: this.assim, reproThresh: this.reproThresh,
      investFrac: this.investFrac, maturity: this.maturity, coldTol: this.coldTol, sumAbsW: this.sumAbsW,
      memDecay: this.memDecay, diet: this.diet,
      signal: this.signal,
      seedLoad: this.seedLoad,
      seedSource: this.seedSource,
      plantSpecialization: this.plantSpecialization,
      matePreference: this.matePreference,
      mateSelectivity: this.mateSelectivity,
      plasticity: this.plasticity,
      nicheInvestment: this.nicheInvestment,
      assimB: this.assimB,
      observedTicks: this.observedTicks,
      distance: this.distance,
      feedingTicks: this.feedingTicks,
      foodEnergy: this.foodEnergy,
      foodAConsumed: this.foodAConsumed,
      foodBConsumed: this.foodBConsumed,
      meatEnergy: this.meatEnergy,
      attacks: this.attacks,
      successfulAttacks: this.successfulAttacks,
      revisits: this.revisits,
      threatExposure: this.threatExposure,
      threatEscape: this.threatEscape,
      neighborTicks: this.neighborTicks,
      signalEmitted: this.signalEmitted,
      signalReceived: this.signalReceived,
      cultivated: this.cultivated,
      seedsMoved: this.seedsMoved,
      mateAttempts: this.mateAttempts,
      mateRejected: this.mateRejected,
      sexualBirths: this.sexualBirths,
      crossGroupBirths: this.crossGroupBirths,
      trailCount: this.trailCount,
      trailCursor: this.trailCursor,
      visitedCount: this.visitedCount,
      visitedCursor: this.visitedCursor,
      lastCell: this.lastCell,
    };
    this.list = Object.values(this.arrays);
  }

  /** Kopiuje cały organizm ze slotu `from` do `to`. */
  move(from: number, to: number): void {
    const list = this.list;
    for (let k = 0; k < list.length; k++) list[k][to] = list[k][from];
    this.genomes.copyWithin(to * GENOME_LEN, from * GENOME_LEN, (from + 1) * GENOME_LEN);
    this.mem.copyWithin(to * N_MEM, from * N_MEM, (from + 1) * N_MEM);
    this.somaticWeights.copyWithin(to * GENOME_LEN, from * GENOME_LEN, (from + 1) * GENOME_LEN);
    this.eligibility.copyWithin(to * GENOME_LEN, from * GENOME_LEN, (from + 1) * GENOME_LEN);
    this.trailX.copyWithin(to * TRAIL_LEN, from * TRAIL_LEN, (from + 1) * TRAIL_LEN);
    this.trailY.copyWithin(to * TRAIL_LEN, from * TRAIL_LEN, (from + 1) * TRAIL_LEN);
    this.trailEnergy.copyWithin(to * TRAIL_LEN, from * TRAIL_LEN, (from + 1) * TRAIL_LEN);
    this.trailTick.copyWithin(to * TRAIL_LEN, from * TRAIL_LEN, (from + 1) * TRAIL_LEN);
    this.visitedCells.copyWithin(to * TRAIL_LEN, from * TRAIL_LEN, (from + 1) * TRAIL_LEN);
  }

  /** Reset every non-genetic state; also used when a newborn reuses a removed slot. */
  resetRuntime(i: number): void {
    for (const k of ["signal", "seedLoad", "seedSource", "observedTicks", "distance", "feedingTicks", "foodEnergy", "foodAConsumed", "foodBConsumed", "meatEnergy", "attacks", "successfulAttacks", "revisits", "threatExposure", "threatEscape", "neighborTicks", "signalEmitted", "signalReceived", "cultivated", "seedsMoved", "mateAttempts", "mateRejected", "sexualBirths", "crossGroupBirths", "trailCount", "trailCursor", "visitedCount", "visitedCursor", "lastCell"]) this.arrays[k][i] = 0;
    this.seedSource[i] = -1;
    this.lastCell[i] = -1;
    this.currentBiome[i] = 255; this.biomeTransitions[i] = 0;
    this.somaticWeights.fill(0, i * GENOME_LEN, (i + 1) * GENOME_LEN);
    this.eligibility.fill(0, i * GENOME_LEN, (i + 1) * GENOME_LEN);
    this.trailX.fill(0, i * TRAIL_LEN, (i + 1) * TRAIL_LEN);
    this.trailY.fill(0, i * TRAIL_LEN, (i + 1) * TRAIL_LEN);
    this.trailEnergy.fill(0, i * TRAIL_LEN, (i + 1) * TRAIL_LEN);
    this.trailTick.fill(0, i * TRAIL_LEN, (i + 1) * TRAIL_LEN);
    this.visitedCells.fill(-1, i * TRAIL_LEN, (i + 1) * TRAIL_LEN);
  }

  indexOfId(id: number): number {
    const ids = this.id;
    for (let i = 0; i < this.n; i++) if (ids[i] === id) return i;
    return -1;
  }

  exportSections(): Record<string, ArrayBufferView> {
    const out: Record<string, ArrayBufferView> = {};
    for (const k in this.arrays) out[`pool.${k}`] = this.arrays[k].slice(0, this.n);
    out['pool.genomes'] = this.genomes.slice(0, this.n * GENOME_LEN);
    out['pool.mem'] = this.mem.slice(0, this.n * N_MEM);
    out['pool.somaticWeights'] = this.somaticWeights.slice(0, this.n * GENOME_LEN);
    out['pool.eligibility'] = this.eligibility.slice(0, this.n * GENOME_LEN);
    out['pool.trailX'] = this.trailX.slice(0, this.n * TRAIL_LEN);
    out['pool.trailY'] = this.trailY.slice(0, this.n * TRAIL_LEN);
    out['pool.trailEnergy'] = this.trailEnergy.slice(0, this.n * TRAIL_LEN);
    out['pool.trailTick'] = this.trailTick.slice(0, this.n * TRAIL_LEN);
    out['pool.visitedCells'] = this.visitedCells.slice(0, this.n * TRAIL_LEN);
    return out;
  }

  importSections(n: number, s: Record<string, ArrayBufferView>): void {
    this.n = n;
    for (const k in this.arrays) (this.arrays[k] as unknown as { set(a: ArrayLike<number>): void }).set(s[`pool.${k}`] as unknown as ArrayLike<number>);
    this.genomes.set(s['pool.genomes'] as Float32Array);
    this.mem.set(s['pool.mem'] as Float32Array);
    this.somaticWeights.set(s['pool.somaticWeights'] as Float32Array);
    this.eligibility.set(s['pool.eligibility'] as Float32Array);
    this.trailX.set(s['pool.trailX'] as Float32Array);
    this.trailY.set(s['pool.trailY'] as Float32Array);
    this.trailEnergy.set(s['pool.trailEnergy'] as Float32Array);
    this.trailTick.set(s['pool.trailTick'] as Uint32Array);
    this.visitedCells.set(s['pool.visitedCells'] as Int32Array);
  }
}
