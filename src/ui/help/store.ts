import { useSyncExternalStore } from 'react';

/** Stan jednego, globalnego dymku pomocy. */
export interface HelpState {
  openId: string | null;
  anchor: { x: number; y: number; w: number; h: number } | null;
  pinned: boolean;
}

type Listener = () => void;

class HelpStore {
  state: HelpState = { openId: null, anchor: null, pinned: false };
  private listeners = new Set<Listener>();
  private version = 0;
  private closeTimer = 0;
  private openTimer = 0;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = (): number => this.version;
  private emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  private rect(el: Element): HelpState['anchor'] {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  /** hover/focus: otwiera z niewielkim opóźnieniem (nie miga przy przejeżdżaniu myszą) */
  hoverOpen(id: string, el: Element): void {
    window.clearTimeout(this.closeTimer);
    window.clearTimeout(this.openTimer);
    const anchor = this.rect(el);
    this.openTimer = window.setTimeout(() => {
      if (this.state.pinned && this.state.openId !== id) return;
      this.state = { openId: id, anchor, pinned: this.state.pinned && this.state.openId === id };
      this.emit();
    }, this.state.openId ? 0 : 140);
  }

  hoverClose(): void {
    window.clearTimeout(this.openTimer);
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      if (this.state.pinned) return;
      this.state = { openId: null, anchor: null, pinned: false };
      this.emit();
    }, 180);
  }

  keepOpen(): void {
    window.clearTimeout(this.closeTimer);
  }

  togglePin(id: string, el: Element): void {
    window.clearTimeout(this.closeTimer);
    window.clearTimeout(this.openTimer);
    if (this.state.pinned && this.state.openId === id) this.close();
    else {
      this.state = { openId: id, anchor: this.rect(el), pinned: true };
      this.emit();
    }
  }

  /** przełącza dymek na inny wpis (np. z listy „zobacz też”), zachowując przypięcie */
  goto(id: string): void {
    this.state = { ...this.state, openId: id, pinned: true };
    this.emit();
  }

  close(): void {
    window.clearTimeout(this.openTimer);
    window.clearTimeout(this.closeTimer);
    if (this.state.openId === null) return;
    this.state = { openId: null, anchor: null, pinned: false };
    this.emit();
  }
}

export const helpStore = new HelpStore();

export function useHelpState(): HelpState {
  useSyncExternalStore(helpStore.subscribe, helpStore.getVersion);
  return helpStore.state;
}

// ——— magistrala poleceń interfejsu (pomoc/lekcje → App) ———

export type UiRequest =
  | { type: 'glossary'; id?: string }
  | { type: 'learn'; tab: 'start' | 'lessons' | 'glossary'; lessonId?: string }
  | { type: 'tab'; side: 'left' | 'right'; tab: string }
  | { type: 'welcome' };

type UiHandler = (r: UiRequest) => void;
let handler: UiHandler | null = null;

export const uiBus = {
  set(h: UiHandler | null): void {
    handler = h;
  },
  send(r: UiRequest): void {
    handler?.(r);
  },
};
