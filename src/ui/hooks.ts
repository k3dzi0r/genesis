import { useEffect, useRef, useSyncExternalStore } from 'react';
import { manager, type WorldClient } from './client';

/** Odświeża komponent przy każdej zmianie w menedżerze lub aktywnym świecie (~4 Hz). */
export function useManager() {
  useSyncExternalStore(manager.subscribe, manager.getVersion);
  return manager;
}

export function useActive(): WorldClient | null {
  useManager();
  return manager.active;
}

/** Wywołuje `fn` co `ms` ms, dopóki `active`. */
export function useInterval(fn: () => void, ms: number, active = true, key: unknown = null): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    ref.current();
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms, active, key]);
}

export const fmt = {
  int: (n: number) => Math.round(n).toLocaleString('pl-PL'),
  f1: (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '–'),
  f2: (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '–'),
  f3: (n: number) => (Number.isFinite(n) ? n.toFixed(3) : '–'),
  pct: (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : '–'),
  big: (n: number) => {
    if (!Number.isFinite(n)) return '–';
    const a = Math.abs(n);
    if (a >= 1e9) return `${(n / 1e9).toFixed(2)} mld`;
    if (a >= 1e6) return `${(n / 1e6).toFixed(2)} mln`;
    if (a >= 1e4) return `${(n / 1e3).toFixed(1)} tys.`;
    return Math.round(n).toLocaleString('pl-PL');
  },
};
