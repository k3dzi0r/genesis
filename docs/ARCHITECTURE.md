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
| `genome.ts`, `brain.ts` | dziedziczenie z mutacjami i rejestrem zmian, rekombinacja, odległości, sieć neuronowa z pamięcią rekurencyjną |
| `pool.ts` | pula organizmów SoA, gęsta, „swap‑remove” → deterministyczna kolejność i trywialna serializacja |
| `spatial.ts`, `resources.ts` | siatka przestrzenna (counting sort), siatka zasobów, generator żyzności i dynamika plam (dryf, cykl życia) |
| `world.ts` | krok symulacji (percepcja, ruch, żerowanie, drapieżnictwo, rozród), zdarzenia, polecenia, bilans energii, inspekcja, ablacja |
| `lineage.ts` | oszczędna genealogia kolumnowa (dwóch rodziców), mutacje, przycinanie i scalanie łańcuchów |
| `stats.ts` | historia statystyk o ograniczonej pamięci (scalanie wierszy) |
| `serialize.ts` | zapis/odczyt pełnego stanu, wersjonowanie, gzip |
| `experiment.ts` | uruchomienia headless, serie seedów, przeszukiwanie parametrów, eksporty CSV/JSON |
| `analysis.ts` | sondy zachowań, test ablacji kohortowej, klastrowanie strategii |
| `statsutil.ts` | przedziały ufności, rozkład t, test Welcha |

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
* Renderer rysuje wszystkie organizmy jednym wywołaniem instancingowym (WebGL2), tło jako dwie tekstury R8.
  Wybrano go zamiast PixiJS: stały narzut niezależny od liczby organizmów, brak grafu sceny, ~250 linii całości.

## Rozszerzenia (punkty zaczepienia)

Zaimplementowane w 0.3.0: drapieżnictwo (`World.predation`), rozmnażanie płciowe (`crossover`, `findMate`, drugi rodzic w genealogii), pamięć rekurencyjna (`mem` w puli, `OUT_MEM`/`IN_MEM`),
dynamiczne plamy (`resources.ts`). Nadal planowane:

| Funkcja | Gdzie podłączyć |
|---|---|
| **NEAT / zmienna topologia** | zastąpić stały układ wag listą połączeń (innovation id) i `think` interpreterem grafu; lineage przechowuje mutacje strukturalne jako zdarzenia. `GENOME_LEN` przestaje być stałą — pula potrzebuje genomów o zmiennej długości. |
| **Komunikacja / zachowania społeczne** | dodatkowe wyjście „sygnał” + wejścia „odebrany sygnał” liczone z siatki przestrzennej (jak `IN_NB_*` w `perceive`). Rozpoznawanie krewnych wymaga wejścia o podobieństwie genomu (np. odległość `hue`). |
| **Preferencje partnera** | `findMate` wybiera dziś najbliższego gotowego; dodać wyjście sieci „akceptacja” lub gen preferencji (np. wobec rozmiaru/hue) — specjacja przez dobór płciowy. |
| **Specjacja** | klasteryzacja po `genomeDistance` (jest `clusterStrategies`) + etykiety gatunków w statystykach i izolacja reprodukcyjna w `findMate`. |
| **Biomy, teren, przeszkody** | `ResourceGrid` i `Patch` już dają mapę żyzności zmienną w czasie; dodać warstwy (przeszkody, temperatura lokalna) i odczyt w `perceive`/ruchu. |
| **Mózg decyduje o rozrodzie** | dodatkowe wyjście „chęć rozrodu” jako dodatkowy warunek w fazie 8 kroku. |
| **WASM/Rust, WebGPU** | warstwa `World.step()` ma jedyne zależności od typowanych tablic — można ją zastąpić modułem implementującym ten sam interfejs (`step`, `applyCommand`, `inspect`, serializacja). Percepcja i `think` to naturalne jądra do GPU. |
| **Backend na osobnym komputerze** | `scripts/headless.ts` już zapisuje punkty kontrolne `.genesis`; wystarczy cienki serwer HTTP/WebSocket, który uruchamia `World` i wystawia ten sam protokół co worker (`protocol.ts`). |
