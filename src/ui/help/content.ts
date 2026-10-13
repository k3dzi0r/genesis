import { ANALYSIS } from './analysis';
import { CONCEPTS } from './concepts';
import { INTERFACE } from './interface';
import { DEVELOPMENTS } from './developments';
import { PARAMS } from './params';
import type { HelpEntry, HelpMap } from './types';

/** Wszystkie wpisy pomocy (dymki „?”, słownik). Spójność pilnuje tests/help.test.ts. */
export const HELP: HelpMap = { ...CONCEPTS, ...PARAMS, ...ANALYSIS, ...INTERFACE, ...DEVELOPMENTS };

export const HELP_PARTS = { CONCEPTS, PARAMS, ANALYSIS, INTERFACE, DEVELOPMENTS };

/** Wpisy do słownika (bez pojedynczych grup parametrów), posortowane alfabetycznie po polsku. */
export function glossaryEntries(): [string, HelpEntry][] {
  return Object.entries(HELP)
    .filter(([, e]) => e.glossary !== false)
    .sort((a, b) => a[1].title.localeCompare(b[1].title, 'pl'));
}

/** Wpisy z ciekawostką (do losowania na ekranie Start). */
export function funFacts(): [string, HelpEntry][] {
  return Object.entries(HELP).filter(([, e]) => !!e.fun);
}
