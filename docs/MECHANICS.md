# GENESIS — mechanika symulacji

Dokument opisuje **dokładnie to, co robi silnik w wersji 0.4.0** (`src/engine/`), wraz z uproszczeniami i ograniczeniami.
Wartości liczbowe pochodzą z `constants.ts` (stałe „fizyki”) i `config.ts` (parametry eksperymentu, zmienne w trakcie).

## 1. Czas i determinizm

* Jednostką czasu jest **tick**. Jeden `World.step()` = jeden tick; wynik zależy wyłącznie od (konfiguracja, seed, wersja silnika, dziennik poleceń).
  Tempo (1×…MAX), FPS i podział pracy na porcje nie mają wpływu (testowane: `tests/determinism.test.ts`).
* Generator: sfc32, kilka niezależnych strumieni (świat, mapa żyzności, założyciele, środowisko — dryf i odradzanie plam).
* Rdzeń nie używa `Math.random` ani funkcji przestępnych (`sin/cos/exp/log/pow`). Zamiast nich: `tanh` jako przybliżenie Padé, `sin/cos` małych kątów
  szeregiem Taylora, potęgi 3/4, 1/4, 7/8 przez pierwiastki, rozkład normalny jako suma 4 równomiernych. Dzięki temu wynik zależy tylko od arytmetyki IEEE‑754.
* Interwencje użytkownika (zmiana parametru, zdarzenie, dosypanie zasobów) są stosowane **między tickami** i zapisywane w `commandLog` oraz `paramHistory`.

## 2. Kolejność jednego ticku

1. Zdarzenia zaplanowane w konfiguracji (`setup.schedule`), środowisko (pory roku, aktywne zdarzenia → temperatura i mnożnik wzrostu), **dryf i cykl życia plam żyzności**.
2. **Wzrost zasobów** w każdej komórce siatki (jedyne źródło energii poza ręcznym dosypaniem).
3. Przebudowa siatki przestrzennej organizmów (counting sort, komórka 40 j.).
4. **Percepcja, decyzja i aktualizacja pamięci** każdego organizmu na stanie z początku ticku → kolejność organizmów nie wpływa na decyzje.
5. **Ruch i koszty** → energia przechodzi w ciepło (ledger).
6. **Żerowanie** (podział zasobu komórki między konkurentów).
7. **Drapieżnictwo**: siatka przestrzenna jest przebudowywana po ruchu; napastnicy wybierają cel i odbierają energię (dwufazowo, proporcjonalnie).
8. Starzenie i śmierć (wszystkich), a dopiero potem reprodukcja (bezpłciowa lub płciowa) tych, którzy przeżyli.
9. Usunięcie zmarłych (zwłoki wracają do gleby), statystyki, okresowe przycinanie i scalanie genealogii, wykrycie wymarcia.

## 3. Świat i zasoby

* Prostokąt `width × height` (domyślnie 800×800) o twardych ścianach (organizm odbija się: składowa kierunku „na zewnątrz” zmienia znak).
* Siatka zasobów o komórce `cellSize` = 16. Każda komórka ma **żyzność** ∈ [0,1] (stała, generowana z seeda: `patches`, `uniform`, `gradient`, `oasis`)
  oraz pojemność `foodCapMax · żyzność`.
* **Wzrost logistyczny proporcjonalny do biomasy** (jak roślinność):
  `Δ = regrowthRate · (F + foodSeed · cap) · (1 − F/cap)`; powyżej pojemności nadmiar zanika (`foodDecay`, ciepło).
  Konsekwencja: przeżarte komórki odnawiają się wolno, więc istnieje presja, by nie przeżerać i by szukać nietkniętych skupisk.
  (Wersja 0.1 miała stałe źródło niezależne od biomasy; powodowało to równomierne wyjedzenie wszystkiego i brak przewagi z sensorów — zmienione.)
* **Dynamiczne plamy żyzności** (wzorzec `patches`): mapa żyzności jest sumą plam o kernelu (1 − d²/r²)². Parametr `patchDrift` przesuwa je losowym błądzeniem kierunku (odbicie od ścian),
  a `patchLife` nadaje plamom cykl życia: amplituda rośnie, wygasa, plama odradza się w losowym miejscu (z losową fazą, więc nie wygasają jednocześnie). Mapa jest przeliczana co 20 ticków.
  Gdy pojemność komórki maleje poniżej zawartości, nadmiar zanika (ciepło) — bilans energii pozostaje zgodny. Domyślnie plamy są nieruchome.
