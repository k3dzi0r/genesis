import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { tanh, cosSmall, sinSmall, pow075, pow025 } from '../src/engine/mathx';

describe('Rng', () => {
  it('daje identyczny ciąg dla tego samego seeda', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('różne seedy i strumienie dają różne ciągi', () => {
    expect(new Rng(1).nextU32()).not.toBe(new Rng(2).nextU32());
    expect(new Rng(1, 0).nextU32()).not.toBe(new Rng(1, 1).nextU32());
  });

  it('zapis i odtworzenie stanu wznawia ciąg', () => {
    const a = new Rng(7);
    for (let i = 0; i < 123; i++) a.float();
    const st = a.getState();
    const expected = Array.from({ length: 50 }, () => a.float());
    const b = new Rng(999);
    b.setState(st);
    expect(Array.from({ length: 50 }, () => b.float())).toEqual(expected);
  });

  it('float ∈ [0,1) i średnia ≈ 0.5; gauss ma średnią ≈ 0 i σ ≈ 1', () => {
    const r = new Rng(3);
    let s = 0, g = 0, g2 = 0;
    const n = 100000;
    for (let i = 0; i < n; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      s += f;
      const x = r.gauss();
      g += x;
      g2 += x * x;
    }
    expect(s / n).toBeCloseTo(0.5, 2);
    expect(g / n).toBeCloseTo(0, 1);
    expect(Math.sqrt(g2 / n)).toBeCloseTo(1, 1);
  });
});

describe('mathx (bez funkcji przestępnych)', () => {
  it('przybliżenia są dokładne w użytecznym zakresie', () => {
    for (let x = -2.9; x < 2.9; x += 0.1) expect(Math.abs(tanh(x) - Math.tanh(x))).toBeLessThan(0.025);
    for (let t = -0.4; t < 0.4; t += 0.05) {
      expect(cosSmall(t)).toBeCloseTo(Math.cos(t), 6);
      expect(sinSmall(t)).toBeCloseTo(Math.sin(t), 6);
    }
    expect(pow075(5)).toBeCloseTo(5 ** 0.75, 10);
    expect(pow025(5)).toBeCloseTo(5 ** 0.25, 10);
  });
});
