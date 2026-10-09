import type { WorldClient } from '../client';
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
  const info = client.info;
  if (!info) return null;
  const log = [...info.eventLog].reverse();
  return (
    <div className="panel-body">
      <section className="card">
        <header>
          <h4>Dziennik zdarzeń</h4>
          <span className="hint">{info.eventLogTotal} wpisów</span>
        </header>
        <div className="log">
          {log.map((e, i) => (
            <div key={i} className={`log-row ${KIND_TONE[e.kind] ?? ''}`}>
              <time>{fmt.int(e.tick)}</time>
              <span>{e.text}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <header>
          <h4>Historia parametrów</h4>
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
