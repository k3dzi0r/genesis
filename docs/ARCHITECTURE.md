# GENESIS — architektura

## Warstwy (zależności idą tylko w dół)

```
 UI (React)        src/ui/*            komponenty, hooki, brak logiki biologicznej
   │ postMessage (typowane: src/worker/protocol.ts)
 Worker            src/worker/*        pętla czasu, migawki dla renderera, autozapis, zapytania (inspekcja, genealogia, sondy)
   │ import
 Silnik            src/engine/*        czysty TypeScript: zero DOM, zero React, zero Worker API
 Renderer          src/render/*        WebGL2, dostaje wyłącznie spakowaną migawkę (nie zna silnika)
 Magazyn           src/storage/*       IndexedDB, pobieranie plików
```

* **Silnik jest samowystarczalny** — działa w Node (`scripts/headless.ts`, testy), w Web Workerze i w przeglądarce. Nic w `src/engine` nie importuje ani `window`, ani `Worker`.
* **Czas symulacji ≠ czas rzeczywisty**: worker wykonuje tyle ticków, ile wynika z wybranego tempa (1×=30 t/s … MAX), UI rysuje ostatnią migawkę. Migawki są wysyłane tylko po potwierdzeniu poprzedniej
  (brak narastającej kolejki; ukryta karta przestaje dostawać klatki, a symulacja idzie dalej).
* Każdy świat to osobny Worker → wiele światów działa równolegle na różnych rdzeniach (porównania A/B, bliźniaki, rozwidlenia).
* Seria seedów działa w osobnym workerze (`series.worker.ts`) w trybie headless.

## Warstwa edukacyjna (`src/ui/help`)

| Plik | Zawartość |
|---|---|
| `types.ts` | typy wpisu (`HelpEntry`), działy słownika, lekcji (`Lesson`) |
| `concepts.ts`, `params.ts`, `analysis.ts`, `interface.ts` | treści: pojęcia, parametry i geny, statystyka i narzędzia, elementy interfejsu |
| `lessons.ts` | lekcje; pole `observed` zawiera wyłącznie zmierzone wyniki |
| `guided.ts`, `panels/GuidedLesson.tsx` | sześć par kontrolnych, czysty evaluator faktycznych pomiarów, postęp i interpretacja |
| `content.ts` | scala wpisy, udostępnia słownik i ciekawostki |
| `store.ts` | stan jednego globalnego dymka i magistrala poleceń interfejsu (`uiBus`) |
| `Help.tsx` | przycisk `<Help id="…" />` i jedna instancja dymka (hover = skrót, klik = przypięcie) |
| `Welcome.tsx` | ekran powitalny (flaga w localStorage, z obsługą jego braku) |

Panel zakładki „Nauka” to `src/ui/panels/Learn.tsx`. Treści nie zależą od silnika poza nazwami parametrów, a test `tests/help.test.ts` sprawdza zgodność z `PARAM_META`, `TRAIT_NAMES` i konfiguracją.

## Silnik (`src/engine`)

| Plik | Odpowiedzialność |
|---|---|
| `rng.ts`, `mathx.ts` | deterministyczny PRNG i arytmetyka bez funkcji przestępnych |
| `constants.ts` | układ genomu, wymiary sieci, mapowania gen→fizjologia, wersje |
| `config.ts` | `WorldSetup` (niezmienny) i `WorldParams` (zmienny w trakcie, z metadanymi dla UI) |
| `modules.ts` | czyste zestawy parametrów mechanik; progi zgodne z silnikiem i zależność wyboru partnera |
| `genome.ts`, `brain.ts` | dziedziczenie z mutacjami i rejestrem zmian, rekombinacja, odległości, sieć neuronowa z pamięcią rekurencyjną |
| `pool.ts` | pula organizmów SoA, gęsta, „swap‑remove” → deterministyczna kolejność i trywialna serializacja |
| `spatial.ts`, `resources.ts` | siatka przestrzenna (counting sort), siatka zasobów, generator żyzności i dynamika plam (dryf, cykl życia) |
| `world.ts` | krok symulacji (percepcja, ruch, żerowanie, drapieżnictwo, rozród), zdarzenia, polecenia, bilans energii, inspekcja, ablacja |
| `lineage.ts` | oszczędna genealogia kolumnowa (dwóch rodziców), mutacje, przycinanie i scalanie łańcuchów |
| `stats.ts` | historia statystyk o ograniczonej pamięci (scalanie wierszy) |
| `serialize.ts` | zapis/odczyt pełnego stanu, wersjonowanie, gzip |
| `experiment.ts` | uruchomienia headless, serie seedów, przeszukiwanie parametrów, eksporty CSV/JSON |
| `analysis.ts` | sondy zachowań, test ablacji kohortowej, klastrowanie strategii |
| `statsutil.ts` | przedziały ufności, rozkład t, sparowane seedy, Welch dla niezależnych prób |
| `history.ts` | ograniczona historia pełnych punktów, uporządkowane działania, dokładny podgląd i archiwum |
| `behavior.ts` | obserwowane grupy zachowania, kompletne okazy, próbka zgodności i przepływ profili |
| `lab.ts` | kontrolowane ogrody, pojedyncza interwencja, odroczona wskazówka, generator progresu |

