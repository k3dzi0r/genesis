# Kalibracja GENESIS 0.5.0

Wykonano 42 biegów, po maksymalnie 10000 ticków (wymarcie kończy bieg). Seedy: 101, 202, 303, 404, 505, 606. 7 biegów osiągnęło docelowy tick; pozostałe wymarły wcześniej. Rzeczywiste końce biegów: 2018–10000. Setup i pełne parametry doświadczenia znajdują się w report.json. Każdy wariant zmienia jeden parametr względem wspólnej kontroli; identyczne seedy tworzą pary. To seria eksploracyjna jednej konfiguracji, bez wyboru korzystnych seedów.

Kontrola: wszystkie sześć badanych mechanik aktywne, dwa pokarmy oraz rozród płciowy. Znak Δ = wariant − kontrola.

| Wariant | Δ populacji końcowej | 95% CI różnicy sparowanej | p (bez korekty) | Wymarcia |
|---|---:|---:|---:|---:|
| Bez komunikacji | -29.17 | [-104.14, 45.81] | 0.3632 | 5/6 |
| Bez wyboru partnera | 22.83 | [-35.86, 81.53] | 0.3632 | 5/6 |
| Bez uczenia | -34.83 | [-124.38, 54.71] | 0.3632 | 6/6 |
| Widzenie 360° | -10.33 | [-129.66, 109.00] | 0.8327 | 5/6 |
| Bez konstrukcji niszy | -14.67 | [-126.75, 97.41] | 0.7502 | 5/6 |
| Bez biomów | 3.83 | [-95.59, 103.26] | 0.9249 | 4/6 |

Kontrola: 5/6 wymarć. Wyniki zerowe i przeciwne oczekiwaniom pozostają w danych. Przedziały t-Studenta przy małej liczbie seedów wymagają ostrożnej interpretacji; sześć porównań nie ma korekty wielokrotnych testów. Populacja ma twardy limit 600, więc nasycenie może ukrywać różnice. Średnia populacja jest średnią zachowanych wierszy statystyk; narodziny i zgony sumują przedziały do ostatniej próbki (możliwy niepełny końcowy przedział przy wymarciu). Nie mierzymy tutaj wyłonienia znaczenia sygnałów, pełnej specjacji ani przewagi każdego genotypu.

Audyt: ponowna kontrola pierwszego seeda identyczna: true. Zapis/odczyt w połowie i dalszy bieg identyczny dla każdego wariantu pierwszego seeda. Odczyty podsumowań i biomów nie zmieniły hashy. Maksymalny bezwzględny błąd bilansu energii: 1.9335857359692454e-9. Hashy FNV-1a używamy jako kontroli regresji, nie dowodu kryptograficznego. Czas: 21.1 s.

Powtórzenie: `npm run calibrate -- --seeds 101,202,303,404,505,606 --ticks 10000 --out docs/calibration-0.5`. Surowe wyniki, metryki sparowane dla populacji średniej/końcowej, narodzin i zgonów: report.json; wszystkie biegi: runs.csv.
