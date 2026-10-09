import { useState } from 'react';
import { FUNCTIONAL_TRAITS, TRAIT_COLORS } from './Stats';
import { TRAIT_LABELS } from '../../engine/constants';
import { STAT_COLUMNS } from '../../engine/stats';
import { manager } from '../client';
import { LineChart, Legend, type ChartSeries } from '../charts';
import { fmt, useManager } from '../hooks';

const PALETTE = ['#3de0c5', '#ffb454', '#6aa8ff', '#ff6b7a', '#ba68c8', '#7be08a', '#f06292', '#ffd54f'];

const METRICS = ['pop', 'meanEnergy', 'foodFrac', 'maxGen', 'meanGen', 'diversity', 'genomeDist', 'meanAge', 'brainCost', 'carnFrac', 'cladeTop', 'cladeCount', ...FUNCTIONAL_TRAITS.map((t) => `m_${t}`), 'births', 'deaths', 'dPred'];

/** Wyrównuje szeregi różnych światów do wspólnej siatki ticków (funkcja schodkowa). */
function align(worlds: { x: Float64Array; y: Float64Array }[], maxPoints = 500) {
  let maxT = 0;
  for (const w of worlds) if (w.x.length) maxT = Math.max(maxT, w.x[w.x.length - 1]);
  const n = Math.min(maxPoints, Math.max(2, ...worlds.map((w) => w.x.length)));
  const step = maxT / (n - 1) || 1;
  const xs = Array.from({ length: n }, (_, i) => i * step);
  const ys = worlds.map((w) => {
    let j = 0;
    return xs.map((t) => {
      if (!w.x.length || t > w.x[w.x.length - 1] + 1e-6 * maxT) return NaN;
      while (j + 1 < w.x.length && w.x[j + 1] <= t) j++;
      return w.y[j];
    });
  });
  return { xs, ys };
}

export function ComparePanel() {
  const m = useManager();
  const [metric, setMetric] = useState('pop');
  const worlds = m.worlds;
  const isRate = metric === 'births' || metric === 'deaths' || metric === 'dPred';
  const data = worlds.map((w) => ({ x: w.stats.column('tick'), y: isRate ? w.stats.rate(metric) : w.stats.column(metric) }));
  const { xs, ys } = align(data);
  const series: ChartSeries[] = worlds.map((w, i) => ({ label: w.name, color: PALETTE[i % PALETTE.length] }));
  let diffYs: number[][] = [];
  if (worlds.length === 2) {
    diffYs = [ys[0].map((v, i) => (Number.isNaN(v) || Number.isNaN(ys[1][i]) ? NaN : ys[1][i] - v))];
  }
  const label = STAT_COLUMNS.find((c) => c.key === metric)?.label ?? metric;

  return (
    <div className="panel-body">
      <section className="card">
        <header>
          <h4>Porównanie światów</h4>
          <span className="hint">{worlds.length} {worlds.length === 1 ? 'świat' : 'światy'}</span>
        </header>
        {worlds.length < 2 && <p className="note">Utwórz bliźniaka (zakładka Eksperyment → „Bliźniak od startu”) albo rozwidl świat, a następnie zmień warunki tylko w jednym z nich — wykresy pokażą rozbieżność.</p>}
        <label className="slider-row">
          <span>Metryka</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {METRICS.map((k) => (
              <option key={k} value={k}>
                {STAT_COLUMNS.find((c) => c.key === k)?.label ?? k}
              </option>
            ))}
          </select>
        </label>
        <Legend items={worlds.map((w, i) => ({ label: w.name, color: PALETTE[i % PALETTE.length], value: fmt.f2(isRate ? w.stats.recentRate(metric) : w.stats.last(metric)) }))} />
        {xs.length > 2 && <LineChart x={xs} ys={ys} series={series} height={180} epoch={worlds.map((w) => w.stats.epoch).join('-').length + worlds.length} />}
        {diffYs.length > 0 && (
          <>
            <div className="strip-label">różnica: {worlds[1].name} − {worlds[0].name} ({label})</div>
            <LineChart x={xs} ys={diffYs} series={[{ label: 'Δ', color: '#ffb454', fill: true }]} height={110} />
          </>
        )}
      </section>
      <section className="card">
        <header>
          <h4>Zestawienie</h4>
        </header>
        <div className="table-scroll">
          <table className="mini wide">
            <thead>
              <tr>
                <th>świat</th>
                <th>seed</th>
                <th>tick</th>
                <th>pop.</th>
                <th>pok.</th>
                <th>różn.</th>
                {FUNCTIONAL_TRAITS.map((t) => (
                  <th key={t} title={TRAIT_LABELS[t]} style={{ color: TRAIT_COLORS[t] }}>
                    {t.slice(0, 4)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {worlds.map((w, i) => (
                <tr key={w.id} className={w.id === m.activeId ? 'active' : ''} onClick={() => manager.setActive(w.id)}>
                  <td>
                    <i className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                    {w.name}
                  </td>
                  <td>{w.setup?.seed}</td>
                  <td>{fmt.int(w.info?.tick ?? 0)}</td>
                  <td>{fmt.int(w.info?.pop ?? 0)}</td>
                  <td>{fmt.int(w.stats.last('maxGen'))}</td>
                  <td>{fmt.f3(w.stats.last('diversity'))}</td>
                  {FUNCTIONAL_TRAITS.map((t) => (
                    <td key={t}>{fmt.f2(w.stats.last(`m_${t}`))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
