# GENESIS 0.4 — wdrożenie dziewięciu kierunków

Zakres zatwierdzony przez użytkownika: historia świata, komunikacja, specjacja, dwa pokarmy, aktywna percepcja, plastyczność podczas życia, atlas zachowań, konstruowanie niszy i kontrolowane eksperymenty organizmów. Praca lokalna; bez publikowania lub wdrażania zdalnego.

## Faza 0 — rozpoznanie (zakończona)

Źródła: `docs/MECHANICS.md`, `docs/ARCHITECTURE.md`, silnik, protokół workerów, klient, magazyn IndexedDB, panele i istniejące testy. Testy bazowe: 84/84, typecheck poprawny.

Istniejące API do wykorzystania:
- `World.step/run/applyCommand/select/inspect`, `world.ts`: oddzielenie czasu symulacji od renderowania i kontrolowany RNG.
- `OrganismPool.move/exportSections/importSections`, `pool.ts`: trwałe skalary w zarejestrowanych tablicach, macierze kopiowane jawnie.
- `serializeWorld/deserializeWorld`, `serialize.ts:86,170`: pełny synchroniczny stan, gzip poza silnikiem.
- `LineageStore.reconstruct/exportState/importState`: genom przodka i migracja genealogii.
- `ablationSuite/probeBehavior/clusterStrategies`, `analysis.ts`: analiza na kopiach, brak zużywania RNG źródła.
- `WorldClient.request`, `client.ts:174`, typowane wiadomości w `protocol.ts`.
- `Manager.fork`, `client.ts:352`: pełny zapis wyświetlanego świata → nowy worker.
- `putSave/listSaves/getSaveBytes`, `storage/db.ts`: lokalne zapisy.

## Faza 1 — mechaniki i trwały stan (zakończona)

Właściciel: agent silnika. Pliki: constants/config/genome/pool/world/resources/serialize/stats oraz testy tych mechanik.

Zachować pierwsze 11 indeksów cech, 17 wejść i 7 wyjść. Dopisać cechy `plantSpecialization`, `matePreference`, `mateSelectivity`, `plasticity`, `nicheInvestment`; wejścia pokarmu B (przód/lewo/ilość) i sygnału (ilość/przód/lewo); wyjścia sygnału i kultywacji. Kontrakt: 16 cech, 23 wejścia, 8 neuronów ukrytych, 9 wyjść, 289 genów.

Mechaniki:
- Pokarmy A/B dzielą budżet pojemności; specjalizacja trawienia ma koszt alternatywny, B może uszkadzać zdrowie. Wszystkie przepływy energii księgowane.
- Pole widzenia oraz deterministyczne przeszkody ograniczają percepcję i ruch; drugi pokarm ma własne lokalne wskazania.
- Sygnały poprzedniego ticku, lokalny zasięg i energetyczny koszt emisji; żadnego zaprogramowanego znaczenia. Ablacja komunikacji.
- Wzajemne, dziedziczne preferencje partnera; odrzucenia i przepływ genów obserwowane. Grupy kandydatów nie deklarują automatycznie gatunków.
- Somatyczne wagi/ślady uczenia osobno od genomu; aktualizacja po mierzalnym zysku/koszcie, z dziedziczną plastycznością. Potomstwo dziedziczy genom, nie nauczone wagi.
- Kultywacja wydaje energię i przenosi zalążki / zmienia lokalną żyzność. Wpływ trwały, zapisany i ograniczony.
- Liczniki rzeczywistego ruchu, żerowania, polowań, powrotów i ekspozycji na zagrożenie; stan zapisany i kopiowany przy swap-remove.
- Publiczne API kontrolowanego inicjowania populacji dla modułu laboratoryjnego, zachowujące genealogię i księgę energii.

Wersja silnika 0.4.0, format 3, migracja v2: mapowanie starych wag, genów mutacji i genomów założycieli, stare statystyki, neutralne nowe kanały. Stary zapis zachowany; import nie obiecuje zgodności trajektorii z inną wersją silnika.

Weryfikacja: nowości działają przy włączeniu i są wyłączalne; determinizm/chunk independence; bilans energii; somatyczne uczenie bez dziedziczenia; preferencje rozrodcze; widoczność i przeszkody; wznowienie bitowe w v3; migracja v2 z genealogią; dotychczasowe testy bez obniżania wymaganej poprawności.

## Faza 2 — historia świata (zakończona)

Właściciel: agent historii. Pliki: nowy engine/history.ts, worker/protocol.ts i sim.worker.ts, ui/client.ts, HistoryPanel.tsx, testy historii.

