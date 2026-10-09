/**
 * Pula organizmów w układzie SoA (structure of arrays) — gęsta, bez dziur.
 * Usunięcie organizmu = „swap-remove” (ostatni trafia na jego miejsce), więc iteracja
 * po indeksach 0..n-1 jest zawsze deterministyczna i serializacja nie wymaga listy wolnych slotów.
 */
import { GENOME_LEN, N_MEM } from './constants';

export class OrganismPool {
  n = 0;
  readonly capacity: number;

  // stan dynamiczny (float64 — brak dryfu zaokrągleń w bilansie energii)
  id: Float64Array;
  x: Float64Array;
  y: Float64Array;
  hx: Float64Array;
  hy: Float64Array;
  energy: Float64Array;
  health: Float64Array;
  /** maksymalna pojemność energii (cache) */
  maxE: Float64Array;

  // zdarzenia życiowe
  age: Uint32Array;
  birth: Uint32Array;
  maxAge: Uint32Array;
  generation: Uint32Array;
  lastRepro: Uint32Array;
  offspring: Uint32Array;
  lin: Int32Array;
  /** indeks założyciela, z którego pochodzi linia (klad) */
  clade: Int32Array;

  // cechy pochodne od genomu (cache; nie zależą od parametrów świata)
  radius: Float32Array;
  mass: Float32Array;
  m075: Float32Array;
  senseRange: Float32Array;
  maxSpeed: Float32Array;
  biteCap: Float32Array;
  assim: Float32Array;
  reproThresh: Float32Array;
  investFrac: Float32Array;
  maturity: Float32Array;
  coldTol: Float32Array;
  sumAbsW: Float32Array;
  /** współczynnik zachowania stanu pamięci (λ) */
  memDecay: Float32Array;
  diet: Float32Array;

  genomes: Float32Array;
  /** stan pamięci rekurencyjnej: N_MEM liczb na organizm */
  mem: Float32Array;

  private readonly arrays: Record<string, Float64Array | Float32Array | Uint32Array | Int32Array>;
  private readonly list: (Float64Array | Float32Array | Uint32Array | Int32Array)[];

  constructor(capacity: number) {
    this.capacity = capacity;
    this.id = new Float64Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.hx = new Float64Array(capacity);
    this.hy = new Float64Array(capacity);
    this.energy = new Float64Array(capacity);
    this.health = new Float64Array(capacity);
    this.maxE = new Float64Array(capacity);
    this.age = new Uint32Array(capacity);
    this.birth = new Uint32Array(capacity);
    this.maxAge = new Uint32Array(capacity);
    this.generation = new Uint32Array(capacity);
    this.lastRepro = new Uint32Array(capacity);
    this.offspring = new Uint32Array(capacity);
    this.lin = new Int32Array(capacity);
    this.clade = new Int32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.mass = new Float32Array(capacity);
    this.m075 = new Float32Array(capacity);
    this.senseRange = new Float32Array(capacity);
    this.maxSpeed = new Float32Array(capacity);
    this.biteCap = new Float32Array(capacity);
    this.assim = new Float32Array(capacity);
    this.reproThresh = new Float32Array(capacity);
    this.investFrac = new Float32Array(capacity);
    this.maturity = new Float32Array(capacity);
    this.coldTol = new Float32Array(capacity);
    this.sumAbsW = new Float32Array(capacity);
    this.memDecay = new Float32Array(capacity);
    this.diet = new Float32Array(capacity);
    this.mem = new Float32Array(capacity * N_MEM);
    this.genomes = new Float32Array(capacity * GENOME_LEN);
    this.arrays = {
      id: this.id, x: this.x, y: this.y, hx: this.hx, hy: this.hy, energy: this.energy, health: this.health, maxE: this.maxE,
      age: this.age, birth: this.birth, maxAge: this.maxAge, generation: this.generation,
      lastRepro: this.lastRepro, offspring: this.offspring, lin: this.lin, clade: this.clade,
      radius: this.radius, mass: this.mass, m075: this.m075, senseRange: this.senseRange,
      maxSpeed: this.maxSpeed, biteCap: this.biteCap, assim: this.assim, reproThresh: this.reproThresh,
      investFrac: this.investFrac, maturity: this.maturity, coldTol: this.coldTol, sumAbsW: this.sumAbsW,
      memDecay: this.memDecay, diet: this.diet,
    };
    this.list = Object.values(this.arrays);
  }

  /** Kopiuje cały organizm ze slotu `from` do `to`. */
  move(from: number, to: number): void {
    const list = this.list;
    for (let k = 0; k < list.length; k++) list[k][to] = list[k][from];
    this.genomes.copyWithin(to * GENOME_LEN, from * GENOME_LEN, (from + 1) * GENOME_LEN);
    this.mem.copyWithin(to * N_MEM, from * N_MEM, (from + 1) * N_MEM);
  }

  indexOfId(id: number): number {
    const ids = this.id;
    for (let i = 0; i < this.n; i++) if (ids[i] === id) return i;
    return -1;
  }

  exportSections(): Record<string, ArrayBufferView> {
    const out: Record<string, ArrayBufferView> = {};
    for (const k in this.arrays) out[`pool.${k}`] = this.arrays[k].slice(0, this.n);
    out['pool.genomes'] = this.genomes.slice(0, this.n * GENOME_LEN);
    out['pool.mem'] = this.mem.slice(0, this.n * N_MEM);
    return out;
  }

  importSections(n: number, s: Record<string, ArrayBufferView>): void {
    this.n = n;
    for (const k in this.arrays) (this.arrays[k] as unknown as { set(a: ArrayLike<number>): void }).set(s[`pool.${k}`] as unknown as ArrayLike<number>);
    this.genomes.set(s['pool.genomes'] as Float32Array);
    this.mem.set(s['pool.mem'] as Float32Array);
  }
}
