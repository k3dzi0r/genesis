import { useEffect, useState } from 'react';
import { ENGINE_VERSION } from '../engine/constants';
import { getSaveBytes, listSaves, type SaveMeta } from '../storage/db';
import { manager, type WorldClient } from './client';
import { fmt, useManager } from './hooks';
import { WorldView } from './WorldView';
import { Controls } from './panels/Controls';
import { ComparePanel } from './panels/Compare';
import { ExperimentPanel, SavesPanel } from './panels/Experiment';
import { Genealogy } from './panels/Genealogy';
import { Inspector } from './panels/Inspector';
import { LogPanel } from './panels/Log';
import { StatsPanel } from './panels/Stats';

type LeftTab = 'env' | 'exp' | 'saves';
type RightTab = 'stats' | 'org' | 'gen' | 'cmp' | 'log';

const SPEEDS: { label: string; tps: number }[] = [
  { label: '1×', tps: 30 },
  { label: '10×', tps: 300 },
  { label: '100×', tps: 3000 },
  { label: '1000×', tps: 30000 },
  { label: 'MAX', tps: 1e9 },
];

let booted = false;

function Brand() {
  return (
    <div className="brand">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeOpacity=".45" />
        <circle cx="16" cy="16" r="5" fill="currentColor" />
        <circle cx="25" cy="10" r="2.2" fill="currentColor" fillOpacity=".7" />
      </svg>
      <div>
        <b>GENESIS</b>
        <small>laboratorium sztucznego życia</small>
      </div>
    </div>
  );
}

