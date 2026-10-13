import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/config';
import { MODULES, moduleEnabled, modulePatch, moduleProfilePatch, rememberModules, type ModuleMemory } from '../src/engine/modules';
describe('mechanic parameter bundles', () => {
  it('matches engine boolean thresholds for imported fractional switches', () => {
    for (const [id, key] of [['barriers','obstacles'], ['communication','communication'], ['sexual','sexual'], ['mateChoice','mateChoice'], ['biomes','biomes']] as const) {
      expect(moduleEnabled({ ...DEFAULT_PARAMS, [key]: 0.4 }, id)).toBe(false);
      expect(moduleEnabled({ ...DEFAULT_PARAMS, [key]: 0.5 }, id)).toBe(true);
    }
  });
  it('derives state from imported parameters and preserves active custom values', () => {
    const params = { ...DEFAULT_PARAMS, plasticityRate: 0.07, predationPower: 2 };
    expect(moduleEnabled(params, 'learning')).toBe(true);
    const next = { ...params, ...moduleProfilePatch(params, MODULES.map(m => m.id)) };
    expect(next.plasticityRate).toBe(0.07); expect(next.predationPower).toBe(2);
    for (const m of MODULES) expect(moduleEnabled(next, m.id)).toBe(true);
  });
  it('enables dependency and disables dependent choice with sexual reproduction', () => {
    expect(modulePatch(DEFAULT_PARAMS, 'mateChoice', true)).toEqual({ sexual: 1, mateChoice: 1 });
    expect(modulePatch({ ...DEFAULT_PARAMS, sexual: 1, mateChoice: 1 }, 'sexual', false)).toEqual({ sexual: 0, mateChoice: 0 });
  });
  it('restores nonzero values without a second enabled state', () => {
    const memory: ModuleMemory = {}; const active = { ...DEFAULT_PARAMS, viewCos: -0.4, plantBShare: 0.7 };
    rememberModules(active, memory);
    const off = { ...active, ...modulePatch(active, 'perception', false) };
    expect(moduleEnabled(off, 'perception')).toBe(false);
    expect(modulePatch(off, 'perception', true, memory)).toEqual({ viewCos: -0.4 });
    expect(moduleProfilePatch(active, ['predation'])).toMatchObject({ plantBShare: 0, viewCos: -1 });
  });
});
