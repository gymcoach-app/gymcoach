import { settings as english } from '../en/settings';
import type { MessageShape } from '@/i18n/message-types';

export const settings = {
  title: 'Instellingen',
  account: 'Account',
  appearance: 'Weergave',
  session: 'Sessie',
  deviceOnly: 'Deze voorkeuren worden alleen op dit apparaat opgeslagen.',
  vibration: 'Trillen',
  vibrationDescription: 'Bij het loggen van een set en aan het eind van de timer.',
  timerSound: 'Piep aan het eind van de timer',
  timerSoundDescription: 'Speelt een korte piep van 880 Hz aan het eind van de rust.',
  restFlash: 'Scherm laten flitsen als de rust voorbij is',
  restFlashDescription:
    'Laat het scherm knipperen aan het eind van de rust, handig in een luidruchtige sportschool. Met beperkte beweging aan verandert het scherm van kleur zonder te knipperen.',
  readiness: 'Gereedheid en spierpijn mogen mijn voorgestelde gewichten aanpassen',
  readinessDescription:
    'Als dit aan staat, kan een recente gereedheidscheck-in het voorgestelde gewicht gelijk houden of verlagen. Als het uit staat, volgen de voorstellen puur de geplande progressie.',
  plateCalculator: 'Schijvencalculator',
  plateCalculatorDescription:
    'Gewicht van de stang en beschikbare schijven per kant, gebruikt door de schijvencalculator tijdens je training als er geen opgeslagen sportschool actief is. Vul de waarden in voor de eenheid waarin je traint.',
  equipment: 'Materiaal ({unit})',
  barWeight: 'Gewicht van de stang ({unit})',
  platesPerSide: 'Schijven per kant ({unit})',
  platesPlaceholder: 'bv. 25, 20, 15, 10, 5, 2,5, 1,25',
  platesHint: 'Scheid de schijven met een komma en een spatie.',
  gyms: {
    title: 'Sportscholen en materiaal',
    description:
      'Sla meerdere sportscholen op. Gewichtsvoorstellen gebruiken het materiaal dat bij de trainingssessie is vastgelegd.',
    savedGyms: 'Opgeslagen sportscholen',
    newGym: 'Sportschool toevoegen',
    active: 'actief',
    name: 'Naam van de sportschool',
    namePlaceholder: 'bv. Thuisgym in de kelder',
    dumbbells: 'Dumbbells (kg)',
    plates: 'Beschikbare schijven (kg, per kant)',
    bars: 'Gewichten van de stangen (kg)',
    exerciseAvailability: 'Oefeningen en machines',
    exerciseAvailabilityDescription:
      'Markeer materiaal dat ontbreekt. Vul voor machines en kabels eventueel elk instelbaar gewicht van de stack in.',
    searchExercises: 'Oefeningen zoeken',
    available: 'Beschikbaar',
    machineWeights: 'Instelbare gewichten (kg)',
    makeActive: 'Deze sportschool gebruiken',
    saved: 'Sportschool opgeslagen.',
    saveError: 'Kon de sportschool niet opslaan.',
    activated: 'Actieve sportschool gewijzigd.',
    activateError: 'Kon de actieve sportschool niet wijzigen.',
    deleted: 'Sportschool verwijderd.',
    deleteError: 'Kon de sportschool niet verwijderen.',
    deleteTitle: 'Deze sportschool verwijderen?',
    deleteDescription:
      '{name} wordt verwijderd. Bestaande sessies houden hun trainingsgeschiedenis.',
  },
  profile: {
    title: 'Profiel',
    description:
      'Met je profiel stemt de AI-coach zijn advies op jou af. Je lichaamsgewicht wordt ook gebruikt om de effectieve tonnage van oefeningen met lichaamsgewicht te berekenen; als je het wijzigt, wordt je geschiedenis opnieuw berekend.',
    displayName: 'Weergavenaam',
    namePlaceholder: 'Je naam',
    bodyweight: 'Lichaamsgewicht',
    bodyweightLabel: 'Lichaamsgewicht (kg)',
    bodyweightRange: 'Tussen 20 en 300 kg.',
    sex: 'Geslacht',
    height: 'Lengte',
    heightLabel: 'Lengte (cm)',
    heightRange: 'Tussen 100 en 250 cm.',
    goal: 'Doel',
    weeklyFrequency: 'Trainingsdagen per week',
    weeklyFrequencyLabel: 'Sessies / week',
    weeklyFrequencyRange: 'Tussen 1 en 14.',
    unit: 'Gewichtseenheid',
    unitDescription:
      'Bepaalt hoe gewichten worden getoond en ingevoerd. Je gegevens worden altijd in kg opgeslagen, dus wisselen verandert nooit je eerdere sessies.',
    effortScale: 'Inspanningsschaal',
    effortScaleDescription:
      'Bepaalt hoe inspanning wordt getoond en ingevoerd. Sets slaan altijd de herhalingen in reserve op (RPE = 10 - RIR), dus wisselen verandert nooit je eerdere sessies.',
    effortRir: 'RIR (herhalingen in reserve)',
    effortRpe: 'RPE (ervaren inspanning)',
    notSet: 'Niet ingesteld',
    fixFields: 'Verbeter de gemarkeerde velden.',
    saved: 'Profiel bijgewerkt.',
    saveError: 'Kon het profiel niet opslaan.',
    male: 'Man',
    female: 'Vrouw',
    other: 'Anders',
    strength: 'Kracht',
    hypertrophy: 'Hypertrofie',
    fatLoss: 'Vetverlies',
    recomp: 'Recompositie',
    generalFitness: 'Algemene fitheid',
    kilograms: 'Kilogram (kg)',
    pounds: 'Pond (lb)',
    distanceUnit: 'Afstandseenheid',
    distanceUnitDescription:
      'Bepaalt hoe afstand, tempo en snelheid bij cardio worden getoond en ingevoerd. Afstanden worden altijd in meters opgeslagen, dus wisselen verandert nooit je eerdere sessies. Automatisch volgt de gewichtseenheid: mijlen bij pond, kilometers bij kilogram.',
    distanceAuto: 'Automatisch (volgt de gewichtseenheid)',
    kilometers: 'Kilometers (km)',
    miles: 'Mijlen (mi)',
  },
  backup: {
    title: 'Gegevens',
    description: 'Lokale back-up maken of herstellen vanuit een JSON-bestand.',
    export: 'Al mijn gegevens exporteren (JSON)',
    exportDone: 'Export gedownload.',
    exportError: 'Exporteren is mislukt.',
    import: 'Een back-up importeren',
    invalidJson: 'Ongeldig JSON-bestand.',
    importDone: 'Import voltooid. Je bestaande gegevens zijn vervangen.',
    importError: 'Importeren is mislukt.',
    confirmTitle: 'Import bevestigen',
    confirmDescription:
      "Het bestand {file} vervangt al je huidige gegevens (programma's, sessies, sets, doelen, gewichtsgeschiedenis, check-ins, gesprekken met de coach). Dit kan niet ongedaan worden gemaakt.",
    replace: 'Ja, vervangen',
  },
  imports: {
    title: 'Trainingsgeschiedenis importeren',
    description: 'Importeer trainingen die je uit een andere trainingsapp hebt geëxporteerd.',
    source: 'App van herkomst',
    strongUnit: 'Gewichtseenheid in Strong',
    chooseFile: '{kind}-bestand kiezen',
    chooseFitFiles: 'FIT-bestanden kiezen',
    fileTooLarge: 'Een bestand is te groot: de limiet is 5 MB per bestand.',
    fitLimit: 'Maximaal {count} FIT-bestanden tegelijk.',
    previewFailed: 'Voorbeeld is mislukt.',
    importFailed: 'Importeren is mislukt.',
    confirm: 'Import bevestigen',
    previewOf: 'Voorbeeld van {file}',
    cardioTitle: 'Een {kind}-activiteit importeren',
    appTitle: 'Importeren uit {app}',
    cardioDescription:
      'Haal een cardiotraining binnen: {hint}. Bekijk hier het voorbeeld en bevestig daarna.',
    appDescription:
      'Haal je trainingsgeschiedenis uit de app {app} binnen: {hint}. Bekijk hier het voorbeeld en bevestig daarna.',
    activitiesSummary:
      '{count, plural, one {# activiteit} other {# activiteiten}} om te importeren{skipped, plural, =0 {} other { · # overgeslagen}}',
    possibleDuplicate: 'mogelijk dubbel',
    fileSkipped: 'Bestand {index} overgeslagen: {error}',
    importSessions: '{count, plural, one {# sessie importeren} other {# sessies importeren}}',
    cardioSession: '1 cardiosessie ({sport}) op {date}',
    loggedAs: 'gelogd als {name}',
    duplicateWarning:
      'Mogelijk dubbel: je hebt al een sessie die binnen 2 minuten van deze activiteit begint.',
    strengthSummary:
      '{sessions, plural, one {# sessie} other {# sessies}}, {sets, plural, one {# set} other {# sets}} om te importeren',
    newExercises:
      '{count, plural, one {# nieuwe oefening wordt} other {# nieuwe oefeningen worden}} aangemaakt: {names}',
    duplicatesSkipped:
      '{count, plural, one {# exact duplicaat wordt} other {# exacte duplicaten worden}} overgeslagen',
    cardioIncluded:
      '{count, plural, one {# cardioset} other {# cardiosets}} (duur/afstand) inbegrepen',
    cardioSkipped:
      '{count, plural, one {# cardioregel zonder bruikbare duur wordt} other {# cardioregels zonder bruikbare duur worden}} overgeslagen',
    nonSetRowsSkipped:
      '{count, plural, one {# regel met een rusttimer of notitie (geen set) wordt} other {# regels met een rusttimer of notitie (geen sets) worden}} overgeslagen',
    existingDates: 'Je hebt al sessies op: {dates}',
    unreadable:
      '{count, plural, one {# regel kon niet worden gelezen en wordt} other {# regels konden niet worden gelezen en worden}} overgeslagen:',
    lineError: 'Regel {line}: {reason}',
    moreErrors: '... en nog {count}',
    importDone:
      '{sessions, plural, one {# sessie} other {# sessies}}, {sets, plural, one {# set} other {# sets}}{exercises, plural, =0 {} one {, # nieuwe oefening} other {, # nieuwe oefeningen}} geïmporteerd.',
    fitImportDone:
      '{sessions, plural, one {# sessie} other {# sessies}}{exercises, plural, =0 {} one {, # nieuwe oefening} other {, # nieuwe oefeningen}} geïmporteerd{skipped, plural, =0 {.} one { (# bestand overgeslagen).} other { (# bestanden overgeslagen).}}',

    file: '{format}-bestand',
    exportHints: {
      strong: 'exporteer als CSV (Settings, dan Export data)',
      hevy: 'exporteer als CSV (Settings, dan Export & Import Data)',
      gymcoach:
        'gebruik de CSV-export van de geschiedenispagina, of een spreadsheet met dezelfde kolommen (session_date, workout, exercise, set_number, external_load_kg, reps, ...)',
      tcx: 'exporteer de activiteit als TCX vanuit je horlogeplatform (Garmin Connect, Polar Flow, ...); deze wordt één cardiotraining met duur, afstand en hartslag',
      gpx: 'exporteer de route als GPX vanuit Strava, Komoot of Apple Fitness; deze wordt één cardiotraining met duur, afstand en hartslag',
      fit: 'exporteer de activiteit als FIT-bestand vanaf je Garmin-horloge (of een ander horloge); deze wordt één cardiotraining met duur, afstand en hartslag',
      appleHealth:
        'tik in de Gezondheid-app op je profielfoto, dan op Exporteer alle gezondheidsgegevens, en kies het export.zip-bestand dat wordt gemaakt (of de export.xml daarin)',
      strava:
        'open op strava.com Instellingen, Mijn account, dan Aan de slag onder Download of verwijder je account, vraag je archief aan en kies het zip-bestand dat Strava je mailt',
    },
    appleHealth: {
      description:
        'Haal je cardiotrainingen uit Apple Gezondheid: {hint}. Bekijk hier het voorbeeld en bevestig daarna.',
      chooseFile: 'Kies export.zip',
      privacy:
        'De export wordt op dit apparaat gelezen, hoe groot hij ook is: alleen samenvattingen van trainingen (soort, datum, duur, afstand, hartslag) gaan naar je GymCoach-server. Krachttrainingen worden overgeslagen en trainingen die al in je geschiedenis staan, worden niet dubbel geïmporteerd.',
      reading: 'Export lezen: {read} van {total} MB',
      sending: 'Deel {done} van {total} verzenden',
      waiting: 'Importlimiet bereikt, verder over {seconds} s',
      nothingFound: 'Geen training of lichaamsgewicht gevonden in dit bestand.',
      noExportXml:
        'Dit archief bevat geen export.xml. Kies de export.zip die de Gezondheid-app heeft gemaakt.',
      unreadable: 'Dit bestand kon niet worden gelezen.',
      workouts:
        '{count, plural, one {# cardiotraining} other {# cardiotrainingen}} om te importeren',
      byType: '{name}: {count}',
      duplicates:
        '{count, plural, one {# training die al in je geschiedenis staat, wordt overgeslagen} other {# trainingen die al in je geschiedenis staan, worden overgeslagen}}',
      strengthSkipped:
        '{count, plural, one {# krachttraining wordt overgeslagen} other {# krachttrainingen worden overgeslagen}}',
      invalidSkipped:
        '{count, plural, one {# training zonder bruikbare datum of duur wordt overgeslagen} other {# trainingen zonder bruikbare datum of duur worden overgeslagen}}',
      conflicts:
        '{count, plural, one {# training kan niet worden geïmporteerd} other {# trainingen kunnen niet worden geïmporteerd}}: een van je oefeningen die geen cardio is, heeft die naam al',
      bodyMass:
        'Ook {count, plural, one {# meting van je lichaamsgewicht} other {# metingen van je lichaamsgewicht}} importeren',
      bodyMassDuplicates:
        '{count, plural, one {# meting van je lichaamsgewicht op een dag die al is ingevuld, wordt overgeslagen} other {# metingen van je lichaamsgewicht op dagen die al zijn ingevuld, worden overgeslagen}}',
      done:
        '{sessions, plural, one {# training} other {# trainingen}} geïmporteerd{weights, plural, =0 {} one {, # meting van je lichaamsgewicht} other {, # metingen van je lichaamsgewicht}}{skipped, plural, =0 {.} other { (# overgeslagen).}}',
    },
    strava: {
      description:
        'Haal je activiteiten uit Strava: {hint}. Bekijk hier het voorbeeld en bevestig daarna.',
      chooseFile: 'Strava-archief kiezen',
      privacy:
        'Het archief wordt op dit apparaat uitgepakt: alleen de activiteitsbestanden (FIT, GPX, TCX) gaan naar je GymCoach-server; foto’s en al het andere worden nooit gelezen. Imports zijn beperkt tot 10 verzoeken per minuut, dus een lange geschiedenis duurt even: houd dit tabblad open. Activiteiten die al in je geschiedenis staan, worden niet dubbel geïmporteerd.',
      checking:
        'Archief controleren: {read} van {total} MB, {count, plural, one {# activiteit gecontroleerd} other {# activiteiten gecontroleerd}}',
      importing:
        'Importeren: {read} van {total} MB, {count, plural, one {# activiteit verzonden} other {# activiteiten verzonden}}',
      waiting: 'Importlimiet bereikt, gaat verder over {seconds} s',
      cancelled: 'Import geannuleerd. Er is niets geïmporteerd.',
      cancelledAfterStart:
        'Import geannuleerd. De al geïmporteerde activiteiten blijven in je geschiedenis staan.',
      notZip: 'Dit bestand is geen zip-archief. Kies het zip-bestand dat Strava je heeft gemaild.',
      notStrava:
        'Dit archief bevat geen activities.csv en geen map activities. Kies het zip-bestand dat Strava je heeft gemaild.',
      unreadable: 'Dit archief kon niet worden gelezen.',
      activities:
        '{count, plural, one {# activiteit om te importeren} other {# activiteiten om te importeren}}',
      byType: '{name}: {count}',
      duplicates:
        '{count, plural, one {# activiteit staat al in je geschiedenis en wordt overgeslagen} other {# activiteiten staan al in je geschiedenis en worden overgeslagen}}',
      withoutFile:
        '{count, plural, one {# activiteit zonder bestand (met de hand ingevoerd op Strava) wordt overgeslagen} other {# activiteiten zonder bestand (met de hand ingevoerd op Strava) worden overgeslagen}}',
      unsupported:
        '{count, plural, one {# bestand in een indeling die GymCoach niet leest, wordt overgeslagen} other {# bestanden in een indeling die GymCoach niet leest, worden overgeslagen}}',
      tooLarge:
        '{count, plural, one {# bestand groter dan 5 MB wordt overgeslagen} other {# bestanden groter dan 5 MB worden overgeslagen}}',
      unreadableFiles:
        '{count, plural, one {# onleesbaar bestand wordt overgeslagen} other {# onleesbare bestanden worden overgeslagen}}',
      skippedFiles: 'Bestanden die worden overgeslagen',
      done:
        '{sessions, plural, one {# activiteit geïmporteerd} other {# activiteiten geïmporteerd}}{skipped, plural, =0 {.} other { (# overgeslagen).}}',
    },
  },
  mcp: {
    title: 'ChatGPT en MCP',
    description:
      'Koppel een externe AI-agent aan je GymCoach-gegevens. Tokens kun je altijd intrekken.',
    keyName: 'Naam van de koppeling',
    create: 'Koppeling aanmaken',
    created: 'MCP-koppeling aangemaakt.',
    createError: 'Kon de MCP-koppeling niet aanmaken.',
    writeAccess: 'Wijzigingen in opgeslagen gegevens toestaan',
    writeAccessDescription:
      "ChatGPT kan programma's aanmaken en bewerken, je sportschoolmateriaal bijwerken (losse gewichten, materiaal en foto's daarvan) en gegevens in je trainingsgeschiedenis bijwerken, zoals het materiaal dat bij eerdere sets is vastgelegd. De actie wordt eerst aan je getoond ter bevestiging.",
    readyTitle: 'De connector-URL voor ChatGPT is klaar',
    readyDescription:
      'Kopieer hem nu. Het geheime deel wordt maar één keer getoond. Kies in ChatGPT voor geen authenticatie, want de URL bevat al een privétoken.',
    copied: 'Connector-URL gekopieerd.',
    copy: 'Connector-URL kopiëren',
    activeKeys: 'Actieve koppelingen',
    noKeys: 'Nog geen MCP-koppelingen.',
    readWrite: 'Lezen en schrijven',
    readOnly: 'Alleen lezen',
    lastUsed: 'gebruikt op {date}',
    revoke: 'Koppeling intrekken',
    revoked: 'MCP-koppeling ingetrokken.',
    revokeError: 'Kon de MCP-koppeling niet intrekken.',
  },
} satisfies MessageShape<typeof english>;
