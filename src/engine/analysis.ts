/**
 * Sondy zachowań: czy dziedziczone sieci neuronowe w ogóle reagują na bodźce w sposób
 * wyglądający na adaptacyjny? Każda sonda podaje sieci parę syntetycznych wejść różniących się
 * jednym bodźcem i mierzy różnicę wyjścia (znak ustawiony tak, że dodatni = „adaptacyjnie”).
 *
 * To NIE jest dowód inteligencji. Sondy wykrywają wyłącznie proste, odruchowe zależności
 * wejście→wyjście; nie wykryją pamięci, planowania ani strategii zależnych od historii.
 * Wynik trzeba zawsze porównywać z losowymi sieciami (baseline) — inaczej asymetrie losowych wag
 * mogłyby zostać pomylone z zachowaniem.
 */
import { think } from './brain';
import { GENOME_LEN, N_HID, N_IN, N_OUT, TRAIT_NAMES } from './constants';
import { randomGenome } from './genome';
import { Rng } from './rng';
import { deserializeWorld, serializeWorld } from './serialize';
import type { AblationGroup, World } from './world';

export interface ProbeSpec {
  key: string;
  label: string;
  description: string;
}

export interface ProbeResult extends ProbeSpec {
  /** średnia „adaptacyjnego” odchylenia wyjścia po populacji (−1..1) */
  mean: number;
  /** odsetek organizmów z dodatnim wynikiem */
  fraction: number;
  baselineMean: number;
  baselineSd: number;
  /** (mean − baselineMean) / SE baseline — ile błędów standardowych ponad losowość */
  z: number;
}

type Probe = ProbeSpec & { f: (r: Responder) => number };

interface Responder {
  turn(set: Record<number, number>): number;
  thrust(set: Record<number, number>): number;
  eat(set: Record<number, number>): number;
}

// indeksy wejść (patrz INPUT_LABELS)
const I = { energy: 1, foodFwd: 2, foodLat: 3, foodRange: 4, foodHere: 5, crowd: 6, nbFwd: 7, nbLat: 8, wallFwd: 9, wallLat: 10 };

const PROBES: Probe[] = [
  {
    key: 'foodTaxis',
    label: 'Taksja: skręt w stronę pokarmu',
    description: 'Pokarm z lewej vs z prawej → czy skręt zgodny z kierunkiem pokarmu',
    f: (r) => (r.turn({ [I.foodLat]: 0.8, [I.foodRange]: 0.5 }) - r.turn({ [I.foodLat]: -0.8, [I.foodRange]: 0.5 })) / 2,
  },
  {
    key: 'foodApproach',
    label: 'Podążanie za pokarmem z przodu',
    description: 'Pokarm przed vs za organizmem → większy ciąg, gdy pokarm jest z przodu',
    f: (r) => (r.thrust({ [I.foodFwd]: 0.8, [I.foodRange]: 0.5 }) - r.thrust({ [I.foodFwd]: -0.8, [I.foodRange]: 0.5 })) / 2,
  },
  {
    key: 'grazing',
    label: 'Zwalnianie na pokarmie',
    description: 'Pokarm w bieżącej komórce vs brak → mniejszy ciąg (spasanie w miejscu)',
    f: (r) => -(r.thrust({ [I.foodHere]: 0.8 }) - r.thrust({ [I.foodHere]: 0 })),
  },
  {
    key: 'eatSelective',
    label: 'Selektywne żerowanie',
    description: 'Wysiłek jedzenia rośnie, gdy pod organizmem jest pokarm (oszczędza koszt jedzenia w pustce)',
    f: (r) => r.eat({ [I.foodHere]: 0.8 }) - r.eat({ [I.foodHere]: 0 }),
  },
  {
    key: 'hunger',
    label: 'Aktywność przy głodzie',
    description: 'Głodny (10% energii) vs syty (90%) → większy ciąg, gdy głodny',
    f: (r) => r.thrust({ [I.energy]: 0.1 }) - r.thrust({ [I.energy]: 0.9 }),
  },
  {
    key: 'neighborAvoid',
    label: 'Unikanie sąsiadów',
    description: 'Sąsiad z lewej vs z prawej → skręt w przeciwną stronę',
    f: (r) => -(r.turn({ [I.nbLat]: 0.8 }) - r.turn({ [I.nbLat]: -0.8 })) / 2,
  },
  {
    key: 'wallAvoid',
    label: 'Unikanie ścian',
    description: 'Wektor odpychania od ściany z lewej vs z prawej → skręt od ściany',
    f: (r) => (r.turn({ [I.wallLat]: 0.8 }) - r.turn({ [I.wallLat]: -0.8 })) / 2,
  },
];

