/**
 * Konfiguracja eksperymentu: `WorldSetup` (niezmienna po utworzeniu świata)
 * i `WorldParams` (parametry, które można zmieniać w trakcie symulacji — każda zmiana jest logowana).
 */

export type FertilityPattern = 'patches' | 'uniform' | 'gradient' | 'oasis';

export type EventKind = 'drought' | 'bloom' | 'coldSnap' | 'cull' | 'blight';

export interface EventSpec {
  kind: EventKind;
  /** siła 0..1 */
  severity: number;
  /** czas trwania w tickach (dla zdarzeń trwających); cull/blight są natychmiastowe */
  duration?: number;
  /** opcjonalny obszar (cull) */
  x?: number;
  y?: number;
  radius?: number;
}

export interface ScheduledEvent {
  tick: number;
  spec: EventSpec;
}

export interface WorldSetup {
  seed: number;
  width: number;
  height: number;
  /** rozmiar komórki siatki zasobów */
  cellSize: number;
  /** pojemność puli organizmów (twardy limit pamięci) */
  capacity: number;
  initialPopulation: number;
  fertilityPattern: FertilityPattern;
  patchCount: number;
  /** początkowe wypełnienie zasobów (ułamek pojemności komórki) */
  initialFoodFraction: number;
  /** początkowa energia założycieli (ułamek maxEnergy) */
  founderEnergyFraction: number;
  /** odch. standardowe wag losowych założycieli */
  founderWeightSd: number;
  /** górna granica genu diety u założycieli (0 = wyłącznie roślinożercy) */
  founderDietMax: number;
  /** zdarzenia zaplanowane z góry (część definicji eksperymentu) */
  schedule: ScheduledEvent[];
}

export interface WorldParams {
  biomes: number;
  biomeContrast: number;
  plantBShare: number;
  plantBToxicity: number;
  viewCos: number;
  obstacles: number;
  communication: number;
  signalCoef: number;
  mateChoice: number;
  plasticityRate: number;
  learnCoef: number;
  nicheRate: number;
  cultivationCoef: number;
  nicheDecay: number;

  // — zasoby —
  /** względne tempo wzrostu zasobu (1/tick): logistycznie, proporcjonalnie do istniejącej biomasy */
  regrowthRate: number;
  /** ułamek pojemności komórki, który działa jak „nasiona” przy zerowej biomasie (rozsiew) */
  foodSeed: number;
  /** pojemność komórki o żyzności 1 */
  foodCapMax: number;
  /** tempo zaniku nadmiaru zasobu ponad pojemność */
  foodDecay: number;
  /** dryf plam żyzności (jednostek świata na tick); 0 = plamy nieruchome */
  patchDrift: number;
  /** cykl życia plamy żyzności w tickach (rośnie, wygasa, odradza się gdzie indziej); 0 = trwałe */
  patchLife: number;
  /** przewaga rozmiaru w rywalizacji o pokarm w tej samej komórce: udział ∝ (promień/4)^k, k = 0..3 (całkowite) */
  contestPower: number;
  // — koszty fizjologiczne —
  basalCoef: number;
  moveCoef: number;
  turnCoef: number;
  senseCoef: number;
  brainCoef: number;
  eatCoef: number;
  coldUpkeepCoef: number;
  // — reprodukcja i życie —
  reproOverhead: number;
  accidentRate: number;
  lifespanBase: number;
  maxPopulation: number;
  /** ułamek energii zwłok wracający do gleby (reszta rozprasza się jako ciepło) */
  corpseRecycling: number;
  // — ewolucja —
  /** siła ataku drapieżnika (energia/tick dla diety 1, masy 1); 0 = drapieżnictwo wyłączone */
  predationPower: number;
  /** koszt wysiłku ataku */
  attackCoef: number;
  /** 0 = rozmnażanie bezpłciowe (klon + mutacje), 1 = płciowe (dwoje rodziców, rekombinacja) */
  sexual: number;
  /** zasięg wyszukiwania partnera (ponad sumę promieni) */
  mateRange: number;
  mutationRate: number;
  mutationStrength: number;
  traitMutationStrength: number;
  // — klimat —
  baseTemperature: number;
  coldMetabK: number;
  coldDamage: number;
  seasonPeriod: number;
  seasonTempAmp: number;
  seasonGrowthAmp: number;
}

