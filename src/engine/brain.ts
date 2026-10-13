/**
 * Sieć sterująca: N_IN → N_HID (tanh) → N_OUT (tanh). Wagi są odczytywane bezpośrednio z genomu.
 * Opcjonalne delty somatyczne zmieniają wagi podczas życia; genom pozostaje dziedziczny.
 *
 * Punkt rozszerzenia: aby dodać NEAT / pamięć rekurencyjną, zastąp `think` implementacją
 * czytającą inny układ genomu (patrz docs/ARCHITECTURE.md → „Rozszerzenia”).
 */
import { B1_OFF, B2_OFF, N_HID, N_IN, N_OUT, W1_OFF, W2_OFF } from './constants';
import { tanh } from './mathx';

/** Evaluate inherited + learned weights and return their maintenance magnitude. */
export function think(g: Float32Array, off: number, inp: Float64Array, hid: Float64Array, out: Float64Array, somatic?: Float32Array): number {
  let magnitude = 0;
  for (let h = 0; h < N_HID; h++) {
    let s = (g[off + B1_OFF + h] + (somatic?.[off + B1_OFF + h] ?? 0));
    magnitude += Math.abs(s);
    const w = off + W1_OFF + h * N_IN;
    for (let i = 0; i < N_IN; i++) {
      const weight = g[w + i] + (somatic?.[w + i] ?? 0);
      magnitude += Math.abs(weight); s += weight * inp[i];
    }
    hid[h] = tanh(s);
  }
  for (let o = 0; o < N_OUT; o++) {
    let s = (g[off + B2_OFF + o] + (somatic?.[off + B2_OFF + o] ?? 0));
    magnitude += Math.abs(s);
    const w = off + W2_OFF + o * N_HID;
    for (let h = 0; h < N_HID; h++) {
      const weight = g[w + h] + (somatic?.[w + h] ?? 0);
      magnitude += Math.abs(weight); s += weight * hid[h];
    }
    out[o] = tanh(s);
  }
  return magnitude;
}
