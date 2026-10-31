import { coach as english } from '../en/coach';
import type { MessageShape } from '@/i18n/message-types';

export const coach = {
  title: 'Trener',
  description: 'Cotygodniowe podsumowanie treningu od AI.',
  chatTitle: 'Czat',
  chatDescription: 'Rozmawiaj z trenerem, który zna Twoje dane treningowe.',
  conversation: 'Rozmowa',
  client: {
    generating: 'Generowanie (10-20 s)...',
    request: 'Poproś o podsumowanie tygodnia',
    empty: 'Nie ma jeszcze podsumowania. Poproś o pierwsze powyżej.',
    unknownError: 'Nieznany błąd',
    tooManyDebriefs: 'Zbyt wiele próśb o podsumowanie. Spróbuj ponownie później.',
    keyMissing: 'Brak klucza {provider}',
    keySetup: 'Ustaw {variable} w pliku .env, aby włączyć trenera.',
    applied: 'Zastosowano',
    debriefFrom: 'Podsumowanie z {date}',
    weekOf: 'Tydzień od {date}',
  },
  chat: {
    apiKey: 'Ustaw {variable} w pliku .env, aby włączyć czat.',
    liveSession: 'Podłączono bieżącą sesję.',
    new: 'Nowa',
    placeholder: 'Napisz do trenera...',
    send: 'Wyślij',
    liveSessionDescription:
      'Trener widzi zapisane do tej pory serie i cele programu na ten trening.',
    emptySession:
      'Pytanie w trakcie treningu? Zapytaj o kolejną serię, ciężar, który nie pasuje, albo zamianę ćwiczenia.',
    empty:
      'Zapytaj o przełamanie stagnacji, objętość treningu, progresję, regenerację albo zmiany przy kontuzji.',
    advisory:
      'Czat doradza, ale nie może zmieniać Twoich danych. Zmiany wprowadzasz samodzielnie na stronie Programy albo z podsumowania tygodnia.',
  },
  context: {
    title: 'Co widzi trener',
    teaser: 'Kontekst treningowy stojący za każdym podsumowaniem. Dotknij, aby rozwinąć.',
    history: 'Historia treningów',
    goals: 'Cele',
    achieved: 'osiągnięto',
    noGoals: 'Brak celów dla ćwiczeń.',
    fatigue: 'Zmęczenie',
    conditioning: 'Kondycja',
    readiness: 'Gotowość',
    historySummary:
      'Historia z {weeks, plural, one {ostatniego tygodnia} few {ostatnich # tygodni} many {ostatnich # tygodni} other {ostatnich # tygodnia}}, {exercises, plural, one {# ćwiczenie} few {# ćwiczenia} many {# ćwiczeń} other {# ćwiczenia}}.',
    noHistory: 'Brak zapisanych sesji - trener zaczyna się uczyć od pierwszego treningu.',
    goalProgress: '({percent}% celu)',
    stalled: 'Ćwiczenia w stagnacji: {names}.',
    noStalled: 'Nie wykryto ćwiczeń w stagnacji.',
    deloadActive: 'Trwa zaplanowany tydzień deloadu.',
    deloadRecommended: 'Zalecany deload{reasons, select, none {.} other {: {reasons}.}}',
    noDeload: 'Deload nie jest zalecany.',
    conditioningSummary:
      'Ten tydzień: {minutes} min{km, select, none {} other { · {km} km}} · {sessions, plural, one {# sesja} few {# sesje} many {# sesji} other {# sesji}} (cel {target} min/tydz.)',
    today: 'dziś',
    daysAgo:
      '{days, plural, one {# dzień temu} few {# dni temu} many {# dni temu} other {# dnia temu}}',
    readinessSummary: 'Ostatni check-in {when}: gotowość {readiness}/5, sen {sleep}/5.',
    noReadiness: 'Brak check-inu gotowości w ostatnich 7 dniach.',
    privacy:
      'AI otrzymuje takie krótkie podsumowanie oraz Twoje ostatnie zapisy treningów seria po serii - nigdy dane konta ani nic spoza historii treningów.',
  },
  note: {
    title: 'Notatka dla trenera',
    description:
      'Dodaj kontekst, którego nie widać w danych treningowych, np. kontuzję, chorobę albo wyjazd.',
    placeholder: 'np. Bark mi dokucza, w tym tygodniu lżej z wyciskaniami.',
    clear: 'Wyczyść',
    save: 'Zapisz',
    saved: 'Notatka zapisana.',
    cleared: 'Notatka wyczyszczona.',
    error: 'Nie udało się zapisać notatki.',
  },
  adjustments: {
    title: 'Proponowane zmiany',
    applied: 'Już zastosowane',
    description:
      'Wybierz, co zastosować w aktywnym programie. Przed potwierdzeniem możesz zmienić wartości.',
    aria: 'Zastosuj zmianę dla ćwiczenia {exercise}',
    repsMin: 'Powt. min',
    repsMax: 'Powt. maks',
    sets: 'Serie',
    rest: 'Przerwa (s)',
    targetLoad: 'Docelowy ciężar',
    versus: ' (było {value})',
    applying: 'Stosowanie...',
    apply:
      'Zastosuj {count, plural, one {# zmianę} few {# zmiany} many {# zmian} other {# zmiany}}',
  },
} satisfies MessageShape<typeof english>;
