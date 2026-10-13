/** Observed activity, retained specimens and reproductive compatibility. No world RNG is consumed. */
import { ENGINE_VERSION, GENOME_LEN, MAX_WEIGHT, N_MEM, N_TRAITS, TRAIT_NAMES } from './constants';
import { DEFAULT_SETUP, PARAM_META, validateSetup, type WorldParams, type WorldSetup } from './config';
import type { LabResult } from './lab';
import type { World } from './world';

export interface BehaviorMetrics {
  biomeTransitions: number;
  observedTicks: number;
  distance: number;
  feedingTicks: number;
  foodEnergy: number;
  meatEnergy: number;
  attacks: number;
  successfulAttacks: number;
  revisits: number;
  threatExposure: number;
  threatEscape: number;
}
export interface TracePoint { tick: number; x: number; y: number; energy: number }
export interface Specimen {
  format: 'genesis-specimen';
  engineVersion: string;
  name: string;
  provenance: 'live' | 'archived-genome';
  environmentTick: number;
  sourceSeed: number;
  sourceTick: number;
  organismId: number;
  generation: number;
  parentId: number | null;
  genome: number[];
  somaticWeights: number[];
  memory: number[];
  eligibility: number[];
  behavior: BehaviorMetrics;
  trace: TracePoint[];
  setup: WorldSetup;
  params: WorldParams;
  outcomes: LabResult[];
}
export interface BehaviorGroup { label: string; count: number; ids: number[]; mean: BehaviorMetrics }
export interface BehaviorAtlas { tick: number; population: number; insufficient: number; groups: BehaviorGroup[] }
export interface SpeciesAnalysis {
  sexual: boolean;
  candidateGroups: { label: string; count: number; centroid: Record<string, number> }[];
  sampledOrganisms: number;
  foodProfiles: { label: string; count: number }[];
  sampledPairs: number;
  compatibleWithin: number;
  withinPairs: number;
  compatibleBetween: number;
  betweenPairs: number;
  matingAttempts: number;
  mateRejections: number;
  withinMatings: number;
  betweenMatings: number;
  geneFlow: number | null;
}
const ZERO: BehaviorMetrics = { biomeTransitions: 0, observedTicks: 0, distance: 0, feedingTicks: 0, foodEnergy: 0, meatEnergy: 0, attacks: 0, successfulAttacks: 0, revisits: 0, threatExposure: 0, threatEscape: 0 };

export function behaviorLabel(m: BehaviorMetrics): string {
  if (m.observedTicks < 30) return 'Za mało danych';
  if (m.meatEnergy > m.foodEnergy && m.successfulAttacks > 0) return 'Aktywni łowcy';
  if (m.threatEscape > 0 && m.threatEscape / Math.max(1, m.threatExposure) > 0.15) return 'Unikający zagrożeń';
  if (m.revisits > 2 && m.distance / m.observedTicks > 0.3) return 'Powracający do miejsc';
  if (m.feedingTicks / m.observedTicks > 0.3 && m.distance / m.observedTicks < 0.5) return 'Osiadli żerujący';
  if (m.distance / m.observedTicks > 0.7) return 'Wędrowni poszukiwacze';
  return 'Niska aktywność';
}

export function behaviorAtlas(w: World): BehaviorAtlas {
  const groups = new Map<string, BehaviorGroup>();
  let insufficient = 0;
  for (let i = 0; i < w.pool.n; i++) {
    const m = Object.fromEntries(Object.keys(ZERO).map((k) => [k, w.pool[k as keyof BehaviorMetrics][i]])) as unknown as BehaviorMetrics;
    const label = behaviorLabel(m);
    if (label === 'Za mało danych') { insufficient++; continue; }
    let group = groups.get(label);
    if (!group) { group = { label, count: 0, ids: [], mean: { ...ZERO } }; groups.set(label, group); }
    group.count++;
    if (group.ids.length < 20) group.ids.push(w.pool.id[i]);
    for (const k of Object.keys(ZERO) as (keyof BehaviorMetrics)[]) group.mean[k] += m[k];
  }
  for (const g of groups.values()) for (const k of Object.keys(ZERO) as (keyof BehaviorMetrics)[]) g.mean[k] /= g.count;
  return { tick: w.tick, population: w.pool.n, insufficient, groups: [...groups.values()].sort((a, b) => b.count - a.count) };
}