### Reguły, które utrzymują determinizm (nie łamać)
1. Brak `Math.random`, `Date.now` i funkcji `sin/cos/exp/log/pow` w ścieżce symulacji.
2. Kolejność przetwarzania zależy tylko od indeksów w puli; decyzje są liczone na stanie z początku ticku.
3. Każde nowe losowanie idzie przez `world.rng` w stałej kolejności; analityka (statystyki, sondy) **nie** zużywa losowości świata.
4. Każda zmiana mechaniki → podbić `ENGINE_VERSION`; zmiana układu pliku → `FORMAT_VERSION` + migracja w `serialize.ts`.

## Wydajność

* Sąsiedzi przez siatkę przestrzenną; percepcja pokarmu skanuje tylko komórki w zasięgu (O(zasięg²/komórka²) na organizm).
* Zasoby, pula i genomy to typowane tablice; brak alokacji w pętli kroku.
* Pomiar (Apple Silicon, jeden wątek na świat, domyślny świat z drapieżnikami): ~1500–2800 ticków/s przy 500–800 organizmach; ~800 t/s przy ~1500 (starsza wersja bez drapieżnictwa).
* Pamięć jest ograniczona: statystyki (stały bufor), genealogia (przycinanie), pula (twardy limit `capacity`).
* Renderer rysuje organizmy instancingowo (WebGL2). Tło używa tekstur R8 żyzności, A/B, barier, niszy, biomów i temperatury. Mapa biomów korzysta z nearest filtering, aby nie tworzyć fikcyjnych pośrednich siedlisk.

## Rozszerzenia (punkty zaczepienia)

Zaimplementowane w 0.3 i rozszerzone w 0.4: drapieżnictwo (`World.predation`), rozmnażanie płciowe (`crossover`, `findMate`, drugi rodzic w genealogii), pamięć rekurencyjna (`mem` w puli, `OUT_MEM`/`IN_MEM`),
dynamiczne plamy (`resources.ts`). W v0.4 dodano historię, sygnał, dziedziczny wybór partnera, dwa pokarmy, pole widzenia/bariery, plastyczność, konstrukcję niszy, atlas i laboratorium. Nadal możliwe rozszerzenia:

| Funkcja | Gdzie podłączyć |
|---|---|
| **NEAT / zmienna topologia** | zastąpić stały układ wag listą połączeń (innovation id) i `think` interpreterem grafu; lineage przechowuje mutacje strukturalne jako zdarzenia. `GENOME_LEN` przestaje być stałą — pula potrzebuje genomów o zmiennej długości. |
| **Mózg decyduje o rozrodzie** | dodatkowe wyjście „chęć rozrodu” jako dodatkowy warunek w fazie 8 kroku. |
| **WASM/Rust, WebGPU** | warstwa `World.step()` ma jedyne zależności od typowanych tablic — można ją zastąpić modułem implementującym ten sam interfejs (`step`, `applyCommand`, `inspect`, serializacja). Percepcja i `think` to naturalne jądra do GPU. |
| **Backend na osobnym komputerze** | `scripts/headless.ts` już zapisuje punkty kontrolne `.genesis`; wystarczy cienki serwer HTTP/WebSocket, który uruchamia `World` i wystawia ten sam protokół co worker (`protocol.ts`). |

## Kontrakty v0.4

Silnik 0.4.0 / zapis v3: 16 cech, 23 wejścia, 8 neuronów ukrytych, 9 wyjść, 289 genów. Nowe kanały są dopisane; migrator mapuje stare wagi, mutacje, założycieli i statystyki v2. Format v1 jest odrzucany. Wznowienie v3 zachowuje trajektorię; migracja nie obiecuje zgodności trajektorii pomiędzy wersjami silnika.

Pool przechowuje scalarny stan somatyczny i pomiary w tablicach SoA, macierze wag/śladów oraz pierścienie 32 próbek kopiowane przy swap-remove. Wszystko należące do mechaniki jest serializowane. Zapis obejmuje obie warstwy zasobów, teren, niszę, nasiona, emisję, somatyczne wagi/ślady/pamięć oraz kojarzenia. Analityka nie zużywa RNG świata.

