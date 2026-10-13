/**
 * Stałe struktury silnika. Zmiana którejkolwiek zmienia wynik symulacji dla tego samego seeda,
 * dlatego podbijamy ENGINE_VERSION przy każdej zmianie mechaniki.
 */

export const ENGINE_VERSION = '0.5.0';
/** Wersja formatu zapisu. Zwiększać przy zmianie układu pliku i dodać migrację w serialize.ts. */
export const FORMAT_VERSION = 4;

/** Nazwy cech fizycznych kodowanych w genomie (wartości znormalizowane do [0,1]). */
export const TRAIT_NAMES = [
  'size',
  'speed',
  'sense',
  'reproThreshold',
  'investment',
  'maturity',
  'coldTolerance',
  'bite',
  'hue',
  'memory',
  'diet',
  'plantSpecialization',
  'matePreference',
  'mateSelectivity',
  'plasticity',
  'nicheInvestment',
] as const;
export type TraitName = (typeof TRAIT_NAMES)[number];
export const N_TRAITS = TRAIT_NAMES.length;
export const TRAIT_HUE = 8;
export const TRAIT_MEMORY = 9;
export const TRAIT_DIET = 10;
export const TRAIT_PLANT = 11;
export const TRAIT_MATE_PREFERENCE = 12;
export const TRAIT_MATE_SELECTIVITY = 13;
export const TRAIT_PLASTICITY = 14;
export const TRAIT_NICHE = 15;
/** Bounded individual observation / location memory. */
export const TRAIL_LEN = 32;

export const TRAIT_LABELS: Record<TraitName, string> = {
  size: 'Rozmiar',
  speed: 'Prędkość maks.',
  sense: 'Zasięg sensorów',
  reproThreshold: 'Próg reprodukcji',
  investment: 'Inwestycja w potomka',
  maturity: 'Wiek dojrzałości',
  coldTolerance: 'Odporność na zimno',
  bite: 'Wielkość kęsa',
  hue: 'Znacznik linii (neutralny)',
  memory: 'Trwałość pamięci',
  diet: 'Dieta (0 roślinożerca → 1 drapieżnik)',
  plantSpecialization: 'Specjalizacja trawienia A → B',
  matePreference: 'Preferowany fenotyp partnera',
  mateSelectivity: 'Wybiórczość partnera',
  plasticity: 'Plastyczność podczas życia',
  nicheInvestment: 'Zdolność kultywacji',
};

/**
 * Architektura mózgu: perceptron z 1 warstwą ukrytą (tanh) i **pamięcią rekurencyjną**:
 * N_MEM ostatnich wyjść jest (z wygładzaniem zależnym od genu `memory`) podawane z powrotem na wejścia
 * w następnym ticku. Wagi są częścią genomu.
 */
export const N_MEM = 3;
export const N_HID = 8;
export const N_IN = 12 + N_MEM + 2 + 6;
export const N_OUT = 4 + N_MEM + 2;
/** indeksy wejść specjalnych */
export const IN_MEM = 12;
export const IN_NB_SIZE = 12 + N_MEM;
export const IN_NB_DIET = 13 + N_MEM;
/** indeksy wyjść */
export const OUT_TURN = 0;
export const OUT_THRUST = 1;
export const OUT_EAT = 2;
export const OUT_ATTACK = 3;
export const OUT_MEM = 4;
export const OUT_SIGNAL = 7;
export const OUT_CULTIVATE = 8;
export const IN_FOOD_B_FWD = 17;
export const IN_FOOD_B_LAT = 18;
export const IN_FOOD_B_AMOUNT = 19;
export const IN_SIGNAL = 20;
export const IN_SIGNAL_FWD = 21;
export const IN_SIGNAL_LAT = 22;

export const INPUT_LABELS = [
  'bias',
  'energia',
  'jedzenie ↑',
  'jedzenie ←',
  'zasób w zasięgu',
  'jedzenie tu',
  'tłok',
  'sąsiad ↑',
  'sąsiad ←',
  'ściana ↑',
  'ściana ←',
  'temperatura',
  'pamięć 1',
  'pamięć 2',
  'pamięć 3',
  'rozmiar sąsiada',
  'dieta sąsiada',
  'pokarm B ↑',
  'pokarm B ←',
  'pokarm B ilość',
  'sygnał',
  'sygnał ↑',
  'sygnał ←',
] as const;
export const OUTPUT_LABELS = ['skręt', 'ciąg', 'jedzenie', 'atak', 'zapis pam. 1', 'zapis pam. 2', 'zapis pam. 3', 'sygnał', 'kultywacja'] as const;

export const W1_OFF = N_TRAITS; // [N_HID][N_IN]
export const B1_OFF = W1_OFF + N_HID * N_IN; // [N_HID]
export const W2_OFF = B1_OFF + N_HID; // [N_OUT][N_HID]
export const B2_OFF = W2_OFF + N_OUT * N_HID; // [N_OUT]
export const GENOME_LEN = B2_OFF + N_OUT;
/** Maksymalna wartość bezwzględna wagi. */
export const MAX_WEIGHT = 6;

/**
 * Mapowania gen → fizjologia. To „fizyka” świata biologii, a nie parametr eksperymentu.
 * Każdy zysk ma swój koszt (patrz docs/MECHANICS.md).
 */
export const PHYSIO = {
  radiusMin: 2,
  radiusMax: 6,
  /** pojemność energii dla masy 1; skaluje się jak masa^0.875 (patrz storageScale) */
  energyPerMass: 100,
  speedMin: 0.5,
  speedMax: 3.0,
  senseMin: 12,
  senseMax: 80,
  /** próg reprodukcji (ułamek maxEnergy) */
  reproThreshMin: 0.45,
  reproThreshMax: 0.95,
  /** inwestycja w potomka (ułamek maxEnergy rodzica) */
  investMin: 0.12,
  investMax: 0.45,
  maturityMin: 80,
  maturityMax: 450,
  /** kęs (energia/tick na m^0.75) */
  biteMin: 0.6,
  biteMax: 2.6,
  /** sprawność trawienia: spada ze wzrostem kęsa */
  assimMax: 0.95,
  assimMin: 0.5,
  /** maks. kąt skrętu na tick (rad) */
  maxTurn: 0.35,
  /** rezerwa energii po reprodukcji (ułamek maxEnergy) */
  reproReserve: 0.15,
  /** minimalny odstęp między porodami */
  reproCooldown: 40,
  /** zasięg „dotyku” ścian */
  wallRange: 40,
  /** pamięć: współczynnik zachowania stanu (λ) dla genu 0 i 1 */
  memDecayMin: 0.5,
  memDecayMax: 0.99,
  /** drapieżnictwo: luz kontaktu ponad sumę promieni */
  contactPad: 1.5,
  /** strata sprawności trawienia roślin dla diety = 1 */
  dietPlantPenalty: 0.9,
  /** sprawność trawienia mięsa dla diety = 1 */
  meatAssimMax: 0.85,
  /** próg diety, poniżej którego organizm nie potrafi atakować */
  dietAttackMin: 0.02,
  /** skala nasycenia dla wejść */
  foodSat: 40,
  crowdSat: 4,
  /** tolerancja zimna: ile deficytu temperatury znosi gen=1 */
  coldTolSpan: 0.6,
} as const;
