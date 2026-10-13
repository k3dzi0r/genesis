import { useEffect, useRef, useState } from 'react';
import { MODULES, MODULE_PROFILES, moduleEnabled, modulePatch, moduleProfilePatch, rememberModules, type ModuleMemory } from '../../engine/modules';
import type { WorldParams } from '../../engine/config';
import type { WorldClient } from '../client';
import { useManager } from '../hooks';
import { Help } from '../help/Help';

const restoration = new WeakMap<WorldClient, ModuleMemory>();
export function ModulePanel({ client }: { client: WorldClient }) {
  useManager();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);
  useEffect(() => { token.current++; setBusy(false); setError(null); return () => { token.current++; }; }, [client, client.worldEpoch, client.historyEpoch]);
  const params = client.info?.params;
  const apply = async (patch: Partial<WorldParams>) => {
    if (busy || !params || client.history?.preview) return;
    const current = ++token.current;
    const memory = restoration.get(client) ?? {};
    rememberModules(params, memory); restoration.set(client, memory);
    setBusy(true); setError(null);
    try {
      await client.commands(Object.entries(patch).map(([key, value]) => ({ type: 'setParam' as const, key: key as keyof WorldParams, value: value! })));
    } catch (e) { if (current === token.current) setError(String(e)); }
    finally { if (current === token.current) setBusy(false); }
  };
  return <div className="panel-body">
    <section className="card">
      <header><h4>Mechaniki świata <Help id="modules" /></h4></header>
      <p className="note">Przełączniki zmieniają rzeczywistą symulację. Ruch, genomy, mutacje, rozród i bilans energii działają zawsze.</p>
      {client.history?.preview && <p className="note warn">Podgląd historii: moduły pokazują ówczesny stan. Wróć do teraźniejszości, aby je zmieniać.</p>}
      <fieldset className="controls-fieldset" disabled={busy || !params || !!client.history?.preview}>
        <div className="btn-grid">{MODULE_PROFILES.map(profile => <button className="btn sm" key={profile.id} onClick={() => params && void apply(moduleProfilePatch(params, profile.ids, restoration.get(client)))}>{profile.label}</button>)}</div>
        <p className="note">Zestaw zastępuje wybór modułów. Aktywne własne wartości pozostają; ponowne włączenie przywraca ostatnie ustawienie w tej sesji.</p>
        {params && MODULES.map(m => <div className="module-row" key={m.id}>
          <label><input type="checkbox" checked={moduleEnabled(params, m.id)} onChange={e => void apply(modulePatch(params, m.id, e.target.checked, restoration.get(client)))} /><b>{m.label}</b></label><Help id={m.help} />
          <p>{m.description}</p>
          {m.id === 'mateChoice' && params.sexual < 0.5 && params.mateChoice >= 0.5 && <p className="note warn">Parametr jest włączony, lecz wybór partnera pozostaje nieaktywny bez rozrodu płciowego.</p>}
          {m.id === 'biomes' && params.biomes >= 0.5 && params.biomeContrast === 0 && <p className="note">Kontrast = 0: siedliska mają identyczne warunki.</p>}
        </div>)}
      </fieldset>
      {busy && <p className="note" role="status">Zapisywanie zmiany w historii…</p>}{error && <p className="note warn" role="alert">{error}</p>}
    </section>
  </div>;
}
