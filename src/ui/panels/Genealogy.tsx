import { useEffect, useMemo, useState } from 'react';
import { TRAIT_LABELS, TRAIT_NAMES, W1_OFF, N_IN, N_HID, INPUT_LABELS, OUTPUT_LABELS, B1_OFF, B2_OFF, W2_OFF } from '../../engine/constants';
import type { CompareResult, LineageResult, LineageTreeNode } from '../../worker/protocol';
import type { WorldClient } from '../client';
import { fmt, useInterval, useManager } from '../hooks';
import { GenomeStrip } from './Brain';
import { TRAIT_COLORS } from './Stats';

function describeGene(g: number): string {
  if (g < 9) return TRAIT_LABELS[TRAIT_NAMES[g]];
  if (g < B1_OFF) {
    const k = g - W1_OFF;
    return `${INPUT_LABELS[k % N_IN]} → ukryty ${Math.floor(k / N_IN)}`;
  }
  if (g < W2_OFF) return `bias ukryty ${g - B1_OFF}`;
  if (g < B2_OFF) {
    const k = g - W2_OFF;
    return `ukryty ${k % N_HID} → ${OUTPUT_LABELS[Math.floor(k / N_HID)]}`;
  }
  return `bias wyjścia ${OUTPUT_LABELS[g - B2_OFF]}`;
}

