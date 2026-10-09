import { useState } from 'react';
import { TRAIT_LABELS, TRAIT_NAMES } from '../../engine/constants';
import type { InspectResult } from '../../worker/protocol';
import type { WorldClient } from '../client';
import { fmt, useInterval, useManager } from '../hooks';
import { BrainDiagram, GenomeStrip } from './Brain';
import { TRAIT_COLORS } from './Stats';

function Bar({ value, color = 'var(--accent)', label, right }: { value: number; color?: string; label: string; right?: string }) {
  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="bar">
        <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      </div>
      <b>{right ?? fmt.pct(value)}</b>
    </div>
  );
}

export function Inspector({ client, goGenealogy }: { client: WorldClient; goGenealogy: () => void }) {
  useManager();
  const id = client.selectedId;
  const [res, setRes] = useState<InspectResult | null>(null);

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
          <button className="btn" onClick={goGenealogy}>
            Otwórz genealogię
          </button>
        </section>
        <section className="card">
          <header>
            <h4>Cechy w chwili narodzin</h4>
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
        <Bar label="Energia" value={o.energy / o.maxEnergy} color="#ffd54f" right={`${o.energy.toFixed(1)} / ${o.maxEnergy.toFixed(0)}`} />
        <Bar label="Zdrowie" value={o.health} color="#7be08a" />
        <Bar label="Wiek" value={o.age / o.maxAge} color="#90caf9" right={`${fmt.int(o.age)} / ${fmt.int(o.maxAge)}`} />
        <div className="kv">
          <span>Narodziny</span>
          <b>tick {fmt.int(o.birthTick)}</b>
          <span>Oczekiwana długość życia</span>
          <b title="min(limit wieku, wiek + energia / koszt bezczynności)">{fmt.int(o.expectedLifespan)} t.</b>
          <span>Do śmierci głodowej (bez żerowania)</span>
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
          <span>Mutacje względem rodzica</span>
          <b>{lin?.mutations ?? 0}</b>
          <span>Klad (założyciel)</span>
          <b>#{o.clade + 1}</b>
        </div>
        <button className="btn" onClick={goGenealogy}>
          Genealogia i przodkowie →
        </button>
      </section>

      <section className="card">
        <header>
          <h4>Geny → fizjologia</h4>
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
            diet: p.diet < 0.02 ? 'czysty roślinożerca — nie potrafi atakować' : `atakuje; trawienie roślin ×${(1 - 0.9 * p.diet).toFixed(2)}, mięsa ${fmt.pct(0.85 * p.diet)}`,
          };
          return (
            <div key={t} className="trait-row">
              <div className="bar-row">
                <span>{TRAIT_LABELS[t]}</span>
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
          <span>Metabolizm podstawowy</span>
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

      <section className="card">
        <header>
          <h4>Pamięć rekurencyjna</h4>
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
          <h4>Sieć neuronowa</h4>
          <span className="hint">krawędzie: wagi genomu · węzły: bieżąca aktywacja</span>
        </header>
        <BrainDiagram genome={o.genome} inputs={o.inputs} hidden={o.hidden} outputs={o.outputs} />
      </section>

      <section className="card">
        <header>
          <h4>Genom</h4>
          <span className="hint">9 cech + {o.genome.length - 9} wag</span>
        </header>
        <GenomeStrip genome={o.genome} />
      </section>
    </div>
  );
}