* **Bilans energii**: `energia(zasoby) + energia(organizmy) = początkowa + wpływy − rozproszenie`. Wpływy: wzrost zasobów, ręczne dosypanie.
  Rozproszenie: metabolizm, ruch, sensory/mózg, utrzymanie izolacji, wysiłek jedzenia i ataku, straty trawienia (roślin i mięsa), narzut reprodukcji, część zwłok, zanik nadmiaru, zaraza.
  Niezgodność jest raportowana w UI i testowana (`tests/energy.test.ts`; w praktyce ~1e‑12 względnie).

## 4. Organizm

### Genom (289 liczb Float32)
`[16 cech ∈ [0,1]] [wagi sieci: 23×8 + 8 + 9×8 + 9 = 273]`.

| Cecha | Zakres fizyczny | Zysk | Koszt |
|---|---|---|---|
| `size` | promień 2–6, masa=(r/4)² | większy magazyn energii, większy kęs, dłuższe życie (∝ m^¼), przewaga w rywalizacji o pokarm, większy atak względem ofiary | metabolizm ∝ m^¾, ruch ∝ m^¾·v², droższy potomek |
| `speed` | 0.5–3.0 j./tick | szybsze dotarcie do pokarmu / ucieczka / pościg | koszt ruchu ∝ m^¾·v² |
| `sense` | zasięg 12–80 | dalsze wykrywanie pokarmu/sąsiadów | koszt ∝ R² |
| `reproThreshold` | 45–95 % pojemności | późniejszy, lepiej zaopatrzony start | rzadsze rozmnażanie |
| `investment` | 12–45 % pojemności rodzica | większy, silniejszy potomek | mniej potomstwa |
| `maturity` | 80–450 ticków | — | późniejsze pierwsze rozmnażanie |
| `coldTolerance` | tolerancja deficytu temp. 0–0,6 | mniejszy koszt/obrażenia w zimnie | stałe utrzymanie ∝ gen·m^¾ |
| `bite` | kęs (0,6–2,6)·m^¾, sprawność trawienia 95 %→50 % | szybsze jedzenie | im większy kęs, tym większe straty trawienia |
| `hue` | — | **brak (znacznik neutralny)** | brak; służy tylko do wizualnego śledzenia linii |
| `memory` | λ = 0,5…0,99 (wygładzanie stanu pamięci) | dłuższa pamięć (do ~100 ticków) | brak bezpośredniego; koszt pośredni przez Σ\|w\| sieci |
| `diet` | 0 = roślinożerca … 1 = drapieżnik | zdolność ataku (siła ∝ dieta), sprawność trawienia mięsa 0,85·dieta | trawienie roślin ×(1 − 0,9·dieta), koszt wysiłku ataku |

Koszt mózgu: `brainCoef · Σ|waga|` (silniejsza sieć = droższa). Maks. energia: `100 · m^¾ · m^⅛` (= m^0,875).

### Percepcja (23 wejścia, układ egocentryczny, regulowane pole widzenia)
bias · energia/maks · kierunek do pokarmu (przód, lewo) · ilość pokarmu w zasięgu · pokarm pod organizmem · tłok (liczba sąsiadów) ·
najbliższy sąsiad (przód, lewo) · odpychanie od ścian (przód, lewo) · temperatura · **3 komórki pamięci** · **względny rozmiar** i **dieta** najbliższego sąsiada.
Kierunek do pokarmu to ważony środek ciężkości komórek w zasięgu (waga = zasób/(1+d²/cell²)), czyli sensor nie „widzi” pojedynczych obiektów.
Dieta i rozmiar sąsiada pozwalają — ale nie zmuszają — odróżnić potencjalnego drapieżnika od ofiary.

### Mózg i działanie
Sieć 23→8 (tanh)→9 (tanh), z opcjonalną plastycznością somatyczną. Wyjścia: **skręt** (±0,35 rad/tick), **ciąg** (0…prędkość maks.), **wysiłek jedzenia** (0…1), **wysiłek ataku** (0…1)
oraz **3 zapisy pamięci**, podpisany **sygnał** i wysiłek **kultywacji**. Stan pamięci: `mem ← λ·mem + (1−λ)·wyjście`, a `mem` wraca na wejścia w następnym ticku (rekurencja Elmana z wygładzaniem; λ koduje gen `memory`).
Nowo narodzony zaczyna z pustą pamięcią. Zdrowie obniża efektywną prędkość i kęs (czynnik 0,5+0,5·zdrowie).

### Koszty na tick
`basal·(1+K·obciążenie zimnem)` + sensory + mózg + izolacja + ruch + skręt + jedzenie (wszystko zależne od parametrów; wartości domyślne w `config.ts`).
Jeśli organizm **nie jest w stanie pokryć kosztów** w danym ticku → umiera z głodu (nawet jeśli coś zje).

