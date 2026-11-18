import { settings as english } from '../en/settings';
import type { MessageShape } from '@/i18n/message-types';

export const settings = {
  title: 'Réglages',
  account: 'Compte',
  appearance: 'Apparence',
  session: 'Séance',
  deviceOnly: 'Ces préférences sont enregistrées uniquement sur cet appareil.',
  vibration: 'Vibration',
  vibrationDescription: 'À l’enregistrement d’une série et en fin de minuteur.',
  timerSound: 'Bip de fin de minuteur',
  timerSoundDescription: 'Joue un bref bip à 880 Hz à la fin du repos.',
  restFlash: 'Faire clignoter l’écran à la fin du repos',
  restFlashDescription:
    'Fait clignoter l’écran à la fin du repos, pour une salle bruyante. Avec les animations réduites, l’écran change de couleur sans clignoter.',
  readiness: 'Laisser la forme/les courbatures ajuster mes charges suggérées',
  readinessDescription:
    'Activé, un bilan de forme récent peut maintenir ou baisser la charge suggérée. Désactivé, les suggestions suivent la progression programmée pure.',
  plateCalculator: 'Calculateur de disques',
  plateCalculatorDescription:
    'Poids de la barre et disques disponibles par côté, utilisés par le calculateur en séance quand aucune salle enregistrée n’est active. Réglez les valeurs dans l’unité où vous vous entraînez.',
  equipment: 'Matériel ({unit})',
  barWeight: 'Poids de la barre ({unit})',
  platesPerSide: 'Disques par côté ({unit})',
  platesPlaceholder: 'ex. 25, 20, 15, 10, 5, 2,5, 1,25',
  platesHint: 'Séparez les disques par une virgule suivie d’un espace.',
  gyms: {
    title: 'Salles et matériel',
    description:
      'Enregistrez plusieurs salles. Les suggestions de charge utilisent l’inventaire figé sur la séance.',
    savedGyms: 'Salles enregistrées',
    newGym: 'Ajouter une salle',
    active: 'active',
    name: 'Nom de la salle',
    namePlaceholder: 'ex. Salle du sous-sol',
    dumbbells: 'Haltères (kg)',
    plates: 'Disques disponibles (kg, par côté)',
    bars: 'Poids des barres (kg)',
    exerciseAvailability: 'Exercices et machines',
    exerciseAvailabilityDescription:
      'Signalez le matériel manquant. Pour les machines et poulies, saisissez si vous voulez chaque charge sélectionnable.',
    searchExercises: 'Rechercher un exercice',
    available: 'Disponible',
    machineWeights: 'Charges sélectionnables (kg)',
    makeActive: 'Utiliser cette salle',
    saved: 'Salle enregistrée.',
    saveError: 'Impossible d’enregistrer la salle.',
    activated: 'Salle active changée.',
    activateError: 'Impossible de changer la salle active.',
    deleted: 'Salle supprimée.',
    deleteError: 'Impossible de supprimer la salle.',
    deleteTitle: 'Supprimer cette salle ?',
    deleteDescription: '{name} sera supprimée. Les séances existantes conservent leur historique.',
  },
  profile: {
    title: 'Profil',
    description:
      'Votre profil personnalise le coach IA. Le poids corporel sert aussi à calculer le tonnage effectif des exercices au poids de corps ; le modifier recalcule l’historique.',
    displayName: 'Nom affiché',
    namePlaceholder: 'Votre nom',
    bodyweight: 'Poids corporel',
    bodyweightLabel: 'Poids corporel (kg)',
    bodyweightRange: 'Entre 20 et 300 kg.',
    sex: 'Sexe',
    height: 'Taille',
    heightLabel: 'Taille (cm)',
    heightRange: 'Entre 100 et 250 cm.',
    goal: 'Objectif',
    weeklyFrequency: 'Jours d’entraînement par semaine',
    weeklyFrequencyLabel: 'Séances / semaine',
    weeklyFrequencyRange: 'Entre 1 et 14.',
    unit: 'Unité de poids',
    unitDescription:
      'Change l’affichage et la saisie des charges. Vos données sont toujours stockées en kg, donc changer d’unité ne modifie jamais les séances passées.',
    effortScale: 'Échelle d’effort',
    effortScaleDescription:
      'Change l’affichage et la saisie de l’effort. Les séries enregistrent toujours les répétitions en réserve (RPE = 10 - RIR), donc changer d’échelle ne modifie jamais les séances passées.',
    effortRir: 'RIR (répétitions en réserve)',
    effortRpe: 'RPE (effort perçu)',
    notSet: 'Non renseigné',
    fixFields: 'Corrigez les champs signalés.',
    saved: 'Profil mis à jour.',
    saveError: 'Impossible d’enregistrer le profil.',
    male: 'Homme',
    female: 'Femme',
    other: 'Autre',
    strength: 'Force',
    hypertrophy: 'Hypertrophie',
    fatLoss: 'Perte de gras',
    recomp: 'Recomposition',
    generalFitness: 'Forme générale',
    kilograms: 'Kilogrammes (kg)',
    pounds: 'Livres (lb)',
    distanceUnit: 'Unité de distance',
    distanceUnitDescription:
      'Change l’affichage et la saisie de la distance, de l’allure et de la vitesse en cardio. Les distances sont toujours stockées en mètres, donc changer d’unité ne modifie jamais les séances passées. Automatique suit l’unité de poids : miles avec les livres, kilomètres avec les kilogrammes.',
    distanceAuto: 'Automatique (suit l’unité de poids)',
    kilometers: 'Kilomètres (km)',
    miles: 'Miles (mi)',
  },
  backup: {
    title: 'Données',
    description: 'Sauvegarde locale ou restauration depuis un fichier JSON.',
    export: 'Exporter toutes mes données (JSON)',
    exportDone: 'Export téléchargé.',
    exportError: 'L’export a échoué.',
    import: 'Importer une sauvegarde',
    invalidJson: 'Fichier JSON invalide.',
    importDone: 'Import terminé. Les données existantes ont été remplacées.',
    importError: 'L’import a échoué.',
    confirmTitle: 'Confirmer l’import',
    confirmDescription:
      'Le fichier {file} remplacera toutes vos données actuelles (programmes, séances, séries, objectifs, historique de poids, bilans, conversations avec le coach). Cette action est irréversible.',
    replace: 'Oui, remplacer',
  },
  imports: {
    title: 'Importer un historique d’entraînement',
    description: 'Importez des séances exportées depuis une autre application.',
    source: 'Application source',
    strongUnit: 'Unité de poids Strong',
    chooseFile: 'Choisir le fichier {kind}',
    chooseFitFiles: 'Choisir des fichiers FIT',
    fileTooLarge: 'Un fichier est trop volumineux : la limite est de 5 Mo chacun.',
    fitLimit: 'Jusqu’à {count} fichiers FIT à la fois.',
    previewFailed: 'L’aperçu a échoué.',
    importFailed: 'L’import a échoué.',
    confirm: 'Confirmer l’import',
    previewOf: 'Aperçu de {file}',
    cardioTitle: 'Importer une activité {kind}',
    appTitle: 'Importer depuis {app}',
    cardioDescription: 'Récupérez une séance cardio : {hint}. Prévisualisez ici, puis confirmez.',
    appDescription:
      'Récupérez votre historique depuis l’application {app} : {hint}, prévisualisez ici, puis confirmez.',
    activitiesSummary:
      '{count, plural, one {# activité} other {# activités}} à importer{skipped, plural, =0 {} other { · # ignorée(s)}}',
    possibleDuplicate: 'doublon possible',
    fileSkipped: 'Fichier {index} ignoré : {error}',
    importSessions: 'Importer {count, plural, one {# séance} other {# séances}}',
    cardioSession: '1 séance cardio ({sport}) le {date}',
    loggedAs: 'enregistrée comme {name}',
    duplicateWarning:
      'Doublon possible : vous avez déjà une séance commençant à moins de 2 minutes de cette activité.',
    strengthSummary:
      '{sessions, plural, one {# séance} other {# séances}}, {sets, plural, one {# série} other {# séries}} à importer',
    newExercises:
      '{count, plural, one {# nouvel exercice sera créé} other {# nouveaux exercices seront créés}} : {names}',
    duplicatesSkipped:
      '{count, plural, one {# doublon exact sera ignoré} other {# doublons exacts seront ignorés}}',
    cardioIncluded:
      '{count, plural, one {# série cardio incluse} other {# séries cardio incluses}} (durée/distance)',
    cardioSkipped:
      '{count, plural, one {# ligne cardio sans durée exploitable sera ignorée} other {# lignes cardio sans durée exploitable seront ignorées}}',
    nonSetRowsSkipped:
      '{count, plural, one {# ligne de minuteur de repos ou de note (pas une série) sera ignorée} other {# lignes de minuteur de repos ou de note (pas des séries) seront ignorées}}',
    existingDates: 'Vous avez déjà des séances les : {dates}',
    unreadable:
      '{count, plural, one {# ligne n’a pas pu être lue et sera ignorée} other {# lignes n’ont pas pu être lues et seront ignorées}} :',
    lineError: 'Ligne {line} : {reason}',
    moreErrors: '... et {count} de plus',
    importDone:
      '{sessions, plural, one {# séance importée} other {# séances importées}}, {sets, plural, one {# série} other {# séries}}{exercises, plural, =0 {} one {, # nouvel exercice} other {, # nouveaux exercices}}.',
    fitImportDone:
      '{sessions, plural, one {# séance importée} other {# séances importées}}{exercises, plural, =0 {} one {, # nouvel exercice} other {, # nouveaux exercices}}{skipped, plural, =0 {.} one { (# fichier ignoré).} other { (# fichiers ignorés).}}',
    file: 'Fichier {format}',
    exportHints: {
      strong: 'exportez en CSV (Settings, puis Export data)',
      hevy: 'exportez en CSV (Settings, puis Export & Import Data)',
      gymcoach:
        'utilisez le CSV exporté depuis l’historique ou un tableau avec les mêmes colonnes (session_date, workout, exercise, set_number, external_load_kg, reps, ...)',
      tcx: 'exportez l’activité en TCX depuis votre plateforme de montre (Garmin Connect, Polar Flow, ...) pour importer une séance cardio avec durée, distance et fréquence cardiaque',
      gpx: 'exportez le parcours en GPX depuis Strava, Komoot ou Apple Fitness pour importer une séance cardio avec durée, distance et fréquence cardiaque',
      fit: 'exportez l’activité en FIT depuis votre montre Garmin ou autre pour importer une séance cardio avec durée, distance et fréquence cardiaque',
      appleHealth:
        'dans l’app Santé, touchez votre photo de profil, puis Exporter toutes les données de santé, et choisissez le fichier export.zip obtenu (ou le fichier export.xml qu’il contient)',
      strava:
        'sur strava.com, ouvrez Paramètres, Mon compte, puis Démarrer sous Télécharger ou supprimer votre compte, demandez votre archive et choisissez le zip que Strava vous envoie par e-mail',
    },
    appleHealth: {
      description:
        'Importez vos séances cardio depuis Apple Santé : {hint}. Vérifiez l’aperçu ici, puis confirmez.',
      chooseFile: 'Choisir export.zip',
      privacy:
        'L’export est lu sur cet appareil, quelle que soit sa taille : seuls les résumés des séances (type, date, durée, distance, fréquence cardiaque) sont envoyés à votre serveur GymCoach. Les séances de musculation sont ignorées, et les séances déjà présentes dans votre historique ne sont pas importées deux fois.',
      reading: 'Lecture de l’export : {read} sur {total} Mo',
      sending: 'Envoi du lot {done} sur {total}',
      waiting: 'Limite d’import atteinte, reprise dans {seconds} s',
      nothingFound: 'Aucune séance ni mesure de poids dans ce fichier.',
      noExportXml:
        'Cette archive ne contient pas de fichier export.xml. Choisissez le fichier export.zip créé par l’app Santé.',
      unreadable: 'Ce fichier n’a pas pu être lu.',
      tooLarge:
        'Cet export est trop volumineux pour être lu ici : ses données dépassent {limit} Go une fois décompressées.',
      workouts:
        '{count, plural, one {# séance cardio} other {# séances cardio}} à importer',
      byType: '{name} : {count}',
      duplicates:
        '{count, plural, one {# séance déjà présente dans votre historique sera ignorée} other {# séances déjà présentes dans votre historique seront ignorées}}',
      strengthSkipped:
        '{count, plural, one {# séance de musculation sera ignorée} other {# séances de musculation seront ignorées}}',
      invalidSkipped:
        '{count, plural, one {# séance sans date ou durée exploitable sera ignorée} other {# séances sans date ou durée exploitable seront ignorées}}',
      conflicts:
        '{count, plural, one {# séance ne peut pas être importée} other {# séances ne peuvent pas être importées}} : l’un de vos exercices hors cardio porte déjà ce nom',
      bodyMass:
        'Importer aussi {count, plural, one {# mesure de poids} other {# mesures de poids}}',
      bodyMassDuplicates:
        '{count, plural, one {# mesure de poids sera ignorée (jour déjà renseigné)} other {# mesures de poids seront ignorées (jours déjà renseignés)}}',
      done:
        '{sessions, plural, one {# séance importée} other {# séances importées}}{weights, plural, =0 {} one {, # mesure de poids} other {, # mesures de poids}}{skipped, plural, =0 {.} one { (# ignorée).} other { (# ignorées).}}',
    },
    strava: {
      description:
        'Récupérez vos activités Strava : {hint}. Vérifiez l’aperçu ici, puis confirmez.',
      chooseFile: 'Choisir l’archive Strava',
      privacy:
        'L’archive est décompressée sur cet appareil : seuls ses fichiers d’activité (FIT, GPX, TCX) sont envoyés à votre serveur GymCoach ; les photos et tout le reste ne sont jamais lus. Les imports sont limités à 10 requêtes par minute, un long historique prend donc un moment : gardez cet onglet ouvert. Les activités déjà présentes dans votre historique ne sont pas importées deux fois.',
      checking:
        'Vérification de l’archive : {read} sur {total} Mo, {count, plural, one {# activité vérifiée} other {# activités vérifiées}}',
      importing:
        'Import en cours : {read} sur {total} Mo, {count, plural, one {# activité envoyée} other {# activités envoyées}}',
      waiting: 'Limite d’import atteinte, reprise dans {seconds} s',
      cancelled: 'Import annulé. Rien n’a été importé.',
      cancelledAfterStart:
        'Import annulé. Les activités déjà importées restent dans votre historique.',
      notZip:
        'Ce fichier n’est pas une archive zip. Choisissez le zip que Strava vous a envoyé par e-mail.',
      notStrava:
        'Cette archive ne contient ni activities.csv ni dossier activities. Choisissez le zip que Strava vous a envoyé par e-mail.',
      unreadable: 'Impossible de lire cette archive.',
      activities: '{count, plural, one {# activité à importer} other {# activités à importer}}',
      byType: '{name} : {count}',
      duplicates:
        '{count, plural, one {# activité déjà présente dans votre historique sera ignorée} other {# activités déjà présentes dans votre historique seront ignorées}}',
      withoutFile:
        '{count, plural, one {# activité sans fichier (saisie à la main sur Strava) sera ignorée} other {# activités sans fichier (saisies à la main sur Strava) seront ignorées}}',
      unsupported:
        '{count, plural, one {# fichier dans un format que GymCoach ne lit pas sera ignoré} other {# fichiers dans un format que GymCoach ne lit pas seront ignorés}}',
      tooLarge:
        '{count, plural, one {# fichier de plus de 5 Mo sera ignoré} other {# fichiers de plus de 5 Mo seront ignorés}}',
      unreadableFiles:
        '{count, plural, one {# fichier illisible sera ignoré} other {# fichiers illisibles seront ignorés}}',
      skippedFiles: 'Fichiers qui seront ignorés',
      done:
        '{sessions, plural, one {# activité importée} other {# activités importées}}{skipped, plural, =0 {.} one { (# ignorée).} other { (# ignorées).}}',
    },
  },
  mcp: {
    title: 'ChatGPT et MCP',
    description:
      'Connectez un agent IA externe à vos données GymCoach. Les jetons peuvent être révoqués à tout moment.',
    keyName: 'Nom de la connexion',
    create: 'Créer la connexion',
    created: 'Connexion MCP créée.',
    createError: 'Impossible de créer la connexion MCP.',
    writeAccess: 'Autoriser les modifications des données enregistrées',
    writeAccessDescription:
      'ChatGPT pourra créer et modifier des programmes, mettre à jour l’inventaire de votre salle (poids libres, équipements et leurs photos) et des données de l’historique d’entraînement, comme l’équipement enregistré sur des séries passées, après avoir montré l’action pour confirmation.',
    readyTitle: 'L’URL du connecteur ChatGPT est prête',
    readyDescription:
      'Copiez-la maintenant. La partie secrète n’est affichée qu’une seule fois. Dans ChatGPT, choisissez « sans authentification » car l’URL contient déjà un jeton privé.',
    copied: 'URL du connecteur copiée.',
    copy: 'Copier l’URL du connecteur',
    activeKeys: 'Connexions actives',
    noKeys: 'Aucune connexion MCP pour l’instant.',
    readWrite: 'Lecture et écriture',
    readOnly: 'Lecture seule',
    lastUsed: 'utilisée le {date}',
    revoke: 'Révoquer la connexion',
    revoked: 'Connexion MCP révoquée.',
    revokeError: 'Impossible de révoquer la connexion MCP.',
  },
} satisfies MessageShape<typeof english>;
