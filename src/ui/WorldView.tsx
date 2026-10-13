import { useCallback, useEffect, useRef, useState } from 'react';
import { GlRenderer, type ViewState } from '../render/glRenderer';
import type { FrameMsg, ColorMode } from '../worker/protocol';
import type { WorldClient } from './client';
import { Help } from './help/Help';
import { useManager } from './hooks';

const COLOR_MODES: { id: ColorMode; label: string; hint: string }[] = [
  { id: 'lineage', label: 'Linia', hint: 'Barwa neutralnego znacznika dziedziczonego — spokrewnione organizmy mają podobny kolor' },
  { id: 'strategy', label: 'Strategia', hint: 'R = prędkość, G = zasięg sensorów, B = rozmiar' },
  { id: 'energy', label: 'Energia', hint: 'Czerwony = głodny, zielony = syty' },
  { id: 'generation', label: 'Pokolenie', hint: 'Starsze pokolenia: fiolet/niebieski, najmłodsze: czerwony' },
  { id: 'age', label: 'Wiek', hint: 'Zielony = młody, czerwony = bliski końca życia' },
  { id: 'diet', label: 'Dieta', hint: 'Zielony = roślinożerca, czerwony = drapieżnik' },
  { id: 'signal', label: 'Sygnał', hint: 'Niebieski = sygnał dodatni, różowy = ujemny; znaczenie sygnału nie jest zaprogramowane' },
  { id: 'specialization', label: 'Pokarm A/B', hint: 'Turkus = specjalizacja A, bursztyn = specjalizacja B' },
  { id: 'clade', label: 'Klad', hint: 'Każdy założyciel ma własny kolor — widać, czyje potomstwo przetrwało' },
];

interface Local {
  view: ViewState;
  fitted: number;
  pending: FrameMsg | null;
  last: FrameMsg | null;
  raf: number;
  traj: { x: number; y: number }[];
  trajId: number | null;
  dragging: boolean;
  moved: boolean;
  sx: number;
  sy: number;
  vx: number;
  vy: number;
}