### Żerowanie
Zamiar: `wysiłek · kęs · (0,5+0,5·zdrowie)`, ograniczony miejscem w magazynie. Zasób komórki dzielony proporcjonalnie do `zamiar · (promień/4)^k`
(`contestPower` k, domyślnie 1; 0 = podział wyłącznie wg zamiaru). Zjedzona energia × sprawność trawienia → organizm; reszta → ciepło.

### Drapieżnictwo
Każdy organizm z dietą ≥ 0,02 może atakować; atak jest zdolnością, a nie zachowaniem — **to sieć decyduje (wyjście „atak”), czy i kiedy**.
Napastnik wybiera najbliższego organizmu w kontakcie (odległość ≤ suma promieni + 1,5) i zgłasza zapotrzebowanie
`wysiłek · predationPower · dieta · m^¾ · 2r_napastnika/(r_napastnika + r_ofiary)`, ograniczone miejscem w jego magazynie.
Zapotrzebowania na tę samą ofiarę są realizowane **proporcjonalnie** (jeśli ofiara ma mniej energii niż suma żądań) — kolejność indeksów nikogo nie faworyzuje.
Ofiara traci `take`, napastnik zyskuje `take · 0,85 · dieta`, reszta jest ciepłem. Ofiara wyczerpana do zera ginie z przyczyny „drapieżnik”.
Atak kosztuje `attackCoef · wysiłek · m^¾` na tick, ale tylko organizmy zdolne do ataku. Brak kolizji fizycznych i obrażeń poza utratą energii; kanibalizm i atak na własne potomstwo są możliwe.
`predationPower = 0` wyłącza drapieżnictwo. Założyciele mają dietę z przedziału [0, `founderDietMax`] (domyślnie 0,5) — czyli zdolność ataku jest w populacji od początku,
a to, czy się utrzyma, rozstrzyga selekcja (przy słabym ataku lub ubogim świecie dieta wyginęła do zera).

### Śmierć
głód · **drapieżnik** · zdrowie ≤ 0 (senescencja po 60 % życia obniża pułap zdrowia do 0,3; zimno zadaje obrażenia ∝ obciążenie²) · wiek ≥ `lifespanBase · m^¼` ·
wypadek (`accidentRate`/tick) · katastrofa. Energia zmarłego wraca do komórki jako pokarm (`corpseRecycling`, reszta → ciepło).

### Reprodukcja
Warunek: wiek ≥ dojrzałość, ≥ 40 ticków od ostatniego porodu, energia ≥ max(próg·pojemność, koszt + 15 % pojemności), populacja < limit; reprodukcja następuje po fazie śmierci (zmarli się nie rozmnażają).

* **Bezpłciowa (domyślnie, `sexual = 0`)**: rodzic płaci `inwestycja·(1+narzut)`; potomek dostaje `min(inwestycja, jego pojemność)`, nadwyżka wraca do gleby, narzut jest ciepłem. Klon z mutacjami.
* **Płciowa (`sexual = 1`)**: inicjator (spełniający warunek energetyczny) szuka najbliższego **gotowego** partnera w zasięgu `mateRange` (ponad sumę promieni); obaj muszą być dojrzali,
  poza karencją i mieć energię na swoją połowę kosztu. Każdy rodzic wnosi połowę swojej inwestycji i płaci połowę narzutu. Genom dziecka: cechy od losowego rodzica (osobno),
  wagi **neuron po neuronie** (neuron ukryty dziedziczy komplet wag wejściowych, bias i wagi wyjściowe od jednego rodzica — współdziałające wagi nie są rozrywane), biasy wyjść losowo; potem mutacje.
  Każdy organizm może być rodzicem tylko raz na tick. Przy `mateChoice=1` obaj rodzice akceptują fenotyp partnera według dziedzicznych preferencji i selektywności; wybierany jest najbliższy gotowy i zgodny partner. Brak partnera = brak rozrodu.

**Reprodukcja uruchamia się automatycznie po spełnieniu warunków energetycznych** — mózg o niej nie decyduje (to świadome uproszczenie, patrz §8).

### Mutacje
Przy narodzinach każdy gen mutuje z prawdopodobieństwem `mutationRate` (0,04): wagi `+N(0, mutationStrength=0,2)` (|w| ≤ 6), cechy `+N(0, 0,05)` obcięte do [0,1];
`hue` zawija się modulo 1. Rejestr mutacji (indeks genu → nowa wartość) trafia do genealogii; w trybie płciowym rejestr opisuje wszystkie różnice względem pierwszego rodzica (rekombinacja jest w nim zawarta).

