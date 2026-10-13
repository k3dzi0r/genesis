# GENESIS — roadmapa od 0.4 do 1.0

Data: 9 października 2026. Aktualizacja statusu: 13 października 2026.

Cel wersji 1.0: aplikacja, w której można obserwować ewolucję, stawiać hipotezy, wykonywać powtarzalne eksperymenty i rozumieć ich wyniki.

Wersja **0.5.0 jest wdrożona lokalnie**, na fundamencie 0.4. Wersje 0.6–1.0 poniżej są planem rozwoju. Kolejność wynika z zależności między mechanikami; terminy wymagają osobnego oszacowania.

## Zasady rozwoju

- Każda wersja łączy większą funkcję symulacji, narzędzia do jej pomiaru i dedykowaną warstwę edukacyjną.
- Znaczenie sygnałów i strategie społeczne mają wynikać z ewolucji. Nie przypisujemy organizmom gotowych ról typu „pomocnik” lub „oszust”.
- Powstanie współpracy, trwałych gatunków lub bardziej złożonych zachowań jest wynikiem badania, nie warunkiem działania aplikacji.
- Zachowujemy kontrolę kosztów energii, powtarzalność w obrębie danej wersji silnika, poprawne zapisy i możliwość badania mechanik osobno.
- Pomoc rozróżnia mechanikę modelu, wynik konkretnego eksperymentu i interpretację. Wyniki dawnych wersji są oznaczone wersją silnika.
- Duże rozszerzenia wdrażamy etapami. Eksperymentalne mechaniki pozostają wyłączalne i mają jawne ograniczenia.

## Przegląd wersji

| Wersja | Główna funkcja symulacji | Narzędzia i edukacja |
|---|---|---|
| 0.4 | Komunikacja, wybór partnera, uczenie, dwa pokarmy i konstrukcja niszy | Historia, atlas, laboratorium i pierwsze lekcje |
| 0.5 | Lokalne biomy i zmienne warunki życia | Prowadzone lekcje, interpretacja zdarzeń i kalibracja modelu |
| 0.6 | Rozbudowana komunikacja i relacje społeczne | Próby znaczenia sygnałów, kosztów pomocy i wzajemności |
| 0.7 | Pełniejszy proces specjacji | Trwałe tożsamości populacji, migracje i przepływ genów |
| 0.8 | Ewoluujące zasoby i dziedzictwo ekologiczne | Badanie wzajemnej adaptacji oraz regeneracji ekosystemu |
| 0.9 | Ewoluująca budowa mózgu | Automatyczne badania, porównania i pakiety doświadczeń |
| 1.0 | Spójny ekosystem do długotrwałych obserwacji | Dopracowane ścieżki Obserwuj, Ucz się i Eksperymentuj |

## 0.4 — wdrożony fundament

### Wdrożone funkcje

1. Kosztowne lokalne sygnały bez wbudowanego znaczenia.
2. Dziedziczny wybór partnera i wzajemna zgodność rozrodcza.
3. Dokładne odtwarzanie historii, powrót do teraźniejszości, rozwidlenia i archiwa.
4. Dwa pokarmy, kompromis specjalizacji i toksyczność pokarmu B.
5. Ograniczone pole widzenia i bariery wpływające na ruch oraz percepcję.
6. Uczenie podczas życia, oddzielone od dziedziczonego genomu.
7. Atlas obserwowanych zachowań i trwałe zachowane okazy.
8. Kosztowna kultywacja, transport nasion i trwałe zmiany lokalnej żyzności.
9. Laboratorium: genotypy A/B w dwóch środowiskach, interwencja w jeden gen i test pamięci z kontrolą.

### Warstwa edukacyjna i weryfikacja

- 20 lekcji, w tym 9 nowych; słownik i pomoc kontekstowa dla nowych mechanik, parametrów, cech oraz kanałów sieci.
- Nowe lekcje częściowo wykorzystują wspólny schemat eksperymentu. Nie są jeszcze przewodnikiem reagującym na wyniki użytkownika.
- 131/131 testów przeszło, podobnie jak końcowa kompilacja. Historia, atlas i trzy tryby laboratorium zostały sprawdzone w przeglądarce.
- Grupy zgodności są chwilowymi kandydatami na odrębne populacje, bez trwałej tożsamości gatunków. Historia ma ograniczoną retencję. Sieć neuronowa ma stałą strukturę.

