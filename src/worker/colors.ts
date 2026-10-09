/** Kolorowanie organizmów (wyłącznie warstwa prezentacji; nie wpływa na symulację). */
import type { ColorMode } from './protocol';

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function pack(r: number, g: number, b: number): number {
  return ((255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}

export function hsl(h: number, s: number, l: number): number {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return pack(Math.round(hue2rgb(p, q, h + 1 / 3) * 255), Math.round(hue2rgb(p, q, h) * 255), Math.round(hue2rgb(p, q, h - 1 / 3) * 255));
}

function ramp(t: number): number {
  // czerwony → bursztyn → zieleń
  t = Math.max(0, Math.min(1, t));
  if (t < 0.5) {
    const k = t / 0.5;
    return pack(Math.round(225 - 5 * k), Math.round(70 + 120 * k), Math.round(70 - 20 * k));
  }
  const k = (t - 0.5) / 0.5;
  return pack(Math.round(220 - 140 * k), Math.round(190 + 45 * k), Math.round(50 + 90 * k));
}

export interface ColorInput {
  mode: ColorMode;
  hue: number;
  speed: number;
  sense: number;
  size: number;
  energyFrac: number;
  generation: number;
  maxGeneration: number;
  diet: number;
  clade: number;
  age: number;
  maxAge: number;
}

export function colorOf(c: ColorInput): number {
  switch (c.mode) {
    case 'lineage':
      return hsl(c.hue, 0.78, 0.6);
    case 'strategy':
      return pack(Math.round(60 + 195 * c.speed), Math.round(60 + 195 * c.sense), Math.round(60 + 195 * c.size));
    case 'energy':
      return ramp(c.energyFrac);
    case 'generation':
      return hsl(0.62 - 0.62 * (c.maxGeneration > 0 ? c.generation / c.maxGeneration : 0), 0.8, 0.58);
    case 'age':
      return ramp(1 - c.age / Math.max(1, c.maxAge));
    case 'diet':
      // roślinożercy: zielony → drapieżnicy: czerwony
      return pack(Math.round(60 + 195 * c.diet), Math.round(220 - 150 * c.diet), Math.round(110 - 60 * c.diet));
    case 'clade':
      // stały „losowy” kolor kladu (złoty podział w przestrzeni barw)
      return hsl((c.clade * 0.6180339887) % 1, 0.7, 0.58);
  }
}
