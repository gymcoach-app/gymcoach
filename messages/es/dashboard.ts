export const dashboard = {
  activeSession: 'Sesión activa',
  sessionFallback: 'Sesión',
  startedOn: '{name} empezó el {date}',
  resumeSession: 'Reanudar sesión',
  noActiveProgram: 'Ningún programa activo',
  noActiveProgramDescription: 'Activa un programa para empezar una sesión.',
  viewPrograms: 'Ver programas',
  emptyProgram: 'Programa vacío',
  emptyProgramDescription: '{name} no tiene ninguna sesión configurada.',
  configureProgram: 'Configurar programa',
  startSession: 'Empezar una sesión',
  activeProgram: 'Programa activo: {name}',
  chooseSession: 'Elige una sesión',
  programSessions: 'Sesiones del programa',
  insight: {
    deloadTitle: 'Puede que necesites recuperarte',
    stalledTitle:
      '{count, plural, one {Un ejercicio se ha estancado} other {# ejercicios se han estancado}}',
    stalledDetail:
      '{count, plural, one {{names} no ha progresado últimamente. Un pequeño cambio de carga, repeticiones o técnica puede volver a ponerlo en marcha.} other {{names} no han progresado últimamente. Revisa la página de progreso para ver qué ajustar.}}',
    prTitle: 'Nuevo récord personal',
    prWeightDetail: 'En tu última sesión hiciste tu serie más pesada en {name}. ¡Buen trabajo!',
    prOneRmDetail: 'En tu última sesión lograste tu mejor 1RM estimado en {name}. ¡Buen trabajo!',
    consistentTitle: 'Estás entrenando con constancia',
    consistentDetail:
      'Has entrenado {count, plural, one {# día} other {# días}} esta semana. Sigue así.',
    deloadStalledReason:
      '{count, plural, one {# ejercicio se ha estancado: {names}.} other {# ejercicios se han estancado: {names}.}}',
    deloadReadinessReason:
      'Tu nivel de preparación ha promediado {average}/5 en tus {checkins, plural, one {último # registro} other {últimos # registros}}.',
  },
};
