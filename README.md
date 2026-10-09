# GENESIS — laboratorium sztucznego życia i ewolucji

**[▶ Uruchom w przeglądarce](https://k3dzi0r.github.io/genesis/)** · [dokumentacja mechaniki](docs/MECHANICS.md) · [architektura](docs/ARCHITECTURE.md) · licencja MIT

Eksperymentalne laboratorium ALife w przeglądarce. Organizmy z dziedzicznymi genomami i małymi sieciami neuronowymi (z pamięcią rekurencyjną) żyją w świecie 2D z jawnym bilansem energii,
mogą się odżywiać roślinnością albo atakować inne organizmy i rozmnażać się bezpłciowo lub płciowo.
Nie ma funkcji fitness ani zaprogramowanych zachowań: sukces to rozmnożenie się, a to, co organizmy faktycznie robią, wynika z ewoluujących wag sieci.

> **Status: wersja 0.3.0 — działający silnik ewolucyjny + interfejs; Fazy 1 i 2 w całości, z Fazy 3: drapieżnictwo, rozwinięty mózg (pamięć), rozmnażanie płciowe.**
> Komunikacja, zachowania społeczne i ewolucja topologii sieci (NEAT) **nie są** zaimplementowane.

## Szybki start

```bash
npm install
npm run dev          # http://localhost:5173 (lub kolejny wolny port)
npm test             # testy silnika i spójności treści edukacyjnych
npm run build        # build produkcyjny do dist/
npm run typecheck
```

Wymagania: Node ≥ 20, przeglądarka z WebGL2 (Chrome, Edge, Safari ≥ 15, Firefox).

Strona z repozytorium wdraża się sama na GitHub Pages (workflow `.github/workflows/pages.yml`: typecheck → testy → build → publikacja). Cała symulacja działa w przeglądarce użytkownika;
zapisy trafiają do jego IndexedDB, serwer nie przechowuje żadnych danych.

### Długie eksperymenty bez UI (headless)

```bash
npm run headless -- --ticks 1000000 --seed 7 --out runs/exp1 --checkpoint 100000 --report 20000
npm run headless -- --resume runs/exp1/latest.genesis --ticks 3000000 --out runs/exp1   # wznowienie
npm run analyze  -- runs/exp1/latest.genesis --ablation                                 # strategie, sondy, test ablacji
```

Pliki `.genesis` (punkty kontrolne) można zaimportować w przeglądarce: **Zapisy → Importuj plik**. Opcje: `--setup '{"width":1200,"height":1200,"initialPopulation":800}'`,
`--params '{"predationPower":6,"sexual":1}'`. Zapisy ze starszych wersji silnika (≤ 0.2) są odrzucane z komunikatem — zmienił się układ genomu.

## Co działa (sprawdzone testami lub ręcznie w przeglądarce)

| Obszar | Stan |
|---|---|
| Świat 2D, siatka zasobów z logistycznym wzrostem, mapa żyzności (plamy/gradient/oaza/jednolity) | ✅ |
| **Dynamiczne plamy żyzności**: dryf i cykl życia (rosną, wygasają, odradzają się gdzie indziej) | ✅ (testy + UI) |
| Bilans energii z księgą wpływów/strat; niezgodność rzędu 1e‑5 przy przepływie energii rzędu 1e7 po milionie ticków (zaokrąglenia), także z drapieżnictwem, płciowym rozrodem i ruchomymi plamami | ✅ (testy + wskaźnik w UI) |
| Organizmy: tożsamość, rodzice, pokolenie, wiek i limit życia, energia, zdrowie, fizjologia z kompromisami | ✅ |
| Genom (11 cech + 207 wag), dziedziczenie, mutacje o regulowanej intensywności, rejestr mutacji | ✅ |
| Sieć 17‑8‑7 z **pamięcią rekurencyjną** (3 komórki, trwałość kodowana genem) i wejściami o cechach sąsiada | ✅ |
| **Drapieżnictwo**: atak jako zdolność (gen diety), transfer energii z kosztem, sprawiedliwy podział między napastników; kaskady troficzne | ✅ (testy dokładnego transferu + przebiegi) |
| **Rozmnażanie płciowe**: wybór partnera w zasięgu, rekombinacja neuron po neuronie, drugi rodzic w genealogii | ✅ (testy + przebiegi) |
| Reprodukcja z kosztem, śmierć (6 przyczyn), limit populacji z energii + twardy bezpiecznik | ✅ |
| Siatka przestrzenna zamiast O(n²) (test zgodności z wersją naiwną) | ✅ |
| Deterministyczny RNG; ten sam seed + konfiguracja → identyczny stan, niezależnie od FPS i tempa | ✅ (testy) |
| Zapis/odczyt pełnego stanu, wersjonowany format, autozapis (IndexedDB), eksport/import plików; wznowiony świat identyczny bit w bit | ✅ (testy + UI) |
| Genealogia: trwałe id, drzewo przodków/potomków, odtwarzanie genomu przodka, porównanie przodek↔potomek, trajektorie cech wzdłuż linii, **scalanie łańcuchów** (ograniczony wzrost w długich przebiegach) | ✅ (testy + UI) |
| **Klady** (linie założycieli): udział największego kladu, liczba kladów, wykrywanie „wymiatania” | ✅ |
| Statystyki i wykresy (populacja, cechy, energia, różnorodność, pokolenia, zgony wg przyczyn, drapieżnictwo, klady, przepływ energii), ograniczona pamięć | ✅ |
| Zdarzenia: susza, obfitość, ochłodzenie, katastrofa, zaraza, pory roku, dosypywanie zasobów; dziennik poleceń i historia parametrów | ✅ |
| Wykrywanie wymarcia, gwałtownych spadków/wzrostów populacji i wymiatania kladów | ✅ |
| Wiele światów równolegle, **bliźniak**, **rozwidlenie**, porównanie metryk, seria seedów z 95 % CI, eksport CSV/JSON | ✅ |
| **Przeszukiwanie parametrów** (siatka 1D/2D × seedy, mapa cieplna) i **test A/B** (przedziały ufności, test Welcha) | ✅ (testy + UI) |
| **Test ablacji kohortowej**: czy zmysł (pokarm, sąsiedzi, pamięć, energia…) opłaca się indywidualnie | ✅ (testy + UI + CLI) |
| **Klastrowanie strategii** (k-średnie, nazwy z odchyleń cech) i sondy zachowań vs losowe sieci | ✅ |
| **Warstwa edukacyjna**: ~190 haseł słownika, ponad 60 symboli „?” w interfejsie (hover = skrót, klik = pełny opis z ciekawostką i powiązaniami), 11 lekcji z gotowymi eksperymentami i zmierzonymi wynikami, ekran powitalny | ✅ (testy spójności treści + UI) |
| Renderer WebGL2 (zoom, przesuwanie, zaznaczanie, nakładki: zasoby, sensory, energia, ślad, gęstość, podążanie; 7 trybów koloru, m.in. dieta i klad) | ✅ |
| Tryb headless z punktami kontrolnymi i wznawianiem (`npm run headless`) | ✅ |

**Nie zweryfikowane:** Safari/Firefox, sterowanie dotykiem na tabletach (układ jest responsywny, ale nie testowany na urządzeniu), odzyskiwanie po utracie kontekstu WebGL, światy > ~10 tys. organizmów,
zgodność bitowa między różnymi silnikami JS (silnik używa wyłącznie arytmetyki IEEE‑754, ale testowano Node/V8 i Chrome).

**Plan (niezaimplementowane):** komunikacja, zachowania społeczne, preferencje partnera i specjacja, NEAT, mózg decydujący o rozrodzie, biomy/teren, moduł Rust/WASM, WebGPU, backend sieciowy,
suwak odtwarzania historii. Punkty zaczepienia opisuje [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Interfejs

* **Środek** — żywy świat. Kółko myszy = zoom, przeciąganie = przesuwanie, klik = zaznaczenie organizmu. Chipy: Zasoby, Sensory, Energia, Ślad, Gęstość, Podążaj; lista „Kolor” (linia, strategia, energia, pokolenie, wiek, dieta, klad).
* **Pasek sterowania** — Start/Pauza (Spacja), Krok (`.`), +100, tempo 1×/10×/100×/1000×/MAX (klawisze 1–5; 1× = 30 ticków/s), Esc = odznacz.
* **Lewy panel** — *Środowisko*: zdarzenia, dosypywanie zasobów, wszystkie parametry na żywo (w tym drapieżnictwo, rozmnażanie, dryf plam) · *Eksperyment*: seed, nowy świat ze scenariuszem (12 presetów),
  bliźniak/rozwidlenie/reset, seria seedów, **test A/B**, **przeszukiwanie parametrów**, eksporty · *Zapisy*.
* **Prawy panel** — *Statystyki* (KPI, strategie, sondy zachowań, test ablacji, wykresy) · *Organizm* (fizjologia, pamięć, schemat sieci z aktywacjami, genom) · *Genealogia* (drzewo, cechy wzdłuż linii, porównanie z przodkiem) · *Porównanie* światów · *Dziennik*.

## Aspekt edukacyjny

Aplikacja ma uczyć, nie tylko pokazywać. Zakładka **Nauka** (przycisk w górnym pasku lub klawisz `?`) zawiera:

* **Start** — czym jest GENESIS, jak czytać planszę, losowa ciekawostka;
* **Lekcje** — 11 gotowych eksperymentów (dobór naturalny, kaskada troficzna, efekt założyciela, mutacje, płeć, pory roku, wąskie gardło, test ablacji, test A/B…). Jedno kliknięcie tworzy światy i otwiera
  odpowiednią zakładkę. Przy każdej lekcji podane są hipoteza, na co patrzeć i **co faktycznie zmierzono** w testach autora — także gdy hipoteza się nie sprawdziła (lekcja o wędrujących plamach);
* **Słownik** — ok. 190 haseł z wyszukiwarką i działami (Symulacja, Świat, Organizm, Mózg, Ewolucja, Ekologia, Analiza i statystyka, Interfejs). Każde hasło ma skrót, rozwinięcie, „Spróbuj”, ciekawostkę i powiązania.

Symbol **?** jest przy suwakach, wykresach, wskaźnikach, polach karty organizmu, przyciskach i nakładkach: najechanie pokazuje skrót, kliknięcie przypina dymek z pełnym opisem (Esc zamyka, „Otwórz w słowniku” przenosi do hasła).
Ekran powitalny pokazuje się przy pierwszej wizycie (można go wyłączyć i przywołać przyciskiem „Nauka”).

Zasady treści: każde twierdzenie o GENESIS odpowiada temu, co robi silnik; ciekawostki to sprawdzalne fakty z nazwiskiem lub rokiem; liczby w lekcjach pochodzą z pomiarów (skrypty headless, wersja 0.3.0);
`tests/help.test.ts` pilnuje, że każdy parametr i gen ma wyjaśnienie, powiązania nie są martwe, klucze się nie dublują, a lekcje używają istniejących parametrów.
Treści leżą w `src/ui/help/` (pojęcia, parametry, analiza, interfejs, lekcje) — dodanie hasła to jeden wpis w odpowiednim pliku.

## Reprodukowalność

Wynik zależy od: ustawień świata, seeda, wersji silnika (`ENGINE_VERSION`) oraz dziennika poleceń. Zmiany parametrów i zdarzenia ręczne są logowane z tickiem;
„Bliźniak od startu” uruchamia świat o identycznych warunkach początkowych — dopóki nie zastosujesz interwencji tylko w jednym z nich, ich trajektorie są identyczne (sprawdzone w UI i w testach).
Seria seedów, przeszukiwanie parametrów i test A/B uruchamiają tę samą konfigurację dla wielu seedów i liczą średnie z przedziałami ufności.

## Uczciwość wyników — czytaj przed wyciąganiem wniosków

Szczegóły i ograniczenia: [docs/MECHANICS.md](docs/MECHANICS.md). Najważniejsze obserwacje z testowych przebiegów (domyślny świat, 800×800, 400 założycieli, seedy 1–3 i 5):

* **Drapieżnictwo samo się utrzymuje i zmienia wszystko.** Z domyślnym atakiem drapieżnicy (dieta > 0,3) współistnieją z roślinożercami w 3 seedach przez 80 tys. ticków (9–25 % populacji, ok. 800–2400 zgonów
  z ich rąk na 1000 ticków). Zasoby stoją wtedy na 15–80 % pojemności (ofiary są przetrzebione — kaskada troficzna), różnorodność cech jest 3–5× wyższa niż bez drapieżników, a rozmiar ciała nie spada do minimum.
  W jednym teście ze słabszym atakiem (`predationPower = 2`) drapieżnicy wymarli, a zdolność ataku zniknęła z genomów.
* **Drapieżnicy nie są trwali.** W przebiegu 1 mln ticków (seed 5, ~1600 pokoleń) wymarli między 700 a 900 tys. ticków; potem populacja zbiegła do małych (rozmiar 0,05), prawie ślepych (zasięg 0,06) roślinożerców,
  różnorodność spadła o połowę, a pozostał jeden klad. Bez drapieżników nic nie przywraca zdolności ataku — to stan pochłaniający.
* **Które zmysły się opłacają** (test ablacji kohortowej: połowa organizmów traci zmysł w tym samym świecie; zbadano 5 populacji — seedy 1–3 po 80 tys. ticków oraz seed 5 po 500 tys. i po 1 mln):
  **zmysł pokarmu** zwiększał przeżycie w 4 z 5 populacji (+22 do +55 pp, z = 6–21) i liczbę potomstwa w 5 z 5 (z = 4–20); **zmysł sąsiadów** — słabo i niespójnie (z ≈ 0–6);
  **pamięć rekurencyjna** opłaciła się w 2 z 3 seedów po 80 tys. ticków (przeżycie +21 i +10 pp, z = 5,7 i 3,4; potomstwo +0,45 i +0,16), była na granicy istotności w seedzie 5 po 500 tys. ticków
  (potomstwo, z = 2,8) i **nie dawała przewagi po wymarciu drapieżników**. Czucie temperatury (stałe wejście) wychodzi dokładnie 0 — kontrola metody.
  Test mówi, że zmysł jest używany i się opłaca, **nie mówi, co sieć z pamięcią robi**; to pojedyncze pomiary na kilku seedach, bez korekty na wielokrotne testowanie.
* **Sondy zachowań** (vs losowe sieci): u wszystkich zbadanych populacji wyewoluował odruch skrętu w stronę pokarmu (z ≈ 10–95) i unikania sąsiadów (z ≈ 21–72). To **proste odruchy** z bardzo małej sieci.
  **Nie ma tu dowodu na planowanie ani „inteligencję”**, i żaden eksperyment tego nie deklaruje.
* Bez drapieżników (preset „Bez drapieżników”) ewolucja zwykle kończy się małymi, tanimi, prawie ślepymi organizmami — żyzne środowisko bez presji nie nagradza złożoności.
* Reprodukcja jest uruchamiana progiem energetycznym (mózg o niej nie decyduje); genom dziedziczy się klonalnie (efekt hitchhikingu) — pojedynczy seed bywa zdominowany przez dryf, dlatego warto używać serii.
  Tryb płciowy w testach (5 seedów) dawał więcej żyjących kladów (5,0 vs 2,6), ale nie wyższą różnorodność cech (0,12 vs 0,15).
* Przycinanie i scalanie genealogii usuwają wymarłe linie starsze niż 20 000 ticków oraz pośrednie węzły łańcuchów; przodkowie żywych organizmów zostają zawsze.
* Soak test 1 mln ticków (seed 5): pamięć procesu stabilna (61–99 MB RSS), genealogia ~20–33 tys. węzłów (bez scalania rosłaby liniowo), tempo 1,5–2,5 tys. ticków/s, niezgodność bilansu energii ~1e‑5 przy przepływie ~1e7.

## Struktura repozytorium

```
src/engine/   silnik (czysty TS)       src/worker/  worker symulacji, serii i protokół
src/render/   renderer WebGL2          src/ui/      aplikacja React (panele, wykresy uPlot)
src/storage/  IndexedDB                scripts/     headless, analyze
tests/        Vitest (84 testy)       docs/        MECHANICS.md, ARCHITECTURE.md
```

Stos: TypeScript (strict), React 18, Vite, uPlot, Vitest. Brak zależności od PixiJS — patrz uzasadnienie w docs/ARCHITECTURE.md.
