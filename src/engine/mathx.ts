/**
 * Funkcje matematyczne używające wyłącznie +,-,*,/ i sqrt (wyniki ściśle określone przez IEEE-754),
 * aby rdzeń symulacji był deterministyczny między silnikami JavaScript.
 */

/** Aproksymacja tanh (Padé 3/2), monotoniczna, nasycona do ±1 dla |x| ≥ 3. */
export function tanh(x: number): number {
  if (x >= 3) return 1;
  if (x <= -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** cos dla małych kątów (|θ| ≤ ~0.6): szereg Taylora do θ^6. */
export function cosSmall(t: number): number {
  const t2 = t * t;
  return 1 - t2 / 2 + (t2 * t2) / 24 - (t2 * t2 * t2) / 720;
}

/** sin dla małych kątów (|θ| ≤ ~0.6): szereg Taylora do θ^7. */
export function sinSmall(t: number): number {
  const t2 = t * t;
  return t * (1 - t2 / 6 + (t2 * t2) / 120 - (t2 * t2 * t2) / 5040);
}

/** x^(1/4) przez dwa pierwiastki. */
export function pow025(x: number): number {
  return Math.sqrt(Math.sqrt(x));
}

/** x^(3/4) (prawo Kleibera dla metabolizmu) przez pierwiastki. */
export function pow075(x: number): number {
  const s = Math.sqrt(x);
  return s * Math.sqrt(s);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Fala trójkątna o okresie `period` w zakresie [0,1] (1 w połowie okresu). Bez funkcji trygonometrycznych. */
export function triangleWave(t: number, period: number): number {
  if (period <= 0) return 1;
  const ph = (t % period) / period;
  return ph < 0.5 ? ph * 2 : 2 - ph * 2;
}

/** FNV-1a po bajtach bufora — do porównywania stanów w testach determinizmu. */
export function hashBytes(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Skala pojemności magazynu energii względem masy: masa^0.875 = m^0.75 · m^(1/8).
 * Wykładnik pośredni między 0.75 (magazyn ∝ metabolizm — neutralne tempo rozrodu) a 1 (magazyn ∝ masa —
 * korzyść małych). Realizowany wyłącznie przez pierwiastki, by zachować determinizm między silnikami.
 */
export function storageScale(mass: number, m075: number): number {
  return m075 * Math.sqrt(Math.sqrt(Math.sqrt(mass)));
}
