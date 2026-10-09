import { Fragment, useEffect, useRef, useState } from 'react';
import { PARAM_META, type WorldParams } from '../../engine/config';
import { SWEEP_METRICS, sweepToCsv, type SweepResult } from '../../engine/experiment';
import { ci95, welchTest } from '../../engine/statsutil';
import { downloadBytes } from '../../storage/db';
import type { FromSeries, ToSeries } from '../../worker/protocol';
import { manager, type WorldClient } from '../client';
import { fmt } from '../hooks';

interface ParamOption {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SETUP_OPTIONS: ParamOption[] = [
  { key: 'initialPopulation', label: 'Liczba założycieli', min: 50, max: 1500, step: 50 },
  { key: 'patchCount', label: 'Liczba żyznych plam', min: 1, max: 20, step: 1 },
  { key: 'founderDietMax', label: 'Maks. dieta założycieli', min: 0, max: 1, step: 0.05 },
];

const OPTIONS: ParamOption[] = [
  ...(Object.keys(PARAM_META) as (keyof WorldParams)[]).map((k) => ({ key: k as string, label: PARAM_META[k].label, min: PARAM_META[k].min, max: PARAM_META[k].max, step: PARAM_META[k].step })),
  ...SETUP_OPTIONS,
];

function currentValue(client: WorldClient, key: string): number {
  const p = client.initialParams as Record<string, number> | null;
  const i = client.info?.params as unknown as Record<string, number> | undefined;
  const s = (client.initialSetup ?? client.setup) as unknown as Record<string, number> | null;
  return p?.[key] ?? s?.[key] ?? i?.[key] ?? 0;
}

function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  return Array.from({ length: n }, (_, i) => Number((a + ((b - a) * i) / (n - 1)).toPrecision(5)));
}

/** Uruchamia worker serii i raportuje postęp. */
function useSweepWorker() {
  const w = useRef<Worker | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SweepResult | null>(null);
  useEffect(() => () => w.current?.terminate(), []);
  const run = (msg: Extract<ToSeries, { t: 'sweep' }>) => {
    w.current?.terminate();
    const worker = new Worker(new URL('../../worker/series.worker.ts', import.meta.url), { type: 'module' });
    w.current = worker;
    setRunning(true);
    setProgress(0);
    setResult(null);
    worker.onmessage = (e: MessageEvent<FromSeries>) => {
      const m = e.data;
      if (m.t === 'sweepProgress') setProgress(m.done / m.total);
      else if (m.t === 'sweepDone') {
        setResult(m.result);
        setRunning(false);
        worker.terminate();
      } else if (m.t === 'error') {
        manager.toast(`Błąd: ${m.message}`);
        setRunning(false);
      }
    };
    worker.postMessage(msg);
  };
  const stop = () => {
    w.current?.terminate();
    setRunning(false);
  };
  return { run, stop, running, progress, result };
}

