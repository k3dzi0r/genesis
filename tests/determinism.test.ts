import { describe, expect, it } from 'vitest';
import { stateHash } from '../src/engine/serialize';
import { smallWorld } from './helpers';

describe('determinizm', () => {
  it('ten sam seed i konfiguracja dają identyczny stan po N tickach', () => {
    const a = smallWorld(123);
    const b = smallWorld(123);
    a.run(1500);
    b.run(1500);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(a.pool.n).toBe(b.pool.n);
  });

  it('wynik nie zależy od sposobu dzielenia pracy na porcje (FPS/tempo)', () => {
    const a = smallWorld(77);
    const b = smallWorld(77);
    a.run(1200);
    for (let i = 0; i < 1200; i += 7) b.run(Math.min(7, 1200 - i));
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('różne seedy dają różne światy', () => {
    const a = smallWorld(1);
    const b = smallWorld(2);
    a.run(500);
    b.run(500);
    expect(stateHash(a)).not.toBe(stateHash(b));
  });

  it('polecenia użytkownika w tych samych tickach dają ten sam wynik', () => {
    const run = () => {
      const w = smallWorld(9);
      w.run(400);
      w.applyCommand({ type: 'event', spec: { kind: 'cull', severity: 0.3 } });
      w.applyCommand({ type: 'setParam', key: 'mutationRate', value: 0.1 });
      w.run(600);
      return stateHash(w);
    };
    expect(run()).toBe(run());
  });

  it('zaplanowane zdarzenia są częścią definicji eksperymentu', () => {
    const mk = () => smallWorld(5, { schedule: [{ tick: 300, spec: { kind: 'drought', severity: 0.8, duration: 400 } }] });
    const a = mk();
    const b = mk();
    a.run(900);
    b.run(900);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(a.eventLog.some((e) => e.text.includes('drought'))).toBe(true);
  });
});
