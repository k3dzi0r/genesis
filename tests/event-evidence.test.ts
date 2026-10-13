import { describe, expect, it } from 'vitest';
import { StatsClient } from '../src/ui/client';
import { N_STATS, STAT_INDEX } from '../src/engine/stats';
import { eventEvidence } from '../src/ui/eventEvidence';
function data() {
  const s = new StatsClient(), rows = new Float64Array(3 * N_STATS);
  for (let r = 0; r < 3; r++) {
    rows[r * N_STATS + STAT_INDEX.tick] = r * 40;
    rows[r * N_STATS + STAT_INDEX.pop] = [10, 5, 7][r];
    rows[r * N_STATS + STAT_INDEX.food] = 100 + r;
    rows[r * N_STATS + STAT_INDEX.deaths] = r * 3;
  }
  s.apply(rows, 0, 3, 40, true); return s;
}
describe('event evidence', () => {
  it('reports interval counters and preserves copied context across history resets', () => {
    const stats = data(), evidence = eventEvidence(stats, 27);
    expect(evidence.interval).toEqual({ from: 0, to: 40 });
    expect(evidence.counts.deaths).toBe(3);
    expect(evidence.before?.tick).toBe(0);
    expect(evidence.after?.tick).toBe(40);
    stats.apply(new Float64Array(N_STATS), 0, 1, 20, true);
    expect([...evidence.pop]).toEqual([10, 5, 7]);
  });
  it('does not fabricate post-event measurements; same-tick sample is explicitly labelled', () => {
    const s = data(), future = eventEvidence(s, 95);
    expect(future.after).toBeNull(); expect(future.interval).toBeNull(); expect(future.counts).toEqual({});
    expect(eventEvidence(s, 40).after?.tick).toBe(40);
    expect(eventEvidence(new StatsClient(), 0).before).toBeNull();
  });
});
