/**
 * Sieć sterująca: N_IN → N_HID (tanh) → N_OUT (tanh). Wagi są odczytywane bezpośrednio z genomu.
 * Brak trenowania — zachowanie wynika wyłącznie z dziedziczonych i mutowanych wag.
 *
 * Punkt rozszerzenia: aby dodać NEAT / pamięć rekurencyjną, zastąp `think` implementacją
 * czytającą inny układ genomu (patrz docs/ARCHITECTURE.md → „Rozszerzenia”).
 */
import { B1_OFF, B2_OFF, N_HID, N_IN, N_OUT, W1_OFF, W2_OFF } from './constants';
import { tanh } from './mathx';

export function think(g: Float32Array, off: number, inp: Float64Array, hid: Float64Array, out: Float64Array): void {
  for (let h = 0; h < N_HID; h++) {
    let s = g[off + B1_OFF + h];
    const w = off + W1_OFF + h * N_IN;
    for (let i = 0; i < N_IN; i++) s += g[w + i] * inp[i];
    hid[h] = tanh(s);
  }
  for (let o = 0; o < N_OUT; o++) {
    let s = g[off + B2_OFF + o];
    const w = off + W2_OFF + o * N_HID;
    for (let h = 0; h < N_HID; h++) s += g[w + h] * hid[h];
    out[o] = tanh(s);
  }
}
