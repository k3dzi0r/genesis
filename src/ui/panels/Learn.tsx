import { useEffect, useMemo, useRef, useState } from 'react';
import { HELP, funFacts, glossaryEntries } from '../help/content';
import { Help } from '../help/Help';
import { LESSONS } from '../help/lessons';
import { uiBus } from '../help/store';
import { HELP_GROUPS, type HelpGroup, type Lesson } from '../help/types';

export type LearnTab = 'start' | 'lessons' | 'glossary';

interface Props {
  tab: LearnTab;
  onTab: (t: LearnTab) => void;
  /** wpis słownika do podświetlenia i rozwinięcia */
  focus: string | null;
  lessonFocus: string | null;
  onRunLesson: (l: Lesson) => void;
}

function Chips({ ids, onPick }: { ids: string[]; onPick: (id: string) => void }) {
  return (
    <div className="chip-row">
      {ids
        .filter((i) => HELP[i])
        .map((i) => (
          <button key={i} className="mini-chip" onClick={() => onPick(i)}>
            {HELP[i].title}
          </button>
        ))}
    </div>
  );
}

function StartTab({ onTab, openGlossary }: { onTab: (t: LearnTab) => void; openGlossary: (id: string) => void }) {
  const facts = useMemo(() => funFacts(), []);
  const [i, setI] = useState(() => Math.floor(Math.random() * facts.length));
  const [id, entry] = facts[i % facts.length];
  return (
    <div className="panel-body">
      <section className="card">
        <header>
          <h4>Czym jest GENESIS?</h4>
        </header>
        <p className="prose">
          To laboratorium <b>sztucznego życia</b>. Małe organizmy z genomami i miniaturowymi mózgami żyją w świecie, w którym energia jest ograniczona, a wszystko ma swoją cenę. Nikt ich nie steruje i nikt nie ocenia —
          przeżywają i mnożą się te, którym się uda. Nie programujemy zachowań; projektujemy <b>prawa świata</b> i patrzymy, co ewolucja z nimi zrobi.
        </p>
        <p className="prose">
          Możesz tu sprawdzić, czy drapieżniki wytrwają, czy pamięć się opłaca, jak powstaje różnorodność i dlaczego ten sam eksperyment z innym ziarnem losowości kończy się inaczej.
        </p>
      </section>

      <section className="card">
        <header>
          <h4>Co widzisz na planszy</h4>
        </header>
        <ul className="legend-list">
          <li>
            <i className="dot-demo" style={{ background: '#6aa8ff' }} /> <b>Kropka</b> = jeden organizm. Rozmiar to rozmiar ciała, jasna plamka to „nos” (kierunek ruchu).
          </li>
          <li>
            <i className="dot-demo" style={{ background: '#2a8f78', boxShadow: '0 0 10px #2a8f78' }} /> <b>Zielone tło</b> = pokarm; ciemniejsze plamy to mapa żyzności (miejsca, gdzie pokarm odrasta).
          </li>
          <li>
            <i className="dot-demo ring" /> <b>Obwódka wokół zaznaczonego</b> = zasięg jego zmysłów; po kliknięciu organizmu odezwie się panel „Organizm”.
          </li>
          <li>
            <i className="dot-demo" style={{ background: '#ff5252' }} /> W trybie koloru „Dieta” <b>czerwone</b> to drapieżniki, <b>zielone</b> — roślinożercy.
          </li>
        </ul>
        <p className="note">
          Symbol <Help id="ui.learn" /> jest wszędzie: najedź, a zobaczysz skrót; kliknij, a dymek zostanie i pokaże więcej (w tym ciekawostkę i powiązane pojęcia).
        </p>
      </section>

      <section className="card">
        <header>
          <h4>Jak to się ma do ewolucji?</h4>
          <Help id="evolution" />
        </header>
        <ol className="steps">
          <li>
            <b>Zmienność</b> — przy narodzinach geny mutują (i, jeśli włączysz, mieszają się u dwojga rodziców).
          </li>
          <li>
            <b>Dziedziczność</b> — dziecko dostaje genom rodzica, w tym wagi jego sieci neuronowej.
          </li>
          <li>
            <b>Różny sukces rozrodczy</b> — ci, którzy zdobywają energię i unikają śmierci, zostawiają więcej potomstwa.
          </li>
        </ol>
        <p className="note">Żadnego z tych elementów nie pomijamy ani nie podkręcamy — dlatego wyniki bywają zaskakujące. Zdarza się, że hipoteza się nie sprawdza; w lekcjach pokazuję takie przypadki.</p>
      </section>

      <section className="card">
        <header>
          <h4>Od czego zacząć</h4>
        </header>
        <div className="btn-grid">
          <button className="btn primary" onClick={() => onTab('lessons')}>
            Lekcje (gotowe eksperymenty)
          </button>
          <button className="btn" onClick={() => onTab('glossary')}>
            Słownik pojęć
          </button>
        </div>
        <Chips ids={['selection', 'mutation', 'fitness', 'tradeoff', 'predation', 'determinism', 'memory', 'ablation']} onPick={openGlossary} />
      </section>

      <section className="card fun-card">
        <header>
          <h4>💡 Ciekawostka</h4>
          <button className="btn sm" onClick={() => setI((x) => (x + 1 + Math.floor(Math.random() * (facts.length - 1))) % facts.length)}>
            Następna
          </button>
        </header>
        <p className="prose">{entry.fun}</p>
        <button className="link" onClick={() => openGlossary(id)}>
          {entry.title} — w słowniku →
        </button>
      </section>
    </div>
  );
}

