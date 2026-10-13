/** Controlled experiments run on private worlds and yield between bounded chunks. */
import { think } from './brain';
import { validateSpecimen, type Specimen } from './behavior';
import { ENGINE_VERSION, GENOME_LEN, IN_MEM, MAX_WEIGHT, N_HID, N_IN, N_MEM, N_OUT, N_TRAITS, OUT_MEM, PHYSIO, TRAIT_MEMORY } from './constants';
import { mergeParams, validateSetup, type WorldParams, type WorldSetup } from './config';
import { deserializeWorld } from './serialize';
import { pairedSeedTest, type WelchResult } from './statsutil';
import { World } from './world';

export interface LabEnvironment { label: string; kind: 'saved' | 'configured'; bytes?: Uint8Array; setup?: Partial<WorldSetup>; params?: Partial<WorldParams> }
export interface LabRequest {
  mode: 'commonGarden' | 'mutation' | 'memory';
  specimenA: Specimen;
  specimenB?: Specimen;
  environments: LabEnvironment[];
  seeds: number[];
  ticks: number;
  gene?: number;
  value?: number;
  somatic?: boolean;
}
export interface LabProgress { done: number; total: number }
export interface LabRun {
  seed: number;
  genotype: string;
  environment: string;
  environmentKind: 'saved' | 'configured';
  environmentTick: number;
  survival: number;
  offspring: number;
  energyAcquired: number;
  distance: number;
  successfulAttacks: number;
}
export interface TemporalResult { delay: number; intactContrast: number; ablatedContrast: number; historyEffect: number }
export interface LabResult {
  engineVersion: string;
  mode: LabRequest['mode'];
  state: 'genetic' | 'somatic';
  ticks: number;
  runs: LabRun[];
  comparisons: { environment: string; survival: WelchResult; offspring: WelchResult }[];
  temporal: TemporalResult[];
  intervention: { gene: number; from: number; to: number } | null;
  notes: string[];
}

export function interveneGenome(genome: readonly number[], gene: number, value: number): Float32Array {
  if (genome.length !== GENOME_LEN || !Number.isInteger(gene) || gene < 0 || gene >= GENOME_LEN || !Number.isFinite(value)) throw new Error('Niepoprawny indeks lub wartość genu.');
  const lo = gene < N_TRAITS ? 0 : -MAX_WEIGHT, hi = gene < N_TRAITS ? 1 : MAX_WEIGHT;
  if (value < lo || value > hi) throw new Error(`Wartość genu musi być w zakresie ${lo}…${hi}.`);
  const out = Float32Array.from(genome);
  out[gene] = value;
  if (out[gene] === genome[gene]) throw new Error('Interwencja musi faktycznie zmieniać wybrany gen.');
  return out;
}

/** Cue side differs; all inputs at the decision tick are identical. No online reward learning. */
export function temporalMemoryProbe(genome: Float32Array, delays = [0, 5, 20, 60]): TemporalResult[] {
  if (genome.length !== GENOME_LEN) throw new Error('Niepoprawny genom próby pamięci.');
  const response = (cue: number, delay: number, ablated: boolean) => {
    const inp = new Float64Array(N_IN), hid = new Float64Array(N_HID), out = new Float64Array(N_OUT), mem = new Float64Array(N_MEM);
    const lambda = PHYSIO.memDecayMin + genome[TRAIT_MEMORY] * (PHYSIO.memDecayMax - PHYSIO.memDecayMin);
    for (let t = 0; t <= delay + 1; t++) {
      inp.fill(0); inp[0] = 1; inp[1] = 0.5; inp[11] = 1;
      if (t === 0) inp[3] = cue;
      if (!ablated) for (let k = 0; k < N_MEM; k++) inp[IN_MEM + k] = mem[k];
      think(genome, 0, inp, hid, out);
      for (let k = 0; k < N_MEM; k++) mem[k] = lambda * mem[k] + (1 - lambda) * out[OUT_MEM + k];
    }
    return out[0];
  };
  return delays.map((delay) => {
    if (!Number.isInteger(delay) || delay < 0 || delay > 1000) throw new Error('Niepoprawne opóźnienie próby.');
    const intactContrast = (response(0.8, delay, false) - response(-0.8, delay, false)) / 2;
    const ablatedContrast = (response(0.8, delay, true) - response(-0.8, delay, true)) / 2;
    return { delay, intactContrast, ablatedContrast, historyEffect: intactContrast - ablatedContrast };
  });
}

