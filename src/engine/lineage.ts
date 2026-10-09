/**
 * Genealogia: kolumnowy, oszczędny magazyn drzewa rodowego.
 *
 * Zamiast pełnego stanu organizmu zapisujemy dla każdego węzła tylko:
 *  - id, rodzica, pokolenie, tick narodzin i śmierci, liczbę potomstwa,
 *  - 9 cech fizycznych w chwili narodzin (36 B),
 *  - rzadką listę mutacji względem rodzica (indeks genu → nowa wartość).
 * Pełny genom (łącznie z wagami mózgu) dowolnego przodka odtwarzamy z genomu założyciela
 * nakładając kolejne listy mutacji wzdłuż ścieżki w drzewie.
 *
 * Pamięć jest ograniczona przez przycinanie: martwy węzeł bez żyjących potomków
 * (i niezapinowany) jest usuwany po `retention` ticków od śmierci. Linie wymarłe
 * przed oknem retencji znikają z drzewa, ale ich liczność jest dalej widoczna w statystykach.
 */
import { GENOME_LEN, N_TRAITS } from './constants';

const ALIVE = -1;
const FREE = -2;

export interface LineageInfo {
  id: number;
  parentId: number | null;
  /** drugi rodzic (rozmnażanie płciowe) */
  parent2Id: number | null;
  generation: number;
  birthTick: number;
  deathTick: number | null;
  offspring: number;
  mutations: number;
  traits: number[];
  alive: boolean;
}

export class LineageStore {
  cap: number;
  /** górny znacznik użycia kolumn */
  size = 0;
  id: Float64Array;
  parent: Int32Array;
  /** drugi rodzic (−1 = brak); rejestr mutacji liczony jest względem pierwszego */
  parent2: Int32Array;
  firstChild: Int32Array;
  nextSibling: Int32Array;
  birth: Uint32Array;
  death: Int32Array;
  gen: Uint32Array;
  kids: Uint32Array;
  refs: Int32Array;
  traits: Float32Array;
  mutStart: Int32Array;
  mutCount: Uint16Array;

  mutGene: Uint16Array;
  mutVal: Float32Array;
  mutTop = 0;
  mutGarbage = 0;

  freeList: number[] = [];
  founders = new Map<number, Float32Array>();
  byId = new Map<number, number>();

  liveNodes = 0;
  totalRecorded = 0;
  totalPruned = 0;
  /** liczba węzłów scalonych w łańcuchach bez rozgałęzień */
  totalSpliced = 0;
  /** czy scalać martwe łańcuchy jednokrotne (oszczędność pamięci w bardzo długich przebiegach) */
  compactEnabled = true;

  constructor(initialCap = 1024) {
    this.cap = initialCap;
    this.id = new Float64Array(initialCap);
    this.parent = new Int32Array(initialCap);
    this.parent2 = new Int32Array(initialCap);
    this.firstChild = new Int32Array(initialCap);
    this.nextSibling = new Int32Array(initialCap);
    this.birth = new Uint32Array(initialCap);
    this.death = new Int32Array(initialCap);
    this.gen = new Uint32Array(initialCap);
    this.kids = new Uint32Array(initialCap);
    this.refs = new Int32Array(initialCap);
    this.traits = new Float32Array(initialCap * N_TRAITS);
    this.mutStart = new Int32Array(initialCap);
    this.mutCount = new Uint16Array(initialCap);
    this.mutGene = new Uint16Array(4096);
    this.mutVal = new Float32Array(4096);
  }