Szczegóły: [mechanika](docs/MECHANICS.md), [architektura](docs/ARCHITECTURE.md), [plan i dowody wdrożenia 0.4](docs/DEVELOPMENT_PLAN.md).

## 0.5 — zrozumieć świat i jego różnorodność (wdrożona lokalnie)

Etap obejmuje również 11 wyłączalnych modułów i trzy zestawy mechanik. Osobne profile widoku Obserwuj, Ucz się oraz Eksperymentuj upraszczają interfejs bez zmiany biologii. Wyłączenie uczenia i kultywacji zachowuje ich wcześniejsze skutki; wyłączenie pokarmu B zachowuje energię. Pełne dopracowanie tych ścieżek pozostaje częścią 1.0.

### Rozwinięte funkcje

- Lokalne biomy: przestrzenne różnice temperatury, żyzności i dostępności obu pokarmów. Sezonowość może różnie wpływać na poszczególne siedliska.
- Widoczne migracje między siedliskami i porównanie skuteczności tego samego genotypu w różnych warunkach.
- Dziennik zdarzeń powiązany z historią, wykresami i miernikami: spadkiem liczebności, zmianą rozrodu, zasobów i przyczyn zgonów. Interpretacje przyczyn wymagają prób kontrolnych.
- Kalibracja mechanik 0.4 przez dłuższe serie wielu seedów, z zachowaniem także wyników zerowych i niezgodnych z hipotezą.

### Warstwa edukacyjna

- Osobne prowadzone lekcje dla komunikacji, izolacji rozrodczej, uczenia, percepcji i konstrukcji niszy.
- Każda lekcja zawiera hipotezę, warunek kontrolny, jedną główną interwencję, mierniki i pytania do interpretacji.
- Przewodnik reaguje na faktyczne wyniki; nie wymusza oczekiwanego rezultatu ani nie uznaje samego uruchomienia świata za zakończenie doświadczenia.
- Lekcja „Dlaczego ten sam organizm radzi sobie inaczej w dwóch biomach?” uczy adaptacji, specjalizacji i kompromisów.

### Kryteria ukończenia

- Zapis, historia i rozwidlenie zachowują lokalne warunki środowiska.
- Kontrolowane przykłady potwierdzają działanie biomów i poprawny bilans energii.
- Użytkownik może sam przeprowadzić doświadczenie i odróżnić pomiar od interpretacji.

Dowody: [plan wykonania i weryfikacja](docs/IMPLEMENTATION_0.5.md), [kalibracja 42 przebiegów](docs/calibration-0.5/REPORT.md). Sześć prowadzonych lekcji korzysta z rzeczywistych pomiarów; testy sprawdzają biomy, migracje v2/v3 do v4, przełączniki i historię. Kalibracja zachowuje wymarcia, a wszystkie przedziały różnicy populacji końcowej obejmują zero — nie jest dowodem przewagi wszystkich mechanik.

## 0.6 — komunikacja i życie społeczne

### Rozwinięte funkcje

- Kilka kanałów sygnału, których użycie i znaczenie mogą ewoluować. Każdy ma jawny zasięg, koszt i reguły odbioru.
- Ślady chemiczne pozostające w przestrzeni: osadzanie, zanik i rozprzestrzenianie sygnału. Umożliwiają badanie orientacji i komunikacji odroczonej w czasie.
- Kosztowne przekazywanie energii innemu organizmowi, bez wytwarzania energii przez sam transfer.
- Ograniczona pamięć spotkań i lokalne rozpoznawanie osobników. Sieć nie dostaje wszechwiedzy o cudzych zamiarach ani historii całego świata.
- Narzędzia do obserwacji skupisk i relacji: częstotliwości spotkań, transferów, kosztów i późniejszych wyników rozrodczych.

### Narzędzia i edukacja

- Próby odbioru normalnego, wyłączonego i zakłóconego; analiza reakcji na sygnał przy kontrolowanych bodźcach.
- Lekcje o wartości informacji, pomocy krewnym, wzajemności i wykorzystywaniu pomocy.
- Porównanie przeżycia i potomstwa z komunikacją oraz bez niej. Sama korelacja sygnału z zachowaniem nie potwierdza współpracy.