## 5. Środowisko i zdarzenia

* Temperatura = `baseTemperature` − (pory roku, ochłodzenie), komfort = 1. Deficyt → **obciążenie zimnem** = deficyt − 0,6·gen_odporności (≥ 0) → mnożnik metabolizmu i obrażenia.
* Pory roku: fala trójkątna o okresie `seasonPeriod` obniża temperaturę i tempo wzrostu zimą.
* Zdarzenia: **susza** (mnożnik wzrostu ↓), **obfitość** (↑), **ochłodzenie**, **katastrofa** (losowa część populacji ginie, opcjonalnie w obszarze), **zaraza** (część zasobów znika).
  Zdarzenia trwające mają wygaszanie na brzegach. Mogą być zaplanowane z góry (`setup.schedule`) lub wywołane ręcznie (dziennik poleceń).

## 6. Statystyki i genealogia (pamięć ograniczona)

* **Statystyki**: 50 kolumn (populacja, narodziny, zgony wg przyczyny, wiek, energia, pokolenia, zasoby, różnorodność, udział drapieżników, energia przejęta, udział największego kladu i liczba kladów, średnie i σ cech…). Bufor stałej wielkości (4096 wierszy);
  po zapełnieniu sąsiednie wiersze są scalane (suma/średnia/maks.), a interwał próbkowania się podwaja.
* **Różnorodność**: średnie σ cech funkcjonalnych oraz średnia odległość RMS 64 deterministycznie dobranych par genomów.
* **Genealogia** (`lineage.ts`): kolumnowe tablice; na organizm id, rodzic, pokolenie, narodziny/śmierć, liczba potomstwa, 16 cech przy narodzinach, rzadka lista mutacji.
  Pełny genom dowolnego przodka = genom założyciela + nałożone listy mutacji wzdłuż ścieżki (test: odtworzony genom == rzeczywisty).
  Dla rozmnażania płciowego węzeł ma też drugiego rodzica (retencjonowanego, dopóki żyje potomek); drzewo potomków biegnie po pierwszym rodzicu.
  **Przycinanie**: martwy węzeł bez żyjących/zapiętych potomków jest usuwany po 20 000 ticków od śmierci (oraz agresywniej po przekroczeniu 600 tys. węzłów).
  **Scalanie łańcuchów**: martwy węzeł z dokładnie jednym potomkiem (i bez innych odwołań) jest wycinany, a jego rejestr mutacji łączony z rejestrem potomka — genom pozostaje odtwarzalny co do bitu,
  tracimy tylko migawkę cech pośrednich przodków. Dzięki temu genealogia przestaje rosnąć liniowo z liczbą pokoleń (patrz test soak).
  Przodkowie żywych organizmów nie znikają nigdy; wymarłe, nieistotne linie — tak. Zaznaczony organizm jest „zapinany”.
* **Klady**: każdy organizm dziedziczy indeks założyciela pierwszego rodzica. Statystyki liczą udział największego kladu i liczbę żyjących kladów; przekroczenie 50 % / 90 % populacji trafia do dziennika jako „wymiatanie”.

## 7. Zapis

Binarny kontener `.genesis` (gzip): nagłówek JSON z wersją formatu (`FORMAT_VERSION = 4`) + sekcje typowanych tablic (zasoby, biomy, pula organizmów, genealogia, statystyki).
Wznowiony świat jest bit‑w‑bit identyczny z nieprzerwanym w tej samej wersji silnika (`tests/serialize.test.ts`). Zapisy v1 są odrzucane. Format v2 migruje geny, wagi, mutacje, założycieli i statystyki; v3 otrzymuje wyłączone biomy i zerowe pomiary migracji. Oba są wczytywane do v4. Zgodność trajektorii między różnymi wersjami silnika nie jest obiecywana.
Zapis nie obejmuje parametrów retencji genealogii (domyślne przy wczytaniu).

## 8. Co jest narzucone, a co wyłania się samo

**Narzucone przez projekt (prawa świata):** koszty i ich wykładniki, logistyczny wzrost zasobów i dynamika plam, reguła podziału pokarmu, mechanika transferu energii przy ataku,
struktura percepcji (23 wejścia, regulowane pole widzenia), architektura mózgu (23‑8‑9, stała topologia, rekurencja przez 3 komórki pamięci), operator mutacji i rekombinacji, rozmnażanie uruchamiane progiem energetycznym,
mechaniczny wybór partnera, zasady śmierci, odbicie od ścian, automatyczna regeneracja zdrowia, neutralność genu `hue`, **istnienie** zdolności ataku i pamięci oraz mieszana dieta założycieli.

