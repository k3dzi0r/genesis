import { describe, expect, it } from 'vitest';
import { deserializeWorld, gunzip, gzip, readHeader, serializeWorld, stateHash } from '../src/engine/serialize';
import { FORMAT_VERSION } from '../src/engine/constants';
import { smallWorld } from './helpers';

describe('zapis i odtwarzanie', () => {
  it('wznowiony świat jest identyczny z nieprzerwanym (bit w bit)', () => {
    const a = smallWorld(31);
    a.run(1000);
    a.applyCommand({ type: 'setParam', key: 'mutationStrength', value: 0.3 });
    const bytes = serializeWorld(a, 'test');
    const b = deserializeWorld(bytes);
    expect(stateHash(b)).toBe(stateHash(a));
    a.run(1500);
    b.run(1500);
    expect(stateHash(b)).toBe(stateHash(a));
    expect(b.pool.n).toBe(a.pool.n);
  });

  it('zachowuje statystyki, genealogię i dziennik', () => {
    const a = smallWorld(32);
    a.run(1500);
    const b = deserializeWorld(serializeWorld(a));
    expect(b.stats.count).toBe(a.stats.count);
    expect(Array.from(b.stats.column('pop'))).toEqual(Array.from(a.stats.column('pop')));
    expect(b.lineage.liveNodes).toBe(a.lineage.liveNodes);
    expect(b.eventLog).toEqual(a.eventLog);
    expect(b.paramHistory).toEqual(a.paramHistory);
    const id = a.pool.id[a.pool.n - 1];
    const ga = a.lineage.reconstruct(a.lineage.indexOf(id));
    const gb = b.lineage.reconstruct(b.lineage.indexOf(id));
    expect(Array.from(gb!)).toEqual(Array.from(ga!));
  });

  it('nagłówek ma wersję formatu; zły plik jest odrzucany', () => {
    const a = smallWorld(33);
    const bytes = serializeWorld(a);
    expect(readHeader(bytes).formatVersion).toBe(FORMAT_VERSION);
    expect(() => readHeader(new Uint8Array(64))).toThrow();
    const newer = bytes.slice();
    new DataView(newer.buffer).setUint32(8, FORMAT_VERSION + 1, true);
    expect(() => readHeader(newer)).toThrow(/nowszej/);
  });

  it('kompresja gzip jest odwracalna', async () => {
    const a = smallWorld(34);
    a.run(300);
    const raw = serializeWorld(a);
    const z = await gzip(raw);
    expect(z.length).toBeLessThan(raw.length);
    const back = await gunzip(z);
    expect(stateHash(deserializeWorld(back))).toBe(stateHash(a));
  });
});