export function captureSpecimen(w: World, id: number): Specimen {
  const v = w.inspect(id);
  if (!v) throw new Error('Zachowanie i stan nauczony można zachować tylko dla żywego organizmu.');
  const observed = w.observe(id);
  const offset = v.slot * GENOME_LEN;
  return {
    format: 'genesis-specimen', engineVersion: ENGINE_VERSION, provenance: 'live', environmentTick: w.tick, name: `Organizm #${id}`, sourceSeed: w.setup.seed, sourceTick: w.tick,
    organismId: id, generation: v.generation, parentId: v.parentId, genome: Array.from(v.genome),
    somaticWeights: Array.from(w.pool.somaticWeights.subarray(offset, offset + GENOME_LEN)), memory: [...v.mem], eligibility: Array.from(w.pool.eligibility.subarray(offset, offset + GENOME_LEN)),
    behavior: observed ? Object.fromEntries(Object.keys(ZERO).map((k) => [k, observed[k as keyof BehaviorMetrics]])) as unknown as BehaviorMetrics : { ...ZERO }, trace: observed?.trail.map((p) => ({ ...p })) ?? [],
    setup: structuredClone(w.setup), params: { ...w.params }, outcomes: [],
  };
}

/** Historical germline only: somatic state and behavioral observations are not inferred. */
export function captureAncestorSpecimen(w: World, id: number): Specimen {
  const node = w.lineage.indexOf(id);
  if (node < 0) throw new Error('Genom przodka nie jest już dostępny w zachowanej genealogii.');
  const genome = w.lineage.reconstruct(node);
  if (!genome) throw new Error('Nie można odtworzyć genomu przodka.');
  const info = w.lineage.info(node);
  return { format: 'genesis-specimen', engineVersion: ENGINE_VERSION, provenance: 'archived-genome', environmentTick: w.tick,
    name: `Genom przodka #${id}`, sourceSeed: w.setup.seed, sourceTick: info.birthTick, organismId: id, generation: info.generation, parentId: info.parentId,
    genome: Array.from(genome), somaticWeights: new Array(GENOME_LEN).fill(0), eligibility: new Array(GENOME_LEN).fill(0), memory: new Array(N_MEM).fill(0), behavior: { ...ZERO }, trace: [],
    setup: structuredClone(w.setup), params: { ...w.params }, outcomes: [] };
}

