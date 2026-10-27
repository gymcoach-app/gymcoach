import { coach as english } from '../en/coach';
import type { MessageShape } from '@/i18n/message-types';

export const coach = {
  title: 'Coach',
  description: 'Resumen semanal de tu entrenamiento con IA.',
  chatTitle: 'Chat',
  chatDescription: 'Habla con tu coach con tus datos de entrenamiento como contexto.',
  conversation: 'Conversación',
  client: {
    generating: 'Generando (10-20 s)...',
    request: 'Pedir un resumen semanal',
    empty: 'Aún no hay ningún resumen. Pide el primero arriba.',
    unknownError: 'Error desconocido',
    tooManyDebriefs: 'Has pedido varios resúmenes en poco tiempo. Inténtalo más tarde.',
    keyMissing: 'Falta la clave de {provider}',
    keySetup: 'Configura {variable} en .env para activar el coach.',
    applied: 'Aplicado',
    debriefFrom: 'Resumen del {date}',
    weekOf: 'Semana del {date}',
  },
  chat: {
    apiKey: 'Configura {variable} en .env para activar el chat.',
    liveSession: 'Sesión en curso adjunta.',
    new: 'Nuevo',
    placeholder: 'Escribe a tu coach...',
    send: 'Enviar',
    liveSessionDescription:
      'El coach ve las series registradas hasta ahora y los objetivos del programa para este entrenamiento.',
    emptySession:
      '¿Una duda a mitad del entrenamiento? Pregunta por tu próxima serie, una carga que no te convence o un cambio de ejercicio.',
    empty:
      'Pregunta cómo superar un estancamiento, por el volumen de entrenamiento, la progresión, la recuperación o cómo adaptarte a una lesión.',
    advisory:
      'El chat aconseja, pero no puede editar tus datos. Aplica los cambios tú mismo en la página de programas o desde el resumen semanal.',
  },
  context: {
    title: 'Lo que ve tu coach',
    teaser: 'El contexto de entrenamiento detrás de cada resumen. Toca para ampliar.',
    history: 'Historial de entrenamiento',
    goals: 'Objetivos',
    achieved: 'conseguido',
    noGoals: 'No hay objetivos de ejercicios.',
    fatigue: 'Fatiga',
    conditioning: 'Cardio',
    readiness: 'Preparación',
    historySummary:
      '{weeks, plural, one {# semana} other {# semanas}} de historial reciente con {exercises, plural, one {# ejercicio} other {# ejercicios}}.',
    noHistory:
      'Aún no hay sesiones registradas: el coach empieza a aprender desde tu primer entrenamiento.',
    goalProgress: '({percent} % conseguido)',
    stalled: 'Ejercicios estancados: {names}.',
    noStalled: 'No se ha detectado ningún ejercicio estancado.',
    deloadActive: 'Hay una semana de descarga planificada en curso.',
    deloadRecommended: 'Se recomienda una descarga{reasons, select, none {.} other {: {reasons}.}}',
    noDeload: 'No se recomienda ninguna descarga.',
    conditioningSummary:
      'Esta semana: {minutes} min{km, select, none {} other { · {km} km}} · {sessions, plural, one {# sesión} other {# sesiones}} (objetivo {target} min/semana)',
    today: 'hoy',
    daysAgo: '{days, plural, one {hace # día} other {hace # días}}',
    readinessSummary: 'Último registro {when}: preparación {readiness}/5, sueño {sleep}/5.',
    noReadiness: 'Ningún registro de preparación en los últimos 7 días.',
    privacy:
      'La IA recibe un resumen compacto como este y tus registros recientes serie por serie; nunca los datos de tu cuenta ni nada fuera de tu historial de entrenamiento.',
  },
  note: {
    title: 'Nota para tu coach',
    description:
      'Añade el contexto que no muestran los datos de entrenamiento, como una lesión, una enfermedad o un viaje.',
    placeholder: 'p. ej. Me molesta el hombro, esta semana ve con calma con los ejercicios de empuje.',
    clear: 'Borrar',
    save: 'Guardar',
    saved: 'Nota guardada.',
    cleared: 'Nota borrada.',
    error: 'No se pudo guardar la nota.',
  },
  adjustments: {
    title: 'Ajustes sugeridos',
    applied: 'Ya aplicado',
    description:
      'Elige qué aplicar al programa activo. Puedes editar los valores antes de confirmar.',
    aria: 'Aplicar el ajuste a {exercise}',
    repsMin: 'Reps mín.',
    repsMax: 'Reps máx.',
    sets: 'Series',
    rest: 'Descanso (s)',
    targetLoad: 'Carga objetivo',
    versus: ' (antes {value})',
    applying: 'Aplicando...',
    apply: 'Aplicar {count, plural, one {# ajuste} other {# ajustes}}',
  },
} satisfies MessageShape<typeof english>;
