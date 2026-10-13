import { useEffect, useState } from 'react';
import { manager, type WorldClient } from '../client';
import { fmt, useManager } from '../hooks';
import { evaluateGuided, type GuidedWorldState } from '../help/guided';
import type { Lesson } from '../help/types';

export interface GuidedSession { lesson: Lesson; ids: [string,string]; seed: number }
const notes = new WeakMap<GuidedSession,{assessment:string;reason:string;saved:boolean}>();
function state(client: WorldClient, lesson: Lesson): GuidedWorldState {
  return { ready: client.ready, tick: client.info?.tick ?? 0, extinct: client.info?.status === 'extinct', preview: !!client.history?.preview, worldEpoch: client.worldEpoch,
    params: client.info?.params ?? null, setup: client.setup, intervened: !!client.info?.paramHistory.length || !!client.history?.events.some(e => e.kind === 'event' || e.kind === 'param'),
    ticks: Array.from(client.stats.column('tick')), interval:client.stats.interval, values: Object.fromEntries(lesson.guided!.metrics.map(m => [m.key, Array.from(client.stats.column(m.key))])) };
}
export function GuidedLesson({ session, repeat }: { session: GuidedSession; repeat: () => void }) {
  useManager();
  const [assessment, setAssessment] = useState(()=>notes.get(session)?.assessment??'');
  const [reason, setReason] = useState(()=>notes.get(session)?.reason??'');
  const [saved, setSaved] = useState(()=>notes.get(session)?.saved??false);
  useEffect(()=>{notes.set(session,{assessment,reason,saved});},[session,assessment,reason,saved]);
  const worlds = session.ids.map(id => manager.worlds.find(w => w.id === id));
  const def = session.lesson.guided!;
  if (!worlds[0] || !worlds[1]) return <section className="card"><p className="note warn">Usunięto świat próby. Uruchom nową parę.</p><button className="btn" onClick={repeat}>Nowa para</button></section>;
  const [a,b] = worlds as [WorldClient,WorldClient];
  const result = evaluateGuided(session.lesson, state(a,session.lesson), state(b,session.lesson), session.seed);
  return <section className="card guided-live">
    <header><h4>Prowadzona próba · seed {session.seed}</h4></header>
    <p className="prose"><b>Hipoteza:</b> {def.hypothesis}</p>
    <p className="note"><b>Kontrola:</b> {def.control}</p>
    <p className="note"><b>Interwencja:</b> {def.intervention} = {def.controlValue} → {def.treatmentValue}.</p>
    <div className="btn-grid"><button className="btn sm" onClick={() => manager.setActive(a.id)}>Kontrola · {fmt.int(a.info?.tick ?? 0)}</button><button className="btn sm" onClick={() => manager.setActive(b.id)}>Wariant · {fmt.int(b.info?.tick ?? 0)}</button></div>
    <progress max={1} value={result.progress} aria-label="Postęp obserwacji" />
    <p className={`note ${result.stage === 'invalid' || result.stage === 'preview' ? 'warn' : ''}`} role="status">{result.message}</p>
    <p className="note">Wspólny pomiar: tick {fmt.int(result.tick)} / {fmt.int(def.targetTick)}. A = kontrola, B = wariant. B − A to różnica tej pary, bez oszacowania niepewności między seedami.</p>
    {result.metrics.map(m => <div className="guided-metric" key={m.label}><b>{m.label}</b><div className="kv"><span>A / B</span><b>{fmt.f3(m.a)} / {fmt.f3(m.b)}</b><span>B − A</span><b>{fmt.f3(m.delta)}</b></div><p className="note">{m.interpretation}</p></div>)}
    <div className="btn-grid"><button className="btn sm" disabled={!!a.history?.preview || !!b.history?.preview} onClick={() => { a.play(false); b.play(false); }}>Wstrzymaj oba</button><button className="btn sm" disabled={!!a.history?.preview || !!b.history?.preview || result.extinct} onClick={() => { a.play(true); b.play(true); }}>Kontynuuj oba</button></div>
    <h5>Interpretacja pomiaru</h5><ol className="steps">{def.questions.map(q => <li key={q}>{q}</li>)}</ol>
    <label className="field">Ocena tej pary<select value={assessment} onChange={e => { setAssessment(e.target.value); setSaved(false); }}><option value="">Wybierz po pomiarze…</option><option value="different">Widzę różnicę; mechanizm wymaga dalszej kontroli</option><option value="zero">Nie widzę wyraźnej różnicy</option><option value="insufficient">Dane nie wystarczają do oceny</option></select></label>
    <label className="field">Który pomiar wspiera ocenę?<textarea value={reason} maxLength={2000} onChange={e => { setReason(e.target.value); setSaved(false); }} placeholder="Wskaż miernik i ograniczenie interpretacji." /></label>
    <button className="btn primary" disabled={result.stage !== 'review' || !assessment || reason.trim().length < 10} onClick={() => setSaved(true)}>Zapisz interpretację w tej sesji</button>
    {saved && result.stage === 'review' && <p className="note">Interpretacja zapisana w sesji. Lekcja nie uznaje jej za dowód hipotezy. Powtórz próbę na innym seedzie; wcześniejsze światy i ich pomiary pozostają dostępne.</p>}
    <button className="btn" onClick={repeat}>Powtórz · seed {(session.seed + 1) >>> 0}</button>
  </section>;
}