  private grow(): void {
    const n = this.cap * 2;
    const g = <T extends Float64Array | Int32Array | Uint32Array | Float32Array | Uint16Array>(a: T, mult = 1): T => {
      const b = new (a.constructor as new (len: number) => T)(n * mult);
      b.set(a);
      return b;
    };
    this.id = g(this.id);
    this.parent = g(this.parent);
    this.parent2 = g(this.parent2);
    this.firstChild = g(this.firstChild);
    this.nextSibling = g(this.nextSibling);
    this.birth = g(this.birth);
    this.death = g(this.death);
    this.gen = g(this.gen);
    this.kids = g(this.kids);
    this.refs = g(this.refs);
    this.traits = g(this.traits, N_TRAITS);
    this.mutStart = g(this.mutStart);
    this.mutCount = g(this.mutCount);
    this.cap = n;
  }

  private ensureMut(extra: number): void {
    if (this.mutTop + extra <= this.mutGene.length) return;
    let n = this.mutGene.length * 2;
    while (n < this.mutTop + extra) n *= 2;
    const a = new Uint16Array(n);
    a.set(this.mutGene.subarray(0, this.mutTop));
    const b = new Float32Array(n);
    b.set(this.mutVal.subarray(0, this.mutTop));
    this.mutGene = a;
    this.mutVal = b;
  }

  /**
   * Dodaje węzeł. Dla założyciela (`parentNode < 0`) zapisuje pełny genom.
   * `mutIdx/mutVal` to lista mutacji względem rodzica (pierwsze `nMut` pozycji).
   */
  add(
    id: number,
    parentNode: number,
    tick: number,
    generation: number,
    genome: Float32Array,
    genomeOff: number,
    mutIdx: Uint16Array | null,
    mutVal: Float32Array | null,
    nMut: number,
    parent2Node = -1,
  ): number {
    let n: number;
    if (this.freeList.length) n = this.freeList.pop()!;
    else {
      if (this.size >= this.cap) this.grow();
      n = this.size++;
    }
    this.id[n] = id;
    this.parent[n] = parentNode;
    this.parent2[n] = parent2Node;
    this.firstChild[n] = -1;
    this.nextSibling[n] = -1;
    this.birth[n] = tick;
    this.death[n] = ALIVE;
    this.gen[n] = generation;
    this.kids[n] = 0;
    this.refs[n] = 1;
    for (let t = 0; t < N_TRAITS; t++) this.traits[n * N_TRAITS + t] = genome[genomeOff + t];
    this.mutStart[n] = this.mutTop;
    this.mutCount[n] = nMut;
    if (nMut > 0 && mutIdx && mutVal) {
      this.ensureMut(nMut);
      this.mutGene.set(mutIdx.subarray(0, nMut), this.mutTop);
      this.mutVal.set(mutVal.subarray(0, nMut), this.mutTop);
      this.mutTop += nMut;
    }
    if (parent2Node >= 0) {
      this.refs[parent2Node]++;
      this.kids[parent2Node]++;
    }
    if (parentNode >= 0) {
      this.nextSibling[n] = this.firstChild[parentNode];
      this.firstChild[parentNode] = n;
      this.refs[parentNode]++;
      this.kids[parentNode]++;
    } else {
      this.founders.set(n, genome.slice(genomeOff, genomeOff + GENOME_LEN));
    }
    this.byId.set(id, n);
    this.liveNodes++;
    this.totalRecorded++;
    return n;
  }

  markDead(n: number, tick: number): void {
    if (this.death[n] !== ALIVE) return;
    this.death[n] = tick;
    this.refs[n]--;
  }

  /** Zapina węzeł (np. wybrany organizm), by jego przodkowie nie zostali przycięci. */
  pin(n: number): void {
    this.refs[n]++;
  }
  unpin(n: number): void {
    this.refs[n]--;
  }

  indexOf(id: number): number {
    const n = this.byId.get(id);
    return n === undefined ? -1 : n;
  }

