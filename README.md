# GENESIS — laboratorium sztucznego życia i ewolucji

Wersja lokalna **0.5.0**. [Opublikowana aplikacja](https://k3dzi0r.github.io/genesis/) · [mechanika](docs/MECHANICS.md) · [architektura](docs/ARCHITECTURE.md) · [plan i weryfikacja 0.5](docs/IMPLEMENTATION_0.5.md) · [roadmapa](roadmapa.md). Zmiany tego wydania nie są automatycznie publikowane przez pracę lokalną.

Organizmy z dziedzicznymi genomami żyją w świecie 2D, jedzą, polują i rozmnażają się. Sieć 23→8→9 ma pamięć rekurencyjną, opcjonalną plastyczność podczas życia oraz wyjścia sygnału i kultywacji. Genom ma 16 cech i 273 wagi. Koszty i transfery energii są księgowane. Nie ma ręcznie narzuconej strategii ostrzegania, współpracy lub tworzenia gatunków: ich powstanie pozostaje wynikiem eksperymentów.

## Uruchomienie

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

Node ≥20, przeglądarka z WebGL2. Symulacja działa w workerach przeglądarki, zapis lokalnie w IndexedDB. Wiele światów, bliźniaki, rozwidlenia, serie seedów i siatki parametrów pozostają dostępne. Praca lokalna nie wymaga backendu.

```bash
npm run headless -- --ticks 100000 --seed 7 --out runs/exp1 --checkpoint 10000
npm run analyze -- runs/exp1/latest.genesis --ablation
```

Pliki `.genesis` importuje się w Zapisy. Format v4 zachowuje cały stan wraz z mapą biomów, licznikami migracji i fazą klimatu. Zapisy v2/v3 są migrowane, v1 jest odrzucany. Okazy Atlasu 0.4 zachowują genom, stan nauczony, pochodzenie i dawne wyniki; nowe próby są oznaczone silnikiem 0.5. Migracja nie obiecuje zgodnej trajektorii między różnymi wersjami silnika.

## Nowe w 0.5

- **Moduły:** 11 przełączników mechanik i zestawy Podstawy, Zróżnicowany świat oraz Wszystkie mechaniki. Parametry świata określają rzeczywisty stan. Wybór partnera wymaga rozrodu płciowego; wyłączenie B przekształca pozostały pokarm w A bez utraty energii. Wyłączenie uczenia lub kultywacji zachowuje wcześniej nabyte wagi i zmienioną glebę.
- **Widok:** Obserwuj, Ucz się i Eksperymentuj oraz własny wybór widocznych zakładek. Te preferencje upraszczają interfejs bez zmiany biologii i pozostają na urządzeniu.
- **Biomy:** trzy siedliska z lokalną temperaturą, żyznością, udziałem B i sezonowością. Mapy biomów/temperatury, panel populacji i zasobów oraz liczniki rzeczywistych przejść przez granice.
- **Nauka:** sześć prowadzonych prób kontrola/wariant na wspólnym seedzie. Przewodnik porównuje faktyczne pomiary z tego samego ticku i okna agregacji, rozpoznaje dodatkowe interwencje, brak danych oraz wymarcie. Interpretację można zapisać w sesji i powtórzyć próbę z kolejnym seedem.
- **Dziennik:** kliknięcie dostępnego zdarzenia odtwarza dokładny stan i pokazuje otaczające statystyki, z jawnym przedziałem liczników.

Zacznij od **Moduły → Podstawy** i **Widok → Obserwuj**, a potem stopniowo dodawaj mechaniki. W Nauka → Lekcje wybierz prowadzoną próbę, aby porównać jedną interwencję.

[Kalibracja 0.5](docs/calibration-0.5/REPORT.md) obejmuje 42 biegi, sześć ustalonych seedów i siedem warunków. Cel 10 000 ticków osiągnęło 7/42 biegów; pozostałe wymarły wcześniej. Wszystkie przedziały różnicy populacji końcowej obejmują zero. Wyniki nie potwierdzają ogólnej przewagi badanych mechanik. Pełny setup, parametry i osiągnięty czas są zachowane w danych.

```bash
npm run calibrate -- --seeds 101,202,303,404,505,606 --ticks 10000 --out docs/calibration-0.5
```

## Dziewięć kierunków v0.4

| Kierunek | Mechanika i dostęp |
|---|---|
| Historia świata | Punkty kontrolne, dokładny tick, wydarzenia, odtwarzanie, zachowana teraźniejszość, rozwidlenie i eksport/import archiwum. Panel Historia. |
| Komunikacja | Kosztowny podpisany sygnał lokalny bez wbudowanego znaczenia; odbiór poprzedniego ticku, kierunek, blokowanie przez bariery. Nakładka/kolor Sygnał, ablacja odbioru. |
| Izolacja rozrodcza | Dziedziczne preferencje i selektywność, obustronna akceptacja. Atlas pokazuje próbkę zgodności, odrzucenia i obserwowane krzyżowania profili A/B. |
| Dwa pokarmy | Wspólny budżet pojemności A/B, rzadsze siedliska B, kompromis trawienia i toksyczność. Kolor Pokarm A/B, turkus/bursztyn na mapie. |
| Aktywna percepcja | Regulowane pole widzenia, przeszkody z przejściami i ograniczona linia widzenia. Obrót zmienia dostępne bodźce; sensory nadal agregują widoczne komórki. |
| Uczenie podczas życia | Somatyczne delty wag i ślady aktywności modulowane nagrodą energetyczną; koszt plastyczności. Potomstwo dostaje genom. Inspektor przełącza sieć genotypową/efektywną. |
| Atlas zachowań | Grupy z faktycznego ruchu, żerowania, polowania, powrotów i reakcji na zagrożenie. Kompletne zachowane okazy z ograniczonym nagraniem i wynikami prób. |
| Konstruowanie niszy | Kosztowna kultywacja zwiększa pojemność gleby i rozsiewa przeniesione nasiona. Trwały, zanikający stan środowiska; fioletowa nakładka Nisza. |
| Laboratorium organizmów | Genotyp A/B × dwa środowiska, pełne zapisane środowiska lub jawnie nowe mapy z parametrów. Pojedyncza mutacja, odroczona wskazówka i kontrola pamięci, progres/anulowanie i wyniki dołączone do okazu. |

Nowe scenariusze: **Żywy ekosystem**, **Dwa pokarmy**, **Ograniczony wzrok**, **Lokalne sygnały**, **Dobór partnera**, **Uczenie podczas życia**, **Konstrukcja niszy**. Parametry są dostępne także na żywo. Domyślne nowe przełączniki mechanik są wyłączone, żeby można było badać ich wpływ osobno. Nauka zawiera praktyczne lekcje, pomoc wszystkich genów/parametrów i opisy wszystkich kanałów sieci.

## Jak zacząć badanie

1. W Eksperymencie wybierz scenariusz i uruchom kilka tysięcy ticków.
2. Kliknij osobnika. Sprawdź rzeczywiste liczniki i efektywną sieć; zachowaj okaz.
3. W Historii cofnij się do wcześniejszego ticku i rozwidl moment. Zmień jeden parametr w nowym świecie.
4. W Atlasie porównaj zmiany aktywności i zgodności partnerów. Okazy przetrwają przycinanie genealogii i odświeżenie strony.
5. W Laboratorium pobierz żywego osobnika oraz genom zachowanego przodka. Wybierz prawdziwe dawne środowisko z dostępnej historii i porównaj cztery komórki na tych samych seedach.

Podgląd historii blokuje żywe kroki i interwencje; wróć do teraźniejszości lub rozwidl moment. Archiwum `.genesis-history` jest oddzielne od pojedynczego zapisu `.genesis`. Historia domyślnie zachowuje punkty co 1000 ticków, najwyżej 24 i 64 MiB; najstarsze chwile mogą wypaść z retencji.

## Interpretacja i ograniczenia

Atlas używa opisowych reguł pomiarowych; etykieta „powracający” nie dowodzi planowania. Próbka zgodności obejmuje najwyżej 64 organizmy i nie nadaje trwałych tożsamości gatunków. Krzyżowania A/B dotyczą dwóch profili pokarmowych, nie automatycznie gatunków. Trwała specjacja, współpraca i ostrzeganie wymagają odrębnych, długich eksperymentów.

Okaz zawiera genom, nauczone wagi, ślady, pamięć, ostatnie 32 próbki trajektorii i wyniki; nie zawiera całej mapy świata. Archiwalny genom przodka nie pozwala odtworzyć jego nieznanego stanu nauczonego. W próbach genetycznych stan somatyczny jest resetowany; odtwarzanie somatyczne jest dostępne tylko dla zachowanych żywych okazów.

A/B używa różnic w parach zgodnych seedów i przedziałów t. Welch pozostaje funkcją dla prób niezależnych. Brak automatycznej korekty wielokrotnych porównań. Test pamięci wykrywa reakcję zależną od historii, nie planowanie. Plastyczność może pomagać lub szkodzić.

Testy obejmują determinizm, bilans energii, dziedziczenie, nowe mechaniki, autentyczne migracje v2/v3, wznowienie v4, lokalny klimat, przełączniki, prowadzone lekcje, historię z działaniami tego samego ticku, niezmienność źródła analiz, kontrolowane ogrody, pojedynczą interwencję, pamięć i spójność treści. Długie wyniki ewolucyjne w dawnych lekcjach i opisach są jawnie oznaczone jako pomiary **v0.3**; nie są obietnicą zachowania nowego silnika. Tamte pomiary obejmowały utrzymanie drapieżnictwa, czasem jego zanik, korzyści percepcji i zależną od seeda korzyść pamięci. Nie dowodzą nieodwracalności wymarcia drapieżników: dieta nadal mutuje.

Safari/Firefox, urządzenia dotykowe, zgodność bitowa między różnymi silnikami JS i bardzo duże populacje pozostają osobnymi zakresami weryfikacji. Rozwinięte relacje społeczne, trwałe tożsamości gatunków, NEAT, zmienna topologia, WASM/WebGPU i backend sieciowy pozostają kolejnymi kierunkami rozwoju.

## Struktura

```text
src/engine/   czysty TypeScript: świat, genomy, pamięć/uczenie, historia, analizy, lab
src/worker/   symulacja, serie, typowane komunikaty, progres i anulowanie
src/render/   WebGL2: organizmy, pokarmy, teren i nisza
src/ui/       React: sterowanie, historia, atlas, laboratorium, inspektor, nauka
src/storage/  IndexedDB zapisów i kompletnych okazów
scripts/      uruchomienia headless i analizy
tests/        Vitest
docs/         mechanika, architektura, plan i dowody weryfikacji
```

TypeScript strict, React 18, Vite, uPlot, Vitest. Licencja MIT.