/** Validate before admitting imported data to the lab; prevent hidden genotype substitutions. */
export function validateSpecimen(data: unknown): Specimen {
  const s = structuredClone(data) as Specimen;
  const vector = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every((x) => typeof x === 'number' && Number.isFinite(x));
  const supported = [ENGINE_VERSION,'0.4.0'];
  if (!s || s.format !== 'genesis-specimen' || !supported.includes(s.engineVersion) || !vector(s.genome, GENOME_LEN) || !vector(s.somaticWeights, GENOME_LEN) || !vector(s.memory, N_MEM) || !vector(s.eligibility, GENOME_LEN)) throw new Error('Niepoprawny lub niezgodny z wersją silnika okaz.');
  if (!s.setup || !s.params || !Array.isArray(s.trace) || s.trace.length > 64 || !Array.isArray(s.outcomes) || s.outcomes.length > 100) throw new Error('Niepełne dane okazu.');
  if (s.engineVersion==='0.4.0') {
    if (s.params.biomes===undefined) s.params.biomes=0;
    if (s.params.biomeContrast===undefined) s.params.biomeContrast=0.6;
    if (s.behavior && s.behavior.biomeTransitions===undefined) s.behavior.biomeTransitions=0;
  }
  if (!s.behavior || Object.keys(ZERO).some((k) => !Number.isFinite(s.behavior[k as keyof BehaviorMetrics]) || s.behavior[k as keyof BehaviorMetrics] < 0)) throw new Error('Niepoprawne obserwacje okazu.');
  if (s.trace.some((p) => ![p.tick, p.x, p.y, p.energy].every(Number.isFinite) || !Number.isSafeInteger(p.tick) || p.tick < 0 || p.energy < 0 || p.x < 0 || p.y < 0 || p.x > s.setup.width || p.y > s.setup.height)) throw new Error('Niepoprawna trajektoria okazu.');
  const ints = [s.sourceSeed, s.sourceTick, s.environmentTick, s.organismId, s.generation];
  if (!['live', 'archived-genome'].includes(s.provenance) || ints.some((v) => !Number.isSafeInteger(v) || v < 0) || (s.parentId !== null && (!Number.isSafeInteger(s.parentId) || s.parentId < 0)) || typeof s.name !== 'string' || s.name.length > 200) throw new Error('Niepoprawne pochodzenie okazu.');
  if (s.genome.some((v, i) => i < N_TRAITS ? v < 0 || v > 1 : Math.abs(v) > MAX_WEIGHT) || s.somaticWeights.some((v, i) => i < N_TRAITS ? v !== 0 : Math.abs(s.genome[i] + v) > MAX_WEIGHT + 1e-5) || s.memory.some((v) => Math.abs(v) > 1) || s.eligibility.some((v) => Math.abs(v) > 100)) throw new Error('Geny lub stan nauczony poza zakresem.');
  for (const [key, def] of Object.entries(DEFAULT_SETUP)) {
    const val = (s.setup as unknown as Record<string, unknown>)[key];
    if (typeof def === 'number' && (typeof val !== 'number' || !Number.isFinite(val))) throw new Error('Niepoprawna konfiguracja okazu.');
  }
  const normalized = validateSetup(s.setup);
  for (const key of ['width', 'height', 'cellSize', 'capacity', 'initialPopulation', 'patchCount'] as const) if (normalized[key] !== s.setup[key]) throw new Error('Konfiguracja okazu poza zakresem.');
  if (!['patches','uniform','gradient','oasis'].includes(s.setup.fertilityPattern) || !Array.isArray(s.setup.schedule) || s.setup.schedule.length > 1000 || s.setup.schedule.some((e) => !Number.isSafeInteger(e.tick) || e.tick < 0 || !e.spec || !['drought','bloom','coldSnap','cull','blight'].includes(e.spec.kind) || !Number.isFinite(e.spec.severity) || e.spec.severity < 0 || e.spec.severity > 1 || (e.spec.duration !== undefined && (!Number.isFinite(e.spec.duration) || e.spec.duration < 0)))) throw new Error('Niepoprawne zdarzenia konfiguracji.');
  for (const key of ['initialFoodFraction', 'founderEnergyFraction', 'founderDietMax'] as const) if (s.setup[key] < 0 || s.setup[key] > 1) throw new Error('Początkowa konfiguracja poza zakresem.');
  if (s.setup.founderWeightSd < 0 || s.setup.founderWeightSd > MAX_WEIGHT || s.setup.patchCount > 10000) throw new Error('Konfiguracja założycieli poza zakresem.');
  for (const outcome of s.outcomes) {
    if (!outcome || !supported.includes(outcome.engineVersion) || !['commonGarden', 'mutation', 'memory'].includes(outcome.mode) || !['genetic', 'somatic'].includes(outcome.state) || !Number.isSafeInteger(outcome.ticks) || outcome.ticks < 1 || outcome.ticks > 20000 || !Array.isArray(outcome.runs) || outcome.runs.length > 160 || !Array.isArray(outcome.temporal) || outcome.temporal.length > 100 || !Array.isArray(outcome.comparisons) || outcome.comparisons.length > 2 || !Array.isArray(outcome.notes) || outcome.notes.some((n) => typeof n !== 'string' || n.length > 2000)) throw new Error('Niepoprawne wyniki próby okazu.');
    if (outcome.runs.some((r) => ![r.seed, r.environmentTick, r.survival, r.offspring, r.energyAcquired, r.distance, r.successfulAttacks].every((v) => Number.isFinite(v) && v >= 0) || typeof r.genotype !== 'string' || typeof r.environment !== 'string')) throw new Error('Niepoprawne pomiary próby.');
    if (outcome.temporal.some((r) => ![r.delay, r.intactContrast, r.ablatedContrast, r.historyEffect].every(Number.isFinite))) throw new Error('Niepoprawna próba pamięci.');
  }
  for (const [key, meta] of Object.entries(PARAM_META)) {
    const val = (s.params as unknown as Record<string, number>)[key];
    if (!Number.isFinite(val) || val < meta.min || val > meta.max) throw new Error(`Parametr ${key} poza zakresem.`);
  }
  return structuredClone(s);
}