**Nie jest zaprogramowane (może się wyłonić):** konkretne połączenia sieci, a więc to, czy organizm reaguje na pokarm, sąsiadów, głód; **czy w ogóle atakuje i kogo**; **czy i jak używa pamięci**;
rozkład cech i diety w populacji; rozmiar i strategia życiowa; współistnienie lub wymarcie drapieżników; przestrzenne skupiska linii; dynamika populacji. Nie istnieje funkcja fitness — sukces to faktyczne rozmnożenie się.

**Czego silnik NIE wykazuje (i dlatego nie należy tego twierdzić):** planowania, wyewoluowanej współpracy, trwałej specjacji lub rozpoznawania krewnych. Kanał sygnału i wybór partnera są mechanikami, a ich wykorzystanie wymaga pomiaru. Pamięć istnieje architektonicznie; że jest *używana i się opłaca* pokazuje
dopiero test ablacji (§10) — i nadal nie mówi, co dokładnie sieć z nią robi.

## 9. Znane ograniczenia modelu

Liczbowe wyniki w poniższych punktach to **historyczne pomiary v0.3**. Nie są deklaracją wyników długiej ewolucji v0.4.

* **Allometria sprzyja małym ciałom** w żyznych światach bez drapieżników: mniejsze organizmy mają niższy próg przeżycia i taniej się rozmnażają; rozmiar spada do minimum w ciągu ~20–40 tys. ticków.
  **Z drapieżnictwem (domyślnie) w 3 seedach i 80 tys. ticków rozmiar nie schodził do minimum** (średnio 0,09–0,25), a różnorodność cech była 3–5× wyższa. W świecie o wolnym wzroście zasobów
  (`regrowthRate≈0,02`, bez drapieżników) obserwowano odwrotnie: większe ciała i cykle populacji. Wyniki zależą więc silnie od środowiska — to cecha modelu, nie błąd.
* **Dziedziczenie klonalne** (tryb domyślny): cały genom dziedziczy się razem, więc geny słabo selekcjonowane „doczepiają się” do skutecznych mózgów (hitchhiking). Pojedyncze seedy dają przez to zaszumione wyniki
  dla cech o słabym efekcie; wnioski wymagają serii seedów (runner, przeszukiwanie, test A/B). Tryb płciowy to osłabia, ale go nie usuwa.
* Najmniejszy możliwy sensor (12 j.) wystarcza do lokalnej taksji względem gradientu pokarmu (komórka 16 j.), więc selekcja często obniża zasięg sensorów; dalekie zmysły mają sens tylko tam, gdzie zasoby są rozproszone.
* Rywalizacja o pokarm jest kontaktowa; interakcje bezpośrednie to wyłącznie drapieżnictwo (energia). Brak kolizji fizycznych.
* Drapieżnicy bywają krótkotrwali: w jednym z testowych przebiegów ich udział spadał z 25 % do ~10 %. Długie przebiegi mogą kończyć się wymarciem drapieżników — to wynik, nie awaria.
* Scalanie łańcuchów genealogii usuwa migawki cech pośrednich przodków i ich numery pokoleń (numer pokolenia potomka jest zachowany). Przycinanie usuwa wymarłe linie starsze niż okno retencji.
* Zgodność między silnikami JS (V8/JavaScriptCore/SpiderMonkey) wynika z użycia samej arytmetyki IEEE‑754, ale była testowana tylko w Node (V8) i Chrome.

## 10. Narzędzia analityczne (`src/engine/analysis.ts`, `statsutil.ts`, `experiment.ts`)

* **Sondy zachowań**: podają sieci pary syntetycznych wejść i mierzą odruch (np. skręt w stronę pokarmu). Porównywane z losowymi sieciami (z = odchylenie w błędach standardowych). Wykrywają tylko proste odruchy.
* **Test ablacji kohortowej** — jedyne narzędzie mierzące *indywidualną korzyść* ze zmysłu: w kopii świata połowa organizmów (nieparzyste id) ma wejścia grupy podstawione **średnią populacji**
  (znika informacja, nie zmienia się punkt pracy sieci), druga połowa jest nienaruszona; porównujemy przeżycie i potomstwo w oknie (domyślnie 400–500 ticków). Odejmowany jest kontrast zerowy
  (ta sama procedura bez ablacji). Walidacja metody: czucie temperatury (stałe wejście) daje dokładnie 0; sieć o ręcznie wbudowanej taksji wyraźnie traci bez zmysłu pokarmu (test jednostkowy).
  Uwaga: ablacja „wszyscy naraz” była odrzucona — myli efekt zmysłu z efektem ekologicznym (np. bez zmysłu sąsiadów drapieżnicy nie widzą ofiar, więc populacja rośnie).
  Przy 14 porównaniach |z| ≈ 2–3 zdarza się przypadkiem; za istotne traktuj |z| ≥ 3.
