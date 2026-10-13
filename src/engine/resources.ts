/**
 * Siatka zasobów (pokarm) i generator mapy żyzności.
 * Żyzność jest deterministyczna względem seeda; pojemność komórki = foodCapMax · żyzność.
 */
import type { WorldSetup } from './config';
import { cosSmall, sinSmall } from './mathx';
import type { Rng } from './rng';

export class ResourceGrid {
  readonly nx: number;
  readonly ny: number;
  food: Float64Array;
  fert: Float32Array;
  foodB: Float64Array;
  niche: Float32Array;
  seedBank: Float32Array;
  obstacles: Uint8Array;
  biome: Uint8Array;
  biomeTemperature: Float32Array;
  biomeFertility: Float32Array;
  biomeFoodB: Float32Array;
  biomeSeason: Float32Array;

  constructor(
    width: number,
    height: number,
    readonly cell: number,
  ) {
    this.nx = Math.max(1, Math.ceil(width / cell));
    this.ny = Math.max(1, Math.ceil(height / cell));
    this.food = new Float64Array(this.nx * this.ny);
    this.fert = new Float32Array(this.nx * this.ny);
    this.foodB = new Float64Array(this.nx * this.ny);
    this.niche = new Float32Array(this.nx * this.ny);
    this.seedBank = new Float32Array(this.nx * this.ny);
    this.obstacles = new Uint8Array(this.nx * this.ny);
    this.biome = new Uint8Array(this.cells);
    this.biomeTemperature = new Float32Array(this.cells);
    this.biomeFertility = new Float32Array(this.cells);
    this.biomeFoodB = new Float32Array(this.cells);
    this.biomeSeason = new Float32Array(this.cells);
  }

  /** Contiguous seeded habitats, independent of both simulation RNG streams. */
  generateBiomes(seed: number): void {
    const phase = ((Math.imul(seed ^ 0x5bd1e995, 1664525) >>> 0) % 101) / 100;
    for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
      const bend = 0.08 * (1 - 2 * Math.abs(2 * ((y / this.ny + phase) % 1) - 1));
      const u = (x + 0.5) / this.nx + bend;
      const id = u < 1 / 3 ? 1 : u > 2 / 3 ? 2 : 0;
      const c = y * this.nx + x;
      this.biome[c] = id;
      this.biomeTemperature[c] = [0, -0.4, 0.12][id];
      this.biomeFertility[c] = [1, 0.6, 1.4][id];
      this.biomeFoodB[c] = [1, 0.3, 1.8][id];
      this.biomeSeason[c] = [1, 1.5, 0.5][id];
    }
  }

  cellAt(x: number, y: number): number {
    return Math.max(0, Math.min(this.ny - 1, Math.floor(y / this.cell))) * this.nx + Math.max(0, Math.min(this.nx - 1, Math.floor(x / this.cell)));
  }

  /** Seeded barriers with passages: no simulation RNG is consumed. */
  generateObstacles(seed: number): void {
    this.obstacles.fill(0);
    for (let k = 1; k <= 2; k++) {
      const x = Math.floor(this.nx * k / 3);
      const passage = 1 + ((seed + k * 17) >>> 0) % Math.max(1, this.ny - 3);
      for (let y = 1; y < this.ny - 1; y++) if (Math.abs(y - passage) > 1) this.obstacles[y * this.nx + x] = 1;
    }
  }

  /** Amanatides-style grid ray traversal, including crossed cell corners. */
  visible(x0: number, y0: number, x1: number, y1: number): boolean {
    let cx = Math.max(0, Math.min(this.nx - 1, Math.floor(x0 / this.cell)));
    let cy = Math.max(0, Math.min(this.ny - 1, Math.floor(y0 / this.cell)));
    const tx = Math.max(0, Math.min(this.nx - 1, Math.floor(x1 / this.cell)));
    const ty = Math.max(0, Math.min(this.ny - 1, Math.floor(y1 / this.cell)));
    const dx = x1 - x0, dy = y1 - y0;
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    let mx = sx === 0 ? Infinity : (((cx + (sx > 0 ? 1 : 0)) * this.cell - x0) / dx);
    let my = sy === 0 ? Infinity : (((cy + (sy > 0 ? 1 : 0)) * this.cell - y0) / dy);
    const ddx = sx === 0 ? Infinity : this.cell / Math.abs(dx);
    const ddy = sy === 0 ? Infinity : this.cell / Math.abs(dy);
    for (let n = 0; n <= this.nx + this.ny; n++) {
      if (this.obstacles[cy * this.nx + cx]) return false;
      if (cx === tx && cy === ty) return true;
      if (mx === my) {
        if (sx && this.obstacles[cy * this.nx + cx + sx]) return false;
        if (sy && this.obstacles[(cy + sy) * this.nx + cx]) return false;
        cx += sx; cy += sy; mx += ddx; my += ddy;
      } else if (mx < my) { cx += sx; mx += ddx; }
      else { cy += sy; my += ddy; }
      if (cx < 0 || cy < 0 || cx >= this.nx || cy >= this.ny) return false;
    }
    return false;
  }

  /** Reject contact with the obstacle's cell rectangle, including organism radius. */
  blocked(x: number, y: number, radius = 0): boolean {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    const reach = Math.ceil(radius / this.cell);
    for (let yy = Math.max(0, cy - reach); yy <= Math.min(this.ny - 1, cy + reach); yy++)
      for (let xx = Math.max(0, cx - reach); xx <= Math.min(this.nx - 1, cx + reach); xx++) {
        if (!this.obstacles[yy * this.nx + xx]) continue;
        const dx = Math.max(xx * this.cell - x, 0, x - (xx + 1) * this.cell);
        const dy = Math.max(yy * this.cell - y, 0, y - (yy + 1) * this.cell);
        if (dx * dx + dy * dy <= radius * radius) return true;
      }
    return false;
  }

  get cells(): number {
    return this.nx * this.ny;
  }
}

