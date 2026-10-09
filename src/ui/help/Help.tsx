import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HELP } from './content';
import { helpStore, uiBus, useHelpState } from './store';

/** Mały przycisk „?”: hover/focus pokazuje skrót, klik przypina dymek z pełnym opisem. */
export function Help({ id, className = '' }: { id: string; className?: string }) {
  const entry = HELP[id];
  if (!entry) {
    if (import.meta.env?.DEV) console.warn(`[help] brak wpisu: ${id}`);
    return null;
  }
  return (
    <button
      type="button"
      className={`help-btn ${className}`}
      aria-label={`Wyjaśnienie: ${entry.title}`}
      aria-haspopup="dialog"
      data-help={id}
      onMouseEnter={(e) => helpStore.hoverOpen(id, e.currentTarget)}
      onMouseLeave={() => helpStore.hoverClose()}
      onFocus={(e) => helpStore.hoverOpen(id, e.currentTarget)}
      onBlur={() => helpStore.hoverClose()}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        helpStore.togglePin(id, e.currentTarget);
      }}
    >
      ?
    </button>
  );
}

const MAX_W = 360;

/** Jedna instancja dymka na całą aplikację (renderowana w App). */
export function HelpPopover() {
  const st = useHelpState();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number; w: number } | null>(null);
  const entry = st.openId ? HELP[st.openId] : null;

  useLayoutEffect(() => {
    if (!st.anchor || !ref.current) {
      setPos(null);
      return;
    }
    const a = st.anchor;
    const h = ref.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 10;
    const W = Math.min(MAX_W, vw - 2 * margin);
    let left = a.x + a.w / 2 - W / 2;
    left = Math.max(margin, Math.min(vw - W - margin, left));
    const spaceBelow = vh - (a.y + a.h) - margin;
    const spaceAbove = a.y - margin;
    let top: number;
    let maxH: number;
    if (h <= spaceBelow || spaceBelow >= spaceAbove) {
      top = a.y + a.h + 6;
      maxH = Math.max(160, spaceBelow - 6);
    } else {
      maxH = Math.max(160, spaceAbove - 6);
      top = Math.max(margin, a.y - 6 - Math.min(h, maxH));
    }
    setPos({ left, top, maxH, w: W });
  }, [st.anchor, st.openId, st.pinned]);

  // zamykanie: Escape, klik poza dymkiem, przewijanie przy dymku niepinowanym
  useEffect(() => {
    if (!st.openId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && helpStore.close();
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest?.('.help-btn')) return;
      helpStore.close();
    };
    const onScroll = () => {
      if (!helpStore.state.pinned) helpStore.close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [st.openId]);

  if (!entry || !st.openId) return null;
  const id = st.openId;
  const expandable = !!(entry.more?.length || entry.fun || entry.try || entry.see?.length);
  const full = st.pinned;
  return (
    <div
      ref={ref}
      className={`help-pop ${full ? 'pinned' : ''}`}
      role="dialog"
      aria-label={entry.title}
      style={{ width: pos?.w ?? MAX_W, left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: pos?.maxH, visibility: pos ? 'visible' : 'hidden' }}
      onMouseEnter={() => helpStore.keepOpen()}
      onMouseLeave={() => helpStore.hoverClose()}
    >
      <div className="help-pop-head">
        <b>{entry.title}</b>
        <small>{entry.group}</small>
        {full && (
          <button className="help-x" aria-label="Zamknij" onClick={() => helpStore.close()}>
            ✕
          </button>
        )}
      </div>
      <p className="help-short">{entry.short}</p>
      {full && entry.more?.map((p, i) => (
        <p key={i} className="help-more">
          {p}
        </p>
      ))}
      {full && entry.try && (
        <p className="help-try">
          <b>Spróbuj:</b> {entry.try}
        </p>
      )}
      {full && entry.fun && (
        <p className="help-fun">
          <b>💡 Ciekawostka</b>
          {entry.fun}
        </p>
      )}
      {full && entry.see && entry.see.length > 0 && (
        <div className="help-see">
          <span>Zobacz też:</span>
          {entry.see
            .filter((s) => HELP[s])
            .map((s) => (
              <button key={s} onClick={() => helpStore.goto(s)}>
                {HELP[s].title}
              </button>
            ))}
        </div>
      )}
      {full && (
        <div className="help-foot">
          <button
            onClick={() => {
              helpStore.close();
              uiBus.send({ type: 'glossary', id });
            }}
          >
            Otwórz w słowniku →
          </button>
        </div>
      )}
      {!full && expandable && <p className="help-hint">Kliknij „?”, aby przypiąć i zobaczyć więcej{entry.fun ? ' (jest ciekawostka)' : ''}.</p>}
    </div>
  );
}
