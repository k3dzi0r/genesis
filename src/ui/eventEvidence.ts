import type { StatsClient } from './client';

export const EVENT_COUNT_KEYS = ['births', 'deaths', 'dStarve', 'dAge', 'dHealth', 'dAccident', 'dCull', 'dPred'] as const;
export interface EventEvidence {
  eventTick: number; sampledThrough: number; interval: { from: number; to: number } | null;
  before: { tick: number; pop: number; food: number } | null;
  after: { tick: number; pop: number; food: number } | null;
  counts: Record<string, number>; ticks: Float64Array; pop: Float64Array; food: Float64Array;
}
/** Copies the statistical context before seeking replaces the displayed world's stats. */
export function eventEvidence(stats: Pick<StatsClient, 'column' | 'count'>, eventTick: number): EventEvidence {
  const ticks = stats.column('tick'), pop = stats.column('pop'), food = stats.column('food');
  let after = 0;
  while (after < ticks.length && ticks[after] < eventTick) after++;
  const before = after - 1;
  const row = (i: number) => i >= 0 && i < ticks.length ? { tick: ticks[i], pop: pop[i], food: food[i] } : null;
  const from = Math.max(0, after - 30), to = Math.min(ticks.length, after + 31);
  const hasAfter = after < ticks.length;
  return { eventTick, sampledThrough: ticks.length ? ticks[ticks.length - 1] : 0,
    interval: hasAfter && after > 0 ? { from: ticks[after - 1], to: ticks[after] } : null,
    before: row(before), after: row(after),
    counts: hasAfter ? Object.fromEntries(EVENT_COUNT_KEYS.map(key => [key, stats.column(key)[after]])) : {},
    ticks: ticks.slice(from, to), pop: pop.slice(from, to), food: food.slice(from, to),
  };
}