/** Żyzna plama (wzorzec `patches`): kernel (1 − d²/r²)², amplituda, kierunek dryfu i cykl życia. */
export interface Patch {
  x: number;
  y: number;
  r: number;
  a: number;
  /** jednostkowy kierunek dryfu */
  dx: number;
  dy: number;
  age: number;
  /** długość cyklu życia w tickach; 0 = trwała (amplituda stała) */
  life: number;
}

const PATCH_BASE = 0.04;

export function patchScale(setup: WorldSetup): number {
  return Math.min(setup.width, setup.height) / 800;
}

function patchAmplitude(p: Patch): number {
  if (p.life <= 0) return 1;
  const ramp = 0.2 * p.life;
  const f = Math.min(p.age / ramp, (p.life - p.age) / ramp, 1);
  return f < 0 ? 0 : f;
}

/** Przelicza mapę żyzności z listy plam. Tylko arytmetyka — przenośne. */
export function renderPatches(setup: WorldSetup, grid: ResourceGrid, patches: Patch[]): void {
  const { nx, ny, cell } = grid;
  const f = grid.fert;
  const amp = patches.map(patchAmplitude);
  for (let gy = 0; gy < ny; gy++)
    for (let gx = 0; gx < nx; gx++) {
      const cx = (gx + 0.5) * cell;
      const cy = (gy + 0.5) * cell;
      let v = PATCH_BASE;
      for (let p = 0; p < patches.length; p++) {
        const dx = cx - patches[p].x;
        const dy = cy - patches[p].y;
        const u = (dx * dx + dy * dy) / (patches[p].r * patches[p].r);
        if (u < 1) v += patches[p].a * amp[p] * (1 - u) * (1 - u);
      }
      f[gy * nx + gx] = Math.min(1, v);
    }
  void setup;
}

/**
 * Wypełnia mapę żyzności [0,1]. Dla wzorca `patches` zwraca listę plam (można je potem przesuwać
 * i odnawiać); dla pozostałych wzorców mapa jest statyczna i lista jest pusta.
 */