### Kryteria ukończenia

- Transfery, pamięć spotkań i pola sygnału są zapisywane oraz poprawnie odtwarzane.
- Kontrole laboratoryjne wykrywają skonstruowane przypadki użytecznego i nieużytecznego sygnału.
- Aplikacja pozwala zmierzyć koszty i korzyści społeczne również wtedy, gdy współpraca się nie pojawia.

## 0.7 — populacje, migracje i specjacja

### Rozwinięte funkcje

- Wielogenowe preferencje partnera i zgodność rozrodcza, z osobnym pomiarem wpływu poszczególnych cech.
- Trwałe identyfikatory populacji oraz zapis rozdzielania, łączenia i zaniku grup przez pokolenia.
- Analiza przepływu genów, migracji i krzyżowania między populacjami; rozróżnienie genealogii, profilu ekologicznego i zgodności rozrodczej.
- Eksperyment „rozdziel i połącz”: odizolowanie siedlisk, ewolucja w separacji i ponowne otwarcie przejścia.
- Historia mieszańców i ich wyników życiowych w obu środowiskach, bez ręcznego nadawania im przewagi lub kary.

### Warstwa edukacyjna

- Lekcje o izolacji geograficznej i rozrodczej, przepływie genów oraz przejściowym rozdzieleniu populacji.
- Wyjaśnienie, dlaczego odmienny kolor, dieta albo wspólny przodek nie wystarczają do stwierdzenia gatunku.
- Wykres trwałości rozdzielenia wraz z zakresem obserwacji i niepewnością wynikającą z próbkowania.

### Kryteria ukończenia

- Identyfikacja populacji działa na kontrolowanych przypadkach rozdzielenia i ponownego połączenia.
- Wskaźniki izolacji uwzględniają kolejne pokolenia, liczebność i dostępność partnerów.
- System pokazuje niepewność oceny; nie deklaruje specjacji na podstawie pojedynczego ujęcia świata.

## 0.8 — ewoluujący ekosystem

### Rozwinięte funkcje

- Zasoby roślinne otrzymują dziedziczne cechy: tempo wzrostu, toksyczność, odporność na zjadanie i zdolność rozsiewu.
- Mutacje i rozmnażanie zasobów umożliwiają wzajemną adaptację roślin i konsumentów.
- Śledzenie dziedzictwa ekologicznego: zmian pozostawionych przez organizmy i ich wpływu na późniejsze pokolenia.
- Kontrolowane zaburzenia oraz badanie odporności i regeneracji ekosystemu.
- Rozszerzony bilans zasobów obejmuje nową populację roślinną i koszty jej wzrostu.

### Narzędzia i edukacja

- Eksperyment „usuń populację, pozostaw jej środowisko”: sprawdzenie, kto korzysta z dokonanych zmian.
- Porównanie zasobów ewoluujących i zasobów o stałych cechach przy tych samych warunkach startowych.
- Lekcje o wzajemnej adaptacji, konstrukcji niszy, dziedzictwie ekologicznym i odbudowie po katastrofie.

### Kryteria ukończenia

- Dziedziczenie i dobór cech roślin są mierzalne w kontrolowanych przykładach.
- Zapis oraz historia zachowują populację zasobów i jej genealogię w określonym budżecie pamięci.
- Można oddzielić wpływ genotypu konsumentów od zmian pozostawionych w środowisku.

## 0.9 — ewoluujący mózg i warsztat badacza

### Rozwinięte funkcje

- Ewolucja topologii sieci: najpierw powstawanie i zanik połączeń, następnie kontrolowane dodawanie oraz usuwanie neuronów.
- Koszt utrzymania zależny od złożoności sieci, aby większy mózg miał mierzalny kompromis energetyczny.
- Plastyczność zależna od połączenia; dalsze rozróżnianie dziedziczonej struktury i zmian nabytych podczas życia.
- Inspektor struktury sieci i jej zmian w genealogii, z możliwością porównania przodka oraz potomka.

### Narzędzia i edukacja

