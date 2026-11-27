import { common as english } from '../en/common';
import type { MessageShape } from '@/i18n/message-types';

export const common = {
  metadata: {
    description: 'Dziennik treningu siłowego i osobisty trener AI.',
  },
  actions: {
    add: 'Dodaj',
    apply: 'Zastosuj',
    back: 'Wstecz',
    cancel: 'Anuluj',
    close: 'Zamknij',
    confirm: 'Potwierdź',
    continue: 'Dalej',
    create: 'Utwórz',
    delete: 'Usuń',
    download: 'Pobierz',
    edit: 'Edytuj',
    finish: 'Zakończ',
    generate: 'Generuj',
    import: 'Importuj',
    loading: 'Ładowanie...',
    refresh: 'Odśwież',
    remove: 'Usuń',
    resume: 'Wznów',
    retry: 'Spróbuj ponownie',
    save: 'Zapisz',
    saving: 'Zapisywanie...',
    start: 'Rozpocznij',
    upload: 'Prześlij',
    view: 'Zobacz',
  },
  fields: {
    description: 'Opis',
    email: 'E-mail',
    name: 'Nazwa',
    notes: 'Notatki',
    password: 'Hasło',
  },
  states: {
    active: 'Aktywny',
    completed: 'Ukończony',
    empty: 'bez ćwiczeń',
    inactive: 'Nieaktywny',
    no: 'Nie',
    optional: 'Opcjonalnie',
    yes: 'Tak',
  },
  counts: {
    exercises:
      '{count, plural, =0 {Brak ćwiczeń} one {# ćwiczenie} few {# ćwiczenia} many {# ćwiczeń} other {# ćwiczenia}}',
    pending:
      '{count, plural, one {# oczekuje} few {# oczekują} many {# oczekuje} other {# oczekuje}}',
    sessions:
      '{count, plural, =0 {Brak sesji} one {# sesja} few {# sesje} many {# sesji} other {# sesji}}',
    sets: '{count, plural, =0 {Brak serii} one {# seria} few {# serie} many {# serii} other {# serii}}',
    workouts:
      '{count, plural, =0 {Brak treningów} one {# trening} few {# treningi} many {# treningów} other {# treningu}}',
  },
  days: {
    monday: 'Poniedziałek',
    tuesday: 'Wtorek',
    wednesday: 'Środa',
    thursday: 'Czwartek',
    friday: 'Piątek',
    saturday: 'Sobota',
    sunday: 'Niedziela',
  },
  language: {
    label: 'Język',
    change: 'Zmień język',
    description: 'Wybierz język interfejsu GymCoach.',
    english: 'Angielski',
    french: 'Francuski',
    russian: 'Rosyjski',
    german: 'Niemiecki',
    spanish: 'Hiszpański',
    portuguese: 'Portugalski',
    italian: 'Włoski',
    dutch: 'Niderlandzki',
    polish: 'Polski',
    turkish: 'Turecki',
    error: 'Nie udało się zmienić języka.',

    chinese: 'Chiński uproszczony',
  },
  units: {
    bpm: '{value} ud./min',
  },
  theme: {
    dark: 'Ciemny',
    light: 'Jasny',
    system: 'Systemowy',
    switchToDark: 'Przełącz na tryb ciemny',
    switchToLight: 'Przełącz na tryb jasny',
  },
  offline: {
    offline: 'Offline',
    syncNow: 'Synchronizuj teraz',
    syncing: 'Synchronizacja ({count})...',
    pending:
      'Offline · {count, plural, one {# oczekuje} few {# oczekują} many {# oczekuje} other {# oczekuje}}',
  },
  errors: {
    generic: 'Coś poszło nie tak. Spróbuj ponownie.',
  },
  // A failed AI provider call, by class (issue #571). {variable} is the name
  // of an environment variable, never its value.
  aiErrors: {
    invalidKey:
      'Dostawca AI odrzucił klucz API. Sprawdź {variable} w pliku .env i uruchom ponownie.',
    quota:
      'Dostawca AI odrzucił żądanie: osiągnięto limit lub wyczerpano środki. Odczekaj chwilę i spróbuj ponownie albo sprawdź środki na koncie u dostawcy.',
    model:
      'Model AI odrzucił żądanie lub zwrócił odpowiedź, której nie dało się użyć. Sprawdź nazwę modelu w {variable} albo wybierz inny model.',
    outage: 'Dostawca AI jest teraz niedostępny. Spróbuj ponownie później.',
    timeout:
      'Dostawca AI nie odpowiedział na czas lub nie udało się z nim połączyć. Spróbuj ponownie.',
    truncated:
      'Odpowiedź AI została ucięta: modelowi zabrakło tokenów wyjściowych. Zwiększ {variable} albo spróbuj ponownie.',
    notConfigured:
      'Dostawca AI nie jest poprawnie skonfigurowany. Sprawdź {variable} w pliku .env i uruchom ponownie.',
    unknown:
      'Żądanie do AI nie powiodło się. Spróbuj ponownie; jeśli błąd się powtarza, sprawdź log serwera.',
  },
} satisfies MessageShape<typeof english>;