`WorldHistory`: pełne punkty kontrolne w ograniczonym budżecie liczby/bajtów; osobny dziennik poleceń i zaznaczeń z numerem kolejności, aby nie dublować działań tego samego ticku. Kroki dzielone na granicach punktów kontrolnych. Odtworzenie dokładnego ticku na kopii, żywy świat pozostaje zachowany. Archiwum historii z eksportem/importem i walidacją. UI: zakres retencji, suwak/liczba ticków, odtwarzanie przeszłości, wydarzenia, powrót do teraźniejszości, rozwidlenie wybranego momentu. Mutacje świata podczas podglądu zablokowane; fork ma faktyczny historyczny stan genealogii.

Agent jest jedynym właścicielem wspólnych worker/protocol/client i integruje też gotowe kontrakty atlasu/laboratorium. Błędy żądań muszą kończyć Promise. Eksporty zapisów mają metadane z ticku wykonania serializacji.

Weryfikacja: historia przed/po punktach kontrolnych; same-tick commands; planowane zdarzenia; zaznaczenia przy przycinaniu; źródło niezmienione; wymarcie; retencja; odgałęzienie; archiwum roundtrip i błędne dane; odświeżenie wszystkich buforów UI po cofaniu.

## Faza 3 — atlas i laboratorium (zakończona)

Właściciel: agent analizy. Pliki: nowe engine/behavior.ts, engine/lab.ts, analiza/statystyka, storage/atlas.ts, AtlasPanel/LabPanel, Sweep oraz testy.

Atlas grupuje mierzone zachowania; podaje długość obserwacji i zbyt mało danych dla młodych osobników. Zachowany okaz zawiera genom, stan nauczony, pamięć, pochodzenie, ograniczoną trajektorię i wyniki prób. Trwały magazyn IndexedDB, eksport/import i podgląd trajektorii.

Laboratorium: przodek i potomek × dawne i obecne środowisko, identyczne warunki startu i pula seedów; osobna próba jednej zmiany genu; test reakcji na sekwencję bodźców i ablację pamięci. Rozróżnić odtworzone parametry od faktycznie zapisanej mapy oraz stan dziedziczny od nauczonego. Eksperymenty nie zmieniają źródła. Raporty: przeżycie, potomstwo, pozyskana energia, ruch, polowania. Kosztowne wykonanie poza UI, porządna obsługa anulowania/progresu.

Statystyka A/B: różnice w parach zgodnych seedów, przedziały ufności; Welch pozostaje dla niezależnych prób. Analiza izolacji rozrodczej oparta na kompatybilności i obserwowanych krzyżowaniach, z jawnymi ograniczeniami.

Weryfikacja: różne zachowania przy tych samych cechach; brak RNG wpływu; zapis okazu; powtarzalne cztery komórki; identyczne genotypy jako kontrola; pojedyncza interwencja; stan źródła bez zmian; pamięć zależna od historii w skonstruowanej sieci; sparowane referencje i walidacja seedów.

## Faza 4 — spójny interfejs i treści (zakończona)

Agent analizy zintegrował App/WorldView/renderer/presets/styles/Inspector/Brain/help i dokumentację, według ukończonych kontraktów. Udostępnić wszystkie funkcje, widoczne sygnały/pokarmy/przeszkody/zmiany środowiska, przełącznik genom/nauczona sieć. Scenariusze z konkretną hipotezą: dwa pokarmy, percepcja, komunikacja, rozdzielanie populacji, uczenie, kultywacja, integracja wszystkich mechanik. Lekcje i pomoc opisują dokładną mechanikę, bez obietnic niezmierzonych zjawisk. Nowe parametry i cechy mają pełną pomoc. Istniejące wyniki oznaczone jako pomiary v0.3.

## Faza 5 — niezależna weryfikacja i naprawy (zakończona)

Świeże agenty: testy i kontrola determinizmu/bilansu; przegląd ryzyk; przegląd zgodności dziewięciu funkcji z UI/treściami. Root ogląda interfejs w przeglądarce. Typecheck, pełne testy, build, scenariusze headless z włączonymi mechanikami i test UI historii/atlasu/laboratorium. Naprawy w zakresie zadania. Bez automatycznego commit/push/publikacji.

Warunek ukończenia: wszystkie dziewięć kierunków mają działającą implementację, dostęp przez UI, testy właściwych mechanizmów i aktualny opis ograniczeń. Powstanie współpracy lub gatunków w losowej populacji jest wynikiem eksperymentu, a nie gwarancją funkcji.


## Dowody wykonania (9 października 2026)

