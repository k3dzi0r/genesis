/** Typy systemu pomocy edukacyjnej. Treści: src/ui/help/*.ts, interfejs: Help.tsx, Learn.tsx. */

export type HelpGroup =
  | 'Symulacja'
  | 'Świat i środowisko'
  | 'Organizm'
  | 'Mózg'
  | 'Ewolucja'
  | 'Ekologia'
  | 'Analiza i statystyka'
  | 'Interfejs';

export const HELP_GROUPS: HelpGroup[] = ['Symulacja', 'Świat i środowisko', 'Organizm', 'Mózg', 'Ewolucja', 'Ekologia', 'Analiza i statystyka', 'Interfejs'];

export interface HelpEntry {
  /** nazwa pojęcia */
  title: string;
  /** 1–2 zdania — pokazywane w dymku po najechaniu */
  short: string;
  /** dłuższe wyjaśnienie (akapity) — po kliknięciu „?” i w słowniku */
  more?: string[];
  /** ciekawostka — zawsze prawdziwa i, jeśli to możliwe, ze źródłem/nazwiskiem */
  fun?: string;
  /** co zrobić w aplikacji, żeby to zobaczyć */
  try?: string;
  /** powiązane pojęcia (id) */
  see?: string[];
  group: HelpGroup;
  /** false = wpis tylko do dymków, bez słownika (np. pojedyncze parametry mają własną sekcję) */
  glossary?: boolean;
}

export type HelpMap = Record<string, HelpEntry>;

export type LessonLevel = 'start' | 'średni' | 'zaawansowany';

/** Co lekcja może zrobić w aplikacji (wykonywane w App przez magistralę zdarzeń). */
export interface LessonAction {
  /** utwórz świat(y): nazwa, setup, params */
  worlds: { name: string; setup?: Record<string, unknown>; params?: Record<string, number> }[];
  /** tempo startowe: etykieta i ticki/s */
  speed?: { label: string; tps: number };
  /** zakładka prawego panelu do otwarcia po uruchomieniu */
  openTab?: 'stats' | 'org' | 'gen' | 'cmp' | 'log' | 'history' | 'atlas' | 'lab';
  /** zakładka lewego panelu */
  openLeft?: 'env' | 'exp' | 'saves';
}

export interface Lesson {
  guided?: import('./guided').GuidedDefinition;
  id: string;
  title: string;
  level: LessonLevel;
  /** orientacyjny czas */
  minutes: number;
  /** jedno zdanie: czego się nauczysz */
  goal: string;
  /** krótkie wprowadzenie teoretyczne */
  intro: string[];
  /** kroki do wykonania */
  steps: string[];
  /** na co patrzeć */
  lookFor: string[];
  /** co wychodziło w testach autora (tylko zmierzone fakty); puste = brak pomiarów */
  observed?: string[];
  /** uwaga o ograniczeniach/pułapkach interpretacyjnych */
  caveat?: string;
  /** pojęcia do słownika */
  concepts: string[];
  action: LessonAction;
}