* **Strategie**: k-średnie (deterministyczne, k-means++) po 10 cechach funkcjonalnych; etykiety z najsilniejszych odchyleń centroidu od średniej populacji.
* **Przeszukiwanie parametrów i test A/B**: siatka 1D/2D × seedy, metryki (populacja, pokolenia, różnorodność, udział drapieżników, klady, średnie cechy, wymarcie), 95 % przedziały ufności (t‑Studenta)
  i test t dla sparowanych seedów w A/B (Welch pozostaje API dla niezależnych grup). Brak korekty na wielokrotne testowanie.


## 11. Rozszerzenia v0.4 — dokładne mechanizmy i dostęp w UI

### Dwa pokarmy

`plantBShare=0` wyłącza B. Po włączeniu A/B dzielą łączną pojemność, a deterministyczny wzorzec siedlisk ustala udział B (pełny mnożnik w 1/4 komórek, 0,15 w pozostałych). Bazowa sprawność roślin wynika z kęsa i diety. Dla specjalizacji `s`: sprawność A to bazowa × `(1−0,7s)`, sprawność B to bazowa × `(0,2+0,8s)`. Jedno wyjście jedzenia pobiera A/B według dostępności i specjalizacji. B może uszkadzać zdrowie; specjalizacja B zmniejsza toksyczność. Straty trawienia trafiają do księgi energii.

Preset **Dwa pokarmy**, kolor **Pokarm A/B**, warstwy zasobów turkus/bursztyn i obserwacje pobranego A/B w karcie organizmu udostępniają mechanikę.

### Percepcja i teren

`viewCos` jest kosinusem połowy pola widzenia: −1 = 360°, 0 = przednia półkula. Włączone bariery deterministycznie ograniczają ruch, linię widzenia i kontakt, mają przejścia i nie produkują pokarmu. Pozycja w barierze jest korygowana. Kierunek każdego pokarmu pozostaje agregatem **widocznych komórek**, a nie listą obiektów ani pełną mapą; nowego systemu promieni sensorycznych nie ma. Obrót zmienia informacje dostępne sieci.

Preset **Ograniczony wzrok**, szare komórki terenu oraz sektor zasięgu zaznaczonego organizmu pokazują te ograniczenia.

### Sygnały

Nowe wejścia to podpisana ilość i składowe przód/lewo lokalnego sygnału; nowe wyjście to podpisana emisja ∈ [−1,1]. Odbiór korzysta z emisji **poprzedniego ticku**, nie z częściowo zaktualizowanej populacji. Sygnał słychać w zasięgu sensorów także poza wzrokowym polem widzenia, ale nie przez barierę. Emisja kosztuje `signalCoef × |sygnał| × masa^0,75`. Znaki nie mają wbudowanego znaczenia. Nakładka **Sygnały** i kolor **Sygnał** używają błękitu dla dodatnich, różu dla ujemnych wartości.

Ablacja **Odbiór lokalnych sygnałów** porównuje nienaruszoną i pozbawioną informacji kohortę; stałe średnie zastępują wejścia odbioru. Korzyść odbioru nie dowodzi sama w sobie współpracy lub ostrzegania.

### Wybór partnera i pomiar izolacji

Fenotyp partnera to `0,7 × plantSpecialization + 0,3 × diet`. Gen `matePreference` określa preferowany fenotyp, a tolerancja to `1−0,95 × mateSelectivity`. Obaj partnerzy muszą się zaakceptować. Geneza grup nie jest narzucona przez etykiety.

Atlas analizuje składowe wzajemnej zgodności w deterministycznej próbce najwyżej 64 organizmów. Grupy są **kandydatami**, bez trwałych identyfikatorów; rzadkie grupy i osobniki łączące grupy mogą zostać pominięte. Osobne trwałe liczniki rejestrują udane i odrzucone kojarzenia **w obrębie/między dwoma profilami pokarmowymi** (`s<0,5` / `s≥0,5`). Udział krzyżowań A/B jest obserwowanym przepływem między tymi profilami, nie automatycznie między gatunkami. Przy rozrodzie klonalnym brak takiej miary. Tabela kolejnych obserwacji w sesji i Historia pozwalają badać rozdzielenie w czasie; potwierdzenie trwałej specjacji wymaga dalszych eksperymentów.

