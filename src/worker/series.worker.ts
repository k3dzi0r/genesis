/// <reference lib="webworker" />
/** Worker serii: ta sama konfiguracja uruchamiana headless dla wielu seedów oraz przeszukiwanie siatki parametrów. */
import { runHeadless, runSweep } from '../engine/experiment';
import type { FromSeries, ToSeries } from './protocol';
import type { RunSummary } from '../engine/experiment';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<ToSeries>) => {
  const m = ev.data;
  try {
    if (m.t === 'run') {
      const results: RunSummary[] = [];
      m.seeds.forEach((seed, k) => {
        const { summary } = runHeadless({ ...m.setup, seed }, m.params, { ticks: m.ticks });
        results.push(summary);
        ctx.postMessage({ t: 'progress', done: k + 1, total: m.seeds.length, summary } satisfies FromSeries);
      });
      ctx.postMessage({ t: 'done', results } satisfies FromSeries);
    } else if (m.t === 'sweep') {
      const result = runSweep(m.setup, m.params, m.x, m.y, m.seeds, m.ticks, (done, total) =>
        ctx.postMessage({ t: 'sweepProgress', done, total } satisfies FromSeries),
      );
      ctx.postMessage({ t: 'sweepDone', result } satisfies FromSeries);
    }
  } catch (e) {
    ctx.postMessage({ t: 'error', message: String(e) } satisfies FromSeries);
  }
};