export const PROBE_SPECS: ProbeSpec[] = PROBES.map(({ key, label, description }) => ({ key, label, description }));

function evaluate(genomes: Float32Array, n: number): { means: number[]; fractions: number[]; sds: number[] } {
  const inp = new Float64Array(N_IN);
  const hid = new Float64Array(N_HID);
  const out = new Float64Array(N_OUT);
  const mk = (g: Float32Array, off: number): Responder => {
    const run = (set: Record<number, number>): Float64Array => {
      inp.fill(0);
      inp[0] = 1;
      inp[I.energy] = 0.5;
      inp[11] = 1;
      for (const k in set) inp[Number(k)] = set[k];
      think(g, off, inp, hid, out);
      return out;
    };
    return {
      turn: (s) => run(s)[0],
      thrust: (s) => (run(s)[1] + 1) / 2,
      eat: (s) => (run(s)[2] + 1) / 2,
    };
  };
  const sum = new Float64Array(PROBES.length);
  const sq = new Float64Array(PROBES.length);
  const pos = new Float64Array(PROBES.length);
  for (let i = 0; i < n; i++) {
    const r = mk(genomes, i * GENOME_LEN);
    for (let p = 0; p < PROBES.length; p++) {
      const v = PROBES[p].f(r);
      sum[p] += v;
      sq[p] += v * v;
      if (v > 0) pos[p]++;
    }
  }
  const means: number[] = [];
  const fractions: number[] = [];
  const sds: number[] = [];
  for (let p = 0; p < PROBES.length; p++) {
    const m = sum[p] / n;
    means.push(m);
    fractions.push(pos[p] / n);
    sds.push(Math.sqrt(Math.max(0, sq[p] / n - m * m)));
  }
  return { means, fractions, sds };
}

let baselineCache: { means: number[]; sds: number[]; n: number } | null = null;

/** Baseline: te same sondy na losowych sieciach o rozkładzie wag założycieli. */
function baseline(weightSd: number): { means: number[]; sds: number[]; n: number } {
  if (baselineCache) return baselineCache;
  const n = 2000;
  const g = new Float32Array(n * GENOME_LEN);
  const rng = new Rng(0xbadc0de);
  for (let i = 0; i < n; i++) randomGenome(rng, g, i * GENOME_LEN, weightSd);
  const e = evaluate(g, n);
  baselineCache = { means: e.means, sds: e.sds, n };
  return baselineCache;
}

export function probeBehavior(w: World): { results: ProbeResult[]; n: number } {
  const n = w.pool.n;
  if (n === 0) return { results: [], n: 0 };
  const e = evaluate(w.pool.genomes, n);
  const b = baseline(w.setup.founderWeightSd);
  const results = PROBES.map<ProbeResult>((p, i) => {
    const se = b.sds[i] / Math.sqrt(n) || 1e-9;
    return {
      key: p.key,
      label: p.label,
      description: p.description,
      mean: e.means[i],
      fraction: e.fractions[i],
      baselineMean: b.means[i],
      baselineSd: b.sds[i],
      z: (e.means[i] - b.means[i]) / se,
    };
  });
  return { results, n };
}