  info(n: number): LineageInfo {
    const p = this.parent[n];
    const p2 = this.parent2[n];
    const tr: number[] = [];
    for (let t = 0; t < N_TRAITS; t++) tr.push(this.traits[n * N_TRAITS + t]);
    return {
      id: this.id[n],
      parentId: p >= 0 ? this.id[p] : null,
      parent2Id: p2 >= 0 ? this.id[p2] : null,
      generation: this.gen[n],
      birthTick: this.birth[n],
      deathTick: this.death[n] >= 0 ? this.death[n] : null,
      offspring: this.kids[n],
      mutations: this.mutCount[n],
      traits: tr,
      alive: this.death[n] === ALIVE,
    };
  }

  /** Ścieżka od węzła do korzenia (węzeł pierwszy). */
  ancestry(n: number, maxLen = 1_000_000): number[] {
    const out: number[] = [];
    let c = n;
    while (c >= 0 && out.length < maxLen) {
      out.push(c);
      c = this.parent[c];
    }
    return out;
  }

  children(n: number): number[] {
    const out: number[] = [];
    for (let c = this.firstChild[n]; c >= 0; c = this.nextSibling[c]) out.push(c);
    return out;
  }

  /** Lista mutacji węzła: [indeks genu, nowa wartość]. */
  mutationsOf(n: number): { gene: number; value: number }[] {
    const out: { gene: number; value: number }[] = [];
    const s = this.mutStart[n];
    for (let k = 0; k < this.mutCount[n]; k++) out.push({ gene: this.mutGene[s + k], value: this.mutVal[s + k] });
    return out;
  }

  /** Odtwarza pełny genom węzła z genomu założyciela i list mutacji wzdłuż ścieżki. */
  reconstruct(n: number): Float32Array | null {
    const chain = this.ancestry(n).reverse();
    const root = chain[0];
    const base = this.founders.get(root);
    if (!base) return null;
    const g = base.slice();
    for (let k = 1; k < chain.length; k++) {
      const node = chain[k];
      const s = this.mutStart[node];
      for (let m = 0; m < this.mutCount[node]; m++) g[this.mutGene[s + m]] = this.mutVal[s + m];
    }
    return g;
  }

  /**
   * Usuwa martwe węzły bez żyjących/zapiętych potomków starsze niż `retention`.
   * Jeśli po tym nadal jest ponad `maxRecords` węzłów, przycina agresywniej (retencja 0).
   */
  prune(tick: number, retention: number, maxRecords: number): number {
    const before = this.totalPruned;
    this.pass(tick, retention);
    if (this.liveNodes > maxRecords) this.pass(tick, 0);
    if (this.compactEnabled) this.compactChains(tick, retention);
    if (this.mutGarbage > 4096 && this.mutGarbage > this.mutTop / 2) this.compactMutations();
    return this.totalPruned - before;
  }

  /**
   * Scala martwe węzły, które mają dokładnie jednego potomka i nikt inny się do nich nie odwołuje
   * (łańcuchy przodków bez rozgałęzień). Potomek przejmuje rodzica węzła, a jego rejestr mutacji
   * jest łączony z rejestrem usuwanego węzła (późniejsze wartości wygrywają) — odtworzenie genomu pozostaje dokładne.
   * Tracimy tylko migawkę cech pośrednich przodków i ich numery pokoleń.
   */
  compactChains(tick: number, retention: number): number {
    let spliced = 0;
    for (let n = 0; n < this.size; n++) {
      if (this.death[n] < 0 || this.refs[n] !== 1 || this.parent2[n] >= 0 || this.parent[n] < 0) continue;
      if (tick - this.death[n] < retention) continue;
      const c = this.firstChild[n];
      if (c < 0 || this.nextSibling[c] >= 0 || this.parent[c] !== n) continue;
      const g = this.parent[n];

      // połącz rejestry mutacji: n, potem c (c nadpisuje)
      const merged = new Map<number, number>();
      let s = this.mutStart[n];
      for (let k = 0; k < this.mutCount[n]; k++) merged.set(this.mutGene[s + k], this.mutVal[s + k]);
      s = this.mutStart[c];
      for (let k = 0; k < this.mutCount[c]; k++) merged.set(this.mutGene[s + k], this.mutVal[s + k]);
      this.ensureMut(merged.size);
      const start = this.mutTop;
      for (const [gene, val] of merged) {
        this.mutGene[this.mutTop] = gene;
        this.mutVal[this.mutTop] = val;
        this.mutTop++;
      }
      this.mutGarbage += this.mutCount[c] + this.mutCount[n];
      this.mutStart[c] = start;
      this.mutCount[c] = merged.size;

      // c zajmuje miejsce n na liście dzieci g
      if (this.firstChild[g] === n) this.firstChild[g] = c;
      else {
        let q = this.firstChild[g];
        while (q >= 0 && this.nextSibling[q] !== n) q = this.nextSibling[q];
        if (q >= 0) this.nextSibling[q] = c;
      }
      this.nextSibling[c] = this.nextSibling[n];
      this.parent[c] = g;

      // zwolnij n (refs[g] bez zmian: odwołanie przechodzi z n na c)
      this.byId.delete(this.id[n]);
      this.mutCount[n] = 0;
      this.death[n] = FREE;
      this.freeList.push(n);
      this.liveNodes--;
      this.totalPruned++;
      this.totalSpliced++;
      spliced++;
    }
    return spliced;
  }