- Silnik, historia i laboratorium mają testy mechanizmów w `new-mechanics`, `history`, `worker-history`, `client`, `lab`, `serialize` oraz dotychczasowym zestawie. Migracja opiera się na zachowanej rzeczywistej próbce v2 w `tests/fixtures`.
- Zestaw analizy/laboratorium: deterministyczne 4 komórki × 2 seedy, prawdziwe zapisane środowiska, różne trajektorie dla różnych seedów, zachowany hash źródła, dokładnie jeden locus interwencji, ograniczenie efektywnych wag w próbie somatycznej, genetyczne zerowanie stanu, skonstruowana pamięć z kontrolą ablacji i feedforward, kilka grup bilateralnej zgodności, trwały JSON okazu wraz z wynikami i nieskończoną statystyką zdegenerowaną. `tests/lab.test.ts`: 10 testów przeszło.
- `tests/help.test.ts`: 9 testów przeszło, w tym nowe parametry/geny/grupy, wszystkie 23 wejścia i 9 wyjść oraz 7 scenariuszy rozwoju. Lekcje v0.3 mają jawny znacznik historycznych pomiarów; nowe lekcje nie wymyślają wyników ewolucji.
- Typecheck oraz `git diff --check` po integracji poprawne. Wersja pakietu i silnika 0.4.0, format 3.
- Root sprawdził zintegrowane mechaniki przez 4000 ticków dla seeda 7, następnie po 3300 ticków dla seedów 1, 7, 13, 29. Odtworzenie do 1500 po poleceniach/zaznaczeniu tego samego ticku, archiwum roundtrip oraz wznowienie +300 ticków dały zgodny hash. Bezwzględny błąd bilansu <3×10⁻¹⁰. Emisja, plastyczność i kultywacja miały dodatnie koszty; warstwa niszy zmieniła 344–351 komórek. Zaobserwowano kojarzenia między profilami A/B w seedach 13 i 29. To dowód poprawności i działania mechanik, nie dowód współpracy lub pełnej specjacji.
- Root sprawdził w przeglądarce odtworzenie ticku 120, blokadę mutacji w podglądzie i rozwidlenie. Atlas zachował rzeczywisty okaz z 28 próbkami śladu po reload i pozwolił pobrać przodka. Laboratorium dla identycznego A/B dało 8 przebiegów w 4 komórkach × 2 seedy, zerową różnicę A/B w obu środowiskach i różnice między seedami bez przesunięcia źródła.
- Naprawy z niezależnego przeglądu: tokeny UI na zmianę świata/epoki, anulowanie starej próby, przywiązanie wyników do badanego okazu, zerowanie przyszłych serii przy seek, usunięcie starych klatek/trajektorii z potwierdzeniem backpressure, formatowanie dużych liczb, rozróżnienie genotypowej i efektywnej sieci, spójne kolory i opis ograniczeń.

## Końcowe bramki i próby UI

Po zamrożeniu źródeł root wykonał pełne `npm test`: **131/131 testów w 19 plikach**. `npm run build` (TypeScript + Vite) przeszedł, a `git diff --check` jest czysty. Niezależny przegląd silnika, historii, analiz i UI nie pozostawił otwartych usterek w zakresie zadania.

W przeglądarce scenariusz wszystkich mechanik osiągnął tick 5032 i populację 244. Odtworzenie ticku 300 pokazało populację 181, zablokowane interwencje oraz Atlas bez przyszłych obserwacji. Powrót przywrócił tick 5032, populację 244 i świeżą klatkę. Inspektor #492 pokazał 1769 ticków rzeczywistych obserwacji, sygnał 0,995 oraz kultywację 60,539 i przeniesione nasiona 7,406; przełącznik genom/efektywna sieć działał.

Dla zachowanego okazu #574 ukończono wszystkie trzy tryby laboratorium:
- Ogrody A/B: 8 przebiegów (4 komórki × 2 seedy), identyczne genotypy dały różnicę A−B = 0 w obu środowiskach.
- Odroczona wskazówka: kontrasty dla opóźnień 0/5/20/60 wyniosły 0,0130/0,0065/0,0006/−0,0001, a kontrola bez wejść pamięci 0. To pomiar zależności od historii, nie deklaracja inteligencji.
- Interwencja: gen 0 zmieniono z 0,3227 na 0,9; cztery przebiegi ukończone, świat źródłowy pozostał w ticku 1109.

Atlas trwale zachował okaz wraz z **trzema wynikami prób**. Zrzut końcowego interfejsu: `docs/genesis-0.4-preview.jpg`.

Wszystkie dziewięć kierunków ma mechanikę, dostępny interfejs, właściwe testy i opis ograniczeń. Nie wykonano commit, push ani publikacji. Powstanie współpracy lub trwałej specjacji pozostaje wynikiem przyszłych eksperymentów, a nie gwarancją wydania.
