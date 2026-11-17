import { common as english } from '../en/common';
import type { MessageShape } from '@/i18n/message-types';

export const common = {
  metadata: {
    description: 'Diario di allenamento per la forza e coach personale con IA.',
  },
  actions: {
    add: 'Aggiungi',
    apply: 'Applica',
    back: 'Indietro',
    cancel: 'Annulla',
    close: 'Chiudi',
    confirm: 'Conferma',
    continue: 'Continua',
    create: 'Crea',
    delete: 'Elimina',
    download: 'Scarica',
    edit: 'Modifica',
    finish: 'Termina',
    generate: 'Genera',
    import: 'Importa',
    loading: 'Caricamento...',
    refresh: 'Aggiorna',
    remove: 'Rimuovi',
    resume: 'Riprendi',
    retry: 'Riprova',
    save: 'Salva',
    saving: 'Salvataggio...',
    start: 'Inizia',
    upload: 'Carica',
    view: 'Visualizza',
  },
  fields: {
    description: 'Descrizione',
    email: 'Email',
    name: 'Nome',
    notes: 'Note',
    password: 'Password',
  },
  states: {
    active: 'Attivo',
    completed: 'Completato',
    empty: 'vuoto',
    inactive: 'Inattivo',
    no: 'No',
    optional: 'Facoltativo',
    yes: 'Sì',
  },
  counts: {
    exercises: '{count, plural, =0 {Nessun esercizio} one {# esercizio} other {# esercizi}}',
    pending: '{count, plural, one {# in attesa} other {# in attesa}}',
    sessions: '{count, plural, =0 {Nessuna sessione} one {# sessione} other {# sessioni}}',
    sets: '{count, plural, =0 {Nessuna serie} one {# serie} other {# serie}}',
    workouts: '{count, plural, =0 {Nessun allenamento} one {# allenamento} other {# allenamenti}}',
  },
  days: {
    monday: 'Lunedì',
    tuesday: 'Martedì',
    wednesday: 'Mercoledì',
    thursday: 'Giovedì',
    friday: 'Venerdì',
    saturday: 'Sabato',
    sunday: 'Domenica',
  },
  language: {
    label: 'Lingua',
    change: 'Cambia lingua',
    description: 'Scegli la lingua dell’interfaccia di GymCoach.',
    english: 'Inglese',
    french: 'Francese',
    russian: 'Russo',
    german: 'Tedesco',
    spanish: 'Spagnolo',
    portuguese: 'Portoghese',
    italian: 'Italiano',
    dutch: 'Olandese',
    polish: 'Polacco',
    turkish: 'Turco',
    chinese: 'Cinese semplificato',
    error: 'Impossibile cambiare la lingua.',
  },
  theme: {
    dark: 'Scuro',
    light: 'Chiaro',
    system: 'Sistema',
    switchToDark: 'Passa al tema scuro',
    switchToLight: 'Passa al tema chiaro',
  },
  offline: {
    offline: 'Offline',
    syncNow: 'Sincronizza ora',
    syncing: 'Sincronizzazione di {count}...',
    pending: 'Offline · {count, plural, one {# in attesa} other {# in attesa}}',
  },
  errors: {
    generic: 'Qualcosa è andato storto. Riprova.',
  },
  // A failed AI provider call, by class (issue #571). {variable} is the name
  // of an environment variable, never its value.
  aiErrors: {
    invalidKey:
      'Il provider IA ha rifiutato la chiave API. Controlla {variable} nel tuo .env e riavvia.',
    quota:
      'Il provider IA ha rifiutato la richiesta: limite di utilizzo raggiunto o crediti esauriti. Attendi un momento e riprova, oppure controlla i crediti del tuo account presso il provider.',
    model:
      'Il modello IA ha rifiutato la richiesta o ha restituito una risposta inutilizzabile. Controlla il nome del modello in {variable} oppure scegli un altro modello.',
    outage: 'Il provider IA non è disponibile in questo momento. Riprova più tardi.',
    timeout: 'Il provider IA non ha risposto in tempo o non è raggiungibile. Riprova.',
    truncated:
      'La risposta IA è stata troncata: il modello ha esaurito i token di output. Aumenta {variable} o riprova.',
    notConfigured:
      'Il provider IA non è configurato correttamente. Controlla {variable} nel tuo .env e riavvia.',
    unknown:
      'La richiesta IA non è riuscita. Riprova; se continua a fallire, controlla il log del server.',
  },
} satisfies MessageShape<typeof english>;
