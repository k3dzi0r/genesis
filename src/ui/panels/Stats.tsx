import { useState } from 'react';
import { TRAIT_NAMES, TRAIT_LABELS } from '../../engine/constants';
import type { AblationRow, StrategyCluster } from '../../engine/analysis';
import type { ProbeMsg } from '../../worker/protocol';
import type { WorldClient } from '../client';
import { Legend, LineChart, type ChartSeries } from '../charts';
import { Help } from '../help/Help';
import { fmt, useInterval, useManager } from '../hooks';

export const TRAIT_COLORS: Record<string, string> = {
  size: '#ff8a65',
  speed: '#4fc3f7',
  sense: '#ba68c8',
  reproThreshold: '#ffd54f',
  investment: '#81c784',
  maturity: '#f06292',
  coldTolerance: '#90caf9',
  bite: '#a1887f',
  hue: '#888',
  memory: '#80cbc4',
  diet: '#ff5252',
};

export const FUNCTIONAL_TRAITS = TRAIT_NAMES.filter((t) => t !== 'hue');

function Kpi({ label, value, sub, tone, help }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'warn'; help?: string }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <span>
        {label}
        {help && <Help id={help} />}
      </span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function ChartCard({ title, hint, help, children }: { title: string; hint?: string; help?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <header>
        <h4>
          {title}
          {help && <Help id={help} />}
        </h4>
        {hint && <span className="hint">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

function BehaviorProbes({ client }: { client: WorldClient }) {
  const [res, setRes] = useState<ProbeMsg | null>(null);
  useInterval(
    async () => {
      if (client.info?.status === 'extinct') return;
      setRes(await client.probe());
    },
    4000,
    true,
    client.id,
  );
  return (
    <section className="card">
      <header>
        <h4>
          Sondy zachowań
          <Help id="probes" />
        </h4>
        <span className="hint">czy mózgi reagują na bodźce? wynik vs losowe sieci</span>
      </header>
      {!res || res.n === 0 ? (
        <div className="chart-empty">Brak danych.</div>
      ) : (
        <>
          {res.results.map((r) => {
            const strong = Math.abs(r.z) >= 4;
            const tone = !strong ? 'var(--faint)' : r.z > 0 ? 'var(--good)' : 'var(--bad)';
            return (
              <div key={r.key} className="probe" title={r.description}>
                <div className="probe-head">
                  <span>{r.label}</span>
                  <b style={{ color: tone }}>
                    {r.mean >= 0 ? '+' : ''}
                    {r.mean.toFixed(2)} <small>z={r.z.toFixed(1)}</small>
                  </b>
                </div>
                <div className="delta-bar">
                  <i style={{ left: r.mean >= 0 ? '50%' : `${50 + r.mean * 50}%`, width: `${Math.min(1, Math.abs(r.mean)) * 50}%`, background: tone }} />
                </div>
              </div>
            );
          })}
          <p className="note">
            Dodatni wynik = odruch wyglądający adaptacyjnie; z = odchylenie od losowych sieci w błędach standardowych (|z| &lt; 4 traktuj jak szum). Sondy wykrywają tylko proste
            odruchy wejście→wyjście, nie pamięć ani planowanie — to nie jest dowód „inteligencji”.
          </p>
        </>
      )}
    </section>
  );
}

function StrategiesCard({ client }: { client: WorldClient }) {
  const [clusters, setClusters] = useState<StrategyCluster[]>([]);
  useInterval(
    async () => {
      if (client.info?.status === 'extinct') return;
      const r = await client.strategies(4);
      setClusters(r.clusters);
    },
    6000,
    true,
    client.id,
  );
  return (
    <section className="card">
      <header>
        <h4>
          Strategie w populacji
          <Help id="strategies" />
        </h4>
        <span className="hint">k-średnie po cechach fizycznych (k=4)</span>
      </header>
      {clusters.length === 0 ? (
        <div className="chart-empty">Brak danych.</div>
      ) : (
        clusters.map((c, i) => (
          <div key={i} className="strategy" title={`energia ${fmt.pct(c.meanEnergy)} · wiek ${fmt.int(c.meanAge)} · potomstwo ${c.meanOffspring.toFixed(2)} · pokolenie ${c.meanGeneration.toFixed(0)}`}>
            <div className="strategy-head">
              <b>{fmt.pct(c.share)}</b>
              <span>{c.label}</span>
            </div>
            <div className="share-bar">
              <i style={{ width: `${c.share * 100}%` }} />
            </div>
            <div className="trait-mini">
              {FUNCTIONAL_TRAITS.map((t) => (
                <span key={t} title={`${TRAIT_LABELS[t]}: ${(c.centroid[t] ?? 0).toFixed(2)}`}>
                  <i style={{ height: `${Math.max(2, (c.centroid[t] ?? 0) * 100)}%`, background: TRAIT_COLORS[t] }} />
                </span>
              ))}
            </div>
          </div>
        ))
      )}
      <p className="note">Słupki: {FUNCTIONAL_TRAITS.map((t) => TRAIT_LABELS[t]).join(' · ')}. Podpisy wynikają z odchyleń centroidu od średniej populacji.</p>
    </section>
  );
}

function AblationCard({ client }: { client: WorldClient }) {
  const [ticks, setTicks] = useState(500);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<AblationRow[]>([]);
  const [prog, setProg] = useState(0);
  const run = async () => {
    setRunning(true);
    setRows([]);
    setProg(0);
    await client.ablation(ticks, (m) => {
      setRows((r) => [...r, m.row]);
      setProg(m.done / m.total);
    });
    setRunning(false);
  };
  const bar = (v: number, z: number, scale: number) => {
    const tone = Math.abs(z) < 3 ? 'var(--faint)' : v > 0 ? 'var(--good)' : 'var(--bad)';
    return (
      <div className="delta-bar">
        <i style={{ left: v >= 0 ? '50%' : `${50 + Math.max(-1, v / scale) * 50}%`, width: `${Math.min(1, Math.abs(v) / scale) * 50}%`, background: tone }} />
      </div>
    );
  };
  return (
    <section className="card">
      <header>
        <h4>
          Test ablacji zmysłów
          <Help id="ablation" />
        </h4>
        <span className="hint">czy zmysł się opłaca? połowa populacji go traci</span>
      </header>
      <div className="row">
        <label className="inline">
          okno
          <input type="number" min={100} max={3000} step={100} value={ticks} onChange={(e) => setTicks(Number(e.target.value))} />
          ticków
        </label>
        <button className="btn primary" disabled={running || client.info?.status === 'extinct'} onClick={run}>
          {running ? 'Liczę…' : 'Uruchom test'}
        </button>
      </div>
      {running && (
        <div className="progress">
          <i style={{ width: `${prog * 100}%` }} />
        </div>
      )}
      {rows.map((r) => (
        <div key={r.group} className="probe" title={`ablowani: przeżycie ${fmt.pct(r.ablated.survival)}, potomstwo ${r.ablated.offspring.toFixed(2)} · nienaruszeni: przeżycie ${fmt.pct(r.intact.survival)}, potomstwo ${r.intact.offspring.toFixed(2)} (n=${r.ablated.n}+${r.intact.n})`}>
          <div className="probe-head">
            <span>{r.label}</span>
            <b style={{ color: Math.abs(r.zSurvival) >= 3 || Math.abs(r.zOffspring) >= 3 ? 'var(--text)' : 'var(--faint)' }}>
              przeżycie {r.dSurvival >= 0 ? '+' : ''}
              {(r.dSurvival * 100).toFixed(0)} pp <small>z={r.zSurvival.toFixed(1)}</small> · potomstwo {r.dOffspring >= 0 ? '+' : ''}
              {r.dOffspring.toFixed(2)} <small>z={r.zOffspring.toFixed(1)}</small>
            </b>
          </div>
          {bar(r.dSurvival, r.zSurvival, 0.3)}
        </div>
      ))}
      <p className="note">
        Wynik dodatni = organizmy z tym zmysłem żyją dłużej / mają więcej potomstwa niż te bez niego, w tym samym świecie 
        Wejścia ablowanych są podstawiane średnią populacji, więc znika informacja, ale nie zmienia się punkt pracy sieci. Test pokazuje, że zmysł jest używany i się opłaca — nie mówi, <i>co</i> sieć z nim robi.
        Na czas testu symulacja tego świata jest wstrzymana.
      </p>
    </section>
  );
}

export function StatsPanel({ client }: { client: WorldClient }) {
  useManager();
  const s = client.stats;
  const info = client.info;
  const x = s.column('tick');
  const epoch = s.epoch;
  const none = s.count < 2;

  const pick = (keys: { key: string; label: string; color: string; scale?: 'y' | 'y2'; rate?: boolean; dash?: number[]; fill?: boolean }[]) => ({
    ys: keys.map((k) => (k.rate ? s.rate(k.key) : s.column(k.key))),
    series: keys.map<ChartSeries>((k) => ({ label: k.label, color: k.color, scale: k.scale, dash: k.dash, fill: k.fill })),
    legend: keys.map((k) => ({ label: k.label, color: k.color, value: fmt.f2(k.rate ? s.recentRate(k.key) : s.last(k.key)) })),
  });

  const pop = pick([
    { key: 'pop', label: 'Populacja', color: '#3de0c5', fill: true },
    { key: 'births', label: 'Narodziny/1000t', color: '#7be08a', scale: 'y2', rate: true },
    { key: 'deaths', label: 'Zgony/1000t', color: '#ff6b7a', scale: 'y2', rate: true },
  ]);
  const traits = {
    ys: FUNCTIONAL_TRAITS.map((t) => s.column(`m_${t}`)),
    series: FUNCTIONAL_TRAITS.map<ChartSeries>((t) => ({ label: TRAIT_LABELS[t], color: TRAIT_COLORS[t] })),
    legend: FUNCTIONAL_TRAITS.map((t) => ({ label: TRAIT_LABELS[t], color: TRAIT_COLORS[t], value: fmt.f2(s.last(`m_${t}`)) })),
  };
  const energy = pick([
    { key: 'meanEnergy', label: 'Śr. energia (ułamek)', color: '#ffd54f' },
    { key: 'foodFrac', label: 'Zasoby (ułamek pojemności)', color: '#7be08a' },
  ]);
  const div = pick([
    { key: 'diversity', label: 'Różnorodność cech (śr. σ)', color: '#ba68c8' },
    { key: 'genomeDist', label: 'Odległość genomów (RMS)', color: '#4fc3f7', scale: 'y2' },
  ]);
  const gens = pick([
    { key: 'maxGen', label: 'Maks. pokolenie', color: '#f06292' },
    { key: 'meanGen', label: 'Śr. pokolenie', color: '#ffd54f' },
  ]);
  const deaths = pick([
    { key: 'dStarve', label: 'Głód', color: '#ff6b7a', rate: true },
    { key: 'dPred', label: 'Drapieżnik', color: '#ff5252', rate: true },
    { key: 'dAge', label: 'Starość', color: '#ffd54f', rate: true },
    { key: 'dHealth', label: 'Zdrowie', color: '#ba68c8', rate: true },
    { key: 'dAccident', label: 'Wypadek', color: '#90caf9', rate: true },
    { key: 'dCull', label: 'Katastrofa', color: '#ff8a65', rate: true },
  ]);
  const brain = pick([
    { key: 'brainCost', label: 'Śr. Σ|waga| mózgu', color: '#4fc3f7' },
    { key: 'meanAge', label: 'Śr. wiek', color: '#ffd54f', scale: 'y2' },
  ]);
  const predation = pick([
    { key: 'carnFrac', label: 'Udział drapieżników (dieta > 0,3)', color: '#ff5252' },
    { key: 'predEnergy', label: 'Energia przejęta/1000t', color: '#ffb454', scale: 'y2', rate: true },
  ]);
  const clades = pick([
    { key: 'cladeTop', label: 'Udział największego kladu', color: '#6aa8ff' },
    { key: 'cladeCount', label: 'Liczba żyjących kladów', color: '#ba68c8', scale: 'y2' },
  ]);
  const flow = pick([
    { key: 'eIn', label: 'Energia wpływająca/1000t', color: '#7be08a', rate: true },
    { key: 'eOut', label: 'Energia rozpraszana/1000t', color: '#ff6b7a', rate: true },
  ]);

  const birthsRate = s.recentRate('births');
  const deathsRate = s.recentRate('deaths');

  const CHART_HELP: Record<string, string> = {
    'Populacja i demografia': 'chart.pop',
    'Ewolucja cech (średnie)': 'chart.traits',
    'Energia i zasoby': 'chart.energy',
    'Różnorodność genetyczna': 'chart.diversity',
    Pokolenia: 'chart.gens',
    'Przyczyny zgonów': 'chart.deaths',
    Drapieżnictwo: 'chart.predation',
    'Klady (linie założycieli)': 'chart.clades',
    'Złożoność mózgu i długość życia': 'chart.brain',
    'Przepływ energii': 'chart.flow',
  };
  const chart = (title: string, hint: string, d: { ys: ArrayLike<number>[]; series: ChartSeries[]; legend: { label: string; color: string; value: string }[] }, extra: { yMin?: number; yMax?: number } = {}) => (
    <ChartCard title={title} hint={hint} help={CHART_HELP[title]}>
      <Legend items={d.legend} />
      {none ? <div className="chart-empty">Zbieranie danych…</div> : <LineChart x={x} ys={d.ys} series={d.series} epoch={epoch} {...extra} />}
    </ChartCard>
  );

  return (
    <div className="panel-body">
      <div className="kpis">
        <Kpi help="kpi.pop" label="Żywe organizmy" value={fmt.int(info?.pop ?? 0)} tone={info?.status === 'extinct' ? 'bad' : undefined} />
        <Kpi help="kpi.births" label="Narodziny /1000t" value={fmt.f1(birthsRate)} />
        <Kpi help="kpi.deaths" label="Zgony /1000t" value={fmt.f1(deathsRate)} />
        <Kpi help="kpi.age" label="Średni wiek" value={fmt.int(s.last('meanAge'))} sub="ticków" />
        <Kpi help="kpi.gen" label="Pokolenia (maks.)" value={fmt.int(s.last('maxGen'))} sub={`śr. ${fmt.f1(s.last('meanGen'))}`} />
        <Kpi help="kpi.energy" label="Śr. energia" value={fmt.pct(s.last('meanEnergy'))} />
        <Kpi help="kpi.resources" label="Zasoby" value={fmt.pct(s.last('foodFrac'))} sub="pojemności" />
        <Kpi help="kpi.diversity" label="Różnorodność" value={fmt.f3(s.last('diversity'))} sub="śr. σ cech" />
        <Kpi help="kpi.reprorate" label="Tempo reprodukcji" value={fmt.f2(s.last('reproRate'))} sub="‰/tick/os." />
      </div>
      <StrategiesCard client={client} />
      <BehaviorProbes client={client} />
      <AblationCard client={client} />
      {chart('Populacja i demografia', 'liczba żywych oraz narodziny/zgony na 1000 ticków', pop)}
      {chart('Ewolucja cech (średnie)', 'wartości genów znormalizowane do 0–1', traits, { yMin: 0, yMax: 1 })}
      {chart('Energia i zasoby', '', energy, { yMin: 0 })}
      {chart('Różnorodność genetyczna', 'rozrzut cech oraz średnia odległość par genomów', div)}
      {chart('Pokolenia', '', gens)}
      {chart('Przyczyny zgonów', 'zgony na 1000 ticków', deaths)}
      {chart('Drapieżnictwo', 'udział drapieżników i energia przejmowana od ofiar', predation, { yMin: 0 })}
      {chart('Klady (linie założycieli)', 'wymiatanie: jeden klad przejmuje populację', clades)}
      {chart('Złożoność mózgu i długość życia', 'Σ|waga| ~ koszt utrzymania sieci', brain)}
      {chart('Przepływ energii', 'wpływ (odnawianie zasobów) vs rozproszenie (ciepło)', flow)}
      <section className="card">
        <header>
          <h4>
            Bilans energii
            <Help id="ledger" />
          </h4>
          <span className="hint">kontrola poprawności modelu</span>
        </header>
        <div className="kv">
          <span>Wpływ łącznie</span>
          <b>{fmt.big(info?.ledger.totalIn ?? 0)}</b>
          <span>Rozproszono</span>
          <b>{fmt.big(info?.ledger.totalOut ?? 0)}</b>
          <span>W organizmach</span>
          <b>{fmt.big(info?.ledger.organisms ?? 0)}</b>
          <span>W zasobach</span>
          <b>{fmt.big(info?.ledger.food ?? 0)}</b>
          <span>
            Niezgodność bilansu
            <Help id="chart.balance" />
          </span>
          <b className={Math.abs(info?.energyImbalance ?? 0) < 1e-3 ? 'ok' : 'bad'}>{(info?.energyImbalance ?? 0).toExponential(1)}</b>
        </div>
      </section>
    </div>
  );
}