export const DEFAULT_SETUP: WorldSetup = {
  seed: 1,
  width: 800,
  height: 800,
  cellSize: 16,
  capacity: 6000,
  initialPopulation: 400,
  fertilityPattern: 'patches',
  patchCount: 9,
  initialFoodFraction: 0.8,
  founderEnergyFraction: 0.6,
  founderWeightSd: 0.6,
  founderDietMax: 0.5,
  schedule: [],
};

export const DEFAULT_PARAMS: WorldParams = {
  biomes: 0,
  biomeContrast: 0.6,
  plantBShare: 0,
  plantBToxicity: 0.02,
  viewCos: -1,
  obstacles: 0,
  communication: 0,
  signalCoef: 0.03,
  mateChoice: 0,
  plasticityRate: 0,
  learnCoef: 0.02,
  nicheRate: 0,
  cultivationCoef: 0.1,
  nicheDecay: 0.0001,

  regrowthRate: 0.1,
  foodSeed: 0.03,
  foodCapMax: 60,
  foodDecay: 0.002,
  patchDrift: 0,
  patchLife: 0,
  contestPower: 1,
  basalCoef: 0.05,
  moveCoef: 0.02,
  turnCoef: 0.01,
  senseCoef: 0.000006,
  brainCoef: 0.0003,
  eatCoef: 0.012,
  coldUpkeepCoef: 0.03,
  reproOverhead: 0.15,
  accidentRate: 0.00003,
  lifespanBase: 3000,
  maxPopulation: 5000,
  corpseRecycling: 0.7,
  predationPower: 4,
  attackCoef: 0.03,
  sexual: 0,
  mateRange: 25,
  mutationRate: 0.04,
  mutationStrength: 0.2,
  traitMutationStrength: 0.05,
  baseTemperature: 1,
  coldMetabK: 2,
  coldDamage: 0.004,
  seasonPeriod: 0,
  seasonTempAmp: 0.3,
  seasonGrowthAmp: 0.5,
};

export interface ParamMeta {
  label: string;
  group: 'Zasoby' | 'Koszty' | 'Życie' | 'Drapieżnictwo' | 'Ewolucja' | 'Klimat';
  min: number;
  max: number;
  step: number;
  hint: string;
  /** skala logarytmiczna w UI */
  log?: boolean;
}

