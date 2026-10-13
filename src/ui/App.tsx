import { useEffect, useState } from 'react';
import type { WorldParams, WorldSetup } from '../engine/config';
import { ENGINE_VERSION } from '../engine/constants';
import { getSaveBytes, listSaves, type SaveMeta } from '../storage/db';
import { manager, type WorldClient } from './client';
import { fmt, useManager } from './hooks';
import { HelpPopover, Help } from './help/Help';
import { uiBus } from './help/store';
import type { Lesson } from './help/types';
import { Welcome, shouldShowWelcome } from './help/Welcome';
import { LearnPanel, type LearnTab } from './panels/Learn';
import { WorldView } from './WorldView';
import { Controls } from './panels/Controls';
import { ComparePanel } from './panels/Compare';
import { ExperimentPanel, SavesPanel } from './panels/Experiment';
import { Genealogy } from './panels/Genealogy';
import { Inspector } from './panels/Inspector';
import { LogPanel } from './panels/Log';
import { HistoryPanel } from './panels/HistoryPanel';
import { AtlasPanel } from './panels/AtlasPanel';
import { LabPanel } from './panels/LabPanel';
import { StatsPanel } from './panels/Stats';
import { ModulePanel } from './panels/ModulePanel';
import { BiomesPanel } from './panels/BiomesPanel';
import { PresentationPanel, readPresentation, type Presentation, type ToolTab } from './panels/PresentationPanel';
import type { GuidedSession } from './panels/GuidedLesson';

type LeftTab = 'modules' | 'env' | 'view' | 'exp' | 'saves';
type RightTab = ToolTab;

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
  const preview = client.history?.preview ?? false;
  return (
    <div className="toolbar">
      <button className={`btn play ${playing ? 'on' : ''}`} disabled={extinct || preview} onClick={() => client.play(!playing)} title="Start / pauza (spacja)">
        {playing ? '❚❚ Pauza' : '▶ Start'}
      </button>
      <Help id="play" className="tb-help" />
      <button className="btn" disabled={extinct || preview} onClick={() => client.step(1)} title="Jeden tick (.)">
        ⏭ Krok
      </button>
      <button className="btn" disabled={extinct || preview} onClick={() => client.step(100)} title="100 ticków">
        +100
      </button>
      <div className="seg" title="Tempo symulacji (klawisze 1–5)">
        {SPEEDS.map((s) => (
          <button key={s.label} disabled={preview} className={client.speedLabel === s.label ? 'on' : ''} onClick={() => client.setSpeed(s.tps, s.label)}>
            {s.label}
          </button>
        ))}
      </div>
      <Help id="speed" className="tb-help" />
      <div className="readout">
        <span>tick</span>
        <b>{fmt.int(info?.tick ?? 0)}</b>
        <Help id="tick" />
      </div>
      <div className="readout">
        <span>pop.</span>
        <b>{fmt.int(info?.pop ?? 0)}</b>
        <Help id="kpi.pop" />
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
      {preview && <div className="readout warn"><b>PODGLĄD HISTORII</b><button className="btn sm" onClick={() => void client.historyLive()}>Wróć do teraz</button></div>}
      {extinct && <div className="readout bad"><b>WYMARCIE</b></div>}
    </div>
  );
}