const LEVEL_LABEL: Record<Lesson['level'], string> = { start: 'Start', średni: 'Średni', zaawansowany: 'Zaawansowany' };

function LessonCard({ l, open, toggle, onRun, openGlossary }: { l: Lesson; open: boolean; toggle: () => void; onRun: () => void; openGlossary: (id: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);
  return (
    <section ref={ref} className={`card lesson ${open ? 'open' : ''}`}>
      <header onClick={toggle} style={{ cursor: 'pointer' }}>
        <h4>
          {l.title}
          <span className={`tag lvl-${l.level}`}>{LEVEL_LABEL[l.level]}</span>
        </h4>
        <span className="hint">~{l.minutes} min {open ? '▾' : '▸'}</span>
      </header>
      <p className="prose goal">{l.goal}</p>
      {open && (
        <>
          {l.intro.map((p, k) => (
            <p key={k} className="prose">
              {p}
            </p>
          ))}
          <h5>Co zrobić</h5>
          <ol className="steps">
            {l.steps.map((s, k) => (
              <li key={k}>{s}</li>
            ))}
          </ol>
          <h5>Na co patrzeć</h5>
          <ul className="bullets">
            {l.lookFor.map((s, k) => (
              <li key={k}>{s}</li>
            ))}
          </ul>
          {l.observed && l.observed.length > 0 && (
            <div className="observed">
              <b>Co zmierzono w testach autora</b>
              <ul className="bullets">
                {l.observed.map((s, k) => (
                  <li key={k}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {l.caveat && <p className="note caveat">⚠ {l.caveat}</p>}
          <Chips ids={l.concepts} onPick={openGlossary} />
          <button className="btn primary" onClick={onRun}>
            ▶ Uruchom lekcję
          </button>
        </>
      )}
      {!open && (
        <div className="row">
          <button className="btn sm" onClick={toggle}>
            Szczegóły
          </button>
          <button className="btn sm primary" onClick={onRun}>
            ▶ Uruchom
          </button>
        </div>
      )}
    </section>
  );
}

function LessonsTab({ lessonFocus, onRunLesson, openGlossary }: { lessonFocus: string | null; onRunLesson: (l: Lesson) => void; openGlossary: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(lessonFocus ?? LESSONS[0]?.id ?? null);
  useEffect(() => {
    if (lessonFocus) setOpen(lessonFocus);
  }, [lessonFocus]);
  return (
    <div className="panel-body">
      <section className="card">
        <p className="prose">
          Każda lekcja to gotowy eksperyment: jedno kliknięcie tworzy światy i ustawia tempo. Przy każdej podaję hipotezę, na co patrzeć oraz — jeśli to zmierzyłem — <b>co faktycznie wyszło</b>, także gdy to nie to, czego
          się spodziewano. Wyniki zależą od seeda, więc potraktuj je jako punkt odniesienia, nie prawo natury.
        </p>
      </section>
      {LESSONS.map((l) => (
        <LessonCard key={l.id} l={l} open={open === l.id} toggle={() => setOpen(open === l.id ? null : l.id)} onRun={() => onRunLesson(l)} openGlossary={openGlossary} />
      ))}
    </div>
  );
}

function GlossaryTab({ focus, openGlossary }: { focus: string | null; openGlossary: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<HelpGroup | 'all'>('all');
  const [open, setOpen] = useState<string | null>(focus);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const all = useMemo(() => glossaryEntries(), []);
  const norm = (s: string) => s.toLocaleLowerCase('pl');
  const list = all.filter(([id, e]) => {
    if (group !== 'all' && e.group !== group) return false;
    if (!q.trim()) return true;
    const hay = norm([e.title, e.short, ...(e.more ?? []), e.fun ?? '', id].join(' '));
    return q
      .split(/\s+/)
      .filter(Boolean)
      .every((w) => hay.includes(norm(w)));
  });

  useEffect(() => {
    if (!focus) return;
    setQ('');
    setGroup('all');
    setOpen(focus);
    const t = setTimeout(() => refs.current[focus]?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
    return () => clearTimeout(t);
  }, [focus]);

  return (
    <div className="panel-body">
      <div className="glossary-bar">
        <input type="search" placeholder="Szukaj pojęcia (np. dryf, drapieżnik, p-value)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={group} onChange={(e) => setGroup(e.target.value as HelpGroup | 'all')}>
          <option value="all">Wszystkie działy</option>
          {HELP_GROUPS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
      <p className="note">
        {list.length} {list.length === 1 ? 'hasło' : 'haseł'}. Kliknij hasło, by je rozwinąć.
      </p>
      {list.map(([id, e]) => {
        const isOpen = open === id;
        return (
          <section key={id} ref={(el) => void (refs.current[id] = el)} className={`card gl-entry ${isOpen ? 'open' : ''}`}>
            <header onClick={() => setOpen(isOpen ? null : id)} style={{ cursor: 'pointer' }}>
              <h4>{e.title}</h4>
              <span className="hint">
                {e.group} {isOpen ? '▾' : '▸'}
              </span>
            </header>
            <p className="prose">{e.short}</p>
            {isOpen && (
              <>
                {e.more?.map((p, k) => (
                  <p key={k} className="prose more">
                    {p}
                  </p>
                ))}
                {e.try && (
                  <p className="help-try">
                    <b>Spróbuj:</b> {e.try}
                  </p>
                )}
                {e.fun && (
                  <p className="help-fun">
                    <b>💡 Ciekawostka</b>
                    {e.fun}
                  </p>
                )}
                {e.see && <Chips ids={e.see} onPick={openGlossary} />}
              </>
            )}
          </section>
        );
      })}
      {list.length === 0 && <div className="chart-empty">Nic nie pasuje do „{q}”.</div>}
    </div>
  );
}

export function LearnPanel({ tab, onTab, focus, lessonFocus, onRunLesson }: Props) {
  const openGlossary = (id: string) => uiBus.send({ type: 'glossary', id });
  return (
    <>
      <div className="subtabs">
        {(
          [
            ['start', 'Start'],
            ['lessons', 'Lekcje'],
            ['glossary', 'Słownik'],
          ] as [LearnTab, string][]
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'start' && <StartTab onTab={onTab} openGlossary={openGlossary} />}
      {tab === 'lessons' && <LessonsTab lessonFocus={lessonFocus} onRunLesson={onRunLesson} openGlossary={openGlossary} />}
      {tab === 'glossary' && <GlossaryTab focus={focus} openGlossary={openGlossary} />}
    </>
  );
}
