import { dashboard as english } from '../en/dashboard';
import type { MessageShape } from '@/i18n/message-types';

export const dashboard = {
  activeSession: 'Actieve sessie',
  sessionFallback: 'Sessie',
  startedOn: '{name} gestart op {date}',
  resumeSession: 'Sessie hervatten',
  noActiveProgram: 'Geen actief programma',
  noActiveProgramDescription: 'Activeer een programma om een sessie te starten.',
  viewPrograms: "Programma's bekijken",
  emptyProgram: 'Leeg programma',
  emptyProgramDescription: '{name} heeft nog geen sessie ingesteld.',
  configureProgram: 'Programma instellen',
  startSession: 'Start een sessie',
  activeProgram: 'Actief programma: {name}',
  chooseSession: 'Kies een sessie',
  programSessions: 'Sessies van het programma',
  insight: {
    deloadTitle: 'Misschien is het tijd om te herstellen',
    stalledTitle: '{count, plural, one {Een oefening staat stil} other {# oefeningen staan stil}}',
    stalledDetail:
      '{count, plural, one {{names} is de laatste tijd niet vooruitgegaan. Een kleine aanpassing in gewicht, herhalingen of techniek kan het weer op gang brengen.} other {{names} zijn de laatste tijd niet vooruitgegaan. Kijk op de voortgangspagina wat je kunt aanpassen.}}',
    prTitle: 'Nieuw persoonlijk record',
    prWeightDetail:
      'In je laatste sessie zette je je zwaarste set ooit neer bij {name}. Goed bezig.',
    prOneRmDetail:
      'In je laatste sessie haalde je een nieuwe beste geschatte 1RM bij {name}. Goed bezig.',
    consistentTitle: 'Je traint consequent',
    consistentDetail:
      'Deze week {count, plural, one {# dag} other {# dagen}} getraind. Hou het vol.',
    deloadStalledReason:
      '{count, plural, one {# oefening staat stil: {names}.} other {# oefeningen staan stil: {names}.}}',
    deloadReadinessReason:
      'Je gereedheid was gemiddeld {average}/5 over je laatste {checkins, plural, one {# check-in} other {# check-ins}}.',
  },
} satisfies MessageShape<typeof english>;
