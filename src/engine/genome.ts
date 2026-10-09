/**
 * Genom: wektor Float32 [cechy fizyczne | wagi sieci neuronowej].
 * Układ opisany w constants.ts. Genom jest dziedziczony bez zmian, a potomek dostaje mutacje.
 */
import { B1_OFF, B2_OFF, GENOME_LEN, MAX_WEIGHT, N_HID, N_IN, N_OUT, N_TRAITS, TRAIT_DIET, TRAIT_HUE, W1_OFF, W2_OFF } from './constants';
import type { Rng } from './rng';

/** Zapisuje losowy genom założyciela do `out[off..off+GENOME_LEN)`. */
export function randomGenome(rng: Rng, out: Float32Array, off: number, weightSd: number, dietMax = 0.2): void {
  for (let t = 0; t < N_TRAITS; t++) out[off + t] = 0.15 + 0.7 * rng.float();
  out[off + TRAIT_HUE] = rng.float();
  out[off + TRAIT_DIET] = rng.float() * dietMax;
  for (let g = W1_OFF; g < GENOME_LEN; g++) {
    let w = rng.gauss() * weightSd;
    if (w > MAX_WEIGHT) w = MAX_WEIGHT;
    else if (w < -MAX_WEIGHT) w = -MAX_WEIGHT;
    out[off + g] = w;
  }
  // biasy wyjść startują blisko zera: brak narzuconego zachowania
  for (let o = 0; o < N_OUT; o++) out[off + B2_OFF + o] *= 0.25;
}

export interface MutationScratch {
  idx: Uint16Array;
  val: Float32Array;
  count: number;
}

export function makeMutationScratch(): MutationScratch {
  return { idx: new Uint16Array(GENOME_LEN), val: new Float32Array(GENOME_LEN), count: 0 };
}

/**
 * Kopiuje genom rodzica do dziecka i aplikuje mutacje punktowe.
 * Zapisuje listę zmienionych genów (indeks, nowa wartość) w `scratch` — to jest „rejestr mutacji”.
 */
export function inheritWithMutation(
  src: Float32Array,
  srcOff: number,
  dst: Float32Array,
  dstOff: number,
  rng: Rng,
  rate: number,
  weightSd: number,
  traitSd: number,
  scratch: MutationScratch,
): void {
  let m = 0;
  for (let g = 0; g < GENOME_LEN; g++) {
    let v = src[srcOff + g];
    if (rng.float() < rate) {
      if (g < N_TRAITS) {
        v += rng.gauss() * traitSd;
        if (g === TRAIT_HUE) {
          v -= Math.floor(v); // barwa krąży po okręgu
        } else if (v < 0) v = 0;
        else if (v > 1) v = 1;
      } else {
        v += rng.gauss() * weightSd;
        if (v > MAX_WEIGHT) v = MAX_WEIGHT;
        else if (v < -MAX_WEIGHT) v = -MAX_WEIGHT;
      }
      const f = Math.fround(v);
      if (f !== src[srcOff + g]) {
        scratch.idx[m] = g;
        scratch.val[m] = f;
        m++;
      }
      v = f;
    }
    dst[dstOff + g] = v;
  }
  scratch.count = m;
}

/** Odległość między genomami: RMS po cechach (0..1) i RMS po wagach. */
export function genomeDistance(a: Float32Array, aOff: number, b: Float32Array, bOff: number): { traits: number; weights: number } {
  let st = 0;
  for (let g = 0; g < N_TRAITS; g++) {
    let d = a[aOff + g] - b[bOff + g];
    if (g === TRAIT_HUE) {
      d = Math.abs(d);
      if (d > 0.5) d = 1 - d;
    }
    st += d * d;
  }
  let sw = 0;
  for (let g = W1_OFF; g < GENOME_LEN; g++) {
    const d = a[aOff + g] - b[bOff + g];
    sw += d * d;
  }
  return { traits: Math.sqrt(st / N_TRAITS), weights: Math.sqrt(sw / (GENOME_LEN - N_TRAITS)) };
}

/** Suma |w| sieci — miara „kosztu utrzymania” mózgu. */
export function sumAbsWeights(g: Float32Array, off: number): number {
  let s = 0;
  for (let i = W1_OFF; i < GENOME_LEN; i++) s += Math.abs(g[off + i]);
  return s;
}

/**
 * Rekombinacja: cechy dziedziczone niezależnie od losowego rodzica; wagi — **neuron po neuronie**
 * (neuron ukryty dziedziczy komplet wag wejściowych, bias i wagi wyjściowe od jednego rodzica),
 * dzięki czemu współdziałające wagi nie są rozrywane. Biasy wyjść losowane osobno.
 */
export function crossover(a: Float32Array, aOff: number, b: Float32Array, bOff: number, dst: Float32Array, dstOff: number, rng: Rng): void {
  for (let t = 0; t < N_TRAITS; t++) dst[dstOff + t] = rng.float() < 0.5 ? a[aOff + t] : b[bOff + t];
  for (let h = 0; h < N_HID; h++) {
    const fromA = rng.float() < 0.5;
    const src = fromA ? a : b;
    const so = fromA ? aOff : bOff;
    const w = W1_OFF + h * N_IN;
    for (let i = 0; i < N_IN; i++) dst[dstOff + w + i] = src[so + w + i];
    dst[dstOff + B1_OFF + h] = src[so + B1_OFF + h];
    for (let o = 0; o < N_OUT; o++) dst[dstOff + W2_OFF + o * N_HID + h] = src[so + W2_OFF + o * N_HID + h];
  }
  for (let o = 0; o < N_OUT; o++) dst[dstOff + B2_OFF + o] = rng.float() < 0.5 ? a[aOff + B2_OFF + o] : b[bOff + B2_OFF + o];
}

/** Lista genów, w których `child` różni się od `parent` (indeks, wartość dziecka) — rejestr zmian dla genealogii. */
export function diffGenomes(parent: Float32Array, pOff: number, child: Float32Array, cOff: number, scratch: MutationScratch): void {
  let m = 0;
  for (let g = 0; g < GENOME_LEN; g++) {
    const v = child[cOff + g];
    if (v !== parent[pOff + g]) {
      scratch.idx[m] = g;
      scratch.val[m] = v;
      m++;
    }
  }
  scratch.count = m;
}
