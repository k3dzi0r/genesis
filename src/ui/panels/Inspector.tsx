import { useState } from 'react';
import { N_TRAITS, TRAIT_LABELS, TRAIT_NAMES } from '../../engine/constants';
import type { InspectResult } from '../../worker/protocol';
import type { WorldClient } from '../client';
import { Help } from '../help/Help';
import { fmt, useInterval, useManager } from '../hooks';
import { BrainDiagram, GenomeStrip } from './Brain';
import { putSpecimen } from '../../storage/atlas';
import { TRAIT_COLORS } from './Stats';

function Bar({ value, color = 'var(--accent)', label, right, help }: { value: number; color?: string; label: string; right?: string; help?: string }) {
  return (
    <div className="bar-row">
      <span>
        {label}
        {help && <Help id={help} />}
      </span>
      <div className="bar">
        <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      </div>
      <b>{right ?? fmt.pct(value)}</b>
    </div>
  );
}

export function Inspector({ client, goGenealogy, goAtlas, goLab }: { client: WorldClient; goGenealogy: () => void; goAtlas?: () => void; goLab?: () => void }) {
  useManager();
  const id = client.selectedId;
  const [res, setRes] = useState<InspectResult | null>(null);
  const [learned, setLearned] = useState(true);
  const [saved, setSaved] = useState('');
  const save = async (archived = false) => { try { const r = await client.captureSpecimen(id!, archived); await putSpecimen(r.specimen); setSaved('Okaz zachowany w atlasie.'); } catch (e) { setSaved(String(e)); } };

  useInterval(
    async () => {
      if (id === null) return;
      const r = await client.inspect(id);
      setRes(r);
    },
    500,
    id !== null,
    id,
  );

  if (id === null)
    return (
      <div className="panel-body">
        <div className="placeholder">
          <h3>Nie zaznaczono organizmu</h3>
          <p>Kliknij organizm w świecie, aby zobaczyć jego genom, sieć neuronową, parametry fizjologiczne i pochodzenie.</p>
        </div>
      </div>
    );

  const live = res?.live && res.live.id === id ? res.live : null;
  const arch = res?.archived && res.archived.info.id === id ? res.archived : null;
  if (!live && !arch) return <div className="panel-body"><div className="placeholder">Wczytywanie organizmu #{id}…</div></div>;

  const select = (pid: number | null) => pid !== null && client.select(pid);

  if (arch) {
    const i = arch.info;
    return (
      <div className="panel-body">
        <section className="card">
          <header>
            <h4>
              #{i.id} <span className="tag dead">zmarły · archiwum</span>
              <Help id="insp.archive" />
            </h4>
            <span className="hint">pokolenie {i.generation}</span>
          </header>
          <div className="kv">
            <span>Narodziny</span>
            <b>tick {fmt.int(i.birthTick)}</b>
            <span>Śmierć</span>
            <b>{i.deathTick !== null ? `tick ${fmt.int(i.deathTick)}` : '–'}</b>
            <span>Długość życia</span>
            <b>{i.deathTick !== null ? fmt.int(i.deathTick - i.birthTick) : '–'}</b>
            <span>Potomstwo</span>
            <b>{i.offspring}</b>
            <span>Mutacje względem rodzica</span>
            <b>{i.mutations}</b>
            <span>Rodzic</span>
            <b>{i.parentId !== null ? <a onClick={() => select(i.parentId)}>#{i.parentId}</a> : 'założyciel'}</b>
            {i.parent2Id !== null && (
              <>
                <span>Drugi rodzic</span>
                <b>
                  <a onClick={() => select(i.parent2Id)}>#{i.parent2Id}</a>
                </b>
              </>
            )}
          </div>
          <button className="btn" onClick={goGenealogy}>Otwórz genealogię</button>
          <button className="btn" onClick={() => void save(true)}>Zachowaj genom przodka</button>
          {saved && <p className="note">{saved}</p>}
        </section>
        <section className="card">
          <header>
            <h4>
              Cechy w chwili narodzin
              <Help id="genome" />
            </h4>
          </header>
          {TRAIT_NAMES.map((t, k) => (
            <Bar key={t} label={TRAIT_LABELS[t]} value={i.traits[k]} color={TRAIT_COLORS[t]} right={i.traits[k].toFixed(2)} />
          ))}
        </section>
        {arch.genome && (
          <section className="card">
            <header>
              <h4>Odtworzony genom i sieć</h4>
              <span className="hint">z genomu założyciela + rejestru mutacji</span>
            </header>
            <GenomeStrip genome={arch.genome} />
            <BrainDiagram genome={arch.genome} />
          </section>
        )}
      </div>
    );
  }

  const o = live!;
  const p = o.physiology;
  const lin = o.lineage;
  return (
    <div className="panel-body">
      <section className="card">
        <header>
          <h4>
            #{o.id} <span className="tag live">żywy</span>
          </h4>
          <span className="hint">pokolenie {o.generation}</span>
        </header>
        <Bar help="insp.energy" label="Energia" value={o.energy / o.maxEnergy} color="#ffd54f" right={`${o.energy.toFixed(1)} / ${o.maxEnergy.toFixed(0)}`} />
        <Bar help="insp.health" label="Zdrowie" value={o.health} color="#7be08a" />
        <Bar help="insp.age" label="Wiek" value={o.age / o.maxAge} color="#90caf9" right={`${fmt.int(o.age)} / ${fmt.int(o.maxAge)}`} />
        <div className="kv">
          <span>Narodziny</span>
          <b>tick {fmt.int(o.birthTick)}</b>
          <span>
            Oczekiwana długość życia
            <Help id="insp.expected" />
          </span>
          <b title="min(limit wieku, wiek + energia / koszt bezczynności)">{fmt.int(o.expectedLifespan)} t.</b>
          <span>
            Do śmierci głodowej (bez żerowania)
            <Help id="insp.starvation" />
          </span>
          <b>{Number.isFinite(o.starvationIn) ? `${fmt.int(o.starvationIn)} t.` : '∞'}</b>
          <span>Potomstwo</span>
          <b>{o.offspring}</b>
          <span>Pozycja</span>
          <b>
            {o.x.toFixed(0)}, {o.y.toFixed(0)}
          </b>
          <span>Rodzic</span>
          <b>{o.parentId !== null ? <a onClick={() => select(o.parentId)}>#{o.parentId}</a> : 'założyciel'}</b>
          {o.parent2Id !== null && (
            <>
              <span>Drugi rodzic</span>
              <b>
                <a onClick={() => select(o.parent2Id)}>#{o.parent2Id}</a>
              </b>
            </>
          )}
          <span>
            Mutacje względem rodzica
            <Help id="insp.mutations" />
          </span>
          <b>{lin?.mutations ?? 0}</b>
          <span>
            Klad (założyciel)
            <Help id="insp.clade" />
          </span>
          <b>#{o.clade + 1}</b>
        </div>
        <button className="btn" onClick={goGenealogy}>
          Genealogia i przodkowie →
        </button>
        <button className="btn" onClick={() => void save()}>Zachowaj okaz</button>
        {goAtlas && <button className="btn" onClick={goAtlas}>Atlas</button>}
        {goLab && <button className="btn" onClick={goLab}>Próby kontrolowane</button>}
        {saved && <p className="note">{saved}</p>}
      </section>

      <section className="card">
        <header>
          <h4>
            Geny → fizjologia
            <Help id="genome" />
          </h4>
        </header>
        {TRAIT_NAMES.map((t, k) => {
          const phys: Record<string, string> = {
            size: `promień ${p.radius.toFixed(1)}, masa ${p.mass.toFixed(2)}`,
            speed: `maks. ${p.maxSpeed.toFixed(2)} j./tick`,
            sense: `zasięg ${p.senseRange.toFixed(0)} j.`,
            reproThreshold: `rozmnaża się od ${fmt.pct(p.reproThresh)} energii`,
            investment: `${fmt.pct(p.investFrac)} maks. energii na potomka`,
            maturity: `dojrzałość po ${p.maturity.toFixed(0)} t.`,
            coldTolerance: `tolerancja zimna ${(p.coldTol * 0.6).toFixed(2)}`,
            bite: `kęs ${p.biteCap.toFixed(2)}/t., sprawność ${fmt.pct(p.assim)}`,
            hue: 'znacznik neutralny (bez wpływu na przeżycie)',
            memory: `stan pamięci utrzymuje się λ = ${p.memDecay.toFixed(2)} na tick`,
            plantSpecialization: o.traits[11] < 0.5 ? 'Lepsze trawienie A, słabsze B' : 'Lepsze trawienie B, słabsze A; niższa toksyczność B',
            matePreference: `preferowany fenotyp partnera ${o.traits[12].toFixed(2)}`,
            mateSelectivity: `tolerancja partnera ${(1 - 0.95 * o.traits[13]).toFixed(2)}`,
            plasticity: `siła zmian w życiu ×${o.traits[14].toFixed(2)}`,
            nicheInvestment: `wysiłek kultywacji ×${o.traits[15].toFixed(2)}`,
            diet: p.diet < 0.02 ? 'czysty roślinożerca — nie potrafi atakować' : `atakuje; trawienie roślin ×${(1 - 0.9 * p.diet).toFixed(2)}, mięsa ${fmt.pct(0.85 * p.diet)}`,
          };
          return (
            <div key={t} className="trait-row">
              <div className="bar-row">
                <span>
                  {TRAIT_LABELS[t]}
                  <Help id={`trait.${t}`} />
                </span>
                <div className="bar">
                  <i style={{ width: `${o.traits[k] * 100}%`, background: TRAIT_COLORS[t] }} />
                </div>
                <b>{o.traits[k].toFixed(2)}</b>
              </div>
              <small>{phys[t]}</small>
            </div>
          );
        })}
        <div className="kv" style={{ marginTop: 8 }}>
          <span>
            Metabolizm podstawowy
            <Help id="insp.costs" />
          </span>
          <b>{o.costs.basal.toFixed(4)} /t.</b>
          <span>Sensory</span>
          <b>{o.costs.sense.toFixed(4)} /t.</b>
          <span>Mózg (Σ|w| = {p.sumAbsW.toFixed(0)})</span>
          <b>{o.costs.brain.toFixed(4)} /t.</b>
          <span>Odporność na zimno</span>
          <b>{o.costs.upkeep.toFixed(4)} /t.</b>
          <span>Koszt bezczynności razem</span>
          <b>{o.costs.idle.toFixed(4)} /t.</b>
        </div>
      </section>

      <section className="card"><header><h4>Rzeczywiste zachowanie</h4><Help id="atlas" /></header>
        <div className="kv"><span>Czas obserwacji</span><b>{o.observations.observedTicks} ticków</b><span>Przebyta droga</span><b>{o.observations.distance.toFixed(1)}</b><span>Energia A / B / mięsa</span><b>{o.observations.foodAConsumed.toFixed(1)} / {o.observations.foodBConsumed.toFixed(1)} / {o.observations.meatEnergy.toFixed(1)}</b><span>Skuteczne ataki</span><b>{o.observations.successfulAttacks}</b><span>Powroty do miejsc</span><b>{o.observations.revisits}</b><span>Ekspozycja / ucieczki</span><b>{o.observations.threatExposure} / {o.observations.threatEscape}</b><span>Sygnał teraz</span><b>{o.signal.toFixed(3)}</b><span>Kultywacja / przeniesione nasiona</span><b>{o.observations.cultivated.toFixed(3)} / {o.observations.seedsMoved.toFixed(3)}</b><span>Próby partnera / odrzucenia</span><b>{o.observations.mateAttempts} / {o.observations.mateRejected}</b></div>
        <p className="note">A/B to pobrane zasoby, mięso to przyswojona energia. Powroty i ucieczki są pomiarami ruchu; nie dowodzą zamiaru.</p>
      </section>
      <section className="card">
        <header>
          <h4>
            Pamięć rekurencyjna
            <Help id="insp.memory" />
          </h4>
          <span className="hint">stan wraca na wejścia w następnym ticku</span>
        </header>
        {o.mem.map((v, k) => (
          <div key={k} className="bar-row">
            <span>komórka {k + 1}</span>
            <div className="delta-bar">
              <i style={{ left: v >= 0 ? '50%' : `${50 + v * 50}%`, width: `${Math.abs(v) * 50}%`, background: v >= 0 ? 'var(--accent)' : 'var(--bad)' }} />
            </div>
            <b>{v.toFixed(2)}</b>
          </div>
        ))}
      </section>

      <section className="card">
        <header>
          <h4>
            Sieć neuronowa
            <Help id="brain.diagram" />
          </h4>
          <span className="hint">krawędzie: {learned ? "wagi efektywne" : "genom"} · aktywacje: stan efektywny</span>
        </header>
        <label className="network-toggle"><input type="checkbox" checked={learned} onChange={(e) => setLearned(e.target.checked)} /> Pokaż sieć po uczeniu podczas życia</label>
        <BrainDiagram genome={learned ? o.learnedWeights : o.genome} inputs={o.inputs} hidden={o.hidden} outputs={o.outputs} />
      </section>

      <section className="card">
        <header>
          <h4>
            Genom
            <Help id="insp.genome" />
          </h4>
          <span className="hint">{N_TRAITS} cech + {o.genome.length - N_TRAITS} wag</span>
        </header>
        <GenomeStrip genome={o.genome} />
      </section>
    </div>
  );
}
