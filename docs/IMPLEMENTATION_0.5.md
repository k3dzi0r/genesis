# GENESIS 0.5 — plan wykonania

Data rozpoczęcia: 13 października 2026. Zakres: pierwszy etap `roadmapa.md` oraz dodatkowe przełączniki modułów wskazane przez użytkownika. Wersje 0.6–1.0 pozostają kolejnymi etapami roadmapy.

## Stan wejściowy

- Lokalna wersja 0.4.0, format zapisu 3; 131/131 testów przeszło przed zmianami.
- Nie nadpisujemy istniejącej pracy 0.4. Nie wykonujemy automatycznego commit, push ani publikacji.
- Powstał rzeczywisty zapis v3 przed zmianą silnika, do weryfikacji migracji. Genom 289 genów i sieć 23→8→9 pozostają bez zmiany struktury.

## Faza 0 — rozpoznanie (zakończona)

Źródła: `src/engine/config.ts`, `resources.ts`, `world.ts`, `pool.ts`, `stats.ts`, `serialize.ts`; `src/engine/history.ts`; `src/worker/protocol.ts`, `sim.worker.ts`; `src/ui/client.ts`, `App.tsx`, `panels/Controls.tsx`, `panels/Learn.tsx`, `panels/Log.tsx`, `help/lessons.ts`; `scripts/headless.ts` i testy.

Istniejące wzorce do wykorzystania:

- Parametry modułów to `WorldParams` i `PARAM_META`; interwencje to `Command.setParam` przez `WorldClient.command` oraz `WorldHistory.command`.
- Status i klatki są typowane w `protocol.ts`, wysyłane przez worker i odbierane przez `WorldClient`.
- Lekcje są typu `Lesson`; tworzenie światów odbywa się przez `Manager.create`, statystyki przez `StatsClient`.
- Zapisy są walidowane przed alokacją; historia odtwarza polecenia z kolejnością w obrębie ticku.
- Mapa biomów nie zużywa RNG symulacji; pola lokalnego środowiska muszą być zachowane w zapisach.

## Faza 1 — lokalne biomy i poprawne wyłączanie mechanik (zakończona)

Właściciel: agent silnika.

- `WorldParams.biomes` domyślnie 0; `biomeContrast` domyślnie 0.6.
- Trzy siedliska: umiarkowane, chłodne i ciepłe. Deterministyczna mapa seeda oraz lokalne mnożniki temperatury, żyzności, udziału B i sezonowości.
- `World.localEnvironment(cell)` zwraca rzeczywiste lokalne warunki. Wejście temperatury mózgu, fizjologia i wzrost zasobów korzystają z tych samych danych.
- `World.biomeSnapshot()` zwraca liczebność, zasoby, temperaturę, urodzenia, zgony i macierz rzeczywiście zaobserwowanych migracji.
- Migracja to ruch przez granicę siedliska. Narodziny, aktywowanie modułu i przeładowanie nie tworzą sztucznych migracji.
- Nowe dane puli są poprawnie przenoszone przy usunięciu przez zamianę; kontrolowane inicjowanie populacji zeruje liczniki.
- Wyłączenie B poleceniem przekształca B w A bez zmiany całkowitej energii. Wyłączenie uczenia zatrzymuje nowe zmiany, zachowując stan nauczony; wyłączenie kultywacji zachowuje dziedzictwo środowiska.
- Silnik 0.5.0, format 4, import rzeczywistych zapisów v2/v3. Historia z różnych wersji silnika pozostaje jawnie ograniczona zgodnością.

Weryfikacja: brak dodatkowego RNG i wpływu wyłączonych biomów; lokalna temperatura/percepcja/koszty; wspólny budżet pokarmów; zachowanie energii; rzeczywiste migracje; zapis/wznowienie; migracje formatów; odtwarzanie przełączeń.

Dowody: 16 dedykowanych testów biomów, modułów i autentycznej migracji v3 przeszło; niezależna próba historii odtworzyła przełączenia w ticku 800 oraz identyczny dalszy przebieg po zapisie/wznowieniu. Maksymalny błąd bilansu tej próby wyniósł 3.91e-11. Faza środowiska użyta w ostatnim kroku jest zapisywana jako `environmentTick` i uwzględniana w hashu stanu razem z temperaturą i mnożnikiem wzrostu.

## Faza 2 — udostępnienie pomiarów i powiązanie zdarzeń z historią (zakończona)

Właściciel: agent historii.

- Worker przekazuje pomiary biomów w statusie i pola potrzebne rendererowi w klatkach.
- Panel biomów pokazuje lokalne warunki, rozkład populacji i przepływy między siedliskami.
- Dziennik pozwala przejść do dostępnego momentu historii; zdarzeniom towarzyszą statystyki z jawnie opisanym oknem próbkowania.
- Brak twierdzenia o przyczynowości na podstawie samego współwystępowania zmiany i zdarzenia.
- Skrypt kalibracji zapisuje seedy, parametry, wersję, rzeczywiście osiągnięty tick, wyniki, bilans i metryki, również dla wymarć oraz zerowych efektów.

Weryfikacja: typowany worker/client; aktualne pomiary po seek/live; błędy żądań; dostępny zakres retencji; rzeczywisty raport dłuższych sparowanych przebiegów.

Dowody: 13 testów integracji i kalibracji przeszło. Raport `docs/calibration-0.5/REPORT.md` obejmuje 42 biegi, sześć ustalonych seedów i siedem warunków. Cel 10 000 ticków osiągnęło 7/42 biegów; pozostałe wymarły wcześniej. Każdy przedział różnicy populacji końcowej obejmuje zero. Wszystkie audytowane wznowienia i powtórzenie kontroli są zgodne, maksymalny błąd bilansu 1.94e-9. Raport zachowuje pełny setup, parametry, interwencję, docelowy i faktycznie osiągnięty czas.