  private pass(tick: number, retention: number): void {
    const stack: number[] = [];
    for (let n = 0; n < this.size; n++) {
      if (this.death[n] >= 0 && this.refs[n] === 0 && tick - this.death[n] >= retention) {
        stack.push(n);
        while (stack.length) {
          const x = stack.pop()!;
          if (this.death[x] < 0 || this.refs[x] !== 0) continue;
          const p = this.parent[x];
          const p2 = this.parent2[x];
          this.remove(x);
          if (p >= 0) {
            this.refs[p]--;
            if (this.death[p] >= 0 && this.refs[p] === 0 && tick - this.death[p] >= retention) stack.push(p);
          }
          if (p2 >= 0) {
            this.refs[p2]--;
            if (this.death[p2] >= 0 && this.refs[p2] === 0 && tick - this.death[p2] >= retention) stack.push(p2);
          }
        }
      }
    }
  }

  private remove(x: number): void {
    const p = this.parent[x];
    if (p >= 0) {
      let c = this.firstChild[p];
      if (c === x) this.firstChild[p] = this.nextSibling[x];
      else {
        while (c >= 0 && this.nextSibling[c] !== x) c = this.nextSibling[c];
        if (c >= 0) this.nextSibling[c] = this.nextSibling[x];
      }
    }
    this.byId.delete(this.id[x]);
    this.founders.delete(x);
    this.mutGarbage += this.mutCount[x];
    this.mutCount[x] = 0;
    this.death[x] = FREE;
    this.freeList.push(x);
    this.liveNodes--;
    this.totalPruned++;
  }

  private compactMutations(): void {
    const live = this.mutTop - this.mutGarbage;
    const cap = Math.max(4096, live * 2);
    const g = new Uint16Array(cap);
    const v = new Float32Array(cap);
    let top = 0;
    for (let n = 0; n < this.size; n++) {
      if (this.death[n] === FREE) continue;
      const c = this.mutCount[n];
      if (c > 0) {
        const s = this.mutStart[n];
        g.set(this.mutGene.subarray(s, s + c), top);
        v.set(this.mutVal.subarray(s, s + c), top);
        this.mutStart[n] = top;
        top += c;
      }
    }
    this.mutGene = g;
    this.mutVal = v;
    this.mutTop = top;
    this.mutGarbage = 0;
  }

  memoryBytes(): number {
    return (
      this.cap * (8 + 4 * 9 + 2 + N_TRAITS * 4 + 2) +
      this.mutGene.byteLength +
      this.mutVal.byteLength +
      this.founders.size * GENOME_LEN * 4
    );
  }