// ——————————————————————————————————————————————————————————————————————
// Test ablacji: które zmysły są naprawdę używane i czy się opłacają?
// ——————————————————————————————————————————————————————————————————————

export interface CohortStats {
  n: number;
  /** odsetek kohorty żyjący na końcu okna */
  survival: number;
  survivalSe: number;
  /** potomstwo urodzone w oknie na organizm kohorty (żywy lub zmarły w oknie) */
  offspring: number;
  offspringSe: number;
  /** średnia energia (ułamek) wśród ocalałych */
  energy: number;
}

export interface AblationRow {
  group: AblationGroup;
  label: string;
  /** kohorta bez zmysłu (nieparzyste id) */
  ablated: CohortStats;
  /** kohorta nienaruszona (parzyste id) w tym samym świecie */
  intact: CohortStats;
  /** korzyść ze zmysłu = nienaruszeni − ablowani, skorygowana o kontrast zerowy parzyste/nieparzyste */
  dSurvival: number;
  dOffspring: number;
  /** błąd standardowy różnicy */
  seSurvival: number;
  seOffspring: number;
  zSurvival: number;
  zOffspring: number;
}

export interface AblationSuite {
  ticks: number;
  population: number;
  /** kontrast zerowy: ta sama procedura bez żadnej ablacji */
  nullRow: { dSurvival: number; dOffspring: number };
  rows: AblationRow[];
}

export const ABLATION_GROUPS: { group: AblationGroup; label: string }[] = [
  { group: 'food', label: 'Zmysł pokarmu' },
  { group: 'neighbors', label: 'Zmysł sąsiadów (tłok, rozmiar, dieta)' },
  { group: 'memory', label: 'Pamięć rekurencyjna' },
  { group: 'energy', label: 'Czucie własnej energii' },
  { group: 'walls', label: 'Zmysł ścian' },
  { group: 'temperature', label: 'Czucie temperatury' },
];

interface CohortRun {
  odd: CohortStats;
  even: CohortStats;
}

function cohortStats(vals: { alive: number; kids: number; energy: number }[]): CohortStats {
  const n = vals.length;
  if (n === 0) return { n: 0, survival: 0, survivalSe: 0, offspring: 0, offspringSe: 0, energy: 0 };
  let sa = 0, sk = 0, se = 0, alive = 0;
  for (const v of vals) {
    sa += v.alive;
    sk += v.kids;
    if (v.alive) {
      se += v.energy;
      alive++;
    }
  }
  const ps = sa / n;
  const mk = sk / n;
  let vk = 0;
  for (const v of vals) vk += (v.kids - mk) ** 2;
  vk /= Math.max(1, n - 1);
  return { n, survival: ps, survivalSe: Math.sqrt((ps * (1 - ps)) / n), offspring: mk, offspringSe: Math.sqrt(vk / n), energy: alive ? se / alive : 0 };
}

/** Uruchamia świat `ticks` ticków i zwraca statystyki kohort wyznaczonych parzystością id z chwili startu. */
function runCohorts(w: World, ticks: number): CohortRun {
  const p = w.pool;
  const L = w.lineage;
  const start = new Map<number, { node: number; kids: number }>();
  for (let i = 0; i < p.n; i++) start.set(p.id[i], { node: p.lin[i], kids: L.kids[p.lin[i]] });
  w.run(ticks);
  const alive = new Map<number, number>();
  for (let i = 0; i < p.n; i++) alive.set(p.id[i], p.energy[i] / p.maxE[i]);
  const odd: { alive: number; kids: number; energy: number }[] = [];
  const even: { alive: number; kids: number; energy: number }[] = [];
  for (const [id, s] of start) {
    const e = alive.get(id);
    const rec = { alive: e === undefined ? 0 : 1, kids: L.kids[s.node] - s.kids, energy: e ?? 0 };
    (id % 2 === 1 ? odd : even).push(rec);
  }
  return { odd: cohortStats(odd), even: cohortStats(even) };
}