function Toolbar({ client }: { client: WorldClient }) {
  useManager();
  const info = client.info;
  const playing = info?.playing ?? false;
  const extinct = info?.status === 'extinct';
  return (
    <div className="toolbar">
      <button className={`btn play ${playing ? 'on' : ''}`} disabled={extinct} onClick={() => client.play(!playing)} title="Start / pauza (spacja)">
        {playing ? '❚❚ Pauza' : '▶ Start'}
      </button>
      <button className="btn" disabled={extinct} onClick={() => client.step(1)} title="Jeden tick (.)">
        ⏭ Krok
      </button>
      <button className="btn" disabled={extinct} onClick={() => client.step(100)} title="100 ticków">
        +100
      </button>
      <div className="seg" title="Tempo symulacji (klawisze 1–5)">
        {SPEEDS.map((s) => (
          <button key={s.label} className={client.speedLabel === s.label ? 'on' : ''} onClick={() => client.setSpeed(s.tps, s.label)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="readout">
        <span>tick</span>
        <b>{fmt.int(info?.tick ?? 0)}</b>
      </div>
      <div className="readout">
        <span>pop.</span>
        <b>{fmt.int(info?.pop ?? 0)}</b>
      </div>
      <div className="readout dim">
        <span>t/s</span>
        <b>{fmt.int(info?.measuredTps ?? 0)}</b>
      </div>
      {info && info.activeEvents.length > 0 && (
        <div className="readout warn">
          <span>zdarzenia</span>
          <b>{info.activeEvents.map((a) => a.spec.kind).join(', ')}</b>
        </div>
      )}
      {extinct && <div className="readout bad"><b>WYMARCIE</b></div>}
    </div>
  );
}

export function App() {
  const m = useManager();
  const active = m.active;
  const [left, setLeft] = useState<LeftTab>('env');
  const [right, setRight] = useState<RightTab>('stats');
  const wide = typeof window !== 'undefined' && window.innerWidth >= 1180;
  const [leftOpen, setLeftOpen] = useState(wide);
  const [rightOpen, setRightOpen] = useState(wide);
  const [resume, setResume] = useState<SaveMeta | null>(null);

  useEffect(() => {
    if (booted) return;
    booted = true;
    manager.create({}, {});
    void listSaves().then((all) => {
      const auto = all.find((s) => s.kind === 'auto' && s.engine === ENGINE_VERSION);
      if (auto) setResume(auto);
    });
  }, []);

  // zaznaczenie organizmu przełącza prawy panel na inspektor
  const sel = active?.selectedId ?? null;
  useEffect(() => {
    if (sel !== null && right === 'stats') setRight('org');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      const a = manager.active;
      if (!a) return;
      if (e.code === 'Space') {
        e.preventDefault();
        a.play(!(a.info?.playing ?? false));
      } else if (e.key === '.') a.step(1);
      else if (e.key >= '1' && e.key <= '5') {
        const s = SPEEDS[Number(e.key) - 1];
        a.setSpeed(s.tps, s.label);
      } else if (e.key === 'Escape') a.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const lt = (id: LeftTab, label: string) => (
    <button className={left === id ? 'on' : ''} onClick={() => setLeft(id)}>
      {label}
    </button>
  );
  const rt = (id: RightTab, label: string) => (
    <button className={right === id ? 'on' : ''} onClick={() => setRight(id)}>
      {label}
    </button>
  );

  return (
    <div className={`app ${leftOpen ? 'lo' : ''} ${rightOpen ? 'ro' : ''}`}>
      <header className="topbar">
        <button className="icon-btn" onClick={() => setLeftOpen(!leftOpen)} title="Panel sterowania">
          ☰
        </button>
        <Brand />
        <nav className="world-tabs">
          {m.worlds.map((w) => (
            <button key={w.id} className={w.id === m.activeId ? 'on' : ''} onClick={() => manager.setActive(w.id)}>
              <i className={`dot ${w.info?.status === 'extinct' ? 'bad' : w.info?.playing ? 'live' : ''}`} />
              {w.name}
              <small>{fmt.int(w.info?.tick ?? 0)}</small>
            </button>
          ))}
          <button
            className="add"
            title="Nowy świat"
            onClick={() => {
              setLeftOpen(true);
              setLeft('exp');
            }}
          >
            +
          </button>
        </nav>
        <button className="icon-btn" onClick={() => setRightOpen(!rightOpen)} title="Panel analityczny">
          ◧
        </button>
      </header>

      <aside className="side left">
        <div className="tabs">
          {lt('env', 'Środowisko')}
          {lt('exp', 'Eksperyment')}
          {lt('saves', 'Zapisy')}
        </div>
        {active && left === 'env' && <Controls client={active} />}
        {active && left === 'exp' && <ExperimentPanel client={active} />}
        {active && left === 'saves' && <SavesPanel client={active} />}
      </aside>

      <main className="center">
        {active && <Toolbar client={active} />}
        <div className="stage">
          {m.worlds.map((w) => (
            <div key={w.id} className="stage-item" style={{ display: w.id === m.activeId ? 'block' : 'none' }}>
              <WorldView client={w} />
            </div>
          ))}
          {resume && (
            <div className="resume">
              <span>
                Znaleziono autozapis: <b>{resume.worldName}</b> · tick {fmt.int(resume.tick)} · {fmt.int(resume.pop)} org.
              </span>
              <button
                className="btn sm primary"
                onClick={async () => {
                  const b = await getSaveBytes(resume.id);
                  if (b) await manager.createFromBytes(b.slice(), `${resume.worldName} (wznowiony)`);
                  setResume(null);
                }}
              >
                Wznów
              </button>
              <button className="btn sm" onClick={() => setResume(null)}>
                ✕
              </button>
            </div>
          )}
        </div>
        {active?.error && <div className="error-bar">Błąd silnika: {active.error.split('\n')[0]}</div>}
      </main>

      <aside className="side right">
        <div className="tabs">
          {rt('stats', 'Statystyki')}
          {rt('org', 'Organizm')}
          {rt('gen', 'Genealogia')}
          {rt('cmp', 'Porównanie')}
          {rt('log', 'Dziennik')}
        </div>
        {active && right === 'stats' && <StatsPanel client={active} />}
        {active && right === 'org' && <Inspector client={active} goGenealogy={() => setRight('gen')} />}
        {active && right === 'gen' && <Genealogy client={active} />}
        {right === 'cmp' && <ComparePanel />}
        {active && right === 'log' && <LogPanel client={active} />}
      </aside>

      <div className="toasts">
        {m.toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
