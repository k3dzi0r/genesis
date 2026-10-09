import { useEffect, useRef, useState } from 'react';
import type { FertilityPattern } from '../../engine/config';
import { DEFAULT_SETUP } from '../../engine/config';
import { ENGINE_VERSION, TRAIT_NAMES } from '../../engine/constants';
import { seriesToCsv, type RunSummary } from '../../engine/experiment';
import { ci95 } from '../../engine/statsutil';
import { downloadBytes, deleteSave, getSaveBytes, listSaves, type SaveMeta } from '../../storage/db';
import type { FromSeries, ToSeries } from '../../worker/protocol';
import { manager, type WorldClient } from '../client';
import { fmt, useManager } from '../hooks';
import { PRESETS } from '../presets';
import { AbTest, SweepRunner } from './Sweep';

function download(client: WorldClient, kind: 'stats-csv' | 'experiment-json' | 'lineage-json' | 'population-csv') {
  void client.exportText(kind).then((text) => {
    const ext = kind.endsWith('csv') ? 'csv' : 'json';
    downloadBytes(`genesis-${client.name.replace(/\s+/g, '_')}-${kind}-t${client.info?.tick ?? 0}.${ext}`, text, ext === 'csv' ? 'text/csv' : 'application/json');
  });
}

function SeriesRunner({ client }: { client: WorldClient }) {
  const [count, setCount] = useState(6);
  const [start, setStart] = useState(1);
  const [ticks, setTicks] = useState(15000);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<RunSummary[]>([]);
  const [progress, setProgress] = useState(0);
  const wref = useRef<Worker | null>(null);
  useEffect(() => () => wref.current?.terminate(), []);

  const run = () => {
    const w = new Worker(new URL('../../worker/series.worker.ts', import.meta.url), { type: 'module' });
    wref.current = w;
    setRows([]);
    setProgress(0);
    setRunning(true);
    w.onmessage = (e: MessageEvent<FromSeries>) => {
      const m = e.data;
      if (m.t === 'progress') {
        setProgress(m.done / m.total);
        setRows((r) => [...r, m.summary]);
      } else {
        setRunning(false);
        w.terminate();
        if (m.t === 'error') manager.toast(`Błąd serii: ${m.message}`);
      }
    };
    const msg: ToSeries = {
      t: 'run',
      setup: client.initialSetup ?? client.setup ?? {},
      params: client.initialParams ?? client.info?.params ?? {},
      seeds: Array.from({ length: count }, (_, i) => start + i),
      ticks,
    };
    w.postMessage(msg);
  };
  const stop = () => {
    wref.current?.terminate();
    setRunning(false);
  };
  const ci = (v: number[], d: number) => {
    const c = ci95(v);
    return `${c.mean.toFixed(d)}±${(c.hi - c.mean).toFixed(d)}`;
  };

  return (
    <section className="card">
      <header>
        <h4>Seria seedów</h4>
        <span className="hint">ta sama konfiguracja, headless w osobnym wątku</span>
      </header>
      <div className="form-grid">
        <label>
          Liczba przebiegów
          <input type="number" min={2} max={64} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <label>
          Pierwszy seed
          <input type="number" min={0} value={start} onChange={(e) => setStart(Number(e.target.value))} />
        </label>
        <label>
          Ticków na przebieg
          <input type="number" min={500} step={500} value={ticks} onChange={(e) => setTicks(Number(e.target.value))} />
        </label>
      </div>
      <div className="row">
        {!running ? (
          <button className="btn primary" onClick={run}>
            Uruchom serię
          </button>
        ) : (
          <button className="btn danger" onClick={stop}>
            Przerwij
          </button>
        )}
        {rows.length > 0 && (
          <button className="btn" onClick={() => downloadBytes(`genesis-seria-${start}-${count}.csv`, seriesToCsv(rows), 'text/csv')}>
            Eksport CSV
          </button>
        )}
      </div>
      {running && (
        <div className="progress">
          <i style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="mini wide">
            <thead>
              <tr>
                <th>seed</th>
                <th>pop.</th>
                <th>pok.</th>
                <th>rozm.</th>
                <th>dieta</th>
                <th>drap.</th>
                <th>klady</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seed} className={r.status === 'extinct' ? 'bad' : ''}>
                  <td>{r.seed}</td>
                  <td>{r.finalPop}</td>
                  <td>{r.maxGeneration}</td>
                  <td>{r.meanTraits.size.toFixed(2)}</td>
                  <td>{r.meanTraits.diet.toFixed(2)}</td>
                  <td>{fmt.pct(r.carnFrac)}</td>
                  <td>{r.cladeCount}</td>
                  <td>{r.status === 'extinct' ? `wymarcie @${r.extinctionTick}` : 'żyje'}</td>
                </tr>
              ))}
              <tr className="sum">
                <td>śr. (95% CI)</td>
                <td>
                  {ci(rows.map((r) => r.finalPop), 0)}
                </td>
                <td>{ci(rows.map((r) => r.maxGeneration), 0)}</td>
                <td>{ci(rows.map((r) => r.meanTraits.size), 2)}</td>
                <td>{ci(rows.map((r) => r.meanTraits.diet), 2)}</td>
                <td>{ci(rows.map((r) => r.carnFrac * 100), 0)}%</td>
                <td>{ci(rows.map((r) => r.cladeCount), 1)}</td>
                <td>
                  {rows.filter((r) => r.status === 'extinct').length}/{rows.length} wym.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ExperimentPanel({ client }: { client: WorldClient }) {
  useManager();
  const info = client.info;
  const s = client.setup;
  const [preset, setPreset] = useState('default');
  const [seed, setSeed] = useState(1);
  const [size, setSize] = useState(800);
  const [pop, setPop] = useState(400);
  const [pattern, setPattern] = useState<FertilityPattern>('patches');
  const [patches, setPatches] = useState(9);
  const [name, setName] = useState('');

  const applyPreset = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p?.setup?.fertilityPattern) setPattern(p.setup.fertilityPattern);
    else setPattern('patches');
  };

  const create = () => {
    const p = PRESETS.find((x) => x.id === preset);
    manager.create(
      { ...DEFAULT_SETUP, ...p?.setup, seed, width: size, height: size, initialPopulation: pop, fertilityPattern: pattern, patchCount: patches },
      { ...p?.params },
      name.trim() || undefined,
    );
  };

  return (
    <div className="panel-body">
      <section className="card">
        <header>
          <h4>Bieżący eksperyment</h4>
          <span className="hint">silnik {ENGINE_VERSION}</span>
        </header>
        {s && info && (
          <div className="kv">
            <span>Seed</span>
            <b>{s.seed}</b>
            <span>Świat</span>
            <b>
              {s.width}×{s.height}, komórka {s.cellSize}
            </b>
            <span>Założyciele</span>
            <b>{s.initialPopulation}</b>
            <span>Wzorzec żyzności</span>
            <b>{s.fertilityPattern}</b>
            <span>Tick</span>
            <b>{fmt.int(info.tick)}</b>
            <span>Genealogia w pamięci</span>
            <b>
              {fmt.big(info.lineageNodes)} węzłów ({(info.lineageBytes / 1e6).toFixed(1)} MB), przycięto {fmt.big(info.lineagePruned)}
            </b>
            <span>Zmian parametrów</span>
            <b>{info.paramHistory.length}</b>
          </div>
        )}
        <div className="btn-grid">
          <button className="btn" title="Nowy świat o tych samych warunkach początkowych (ten sam seed) — do porównań A/B" onClick={() => manager.twin(client)}>
            Bliźniak od startu
          </button>
          <button className="btn" title="Kopia bieżącego stanu — rozwidlenie od teraz" onClick={() => void manager.fork(client)}>
            Rozwidl od teraz
          </button>
          <button
            className="btn"
            title="Uruchom ten świat ponownie od tick 0 z tym samym seedem"
            onClick={() => {
              if (confirm('Zresetować eksperyment do tick 0 (ten sam seed i konfiguracja początkowa)?')) {
                client.init(client.initialSetup ?? client.setup ?? {}, client.initialParams ?? info?.params ?? {});
                client.play(true);
              }
            }}
          >
            Reset (ten sam seed)
          </button>
          <button className="btn danger" onClick={() => confirm(`Usunąć „${client.name}”?`) && manager.remove(client.id)}>
            Usuń świat
          </button>
        </div>
      </section>

      <section className="card">
        <header>
          <h4>Nowy eksperyment</h4>
        </header>
        <div className="form-grid">
          <label className="span2">
            Scenariusz
            <select value={preset} onChange={(e) => applyPreset(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p className="note span2">{PRESETS.find((p) => p.id === preset)?.desc}</p>
          <label>
            Seed
            <div className="input-btn">
              <input type="number" min={0} value={seed} onChange={(e) => setSeed(Number(e.target.value) >>> 0)} />
              <button className="icon" title="Losowy seed" onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>
                ⚄
              </button>
            </div>
          </label>
          <label>
            Nazwa
            <input type="text" placeholder="(auto)" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Rozmiar świata
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {[400, 600, 800, 1200, 1600].map((v) => (
                <option key={v} value={v}>
                  {v}×{v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Założyciele
            <input type="number" min={10} max={3000} step={50} value={pop} onChange={(e) => setPop(Number(e.target.value))} />
          </label>
          <label>
            Wzorzec żyzności
            <select value={pattern} onChange={(e) => setPattern(e.target.value as FertilityPattern)}>
              <option value="patches">plamy</option>
              <option value="uniform">jednolity</option>
              <option value="gradient">gradient</option>
              <option value="oasis">oaza</option>
            </select>
          </label>
          <label>
            Liczba plam
            <input type="number" min={1} max={40} value={patches} onChange={(e) => setPatches(Number(e.target.value))} />
          </label>
        </div>
        <button className="btn primary" onClick={create}>
          Utwórz świat
        </button>
      </section>

      <SeriesRunner client={client} />
      <AbTest client={client} />
      <SweepRunner client={client} />

      <section className="card">
        <header>
          <h4>Eksport danych</h4>
        </header>
        <div className="btn-grid">
          <button className="btn" onClick={() => download(client, 'stats-csv')}>
            Statystyki CSV
          </button>
          <button className="btn" onClick={() => download(client, 'experiment-json')}>
            Eksperyment JSON
          </button>
          <button className="btn" onClick={() => download(client, 'lineage-json')}>
            Genealogia JSON
          </button>
          <button className="btn" onClick={() => download(client, 'population-csv')}>
            Populacja CSV
          </button>
        </div>
        <p className="note">
          Eksperyment JSON zawiera konfigurację, historię zmian parametrów, dziennik poleceń i zdarzeń oraz pełne szeregi statystyk. Cechy: {TRAIT_NAMES.join(', ')}.
        </p>
      </section>
    </div>
  );
}

export function SavesPanel({ client }: { client: WorldClient }) {
  const m = useManager();
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');

  useEffect(() => {
    void listSaves().then(setSaves);
  }, [m.savesVersion]);

  const load = async (id: string, nm: string) => {
    const bytes = await getSaveBytes(id);
    if (bytes) await manager.createFromBytes(bytes.slice(), `${nm} (wznowiony)`);
  };

  return (
    <div className="panel-body">
      <section className="card">
        <header>
          <h4>Zapis stanu</h4>
          <span className="hint">pełny stan świata, statystyki i genealogia</span>
        </header>
        <div className="row">
          <input type="text" placeholder="Etykieta (opcjonalnie)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className="btn primary" onClick={() => void client.save(label.trim() || `${client.name} @${client.info?.tick ?? 0}`, 'manual')}>
            Zapisz
          </button>
        </div>
        <div className="row">
          <button className="btn" onClick={() => void client.save(client.name, 'export')}>
            Pobierz plik .genesis
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Importuj plik
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".genesis,.gz,application/octet-stream"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                await manager.createFromBytes(new Uint8Array(await f.arrayBuffer()), f.name.replace(/\.genesis$/, ''));
              } catch (err) {
                manager.toast(`Nie można wczytać pliku: ${String(err)}`);
              }
              e.target.value = '';
            }}
          />
        </div>
        <label className="slider-row">
          <span>Autozapis co</span>
          <select value={client.autosaveEvery} onChange={(e) => client.setAutosave(Number(e.target.value))}>
            <option value={0}>wyłączony</option>
            <option value={5000}>5 000 ticków</option>
            <option value={25000}>25 000 ticków</option>
            <option value={100000}>100 000 ticków</option>
            <option value={500000}>500 000 ticków</option>
          </select>
        </label>
        <p className="note">Przechowywane są 3 ostatnie autozapisy każdego świata (IndexedDB, kompresja gzip).</p>
      </section>
      <section className="card">
        <header>
          <h4>Zapisane eksperymenty</h4>
          <span className="hint">{saves.length}</span>
        </header>
        {saves.length === 0 && <div className="chart-empty">Brak zapisów.</div>}
        {saves.map((s) => (
          <div key={s.id} className="save-row">
            <div>
              <b>{s.name}</b>
              <small>
                {s.engine !== ENGINE_VERSION && <span className="tag warn">silnik {s.engine ?? '≤0.2'} — niezgodny</span>} {s.kind === 'auto' ? 'autozapis' : 'ręczny'} · seed {s.seed} · tick {fmt.int(s.tick)} · {fmt.int(s.pop)} org. · {(s.size / 1024).toFixed(0)} kB · {new Date(s.savedAt).toLocaleString('pl-PL')}
              </small>
            </div>
            <div className="row">
              <button className="btn sm" disabled={s.engine !== ENGINE_VERSION} onClick={() => void load(s.id, s.worldName)}>
                Wznów
              </button>
              <button
                className="btn sm"
                onClick={async () => {
                  const b = await getSaveBytes(s.id);
                  if (b) downloadBytes(`${s.worldName.replace(/\s+/g, '_')}-t${s.tick}.genesis`, b);
                }}
              >
                ⤓
              </button>
              <button
                className="btn sm danger"
                onClick={async () => {
                  await deleteSave(s.id);
                  setSaves(await listSaves());
                }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
