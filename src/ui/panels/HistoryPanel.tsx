import { useEffect, useRef, useState } from 'react';
import { downloadBytes } from '../../storage/db';
import { manager, type WorldClient } from '../client';
import { fmt, useManager } from '../hooks';

/** Exact tick navigation keeps the live world intact; ordinary fork saves the displayed state. */
export function HistoryPanel({ client }: { client: WorldClient }) {
  useManager();
  const history = client.history;
  const [target, setTarget] = useState(history?.viewTick ?? 0);
  const [busy, setBusy] = useState(false);
  const [playback, setPlayback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const inFlight = useRef<WorldClient | null>(null);
  const activeClient = useRef(client);
  activeClient.current = client;
  const isCurrent = () => mounted.current && activeClient.current === client;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, [client]);
  useEffect(() => {
    if (!dragging.current) setTarget(history?.viewTick ?? 0);
  }, [history?.viewTick, client]);
  useEffect(() => { dragging.current = false; inFlight.current = null; setTarget(client.history?.viewTick ?? 0); setPlayback(false); setBusy(false); setError(null); }, [client]);

  const seek = async (tick: number) => {
    if (inFlight.current === client || !history) return false;
    inFlight.current = client; setBusy(true); setError(null);
    try {
      await client.historySeek(Math.max(history.minTick, Math.min(history.maxTick, Math.round(tick))));
      if (isCurrent()) { dragging.current = false; setTarget(client.history?.viewTick ?? tick); }
      return isCurrent();
    } catch (e) {
      if (isCurrent()) { setError(e instanceof Error ? e.message.split('\n')[0] : String(e)); setPlayback(false); }
      return false;
    } finally {
      if (inFlight.current === client) inFlight.current = null;
      if (isCurrent()) setBusy(false);
    }
  };
  useEffect(() => {
    if (!playback) return;
    const timer = window.setInterval(() => {
      const h = client.history;
      if (!h || inFlight.current === client) return;
      if (h.viewTick >= h.maxTick) { setPlayback(false); return; }
      void seek(Math.min(h.maxTick, h.viewTick + 100));
    }, 250);
    return () => window.clearInterval(timer);
    // Playback reads the client's current state, not the render's captured tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback, client]);

  const returnLive = async () => {
    dragging.current = false; setPlayback(false); setBusy(true);
    try { await client.historyLive(); }
    catch (e) { if (isCurrent()) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (isCurrent()) setBusy(false); }
  };
  const exportArchive = async () => {
    setBusy(true); setError(null);
    try {
      const bytes = await client.exportHistory();
      downloadBytes(`genesis-historia-${client.name.replace(/\s+/g, '_')}-t${client.history?.maxTick ?? 0}.genesis-history`, bytes);
    } catch (e) { if (isCurrent()) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (isCurrent()) setBusy(false); }
  };
  if (!history) return <div className="panel-body"><div className="chart-empty">Historia będzie dostępna po uruchomieniu świata.</div></div>;
  const events = history.events.filter(e => e.tick >= history.minTick).slice(-100).reverse();
  return (
    <div className="panel-body">
      <section className="card">
        <header><h4>Historia świata</h4><span className={`tag ${history.preview ? 'warn' : 'good'}`}>{history.preview ? 'podgląd przeszłości' : 'teraźniejszość'}</span></header>
        <p className="note">Odtwórz dokładny tick wraz z ówczesną genealogią. Przeglądanie zatrzymuje żywy świat; jego teraźniejszość pozostaje zachowana.</p>
        <div className="kv"><span>Dostępny zakres</span><b>{fmt.int(history.minTick)}–{fmt.int(history.maxTick)}</b><span>Wyświetlany tick</span><b>{fmt.int(history.viewTick)}</b><span>Punkty kontrolne</span><b>{history.checkpoints} · {(history.bytes / 1024 / 1024).toFixed(1)} MiB</b></div>
        <label className="slider-row">
          <span>Moment historii<b>{fmt.int(target)}</b></span>
          <input aria-label="Moment historii" type="range" min={history.minTick} max={history.maxTick} step={1} value={Math.max(history.minTick, Math.min(history.maxTick, target))} disabled={busy || playback || history.minTick === history.maxTick}
            onFocus={() => { dragging.current = true; }} onBlur={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}
            onPointerDown={() => { dragging.current = true; }} onChange={e => setTarget(Number(e.target.value))}
            onPointerUp={e => { dragging.current = false; void seek(Number(e.currentTarget.value)); }}
            onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) void seek(Number(e.currentTarget.value)); }} />
        </label>
        <div className="form-grid"><label>Dokładny tick<input aria-label="Dokładny tick" type="number" min={history.minTick} max={history.maxTick} step={1} value={target} onFocus={() => { dragging.current = true; }} onChange={e => { dragging.current = true; setTarget(Number(e.target.value)); }} onKeyDown={e => { if (e.key === 'Enter') void seek(target); }} /></label><button className="btn" disabled={busy || playback || !Number.isFinite(target)} onClick={() => void seek(target)}>Pokaż moment</button></div>
        <div className="btn-grid">
          <button className="btn" disabled={busy || playback || history.viewTick <= history.minTick} onClick={() => void seek(history.viewTick - 100)}>← 100 ticków</button>
          <button className="btn" disabled={busy || playback || history.viewTick >= history.maxTick} onClick={() => void seek(history.viewTick + 100)}>100 ticków →</button>
          <button className={`btn ${playback ? 'on' : ''}`} disabled={busy && !playback || history.minTick === history.maxTick} onClick={async () => {
            if (playback) { setPlayback(false); return; }
            if (history.viewTick >= history.maxTick && !await seek(history.minTick)) return;
            if (isCurrent()) setPlayback(true);
          }}>{playback ? '❚❚ Zatrzymaj odtwarzanie' : '▶ Odtwórz historię'}</button>
          <button className="btn" disabled={busy || !history.preview} onClick={() => void returnLive()}>Wróć do teraźniejszości</button>
          <button className="btn primary" disabled={busy} onClick={async () => {
            setPlayback(false); setBusy(true);
            try { await manager.fork(client); } catch (e) { if (isCurrent()) setError(e instanceof Error ? e.message : String(e)); }
            finally { if (isCurrent()) setBusy(false); }
          }}>Rozwidl tutaj @{fmt.int(history.viewTick)}</button>
        </div>
        <p className="note">Historia ma ograniczoną pamięć: najstarsze punkty są usuwane. Archiwum przechowuje dostępne punkty, polecenia, zaznaczenia oraz teraźniejszość; po imporcie można znów odtwarzać i rozwidlać.</p>
        <div className="row"><button className="btn" disabled={busy} onClick={() => void exportArchive()}>Eksportuj archiwum historii</button><button className="btn" disabled={busy} onClick={() => input.current?.click()}>Importuj archiwum</button></div>
        <input ref={input} type="file" accept=".genesis-history" style={{ display: 'none' }} onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = '';
          if (!file) return;
          if (file.size > 160 * 1024 * 1024) { setError('Archiwum przekracza limit 160 MiB.'); return; }
          setBusy(true); setPlayback(false);
          try { await manager.createFromHistoryBytes(new Uint8Array(await file.arrayBuffer()), `${file.name.replace(/\.genesis-history$/, '')} (historia)`); }
          catch (err) { setError(err instanceof Error ? err.message : String(err)); }
          finally { if (isCurrent()) setBusy(false); }
        }} />
        {busy && <p className="note">Odtwarzanie lub zapis…</p>}
        {error && <p className="note bad" role="alert">{error}</p>}
      </section>
      <section className="card"><header><h4>Wydarzenia na osi czasu</h4><span className="hint">kliknij, aby odtworzyć moment</span></header>
        {events.length === 0 && <div className="chart-empty">Brak wydarzeń w dostępnym zakresie.</div>}
        <div className="log">{events.map((e, i) => <button className={`log-row ${e.kind === 'extinction' || e.kind === 'crash' ? 'bad' : ''}`} key={`${e.tick}-${i}`} disabled={busy || playback} title={`Przejdź do ticku ${e.tick}`} onClick={() => void seek(e.tick)}><time>{fmt.int(e.tick)}</time><span>{e.text}</span></button>)}</div>
      </section>
    </div>
  );
}
