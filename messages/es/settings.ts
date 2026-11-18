import { settings as english } from '../en/settings';
import type { MessageShape } from '@/i18n/message-types';

export const settings = {
  title: 'Ajustes',
  account: 'Cuenta',
  appearance: 'Apariencia',
  session: 'Sesión',
  deviceOnly: 'Estas preferencias solo se guardan en este dispositivo.',
  vibration: 'Vibración',
  vibrationDescription: 'Al registrar una serie y al terminar el temporizador.',
  timerSound: 'Pitido al terminar el temporizador',
  timerSoundDescription: 'Emite un pitido corto de 880 Hz al final del descanso.',
  restFlash: 'Hacer parpadear la pantalla al terminar el descanso',
  restFlashDescription:
    'La pantalla parpadea al final del descanso, útil en un gimnasio ruidoso. Con la reducción de movimiento activada, la pantalla cambia de color sin parpadear.',
  readiness: 'Ajustar los pesos sugeridos según mi preparación y dolor muscular',
  readinessDescription:
    'Si está activado, un registro de preparación reciente puede mantener o bajar la carga sugerida. Si está desactivado, las sugerencias siguen solo la progresión programada.',
  plateCalculator: 'Calculadora de discos',
  plateCalculatorDescription:
    'Peso de la barra y discos disponibles por lado, usados por la calculadora de discos durante el entrenamiento cuando no hay ningún gimnasio guardado activo. Configura los valores en la unidad con la que entrenas.',
  equipment: 'Equipo ({unit})',
  barWeight: 'Peso de la barra ({unit})',
  platesPerSide: 'Discos por lado ({unit})',
  platesPlaceholder: 'p. ej. 25, 20, 15, 10, 5, 2,5, 1,25',
  platesHint: 'Separa los discos con una coma y un espacio.',
  gyms: {
    title: 'Gimnasios y equipo',
    description:
      'Guarda varios gimnasios. Las sugerencias de carga usan el inventario fijado en la sesión de entrenamiento.',
    savedGyms: 'Gimnasios guardados',
    newGym: 'Añadir gimnasio',
    active: 'activo',
    name: 'Nombre del gimnasio',
    namePlaceholder: 'p. ej. Gimnasio en casa',
    dumbbells: 'Mancuernas (kg)',
    plates: 'Discos disponibles (kg, por lado)',
    bars: 'Pesos de barra (kg)',
    exerciseAvailability: 'Ejercicios y máquinas',
    exerciseAvailabilityDescription:
      'Marca el equipo que falta. Para máquinas y poleas, puedes introducir cada peso seleccionable de la columna.',
    searchExercises: 'Buscar ejercicios',
    available: 'Disponible',
    machineWeights: 'Pesos seleccionables (kg)',
    makeActive: 'Usar este gimnasio',
    saved: 'Gimnasio guardado.',
    saveError: 'No se pudo guardar el gimnasio.',
    activated: 'Gimnasio activo cambiado.',
    activateError: 'No se pudo cambiar el gimnasio activo.',
    deleted: 'Gimnasio eliminado.',
    deleteError: 'No se pudo eliminar el gimnasio.',
    deleteTitle: '¿Eliminar este gimnasio?',
    deleteDescription:
      '{name} se eliminará. Las sesiones existentes conservan su historial de entrenamiento.',
  },
  profile: {
    title: 'Perfil',
    description:
      'Tu perfil personaliza el coach con IA. El peso corporal también se usa para calcular el tonelaje efectivo de los ejercicios con peso corporal; cambiarlo recalcula el historial.',
    displayName: 'Nombre visible',
    namePlaceholder: 'Tu nombre',
    bodyweight: 'Peso corporal',
    bodyweightLabel: 'Peso corporal (kg)',
    bodyweightRange: 'Entre 20 y 300 kg.',
    sex: 'Sexo',
    height: 'Altura',
    heightLabel: 'Altura (cm)',
    heightRange: 'Entre 100 y 250 cm.',
    goal: 'Objetivo',
    weeklyFrequency: 'Días de entrenamiento por semana',
    weeklyFrequencyLabel: 'Sesiones / semana',
    weeklyFrequencyRange: 'Entre 1 y 14.',
    unit: 'Unidad de peso',
    unitDescription:
      'Cambia cómo se muestran e introducen los pesos. Tus datos siempre se guardan en kg, así que cambiar de unidad nunca altera las sesiones pasadas.',
    effortScale: 'Escala de esfuerzo',
    effortScaleDescription:
      'Cambia cómo se muestra e introduce el esfuerzo. Las series siempre guardan las repeticiones en reserva (RPE = 10 - RIR), así que cambiar de escala nunca altera las sesiones pasadas.',
    effortRir: 'RIR (repeticiones en reserva)',
    effortRpe: 'RPE (esfuerzo percibido)',
    notSet: 'Sin definir',
    fixFields: 'Corrige los campos resaltados.',
    saved: 'Perfil actualizado.',
    saveError: 'No se pudo guardar el perfil.',
    male: 'Hombre',
    female: 'Mujer',
    other: 'Otro',
    strength: 'Fuerza',
    hypertrophy: 'Hipertrofia',
    fatLoss: 'Pérdida de grasa',
    recomp: 'Recomposición',
    generalFitness: 'Forma física general',
    kilograms: 'Kilogramos (kg)',
    pounds: 'Libras (lb)',
    distanceUnit: 'Unidad de distancia',
    distanceUnitDescription:
      'Cambia cómo se muestran e introducen la distancia, el ritmo y la velocidad del cardio. Las distancias siempre se guardan en metros, así que cambiar de unidad nunca altera las sesiones pasadas. Automática sigue la unidad de peso: millas con libras, kilómetros con kilogramos.',
    distanceAuto: 'Automática (sigue la unidad de peso)',
    kilometers: 'Kilómetros (km)',
    miles: 'Millas (mi)',
  },
  backup: {
    title: 'Datos',
    description: 'Copia de seguridad local o restauración desde un archivo JSON.',
    export: 'Exportar todos mis datos (JSON)',
    exportDone: 'Exportación descargada.',
    exportError: 'La exportación falló.',
    import: 'Importar una copia de seguridad',
    invalidJson: 'Archivo JSON no válido.',
    importDone: 'Importación completada. Los datos existentes se han reemplazado.',
    importError: 'La importación falló.',
    confirmTitle: 'Confirmar la importación',
    confirmDescription:
      'El archivo {file} reemplazará todos tus datos actuales (programas, sesiones, series, objetivos, historial de peso corporal, registros de preparación, conversaciones con el coach). Esta acción no se puede deshacer.',
    replace: 'Sí, reemplazar',
  },
  imports: {
    title: 'Importar historial de entrenamiento',
    description: 'Importa entrenamientos exportados desde otra app de entrenamiento.',
    source: 'App de origen',
    strongUnit: 'Unidad de peso de Strong',
    chooseFile: 'Elegir archivo {kind}',
    chooseFitFiles: 'Elegir archivos FIT',
    fileTooLarge: 'Un archivo es demasiado grande: el límite es de 5 MB por archivo.',
    fitLimit: 'Hasta {count} archivos FIT a la vez.',
    previewFailed: 'La vista previa falló.',
    importFailed: 'La importación falló.',
    confirm: 'Confirmar la importación',
    previewOf: 'Vista previa de {file}',
    cardioTitle: 'Importar una actividad {kind}',
    appTitle: 'Importar desde {app}',
    cardioDescription:
      'Trae un entrenamiento de cardio: {hint}. Revisa la vista previa aquí y luego confirma.',
    appDescription:
      'Trae tu historial de entrenamiento desde la app {app}: {hint}, revisa la vista previa aquí y luego confirma.',
    activitiesSummary:
      '{count, plural, one {# actividad} other {# actividades}} para importar{skipped, plural, =0 {} one { · # omitida} other { · # omitidas}}',
    possibleDuplicate: 'posible duplicado',
    fileSkipped: 'Archivo {index} omitido: {error}',
    importSessions: 'Importar {count, plural, one {# sesión} other {# sesiones}}',
    cardioSession: '1 sesión de cardio ({sport}) el {date}',
    loggedAs: 'registrada como {name}',
    duplicateWarning:
      'Posible duplicado: ya tienes una sesión que empieza a menos de 2 minutos de esta actividad.',
    strengthSummary:
      '{sessions, plural, one {# sesión} other {# sesiones}}, {sets, plural, one {# serie} other {# series}} para importar',
    newExercises:
      'Se {count, plural, one {creará # ejercicio nuevo} other {crearán # ejercicios nuevos}}: {names}',
    duplicatesSkipped:
      'Se {count, plural, one {omitirá # duplicado exacto} other {omitirán # duplicados exactos}}',
    cardioIncluded:
      '{count, plural, one {# serie de cardio incluida} other {# series de cardio incluidas}} (duración/distancia)',
    cardioSkipped:
      'Se {count, plural, one {omitirá # fila de cardio} other {omitirán # filas de cardio}} sin una duración utilizable',
    nonSetRowsSkipped:
      'Se {count, plural, one {omitirá # fila de temporizador de descanso o de nota (no es una serie)} other {omitirán # filas de temporizador de descanso o de nota (no son series)}}',
    existingDates: 'Ya tienes sesiones en estas fechas: {dates}',
    unreadable:
      '{count, plural, one {# línea no se pudo leer y se omitirá:} other {# líneas no se pudieron leer y se omitirán:}}',
    lineError: 'Línea {line}: {reason}',
    moreErrors: '... y {count} más',
    importDone:
      'Importación completada: {sessions, plural, one {# sesión} other {# sesiones}}, {sets, plural, one {# serie} other {# series}}{exercises, plural, =0 {} one {, # ejercicio nuevo} other {, # ejercicios nuevos}}.',
    fitImportDone:
      'Importación completada: {sessions, plural, one {# sesión} other {# sesiones}}{exercises, plural, =0 {} one {, # ejercicio nuevo} other {, # ejercicios nuevos}}{skipped, plural, =0 {.} one { (# archivo omitido).} other { (# archivos omitidos).}}',
    file: 'Archivo {format}',
    exportHints: {
      strong: 'exporta como CSV (Settings y después Export data)',
      hevy: 'exporta como CSV (Settings y después Export & Import Data)',
      gymcoach:
        'usa el CSV exportado desde el historial o una tabla con las mismas columnas (session_date, workout, exercise, set_number, external_load_kg, reps, ...)',
      tcx: 'exporta la actividad como TCX desde la plataforma de tu reloj (Garmin Connect, Polar Flow, ...) para importar una sesión de cardio con duración, distancia y frecuencia cardíaca',
      gpx: 'exporta la ruta como GPX desde Strava, Komoot o Apple Fitness para importar una sesión de cardio con duración, distancia y frecuencia cardíaca',
      fit: 'exporta la actividad como FIT desde tu reloj Garmin u otro para importar una sesión de cardio con duración, distancia y frecuencia cardíaca',
      appleHealth:
        'en la app Salud, toca tu foto de perfil, luego Exportar todos los datos de salud, y elige el archivo export.zip que se crea (o el export.xml que contiene)',
      strava:
        'en strava.com abre Configuración, Mi cuenta, luego Empezar en Descarga o elimina tu cuenta, solicita tu archivo y elige el zip que Strava te envía por correo',
    },
    appleHealth: {
      description:
        'Trae tus entrenamientos de cardio desde Apple Salud: {hint}. Revisa la vista previa aquí y confirma.',
      chooseFile: 'Elegir export.zip',
      privacy:
        'La exportación se lee en este dispositivo, sea cual sea su tamaño: solo se envían a tu servidor GymCoach los resúmenes de los entrenamientos (tipo, fecha, duración, distancia, frecuencia cardíaca). Los entrenamientos de fuerza se omiten, y los que ya están en tu historial no se importan dos veces.',
      reading: 'Leyendo la exportación: {read} de {total} MB',
      sending: 'Enviando el lote {done} de {total}',
      waiting: 'Límite de importación alcanzado, se continúa en {seconds} s',
      nothingFound: 'No hay entrenamientos ni registros de peso corporal en este archivo.',
      noExportXml:
        'Este archivo comprimido no contiene export.xml. Elige el export.zip creado por la app Salud.',
      unreadable: 'No se pudo leer este archivo.',
      workouts:
        '{count, plural, one {# entrenamiento de cardio} other {# entrenamientos de cardio}} para importar',
      byType: '{name}: {count}',
      duplicates:
        '{count, plural, one {Se omitirá # entrenamiento que ya está en tu historial} other {Se omitirán # entrenamientos que ya están en tu historial}}',
      strengthSkipped:
        '{count, plural, one {Se omitirá # entrenamiento de fuerza} other {Se omitirán # entrenamientos de fuerza}}',
      invalidSkipped:
        '{count, plural, one {Se omitirá # entrenamiento sin fecha o duración utilizable} other {Se omitirán # entrenamientos sin fecha o duración utilizable}}',
      conflicts:
        '{count, plural, one {# entrenamiento no se puede importar} other {# entrenamientos no se pueden importar}}: uno de tus ejercicios que no son de cardio ya tiene ese nombre',
      bodyMass:
        'Importar también {count, plural, one {# registro de peso corporal} other {# registros de peso corporal}}',
      bodyMassDuplicates:
        '{count, plural, one {Se omitirá # registro de peso corporal de un día que ya tiene uno} other {Se omitirán # registros de peso corporal de días que ya tienen uno}}',
      done:
        '{sessions, plural, one {# entrenamiento importado} other {# entrenamientos importados}}{weights, plural, =0 {} one {, # registro de peso corporal} other {, # registros de peso corporal}}{skipped, plural, =0 {.} one { (# omitido).} other { (# omitidos).}}',
    },
    strava: {
      description:
        'Trae tus actividades de Strava: {hint}. Revisa aquí la vista previa y confirma.',
      chooseFile: 'Elegir el archivo de Strava',
      privacy:
        'El archivo se descomprime en este dispositivo: solo se envían a tu servidor GymCoach los archivos de actividad (FIT, GPX, TCX); las fotos y todo lo demás nunca se leen. Las importaciones están limitadas a 10 solicitudes por minuto, así que un historial largo tarda un rato: deja esta pestaña abierta. Las actividades que ya están en tu historial no se importan dos veces.',
      checking:
        'Comprobando el archivo: {read} de {total} MB, {count, plural, one {# actividad comprobada} other {# actividades comprobadas}}',
      importing:
        'Importando: {read} de {total} MB, {count, plural, one {# actividad enviada} other {# actividades enviadas}}',
      waiting: 'Límite de importación alcanzado, continúa en {seconds} s',
      cancelled: 'Importación cancelada. No se ha importado nada.',
      cancelledAfterStart:
        'Importación cancelada. Las actividades ya importadas se quedan en tu historial.',
      notZip: 'Este archivo no es un zip. Elige el zip que Strava te envió por correo.',
      notStrava:
        'Este archivo no contiene activities.csv ni la carpeta activities. Elige el zip que Strava te envió por correo.',
      unreadable: 'No se pudo leer este archivo.',
      activities:
        '{count, plural, one {# actividad para importar} other {# actividades para importar}}',
      byType: '{name}: {count}',
      duplicates:
        '{count, plural, one {# actividad que ya está en tu historial se omitirá} other {# actividades que ya están en tu historial se omitirán}}',
      withoutFile:
        '{count, plural, one {# actividad sin archivo (introducida a mano en Strava) se omitirá} other {# actividades sin archivo (introducidas a mano en Strava) se omitirán}}',
      unsupported:
        '{count, plural, one {# archivo en un formato que GymCoach no lee se omitirá} other {# archivos en un formato que GymCoach no lee se omitirán}}',
      tooLarge:
        '{count, plural, one {# archivo de más de 5 MB se omitirá} other {# archivos de más de 5 MB se omitirán}}',
      unreadableFiles:
        '{count, plural, one {# archivo que no se pudo leer se omitirá} other {# archivos que no se pudieron leer se omitirán}}',
      skippedFiles: 'Archivos que se omitirán',
      done:
        '{sessions, plural, one {# actividad importada} other {# actividades importadas}}{skipped, plural, =0 {.} one { (# omitida).} other { (# omitidas).}}',
    },
  },
  mcp: {
    title: 'ChatGPT y MCP',
    description:
      'Conecta un agente de IA externo a tus datos de GymCoach. Los tokens se pueden revocar en cualquier momento.',
    keyName: 'Nombre de la conexión',
    create: 'Crear conexión',
    created: 'Conexión MCP creada.',
    createError: 'No se pudo crear la conexión MCP.',
    writeAccess: 'Permitir cambios en los datos guardados',
    writeAccessDescription:
      'ChatGPT puede crear y editar programas, actualizar el inventario de tu gimnasio (pesos libres, equipo y sus fotos) y actualizar datos del historial de entrenamiento, como el equipo registrado en series pasadas, después de mostrarte la acción para que la confirmes.',
    readyTitle: 'La URL del conector de ChatGPT está lista',
    readyDescription:
      'Cópiala ahora. La parte secreta solo se muestra una vez. En ChatGPT elige sin autenticación, porque la URL ya contiene un token privado.',
    copied: 'URL del conector copiada.',
    copy: 'Copiar la URL del conector',
    activeKeys: 'Conexiones activas',
    noKeys: 'Aún no hay conexiones MCP.',
    readWrite: 'Lectura y escritura',
    readOnly: 'Solo lectura',
    lastUsed: 'usada el {date}',
    revoke: 'Revocar conexión',
    revoked: 'Conexión MCP revocada.',
    revokeError: 'No se pudo revocar la conexión MCP.',
  },
} satisfies MessageShape<typeof english>;