export const PARAM_META: Record<keyof WorldParams, ParamMeta> = {
  biomes: { label: 'Lokalne biomy (0/1)', group: 'Klimat', min: 0, max: 1, step: 1, hint: 'Trzy siedliska różniące się temperaturą, żyznością, udziałem B i reakcją na sezony. 0 przywraca warunki globalne.' },
  biomeContrast: { label: 'Kontrast biomów', group: 'Klimat', min: 0, max: 1, step: 0.05, hint: 'Siła różnic lokalnych; 0 zachowuje mapę siedlisk, lecz wyrównuje warunki.' },
  plantBShare: { label: 'Udział pokarmu B', group: 'Zasoby', min: 0, max: 0.9, step: 0.05, hint: 'A i B dzielą tę samą całkowitą pojemność; B rośnie w rzadszych siedliskach.' },
  plantBToxicity: { label: 'Toksyczność pokarmu B', group: 'Zasoby', min: 0, max: 0.2, step: 0.005, hint: 'Uszkodzenie zdrowia po zjedzeniu B; specjalizacja B zmniejsza toksyczność.' },
  viewCos: { label: 'Ograniczenie pola widzenia', group: 'Życie', min: -1, max: 0.95, step: 0.05, hint: 'Kosinus połowy pola widzenia; -1 oznacza pełne 360°, 0 przednią półkulę.' },
  obstacles: { label: 'Przeszkody (0/1)', group: 'Życie', min: 0, max: 1, step: 1, hint: 'Deterministyczne bariery z przejściami blokują ruch, wzrok i kontakty.' },
  communication: { label: 'Komunikacja (0/1)', group: 'Ewolucja', min: 0, max: 1, step: 1, hint: 'Lokalny sygnał z poprzedniego ticku bez przypisanego znaczenia.' },
  signalCoef: { label: 'Koszt emisji sygnału', group: 'Koszty', min: 0, max: 0.3, step: 0.005, hint: 'Koszt bezwzględnej amplitudy emisji na masę metaboliczną.' },
  mateChoice: { label: 'Wybór partnera (0/1)', group: 'Ewolucja', min: 0, max: 1, step: 1, hint: 'Obaj rodzice muszą zaakceptować fenotyp partnera według dziedzicznej preferencji.' },
  plasticityRate: { label: 'Tempo nowego uczenia', group: 'Ewolucja', min: 0, max: 0.2, step: 0.005, hint: '0 zatrzymuje nowe uczenie i jego koszt, zachowując nabyte wagi. Zmiany nie są dziedziczone.' },
  learnCoef: { label: 'Koszt plastyczności', group: 'Koszty', min: 0, max: 0.2, step: 0.005, hint: 'Stały koszt aktywnej plastyczności zależny od dziedzicznej zdolności.' },
  nicheRate: { label: 'Wpływ nowej kultywacji', group: 'Zasoby', min: 0, max: 1, step: 0.05, hint: '0 zatrzymuje nowe inwestycje i ich koszt. Wcześniejsza żyzność oraz nasiona pozostają i podlegają zanikowi.' },
  cultivationCoef: { label: 'Koszt kultywacji', group: 'Koszty', min: 0, max: 1, step: 0.01, hint: 'Koszt działania kultywacji na jednostkę masy metabolicznej.' },
  nicheDecay: { label: 'Zanik zmienionej żyzności', group: 'Zasoby', min: 0, max: 0.01, step: 0.0001, hint: 'Powolny zanik warstwy konstrukcji niszy; 0 oznacza trwałą zmianę.' },

  regrowthRate: { label: 'Tempo wzrostu zasobów', group: 'Zasoby', min: 0, max: 0.15, step: 0.001, hint: 'Względny przyrost/tick (logistyczny, ∝ istniejącej biomasy)' },
  foodSeed: { label: 'Rozsiew (nasiona)', group: 'Zasoby', min: 0, max: 0.3, step: 0.005, hint: 'Ułamek pojemności działający jak zalążek odrostu przy pustej komórce' },
  foodCapMax: { label: 'Pojemność komórki', group: 'Zasoby', min: 5, max: 300, step: 1, hint: 'Maks. zasób w najżyźniejszej komórce' },
  foodDecay: { label: 'Rozkład nadmiaru', group: 'Zasoby', min: 0, max: 0.05, step: 0.0005, hint: 'Zanik zasobu ponad pojemność (ciepło)' },
  patchDrift: { label: 'Dryf plam żyzności', group: 'Zasoby', min: 0, max: 1, step: 0.01, hint: 'Prędkość wędrówki żyznych plam (j./tick); 0 = nieruchome' },
  patchLife: { label: 'Cykl życia plam (0 = trwałe)', group: 'Zasoby', min: 0, max: 40000, step: 500, hint: 'Plama rośnie, wygasa i odradza się w innym miejscu' },
  contestPower: { label: 'Przewaga rozmiaru w rywalizacji', group: 'Zasoby', min: 0, max: 3, step: 1, hint: 'Udział w pokarmie komórki ∝ (promień/4)^k; 0 = równy podział wg zamiaru' },
  basalCoef: { label: 'Metabolizm podstawowy', group: 'Koszty', min: 0, max: 0.3, step: 0.001, hint: 'Koszt/tick ∝ masa^0.75' },
  moveCoef: { label: 'Koszt ruchu', group: 'Koszty', min: 0, max: 0.2, step: 0.001, hint: 'Koszt/tick ∝ masa · prędkość²' },
  turnCoef: { label: 'Koszt skręcania', group: 'Koszty', min: 0, max: 0.1, step: 0.001, hint: 'Koszt/tick ∝ masa · |skręt|' },
  senseCoef: { label: 'Koszt sensorów', group: 'Koszty', min: 0, max: 0.00005, step: 0.0000005, hint: 'Koszt/tick ∝ zasięg²' },
  brainCoef: { label: 'Koszt mózgu', group: 'Koszty', min: 0, max: 0.003, step: 0.00001, hint: 'Koszt/tick ∝ Σ|waga|' },
  eatCoef: { label: 'Koszt żerowania', group: 'Koszty', min: 0, max: 0.1, step: 0.001, hint: 'Koszt/tick ∝ wysiłek jedzenia · kęs' },
  coldUpkeepCoef: { label: 'Koszt odporności na zimno', group: 'Koszty', min: 0, max: 0.2, step: 0.001, hint: 'Utrzymanie izolacji ∝ gen · masa^0.75' },
  reproOverhead: { label: 'Narzut reprodukcji', group: 'Życie', min: 0, max: 1, step: 0.01, hint: 'Ułamek inwestycji tracony jako ciepło' },
  accidentRate: { label: 'Śmiertelność losowa', group: 'Życie', min: 0, max: 0.002, step: 0.00001, hint: 'Prawdopodobieństwo zgonu/tick' },
  lifespanBase: { label: 'Bazowa długość życia', group: 'Życie', min: 200, max: 20000, step: 100, hint: 'Maks. wiek ∝ masa^0.25' },
  maxPopulation: { label: 'Limit populacji', group: 'Życie', min: 50, max: 6000, step: 50, hint: 'Twardy limit (bezpiecznik pamięci)' },
  corpseRecycling: { label: 'Recykling zwłok', group: 'Życie', min: 0, max: 1, step: 0.01, hint: 'Ułamek energii zwłok wracający do gleby' },
  predationPower: { label: 'Siła ataku drapieżników', group: 'Drapieżnictwo', min: 0, max: 10, step: 0.1, hint: 'Energia/tick odbierana ofierze (dieta 1, masa 1); 0 = brak drapieżnictwa' },
  attackCoef: { label: 'Koszt ataku', group: 'Drapieżnictwo', min: 0, max: 0.2, step: 0.001, hint: 'Koszt/tick ∝ wysiłek ataku · masa^0.75 (tylko organizmy z dietą > 0)' },
  sexual: { label: 'Rozmnażanie płciowe (0/1)', group: 'Ewolucja', min: 0, max: 1, step: 1, hint: '1 = dwoje rodziców, rekombinacja neuron po neuronie' },
  mateRange: { label: 'Zasięg szukania partnera', group: 'Ewolucja', min: 5, max: 80, step: 1, hint: 'Odległość ponad sumę promieni, w której można się rozmnażać płciowo' },
  mutationRate: { label: 'Częstość mutacji', group: 'Ewolucja', min: 0, max: 0.3, step: 0.001, hint: 'Szansa mutacji każdego genu przy narodzinach' },
  mutationStrength: { label: 'Siła mutacji wag', group: 'Ewolucja', min: 0, max: 1.5, step: 0.01, hint: 'σ perturbacji wag sieci' },
  traitMutationStrength: { label: 'Siła mutacji cech', group: 'Ewolucja', min: 0, max: 0.3, step: 0.005, hint: 'σ perturbacji cech fizycznych [0..1]' },
  baseTemperature: { label: 'Temperatura bazowa', group: 'Klimat', min: 0, max: 1, step: 0.01, hint: '1 = komfort, mniej = zimno' },
  coldMetabK: { label: 'Wpływ zimna na metabolizm', group: 'Klimat', min: 0, max: 6, step: 0.1, hint: 'Mnożnik kosztów przy niedoborze ciepła' },
  coldDamage: { label: 'Obrażenia od zimna', group: 'Klimat', min: 0, max: 0.05, step: 0.0005, hint: 'Utrata zdrowia/tick ∝ obciążenie²' },
  seasonPeriod: { label: 'Okres pór roku (0 = brak)', group: 'Klimat', min: 0, max: 20000, step: 100, hint: 'Fala trójkątna temperatury i wzrostu' },
  seasonTempAmp: { label: 'Amplituda temp. sezonowej', group: 'Klimat', min: 0, max: 1, step: 0.01, hint: 'Spadek temperatury zimą' },
  seasonGrowthAmp: { label: 'Amplituda wzrostu sezonowego', group: 'Klimat', min: 0, max: 1, step: 0.01, hint: 'Spadek odnawiania zimą' },
};

export function validateSetup(s: Partial<WorldSetup>): WorldSetup {
  const out: WorldSetup = { ...DEFAULT_SETUP, ...s, schedule: s.schedule ? [...s.schedule] : [] };
  out.seed = out.seed >>> 0;
  out.width = Math.max(100, Math.min(4000, Math.round(out.width)));
  out.height = Math.max(100, Math.min(4000, Math.round(out.height)));
  out.cellSize = Math.max(4, Math.min(100, out.cellSize));
  out.capacity = Math.max(10, Math.min(100000, Math.round(out.capacity)));
  out.initialPopulation = Math.max(1, Math.min(out.capacity, Math.round(out.initialPopulation)));
  out.patchCount = Math.max(1, Math.round(out.patchCount));
  return out;
}

export function mergeParams(p?: Partial<WorldParams>): WorldParams {
  const out = { ...DEFAULT_PARAMS };
  if (p) for (const k of Object.keys(p) as (keyof WorldParams)[]) if (typeof p[k] === 'number') out[k] = p[k] as number;
  return out;
}
