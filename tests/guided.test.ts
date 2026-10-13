import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, DEFAULT_SETUP } from '../src/engine/config';
import { GUIDED_LESSONS, evaluateGuided, type GuidedWorldState } from '../src/ui/help/guided';
function pair(index = 0, tick = 2000): [GuidedWorldState,GuidedWorldState] {
  const lesson = GUIDED_LESSONS[index];
  const worlds: GuidedWorldState[] = lesson.action.worlds.map(w => ({ ready: true, tick, extinct: false, preview: false, worldEpoch: 1, params: { ...DEFAULT_PARAMS, ...w.params }, setup: { ...DEFAULT_SETUP, ...w.setup, seed: 1 }, intervened: false, interval:20, ticks: [0,20,tick], values: Object.fromEntries(lesson.guided!.metrics.map(m => [m.key,[0,0,0]])) }));
  return [worlds[0],worlds[1]];
}
describe('reactive controlled lessons', () => {
  it('six distinct lessons each change only one parameter and share seed/setup', () => {
    expect(GUIDED_LESSONS).toHaveLength(6);
    for (const lesson of GUIDED_LESSONS) {
      const [a,b] = pair(GUIDED_LESSONS.indexOf(lesson));
      expect(a.setup).toEqual(b.setup);
      expect(Object.keys(a.params!).filter(k => a.params![k as keyof typeof a.params] !== b.params![k as keyof typeof b.params])).toEqual([lesson.guided!.intervention]);
      expect(lesson.guided!.questions.length).toBeGreaterThan(1);
    }
  });
  it('does not complete merely by starting and accepts zero effects for interpretation', () => {
    const lesson = GUIDED_LESSONS[0]; const [a,b] = pair(0,20);
    expect(evaluateGuided(lesson,a,b,1).stage).toBe('observing');
    const [c,d] = pair(); const result = evaluateGuided(lesson,c,d,1);
    expect(result.stage).toBe('review'); expect(result.metrics.every(m => m.delta === 0)).toBe(true);
  });
  it('compares matched actual sample ticks rather than asynchronous latest values', () => {
    const [a,b] = pair(); a.tick=3000; a.ticks=[0,20,2000,3000];
    for(const key of Object.keys(a.values)) a.values[key]=[0,0,1,999];
    const result=evaluateGuided(GUIDED_LESSONS[0],a,b,1);
    expect(result.tick).toBe(2000); expect(result.metrics[0].a).toBe(1);
  });
  it('blocks preview, intervention, reload, and additional configuration changes', () => {
    const lesson=GUIDED_LESSONS[0]; const [a,b]=pair(); b.preview=true;
    expect(evaluateGuided(lesson,a,b,1).stage).toBe('preview'); b.preview=false; b.intervened=true;
    expect(evaluateGuided(lesson,a,b,1).stage).toBe('invalid'); b.intervened=false; b.worldEpoch=2;
    expect(evaluateGuided(lesson,a,b,1).stage).toBe('invalid'); b.worldEpoch=1; b.params!.baseTemperature=0.7;
    expect(evaluateGuided(lesson,a,b,1).stage).toBe('invalid');
  });
  it('retains early extinction as an explicit terminal observation without a causal claim', () => {
    const [a,b]=pair(0,80); a.extinct=true;
    const result=evaluateGuided(GUIDED_LESSONS[0],a,b,1);
    expect(result.stage).toBe('review'); expect(result.extinct).toBe(true); expect(result.progress).toBeLessThan(1); expect(result.message).toMatch(/wymarł/);
  });
  it('allows an insufficient early extinction before first interval to be reviewed',()=>{
    const [a,b]=pair(0,10); a.extinct=true; b.extinct=true; a.ticks=[0]; b.ticks=[0];
    const result=evaluateGuided(GUIDED_LESSONS[0],a,b,1);
    expect(result.stage).toBe('review'); expect(result.tick).toBe(0); expect(result.progress).toBe(0);
    expect(result.message).toMatch(/tylko stanu początkowego/);
  });
  it('requires finite metric values and equal aggregation windows',()=>{
    const [a,b]=pair(); b.values={}; expect(evaluateGuided(GUIDED_LESSONS[0],a,b,1).stage).toBe('waiting');
    const [c,d]=pair(); d.interval=40; expect(evaluateGuided(GUIDED_LESSONS[0],c,d,1).stage).toBe('waiting');
  });
});
