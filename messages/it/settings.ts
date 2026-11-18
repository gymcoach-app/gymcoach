import { settings as english } from '../en/settings';
import type { MessageShape } from '@/i18n/message-types';

export const settings = {
  title: 'Impostazioni',
  account: 'Account',
  appearance: 'Aspetto',
  session: 'Sessione',
  deviceOnly: 'Queste preferenze sono salvate solo su questo dispositivo.',
  vibration: 'Vibrazione',
  vibrationDescription: 'Alla registrazione di una serie e alla fine del timer.',
  timerSound: 'Bip a fine timer',
  timerSoundDescription: 'Riproduce un breve bip a 880 Hz alla fine del recupero.',
  restFlash: 'Fai lampeggiare lo schermo a fine recupero',
  restFlashDescription:
    'Lo schermo lampeggia alla fine del recupero, utile in una palestra rumorosa. Con la riduzione del movimento attiva, lo schermo cambia colore senza lampeggiare.',
  readiness: 'Adatta i carichi suggeriti in base a stato di forma e indolenzimento',
  readinessDescription:
    'Se attivo, un check-in recente sullo stato di forma può mantenere o ridurre il carico suggerito. Se disattivo, i suggerimenti seguono solo la progressione programmata.',
  plateCalculator: 'Calcolatore dischi',
  plateCalculatorDescription:
    'Peso del bilanciere e dischi disponibili per lato, usati dal calcolatore dischi durante l’allenamento quando non è attiva nessuna palestra salvata. Imposta i valori nell’unità con cui ti alleni.',
  equipment: 'Attrezzatura ({unit})',
  barWeight: 'Peso del bilanciere ({unit})',
  platesPerSide: 'Dischi per lato ({unit})',
  platesPlaceholder: 'Es. 25, 20, 15, 10, 5, 2,5, 1,25',
  platesHint: 'Separa i dischi con una virgola e uno spazio.',
  gyms: {
    title: 'Palestre e attrezzatura',
    description:
      'Salva più palestre. I suggerimenti di carico usano l’inventario fissato nella sessione di allenamento.',
    savedGyms: 'Palestre salvate',
    newGym: 'Aggiungi palestra',
    active: 'attiva',
    name: 'Nome della palestra',
    namePlaceholder: 'Es. Palestra in garage',
    dumbbells: 'Manubri (kg)',
    plates: 'Tagli dei dischi (kg, per lato)',
    bars: 'Pesi dei bilancieri (kg)',
    exerciseAvailability: 'Esercizi e macchine',
    exerciseAvailabilityDescription:
      'Segna l’attrezzatura mancante. Per macchine e cavi, puoi inserire ogni peso selezionabile del pacco pesi.',
    searchExercises: 'Cerca esercizi',
    available: 'Disponibile',
    machineWeights: 'Pesi selezionabili (kg)',
    makeActive: 'Usa questa palestra',
    saved: 'Palestra salvata.',
    saveError: 'Impossibile salvare la palestra.',
    activated: 'Palestra attiva cambiata.',
    activateError: 'Impossibile cambiare la palestra attiva.',
    deleted: 'Palestra eliminata.',
    deleteError: 'Impossibile eliminare la palestra.',
    deleteTitle: 'Eliminare questa palestra?',
    deleteDescription:
      '{name} verrà rimossa. Le sessioni esistenti conservano il loro storico di allenamento.',
  },
  profile: {
    title: 'Profilo',
    description:
      'Il tuo profilo personalizza il coach con IA. Il peso corporeo serve anche a calcolare il tonnellaggio effettivo degli esercizi a corpo libero; cambiarlo ricalcola lo storico.',
    displayName: 'Nome visualizzato',
    namePlaceholder: 'Il tuo nome',
    bodyweight: 'Peso corporeo',
    bodyweightLabel: 'Peso corporeo (kg)',
    bodyweightRange: 'Tra 20 e 300 kg.',
    sex: 'Sesso',
    height: 'Altezza',
    heightLabel: 'Altezza (cm)',
    heightRange: 'Tra 100 e 250 cm.',
    goal: 'Obiettivo',
    weeklyFrequency: 'Giorni di allenamento a settimana',
    weeklyFrequencyLabel: 'Sessioni / settimana',
    weeklyFrequencyRange: 'Tra 1 e 14.',
    unit: 'Unità di peso',
    unitDescription:
      'Cambia come i pesi vengono mostrati e inseriti. I tuoi dati sono sempre salvati in kg, quindi cambiare unità non modifica mai le sessioni passate.',
    effortScale: 'Scala dello sforzo',
    effortScaleDescription:
      'Cambia come lo sforzo viene mostrato e inserito. Le serie salvano sempre le ripetizioni in riserva (RPE = 10 - RIR), quindi cambiare scala non modifica mai le sessioni passate.',
    effortRir: 'RIR (ripetizioni in riserva)',
    effortRpe: 'RPE (sforzo percepito)',
    notSet: 'Non impostato',
    fixFields: 'Correggi i campi evidenziati.',
    saved: 'Profilo aggiornato.',
    saveError: 'Impossibile salvare il profilo.',
    male: 'Uomo',
    female: 'Donna',
    other: 'Altro',
    strength: 'Forza',
    hypertrophy: 'Ipertrofia',
    fatLoss: 'Perdita di grasso',
    recomp: 'Ricomposizione',
    generalFitness: 'Forma fisica generale',
    kilograms: 'Chilogrammi (kg)',
    pounds: 'Libbre (lb)',
    distanceUnit: 'Unità di distanza',
    distanceUnitDescription:
      'Cambia come distanza, passo e velocità del cardio vengono mostrati e inseriti. Le distanze sono sempre salvate in metri, quindi cambiare unità non modifica mai le sessioni passate. Automatica segue l’unità di peso: miglia con le libbre, chilometri con i chilogrammi.',
    distanceAuto: 'Automatica (segue l’unità di peso)',
    kilometers: 'Chilometri (km)',
    miles: 'Miglia (mi)',
  },
  backup: {
    title: 'Dati',
    description: 'Backup locale o ripristino da un file JSON.',
    export: 'Esporta tutti i miei dati (JSON)',
    exportDone: 'Esportazione scaricata.',
    exportError: 'Esportazione non riuscita.',
    import: 'Importa un backup',
    invalidJson: 'File JSON non valido.',
    importDone: 'Importazione completata. I dati esistenti sono stati sostituiti.',
    importError: 'Importazione non riuscita.',
    confirmTitle: 'Conferma l’importazione',
    confirmDescription:
      'Il file {file} sostituirà tutti i tuoi dati attuali (programmi, sessioni, serie, obiettivi, storico del peso corporeo, check-in, conversazioni con il coach). L’azione non può essere annullata.',
    replace: 'Sì, sostituisci',
  },
  imports: {
    title: 'Importa lo storico di allenamento',
    description: 'Importa allenamenti esportati da un’altra app di allenamento.',
    source: 'App di origine',
    strongUnit: 'Unità di peso di Strong',
    chooseFile: 'Scegli file {kind}',
    chooseFitFiles: 'Scegli file FIT',
    fileTooLarge: 'Un file è troppo grande: il limite è 5 MB per file.',
    fitLimit: 'Fino a {count} file FIT alla volta.',
    previewFailed: 'Anteprima non riuscita.',
    importFailed: 'Importazione non riuscita.',
    confirm: 'Conferma l’importazione',
    previewOf: 'Anteprima di {file}',
    cardioTitle: 'Importa un’attività {kind}',
    appTitle: 'Importa da {app}',
    cardioDescription:
      'Porta un allenamento cardio: {hint}. Controlla l’anteprima qui, poi conferma.',
    appDescription:
      'Porta il tuo storico di allenamento dall’app {app}: {hint}, controlla l’anteprima qui, poi conferma.',
    activitiesSummary:
      '{count, plural, one {# attività} other {# attività}} da importare{skipped, plural, =0 {} one { · # saltata} other { · # saltate}}',
    possibleDuplicate: 'possibile duplicato',
    fileSkipped: 'File {index} saltato: {error}',
    importSessions: 'Importa {count, plural, one {# sessione} other {# sessioni}}',
    cardioSession: '1 sessione cardio ({sport}) il {date}',
    loggedAs: 'registrata come {name}',
    duplicateWarning:
      'Possibile duplicato: hai già una sessione che inizia entro 2 minuti da questa attività.',
    strengthSummary:
      '{sessions, plural, one {# sessione} other {# sessioni}}, {sets, plural, one {# serie} other {# serie}} da importare',
    newExercises:
      '{count, plural, one {Verrà creato # nuovo esercizio} other {Verranno creati # nuovi esercizi}}: {names}',
    duplicatesSkipped:
      '{count, plural, one {Verrà saltato # duplicato esatto} other {Verranno saltati # duplicati esatti}}',
    cardioIncluded:
      '{count, plural, one {# serie cardio inclusa} other {# serie cardio incluse}} (durata/distanza)',
    cardioSkipped:
      '{count, plural, one {Verrà saltata # riga cardio} other {Verranno saltate # righe cardio}} senza una durata utilizzabile',
    nonSetRowsSkipped:
      '{count, plural, one {Verrà saltata # riga di timer di recupero o di nota (non è una serie)} other {Verranno saltate # righe di timer di recupero o di nota (non sono serie)}}',
    existingDates: 'Hai già sessioni in queste date: {dates}',
    unreadable:
      '{count, plural, one {# riga non è leggibile e verrà saltata:} other {# righe non sono leggibili e verranno saltate:}}',
    lineError: 'Riga {line}: {reason}',
    moreErrors: '... e altri {count}',
    importDone:
      'Importazione completata: {sessions, plural, one {# sessione} other {# sessioni}}, {sets, plural, one {# serie} other {# serie}}{exercises, plural, =0 {} one {, # nuovo esercizio} other {, # nuovi esercizi}}.',
    fitImportDone:
      'Importazione completata: {sessions, plural, one {# sessione} other {# sessioni}}{exercises, plural, =0 {} one {, # nuovo esercizio} other {, # nuovi esercizi}}{skipped, plural, =0 {.} one { (# file saltato).} other { (# file saltati).}}',
    file: 'File {format}',
    exportHints: {
      strong: 'esporta in CSV (Settings, poi Export data)',
      hevy: 'esporta in CSV (Settings, poi Export & Import Data)',
      gymcoach:
        'usa il CSV esportato dalla cronologia o una tabella con le stesse colonne (session_date, workout, exercise, set_number, external_load_kg, reps, ...)',
      tcx: 'esporta l’attività in TCX dalla piattaforma del tuo orologio (Garmin Connect, Polar Flow, ...) per importare una sessione cardio con durata, distanza e frequenza cardiaca',
      gpx: 'esporta il percorso in GPX da Strava, Komoot o Apple Fitness per importare una sessione cardio con durata, distanza e frequenza cardiaca',
      fit: 'esporta l’attività in FIT dal tuo orologio Garmin o altro per importare una sessione cardio con durata, distanza e frequenza cardiaca',
      appleHealth:
        'nell’app Salute tocca la tua foto del profilo, poi Esporta tutti i dati sanitari, e scegli il file export.zip creato (o il file export.xml al suo interno)',
      strava:
        'su strava.com apri Impostazioni, Il mio account, poi Inizia sotto Scarica o elimina il tuo account, richiedi il tuo archivio e scegli lo zip che Strava ti invia per e-mail',
    },
    appleHealth: {
      description:
        'Porta qui i tuoi allenamenti cardio da Apple Salute: {hint}. Controlla l’anteprima, poi conferma.',
      chooseFile: 'Scegli export.zip',
      privacy:
        'L’esportazione viene letta su questo dispositivo, qualunque sia la sua dimensione: al tuo server GymCoach vengono inviati solo i riepiloghi degli allenamenti (tipo, data, durata, distanza, frequenza cardiaca). Gli allenamenti di forza vengono saltati e quelli già presenti nel tuo storico non vengono importati due volte.',
      reading: 'Lettura dell’esportazione: {read} di {total} MB',
      sending: 'Invio del blocco {done} di {total}',
      waiting: 'Limite di importazione raggiunto, si riprende tra {seconds} s',
      nothingFound: 'Nessun allenamento né misurazione del peso corporeo in questo file.',
      noExportXml:
        'Questo archivio non contiene export.xml. Scegli il file export.zip creato dall’app Salute.',
      unreadable: 'Impossibile leggere questo file.',
      workouts:
        '{count, plural, one {# allenamento cardio} other {# allenamenti cardio}} da importare',
      byType: '{name}: {count}',
      duplicates:
        '{count, plural, one {# allenamento già presente nel tuo storico verrà saltato} other {# allenamenti già presenti nel tuo storico verranno saltati}}',
      strengthSkipped:
        '{count, plural, one {# allenamento di forza verrà saltato} other {# allenamenti di forza verranno saltati}}',
      invalidSkipped:
        '{count, plural, one {# allenamento senza data o durata utilizzabile verrà saltato} other {# allenamenti senza data o durata utilizzabile verranno saltati}}',
      conflicts:
        '{count, plural, one {# allenamento non può essere importato} other {# allenamenti non possono essere importati}}: uno dei tuoi esercizi non cardio ha già quel nome',
      bodyMass:
        'Importa anche {count, plural, one {# misurazione del peso corporeo} other {# misurazioni del peso corporeo}}',
      bodyMassDuplicates:
        '{count, plural, one {# misurazione del peso corporeo in un giorno già registrato verrà saltata} other {# misurazioni del peso corporeo in giorni già registrati verranno saltate}}',
      done:
        '{sessions, plural, one {# allenamento importato} other {# allenamenti importati}}{weights, plural, =0 {} one {, # misurazione del peso corporeo} other {, # misurazioni del peso corporeo}}{skipped, plural, =0 {.} one { (# saltato).} other { (# saltati).}}',
    },
    strava: {
      description:
        'Porta qui le tue attività di Strava: {hint}. Controlla l’anteprima, poi conferma.',
      chooseFile: 'Scegli l’archivio Strava',
      privacy:
        'L’archivio viene decompresso su questo dispositivo: al tuo server GymCoach vengono inviati solo i file delle attività (FIT, GPX, TCX); le foto e tutto il resto non vengono mai letti. Le importazioni sono limitate a 10 richieste al minuto, quindi una cronologia lunga richiede un po’ di tempo: tieni aperta questa scheda. Le attività già presenti nella tua cronologia non vengono importate due volte.',
      checking:
        'Controllo dell’archivio: {read} di {total} MB, {count, plural, one {# attività controllata} other {# attività controllate}}',
      importing:
        'Importazione: {read} di {total} MB, {count, plural, one {# attività inviata} other {# attività inviate}}',
      waiting: 'Limite di importazione raggiunto, si riprende tra {seconds} s',
      cancelled: 'Importazione annullata. Non è stato importato nulla.',
      cancelledAfterStart:
        'Importazione annullata. Le attività già importate restano nella tua cronologia.',
      notZip:
        'Questo file non è un archivio zip. Scegli lo zip che Strava ti ha inviato per e-mail.',
      notStrava:
        'Questo archivio non contiene activities.csv né la cartella activities. Scegli lo zip che Strava ti ha inviato per e-mail.',
      unreadable: 'Impossibile leggere questo archivio.',
      activities: '{count, plural, one {# attività} other {# attività}} da importare',
      byType: '{name}: {count}',
      duplicates:
        '{count, plural, one {# attività già presente nella tua cronologia verrà saltata} other {# attività già presenti nella tua cronologia verranno saltate}}',
      withoutFile:
        '{count, plural, one {# attività senza file (inserita a mano su Strava) verrà saltata} other {# attività senza file (inserite a mano su Strava) verranno saltate}}',
      unsupported:
        '{count, plural, one {# file in un formato che GymCoach non legge verrà saltato} other {# file in un formato che GymCoach non legge verranno saltati}}',
      tooLarge:
        '{count, plural, one {# file oltre i 5 MB verrà saltato} other {# file oltre i 5 MB verranno saltati}}',
      unreadableFiles:
        '{count, plural, one {# file illeggibile verrà saltato} other {# file illeggibili verranno saltati}}',
      skippedFiles: 'File che verranno saltati',
      done:
        '{sessions, plural, one {# attività importata} other {# attività importate}}{skipped, plural, =0 {.} one { (# saltata).} other { (# saltate).}}',
    },
  },
  mcp: {
    title: 'ChatGPT e MCP',
    description:
      'Collega un agente IA esterno ai tuoi dati di GymCoach. I token possono essere revocati in qualsiasi momento.',
    keyName: 'Nome della connessione',
    create: 'Crea connessione',
    created: 'Connessione MCP creata.',
    createError: 'Impossibile creare la connessione MCP.',
    writeAccess: 'Consenti modifiche ai dati salvati',
    writeAccessDescription:
      'ChatGPT può creare e modificare programmi, aggiornare l’inventario della tua palestra (pesi liberi, attrezzatura e relative foto) e aggiornare i dati dello storico di allenamento, come l’attrezzatura registrata nelle serie passate, dopo averti mostrato l’azione da confermare.',
    readyTitle: 'L’URL del connettore ChatGPT è pronto',
    readyDescription:
      'Copialo ora. La parte segreta viene mostrata una sola volta. In ChatGPT scegli «Nessuna autenticazione», perché l’URL contiene già un token privato.',
    copied: 'URL del connettore copiato.',
    copy: 'Copia l’URL del connettore',
    activeKeys: 'Connessioni attive',
    noKeys: 'Ancora nessuna connessione MCP.',
    readWrite: 'Lettura e scrittura',
    readOnly: 'Sola lettura',
    lastUsed: 'usata il {date}',
    revoke: 'Revoca connessione',
    revoked: 'Connessione MCP revocata.',
    revokeError: 'Impossibile revocare la connessione MCP.',
  },
} satisfies MessageShape<typeof english>;
