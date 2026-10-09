/**
 * Deterministyczny generator liczb pseudolosowych (sfc32) z serializowalnym stanem.
 *
 * Rdzeń symulacji nie używa Math.random ani funkcji przestępnych (sin/cos/exp/log/pow),
 * których wynik może się różnić w ostatnim bicie między silnikami JS. Dzięki temu ten sam
 * seed + konfiguracja + wersja silnika dają ten sam wynik niezależnie od FPS i maszyny.
 */

export type RngState = [number, number, number, number];

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number, stream = 0) {
    const sm = splitmix32((seed >>> 0) ^ Math.imul(stream + 1, 0x9e3779b1));
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm();
    for (let i = 0; i < 16; i++) this.nextU32();
  }

  /** Następna liczba całkowita 32-bit bez znaku. */
  nextU32(): number {
    const a = this.a;
    const b = this.b;
    let t = (a + b) | 0;
    this.a = b ^ (b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Liczba z przedziału [0, 1). */
  float(): number {
    return this.nextU32() / 4294967296;
  }

  /** Liczba całkowita z przedziału [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  /**
   * Przybliżony rozkład normalny N(0,1): suma 4 zmiennych jednostajnych (Irwin–Hall),
   * bez log/cos — tylko arytmetyka IEEE-754, więc w pełni przenośna.
   */
  gauss(): number {
    const s = this.float() + this.float() + this.float() + this.float();
    return (s - 2) * 1.7320508075688772;
  }

  getState(): RngState {
    return [this.a | 0, this.b | 0, this.c | 0, this.d | 0];
  }

  setState(s: RngState): void {
    this.a = s[0] | 0;
    this.b = s[1] | 0;
    this.c = s[2] | 0;
    this.d = s[3] | 0;
  }
}
