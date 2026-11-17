import { common as english } from '../en/common';
import type { MessageShape } from '@/i18n/message-types';

export const common = {
  metadata: {
    description: 'Registro de entrenamiento de fuerza y coach personal con IA.',
  },
  actions: {
    add: 'Añadir',
    apply: 'Aplicar',
    back: 'Atrás',
    cancel: 'Cancelar',
    close: 'Cerrar',
    confirm: 'Confirmar',
    continue: 'Continuar',
    create: 'Crear',
    delete: 'Eliminar',
    download: 'Descargar',
    edit: 'Editar',
    finish: 'Terminar',
    generate: 'Generar',
    import: 'Importar',
    loading: 'Cargando...',
    refresh: 'Actualizar',
    remove: 'Quitar',
    resume: 'Reanudar',
    retry: 'Reintentar',
    save: 'Guardar',
    saving: 'Guardando...',
    start: 'Empezar',
    upload: 'Subir',
    view: 'Ver',
  },
  fields: {
    description: 'Descripción',
    email: 'Correo electrónico',
    name: 'Nombre',
    notes: 'Notas',
    password: 'Contraseña',
  },
  states: {
    active: 'Activo',
    completed: 'Completado',
    empty: 'vacío',
    inactive: 'Inactivo',
    no: 'No',
    optional: 'Opcional',
    yes: 'Sí',
  },
  counts: {
    exercises: '{count, plural, =0 {Sin ejercicios} one {# ejercicio} other {# ejercicios}}',
    pending: '{count, plural, one {# pendiente} other {# pendientes}}',
    sessions: '{count, plural, =0 {Sin sesiones} one {# sesión} other {# sesiones}}',
    sets: '{count, plural, =0 {Sin series} one {# serie} other {# series}}',
    workouts:
      '{count, plural, =0 {Sin entrenamientos} one {# entrenamiento} other {# entrenamientos}}',
  },
  days: {
    monday: 'Lunes',
    tuesday: 'Martes',
    wednesday: 'Miércoles',
    thursday: 'Jueves',
    friday: 'Viernes',
    saturday: 'Sábado',
    sunday: 'Domingo',
  },
  language: {
    label: 'Idioma',
    change: 'Cambiar idioma',
    description: 'Elige el idioma de la interfaz de GymCoach.',
    english: 'Inglés',
    french: 'Francés',
    russian: 'Ruso',
    german: 'Alemán',
    spanish: 'Español',
    portuguese: 'Portugués',
    italian: 'Italiano',
    dutch: 'Neerlandés',
    polish: 'Polaco',
    turkish: 'Turco',
    chinese: 'Chino simplificado',
    error: 'No se pudo cambiar el idioma.',
  },
  theme: {
    dark: 'Oscuro',
    light: 'Claro',
    system: 'Sistema',
    switchToDark: 'Cambiar al modo oscuro',
    switchToLight: 'Cambiar al modo claro',
  },
  offline: {
    offline: 'Sin conexión',
    syncNow: 'Sincronizar ahora',
    syncing: 'Sincronizando {count}...',
    pending: 'Sin conexión · {count, plural, one {# pendiente} other {# pendientes}}',
  },
  errors: {
    generic: 'Algo salió mal. Inténtalo de nuevo.',
  },
  // A failed AI provider call, by class (issue #571). {variable} is the name
  // of an environment variable, never its value.
  aiErrors: {
    invalidKey:
      'El proveedor de IA rechazó la clave de API. Revisa {variable} en tu .env y reinicia.',
    quota:
      'El proveedor de IA rechazó la solicitud: límite de uso alcanzado o créditos agotados. Espera un momento y vuelve a intentarlo, o revisa los créditos de tu cuenta del proveedor.',
    model:
      'El modelo de IA rechazó la solicitud o devolvió una respuesta que no se pudo usar. Revisa el nombre del modelo en {variable} o elige otro modelo.',
    outage: 'El proveedor de IA no está disponible en este momento. Inténtalo más tarde.',
    timeout: 'El proveedor de IA no respondió a tiempo o no se pudo contactar. Inténtalo de nuevo.',
    truncated:
      'La respuesta de la IA quedó cortada: el modelo se quedó sin tokens de salida. Aumenta {variable} o inténtalo de nuevo.',
    notConfigured:
      'El proveedor de IA no está bien configurado. Revisa {variable} en tu .env y reinicia.',
    unknown:
      'La solicitud a la IA falló. Inténtalo de nuevo; si sigue fallando, revisa el registro del servidor.',
  },
} satisfies MessageShape<typeof english>;