function garden(env: LabEnvironment, seed: number, specimen: Specimen, somatic: boolean): World {
  if (env.kind === 'saved' && !env.bytes) throw new Error('Zapisane środowisko wymaga pełnego stanu świata.');
  const w = env.kind === 'saved' ? deserializeWorld(env.bytes!) : new World({ ...env.setup, seed }, env.params);
  const count = Math.min(8, w.setup.capacity);
  const genome = Float32Array.from(specimen.genome);
  w.seedPopulation(Array.from({ length: count }, () => genome), 0.6, seed);
  if (somatic) for (let i = 0; i < count; i++) {
    w.pool.somaticWeights.set(specimen.somaticWeights, i * GENOME_LEN);
    w.pool.mem.set(specimen.memory, i * N_MEM);
    w.pool.eligibility.set(specimen.eligibility, i * GENOME_LEN);
  }
  return w;
}

export function* runLabGenerator(req: LabRequest): Generator<LabProgress, LabResult> {
  if (!['commonGarden', 'mutation', 'memory'].includes(req.mode)) throw new Error('Nieznany rodzaj próby.');
  const a = validateSpecimen(req.specimenA);
  if (!Number.isInteger(req.ticks) || req.ticks < 1 || req.ticks > 20000) throw new Error('Próba wymaga 1–20000 ticków.');
  if (req.somatic && (a.provenance === 'archived-genome' || req.specimenB?.provenance === 'archived-genome')) throw new Error('Stan nauczony przodka nie jest zapisany; wybierz próbę genetyczną.');
  const result: LabResult = { engineVersion: ENGINE_VERSION, mode: req.mode, state: req.somatic ? 'somatic' : 'genetic', ticks: req.ticks, runs: [], comparisons: [], temporal: [], intervention: null, notes: [] };
  if (a.engineVersion!==ENGINE_VERSION) result.notes.push(`Okaz pochodzi z silnika ${a.engineVersion}; tę próbę wykonano w ${ENGINE_VERSION}. Zachowano genotyp i stan nauczony, ale trajektorie między wersjami nie są równoważne.`);
  if (req.mode === 'memory') {
    const g = Float32Array.from(a.genome);
    if (req.somatic) for (let i = N_TRAITS; i < GENOME_LEN; i++) g[i] += a.somaticWeights[i];
    result.temporal = temporalMemoryProbe(g);
    result.notes.push('Kontrast reakcji po przeciwnych wskazówkach, przy identycznym bieżącym bodźcu. Kontrola zeruje wejścia pamięci; próba wykrywa zależność od historii, nie planowanie.');
    yield { done: 1, total: 1 }; return result;
  }
  if (!Number.isInteger(req.ticks) || req.ticks < 1 || req.ticks > 20000 || req.seeds.length < 2 || req.seeds.length > 40 || new Set(req.seeds).size !== req.seeds.length || req.seeds.some((s) => !Number.isInteger(s) || s < 0 || s > 0xffffffff)) throw new Error('Próba wymaga 2–40 unikalnych seedów i 1–20000 ticków.');
  if (req.environments.length !== (req.mode === 'commonGarden' ? 2 : 1)) throw new Error('Porównanie genotypów wymaga dwóch środowisk; interwencja jednego.');
  let b: Specimen;
  if (req.mode === 'mutation') {
    const changed = interveneGenome(a.genome, req.gene!, req.value!);
    b = validateSpecimen({ ...a, name: `${a.name} · zmiana genu ${req.gene}`, genome: Array.from(changed), ...(!req.somatic ? { somaticWeights: new Array(GENOME_LEN).fill(0), eligibility: new Array(GENOME_LEN).fill(0), memory: new Array(N_MEM).fill(0) } : {}) });
    result.intervention = { gene: req.gene!, from: a.genome[req.gene!], to: changed[req.gene!] };
  } else { if (!req.specimenB) throw new Error('Brak drugiego genotypu.'); b = validateSpecimen(req.specimenB); }
  if (b.engineVersion!==ENGINE_VERSION && req.mode==='commonGarden') result.notes.push(`Okaz B pochodzi z silnika ${b.engineVersion}; tę próbę wykonano w ${ENGINE_VERSION}. Porównanie wersji nie gwarantuje równoważności dawnych trajektorii.`);
  if (new Set(req.environments.map((e) => e.label)).size !== req.environments.length) throw new Error('Środowiska muszą mieć różne nazwy.');
  for (const env of req.environments) {
    if (!['saved', 'configured'].includes(env.kind) || typeof env.label !== 'string' || !env.label.length || env.label.length > 200) throw new Error('Niepoprawne środowisko próby.');
    if (env.kind === 'configured') validateSpecimen({ ...a, setup: validateSetup(env.setup ?? {}), params: mergeParams(env.params) });
  }
  const total = req.environments.length * 2 * req.seeds.length;
  let done = 0;
  for (const env of req.environments) for (const [variant, specimen] of [a, b].entries()) for (const seed of req.seeds) {
    const w = garden(env, seed, specimen, !!req.somatic);
    const p = w.pool;
    const ids = Array.from(p.id.subarray(0, p.n));
    const cohort = new Map(ids.map((id) => [id, { survival: 0, offspring: 0, energy: 0, distance: 0, attacks: 0 }]));
    const startTick = w.tick;
    for (let tick = 0; tick < req.ticks && w.status === 'running'; tick++) {
      for (let i = 0; i < p.n; i++) {
        const rec = cohort.get(p.id[i]);
        if (!rec) continue;
        rec.survival++;
        rec.offspring = p.offspring[i];
        const m = w.observe(p.id[i])!;
        rec.energy = m.foodEnergy + m.meatEnergy; rec.distance = m.distance; rec.attacks = m.successfulAttacks;
      }
      w.step();
      if (tick % 50 === 49) yield { done: done + (tick + 1) / req.ticks, total };
    }
    for (let i = 0; i < p.n; i++) {
      const rec = cohort.get(p.id[i]); if (!rec) continue;
      const m = w.observe(p.id[i])!;
      rec.offspring = p.offspring[i]; rec.energy = m.foodEnergy + m.meatEnergy; rec.distance = m.distance; rec.attacks = m.successfulAttacks;
    }
    const records = [...cohort.values()];
    const avg = (key: keyof typeof records[number]) => records.reduce((sum, r) => sum + r[key], 0) / Math.max(1, records.length);
    result.runs.push({ seed, genotype: `${variant === 0 ? 'A' : 'B'}: ${specimen.name}`, environment: env.label, environmentKind: env.kind, environmentTick: startTick,
      survival: avg('survival'), offspring: avg('offspring'), energyAcquired: avg('energy'), distance: avg('distance'), successfulAttacks: avg('attacks') });
    yield { done: ++done, total };
  }
  for (const env of req.environments) {
    const ra = result.runs.filter((r) => r.environment === env.label && r.genotype.startsWith('A:'));
    const rb = result.runs.filter((r) => r.environment === env.label && r.genotype.startsWith('B:'));
    result.comparisons.push({ environment: env.label, survival: pairedSeedTest(ra, rb, (r) => r.survival), offspring: pairedSeedTest(ra, rb, (r) => r.offspring) });
  }
  result.notes.push('Każda próba zaczyna się z maksymalnie 8 kopiami jednego genotypu: energia 60%, wiek i zdrowie jednakowe, pozycje i RNG zgodne dla danego seeda. Przeżycie i potomstwo dotyczą początkowej kohorty; potomkowie pozostają w świecie.',
    'Energia i ruch zmarłego osobnika obejmują obserwacje do początku jego ostatniego ticku. Środowisko zapisane zachowuje mapę, porę i zdarzenia; środowisko skonfigurowane jest tworzone od początku.');
  return result;
}
