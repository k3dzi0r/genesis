import { useEffect, useRef, useState } from 'react';
import type { BehaviorAtlas, SpeciesAnalysis, Specimen } from '../../engine/behavior';
import { deleteSpecimen, listSpecimens, putSpecimen, specimenFromJson, specimenToJson, type AtlasRecord } from '../../storage/atlas';
import { downloadBytes } from '../../storage/db';
import type { WorldClient } from '../client';
import { useInterval } from '../hooks';

export function SpecimenReplay({ specimen }: { specimen: Specimen }) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setFrame(0); setPlaying(false); }, [specimen]);
  useInterval(() => setFrame((i) => { if (i >= specimen.trace.length - 1) { setPlaying(false); return i; } return i + 1; }), 150, playing, specimen.organismId);
  const point = specimen.trace[frame];
  return <div>
    <svg viewBox={`0 0 ${specimen.setup.width} ${specimen.setup.height}`} style={{ width: '100%', height: 180, background: 'var(--panel2)' }} aria-label="Zachowana trajektoria organizmu">
      <polyline points={specimen.trace.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={3} />
      {point && <circle cx={point.x} cy={point.y} r={8} fill="#ffd54f" />}
    </svg>
    {point ? <><input aria-label="Klatka trajektorii" type="range" min={0} max={specimen.trace.length - 1} value={frame} onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} /><button className="btn" onClick={() => { if (frame >= specimen.trace.length - 1) setFrame(0); setPlaying(!playing); }}>{playing ? 'Pauza' : 'Odtwórz trajektorię'}</button><p className="note">Tick {point.tick} · energia {point.energy.toFixed(1)} · {specimen.trace.length} próbek. To ograniczona trajektoria; tło historycznego świata nie jest częścią okazu.</p></> : <p className="note">Brak zapisanej trajektorii.</p>}
  </div>;
}

