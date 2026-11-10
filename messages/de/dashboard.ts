import { dashboard as english } from '../en/dashboard';
import type { MessageShape } from '@/i18n/message-types';

export const dashboard = {
  activeSession: 'Aktive Einheit',
  sessionFallback: 'Einheit',
  startedOn: '{name} gestartet am {date}',
  resumeSession: 'Einheit fortsetzen',
  noActiveProgram: 'Kein aktives Programm',
  noActiveProgramDescription: 'Aktiviere ein Programm, um eine Einheit zu starten.',
  viewPrograms: 'Programme ansehen',
  emptyProgram: 'Leeres Programm',
  emptyProgramDescription: '{name} hat keine konfigurierte Einheit.',
  configureProgram: 'Programm konfigurieren',
  startSession: 'Einheit starten',
  startEmpty: 'Leere Einheit starten',
  activeProgram: 'Aktives Programm: {name}',
  chooseSession: 'Einheit wählen',
  programSessions: 'Programmeinheiten',
  insight: {
    deloadTitle: 'Regeneration könnte fällig sein',
    stalledTitle: '{count, plural, one {Eine Übung stagniert} other {# Übungen stagnieren}}',
    stalledDetail:
      '{count, plural, one {{names} hat sich kürzlich nicht verbessert. Eine kleine Änderung bei Gewicht, Wiederholungen oder Technik kann sie wieder in Bewegung bringen.} other {{names} haben sich kürzlich nicht verbessert. Sieh auf der Fortschritts-Seite nach, was anzupassen ist.}}',
    prTitle: 'Neuer persönlicher Rekord',
    prWeightDetail: 'Deine letzte Einheit hat einen neuen schwersten Satz bei {name} gesetzt. Gute Arbeit.',
    prOneRmDetail: 'Deine letzte Einheit hat einen neuen besten geschätzten 1RM bei {name} gesetzt. Gute Arbeit.',
    consistentTitle: 'Du trainierst konstant',
    consistentDetail:
      '{count, plural, one {# Tag} other {# Tage}} diese Woche trainiert. Halte das Momentum.',
    deloadStalledReason:
      '{count, plural, one {# Übung stagniert: {names}.} other {# Übungen stagnieren: {names}.}}',
    deloadReadinessReason:
      'Deine Bereitschaft hat durchschnittlich {average}/5 über deine letzten {checkins, plural, one {# Check-in} other {# Check-ins}} betragen.',
  },
} satisfies MessageShape<typeof english>;
