# D&D 5e Merchant Generator - MVP ideas

### Główny problem
Mistrzowie Gry (MG) w Dungeons & Dragons 5e często tracą dużo czasu na ręczne wymyślanie, losowanie i balansowanie asortymentu sklepów oraz handlarzy podczas sesji lub w trakcie przygotowań. Brakuje prostego narzędzia, które natychmiastowo generuje sensownego kupca z odpowiednimi przedmiotami, ich dostępną ilością oraz spójną wyceną, dopasowaną do konkretnej kategorii. Dodatkowym problemem jest gubienie wygenerowanych wcześniej list asortymentu między sesjami.

### Najmniejszy zestaw funkcjonalności
- Wybór kategorii asortymentu handlarza z listy (np. przedmioty magiczne, kowal, alchemik, towary ogólne).
- Przycisk "Stwórz" uruchamiający generowanie asortymentu.
- Losowanie asortymentu składającego się z 10 do 25 unikalnych pozycji dopasowanych do wybranej kategorii.
- Automatyczne określanie ceny oraz dostępnej ilości dla każdego wylosowanego przedmiotu.
- Czytelne wyświetlanie wyników w formie przejrzystej tabeli (Nazwa przedmiotu, Ilość, Cena).
- **Zapisywanie wygenerowanych handlarzy (np. w pamięci lokalnej przeglądarki), aby Mistrz Gry mógł łatwo do nich wrócić na kolejnych sesjach.**

### Co NIE wchodzi w zakres MVP
- Złożone generowanie fabularnej otoczki kupca (imię, rasa, wygląd, historia, cechy charakteru).
- Zaawansowany system dynamicznej ekonomii (zmiany cen w zależności od regionu czy podaży i popytu).
- Moduł negocjacji i targowania się z kupcem, uwzględniający statystyki postaci graczy.
- Możliwość dodawania własnych przedmiotów (homebrew) do bazy aplikacji.
- Zaawansowany system logowania z kontami użytkowników i synchronizacją w chmurze (zapisywanie w MVP opiera się na lokalnym systemie, np. LocalStorage).
- Dedykowana aplikacja mobilna (początkowo tylko strona internetowa dostosowana do ekranów).

### Kryteria sukcesu
- Wygenerowanie pełnego i logicznego asortymentu zajmuje użytkownikowi mniej niż 5 sekund.
- Wygenerowane listy przedmiotów za każdym razem prawidłowo mieszczą się w przedziale 10-25 pozycji.
- 8 na 10 Mistrzów Gry testujących aplikację uznaje wygenerowany asortyment za gotowy do natychmiastowego użycia na sesji bez potrzeby ręcznych modyfikacji.
- Użytkownicy korzystają z funkcji zapisu i regularnie powracają do stworzonych wcześniej kupców.
