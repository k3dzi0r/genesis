import type { WorldParams, WorldSetup } from '../engine/config';

export interface Preset {
  id: string;
  name: string;
  desc: string;
  setup?: Partial<WorldSetup>;
  params?: Partial<WorldParams>;
}

export const PRESETS: Preset[] = [
  {
    id: 'default',
    name: 'Domyślny (z drapieżnikami)',
    desc: 'Żyzne plamy, wspólna populacja o mieszanej diecie. Drapieżnictwo jest zdolnością, nie zachowaniem — sieć sama decyduje, czy atakować. Zwykle powstaje współistnienie drapieżników i roślinożerców.',
  },
  {
    id: 'herbivores',
    name: 'Bez drapieżników',
    desc: 'Drapieżnictwo wyłączone. Bez presji drapieżnika ewolucja zwykle kończy się małymi, tanimi, prawie ślepymi organizmami — dobry punkt odniesienia.',
    setup: { founderDietMax: 0 },
    params: { predationPower: 0 },
  },
  {
    id: 'arena',
    name: 'Arena drapieżników',
    desc: 'Większość założycieli ma wysoką dietę, a atak jest silny. Pokazuje, kiedy drapieżnictwo się opłaca, a kiedy wymiera wraz z ofiarami.',
    setup: { founderDietMax: 0.9 },
    params: { predationPower: 6, regrowthRate: 0.12 },
  },
  {
    id: 'sexual',
    name: 'Rozmnażanie płciowe',
    desc: 'Dwoje rodziców, rekombinacja neuron po neuronie. W testach (5 seedów, 30 tys. ticków) przeżywało więcej kladów (5,0 vs 2,6) i populacja była większa; różnorodność cech nie była wyższa.',
    params: { sexual: 1 },
  },
  {
    id: 'wander',
    name: 'Wędrujące plamy',
    desc: 'Mało żyznych plam, które dryfują i wygasają w nowych miejscach. Hipoteza, że to premiuje daleki wzrok i pamięć, nie potwierdziła się w testach autora — zobacz lekcję i sprawdź sam.',
    setup: { patchCount: 5 },
    params: { patchDrift: 0.15, patchLife: 8000 },
  },
  { id: 'seasons', name: 'Pory roku', desc: 'Cykliczna zima: spada temperatura i tempo wzrostu zasobów. W testach autora drapieżników było wtedy mniej (5% vs 22%).', params: { seasonPeriod: 8000, seasonTempAmp: 0.35, seasonGrowthAmp: 0.6 } },
  { id: 'scarce', name: 'Skąpy (cykle)', desc: 'Wolny wzrost zasobów: przeżarte plamy odnawiają się powoli, populacja oscyluje (zjadacze–roślinność).', params: { regrowthRate: 0.03 } },
  { id: 'lush', name: 'Obfity', desc: 'Szybki wzrost zasobów — duże populacje (do kilku tysięcy organizmów).', params: { regrowthRate: 0.2 } },
  { id: 'oasis', name: 'Oaza', desc: 'Jedna żyzna oaza pośrodku pustyni.', setup: { fertilityPattern: 'oasis' } },
  { id: 'gradient', name: 'Gradient', desc: 'Żyzność rośnie od lewej do prawej krawędzi.', setup: { fertilityPattern: 'gradient' } },
  { id: 'mutagenic', name: 'Wysoka mutagenność', desc: 'Szybka zmienność genetyczna kosztem stabilności linii.', params: { mutationRate: 0.12, mutationStrength: 0.35, traitMutationStrength: 0.1 } },
  { id: 'cold', name: 'Zimny klimat', desc: 'Stały niedobór ciepła — odporność na zimno staje się kluczowa.', params: { baseTemperature: 0.6, coldMetabK: 3 } },
];