/**
 * Test kohortowy (kontrfaktyczny, w tym samym świecie): połowa organizmów (nieparzyste id) dostaje wejścia danej grupy
 * podstawione stałą średnią populacji (informacja znika, punkt pracy sieci zostaje), druga połowa jest nienaruszona.
 * Porównujemy przeżycie i liczbę potomstwa w oknie `ticks`. Dzięki temu mierzymy **korzyść indywidualną** ze zmysłu
 * przy tym samym otoczeniu ekologicznym (a nie efekt „wszyscy naraz”, który zaburza np. relację drapieżnik–ofiara).
 * Kontrast zerowy (ta sama procedura bez ablacji) odejmujemy, by wyeliminować systematyczną różnicę parzyste/nieparzyste.
 * Dodatni wynik = zmysł się opłaca; ≈ 0 = organizmy go nie wykorzystują; ujemny = wykorzystanie szkodzi.
 */
export function ablationSuite(
  world: World,
  ticks = 400,
  groups: AblationGroup[] = ABLATION_GROUPS.map((g) => g.group),
  onRow?: (row: AblationRow, done: number, total: number) => void,
): AblationSuite {
  const bytes = serializeWorld(world);
  const nullW = deserializeWorld(bytes);
  const nul = runCohorts(nullW, ticks);
  const nullRow = { dSurvival: nul.even.survival - nul.odd.survival, dOffspring: nul.even.offspring - nul.odd.offspring };
  const rows: AblationRow[] = [];
  groups.forEach((group, k) => {
    const w = deserializeWorld(bytes);
    w.measureInputMeans();
    w.ablate = group;
    w.ablateOddOnly = true;
    const r = runCohorts(w, ticks);
    const dS = r.even.survival - r.odd.survival - nullRow.dSurvival;
    const dO = r.even.offspring - r.odd.offspring - nullRow.dOffspring;
    const seS = Math.sqrt(r.even.survivalSe ** 2 + r.odd.survivalSe ** 2) || 1e-9;
    const seO = Math.sqrt(r.even.offspringSe ** 2 + r.odd.offspringSe ** 2) || 1e-9;
    const row: AblationRow = {
      group,
      label: ABLATION_GROUPS.find((g) => g.group === group)?.label ?? group,
      ablated: r.odd,
      intact: r.even,
      dSurvival: dS,
      dOffspring: dO,
      seSurvival: seS,
      seOffspring: seO,
      zSurvival: dS / seS,
      zOffspring: dO / seO,
    };
    rows.push(row);
    onRow?.(row, k + 1, groups.length);
  });
  return { ticks, population: world.pool.n, nullRow, rows };
}

// ——————————————————————————————————————————————————————————————————————
// Strategie: klastrowanie populacji (k-średnich, deterministyczne)
// ——————————————————————————————————————————————————————————————————————

export interface StrategyCluster {
  label: string;
  count: number;
  share: number;
  centroid: Record<string, number>;
  meanEnergy: number;
  meanAge: number;
  meanOffspring: number;
  meanGeneration: number;
}

const FEATURES = TRAIT_NAMES.map((t, i) => ({ name: t, idx: i })).filter((f) => f.name !== 'hue');

const WORDS: Record<string, [string, string]> = {
  size: ['mały', 'duży'],
  speed: ['wolny', 'szybki'],
  sense: ['krótkowzroczny', 'dalekowzroczny'],
  bite: ['oszczędny', 'żarłoczny'],
  diet: ['roślinożerca', 'drapieżnik'],
  memory: ['zapominalski', 'pamiętliwy'],
  coldTolerance: ['ciepłolubny', 'odporny na zimno'],
  reproThreshold: ['skory do rozrodu', 'cierpliwy w rozrodzie'],
  investment: ['płodny (małe potomstwo)', 'troskliwy (duże potomstwo)'],
  maturity: ['szybko dojrzewający', 'późno dojrzewający'],
};