## Faza 3 — moduły, prezentacja i edukacja (zakończona)

Właściciel: agent interfejsu i analizy.

- Panel modułów zbiera przełączniki mechanik; stan wynika z rzeczywistych parametrów. Preferencje nie tworzą drugiego źródła prawdy o biologii.
- Zależność wyboru partnera od rozmnażania płciowego jest jawna. Przełączniki są zablokowane podczas podglądu historii.
- Zestawy prosty i rozszerzony pozwalają stopniowo włączać mechaniki. Ukrywanie paneli prezentacji jest oddzielone od wyłączania mechanik świata.
- Mapa biomów i lokalnych warunków ma czytelną legendę oraz widok pomiarów.
- Osobne lekcje komunikacji, izolacji, uczenia, percepcji, kultywacji i biomów zawierają własną hipotezę, kontrolę, interwencję, mierniki i interpretację.
- Lekcja tworzy kontrolę oraz wariant na wspólnym seedzie. Przewodnik opiera postęp i komentarz na rzeczywistych tickach oraz pomiarach obu światów.
- Niewystarczające dane, dodatkowe interwencje, wymarcie i cofnięcie historii nie są przedstawiane jako potwierdzenie hipotezy.
- Pomoc, scenariusze, README i status roadmapy opisują faktyczny zakres oraz ograniczenia.

Weryfikacja: testy zależności modułów, stanów przełączeń i lekcji; pokrycie pomocy; brak gotowych wyników ewolucji; odczytywanie faktycznych parametrów po imporcie/seek.

Próba niezależna silnika lekcji: wszystkie sześć par, seed 37, domyślne 400 organizmów, 400 ticków. Przewodnik odczytał wspólny tick i skończone wartości wszystkich mierników. Maksymalny błąd bilansu 1.24e-10. Emisja komunikacji pojawiła się przy mniejszej liczebności wariantu: przykład użycia mechaniki bez dowodu korzyści. To kontrola działania przewodnika, nie kalibracja długoterminowej skuteczności mechanik.

Niezależny przegląd poprawił obsługę wymarcia przed 40 tickami, jawny opis próbek początkowych, brakujących mierników i różnych okien agregacji oraz rozdzielenie interpretacji przy powtórzeniu lekcji. Przełączniki używają tych samych progów aktywacji co silnik. Pomoc obejmuje moduły, profile i biomy.

## Faza 4 — niezależny przegląd i potwierdzenie (zakończona)

- Przegląd zależności, bilansu, migracji zapisów i poprawności wyłączania przez innego agenta.
- Przegląd tekstów edukacyjnych i zgodności z silnikiem; brak warunków ukończenia zależnych od pojawienia się współpracy lub gatunków.
- Pełne testy, typecheck, kompilacja i kontrola zmian.
- Root sprawdza w przeglądarce moduły, zestawy ustawień, biomy, lekcję kontrolną, dziennik i cofanie historii. Zapisuje podgląd wyniku.
- Dokumentacja zawiera rzeczywiste wyniki kalibracji, zakres testów i pozostające ograniczenia.

Warunek zakończenia etapu: funkcje 0.5 i moduły są działające, dostępne, objaśnione i sprawdzone; późniejsze wersje nie są oznaczone jako wdrożone.

### Zebrane dowody końcowe

- Pełny zestaw: 163/163 testów w 24 plikach, 53.59 s, w tym stabilność 40 000 ticków. Po dodaniu zgodności okazów Atlasu: 44/44 testów z ośmiu odpowiednich plików. Końcowa kompilacja TypeScript i Vite przeszła; `git diff --check` bez błędów. Vite zgłasza ostrzeżenie o głównym pakiecie około 519 kB przed gzip; podział pakietu pozostaje pracą wydajnościową.
- Trzy niezależne przeglądy: silnik/zapis, moduły/edukacja i worker/client/dziennik. Odtwarzanie oraz wznowienie sprawdzono dodatkowo na seedach 17/29/43/71. Migracja okazów sprawdzona na wszystkich 31 autentycznych genomach założycieli zapisu v3: bez zmiany źródła, zachowane pochodzenie, stan nauczony i oznaczenia dawnych wyników.
- Ostatnia poprawka opisuje także starszą wersję drugiego okazu w próbie A/B. Testy laboratorium 11/11, typecheck i finalna kompilacja 0.5.0 ponownie przeszły. Wersje w `package.json` i obu wpisach lockfile są zgodne.
- Przeglądarka desktopowa, widok 1280×720: komplet przełączników, zależności rozrodu, zestawy mechanik, profile widoczności, panel trzech biomów oraz mapy biomów/temperatury. Dziennik odtworzył tick 294 i pokazał przedział (280,300], a historia zablokowała interwencje.
- Prowadzona lekcja biomów utworzyła dwa rzeczywiste światy na seedzie 1; pokazała wspólny pomiar ticku 3600, temperatury 1/1 wobec 0.760/1.072 oraz przejścia 0 wobec 1990. Zapis oceny wymagał wskazania miernika; dodatkowa komunikacja oznaczyła próbę jako nieważną pierwotną kontrolę.
- Podgląd: `docs/genesis-0.5-preview.jpg`. Roadmapa oznacza 0.5 jako wdrożoną lokalnie, a 0.6–1.0 jako kolejne etapy.

Nie sprawdzono wszystkich przeglądarek, sterowania dotykowego ani zgodności bitowej między silnikami JavaScript. Biomy i lekcje umożliwiają badania; wyniki kalibracji nie dowodzą wyłonienia współpracy lub pełnej specjacji. Interpretacje lekcji są przechowywane w bieżącej sesji, a dawne chwile mogą wypaść z retencji historii.
