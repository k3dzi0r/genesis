import { useEffect, useRef, useState } from 'react';
import { PARAM_META, type EventKind, type ParamMeta, type WorldParams } from '../../engine/config';
import type { WorldClient } from '../client';
import { Help } from '../help/Help';
import { fmt, useManager } from '../hooks';

function fmtParam(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a < 0.001) return v.toExponential(1);
  if (a < 1) return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return a < 100 ? v.toFixed(2).replace(/\.?0+$/, '') : v.toFixed(0);
}

function ParamSlider({ client, k, meta, value }: { client: WorldClient; k: keyof WorldParams; meta: ParamMeta; value: number }) {
  const [local, setLocal] = useState<number | null>(null);
  const timer = useRef<number>(0);
  useEffect(() => {
    if (local !== null && Math.abs(local - value) < 1e-12) setLocal(null);
  }, [value, local]);
  useEffect(() => { window.clearTimeout(timer.current); setLocal(null); return () => window.clearTimeout(timer.current); }, [client, client.historyEpoch]);
  const v = local ?? value;
  return (
    <label className="slider-row" title={meta.hint}>
      <span>
        <span className="lbl">
          {meta.label}
          <Help id={`param.${k}`} />
        </span>
        <b>{fmtParam(v)}</b>
      </span>
      <input
        type="range"
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={v}
        onChange={(e) => {
          const nv = Number(e.target.value);
          setLocal(nv);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => client.command({ type: 'setParam', key: k, value: nv }), 140);
        }}
      />
    </label>
  );
}

const EVENT_HELP: Record<EventKind, string> = { drought: 'event.drought', bloom: 'event.bloom', coldSnap: 'event.cold', cull: 'event.cull', blight: 'event.blight' };

const EVENTS: { kind: EventKind; label: string; hint: string; timed: boolean }[] = [
  { kind: 'drought', label: 'Susza', hint: 'Spowalnia odnawianie zasobów', timed: true },
  { kind: 'bloom', label: 'Obfitość', hint: 'Przyspiesza odnawianie zasobów', timed: true },
  { kind: 'coldSnap', label: 'Ochłodzenie', hint: 'Spadek temperatury — rośnie koszt metabolizmu, odporność genetyczna chroni', timed: true },
  { kind: 'cull', label: 'Katastrofa', hint: 'Natychmiast zabija losową część populacji', timed: false },
  { kind: 'blight', label: 'Zaraza zasobów', hint: 'Natychmiast niszczy część zasobów w całym świecie', timed: false },
];

export function Controls({ client }: { client: WorldClient }) {
  useManager();
  const info = client.info;
  const preview = client.history?.preview ?? false;
  const [sev, setSev] = useState(0.6);
  const [dur, setDur] = useState(1500);
  const [food, setFood] = useState(20000);
  const groups = new Map<string, [keyof WorldParams, ParamMeta][]>();
  (Object.keys(PARAM_META) as (keyof WorldParams)[]).forEach((k) => {
    const m = PARAM_META[k];
    groups.set(m.group, [...(groups.get(m.group) ?? []), [k, m]]);
  });
  const [open, setOpen] = useState<Record<string, boolean>>({ Zasoby: true, Ewolucja: true });

  return (
    <div className="panel-body">
      {preview && <p className="note warn">Podgląd historii. Wróć do teraźniejszości lub rozwidl moment, aby zmieniać środowisko.</p>}
      <fieldset className="controls-fieldset" disabled={preview}>
      <section className="card"><header><h4>Podstawowe warunki świata</h4></header><p className="note">Mechaniki włączysz w Modułach. Tutaj zmieniasz ich warunki i koszty.</p>{info && (['regrowthRate','mutationRate','lifespanBase','baseTemperature','biomeContrast'] as (keyof WorldParams)[]).map(k=><ParamSlider key={k} client={client} k={k} meta={PARAM_META[k]} value={info.params[k]} />)}</section>
      <details className="advanced-controls"><summary>Zdarzenia i interwencje</summary>
      <section className="card">
        <header>
          <h4>
            Zdarzenia środowiskowe
            <Help id="events" />
          </h4>
          <span className="hint">interwencje są zapisywane w dzienniku eksperymentu</span>
        </header>
        <label className="slider-row">
          <span>
            <span className="lbl">
              Siła
              <Help id="event.severity" />
            </span>
            <b>{sev.toFixed(2)}</b>
          </span>
          <input type="range" min={0.05} max={1} step={0.05} value={sev} onChange={(e) => setSev(Number(e.target.value))} />
        </label>
        <label className="slider-row">
          <span>
            <span className="lbl">
              Czas trwania
              <Help id="event.duration" />
            </span>
            <b>{fmt.int(dur)} t.</b>
          </span>
          <input type="range" min={100} max={10000} step={100} value={dur} onChange={(e) => setDur(Number(e.target.value))} />
        </label>
        <div className="btn-grid">
          {EVENTS.map((e) => (
            <div key={e.kind} className="btn-help">
              <button className={`btn ev-${e.kind}`} title={e.hint} onClick={() => client.command({ type: 'event', spec: { kind: e.kind, severity: sev, duration: e.timed ? dur : undefined } })}>
                {e.label}
              </button>
              <Help id={EVENT_HELP[e.kind]} />
            </div>
          ))}
        </div>
        {info && info.activeEvents.length > 0 && (
          <div className="active-events">
            {info.activeEvents.map((a, i) => (
              <span key={i} className="tag warn">
                {a.spec.kind} · {fmt.pct(a.spec.severity)} · jeszcze {fmt.int(a.end - info.tick)} t.
              </span>
            ))}
          </div>
        )}
        <div className="kv">
          <span>
            Temperatura
            <Help id="temperature" />
          </span>
          <b>{fmt.f2(info?.temperature ?? 1)}</b>
          <span>
            Mnożnik odnawiania
            <Help id="logistic" />
          </span>
          <b>×{fmt.f2(info?.growthMult ?? 1)}</b>
        </div>
      </section>

      <section className="card">
        <header>
          <h4>
            Dosyp zasoby
            <Help id="addfood" />
          </h4>
          <span className="hint">wpływ energii spoza modelu — księgowany osobno</span>
        </header>
        <label className="slider-row">
          <span>
            Energia<b>{fmt.int(food)}</b>
          </span>
          <input type="range" min={1000} max={200000} step={1000} value={food} onChange={(e) => setFood(Number(e.target.value))} />
        </label>
        <button className="btn" onClick={() => client.command({ type: 'addFood', amount: food })}>
          Rozsyp równomiernie
        </button>
      </section>

      </details>
      <details className="advanced-controls"><summary>Wszystkie parametry · zaawansowane</summary>
      {[...groups.entries()].map(([g, items]) => (
        <section className="card collapsible" key={g}>
          <header onClick={() => setOpen({ ...open, [g]: !open[g] })}>
            <h4>
              {g}
              <Help id={`group.${g}`} />
            </h4>
            <span className="hint">{open[g] ? '▾' : '▸'}</span>
          </header>
          {open[g] && info && items.map(([k, m]) => <ParamSlider key={k} client={client} k={k} meta={m} value={info.params[k]} />)}
        </section>
      ))}
      </details>
      </fieldset>
    </div>
  );
}