  // ——— serializacja ———

  exportState(): { meta: Record<string, number>; sections: Record<string, ArrayBufferView> } {
    const n = this.size;
    const founderNodes = [...this.founders.keys()];
    const founderData = new Float32Array(founderNodes.length * GENOME_LEN);
    founderNodes.forEach((node, i) => founderData.set(this.founders.get(node)!, i * GENOME_LEN));
    return {
      meta: { size: n, mutTop: this.mutTop, mutGarbage: this.mutGarbage, liveNodes: this.liveNodes, totalRecorded: this.totalRecorded, totalPruned: this.totalPruned, totalSpliced: this.totalSpliced },
      sections: {
        'lin.id': this.id.slice(0, n),
        'lin.parent': this.parent.slice(0, n),
        'lin.parent2': this.parent2.slice(0, n),
        'lin.firstChild': this.firstChild.slice(0, n),
        'lin.nextSibling': this.nextSibling.slice(0, n),
        'lin.birth': this.birth.slice(0, n),
        'lin.death': this.death.slice(0, n),
        'lin.gen': this.gen.slice(0, n),
        'lin.kids': this.kids.slice(0, n),
        'lin.refs': this.refs.slice(0, n),
        'lin.traits': this.traits.slice(0, n * N_TRAITS),
        'lin.mutStart': this.mutStart.slice(0, n),
        'lin.mutCount': this.mutCount.slice(0, n),
        'lin.mutGene': this.mutGene.slice(0, this.mutTop),
        'lin.mutVal': this.mutVal.slice(0, this.mutTop),
        'lin.free': Int32Array.from(this.freeList),
        'lin.founderNodes': Int32Array.from(founderNodes),
        'lin.founderData': founderData,
      },
    };
  }

  static importState(meta: Record<string, number>, s: Record<string, ArrayBufferView>): LineageStore {
    const n = meta.size;
    const L = new LineageStore(Math.max(1024, n * 2));
    const set = (dst: { set(a: ArrayLike<number>): void }, src: ArrayBufferView) => dst.set(src as unknown as ArrayLike<number>);
    set(L.id, s['lin.id']);
    set(L.parent, s['lin.parent']);
    set(L.parent2, s['lin.parent2']);
    set(L.firstChild, s['lin.firstChild']);
    set(L.nextSibling, s['lin.nextSibling']);
    set(L.birth, s['lin.birth']);
    set(L.death, s['lin.death']);
    set(L.gen, s['lin.gen']);
    set(L.kids, s['lin.kids']);
    set(L.refs, s['lin.refs']);
    set(L.traits, s['lin.traits']);
    set(L.mutStart, s['lin.mutStart']);
    set(L.mutCount, s['lin.mutCount']);
    L.size = n;
    L.mutTop = meta.mutTop;
    L.mutGarbage = meta.mutGarbage;
    L.liveNodes = meta.liveNodes;
    L.totalRecorded = meta.totalRecorded;
    L.totalPruned = meta.totalPruned;
    L.totalSpliced = meta.totalSpliced ?? 0;
    if (L.mutGene.length < meta.mutTop) {
      L.mutGene = new Uint16Array(Math.max(4096, meta.mutTop * 2));
      L.mutVal = new Float32Array(Math.max(4096, meta.mutTop * 2));
    }
    set(L.mutGene, s['lin.mutGene']);
    set(L.mutVal, s['lin.mutVal']);
    L.freeList = Array.from(s['lin.free'] as Int32Array);
    const fn = s['lin.founderNodes'] as Int32Array;
    const fd = s['lin.founderData'] as Float32Array;
    for (let i = 0; i < fn.length; i++) L.founders.set(fn[i], fd.slice(i * GENOME_LEN, (i + 1) * GENOME_LEN));
    for (let i = 0; i < n; i++) if (L.death[i] !== FREE) L.byId.set(L.id[i], i);
    return L;
  }
}
