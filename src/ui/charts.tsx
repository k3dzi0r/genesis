import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ChartSeries {
  label: string;
  color: string;
  /** 'y' (lewa oś) lub 'y2' (prawa oś) */
  scale?: 'y' | 'y2';
  dash?: number[];
  fill?: boolean;
}

interface Props {
  x: ArrayLike<number>;
  ys: ArrayLike<number>[];
  series: ChartSeries[];
  height?: number;
  /** gdy zmienia się, wykres jest tworzony od nowa (np. po scaleniu historii) */
  epoch?: number;
  yMin?: number;
  yMax?: number;
  logY?: boolean;
  xLabel?: string;
}

const AXIS = '#7d93a3';

/** uPlot traktuje null jako lukę; NaN psuje skale. */
const toArr = (a: ArrayLike<number>): (number | null)[] => Array.from(a, (v) => (Number.isNaN(v) ? null : v));
const GRID = 'rgba(125,147,163,0.12)';

function fmtTick(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v % 1e3 ? 1 : 0)}k`;
  return String(Math.round(v * 100) / 100);
}

export function LineChart({ x, ys, series, height = 150, epoch = 0, yMin, yMax, logY }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const sig = series.map((s) => `${s.label}|${s.color}|${s.scale ?? 'y'}`).join(';');

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const hasY2 = series.some((s) => s.scale === 'y2');
    const opts: uPlot.Options = {
      width: el.clientWidth || 300,
      height,
      padding: [6, 6, 0, 0],
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, points: { size: 6 } },
      scales: {
        x: { time: false },
        y: { range: (_u, mn, mx) => [yMin ?? (logY ? Math.max(mn, 1e-6) : Math.min(0, mn)), yMax ?? mx + (mx - mn) * 0.08 + 1e-9], distr: logY ? 3 : 1 },
        y2: { range: (_u, mn, mx) => [Math.min(0, mn), mx + (mx - mn) * 0.08 + 1e-9] },
      },
      axes: [
        { stroke: AXIS, grid: { stroke: GRID, width: 1 }, ticks: { stroke: GRID }, font: '10px ui-monospace, Menlo, monospace', values: (_u, vals) => vals.map(fmtTick), size: 24 },
        { stroke: AXIS, grid: { stroke: GRID, width: 1 }, ticks: { stroke: GRID }, font: '10px ui-monospace, Menlo, monospace', values: (_u, vals) => vals.map(fmtTick), size: 40 },
        ...(hasY2 ? [{ scale: 'y2', side: 1, stroke: AXIS, grid: { show: false }, ticks: { stroke: GRID }, font: '10px ui-monospace, Menlo, monospace', values: (_u: uPlot, vals: number[]) => vals.map(fmtTick), size: 40 } as uPlot.Axis] : []),
      ],
      series: [
        {},
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 1.4,
          scale: s.scale ?? 'y',
          dash: s.dash,
          fill: s.fill ? `${s.color}22` : undefined,
          points: { show: false },
        })),
      ],
    };
    const u = new uPlot(opts, [Array.from(x), ...ys.map(toArr)] as uPlot.AlignedData, el);
    plot.current = u;
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth || 300, height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, epoch, height, yMin, yMax, logY]);

  useEffect(() => {
    plot.current?.setData([Array.from(x), ...ys.map(toArr)] as uPlot.AlignedData);
  });

  return <div ref={host} className="chart" />;
}

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label} className="legend-item">
          <i style={{ background: it.color }} />
          {it.label}
          {it.value !== undefined && <b>{it.value}</b>}
        </span>
      ))}
    </div>
  );
}