- Planowanie serii seedów, interwencji i ablacji z progressem, anulowaniem i zachowaniem wyników.
- Porównanie stałej oraz ewoluującej topologii, pamięci i uczenia przy wspólnych warunkach eksperymentu.
- Raporty zawierające konfigurację, wersję silnika, seedy, wielkości efektów, niepewność i wyniki zerowe.
- Pakiet doświadczenia umożliwiający drugiej osobie odtworzenie warunków i wyników w zgodnej wersji silnika.
- Wyszukiwanie interesujących zdarzeń w historii według jawnych mierników, np. wymarcia, rozdzielenia populacji lub gwałtownej zmiany strategii.
- Lekcje „Kiedy opłaca się większy mózg?”, „Pamięć czy uczenie?” i „Dlaczego jeden seed nie wystarcza?”.

### Kryteria ukończenia

- Mutacje strukturalne zachowują poprawność sieci, rozrodu, zapisów i odtwarzania.
- Próby kontrolne oddzielają korzyść struktury od korzyści większego budżetu energii lub stanu nauczonego.
- Eksperymenty nie zmieniają świata źródłowego, a pakiety zawierają dane konieczne do powtórzenia badania.
- Większa sieć nie jest automatycznie opisywana jako bardziej inteligentna.

## 1.0 — kompletna aplikacja do odkrywania sztucznego życia

### Docelowe doświadczenie

- **Obserwuj:** czytelny świat, ciekawe scenariusze, historie populacji i przejście od wydarzenia do odpowiednich pomiarów.
- **Ucz się:** ścieżka od podstaw ewolucji do samodzielnego doświadczenia, z lekcjami reagującymi na rzeczywisty przebieg symulacji.
- **Eksperymentuj:** kontrolowane interwencje, powtarzalne serie, raporty i odtwarzalne pakiety badań.
- Wszystkie mechaniki współdziałają w scenariuszach długotrwałego ekosystemu i pozostają dostępne osobno do badań.

### Kryteria wydania

- Spójne sterowanie, pomoc i wizualizacja każdej mechaniki; brak obietnic niepotwierdzonych zjawisk.
- Sprawdzona wydajność na jawnie określonych konfiguracjach świata, populacji i urządzeń.
- Weryfikacja wspieranych przeglądarek, obsługi dotyku i układów ekranu; zakres wsparcia zapisany w dokumentacji.
- Niezawodne zapisy, walidacja importu, odzyskiwanie danych i jawna polityka migracji między wersjami. Brak obietnicy identycznych trajektorii między różnymi silnikami.
- Długie testy zintegrowanych mechanik, determinizmu w obrębie wersji, bilansu energii, retencji historii i anulowania badań.
- Aktualne, opisane pomiary referencyjne oraz doświadczenia z wynikiem zerowym.
- Możliwość samodzielnego przejścia od pytania do pomiaru i interpretacji bez znajomości kodu aplikacji.

## Po 1.0 — osobne większe kierunki

- Wielokomórkowe organizmy i ewoluująca budowa ciała.
- Pasożyty, odporność i dodatkowe poziomy sieci pokarmowej.
- Naśladowanie, przekazywanie zachowań i badanie dziedziczenia kulturowego.
- Wspólne eksperymenty sieciowe lub publiczna biblioteka doświadczeń, jeśli pojawi się potrzeba backendu.

Te kierunki wymagają osobnego projektu mechanik, pomiarów i edukacji. Nie są warunkiem ukończenia 1.0.

## Priorytet i zależności

Najbliższy etap to **0.6**: rozwinięta komunikacja i relacje społeczne, z pomiarami kosztów i wartości przekazywanych informacji. Biomy, prowadzone próby i wyłączalne mechaniki z 0.5 tworzą podstawę do badania relacji społecznych i rozdzielania populacji.

Trzy najważniejsze rozszerzenia długoterminowe to **relacje społeczne, ewolucja zasobów i zmienna budowa mózgu**. Zwiększają zakres możliwych zachowań i wzajemnych oddziaływań.

Każdą wersję należy podzielić na mniejsze etapy implementacyjne. Historia, zapisy, pomiary, wydajność i pomoc są rozwijane wraz z mechaniką, zanim zostanie ona uznana za ukończoną.