export function AtlasPanel({ client }: { client: WorldClient }) {
  const [atlas, setAtlas] = useState<BehaviorAtlas | null>(null), [species, setSpecies] = useState<SpeciesAnalysis | null>(null);
  const [records, setRecords] = useState<AtlasRecord[]>([]), [selected, setSelected] = useState<string>(''), [error, setError] = useState('');
  const [history, setHistory] = useState<{ tick: number; groups: number; flow: number | null }[]>([]);
  const epoch = useRef(0);
  const reload = async () => { const token = epoch.current; const rows = await listSpecimens(); if (epoch.current === token) setRecords(rows); };
  useEffect(() => { epoch.current++; void reload().catch((e) => setError(String(e))); setHistory([]); setAtlas(null); setSpecies(null); return () => { epoch.current++; }; }, [client.id, client.worldEpoch, client.historyEpoch]);
  useInterval(async () => {
    const token = epoch.current;
    try {
      const res = await client.atlas(); if (epoch.current !== token) return; setAtlas(res.atlas); setSpecies(res.species);
      setHistory((h) => h.length && h[h.length - 1].tick >= res.atlas.tick ? h : [...h, { tick: res.atlas.tick, groups: res.species.candidateGroups.length, flow: res.species.geneFlow }].slice(-60));
    } catch (e) { if (epoch.current === token) setError(String(e)); }
  }, 3000, true, `${client.id}:${client.worldEpoch}:${client.historyEpoch}`);
  const save = async () => { const token = epoch.current; try { if (client.selectedId === null) throw new Error('Najpierw zaznacz żywy organizm.'); const r = await client.captureSpecimen(client.selectedId); const id = await putSpecimen(r.specimen); if (epoch.current !== token) return; await reload(); setSelected(id); setError(''); } catch (e) { if (epoch.current === token) setError(String(e)); } };
  const specimen = records.find((r) => r.id === selected)?.specimen;
  return <div className="panel-body">
    {error && <p className="error-bar">{error}</p>}
    <section className="card"><header><h4>Atlas obserwowanych zachowań</h4><span className="hint">tick {atlas?.tick ?? '…'}</span></header>
      <p className="note">Grupy wynikają z rzeczywistego ruchu, żerowania, polowań i powrotów. Reguły opisowe nie dowodzą intencji ani inteligencji.</p>
      {atlas?.groups.map((g) => <div key={g.label} className="strategy"><b>{g.label} · {g.count}</b><p className="note">Obserwacja {g.mean.observedTicks.toFixed(0)} ticków · droga {g.mean.distance.toFixed(0)} · energia pokarmu {g.mean.foodEnergy.toFixed(1)} · skuteczne ataki {g.mean.successfulAttacks.toFixed(1)}</p><button className="btn" onClick={() => client.select(g.ids[0])}>Zaznacz przykład</button></div>)}
      <p className="note">Za mało danych: {atlas?.insufficient ?? 0} osobników (poniżej 30 ticków).</p>
    </section>
    <section className="card"><h4>Izolacja rozrodcza</h4>
      {species && <><p>Grupy zgodności: {species.candidateGroups.length} w próbce {species.sampledOrganisms} organizmów.</p><p className="note">Połączone składowe wzajemnej akceptacji partnerów. Próba obejmuje najwyżej 64 osobniki; grupy kandydatów nie oznaczają potwierdzonych gatunków.</p>
        {species.candidateGroups.slice(0, 12).map((g) => <p key={g.label}>{g.label}: {g.count} próbkowanych · dieta {g.centroid.diet.toFixed(2)} · preferencja {g.centroid.matePreference?.toFixed(2)}</p>)}
        <p>Odrzucone próby: {species.mateRejections}/{species.matingAttempts} · krzyżowania między profilami pokarmu A/B: {species.betweenMatings}/{species.withinMatings + species.betweenMatings}</p><p className="note">Przepływ A/B: {species.geneFlow === null ? 'brak obserwowanych krzyżowań lub wyłączony rozród płciowy' : `${(species.geneFlow * 100).toFixed(1)}%`}. Te liczniki dotyczą profili pokarmu; nie są automatycznie przepływem między gatunkami.</p></>}
      {history.length > 1 && <><p className="note">Kolejne obserwacje w tej sesji (ograniczone do 60; grupy nie mają trwałej tożsamości):</p><div style={{ maxHeight: 140, overflow: 'auto' }}><table><thead><tr><th>Tick</th><th>Grupy</th><th>Przepływ A/B</th></tr></thead><tbody>{history.map((h) => <tr key={h.tick}><td>{h.tick}</td><td>{h.groups}</td><td>{h.flow === null ? '—' : `${(h.flow * 100).toFixed(1)}%`}</td></tr>)}</tbody></table></div></>}
    </section>
    <section className="card"><h4>Zachowane okazy</h4><button className="btn" onClick={() => void save()}>Zachowaj zaznaczony organizm</button>
      <label className="btn">Import okazu<input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => { const token = epoch.current; const f = e.target.files?.[0]; if (f) void f.text().then(specimenFromJson).then((s) => putSpecimen(s)).then(async (id) => { if (epoch.current !== token) return; await reload(); setSelected(id); }).catch((e) => setError(String(e))); }} /></label>
      <select aria-label="Zachowany okaz" value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Wybierz okaz</option>{records.map((r) => <option key={r.id} value={r.id}>{r.specimen.name} · seed {r.specimen.sourceSeed} · tick {r.specimen.sourceTick}</option>)}</select>
      {specimen && <><SpecimenReplay specimen={specimen} /><p>Genom, nauczone wagi, ślady uczenia i pamięć zachowane · źródło {specimen.engineVersion} · prób: {specimen.outcomes.length}.</p><p className="note">Przejścia między biomami: {specimen.behavior.biomeTransitions ?? 0}. Dla okazów 0.4 biomów nie rejestrowano.</p><button className="btn" onClick={() => downloadBytes(`genesis-okaz-${specimen.organismId}.json`, specimenToJson(specimen), 'application/json')}>Eksport okazu</button><button className="btn" onClick={() => void deleteSpecimen(selected).then(reload).then(() => setSelected('')).catch((e) => setError(String(e)))}>Usuń okaz</button>{specimen.outcomes.map((r, i) => <p className="note" key={i}>Próba {i + 1}: {r.mode} · {r.state} · silnik {r.engineVersion} · {r.runs.length} przebiegów</p>)}</>}
    </section>
  </div>;
}