function Heatmap({ r, metric }: { r: SweepResult; metric: string }) {
  const get = SWEEP_METRICS.find((m) => m.key === metric)!.get;
  const vals = r.cells.map((row) => row.map((cell) => ci95(cell.map(get))));
  const flat = vals.flat().map((v) => v.mean);
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  return (
    <div className="heatmap" style={{ gridTemplateColumns: `auto repeat(${r.x.values.length}, 1fr)` }}>
      <span className="axis-label" />
      {r.x.values.map((v) => (
        <span key={v} className="axis-label">
          {v}
        </span>
      ))}
      {vals.map((row, iy) => (
        <Fragment key={`r${iy}`}>
          <span className="axis-label">
            {r.y ? r.y.values[iy] : ''}
          </span>
          {row.map((c, ix) => {
            const t = hi > lo ? (c.mean - lo) / (hi - lo) : 0.5;
            const ext = r.cells[iy][ix].filter((s) => s.status === 'extinct').length;
            return (
              <span
                key={`${iy}-${ix}`}
                className="hm-cell"
                style={{ background: `rgba(61,224,197,${0.08 + t * 0.62})` }}
                title={`${r.x.key}=${r.x.values[ix]}${r.y ? `, ${r.y.key}=${r.y.values[iy]}` : ''}\nśrednia ${c.mean.toFixed(3)} (95% CI ${c.lo.toFixed(3)} … ${c.hi.toFixed(3)}), n=${c.n}\nwymarcia: ${ext}/${c.n}`}
              >
                {Math.abs(c.mean) >= 100 ? c.mean.toFixed(0) : c.mean.toFixed(2)}
                {ext > 0 && <small> ✝{ext}</small>}
              </span>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

export function SweepRunner({ client }: { client: WorldClient }) {
  const [xk, setXk] = useState('regrowthRate');
  const [xmin, setXmin] = useState(0.05);
  const [xmax, setXmax] = useState(0.2);
  const [xn, setXn] = useState(4);
  const [yk, setYk] = useState('');
  const [ymin, setYmin] = useState(0.5);
  const [ymax, setYmax] = useState(4);
  const [yn, setYn] = useState(3);
  const [seedsN, setSeedsN] = useState(3);
  const [ticks, setTicks] = useState(8000);
  const [metric, setMetric] = useState('finalPop');
  const sw = useSweepWorker();

  const pick = (key: string, setMin: (v: number) => void, setMax: (v: number) => void) => {
    const o = OPTIONS.find((q) => q.key === key);
    if (!o) return;
    const cur = currentValue(client, key);
    const a = cur > 0 ? Math.max(o.min, cur * 0.5) : o.min;
    const b = cur > 0 ? Math.min(o.max, cur * 1.6) : o.max;
    setMin(Number(a.toPrecision(3)));
    setMax(Number(b.toPrecision(3)));
  };
  const total = xn * (yk ? yn : 1) * seedsN;

  const start = () => {
    sw.run({
      t: 'sweep',
      setup: client.initialSetup ?? client.setup ?? {},
      params: client.initialParams ?? client.info?.params ?? {},
      x: { key: xk, values: linspace(xmin, xmax, xn) },
      y: yk ? { key: yk, values: linspace(ymin, ymax, yn) } : null,
      seeds: Array.from({ length: seedsN }, (_, i) => i + 1),
      ticks,
    });
  };

  const sel = (value: string, set: (v: string) => void, onPick: (v: string) => void, allowNone = false) => (
    <select
      value={value}
      onChange={(e) => {
        set(e.target.value);
        onPick(e.target.value);
      }}
    >
      {allowNone && <option value="">— brak (1D) —</option>}
      {OPTIONS.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <section className="card">
      <header>
        <h4>Przeszukiwanie parametrów</h4>
        <span className="hint">siatka × seedy, headless w osobnym wątku</span>
      </header>
      <div className="form-grid">
        <label className="span2">
          Oś X
          {sel(xk, setXk, (v) => pick(v, setXmin, setXmax))}
        </label>
        <label>
          od
          <input type="number" step="any" value={xmin} onChange={(e) => setXmin(Number(e.target.value))} />
        </label>
        <label>
          do
          <input type="number" step="any" value={xmax} onChange={(e) => setXmax(Number(e.target.value))} />
        </label>
        <label className="span2">
          Liczba wartości X
          <input type="number" min={2} max={10} value={xn} onChange={(e) => setXn(Number(e.target.value))} />
        </label>
        <label className="span2">
          Oś Y (opcjonalnie)
          {sel(yk, setYk, (v) => v && pick(v, setYmin, setYmax), true)}
        </label>
        {yk && (
          <>
            <label>
              od
              <input type="number" step="any" value={ymin} onChange={(e) => setYmin(Number(e.target.value))} />
            </label>
            <label>
              do
              <input type="number" step="any" value={ymax} onChange={(e) => setYmax(Number(e.target.value))} />
            </label>
            <label className="span2">
              Liczba wartości Y
              <input type="number" min={2} max={10} value={yn} onChange={(e) => setYn(Number(e.target.value))} />
            </label>
          </>
        )}
        <label>
          Seedów na komórkę
          <input type="number" min={1} max={20} value={seedsN} onChange={(e) => setSeedsN(Number(e.target.value))} />
        </label>
        <label>
          Ticków na przebieg
          <input type="number" min={500} step={500} value={ticks} onChange={(e) => setTicks(Number(e.target.value))} />
        </label>
        <label className="span2">
          Metryka
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {SWEEP_METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        {!sw.running ? (
          <button className="btn primary" onClick={start}>
            Uruchom ({total} przebiegów)
          </button>
        ) : (
          <button className="btn danger" onClick={sw.stop}>
            Przerwij
          </button>
        )}
        {sw.result && (
          <button className="btn" onClick={() => downloadBytes(`genesis-sweep-${xk}${yk ? `-${yk}` : ''}.csv`, sweepToCsv(sw.result!), 'text/csv')}>
            Eksport CSV
          </button>
        )}
      </div>
      {sw.running && (
        <div className="progress">
          <i style={{ width: `${sw.progress * 100}%` }} />
        </div>
      )}
      {sw.result && <Heatmap r={sw.result} metric={metric} />}
      {sw.result && (
        <p className="note">
          Komórka = średnia metryki po seedach (najechanie pokazuje 95% przedział ufności i wymarcia ✝). Wnioski o wpływie parametru warto potwierdzić testem A/B poniżej.
        </p>
      )}
    </section>
  );
}

export function AbTest({ client }: { client: WorldClient }) {
  const [key, setKey] = useState('predationPower');
  const [a, setA] = useState(0);
  const [b, setB] = useState(4);
  const [seedsN, setSeedsN] = useState(8);
  const [ticks, setTicks] = useState(8000);
  const [metric, setMetric] = useState('finalPop');
  const sw = useSweepWorker();

  const start = () =>
    sw.run({
      t: 'sweep',
      setup: client.initialSetup ?? client.setup ?? {},
      params: client.initialParams ?? client.info?.params ?? {},
      x: { key, values: [a, b] },
      y: null,
      seeds: Array.from({ length: seedsN }, (_, i) => i + 1),
      ticks,
    });

  let out: React.ReactNode = null;
  if (sw.result) {
    const get = SWEEP_METRICS.find((m) => m.key === metric)!.get;
    const va = sw.result.cells[0][0].map(get);
    const vb = sw.result.cells[0][1].map(get);
    const ca = ci95(va);
    const cb = ci95(vb);
    const t = welchTest(va, vb);
    const sig = t.p < 0.05;
    out = (
      <div className="kv">
        <span>
          A: {key} = {a}
        </span>
        <b>
          {ca.mean.toFixed(3)} <small>[{ca.lo.toFixed(3)}; {ca.hi.toFixed(3)}]</small>
        </b>
        <span>
          B: {key} = {b}
        </span>
        <b>
          {cb.mean.toFixed(3)} <small>[{cb.lo.toFixed(3)}; {cb.hi.toFixed(3)}]</small>
        </b>
        <span>Różnica B − A (95% CI)</span>
        <b>
          {t.diff.toFixed(3)} <small>[{t.ciLo.toFixed(3)}; {t.ciHi.toFixed(3)}]</small>
        </b>
        <span>Test Welcha</span>
        <b>
          t = {t.t.toFixed(2)}, df = {t.df.toFixed(1)}
        </b>
        <span>Wartość p (dwustronna)</span>
        <b className={sig ? 'ok' : ''}>{t.p < 0.0001 ? '< 0,0001' : t.p.toFixed(4)}</b>
        <span>Wymarcia A / B</span>
        <b>
          {sw.result.cells[0][0].filter((s) => s.status === 'extinct').length} / {sw.result.cells[0][1].filter((s) => s.status === 'extinct').length}
        </b>
      </div>
    );
  }

  return (
    <section className="card">
      <header>
        <h4>Test A/B dwóch ustawień</h4>
        <span className="hint">ta sama pula seedów, test t Welcha</span>
      </header>
      <div className="form-grid">
        <label className="span2">
          Parametr
          <select
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              const cur = currentValue(client, e.target.value);
              setA(cur);
              setB(cur);
            }}
          >
            {OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Wartość A
          <input type="number" step="any" value={a} onChange={(e) => setA(Number(e.target.value))} />
        </label>
        <label>
          Wartość B
          <input type="number" step="any" value={b} onChange={(e) => setB(Number(e.target.value))} />
        </label>
        <label>
          Seedów na grupę
          <input type="number" min={3} max={40} value={seedsN} onChange={(e) => setSeedsN(Number(e.target.value))} />
        </label>
        <label>
          Ticków na przebieg
          <input type="number" min={500} step={500} value={ticks} onChange={(e) => setTicks(Number(e.target.value))} />
        </label>
        <label className="span2">
          Metryka
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {SWEEP_METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        {!sw.running ? (
          <button className="btn primary" onClick={start}>
            Uruchom ({2 * seedsN} przebiegów)
          </button>
        ) : (
          <button className="btn danger" onClick={sw.stop}>
            Przerwij
          </button>
        )}
      </div>
      {sw.running && (
        <div className="progress">
          <i style={{ width: `${sw.progress * 100}%` }} />
        </div>
      )}
      {out}
      {sw.result && <p className="note">p &lt; 0,05 oznacza, że różnica jest mało prawdopodobna jako przypadek przy tej liczbie seedów. Brak istotności nie dowodzi braku efektu — zwiększ liczbę seedów. {fmt.int(seedsN * 2)} przebiegów, to nie jest korekta na wielokrotne testowanie.</p>}
    </section>
  );
}