### Plastyczność

Genom pozostaje germinalny. `somaticWeights` przechowuje osobno delty wag, `eligibility` ślady współaktywacji, a `mem` trzy stany pamięci. Ślad jest aktualizowany przez `0,9 × stary + 0,1 × współaktywacja`. Nagroda to `clamp(10 × zmianaE / maxE, −1,1)` przed kosztami rozrodu. Zmiana efektywnej wagi zależy od `plasticityRate × gen plasticity × nagroda × ślad`; efektywne wagi są ograniczone do ±6. Uczenie kosztuje `learnCoef × gen plasticity × masa^0,75`. Koszt utrzymania mózgu uwzględnia efektywne wagi.

Potomstwo dostaje genom, bez nauczonych delt, śladów i pamięci. Uczenie może pomagać lub szkodzić; nie ma gwarancji poprawy. W karcie organizmu przełącznik **sieć po uczeniu** odróżnia efektywne krawędzie od genomu; aktywacje są bieżącym efektywnym stanem.

### Konstrukcja niszy

Wyjście kultywacji jest skalowane genem `nicheInvestment`. Organizm płaci `cultivationCoef × wysiłek × masa^0,75`; inwestycja zmienia lokalną warstwę `niche` do maksimum 1. Łączna pojemność gleby jest ograniczona do `foodCapMax × min(2, żyzność+niche)`. `nicheDecay` powoli usuwa zmianę. Organizm przenosi niewielką ilość nasion pobranych podczas żerowania i odkłada je poza komórką źródłową; nasiona wpływają na zalążek wzrostu. Nie dodajemy energii przy samej zmianie pojemności: wpływem energii jest księgowany odrost.

Nakładka **Nisza** pokazuje zmianę na fioletowo; karta organizmu mierzy inwestycję i przeniesione nasiona. Stan środowiska jest zachowany w zapisie i historii.

### Atlas i laboratorium

Atlas czyta rzeczywiste liczniki ruchu, żerowania, polowań, powrotów i ekspozycji/ucieczki, a nie geny. Opisowe reguły grupowania są jawne w `behavior.ts`; poniżej 30 ticków wynik to „za mało danych”. Powroty odnoszą się do ograniczonej pamięci odwiedzonych komórek, a ucieczki do pomiaru ruchu względem zaobserwowanego zagrożenia. Te etykiety nie dowodzą intencji.

Okaz w osobnym IndexedDB zawiera kompletny genom, delty, ślady, pamięć, pochodzenie, metryki, ostatnie 32 próbki trajektorii i wyniki prób. Eksport/import JSON waliduje dane i wersję. Trajektoria jest ograniczonym nagraniem pozycji, bez całego tła świata. Genom przodka rekonstruujemy z genealogii; jego nieznanego stanu somatycznego nie wymyślamy. Parametry dołączone do takiego genomu opisują moment jego pobrania, nie jego narodzin.

Laboratorium tworzy **genotyp A/B × dwa środowiska**. Każda komórka startuje z najwyżej 8 kopiami jednego genotypu, tym samym seedem rozmieszczenia i RNG, 60% energii, wiekiem 0 i zdrowiem 1. Potomstwo pozostaje w próbie; wyniki przeżycia i reprodukcji odnoszą się do początkowej kohorty. Pełny zapis środowiska zachowuje mapę, tick i zdarzenia; nowa mapa według parametrów jest oznaczona osobno. Bilans energii jest rebazowany po kontrolowanym zasiedleniu. W próbie genetycznej stan somatyczny jest zerowany; w somatycznej przywracany z okazu. Genetyczna interwencja zmienia dokładnie jeden prawidłowy locus, a interwencja somatyczna dodatkowo sprawdza zakres efektywnych wag.

Próba pamięci daje przeciwną wskazówkę pokarmową, czeka 0/5/20/60 ticków, a następnie porównuje reakcje przy identycznym bieżącym bodźcu, z kontrolą wejść pamięci. Wykrywa historię, nie planowanie. Analiza A/B dopasowuje unikalne seedy i używa przedziału t dla różnic. Brak korekty wielokrotnych porównań.

### Historia

`WorldHistory` przechowuje pełne punkty co 1000 ticków, domyślnie najwyżej 24 i 64 MiB, plus uporządkowane polecenia/zaznaczenia (maksimum 20000). Retencja może skrócić dostępny zakres. Do wybranego ticku odtwarza się kopię od najbliższego punktu z działaniami w ich pierwotnej kolejności; stan w danym ticku obejmuje zastosowane działania tego ticku. Zaznaczenia są rejestrowane, ponieważ wpływają na pinowanie genealogii.