function Spark({ values, color, label }: { values: number[]; color: string; label: string }) {
  const W = 140;
  const H = 34;
  const n = values.length;
  const pts = values.map((v, i) => `${(n > 1 ? (i / (n - 1)) * (W - 4) : 0) + 2},${H - 3 - v * (H - 6)}`).join(' ');
  const first = values[0];
  const last = values[n - 1];
  const d = last - first;
  return (
    <div className="spark">
      <div className="spark-head">
        <span>{label}</span>
        <b className={d > 0.02 ? 'up' : d < -0.02 ? 'down' : ''}>
          {first.toFixed(2)} → {last.toFixed(2)}
        </b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

interface Laid {
  node: LineageTreeNode;
  x: number;
  y: number;
}

function TreeView({ data, selectedId, onPick }: { data: LineageResult; selectedId: number; onPick: (id: number) => void }) {
  const layout = useMemo(() => {
    const DX = 26;
    const DY = 13;
    const anc = data.ancestors;
    const self = anc[anc.length - 1];
    // przodkowie: pokazujemy początek i koniec linii, środek skracamy
    let shown: (LineageTreeNode | null)[] = anc.slice(0, -1);
    if (shown.length > 16) shown = [...shown.slice(0, 3), null, ...shown.slice(-11)];
    const kids = new Map<number, LineageTreeNode[]>();
    for (const d of data.descendants) {
      const arr = kids.get(d.parentId ?? -1) ?? [];
      arr.push(d);
      kids.set(d.parentId ?? -1, arr);
    }
    const placed: Laid[] = [];
    let row = 0;
    const walk = (n: LineageTreeNode, depth: number): number => {
      const ch = kids.get(n.id) ?? [];
      let y: number;
      if (!ch.length) y = row++ * DY;
      else {
        const ys = ch.map((c) => walk(c, depth + 1));
        y = (ys[0] + ys[ys.length - 1]) / 2;
      }
      placed.push({ node: n, x: (shown.length + depth) * DX + 12, y: y + 12 });
      return y;
    };
    const selY = walk(self, 0);
    const ancPlaced: (Laid | null)[] = shown.map((n, i) => (n ? { node: n, x: i * DX + 12, y: selY + 12 } : null));
    const maxX = Math.max(...placed.map((p) => p.x), 40) + 20;
    return { placed, ancPlaced, selY: selY + 12, height: Math.max(row * DY + 24, 60), width: maxX };
  }, [data]);

  const edge = (a: Laid, b: Laid, k: string) => <path key={k} d={`M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`} fill="none" stroke="var(--line-strong)" strokeWidth={1} />;
  const byId = new Map(layout.placed.map((p) => [p.node.id, p]));
  const circle = (l: Laid) => {
    const n = l.node;
    const r = 3.5 + Math.min(5, Math.sqrt(n.offspring));
    const sel = n.id === selectedId;
    return (
      <g key={n.id} onClick={() => onPick(n.id)} style={{ cursor: 'pointer' }}>
        <circle cx={l.x} cy={l.y} r={r} fill={n.alive ? 'var(--accent)' : '#4a5a66'} stroke={sel ? '#fff' : 'none'} strokeWidth={1.6} opacity={n.alive ? 1 : 0.8} />
        <title>{`#${n.id} · pokolenie ${n.generation}\nnarodziny: ${n.birthTick}${n.deathTick !== null ? `\nśmierć: ${n.deathTick}` : '\nżyje'}\npotomstwo: ${n.offspring}`}</title>
      </g>
    );
  };
  return (
    <div className="tree-scroll">
      <svg width={layout.width} height={layout.height}>
        {layout.ancPlaced.map((a, i) => {
          if (!a) return null;
          const next = layout.ancPlaced[i + 1];
          if (next) return edge(a, next, `ae${i}`);
          const self = byId.get(selectedId);
          return self ? edge(a, self, `ae${i}`) : null;
        })}
        {layout.ancPlaced.map((a, i) =>
          a ? (
            circle(a)
          ) : (
            <text key={`gap${i}`} x={i * 26 + 12} y={layout.selY + 4} fill="var(--dim)" textAnchor="middle" fontSize="11">
              ⋯
            </text>
          ),
        )}
        {layout.placed.map((p) => {
          const par = p.node.parentId !== null ? byId.get(p.node.parentId) : undefined;
          return par ? edge(par, p, `de${p.node.id}`) : null;
        })}
        {layout.placed.map((p) => circle(p))}
      </svg>
    </div>
  );
}

export function Genealogy({ client }: { client: WorldClient }) {
  useManager();
  const id = client.selectedId;
  const [data, setData] = useState<LineageResult | null>(null);
  const [cmp, setCmp] = useState<CompareResult | null>(null);
  const [ancIdx, setAncIdx] = useState(0);

  useInterval(
    async () => {
      if (id === null) return;
      const r = await client.lineage(id);
      setData(r);
    },
    3000,
    id !== null,
    id,
  );
  useEffect(() => {
    setData(null);
    setCmp(null);
    setAncIdx(0);
  }, [id]);

  const mine = data && data.ancestors[data.ancestors.length - 1]?.id === id ? data : null;

  useEffect(() => {
    if (!mine || id === null) return;
    const a = mine.ancestors[Math.min(ancIdx, mine.ancestors.length - 1)];
    if (!a) return;
    let alive = true;
    void client.compare(a.id, id).then((r) => alive && setCmp(r));
    return () => {
      alive = false;
    };
  }, [mine, ancIdx, id, client]);

  if (id === null)
    return (
      <div className="panel-body">
        <div className="placeholder">
          <h3>Genealogia</h3>
          <p>Zaznacz organizm, aby prześledzić jego pochodzenie aż do założycieli populacji oraz zbadać potomków.</p>
        </div>
      </div>
    );
  if (!mine) return <div className="panel-body"><div className="placeholder">Odtwarzanie rodowodu #{id}…</div></div>;

  const anc = mine.ancestors;
  const self = anc[anc.length - 1];
  const root = anc[0];
  const series = TRAIT_NAMES.filter((t) => t !== 'hue').map((t) => ({ t, vals: anc.map((a) => a.traits[TRAIT_NAMES.indexOf(t)]) }));
  const ai = Math.min(ancIdx, anc.length - 1);

  return (
    <div className="panel-body">
      <section className="card">
        <header>
          <h4>Rodowód #{id}</h4>
          <span className="hint">pokolenie {self.generation}</span>
        </header>
        <div className="kv">
          <span>Przodków do założyciela</span>
          <b>{anc.length - 1}</b>
          <span>Założyciel</span>
          <b>
            <a onClick={() => client.select(root.id)}>#{root.id}</a>
          </b>
          <span>Potomków żywych</span>
          <b>{fmt.int(mine.livingDescendants)}</b>
          <span>Potomstwo bezpośrednie</span>
          <b>{self.offspring}</b>
          <span>Zmian genów względem rodzica</span>
          <b>{self.mutations}</b>
          {self.parent2Id !== null && (
            <>
              <span>Drugi rodzic (rozmnażanie płciowe)</span>
              <b>
                <a onClick={() => client.select(self.parent2Id!)}>#{self.parent2Id}</a>
              </b>
            </>
          )}
        </div>
        <p className="note">
          Drzewo zawiera tylko to, co jest jeszcze w pamięci: martwe linie bez żyjących potomków są przycinane po okresie retencji, a długie łańcuchy
          przodków bez rozgałęzień są scalane (pominięte pokolenia). Przodkowie żywych organizmów nigdy nie znikają. W rozmnażaniu płciowym drzewo biegnie wzdłuż pierwszego rodzica.
        </p>
      </section>

      <section className="card">
        <header>
          <h4>Drzewo</h4>
          <span className="hint">
            ● żywy · ● zmarły · rozmiar ~ potomstwo{mine.descendantsTruncated ? ' · potomkowie skrócone' : ''}
          </span>
        </header>
        <TreeView data={mine} selectedId={id} onPick={(pid) => client.select(pid)} />
      </section>

      <section className="card">
        <header>
          <h4>Cechy wzdłuż linii przodków</h4>
          <span className="hint">od założyciela (lewo) do wybranego organizmu (prawo)</span>
        </header>
        <div className="sparks">
          {series.map((s) => (
            <Spark key={s.t} values={s.vals} color={TRAIT_COLORS[s.t]} label={TRAIT_LABELS[s.t]} />
          ))}
        </div>
      </section>

      <section className="card">
        <header>
          <h4>Porównanie z przodkiem</h4>
          <span className="hint">genomy odtwarzane z rejestru mutacji</span>
        </header>
        <label className="slider-row">
          <span>
            Przodek: pokolenie {anc[ai].generation} (#{anc[ai].id})
          </span>
          <input type="range" min={0} max={anc.length - 1} step={1} value={ai} onChange={(e) => setAncIdx(Number(e.target.value))} />
        </label>
        {cmp && cmp.a && cmp.b && cmp.traitDelta.length > 0 ? (
          <>
            <div className="kv">
              <span>Pokoleń między</span>
              <b>{cmp.generationsBetween ?? '–'}</b>
              <span>Zmian genów po drodze</span>
              <b>{cmp.mutationsBetween ?? '–'}</b>
              <span>Odległość cech</span>
              <b>{cmp.traitDistance.toFixed(3)}</b>
              <span>Odległość wag mózgu</span>
              <b>{cmp.weightDistance.toFixed(3)}</b>
            </div>
            <div className="deltas">
              {TRAIT_NAMES.filter((t) => t !== 'hue').map((t) => {
                const k = TRAIT_NAMES.indexOf(t);
                const d = cmp.traitDelta[k];
                return (
                  <div key={t} className="delta-row">
                    <span>{TRAIT_LABELS[t]}</span>
                    <div className="delta-bar">
                      <i style={{ left: d >= 0 ? '50%' : `${50 + d * 50}%`, width: `${Math.abs(d) * 50}%`, background: d >= 0 ? 'var(--good)' : 'var(--bad)' }} />
                    </div>
                    <b>
                      {cmp.a!.traits[k].toFixed(2)} → {cmp.b!.traits[k].toFixed(2)}
                    </b>
                  </div>
                );
              })}
            </div>
            {cmp.genomeA && cmp.genomeB && (
              <>
                <div className="strip-label">przodek</div>
                <GenomeStrip genome={cmp.genomeA} against={cmp.genomeB} />
                <div className="strip-label">wybrany organizm</div>
                <GenomeStrip genome={cmp.genomeB} against={cmp.genomeA} />
              </>
            )}
            {cmp.changedWeights.length > 0 && (
              <>
                <div className="strip-label">największe zmiany wag mózgu</div>
                <table className="mini">
                  <tbody>
                    {cmp.changedWeights.map((w) => (
                      <tr key={w.gene}>
                        <td>{describeGene(w.gene)}</td>
                        <td>
                          {w.from.toFixed(2)} → <b>{w.to.toFixed(2)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        ) : (
          <div className="chart-empty">Obliczanie…</div>
        )}
      </section>
    </div>
  );
}