export function generateFertility(setup: WorldSetup, grid: ResourceGrid, rng: Rng): Patch[] {
  const { nx, ny, cell } = grid;
  const W = setup.width;
  const H = setup.height;
  const f = grid.fert;
  switch (setup.fertilityPattern) {
    case 'uniform':
      f.fill(0.5);
      return [];
    case 'gradient':
      for (let gy = 0; gy < ny; gy++)
        for (let gx = 0; gx < nx; gx++) f[gy * nx + gx] = 0.04 + 0.96 * (((gx + 0.5) * cell) / W);
      return [];
    case 'oasis': {
      const R = 0.5 * Math.min(W, H);
      for (let gy = 0; gy < ny; gy++)
        for (let gx = 0; gx < nx; gx++) {
          const dx = (gx + 0.5) * cell - W / 2;
          const dy = (gy + 0.5) * cell - H / 2;
          const u = Math.sqrt(dx * dx + dy * dy) / R;
          const k = u < 1 ? (1 - u) * (1 - u) : 0;
          f[gy * nx + gx] = Math.min(1, 0.03 + k);
        }
      return [];
    }
    case 'patches':
    default: {
      const patches: Patch[] = [];
      const scale = patchScale(setup);
      for (let p = 0; p < setup.patchCount; p++) {
        const x = rng.float() * W;
        const y = rng.float() * H;
        const r = rng.range(70, 170) * scale;
        const a = rng.range(0.6, 1.0);
        const h = randomUnit(rng);
        patches.push({ x, y, r, a, dx: h[0], dy: h[1], age: 0, life: 0 });
      }
      renderPatches(setup, grid, patches);
      return patches;
    }
  }
}

export function randomUnit(rng: Rng): [number, number] {
  let x: number, y: number, d: number;
  do {
    x = rng.float() * 2 - 1;
    y = rng.float() * 2 - 1;
    d = x * x + y * y;
  } while (d > 1 || d < 1e-6);
  const inv = 1 / Math.sqrt(d);
  return [x * inv, y * inv];
}

/**
 * Jeden tick dynamiki plam: dryf (losowe błądzenie kierunku, odbicie od ścian) oraz cykl życia
 * (plama rośnie, wygasa i odradza się w losowym miejscu). Zwraca `true`, gdy zmieniły się dane plam.
 */
export function stepPatches(patches: Patch[], setup: WorldSetup, drift: number, lifeParam: number, rng: Rng): boolean {
  if (drift <= 0 && lifeParam <= 0) return false;
  const W = setup.width;
  const H = setup.height;
  const scale = patchScale(setup);
  for (const p of patches) {
    if (drift > 0) {
      const th = rng.gauss() * 0.06;
      const c = cosSmall(th);
      const s = sinSmall(th);
      let ndx = p.dx * c - p.dy * s;
      let ndy = p.dx * s + p.dy * c;
      const inv = 1 / Math.sqrt(ndx * ndx + ndy * ndy);
      ndx *= inv;
      ndy *= inv;
      p.dx = ndx;
      p.dy = ndy;
      p.x += ndx * drift;
      p.y += ndy * drift;
      if (p.x < 0) { p.x = -p.x; p.dx = Math.abs(p.dx); } else if (p.x > W) { p.x = 2 * W - p.x; p.dx = -Math.abs(p.dx); }
      if (p.y < 0) { p.y = -p.y; p.dy = Math.abs(p.dy); } else if (p.y > H) { p.y = 2 * H - p.y; p.dy = -Math.abs(p.dy); }
    }
    if (lifeParam > 0) {
      if (p.life <= 0) assignPhase(p, lifeParam, rng);
      p.age++;
      if (p.age >= p.life) {
        p.x = rng.float() * W;
        p.y = rng.float() * H;
        p.r = rng.range(70, 170) * scale;
        p.a = rng.range(0.6, 1.0);
        const h = randomUnit(rng);
        p.dx = h[0];
        p.dy = h[1];
        p.age = 0;
        p.life = lifeParam * (0.6 + 0.8 * rng.float());
      }
    } else if (p.life > 0) {
      p.life = 0;
      p.age = 0;
    }
  }
  return true;
}

/** Losowa faza cyklu życia plamy (żeby plamy nie wygasały jednocześnie). */
export function assignPhase(p: Patch, lifeParam: number, rng: Rng): void {
  p.life = lifeParam * (0.6 + 0.8 * rng.float());
  p.age = Math.floor(rng.float() * p.life);
}
