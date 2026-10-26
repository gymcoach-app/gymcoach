import { dashboard as english } from '../en/dashboard';
import type { MessageShape } from '@/i18n/message-types';

export const dashboard = {
  activeSession: 'Sessione attiva',
  sessionFallback: 'Sessione',
  startedOn: '{name} iniziata il {date}',
  resumeSession: 'Riprendi la sessione',
  noActiveProgram: 'Nessun programma attivo',
  noActiveProgramDescription: 'Attiva un programma per iniziare una sessione.',
  viewPrograms: 'Vedi i programmi',
  emptyProgram: 'Programma vuoto',
  emptyProgramDescription: '{name} non ha nessuna sessione configurata.',
  configureProgram: 'Configura il programma',
  startSession: 'Inizia una sessione',
  activeProgram: 'Programma attivo: {name}',
  chooseSession: 'Scegli una sessione',
  programSessions: 'Sessioni del programma',
  insight: {
    deloadTitle: 'Forse è il momento di recuperare',
    stalledTitle:
      '{count, plural, one {Un esercizio è in stallo} other {# esercizi sono in stallo}}',
    stalledDetail:
      '{count, plural, one {{names} non è migliorato di recente. Un piccolo cambio di carico, ripetizioni o tecnica può sbloccarlo.} other {{names} non sono migliorati di recente. Controlla la pagina dei progressi per capire cosa modificare.}}',
    prTitle: 'Nuovo record personale',
    prWeightDetail:
      'Nell’ultima sessione hai fatto la tua serie più pesante su {name}. Ottimo lavoro.',
    prOneRmDetail:
      'Nell’ultima sessione hai ottenuto il tuo miglior 1RM stimato su {name}. Ottimo lavoro.',
    consistentTitle: 'Ti stai allenando con costanza',
    consistentDetail:
      'Ti sei allenato {count, plural, one {# giorno} other {# giorni}} questa settimana. Continua così.',
    deloadStalledReason:
      '{count, plural, one {# esercizio è in stallo: {names}.} other {# esercizi sono in stallo: {names}.}}',
    deloadReadinessReason:
      'Il tuo stato di forma è stato in media di {average}/5 {checkins, plural, one {nell’ultimo check-in} other {negli ultimi # check-in}}.',
  },
} satisfies MessageShape<typeof english>;