/** Coarse ecology profiles are candidates only. Compatibility is measured bilaterally. */
export function speciesAnalysis(w: World): SpeciesAnalysis {
  const p = w.pool;
  const label = (i: number) => p.plantSpecialization[i] < 0.5 ? 'Profil pokarmu A' : 'Profil pokarmu B';
  const counts = new Map<string, number>();
  for (let i = 0; i < p.n; i++) counts.set(label(i), (counts.get(label(i)) ?? 0) + 1);
  let sampledPairs = 0, compatibleWithin = 0, withinPairs = 0, compatibleBetween = 0, betweenPairs = 0;
  const stride = Math.max(1, Math.floor(p.n / 64));
  const sample = Array.from({ length: Math.min(64, Math.ceil(p.n / stride)) }, (_, i) => i * stride);
  const parent = sample.map((_, i) => i);
  const root = (i: number): number => { while (parent[i] !== i) i = parent[i]; return i; };
  const unite = (i: number, j: number) => { parent[root(j)] = root(i); };
  for (let i = 0; i < p.n && i < stride * 64; i += stride) for (let j = i + stride; j < p.n && j < stride * 64; j += stride) {
    const same = label(i) === label(j);
    const ok = w.mateCompatibility(i, j);
    if (ok) unite(sample.indexOf(i), sample.indexOf(j));
    sampledPairs++;
    if (same) { withinPairs++; if (ok) compatibleWithin++; } else { betweenPairs++; if (ok) compatibleBetween++; }
  }
  const components = new Map<number, number[]>();
  sample.forEach((slot, i) => { const r = root(i); const nodes = components.get(r) ?? []; nodes.push(slot); components.set(r, nodes); });
  const candidateGroups = [...components.values()].map((slots, k) => ({ label: `Grupa zgodności ${k + 1}`, count: slots.length, centroid: Object.fromEntries(TRAIT_NAMES.map((t, gene) => [t, slots.reduce((sum, slot) => sum + p.genomes[slot * GENOME_LEN + gene], 0) / slots.length])) }));
  // The engine records successful mating events using the same food-profile boundary.
  const reproductive = { matingAttempts: w.mating.within + w.mating.between + w.mating.rejectedWithin + w.mating.rejectedBetween, mateRejections: w.mating.rejectedWithin + w.mating.rejectedBetween, withinMatings: w.mating.within, betweenMatings: w.mating.between };
  const matings = reproductive.withinMatings + reproductive.betweenMatings;
  return { sexual: w.params.sexual>=0.5, candidateGroups, sampledOrganisms: sample.length, foodProfiles: [...counts].map(([label, count]) => ({ label, count })), sampledPairs,
    compatibleWithin, withinPairs, compatibleBetween, betweenPairs, ...reproductive, geneFlow: w.params.sexual>=0.5 && matings ? reproductive.betweenMatings / matings : null };
}
