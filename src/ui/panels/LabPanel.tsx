import { useEffect, useRef, useState } from 'react';
import { GENOME_LEN, N_TRAITS } from '../../engine/constants';
import type { Specimen } from '../../engine/behavior';
import type { LabEnvironment, LabRequest, LabResult } from '../../engine/lab';
import { listSpecimens, putSpecimen, type AtlasRecord } from '../../storage/atlas';
import { downloadBytes } from '../../storage/db';
import type { WorldClient } from '../client';

export function LabPanel({ client }: { client: WorldClient }) {
  const [records, setRecords] = useState<AtlasRecord[]>([]), [aId, setAId] = useState(''), [bId, setBId] = useState('');
  const [live, setLive] = useState<Specimen | null>(null), [ancestor, setAncestor] = useState<Specimen | null>(null);
  const [mode, setMode] = useState<LabRequest['mode']>('commonGarden'), [configured, setConfigured] = useState(false), [oldTick, setOldTick] = useState(0);
  const [seeds, setSeeds] = useState(3), [ticks, setTicks] = useState(400), [gene, setGene] = useState(0), [value, setValue] = useState(0.5), [somatic, setSomatic] = useState(false);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState(''), [result, setResult] = useState<LabResult | null>(null);
  const epoch = useRef(0);
  const runningClient = useRef<WorldClient | null>(null);
  const reload = async () => { const token = epoch.current; const rows = await listSpecimens(); if (epoch.current === token) setRecords(rows); };
  useEffect(() => { epoch.current++; void reload().catch((e) => setError(String(e))); setLive(null); setAncestor(null); setResult(null); setBusy(false); setProgress(''); return () => { epoch.current++; runningClient.current?.cancelLab(); runningClient.current = null; }; }, [client.id]);
  const capture = async () => {
    const token = epoch.current;
    try {
      if (client.selectedId === null) throw new Error('Zaznacz żywy organizm.');
      const { specimen } = await client.captureSpecimen(client.selectedId); if (epoch.current !== token) return; setLive(specimen); setBId('live'); setAncestor(null);
      if (specimen.parentId !== null) {
        const pair = await client.compare(specimen.parentId, specimen.organismId);
        if (epoch.current !== token) return;
        if (pair.genomeA && pair.a && pair.generationsBetween !== null) {
          const savedAncestor = await client.captureSpecimen(pair.a.id, true);
          if (epoch.current !== token) return;
          setAncestor(savedAncestor.specimen);
          setAId('ancestor'); setOldTick(pair.a.birthTick);
        }
      }
      setError('');
    } catch (e) { if (epoch.current === token) setError(String(e)); }
  };
  const a = aId === 'ancestor' ? ancestor : aId === 'live' ? live : records.find((r) => r.id === aId)?.specimen;
  const b = bId === 'ancestor' ? ancestor : bId === 'live' ? live : records.find((r) => r.id === bId)?.specimen;
  const start = async () => {
    const token = epoch.current; const valid = () => epoch.current === token;
    runningClient.current = client;
    setBusy(true); setError(''); setResult(null);
    try {
      const selected = mode === 'commonGarden' ? a : b ?? a;
      if (!selected || (mode === 'commonGarden' && !b)) throw new Error('Wybierz wymagane genotypy.');
      if (somatic && aId === 'ancestor' && mode === 'commonGarden') throw new Error('Stan nauczony przodka nie został zachowany. Użyj próby genetycznej lub dwóch zachowanych okazów.');
      let environments: LabEnvironment[] = [];
      if (mode !== 'memory') {
        if (configured) {
          const current = { label: 'Obecne parametry · nowa mapa', kind: 'configured' as const, setup: client.setup ?? selected.setup, params: client.info?.params ?? selected.params };
          environments = mode === 'commonGarden' ? [{ label: `Parametry kontekstu A · tick ${selected.environmentTick} · nowa mapa`, kind: 'configured', setup: selected.setup, params: selected.params }, current] : [current];
        } else {
          setProgress('Pobieranie pełnego środowiska…');
          const now = client.info?.tick ?? selected.sourceTick;
          const current = { label: `Zapis środowiska · tick ${now}`, kind: 'saved' as const, bytes: await client.historicalWorldBytes(now) };
          environments = mode === 'commonGarden' ? [{ label: `Dawne środowisko · tick ${oldTick}`, kind: 'saved', bytes: await client.historicalWorldBytes(oldTick) }, current] : [current];
        }
      }
      if (!valid()) return;
      const response = await client.lab({ mode, specimenA: selected, ...(mode === 'commonGarden' && b ? { specimenB: b } : {}), environments, seeds: Array.from({ length: seeds }, (_, i) => i + 1), ticks, gene, value, somatic }, (done, total) => { if (valid()) setProgress(`${done.toFixed(1)} / ${total} przebiegów`); });
      if (!valid()) return;
      setResult(response.result);
      const tested = mode === 'commonGarden' ? b! : selected;
      const record = records.find((r) => r.specimen === tested);
      const saved = { ...tested, outcomes: [...tested.outcomes, response.result].slice(-100) };
      await putSpecimen(saved, record?.id);
      if (!valid()) return;
      if (tested === live) setLive(saved);
      if (tested === ancestor) setAncestor(saved);
      await reload();
    } catch (e) { if (valid()) setError(String(e)); } finally { if (valid()) { setBusy(false); runningClient.current = null; } }
  };
  const options = <>{ancestor && <option value="ancestor">Genom przodka #{ancestor.organismId} (bez stanu nauczonego)</option>}{live && <option value="live">Zaznaczony #{live.organismId}</option>}{records.map((r) => <option key={r.id} value={r.id}>{r.specimen.name} · tick {r.specimen.sourceTick}</option>)}</>;
  return <div className="panel-body"><section className="card"><h4>Laboratorium organizmów</h4><p className="note">Próby na prywatnych kopiach świata. Genotypy A/B × dwa środowiska dają cztery porównywalne komórki. Najbliższy zachowany przodek może być starszy niż bezpośredni rodzic po scaleniu genealogii.</p>
    {error && <p className="error-bar">{error}</p>}
    <button className="btn" disabled={busy} onClick={() => void capture()}>Pobierz zaznaczony organizm i genom przodka</button><button className="btn" onClick={() => void reload().catch((e) => setError(String(e)))}>Odśwież okazy</button>
    <div className="form-grid"><label className="span2">Rodzaj próby<select value={mode} onChange={(e) => setMode(e.target.value as LabRequest['mode'])}><option value="commonGarden">Genotyp A/B × dawne/obecne środowisko</option><option value="mutation">Jedna zmiana genu</option><option value="memory">Odroczona wskazówka i pamięć</option></select></label>
      {mode === 'commonGarden' && <label>Genotyp A<select value={aId} onChange={(e) => setAId(e.target.value)}><option value="">Wybierz</option>{options}</select></label>}
      <label>Genotyp {mode === 'commonGarden' ? 'B' : 'do próby'}<select value={bId} onChange={(e) => setBId(e.target.value)}><option value="">Wybierz</option>{options}</select></label>
      <label className="span2"><input type="checkbox" checked={somatic} onChange={(e) => setSomatic(e.target.checked)} /> Zachowaj nauczone wagi, ślady uczenia i pamięć. W próbie genetycznej są zerowane.</label>
      {mode !== 'memory' && <><label className="span2"><input type="checkbox" checked={configured} onChange={(e) => setConfigured(e.target.checked)} /> Nowe mapy według parametrów (zamiast pełnych zapisanych środowisk)</label>{mode === 'commonGarden' && !configured && <label className="span2">Dawny tick z dostępnej historii<input type="number" min={0} value={oldTick} onChange={(e) => setOldTick(Number(e.target.value))} /></label>}<label>Seedów<input type="number" min={2} max={40} value={seeds} onChange={(e) => setSeeds(Number(e.target.value))} /></label><label>Ticków<input type="number" min={1} max={20000} value={ticks} onChange={(e) => setTicks(Number(e.target.value))} /></label></>}
      {mode === 'mutation' && <><label>Indeks genu (0…{GENOME_LEN - 1})<input type="number" min={0} max={GENOME_LEN - 1} value={gene} onChange={(e) => setGene(Number(e.target.value))} /></label><label>Nowa wartość<input type="number" min={gene < N_TRAITS ? 0 : -6} max={gene < N_TRAITS ? 1 : 6} step={0.05} value={value} onChange={(e) => setValue(Number(e.target.value))} /></label></>}
    </div><button className="btn primary" disabled={busy} onClick={() => void start()}>Uruchom próbę</button>{busy && <><button className="btn" onClick={() => runningClient.current?.cancelLab()}>Anuluj</button><p>{progress}</p></>}
  </section>{result && <section className="card"><h4>Wyniki · {result.state === 'genetic' ? 'genotyp' : 'stan nauczony'}</h4>
    {result.intervention && <p>Gen {result.intervention.gene}: {result.intervention.from.toFixed(4)} → {result.intervention.to.toFixed(4)}</p>}
    {result.temporal.map((r) => <p key={r.delay}>Opóźnienie {r.delay}: kontrast {r.intactContrast.toFixed(4)} · bez pamięci {r.ablatedContrast.toFixed(4)}</p>)}
    {result.comparisons.map((c) => <p key={c.environment}>{c.environment}: Δ przeżycia B−A {c.survival.diff.toFixed(2)} [{c.survival.ciLo.toFixed(2)}; {c.survival.ciHi.toFixed(2)}] ticków · Δ potomstwa {c.offspring.diff.toFixed(2)}</p>)}
    {!!result.runs.length && <div style={{ overflow: 'auto' }}><table><thead><tr><th>Genotyp / środowisko</th><th>Seed</th><th>Przeżycie</th><th>Potomstwo</th><th>Energia</th><th>Droga</th></tr></thead><tbody>{result.runs.map((r, i) => <tr key={i}><td>{r.genotype}<br />{r.environment}</td><td>{r.seed}</td><td>{r.survival.toFixed(1)}</td><td>{r.offspring.toFixed(2)}</td><td>{r.energyAcquired.toFixed(1)}</td><td>{r.distance.toFixed(1)}</td></tr>)}</tbody></table></div>}
    {result.notes.map((n) => <p key={n} className="note">{n}</p>)}<button className="btn" onClick={() => downloadBytes('genesis-laboratorium.json', JSON.stringify(result, (_key, val) => val === Infinity ? 'Infinity' : val === -Infinity ? '-Infinity' : val, 2), 'application/json')}>Eksport wyników JSON</button>
  </section>}</div>;
}