/** Grupuje żywe organizmy po cechach fizycznych i nazywa grupy według najsilniejszych odchyleń od średniej populacji. */
export function clusterStrategies(world: World, k = 4): StrategyCluster[] {
  const p = world.pool;
  const n = p.n;
  if (n === 0) return [];
  const K = Math.max(1, Math.min(k, n));
  const F = FEATURES.length;
  const X = new Float64Array(n * F);
  const mu = new Float64Array(F);
  const sg = new Float64Array(F);
  for (let i = 0; i < n; i++)
    for (let f = 0; f < F; f++) {
      const v = p.genomes[i * GENOME_LEN + FEATURES[f].idx];
      X[i * F + f] = v;
      mu[f] += v / n;
    }
  for (let i = 0; i < n; i++) for (let f = 0; f < F; f++) sg[f] += (X[i * F + f] - mu[f]) ** 2 / n;
  for (let f = 0; f < F; f++) sg[f] = Math.sqrt(sg[f]) || 1e-9;

  // k-means++ z ustalonym ziarnem; cechy w skali oryginalnej [0,1], bo są już znormalizowane
  const rng = new Rng(0x5eed, 7);
  const C = new Float64Array(K * F);
  const dist2 = (i: number, c: number): number => {
    let s = 0;
    for (let f = 0; f < F; f++) {
      const d = X[i * F + f] - C[c * F + f];
      s += d * d;
    }
    return s;
  };
  const first = rng.int(n);
  for (let f = 0; f < F; f++) C[f] = X[first * F + f];
  const dmin = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < K; c++) {
    let tot = 0;
    for (let i = 0; i < n; i++) {
      const d = dist2(i, c - 1);
      if (d < dmin[i]) dmin[i] = d;
      tot += dmin[i];
    }
    let r = rng.float() * tot;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= dmin[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    for (let f = 0; f < F; f++) C[c * F + f] = X[pick * F + f];
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < 30; it++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < K; c++) {
        const d = dist2(i, c);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed++;
      }
    }
    const cnt = new Int32Array(K);
    C.fill(0);
    for (let i = 0; i < n; i++) {
      cnt[assign[i]]++;
      for (let f = 0; f < F; f++) C[assign[i] * F + f] += X[i * F + f];
    }
    for (let c = 0; c < K; c++) if (cnt[c] > 0) for (let f = 0; f < F; f++) C[c * F + f] /= cnt[c];
    if (changed === 0 && it > 0) break;
  }

  const out: StrategyCluster[] = [];
  for (let c = 0; c < K; c++) {
    let cnt = 0, sE = 0, sA = 0, sO = 0, sG = 0;
    for (let i = 0; i < n; i++)
      if (assign[i] === c) {
        cnt++;
        sE += p.energy[i] / p.maxE[i];
        sA += p.age[i];
        sO += p.offspring[i];
        sG += p.generation[i];
      }
    if (cnt === 0) continue;
    const centroid: Record<string, number> = {};
    const z: { f: number; z: number }[] = [];
    for (let f = 0; f < F; f++) {
      centroid[FEATURES[f].name] = C[c * F + f];
      z.push({ f, z: (C[c * F + f] - mu[f]) / sg[f] });
    }
    z.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    const words: string[] = [];
    if (C[c * F + FEATURES.findIndex((q) => q.name === 'diet')] > 0.3) words.push('drapieżnik');
    for (const e of z) {
      if (words.length >= 2 || Math.abs(e.z) < 0.5) break;
      const name = FEATURES[e.f].name;
      const w = WORDS[name]?.[e.z > 0 ? 1 : 0];
      if (w && !words.includes(w) && !(name === 'diet' && words.includes('drapieżnik'))) words.push(w);
    }
    out.push({
      label: words.length ? words.join(', ') : 'przeciętny',
      count: cnt,
      share: cnt / n,
      centroid,
      meanEnergy: sE / cnt,
      meanAge: sA / cnt,
      meanOffspring: sO / cnt,
      meanGeneration: sG / cnt,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

