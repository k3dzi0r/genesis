import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, DEFAULT_SETUP, PARAM_META } from '../src/engine/config';
import { INPUT_LABELS, OUTPUT_LABELS, TRAIT_NAMES } from '../src/engine/constants';
import { HELP, HELP_PARTS, funFacts, glossaryEntries } from '../src/ui/help/content';
import { LESSONS } from '../src/ui/help/lessons';
import { HELP_GROUPS } from '../src/ui/help/types';
import { PRESETS } from '../src/ui/presets';

describe('system pomocy edukacyjnej', () => {
  it('każdy parametr, grupa parametrów i cecha genomu ma wyjaśnienie', () => {
    for (const k of Object.keys(PARAM_META)) expect(HELP[`param.${k}`], `brak param.${k}`).toBeTruthy();
    for (const g of new Set(Object.values(PARAM_META).map((m) => m.group))) expect(HELP[`group.${g}`], `brak group.${g}`).toBeTruthy();
    for (const t of TRAIT_NAMES) expect(HELP[`trait.${t}`], `brak trait.${t}`).toBeTruthy();
  });

  it('wszystkie kanały sieci i nowe scenariusze mają treść', () => {
    INPUT_LABELS.forEach((_, i) => expect(HELP[`input.${i}`]).toBeTruthy());
    OUTPUT_LABELS.forEach((_, i) => expect(HELP[`output.${i}`]).toBeTruthy());
    for (const id of ['integrated', 'two-foods', 'perception', 'communication', 'speciation', 'learning', 'cultivation']) expect(PRESETS.some((p) => p.id === id)).toBe(true);
  });

  it('klucze są unikalne w całym zbiorze (żaden wpis nie nadpisuje innego)', () => {
    const seen = new Map<string, string>();
    for (const [part, map] of Object.entries(HELP_PARTS))
      for (const k of Object.keys(map)) {
        expect(seen.has(k), `klucz „${k}” występuje w ${seen.get(k)} i ${part}`).toBe(false);
        seen.set(k, part);
      }
    expect(Object.keys(HELP).length).toBe(seen.size);
  });

  it('powiązania „zobacz też” wskazują istniejące wpisy', () => {
    for (const [id, e] of Object.entries(HELP)) for (const s of e.see ?? []) expect(HELP[s], `${id} → brak ${s}`).toBeTruthy();
  });

  it('wpisy mają sensowną budowę: tytuł, skrót w rozsądnej długości, znany dział', () => {
    for (const [id, e] of Object.entries(HELP)) {
      expect(e.title.trim().length, id).toBeGreaterThan(2);
      expect(e.short.length, `${id}: za krótki skrót`).toBeGreaterThanOrEqual(25);
      expect(e.short.length, `${id}: za długi skrót (dymek)`).toBeLessThanOrEqual(420);
      expect(HELP_GROUPS, id).toContain(e.group);
      for (const p of e.more ?? []) expect(p.trim().length, id).toBeGreaterThan(20);
      if (e.fun !== undefined) expect(e.fun.trim().length, id).toBeGreaterThan(20);
    }
  });

  it('w treściach nie zostały sformułowania w pierwszej osobie ani niedokończone fragmenty', () => {
    const bad = /\b(w moich|w moim|u mnie|TODO|XXX|FIXME)\b/i;
    for (const [id, e] of Object.entries(HELP)) {
      const text = [e.title, e.short, ...(e.more ?? []), e.fun ?? '', e.try ?? ''].join(' ');
      expect(bad.test(text), `${id}: „${text.match(bad)?.[0]}”`).toBe(false);
    }
  });

  it('słownik i ciekawostki nie są puste', () => {
    expect(glossaryEntries().length).toBeGreaterThan(80);
    expect(funFacts().length).toBeGreaterThan(25);
  });

  it('lekcje: unikalne id, istniejące pojęcia, poprawne parametry i seedy', () => {
    const ids = new Set<string>();
    for (const l of LESSONS) {
      expect(ids.has(l.id), l.id).toBe(false);
      ids.add(l.id);
      expect(l.steps.length, l.id).toBeGreaterThan(1);
      expect(l.lookFor.length, l.id).toBeGreaterThan(0);
      for (const c of l.concepts) expect(HELP[c], `${l.id} → brak ${c}`).toBeTruthy();
      expect(l.action.worlds.length, l.id).toBeGreaterThan(0);
      for (const w of l.action.worlds) {
        for (const k of Object.keys(w.params ?? {})) expect(k in DEFAULT_PARAMS, `${l.id}: nieznany parametr ${k}`).toBe(true);
        for (const k of Object.keys(w.setup ?? {})) expect(k in DEFAULT_SETUP, `${l.id}: nieznane pole konfiguracji ${k}`).toBe(true);
      }
    }
  });

  it('opisy scenariuszy i lekcji nie obiecują niczego, co obalono w testach (wędrujące plamy)', () => {
    const wander = PRESETS.find((p) => p.id === 'wander')!;
    expect(wander.desc).toMatch(/nie potwierdzi/i);
    const lesson = LESSONS.find((l) => l.id === 'wander')!;
    expect(lesson.observed?.join(' ')).toMatch(/nie sprawdzi/i);
  });
});
