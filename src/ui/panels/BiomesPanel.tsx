import type { WorldClient } from '../client';
import { fmt, useManager } from '../hooks';

export function BiomesPanel({ client }: { client: WorldClient }) {
  useManager();
  const snapshot = client.info?.biomes;
  if (!snapshot) return <div className="chart-empty">Oczekiwanie na dane biomów.</div>;
  return <div className="panel-body">
    <section className="card">
      <header><h4>Lokalne siedliska</h4><span className="hint">tick {fmt.int(client.info!.tick)}</span></header>
      <p className="hint">{snapshot.enabled ? `Biomy aktywne; kontrast ${snapshot.contrast.toFixed(2)}.` : 'Biomy wyłączone: obowiązują globalne warunki. Mapa siedlisk pozostaje zapisana.'}</p>
      <div style={{ overflowX: 'auto' }}><table className="mini"><thead><tr><th>Biom</th><th>Komórki</th><th>Pop.</th><th>Temp.</th><th>Pokarm A</th><th>Pokarm B</th><th>Narodziny</th><th>Zgony</th></tr></thead><tbody>
        {snapshot.biomes.map(b => <tr key={b.id}><td>{b.label}</td><td>{fmt.int(b.cells)}</td><td>{fmt.int(b.population)}</td><td>{b.meanTemperature.toFixed(2)}</td><td>{fmt.f1(b.foodA)}</td><td>{fmt.f1(b.foodB)}</td><td>{fmt.int(b.births)}</td><td>{fmt.int(b.deaths)}</td></tr>)}
      </tbody></table></div>
      <p className="hint">Pokarm to energia obecna teraz; temperatura to średnia komórek siedliska. Narodziny i zgony są licznikami całego biegu przy aktywnych biomach.</p>
    </section>
    <section className="card"><header><h4>Przejścia między biomami</h4></header>
      <table className="mini"><thead><tr><th>Z / do</th>{snapshot.biomes.map(b => <th key={b.id}>{b.label}</th>)}</tr></thead><tbody>
        {snapshot.biomes.map((b, i) => <tr key={b.id}><td>{b.label}</td>{snapshot.migrations[i].map((n, j) => <td key={j}>{i === j ? '—' : fmt.int(n)}</td>)}</tr>)}
      </tbody></table>
      <p className="hint">Liczba przekroczeń granic od początku biegu, nie liczba unikalnych migrantów. Ruch przez granicę nie dowodzi preferencji siedliska.</p>
    </section>
  </div>;
}
