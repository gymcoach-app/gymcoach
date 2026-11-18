export const settings = {
  title: 'Settings',
  account: 'Account',
  appearance: 'Appearance',
  session: 'Session',
  deviceOnly: 'These preferences are saved on this device only.',
  vibration: 'Vibration',
  vibrationDescription: 'Set logging and end of timer.',
  timerSound: 'End of timer beep',
  timerSoundDescription: 'Plays a short 880 Hz beep at the end of the rest.',
  restFlash: 'Flash the screen when rest is over',
  restFlashDescription:
    'Blinks the screen at the end of the rest, for a loud gym. With reduced motion on, the screen changes colour without blinking.',
  readiness: 'Let readiness/soreness adjust my suggested weights',
  readinessDescription:
    'When on, a recent readiness check-in can hold or lower the suggested load. When off, suggestions follow pure programmed progression.',
  plateCalculator: 'Plate calculator',
  plateCalculatorDescription:
    'Bar weight and available plates per side, used by the in-workout plate calculator when no saved gym is active. Set the values for the unit you train in.',
  equipment: 'Equipment ({unit})',
  barWeight: 'Bar weight ({unit})',
  platesPerSide: 'Plates per side ({unit})',
  platesPlaceholder: 'e.g. 25, 20, 15, 10, 5, 2.5, 1.25',
  platesHint: 'Separate plates with a comma and a space.',
  gyms: {
    title: 'Gyms and equipment',
    description:
      'Save several gyms. Load suggestions use the inventory frozen on the workout session.',
    savedGyms: 'Saved gyms',
    newGym: 'Add gym',
    active: 'active',
    name: 'Gym name',
    namePlaceholder: 'e.g. Basement gym',
    dumbbells: 'Dumbbells (kg)',
    plates: 'Plate denominations (kg, per side)',
    bars: 'Bar weights (kg)',
    exerciseAvailability: 'Exercises and machines',
    exerciseAvailabilityDescription:
      'Mark missing equipment. For machines and cables, optionally enter every selectable stack weight.',
    searchExercises: 'Search exercises',
    available: 'Available',
    machineWeights: 'Selectable weights (kg)',
    makeActive: 'Use this gym',
    saved: 'Gym saved.',
    saveError: 'Could not save the gym.',
    activated: 'Active gym changed.',
    activateError: 'Could not change the active gym.',
    deleted: 'Gym deleted.',
    deleteError: 'Could not delete the gym.',
    deleteTitle: 'Delete this gym?',
    deleteDescription: '{name} will be removed. Existing sessions keep their training history.',
  },
  profile: {
    title: 'Profile',
    description:
      'Your profile tailors the AI coach. Bodyweight is also used to compute effective tonnage for bodyweight exercises; changing it recalculates past history.',
    displayName: 'Display name',
    namePlaceholder: 'Your name',
    bodyweight: 'Bodyweight',
    bodyweightLabel: 'Bodyweight (kg)',
    bodyweightRange: 'Between 20 and 300 kg.',
    sex: 'Sex',
    height: 'Height',
    heightLabel: 'Height (cm)',
    heightRange: 'Between 100 and 250 cm.',
    goal: 'Goal',
    weeklyFrequency: 'Training days per week',
    weeklyFrequencyLabel: 'Sessions / week',
    weeklyFrequencyRange: 'Between 1 and 14.',
    unit: 'Weight unit',
    unitDescription:
      'Changes how weights are shown and entered. Your data is always stored in kg, so switching never alters past sessions.',
    effortScale: 'Effort scale',
    effortScaleDescription:
      'Changes how effort is shown and entered. Sets always store reps in reserve (RPE = 10 - RIR), so switching never alters past sessions.',
    effortRir: 'RIR (reps in reserve)',
    effortRpe: 'RPE (perceived exertion)',
    notSet: 'Not set',
    fixFields: 'Please fix the highlighted fields.',
    saved: 'Profile updated.',
    saveError: 'Could not save profile.',
    male: 'Male',
    female: 'Female',
    other: 'Other',
    strength: 'Strength',
    hypertrophy: 'Hypertrophy',
    fatLoss: 'Fat loss',
    recomp: 'Recomposition',
    generalFitness: 'General fitness',
    kilograms: 'Kilograms (kg)',
    pounds: 'Pounds (lb)',
    distanceUnit: 'Distance unit',
    distanceUnitDescription:
      'Changes how cardio distance, pace and speed are shown and entered. Distances are always stored in meters, so switching never alters past sessions. Automatic follows the weight unit: miles with pounds, kilometers with kilograms.',
    distanceAuto: 'Automatic (follows the weight unit)',
    kilometers: 'Kilometers (km)',
    miles: 'Miles (mi)',
  },
  backup: {
    title: 'Data',
    description: 'Local backup or restore from a JSON file.',
    export: 'Export all my data (JSON)',
    exportDone: 'Export downloaded.',
    exportError: 'Export failed.',
    import: 'Import a backup',
    invalidJson: 'Invalid JSON file.',
    importDone: 'Import complete. Existing data has been replaced.',
    importError: 'Import failed.',
    confirmTitle: 'Confirm the import',
    confirmDescription:
      'The file {file} will replace all your current data (programs, sessions, sets, goals, bodyweight history, check-ins, coach conversations). This action cannot be undone.',
    replace: 'Yes, replace',
  },
  imports: {
    title: 'Import training history',
    description: 'Import workouts exported from another training app.',
    source: 'Source app',
    strongUnit: 'Strong weight unit',
    chooseFile: 'Choose {kind} file',
    chooseFitFiles: 'Choose FIT files',
    fileTooLarge: 'A file is too large: the limit is 5 MB each.',
    fitLimit: 'Up to {count} FIT files at once.',
    previewFailed: 'Preview failed.',
    importFailed: 'Import failed.',
    confirm: 'Confirm import',
    previewOf: 'Preview of {file}',
    cardioTitle: 'Import a {kind} activity',
    appTitle: 'Import from {app}',
    cardioDescription: 'Bring a cardio workout: {hint}. Preview it here, then confirm.',
    appDescription:
      'Bring your training history from the {app} app: {hint}, preview it here, then confirm.',
    activitiesSummary:
      '{count, plural, one {# activity} other {# activities}} to import{skipped, plural, =0 {} other { · # skipped}}',
    possibleDuplicate: 'possible duplicate',
    fileSkipped: 'File {index} skipped: {error}',
    importSessions: 'Import {count, plural, one {# session} other {# sessions}}',
    cardioSession: '1 cardio session ({sport}) on {date}',
    loggedAs: 'logged as {name}',
    duplicateWarning:
      'Possible duplicate: you already have a session starting within 2 minutes of this activity.',
    strengthSummary:
      '{sessions, plural, one {# session} other {# sessions}}, {sets, plural, one {# set} other {# sets}} to import',
    newExercises:
      '{count, plural, one {# new exercise} other {# new exercises}} will be created: {names}',
    duplicatesSkipped:
      '{count, plural, one {# exact duplicate} other {# exact duplicates}} will be skipped',
    cardioIncluded:
      '{count, plural, one {# cardio set} other {# cardio sets}} (duration/distance) included',
    cardioSkipped:
      '{count, plural, one {# cardio row} other {# cardio rows}} without a usable duration will be skipped',
    nonSetRowsSkipped:
      '{count, plural, one {# rest timer or note row (not a set)} other {# rest timer or note rows (not sets)}} will be skipped',
    existingDates: 'You already have sessions on: {dates}',
    unreadable:
      '{count, plural, one {# line could} other {# lines could}} not be read and will be skipped:',
    lineError: 'Line {line}: {reason}',
    moreErrors: '... and {count} more',
    importDone:
      'Imported {sessions, plural, one {# session} other {# sessions}}, {sets, plural, one {# set} other {# sets}}{exercises, plural, =0 {} one {, # new exercise} other {, # new exercises}}.',
    fitImportDone:
      'Imported {sessions, plural, one {# session} other {# sessions}}{exercises, plural, =0 {} one {, # new exercise} other {, # new exercises}}{skipped, plural, =0 {.} one { (# file skipped).} other { (# files skipped).}}',
    file: '{format} file',
    exportHints: {
      strong: 'export it as CSV (Settings, then Export data)',
      hevy: 'export it as CSV (Settings, then Export & Import Data)',
      gymcoach:
        'use the CSV from the History page export, or any spreadsheet with the same columns (session_date, workout, exercise, set_number, external_load_kg, reps, ...)',
      tcx: 'export the activity as TCX from your watch platform (Garmin Connect, Polar Flow, ...) and it becomes one cardio session with duration, distance and heart rate',
      gpx: 'export the route as GPX from Strava, Komoot or Apple Fitness and it becomes one cardio session with duration, distance and heart rate',
      fit: 'export the activity as a FIT file from your Garmin (or other) watch and it becomes one cardio session with duration, distance and heart rate',
      appleHealth:
        'in the Health app, tap your profile picture, then Export All Health Data, and pick the export.zip it creates (or the export.xml inside)',
      strava:
        'on strava.com open Settings, My Account, then Get Started under Download or Delete Your Account, request your archive, and pick the zip Strava emails you',
    },
    appleHealth: {
      description:
        'Bring your cardio workouts from Apple Health: {hint}. Preview here, then confirm.',
      chooseFile: 'Choose export.zip',
      privacy:
        'The export is read on this device, however large it is: only workout summaries (type, date, duration, distance, heart rate) are sent to your GymCoach server. Strength workouts are skipped, and workouts already in your history are not imported twice.',
      reading: 'Reading the export: {read} of {total} MB',
      sending: 'Sending batch {done} of {total}',
      waiting: 'Import limit reached, continuing in {seconds} s',
      nothingFound: 'No workout or bodyweight entry found in this file.',
      noExportXml:
        'This archive has no export.xml. Pick the export.zip made by the Health app.',
      unreadable: 'This file could not be read.',
      tooLarge:
        'This export is too large to read here: its data is over {limit} GB once unzipped.',
      workouts:
        '{count, plural, one {# cardio workout} other {# cardio workouts}} to import',
      byType: '{name}: {count}',
      duplicates:
        '{count, plural, one {# workout} other {# workouts}} already in your history will be skipped',
      strengthSkipped:
        '{count, plural, one {# strength workout} other {# strength workouts}} will be skipped',
      invalidSkipped:
        '{count, plural, one {# workout} other {# workouts}} without a usable date or duration will be skipped',
      conflicts:
        '{count, plural, one {# workout} other {# workouts}} cannot be imported: one of your non-cardio exercises already has that name',
      bodyMass:
        'Also import {count, plural, one {# bodyweight entry} other {# bodyweight entries}}',
      bodyMassDuplicates:
        '{count, plural, one {# bodyweight entry} other {# bodyweight entries}} on days you already logged will be skipped',
      done:
        'Imported {sessions, plural, one {# workout} other {# workouts}}{weights, plural, =0 {} one {, # bodyweight entry} other {, # bodyweight entries}}{skipped, plural, =0 {.} other { (# skipped).}}',
    },
    strava: {
      description: 'Bring your activities from Strava: {hint}. Preview here, then confirm.',
      chooseFile: 'Choose the Strava archive',
      privacy:
        'The archive is unzipped on this device: only its activity files (FIT, GPX, TCX) are sent to your GymCoach server; photos and everything else are never read. Imports are limited to 10 requests a minute, so a long history takes a while: keep this tab open. Activities already in your history are not imported twice.',
      checking:
        'Checking the archive: {read} of {total} MB, {count, plural, one {# activity} other {# activities}} checked',
      importing:
        'Importing: {read} of {total} MB, {count, plural, one {# activity} other {# activities}} sent',
      waiting: 'Import limit reached, continuing in {seconds} s',
      cancelled: 'Import cancelled. Nothing was imported.',
      cancelledAfterStart:
        'Import cancelled. The activities already imported stay in your history.',
      notZip: 'This file is not a zip archive. Pick the zip Strava emailed you.',
      notStrava:
        'This archive has no activities.csv and no activities folder. Pick the zip Strava emailed you.',
      unreadable: 'This archive could not be read.',
      activities: '{count, plural, one {# activity} other {# activities}} to import',
      byType: '{name}: {count}',
      duplicates:
        '{count, plural, one {# activity} other {# activities}} already in your history will be skipped',
      withoutFile:
        '{count, plural, one {# activity} other {# activities}} without a file (entered by hand on Strava) will be skipped',
      unsupported:
        '{count, plural, one {# file} other {# files}} in a format GymCoach does not read will be skipped',
      tooLarge: '{count, plural, one {# file} other {# files}} over 5 MB will be skipped',
      unreadableFiles:
        '{count, plural, one {# file} other {# files}} that could not be read will be skipped',
      skippedFiles: 'Files that will be skipped',
      done:
        'Imported {sessions, plural, one {# activity} other {# activities}}{skipped, plural, =0 {.} other { (# skipped).}}',
    },
  },
  mcp: {
    title: 'ChatGPT and MCP',
    description:
      'Connect an external AI agent to your GymCoach data. Tokens can be revoked at any time.',
    keyName: 'Connection name',
    create: 'Create connection',
    created: 'MCP connection created.',
    createError: 'Could not create the MCP connection.',
    writeAccess: 'Allow changes to saved data',
    writeAccessDescription:
      'ChatGPT may create and edit programs, update your gym inventory (free weights, equipment and its photos) and update workout history data, such as the equipment recorded on past sets, after showing the action for confirmation.',
    readyTitle: 'ChatGPT connector URL is ready',
    readyDescription:
      'Copy it now. The secret part is shown only once. In ChatGPT choose no authentication because the URL already contains a private token.',
    copied: 'Connector URL copied.',
    copy: 'Copy connector URL',
    activeKeys: 'Active connections',
    noKeys: 'No MCP connections yet.',
    readWrite: 'Read and write',
    readOnly: 'Read only',
    lastUsed: 'used {date}',
    revoke: 'Revoke connection',
    revoked: 'MCP connection revoked.',
    revokeError: 'Could not revoke the MCP connection.',
  },
};