`World.seedPopulation(genomes, energyFraction, trialSeed)` zachowuje mapę/tick/zdarzenia, resetuje populację i runtime, odbudowuje genealogię/statystyki i rebazuje księgę energii. `World.observe(id)` odczytuje pomiary i ograniczony ślad. `mateCompatibility(a,b)` jest obustronnym, niezmieniającym liczników zapytaniem.

`WorldHistory` jest właścicielem żywego świata i kopii podglądu. Worker dzieli kroki na granicach punktów, odtwarza akcje w kolejności i odświeża wszystkie bufory UI po seek/live. W podglądzie polecenia zmiany mechaniki są odrzucane. `WorldClient.historyEpoch` usuwa trajektorie z poprzedniej epoki. `historicalWorldBytes(tick)` daje laboratorium pełną, prywatną kopię.

Atlas i laboratorium komunikują się przez typowane request/result/progress/error. Generator lab oddaje sterowanie co 50 ticków, worker sprawdza anulowanie pomiędzy porcjami. Zmiana świata lub zamknięcie panelu anuluje próbę; tokeny paneli blokują późne odpowiedzi starego klienta. Pomiary są z kopii, więc nie przesuwają czasu ani RNG źródła.

`storage/atlas.ts` ma oddzielny IndexedDB `genesis-atlas`; okazy przetrwają pruning genealogii i reload. Plik okazu przechowuje genotyp, stan somatyczny, obserwacje, ograniczoną trajektorię i wyniki, bez pełnej mapy świata. Archiwum historii jest osobnym formatem `.genesis-history`.

Renderer GPU odbiera mapy A/B, przeszkód i niszy; sygnały są podpisaną nakładką. Genotypowy kolor/profile, obserwowane zachowania oraz kandydaci izolacji są oddzielnymi widokami z widocznymi ograniczeniami. Pełne mapy aktualizują się w migawkach; analityka działa tylko na żądanie paneli.

## Kontrakty v0.5

Silnik 0.5.0 / zapis v4 zachowuje dotychczasowy genom i sieć. Zapis obejmuje deterministyczną mapę trzech biomów, pola lokalnych czynników środowiska, macierz migracji, liczniki urodzeń/zgonów oraz `pool.currentBiome` i `biomeTransitions`. Migrator v3 dopisuje wyłączone biomy i zerowe pomiary; v2 przechodzi także migrację genomu. Zgodność trajektorii dotyczy tej samej wersji silnika.

`World.localEnvironment(cell)` zwraca biom, rzeczywistą temperaturę, mnożnik wzrostu, żyzność i udział B. Fizjologia, wejście temperatury mózgu oraz zasoby korzystają z tych samych lokalnych czynników. Generowanie mapy nie zużywa RNG symulacji. `biomeSnapshot()` jest tylko odczytem i odróżnia ruch, narodziny i zgony.

Worker wysyła `StatusMsg.biomes` oraz prywatne kopie `FrameMsg.biome` i `localTemperature`. Renderer skaluje względną temperaturę 0…1,2 do tekstury prezentacji; nie zmienia środowiska. Seek/live odświeża dane biomów razem z całą migawką.

`ModulePanel` odczytuje stan z `info.params`. WeakMap zapamiętuje jedynie wartości przywracane po ponownym włączeniu. Nie przechowuje alternatywnego stanu biologii. `WorldClient.commands` wysyła batch z żądaniem; worker waliduje całość, wykonuje polecenia synchronicznie w jednym ticku, odświeża status/statystyki i dopiero wtedy potwierdza żądanie. Panel blokuje kolejny batch do potwierdzenia i jest tylko do odczytu w podglądzie.

`PresentationPanel` przechowuje w localStorage widoczność narzędzi (Obserwuj/Ucz się/Eksperymentuj). To odrębne preferencje od parametrów świata. Link z pomocy odsłania potrzebny panel; rdzeń modelu nie jest ukrywany lub wyłączany przez profil prezentacji.

Prowadzona lekcja tworzy dwie niezależne instancje tego samego seeda i konfiguracji startowej, różniące się jednym parametrem. Evaluator porównuje dostępny wspólny tick i jednakowe okna agregacji. Wymaga skończonych wartości wszystkich mierników. Parametry, ręczne interwencje, preview i epoka przeładowania chronią kontrolę przed błędną interpretacją. Wczesne wymarcie jest wynikiem terminalnym; początkowe dane są jawnie niewystarczające. Notatki pozostają w sesji i nie stanowią automatycznej akceptacji hipotezy.

Atlas dopuszcza okazy 0.4 i 0.5 o tej samej strukturze genomu. Normalizacja brakujących pól biomów w okazach 0.4 nie zmienia pochodzenia, genów, stanu nauczonego ani wersji dawnych wyników. Nowe próby zachowują wersję bieżącego silnika i ostrzegają o różnicy wersji źródła. Wcześniejsze bajty magazynu nie są nadpisywane automatycznie.
