import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../../engine/world';
import { eventEvidence, type EventEvidence } from '../eventEvidence';
import { LineChart, Legend } from '../charts';
import type { WorldClient } from '../client';
import { Help } from '../help/Help';
import { fmt, useManager } from '../hooks';

const KIND_TONE: Record<string, string> = {
  extinction: 'bad',
  crash: 'bad',
  boom: 'good',
  sweep: 'warn',
  event: 'warn',
  'event-end': '',
  param: 'info',
  start: 'info',
};

export function LogPanel({ client }: { client: WorldClient }) {
  useManager();
  const identity = useRef(client); identity.current = client;
  const request = useRef(0);
  const [selected, setSelected] = useState<{ event: LogEntry; evidence: EventEvidence } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { request.current++; setSelected(null); setError(null); setBusy(false); return () => { request.current++; }; }, [client, client.worldEpoch]);
  async function seek(event: LogEntry) {
    const token = ++request.current, source = client;
    setSelected({ event, evidence: eventEvidence(client.stats, event.tick) }); setError(null); setBusy(true);
    try { await client.historySeek(event.tick); }
    catch (e) { if (request.current === token && identity.current === source) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (request.current === token && identity.current === source) setBusy(false); }
  }
  const info = client.info;
  if (!info) return null;
  const log = [...info.eventLog].reverse();
  return (
    <div className="panel-body">
      {selected && <section className="card">
        <header><h4>Zdarzenie @ {fmt.int(selected.event.tick)}</h4></header>
        <p>{selected.event.text}</p>
        {error && <p className="bad">{error}</p>}
        <p className="hint">Świat pokazuje dokładny stan ticku po zapisanych poleceniach. Poniższy kontekst skopiowano z widoku przed cofnięciem (statystyki do ticku {fmt.int(selected.evidence.sampledThrough)}).</p>
        {selected.evidence.ticks.length > 1 && <><LineChart x={selected.evidence.ticks} ys={[selected.evidence.pop, selected.evidence.food]} series={[{ label: 'Populacja', color: '#5acb9a' }, { label: 'Zasoby energii', color: '#e2ba64', scale: 'y2' }]} epoch={selected.event.tick} /><Legend items={[{ label: 'Populacja (lewa oś)', color: '#5acb9a' }, { label: 'Zasoby (prawa oś)', color: '#e2ba64' }]} /></>}
        <table className="mini"><tbody><tr><th>Próbka</th><th>Tick</th><th>Populacja</th><th>Zasoby</th></tr>
          {[['Przed', selected.evidence.before], ['Na / po', selected.evidence.after]].map(([label, value]) => { const row = value as EventEvidence['before']; return <tr key={String(label)}><td>{String(label)}</td><td>{row ? fmt.int(row.tick) : 'brak'}</td><td>{row ? row.pop.toFixed(1) : '—'}</td><td>{row ? row.food.toFixed(1) : '—'}</td></tr>; })}
        </tbody></table>
        {selected.evidence.interval ? <><p className="hint">Liczniki dla całego przedziału ({fmt.int(selected.evidence.interval.from)}, {fmt.int(selected.evidence.interval.to)}], obejmującego tick zdarzenia:</p><table className="mini"><tbody>
          {Object.entries(selected.evidence.counts).map(([key, value]) => <tr key={key}><td>{{ births: 'Narodziny', deaths: 'Zgony', dStarve: 'Głód', dAge: 'Wiek', dHealth: 'Zdrowie', dAccident: 'Wypadki', dCull: 'Katastrofa', dPred: 'Drapieżnictwo' }[key]}</td><td>{fmt.int(value)}</td></tr>)}
        </tbody></table></> : <p className="hint">Brak pełnego przedziału statystyk po zdarzeniu. Wróć do teraźniejszości i pozwól symulacji zebrać kolejną próbkę.</p>}
        <p className="hint">Po scaleniu próbek populacja i zasoby są średnimi wierszy. Zdarzenie i zmiana metryk są obserwacją; ustalenie przyczyny wymaga świata kontrolnego. Próbka z tego samego ticku może poprzedzać ręczne polecenie.</p>
        <button disabled={busy} onClick={() => { const token = ++request.current, source = client; setBusy(true); void client.historyLive().catch(e => { if (request.current === token && identity.current === source) setError(String(e)); }).finally(() => { if (request.current === token && identity.current === source) setBusy(false); }); }}>Wróć do teraźniejszości</button>
      </section>}
      <section className="card">
        <header>
          <h4>
            Dziennik zdarzeń
            <Help id="log" />
          </h4>
          <span className="hint">{info.eventLogTotal} wpisów</span>
        </header>
        <div className="log">
          {log.map((e, i) => (
            <button key={i} className={`log-row ${KIND_TONE[e.kind] ?? ''}`} style={{ width: '100%', textAlign: 'left' }} disabled={busy || !client.history || e.tick < client.history.minTick || e.tick > client.history.maxTick} title={client.history && e.tick < client.history.minTick ? 'Moment poza zachowanym zakresem historii' : 'Pokaż stan świata i kontekst metryk'} onClick={() => void seek(e)}>
              <time>{fmt.int(e.tick)}</time>
              <span>{e.text}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <header>
          <h4>
            Historia parametrów
            <Help id="commandlog" />
          </h4>
          <span className="hint">zmiany w trakcie eksperymentu</span>
        </header>
        {info.paramHistory.length === 0 && <div className="chart-empty">Parametry nie były zmieniane.</div>}
        <table className="mini">
          <tbody>
            {[...info.paramHistory].reverse().map((h, i) => (
              <tr key={i}>
                <td>{fmt.int(h.tick)}</td>
                <td>{h.key}</td>
                <td>
                  {h.from} → <b>{h.to}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
