/**
 * Historia statystyk o ograniczonej pamięci: stała liczba wierszy; po zapełnieniu
 * sąsiednie wiersze są scalane (suma/średnia/ostatnia) i interwał próbkowania się podwaja.
 * Dzięki temu wielomilionowy eksperyment zajmuje tyle samo pamięci co krótki.
 */
import { TRAIT_NAMES } from './constants';

export type Agg = 'last' | 'sum' | 'mean' | 'max';

export interface StatColumn {
  key: string;
  label: string;
  agg: Agg;
}

const BASE_COLUMNS: StatColumn[] = [
  { key: 'tick', label: 'Tick', agg: 'last' },
  { key: 'pop', label: 'Populacja', agg: 'mean' },
  { key: 'births', label: 'Narodziny', agg: 'sum' },
  { key: 'deaths', label: 'Zgony', agg: 'sum' },
  { key: 'dStarve', label: 'Zgony: głód', agg: 'sum' },
  { key: 'dAge', label: 'Zgony: starość', agg: 'sum' },
  { key: 'dHealth', label: 'Zgony: zdrowie', agg: 'sum' },
  { key: 'dAccident', label: 'Zgony: wypadek', agg: 'sum' },
  { key: 'dCull', label: 'Zgony: katastrofa', agg: 'sum' },
  { key: 'dPred', label: 'Zgony: drapieżnik', agg: 'sum' },
  { key: 'meanAge', label: 'Średni wiek', agg: 'mean' },
  { key: 'meanEnergy', label: 'Średnia energia (ułamek)', agg: 'mean' },
  { key: 'meanGen', label: 'Średnie pokolenie', agg: 'mean' },
  { key: 'maxGen', label: 'Maks. pokolenie', agg: 'max' },
  { key: 'food', label: 'Zasoby (łącznie)', agg: 'mean' },
  { key: 'foodFrac', label: 'Zasoby (ułamek pojemności)', agg: 'mean' },
  { key: 'orgEnergy', label: 'Energia organizmów', agg: 'mean' },
  { key: 'diversity', label: 'Różnorodność cech', agg: 'mean' },
  { key: 'genomeDist', label: 'Odległość genomów', agg: 'mean' },
  { key: 'reproRate', label: 'Tempo reprodukcji (‰/tick/os.)', agg: 'mean' },
  { key: 'eIn', label: 'Energia wpływająca', agg: 'sum' },
  { key: 'eOut', label: 'Energia rozpraszana', agg: 'sum' },
  { key: 'temp', label: 'Temperatura', agg: 'mean' },
  { key: 'brainCost', label: 'Śr. Σ|w| mózgu', agg: 'mean' },
  { key: 'carnFrac', label: 'Udział drapieżników (dieta > 0,3)', agg: 'mean' },
  { key: 'predEnergy', label: 'Energia przejęta przez drapieżniki', agg: 'sum' },
  { key: 'cladeTop', label: 'Udział największego kladu', agg: 'mean' },
  { key: 'cladeCount', label: 'Liczba żyjących kladów', agg: 'mean' },
];

export const STAT_COLUMNS: StatColumn[] = [
  ...BASE_COLUMNS,
  ...TRAIT_NAMES.map((t) => ({ key: `m_${t}`, label: `Średnia: ${t}`, agg: 'mean' as Agg })),
  ...TRAIT_NAMES.map((t) => ({ key: `s_${t}`, label: `Odch. std.: ${t}`, agg: 'mean' as Agg })),
];

export const STAT_INDEX: Record<string, number> = Object.fromEntries(STAT_COLUMNS.map((c, i) => [c.key, i]));
export const N_STATS = STAT_COLUMNS.length;

export class StatsHistory {
  rows: Float64Array;
  count = 0;
  /** liczba ticków przypadająca na jeden wiersz */
  interval: number;
  /** zwiększany przy każdym scaleniu — klient wie, że musi przeładować całość */
  version = 0;

  constructor(
    public readonly maxRows = 4096,
    baseInterval = 20,
  ) {
    this.rows = new Float64Array(maxRows * N_STATS);
    this.interval = baseInterval;
  }

  push(row: ArrayLike<number>): void {
    if (this.count >= this.maxRows) this.compact();
    this.rows.set(row as ArrayLike<number>, this.count * N_STATS);
    this.count++;
  }

  private compact(): void {
    const half = this.count >> 1;
    for (let r = 0; r < half; r++) {
      const a = r * 2 * N_STATS;
      const b = (r * 2 + 1) * N_STATS;
      const o = r * N_STATS;
      for (let c = 0; c < N_STATS; c++) {
        const x = this.rows[a + c];
        const y = this.rows[b + c];
        let v: number;
        switch (STAT_COLUMNS[c].agg) {
          case 'sum': v = x + y; break;
          case 'mean': v = (x + y) / 2; break;
          case 'max': v = x > y ? x : y; break;
          default: v = y;
        }
        this.rows[o + c] = v;
      }
    }
    this.count = half;
    this.interval *= 2;
    this.version++;
  }

  column(key: string): Float64Array {
    const c = STAT_INDEX[key];
    const out = new Float64Array(this.count);
    for (let r = 0; r < this.count; r++) out[r] = this.rows[r * N_STATS + c];
    return out;
  }

  last(key: string): number {
    if (!this.count) return 0;
    return this.rows[(this.count - 1) * N_STATS + STAT_INDEX[key]];
  }

  /** Wartość na 1000 ticków z ostatnich `rows` wierszy (średnia ważona czasem). */
  recentRate(key: string, rows = 12): number {
    const n = this.count;
    if (n < 2) return 0;
    const c = STAT_INDEX[key];
    const t = STAT_INDEX.tick;
    const from = Math.max(1, n - rows);
    let sum = 0;
    for (let i = from; i < n; i++) sum += this.rows[i * N_STATS + c];
    const dt = this.rows[(n - 1) * N_STATS + t] - this.rows[(from - 1) * N_STATS + t];
    return dt > 0 ? (sum / dt) * 1000 : 0;
  }

  toCsv(): string {
    const lines = [STAT_COLUMNS.map((c) => c.key).join(',')];
    for (let r = 0; r < this.count; r++) {
      const cells: string[] = [];
      for (let c = 0; c < N_STATS; c++) cells.push(String(this.rows[r * N_STATS + c]));
      lines.push(cells.join(','));
    }
    return lines.join('\n');
  }
}