export function WorldView({ client }: { client: WorldClient }) {
  useManager();
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const rend = useRef<GlRenderer | null>(null);
  const L = useRef<Local>({
    view: { cx: 400, cy: 400, zoom: 1 }, fitted: 1, pending: null, last: null, raf: 0, traj: [], trajId: null,
    dragging: false, moved: false, sx: 0, sy: 0, vx: 0, vy: 0,
  });
  const [showFood, setShowFood] = useState(true);
  const [showTraj, setShowTraj] = useState(true);
  const [follow, setFollow] = useState(false);
  const [showDensity, setShowDensity] = useState(false);
  const [showSignals, setShowSignals] = useState(true);
  const [showNiche, setShowNiche] = useState(false);
  const [environmentMap,setEnvironmentMap] = useState<'none'|'biome'|'temperature'>('none');
  const [err, setErr] = useState<string | null>(null);
  const opts = useRef({ showFood, showTraj, follow, showDensity, showSignals, showNiche, environmentMap });
  opts.current = { showFood, showTraj, follow, showDensity, showSignals, showNiche, environmentMap };

  const size = () => {
    const b = boxRef.current!;
    return { w: b.clientWidth, h: b.clientHeight };
  };

  const draw = useCallback(() => {
    const r = rend.current;
    const st = L.current;
    if (!r || !client.setup) return;
    const { w, h } = size();
    const dpr = window.devicePixelRatio || 1;
    if (st.pending) {
      if (st.pending.fert) r.setFert(st.pending.fert);
      r.setOrganisms(st.pending.data, st.pending.n);
      r.setFood(st.pending.food);
      const empty = new Uint8Array(st.pending.food.length);
      r.setLayers(st.pending.foodB ?? empty, st.pending.obstacles ?? empty, st.pending.niche ?? empty);
      r.setEnvironment(st.pending.biome ?? empty, st.pending.localTemperature ?? new Float32Array(empty.length));
      st.last = st.pending;
      st.pending = null;
      client.ack();
    }
    const f = st.last;
    if (f?.selected && opts.current.follow) {
      st.view.cx += (f.selected.x - st.view.cx) * 0.25;
      st.view.cy += (f.selected.y - st.view.cy) * 0.25;
    }
    r.render(st.view, w, h, dpr, { showFood: opts.current.showFood, showNiche: opts.current.showNiche, environmentMap: opts.current.environmentMap, sensors: client.view.sensors, energy: client.view.energy });

    // — nakładka 2D —
    const ov = ovRef.current!;
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (ov.width !== W || ov.height !== H) {
      ov.width = W;
      ov.height = H;
    }
    const c = ov.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const z = st.view.zoom;
    const toX = (x: number) => (x - st.view.cx) * z + w / 2;
    const toY = (y: number) => (y - st.view.cy) * z + h / 2;
    if (opts.current.showDensity && f && f.n > 0) {
      const B = 24;
      const nx = Math.ceil((client.setup?.width ?? 800) / B);
      const ny = Math.ceil((client.setup?.height ?? 800) / B);
      const bins = new Uint16Array(nx * ny);
      let mx = 1;
      for (let i = 0; i < f.n; i++) {
        const bx = Math.min(nx - 1, (f.data[i * 8] / B) | 0);
        const by = Math.min(ny - 1, (f.data[i * 8 + 1] / B) | 0);
        const v = ++bins[by * nx + bx];
        if (v > mx) mx = v;
      }
      for (let by = 0; by < ny; by++)
        for (let bx = 0; bx < nx; bx++) {
          const v = bins[by * nx + bx];
          if (!v) continue;
          const a = Math.min(0.65, 0.12 + (v / mx) * 0.55);
          c.fillStyle = `rgba(255,170,60,${a})`;
          c.fillRect(toX(bx * B), toY(by * B), B * z + 0.5, B * z + 0.5);
        }
    }
    if (opts.current.showSignals && f?.signals) {
      for (let i = 0; i < f.n; i++) {
        const signal = f.signals[i], amplitude = Math.abs(signal); if (amplitude < 0.08) continue;
        c.strokeStyle = signal >= 0 ? `rgba(100,170,255,${Math.min(0.7, amplitude * 0.7)})` : `rgba(255,120,190,${Math.min(0.7, amplitude * 0.7)})`; c.lineWidth = 1.5;
        c.beginPath(); c.arc(toX(f.data[i * 8]), toY(f.data[i * 8 + 1]), Math.max(3, (f.data[i * 8 + 2] + 6 * amplitude) * z), 0, Math.PI * 2); c.stroke();
      }
    }
    const sel = f?.selected;
    if (sel) {
      if (st.trajId !== sel.id) {
        st.trajId = sel.id;
        st.traj = [];
      }
      const lastP = st.traj[st.traj.length - 1];
      if (!lastP || Math.abs(lastP.x - sel.x) + Math.abs(lastP.y - sel.y) > 0.5) {
        st.traj.push({ x: sel.x, y: sel.y });
        if (st.traj.length > 700) st.traj.shift();
      }
      if (opts.current.showTraj && st.traj.length > 1) {
        for (let i = 1; i < st.traj.length; i++) {
          c.strokeStyle = `rgba(255,214,110,${(i / st.traj.length) * 0.85})`;
          c.lineWidth = 1.4;
          c.beginPath();
          c.moveTo(toX(st.traj[i - 1].x), toY(st.traj[i - 1].y));
          c.lineTo(toX(st.traj[i].x), toY(st.traj[i].y));
          c.stroke();
        }
      }
      const sx = toX(sel.x);
      const sy = toY(sel.y);
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(sx, sy, Math.max(sel.radius * z, 3) + 5, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([4, 5]);
      c.strokeStyle = 'rgba(100,230,210,0.55)';
      c.beginPath();
      const halfField = Math.acos(Math.max(-1, Math.min(1, client.info?.params.viewCos ?? -1)));
      const heading = Math.atan2(sel.hy, sel.hx);
      c.arc(sx, sy, sel.sense * z, heading - halfField, heading + halfField);
      if (halfField < Math.PI) { c.lineTo(sx, sy); c.closePath(); }
      c.stroke();
      c.setLineDash([]);
      c.strokeStyle = 'rgba(100,230,210,0.9)';
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(sx + sel.hx * sel.sense * z * 0.5, sy + sel.hy * sel.sense * z * 0.5);
      c.stroke();
    } else if (st.trajId !== null) {
      st.trajId = null;
      st.traj = [];
    }
    // skala
    const target = 100 / z;
    const mag = Math.pow(10, Math.floor(Math.log10(target)));
    const unit = [1, 2, 5, 10].map((k) => k * mag).find((u) => u >= target * 0.6) ?? mag * 10;
    c.fillStyle = 'rgba(180,205,220,0.75)';
    c.font = '10px ui-monospace, Menlo, monospace';
    c.fillRect(14, h - 22, unit * z, 1.5);
    c.fillText(`${unit} j.`, 14, h - 28);
  }, [client]);

  const schedule = useCallback(() => {
    const st = L.current;
    if (st.raf) return;
    st.raf = requestAnimationFrame(() => {
      st.raf = 0;
      draw();
    });
  }, [draw]);

  const fit = useCallback(() => {
    if (!client.setup) return;
    const { w, h } = size();
    const z = Math.min(w / client.setup.width, h / client.setup.height) * 0.96;
    L.current.view = { cx: client.setup.width / 2, cy: client.setup.height / 2, zoom: z };
    L.current.fitted = z;
    schedule();
  }, [client, schedule]);

  // inicjalizacja renderera
  useEffect(() => {
    try {
      rend.current = new GlRenderer(glRef.current!);
    } catch (e) {
      setErr(String(e));
      return;
    }
    const unsub = client.onFrame((f) => {
      L.current.pending = f;
      schedule();
    });
    const ro = new ResizeObserver(() => schedule());
    ro.observe(boxRef.current!);
    return () => {
      unsub();
      ro.disconnect();
      cancelAnimationFrame(L.current.raf);
      L.current.raf = 0;
      rend.current?.dispose();
      rend.current = null;
    };
  }, [client, schedule]);

  // nowy świat / wczytanie → ustaw siatkę i kamerę
  useEffect(() => {
    if (!client.ready || !client.setup || !rend.current) return;
    rend.current.setWorld(client.setup.width, client.setup.height, client.grid.nx, client.grid.ny, client.grid.fert);
    L.current.last = null;
    L.current.pending = null;
    L.current.traj = []; L.current.trajId = null;
    fit();
  }, [client, client.worldEpoch, client.ready, fit]);

  useEffect(() => { const state = L.current; state.traj = []; state.trajId = null; state.last = null; if (state.pending) { state.pending = null; client.ack(); } rend.current?.setOrganisms(new Float32Array(0), 0); client.setView({}); schedule(); }, [client.historyEpoch, client, schedule]);

  useEffect(() => {
    schedule();
  }, [showFood, showTraj, follow, showDensity, showSignals, showNiche, environmentMap, client.view, schedule]);

  // — interakcje —
  const onPointerDown = (e: React.PointerEvent) => {
    const st = L.current;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    st.dragging = true;
    st.moved = false;
    st.sx = e.clientX;
    st.sy = e.clientY;
    st.vx = st.view.cx;
    st.vy = st.view.cy;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const st = L.current;
    if (!st.dragging) return;
    const dx = e.clientX - st.sx;
    const dy = e.clientY - st.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) st.moved = true;
    if (st.moved) {
      st.view.cx = st.vx - dx / st.view.zoom;
      st.view.cy = st.vy - dy / st.view.zoom;
      if (opts.current.follow) setFollow(false);
      schedule();
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const st = L.current;
    st.dragging = false;
    if (st.moved) return;
    const rect = boxRef.current!.getBoundingClientRect();
    const { w, h } = size();
    const wx = (e.clientX - rect.left - w / 2) / st.view.zoom + st.view.cx;
    const wy = (e.clientY - rect.top - h / 2) / st.view.zoom + st.view.cy;
    const f = st.last;
    if (!f) return;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < f.n; i++) {
      const dx = f.data[i * 8] - wx;
      const dy = f.data[i * 8 + 1] - wy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const lim = Math.max(f.data[i * 8 + 2], 12 / st.view.zoom);
      if (d < lim && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    client.select(best >= 0 ? f.ids[best] : null);
  };
  const onWheel = (e: React.WheelEvent) => {
    const st = L.current;
    const rect = boxRef.current!.getBoundingClientRect();
    const { w, h } = size();
    const mx = e.clientX - rect.left - w / 2;
    const my = e.clientY - rect.top - h / 2;
    const wx = mx / st.view.zoom + st.view.cx;
    const wy = my / st.view.zoom + st.view.cy;
    const nz = Math.min(60, Math.max(st.fitted * 0.5, st.view.zoom * Math.exp(-e.deltaY * 0.0015)));
    st.view.zoom = nz;
    st.view.cx = wx - mx / nz;
    st.view.cy = wy - my / nz;
    schedule();
  };
  // wheel jako listener nie-pasywny, by zablokować przewijanie strony
  useEffect(() => {
    const el = boxRef.current!;
    const h = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  const info = client.info;
  const chip = (on: boolean, label: string, set: () => void, title?: string) => (
    <button className={`chip ${on ? 'on' : ''}`} onClick={set} title={title}>
      {label}
    </button>
  );

  return (
    <div className="worldview" ref={boxRef}>
      {err ? (
        <div className="empty">Nie można uruchomić renderera: {err}</div>
      ) : (
        <>
          <canvas ref={glRef} className="gl" />
          <canvas
            ref={ovRef}
            className="ov"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
          />
        </>
      )}
      <div className="hud tl">
        {chip(showFood, 'Zasoby', () => setShowFood(!showFood), 'Turkus = pokarm A, bursztyn = pokarm B; jaśniej = więcej zasobów')}
        {chip(client.view.sensors, 'Sensory', () => client.setView({ sensors: !client.view.sensors }), 'Zasięg sensorów wszystkich organizmów')}
        {chip(client.view.energy, 'Energia', () => client.setView({ energy: !client.view.energy }), 'Jasny rdzeń proporcjonalny do energii')}
        {chip(showSignals, 'Sygnały', () => setShowSignals(!showSignals), 'Niebieski dodatni / różowy ujemny sygnał; znakom nie przypisano znaczenia')}
        {chip(showNiche, 'Nisza', () => setShowNiche(!showNiche), 'Fiolet = zmiana żyzności przez kultywację')}
        {chip(showTraj, 'Ślad', () => setShowTraj(!showTraj), 'Trajektoria zaznaczonego organizmu')}
        {chip(showDensity, 'Gęstość', () => setShowDensity(!showDensity), 'Mapa cieplna zagęszczenia organizmów')}
        {chip(follow, 'Podążaj', () => setFollow(!follow), 'Kamera śledzi zaznaczony organizm')}
        <button className="chip" onClick={fit} title="Dopasuj widok do świata">
          ⌖
        </button>
        <Help id="ui.overlays" className="hud-help" />
      </div>
      <div className="hud tr">
        <label className="select-wrap"><span>Mapa</span><select value={environmentMap} onChange={e=>setEnvironmentMap(e.target.value as typeof environmentMap)}><option value="none">Zasoby</option><option value="biome">Biomy</option><option value="temperature">Temperatura</option></select></label>
        <label className="select-wrap" title={COLOR_MODES.find((m) => m.id === client.view.colorMode)?.hint}>
          <span>Kolor</span>
          <select value={client.view.colorMode} onChange={(e) => client.setView({ colorMode: e.target.value as ColorMode })}>
            {COLOR_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <Help id="ui.color" className="hud-help" />
      </div>
      {info?.status === 'extinct' && (
        <div className="banner extinct">
          <b>WYMARCIE</b>
          <span>Populacja wymarła w ticku {info.tick.toLocaleString('pl-PL')}. Zresetuj lub rozwidl wcześniejszy zapis.</span>
        </div>
      )}
      <div className="hud bl">
        <span className="world-legend">{environmentMap==='biome' ? `Umiarkowany · zielony / chłodny · niebieski / ciepły · pomarańczowy${(info?.params.biomes??0)<0.5?' · moduł wyłączony':''}` : environmentMap==='temperature' ? 'Temperatura: niebieski 0 → czerwony 1,2 · względna skala modelu' : 'A · turkus / B · bursztyn / bariery · szare'}</span>
        <Help id="ui.world" className="hud-help" />
      </div>
      {!client.ready && <div className="empty">Inicjalizacja świata…</div>}
    </div>
  );
}
