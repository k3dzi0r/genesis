import type { WorldParams, WorldSetup } from '../engine/config';

export interface Preset {
  id: string;
  name: string;
  desc: string;
  setup?: Partial<WorldSetup>;
  params?: Partial<WorldParams>;
}

export const PRESETS: Preset[] = [
  {id:'basic',name:'Podstawy · jeden pokarm',desc:'Jeden pokarm, klonalny rozród i mutacje. Zaczynasz od prostego świata; kolejne mechaniki włączysz w Modułach.',params:{predationPower:0}},
  {id:'biomes',name:'Lokalne biomy · różne siedliska',desc:'Trzy siedliska o różnych temperaturach, żyzności i udziale pokarmu B. Przejścia mierzą ruch; przewaga adaptacyjna wymaga kontroli tego samego genotypu.',params:{biomes:1,biomeContrast:0.6,plantBShare:0.45}},
  { id: 'integrated', name: 'Żywy ekosystem · wszystkie mechaniki', desc: 'Biomy i sezony, dwa pokarmy, bariery, sygnał, dobór partnera, uczenie i kultywacja. Atlas i laboratorium mierzą skutki; współpraca i gatunki pozostają hipotezami.', params: { biomes:1, biomeContrast:0.6, seasonPeriod:8000, plantBShare: 0.45, obstacles: 1, viewCos: -0.3, communication: 1, sexual: 1, mateChoice: 1, plasticityRate: 0.025, nicheRate: 0.3, predationPower: 3 } },
  { id: 'two-foods', name: 'Dwa pokarmy · specjalizacja', desc: 'A/B dzielą pojemność. Dziedziczny kompromis trawienia i toksyczność B tworzą różne koszty. Hipoteza: utrzymanie kilku specjalizacji; sprawdź kolor A/B i geny.', params: { plantBShare: 0.5, plantBToxicity: 0.02, predationPower: 2 } },
  { id: 'perception', name: 'Ograniczony wzrok · przeszkody', desc: 'Przednie pole widzenia i bariery z przejściami. Kierunek pokarmu agreguje tylko widoczne komórki. Hipoteza: ruch zbierający informację; obserwuj trajektorie.', params: { viewCos: 0, obstacles: 1 } },
  { id: 'communication', name: 'Lokalne sygnały', desc: 'Organizmy emitują kosztowny, podpisany sygnał i słyszą sąsiadów także poza polem wzroku. Znaczenie nie jest narzucone. Porównaj korzyść odbioru w ablacji.', params: { communication: 1, signalCoef: 0.02, viewCos: 0, obstacles: 1, predationPower: 4 } },
  { id: 'speciation', name: 'Dobór partnera · izolacja', desc: 'Rozród płciowy i wzajemny wybór partnera według fenotypu. Bariery i pokarmy różnicują warunki. Atlas pokazuje zgodność i obserwowane krzyżowania; grupy nie są automatycznie gatunkami.', params: { sexual: 1, mateChoice: 1, plantBShare: 0.5, obstacles: 1 } },
  { id: 'learning', name: 'Uczenie podczas życia', desc: 'Somatyczne wagi zmieniają się według śladów aktywności i bilansu energetycznego. Potomstwo dziedziczy genom. Hipoteza: plastyczność pomaga przy zmianach; porównaj w laboratorium.', params: { plasticityRate: 0.04, patchDrift: 0.1, patchLife: 6000, viewCos: 0 } },
  { id: 'cultivation', name: 'Konstrukcja niszy', desc: 'Kosztowna kultywacja zwiększa lokalną pojemność i odkłada nasiona przeniesione z innych komórek. Włącz nakładkę Nisza. Hipoteza: wpływ potomków na własne środowisko.', params: { nicheRate: 0.5, cultivationCoef: 0.1, nicheDecay: 0.0001, regrowthRate: 0.05, plantBShare: 0.3 } },
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
    desc: 'Dwoje rodziców, rekombinacja neuron po neuronie. W pomiarach v0.3 (5 seedów, 30 tys. ticków) przeżywało więcej kladów (5,0 vs 2,6) i populacja była większa; różnorodność cech nie była wyższa.',
    params: { sexual: 1 },
  },
  {
    id: 'wander',
    name: 'Wędrujące plamy',
    desc: 'Mało żyznych plam, które dryfują i wygasają w nowych miejscach. Hipoteza, że to premiuje daleki wzrok i pamięć, nie potwierdziła się w testach autora — zobacz lekcję i sprawdź sam.',
    setup: { patchCount: 5 },
    params: { patchDrift: 0.15, patchLife: 8000 },
  },
  { id: 'seasons', name: 'Pory roku', desc: 'Cykliczna zima: spada temperatura i tempo wzrostu zasobów. W pomiarach v0.3 drapieżników było wtedy mniej (5% vs 22%).', params: { seasonPeriod: 8000, seasonTempAmp: 0.35, seasonGrowthAmp: 0.6 } },
  { id: 'scarce', name: 'Skąpy (cykle)', desc: 'Wolny wzrost zasobów: przeżarte plamy odnawiają się powoli, populacja oscyluje (zjadacze–roślinność).', params: { regrowthRate: 0.03 } },
  { id: 'lush', name: 'Obfity', desc: 'Szybki wzrost zasobów — duże populacje (do kilku tysięcy organizmów).', params: { regrowthRate: 0.15 } },
  { id: 'oasis', name: 'Oaza', desc: 'Jedna żyzna oaza pośrodku pustyni.', setup: { fertilityPattern: 'oasis' } },
  { id: 'gradient', name: 'Gradient', desc: 'Żyzność rośnie od lewej do prawej krawędzi.', setup: { fertilityPattern: 'gradient' } },
  { id: 'mutagenic', name: 'Wysoka mutagenność', desc: 'Szybka zmienność genetyczna kosztem stabilności linii.', params: { mutationRate: 0.12, mutationStrength: 0.35, traitMutationStrength: 0.1 } },
  { id: 'cold', name: 'Zimny klimat', desc: 'Stały niedobór ciepła — odporność na zimno staje się kluczowa.', params: { baseTemperature: 0.6, coldMetabK: 3 } },
];