export function App() {
  const m = useManager();
  const active = m.active;
  const [left, setLeft] = useState<LeftTab>('modules');
  const [right, setRight] = useState<RightTab>('stats');
  const wide = typeof window !== 'undefined' && window.innerWidth >= 1180;
  const [leftOpen, setLeftOpen] = useState(wide);
  const [rightOpen, setRightOpen] = useState(wide);
  const [resume, setResume] = useState<SaveMeta | null>(null);
  const [welcome, setWelcome] = useState(() => shouldShowWelcome());
  const [learnTab, setLearnTab] = useState<LearnTab>('start');
  const [glossaryFocus, setGlossaryFocus] = useState<string | null>(null);
  const [lessonFocus, setLessonFocus] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<Presentation>(readPresentation);
  const [guided, setGuided] = useState<GuidedSession | null>(null);
  const showTool = (tab: RightTab) => setPresentation(value => value.tabs.includes(tab) ? value : { ...value, tabs: [...value.tabs, tab] });
  useEffect(() => { try { localStorage.setItem('genesis-presentation-v1', JSON.stringify(presentation)); } catch { /* optional preferences */ } if (!presentation.tabs.includes(right)) setRight('stats'); }, [presentation, right]);

  const runLesson = (l: Lesson, seed = 1) => {
    const a = l.action;
    let last: ReturnType<typeof manager.create> | null = null;
    const ids: string[] = [];
    for (const w of a.worlds) {
      last = manager.create({ ...(w.setup ?? {}) as Partial<WorldSetup>, ...(l.guided ? { seed } : {}) }, (w.params ?? {}) as Partial<WorldParams>, w.name);
      ids.push(last.id);
      if (a.speed) last.setSpeed(a.speed.tps, a.speed.label);
    }
    if (l.guided) { setGuided({lesson:l, ids:ids as [string,string], seed}); setRightOpen(true); setRight('learn'); setLearnTab('lessons'); setLessonFocus(l.id); }
    if (a.openLeft) {
      setLeftOpen(true);
      setLeft(a.openLeft);
    }
    if (a.openTab) {
      showTool(a.openTab);
      setRightOpen(true);
      setRight(a.openTab);
    }
    void last;
  };

  useEffect(() => {
    uiBus.set((r) => {
      if (r.type === 'glossary') {
        setRightOpen(true);
        setRight('learn');
        setLearnTab('glossary');
        setGlossaryFocus(r.id ?? null);
      } else if (r.type === 'learn') {
        setRightOpen(true);
        setRight('learn');
        setLearnTab(r.tab);
        if (r.lessonId) setLessonFocus(r.lessonId);
      } else if (r.type === 'tab') {
        if (r.side === 'right') {
          showTool(r.tab as RightTab);
          setRightOpen(true);
          setRight(r.tab as RightTab);
        } else {
          setLeftOpen(true);
          setLeft(r.tab as LeftTab);
        }
      } else if (r.type === 'welcome') setWelcome(true);
    });
    return () => uiBus.set(null);
  }, []);

  useEffect(() => {
    if (booted || manager.worlds.length > 0) return;
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
      if (a.history?.preview && (e.code === 'Space' || e.key === '.' || (e.key >= '1' && e.key <= '5'))) { e.preventDefault(); return; }
      if (e.code === 'Space') {
        e.preventDefault();
        a.play(!(a.info?.playing ?? false));
      } else if (e.key === '.') a.step(1);
      else if (e.key >= '1' && e.key <= '5') {
        const s = SPEEDS[Number(e.key) - 1];
        a.setSpeed(s.tps, s.label);
      } else if (e.key === 'Escape') a.select(null);
      else if (e.key === '?') uiBus.send({ type: 'learn', tab: 'start' });
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
        <button className="learn-btn" onClick={() => uiBus.send({ type: 'learn', tab: 'start' })} title="Nauka: przewodnik, lekcje, słownik (klawisz ?)">
          <span>?</span> Nauka
        </button>
        <button className="icon-btn" onClick={() => setRightOpen(!rightOpen)} title="Panel analityczny">
          ◧
        </button>
      </header>

      <aside className="side left">
        <div className="tabs">
          {lt('modules', 'Moduły')}
          {lt('env', 'Środowisko')}
          {lt('view', 'Widok')}
          {lt('exp', 'Eksperyment')}
          {lt('saves', 'Zapisy')}
        </div>
        {active && left === 'modules' && <ModulePanel client={active} />}
        {left === 'view' && <PresentationPanel value={presentation} onChange={setPresentation} />}
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
          {presentation.tabs.includes('history') && rt('history', 'Historia')}
          {presentation.tabs.includes('atlas') && rt('atlas', 'Atlas')}
          {presentation.tabs.includes('lab') && rt('lab', 'Laboratorium')}
          {rt('stats', 'Statystyki')}
          {rt('org', 'Organizm')}
          {presentation.tabs.includes('biomes') && rt('biomes', 'Biomy')}
          {presentation.tabs.includes('gen') && rt('gen', 'Genealogia')}
          {presentation.tabs.includes('cmp') && rt('cmp', 'Porównanie')}
          {presentation.tabs.includes('log') && rt('log', 'Dziennik')}
          {rt('learn', 'Nauka')}
        </div>
        {active && right === 'biomes' && <BiomesPanel client={active} />}
        {active && right === 'history' && <HistoryPanel client={active} />}
        {active && right === 'atlas' && <AtlasPanel client={active} />}
        {active && right === 'lab' && <LabPanel client={active} />}
        {active && right === 'stats' && <StatsPanel client={active} />}
        {active && right === 'org' && <Inspector client={active} goGenealogy={() => { showTool('gen'); setRight('gen'); }} goAtlas={() => { showTool('atlas'); setRight('atlas'); }} goLab={() => { showTool('lab'); setRight('lab'); }} />}
        {active && right === 'gen' && <Genealogy client={active} />}
        {right === 'cmp' && <ComparePanel />}
        {active && right === 'log' && <LogPanel client={active} />}
        {right === 'learn' && <LearnPanel tab={learnTab} onTab={setLearnTab} focus={glossaryFocus} lessonFocus={lessonFocus} onRunLesson={runLesson} guided={guided} />}
      </aside>

      <HelpPopover />
      {welcome && (
        <Welcome
          onClose={() => setWelcome(false)}
          onLessons={() => {
            setRightOpen(true);
            setRight('learn');
            setLearnTab('lessons');
          }}
        />
      )}
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