Podgląd zatrzymuje żywy świat i zachowuje jego teraźniejszość. Mutacje i żywe kroki są zablokowane w podglądzie; rozwidlenie tworzy nowy świat z wyświetlanego stanu. Eksport/import `.genesis-history` zachowuje dostępne punkty, działania i teraźniejszość. Zwykły `.genesis` jest pojedynczym stanem i nie zawiera całego archiwum historii.

## 12. Lokalne biomy i sterowanie v0.5

Mapa zależy od seeda i współrzędnych, bez pobierania losowości symulacji. Trzy statyczne profile mają następujące czynniki przy pełnym kontraście:

| Biom | Zmiana temperatury | Mnożnik żyzności | Mnożnik udziału B | Mnożnik siły sezonu |
|---|---:|---:|---:|---:|
| Umiarkowany | 0 | 1 | 1 | 1 |
| Chłodny | −0,4 | 0,6 | 0,3 | 1,5 |
| Ciepły | +0,12 | 1,4 | 1,8 | 0,5 |

`biomes>=0.5` włącza mechanikę. `biomeContrast=c` interpoluje mnożniki jako `1+c×(czynnik−1)` oraz skaluje przesunięcie temperatury. Kontrast 0 daje jednolite warunki. Lokalna temperatura uwzględnia bazę, ochłodzenia i miejscową siłę sezonu; jest ograniczona do 0…1,2. Ta sama wartość trafia do fizjologii i wejścia temperatury mózgu. Lokalny wzrost uwzględnia sezon i zdarzenia. Żyzność bazowa i kultywowana gleba tworzą wspólną pojemność energetyczną A/B; zmiana pojemności sama nie dodaje energii.

`biomeSnapshot` pokazuje liczbę komórek, populację, energię A/B, średnią lokalną temperaturę, narodziny, zgony oraz macierz rzeczywistych przejść. Przejście jest liczone przy ruchu przez granicę biomu; narodziny, aktywowanie mechaniki, korekta pozycji przez bariery i odczyt zapisu nie tworzą migracji. Licznik okazu i macierz świata zachowują zdarzenia z czasu działania modułu. Liczebność siedliska nie jest miarą adaptacji bez uwzględnienia rozrodu, zgonów i migracji.

Mapa **Biomy** pokazuje profile terenu; przy wyłączonej mechanice pozostaje jawnie oznaczonym wzorem bez lokalnego wpływu. Mapa **Temperatura** pokazuje rzeczywiste warunki: niebieski 0 → czerwony 1,2 w względnej skali modelu, nie stopnie Celsjusza. Panel Biomy pozwala odczytać wartości i przepływy.

Panel **Moduły** udostępnia rzeczywiste parametry biologii. Włączenie wyboru partnera uruchamia rozród płciowy; jego wyłączenie wyłącza też wybór partnera. Booleanowe mechaniki mają próg 0,5, stopy dodatnie działają powyżej zera, a ograniczone pole widzenia przy `viewCos>-1`. Wyłączenie B poleceniem zamienia B w A bez utraty energii. Uczenie wyłączone zachowuje wagi, lecz zatrzymuje nowe zmiany; kultywacja wyłączona zachowuje wcześniejsze dziedzictwo gleby. Zestawy nie nadpisują aktywnych własnych wartości mechanik. **Widok** zmienia tylko widoczność paneli i nie wpływa na silnik.

Sześć prowadzonych lekcji zmienia oddzielnie komunikację, wybór partnera, uczenie, pole widzenia, kultywację lub biomy. Kontrola i wariant korzystają z tego samego seeda, a statystyki są porównywane w faktycznym wspólnym ticku i równych oknach agregacji. Do interpretacji wymagane są skończone pomiary; ręczne interwencje lub przeładowanie unieważniają kontrolę, a podgląd historii wstrzymuje przewodnik. Wynik zerowy i wczesne wymarcie pozostają danymi. Jedna para, emisja sygnału, zmiana wag lub rozkład organizmów nie potwierdzają hipotezy o korzyści, współpracy lub adaptacji. Interpretacja wymaga dodatkowych seedów oraz prób kontrolnych.

Okazy Atlasu 0.4 zachowują pochodzenie, genom, pamięć, delty wag, ślady i wersję dawnych prób. Brakujące pola biomów są normalizowane do wyłączonej mechaniki i zerowych liczników. Nowe próby działają w 0.5 i pokazują tę różnicę; zachowanie genotypu nie gwarantuje zgodności trajektorii między silnikami.
