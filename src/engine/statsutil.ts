/**
 * Elementarna statystyka dla serii eksperymentów (poza ścieżką symulacji — wolno używać log/exp).
 */

export function mean(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
}

/** Odchylenie standardowe z próby (n−1). */
export function sd(a: ArrayLike<number>): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2;
  return Math.sqrt(s / (a.length - 1));
}

function lgamma(x: number): number {
  // przybliżenie Lanczosa
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -t + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Uregulowana niekompletna funkcja beta I_x(a,b). */
function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Dystrybuanta rozkładu t-Studenta. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const p = 0.5 * ibeta(x, df / 2, 0.5);
  return t > 0 ? 1 - p : p;
}

/** Kwantyl 0,975 rozkładu t (bisekcja). */
export function tQuantile975(df: number): number {
  let lo = 0;
  let hi = 200;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < 0.975) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Ci {
  mean: number;
  sd: number;
  n: number;
  lo: number;
  hi: number;
}

/** 95 % przedział ufności średniej (t-Studenta). */
export function ci95(a: ArrayLike<number>): Ci {
  const n = a.length;
  const m = mean(a);
  const s = sd(a);
  if (n < 2) return { mean: m, sd: s, n, lo: m, hi: m };
  const h = tQuantile975(n - 1) * (s / Math.sqrt(n));
  return { mean: m, sd: s, n, lo: m - h, hi: m + h };
}

export interface WelchResult {
  meanA: number;
  meanB: number;
  diff: number;
  t: number;
  df: number;
  /** wartość p testu dwustronnego */
  p: number;
  ciLo: number;
  ciHi: number;
}

/** Test t Welcha dla dwóch niezależnych prób (nierówne wariancje). */
export function welchTest(a: ArrayLike<number>, b: ArrayLike<number>): WelchResult {
  const ma = mean(a);
  const mb = mean(b);
  const va = sd(a) ** 2 / Math.max(1, a.length);
  const vb = sd(b) ** 2 / Math.max(1, b.length);
  const se = Math.sqrt(va + vb);
  const diff = mb - ma;
  if (a.length < 2 || b.length < 2 || se === 0) return { meanA: ma, meanB: mb, diff, t: 0, df: 0, p: se === 0 && diff !== 0 ? 0 : 1, ciLo: diff, ciHi: diff };
  const t = diff / se;
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  const p = 2 * (1 - tCdf(Math.abs(t), df));
  const h = tQuantile975(df) * se;
  return { meanA: ma, meanB: mb, diff, t, df, p, ciLo: diff - h, ciHi: diff + h };
}

/** Paired conditions: uncertainty is measured across within-seed differences. */
export function pairedTest(a: ArrayLike<number>, b: ArrayLike<number>): WelchResult {
  if (a.length !== b.length || a.length < 2) throw new Error('Test sparowany wymaga co najmniej dwóch równolicznych par.');
  const differences = Array.from({ length: a.length }, (_, i) => {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new Error('Wyniki testu muszą być skończonymi liczbami.');
    return b[i] - a[i];
  });
  const diff = mean(differences);
  const se = sd(differences) / Math.sqrt(differences.length);
  const df = differences.length - 1;
  const t = se ? diff / se : diff === 0 ? 0 : Math.sign(diff) * Infinity;
  const h = tQuantile975(df) * se;
  return { meanA: mean(a), meanB: mean(b), diff, t, df, p: se ? Math.max(0, 2 * (1 - tCdf(Math.abs(t), df))) : diff === 0 ? 1 : 0, ciLo: diff - h, ciHi: diff + h };
}

/** Align by seed, rejecting accidental duplicates or a mismatched experimental design. */
export function pairedSeedTest<T extends { seed: number }>(a: readonly T[], b: readonly T[], value: (row: T) => number): WelchResult {
  const bySeed = new Map(b.map((row) => [row.seed, row]));
  if (bySeed.size !== b.length || new Set(a.map((row) => row.seed)).size !== a.length || a.length !== b.length || a.some((row) => !bySeed.has(row.seed))) {
    throw new Error('Warunki A i B muszą zawierać te same, unikalne seedy.');
  }
  return pairedTest(a.map(value), a.map((row) => value(bySeed.get(row.seed)!)));
}
