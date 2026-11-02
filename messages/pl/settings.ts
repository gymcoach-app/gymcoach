import { settings as english } from '../en/settings';
import type { MessageShape } from '@/i18n/message-types';

export const settings = {
  title: 'Ustawienia',
  account: 'Konto',
  appearance: 'Wygląd',
  session: 'Sesja',
  deviceOnly: 'Te preferencje są zapisywane tylko na tym urządzeniu.',
  vibration: 'Wibracje',
  vibrationDescription: 'Przy zapisie serii i na koniec odliczania.',
  timerSound: 'Sygnał na koniec odliczania',
  timerSoundDescription: 'Krótki sygnał 880 Hz na koniec przerwy.',
  restFlash: 'Mignij ekranem po zakończeniu przerwy',
  restFlashDescription:
    'Ekran miga na koniec przerwy, przydatne na głośnej siłowni. Przy włączonym ograniczeniu ruchu ekran zmienia kolor bez migania.',
  readiness: 'Pozwól, by gotowość i zakwasy zmieniały proponowane ciężary',
  readinessDescription:
    'Gdy włączone, niedawny check-in gotowości może utrzymać albo obniżyć proponowany ciężar. Gdy wyłączone, propozycje wynikają wyłącznie z zaplanowanej progresji.',
  plateCalculator: 'Kalkulator talerzy',
  plateCalculatorDescription:
    'Ciężar gryfu i dostępne talerze na stronę, używane przez kalkulator talerzy w trakcie treningu, gdy nie jest aktywna żadna zapisana siłownia. Podaj wartości w jednostce, w której trenujesz.',
  equipment: 'Sprzęt ({unit})',
  barWeight: 'Ciężar gryfu ({unit})',
  platesPerSide: 'Talerze na stronę ({unit})',
  platesPlaceholder: 'np. 25, 20, 15, 10, 5, 2,5, 1,25',
  platesHint: 'Oddziel talerze przecinkiem i spacją.',
  gyms: {
    title: 'Siłownie i sprzęt',
    description:
      'Zapisz kilka siłowni. Propozycje ciężarów korzystają ze sprzętu zapisanego przy sesji treningowej.',
    savedGyms: 'Zapisane siłownie',
    newGym: 'Dodaj siłownię',
    active: 'aktywna',
    name: 'Nazwa siłowni',
    namePlaceholder: 'np. Siłownia w piwnicy',
    dumbbells: 'Hantle (kg)',
    plates: 'Dostępne talerze (kg, na stronę)',
    bars: 'Ciężary gryfów (kg)',
    exerciseAvailability: 'Ćwiczenia i maszyny',
    exerciseAvailabilityDescription:
      'Oznacz brakujący sprzęt. Dla maszyn i wyciągów możesz podać każdy dostępny ciężar stosu.',
    searchExercises: 'Szukaj ćwiczeń',
    available: 'Dostępne',
    machineWeights: 'Dostępne ciężary (kg)',
    makeActive: 'Używaj tej siłowni',
    saved: 'Siłownia zapisana.',
    saveError: 'Nie udało się zapisać siłowni.',
    activated: 'Zmieniono aktywną siłownię.',
    activateError: 'Nie udało się zmienić aktywnej siłowni.',
    deleted: 'Siłownia usunięta.',
    deleteError: 'Nie udało się usunąć siłowni.',
    deleteTitle: 'Usunąć tę siłownię?',
    deleteDescription:
      'Siłownia {name} zostanie usunięta. Istniejące sesje zachowają historię treningów.',
  },
  profile: {
    title: 'Profil',
    description:
      'Profil pozwala trenerowi AI dopasować porady. Masa ciała służy też do liczenia efektywnego tonażu ćwiczeń z masą ciała; jej zmiana przelicza historię.',
    displayName: 'Wyświetlana nazwa',
    namePlaceholder: 'Twoje imię',
    bodyweight: 'Masa ciała',
    bodyweightLabel: 'Masa ciała (kg)',
    bodyweightRange: 'Od 20 do 300 kg.',
    sex: 'Płeć',
    height: 'Wzrost',
    heightLabel: 'Wzrost (cm)',
    heightRange: 'Od 100 do 250 cm.',
    goal: 'Cel',
    weeklyFrequency: 'Dni treningowe w tygodniu',
    weeklyFrequencyLabel: 'Sesje / tydzień',
    weeklyFrequencyRange: 'Od 1 do 14.',
    unit: 'Jednostka ciężaru',
    unitDescription:
      'Zmienia sposób wyświetlania i wpisywania ciężarów. Dane są zawsze zapisywane w kg, więc zmiana nigdy nie wpływa na wcześniejsze sesje.',
    notSet: 'Nie ustawiono',
    fixFields: 'Popraw zaznaczone pola.',
    saved: 'Profil zaktualizowany.',
    saveError: 'Nie udało się zapisać profilu.',
    male: 'Mężczyzna',
    female: 'Kobieta',
    other: 'Inna',
    strength: 'Siła',
    hypertrophy: 'Hipertrofia',
    fatLoss: 'Redukcja tkanki tłuszczowej',
    recomp: 'Rekompozycja',
    generalFitness: 'Ogólna sprawność',
    kilograms: 'Kilogramy (kg)',
    pounds: 'Funty (lb)',
  },
  backup: {
    title: 'Dane',
    description: 'Lokalna kopia zapasowa albo przywracanie z pliku JSON.',
    export: 'Eksportuj wszystkie moje dane (JSON)',
    exportDone: 'Eksport pobrany.',
    exportError: 'Eksport nie powiódł się.',
    import: 'Importuj kopię zapasową',
    invalidJson: 'Nieprawidłowy plik JSON.',
    importDone: 'Import zakończony. Dotychczasowe dane zostały zastąpione.',
    importError: 'Import nie powiódł się.',
    confirmTitle: 'Potwierdź import',
    confirmDescription:
      'Plik {file} zastąpi wszystkie Twoje obecne dane (programy, sesje, serie, cele, historię masy ciała, check-iny, rozmowy z trenerem). Tej operacji nie można cofnąć.',
    replace: 'Tak, zastąp',
  },
  imports: {
    title: 'Importuj historię treningów',
    description: 'Importuj treningi wyeksportowane z innej aplikacji treningowej.',
    source: 'Aplikacja źródłowa',
    strongUnit: 'Jednostka ciężaru w Strong',
    chooseFile: 'Wybierz plik {kind}',
    chooseFitFiles: 'Wybierz pliki FIT',
    fileTooLarge: 'Plik jest za duży: limit to 5 MB na plik.',
    fitLimit:
      'Najwyżej {count, plural, one {# plik FIT} few {# pliki FIT} many {# plików FIT} other {# pliku FIT}} naraz.',
    previewFailed: 'Podgląd nie powiódł się.',
    importFailed: 'Import nie powiódł się.',
    confirm: 'Potwierdź import',
    previewOf: 'Podgląd pliku {file}',
    cardioTitle: 'Importuj aktywność {kind}',
    appTitle: 'Importuj z {app}',
    cardioDescription: 'Dodaj trening cardio: {hint}. Sprawdź podgląd tutaj, a potem potwierdź.',
    appDescription:
      'Przenieś historię treningów z aplikacji {app}: {hint}. Sprawdź podgląd tutaj, a potem potwierdź.',
    activitiesSummary:
      '{count, plural, one {# aktywność} few {# aktywności} many {# aktywności} other {# aktywności}} do importu{skipped, plural, =0 {} other { · pominięte: #}}',
    possibleDuplicate: 'możliwy duplikat',
    fileSkipped: 'Pominięto plik {index}: {error}',
    importSessions:
      'Importuj {count, plural, one {# sesję} few {# sesje} many {# sesji} other {# sesji}}',
    cardioSession: '1 sesja cardio ({sport}) w dniu {date}',
    loggedAs: 'zapisana jako {name}',
    duplicateWarning:
      'Możliwy duplikat: masz już sesję rozpoczętą w ciągu 2 minut od tej aktywności.',
    strengthSummary:
      '{sessions, plural, one {# sesja} few {# sesje} many {# sesji} other {# sesji}}, {sets, plural, one {# seria} few {# serie} many {# serii} other {# serii}} do importu',
    newExercises:
      '{count, plural, one {Zostanie utworzone # nowe ćwiczenie} few {Zostaną utworzone # nowe ćwiczenia} many {Zostanie utworzonych # nowych ćwiczeń} other {Zostanie utworzone # nowego ćwiczenia}}: {names}',
    duplicatesSkipped:
      '{count, plural, one {# dokładny duplikat zostanie pominięty} few {# dokładne duplikaty zostaną pominięte} many {# dokładnych duplikatów zostanie pominiętych} other {# dokładnego duplikatu zostanie pominięte}}',
    cardioIncluded:
      'Uwzględniono {count, plural, one {# serię cardio} few {# serie cardio} many {# serii cardio} other {# serii cardio}} (czas/dystans)',
    cardioSkipped:
      '{count, plural, one {# wiersz cardio bez użytecznego czasu zostanie pominięty} few {# wiersze cardio bez użytecznego czasu zostaną pominięte} many {# wierszy cardio bez użytecznego czasu zostanie pominiętych} other {# wiersza cardio bez użytecznego czasu zostanie pominięte}}',
    existingDates: 'Masz już sesje w dniach: {dates}',
    unreadable:
      '{count, plural, one {Nie udało się odczytać # wiersza; zostanie pominięty:} few {Nie udało się odczytać # wierszy; zostaną pominięte:} many {Nie udało się odczytać # wierszy; zostaną pominięte:} other {Nie udało się odczytać # wiersza; zostanie pominięty:}}',
    lineError: 'Wiersz {line}: {reason}',
    moreErrors: '... i {count} więcej',
    importDone:
      'Zaimportowano: {sessions, plural, one {# sesja} few {# sesje} many {# sesji} other {# sesji}}, {sets, plural, one {# seria} few {# serie} many {# serii} other {# serii}}{exercises, plural, =0 {} one {, # nowe ćwiczenie} few {, # nowe ćwiczenia} many {, # nowych ćwiczeń} other {, # nowego ćwiczenia}}.',
    fitImportDone:
      'Zaimportowano: {sessions, plural, one {# sesja} few {# sesje} many {# sesji} other {# sesji}}{exercises, plural, =0 {} one {, # nowe ćwiczenie} few {, # nowe ćwiczenia} many {, # nowych ćwiczeń} other {, # nowego ćwiczenia}}{skipped, plural, =0 {.} one { (pominięto # plik).} few { (pominięto # pliki).} many { (pominięto # plików).} other { (pominięto # pliku).}}',

    file: 'Plik {format}',
    exportHints: {
      strong: 'wyeksportuj dane jako CSV (Settings, następnie Export data)',
      hevy: 'wyeksportuj dane jako CSV (Settings, następnie Export & Import Data)',
      gymcoach:
        'użyj pliku CSV wyeksportowanego ze strony historii lub arkusza z tymi samymi kolumnami (session_date, workout, exercise, set_number, external_load_kg, reps, ...)',
      tcx: 'wyeksportuj aktywność jako TCX z platformy zegarka (Garmin Connect, Polar Flow, ...); zostanie dodana jako jeden trening cardio z czasem trwania, dystansem i tętnem',
      gpx: 'wyeksportuj trasę jako GPX ze Strava, Komoot lub Apple Fitness; zostanie dodana jako jeden trening cardio z czasem trwania, dystansem i tętnem',
      fit: 'wyeksportuj aktywność jako plik FIT z zegarka Garmin (lub innego); zostanie dodana jako jeden trening cardio z czasem trwania, dystansem i tętnem',
    },
  },
  mcp: {
    title: 'ChatGPT i MCP',
    description:
      'Połącz zewnętrznego agenta AI z danymi GymCoach. Tokeny możesz unieważnić w każdej chwili.',
    keyName: 'Nazwa połączenia',
    create: 'Utwórz połączenie',
    created: 'Połączenie MCP utworzone.',
    createError: 'Nie udało się utworzyć połączenia MCP.',
    writeAccess: 'Zezwól na zmiany zapisanych danych',
    writeAccessDescription:
      'ChatGPT może tworzyć i edytować programy, aktualizować sprzęt siłowni (wolne ciężary, sprzęt i jego zdjęcia) oraz dane historii treningów, np. sprzęt zapisany przy wcześniejszych seriach, po pokazaniu działania do potwierdzenia.',
    readyTitle: 'Adres URL konektora ChatGPT jest gotowy',
    readyDescription:
      'Skopiuj go teraz. Część tajna jest pokazywana tylko raz. W ChatGPT wybierz brak uwierzytelniania, bo adres URL zawiera już prywatny token.',
    copied: 'Adres URL konektora skopiowany.',
    copy: 'Kopiuj adres URL konektora',
    activeKeys: 'Aktywne połączenia',
    noKeys: 'Brak połączeń MCP.',
    readWrite: 'Odczyt i zapis',
    readOnly: 'Tylko odczyt',
    lastUsed: 'użyte {date}',
    revoke: 'Unieważnij połączenie',
    revoked: 'Połączenie MCP unieważnione.',
    revokeError: 'Nie udało się unieważnić połączenia MCP.',
  },
} satisfies MessageShape<typeof english>;
