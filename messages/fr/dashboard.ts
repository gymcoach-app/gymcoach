import { dashboard as english } from '../en/dashboard';
import type { MessageShape } from '@/i18n/message-types';

export const dashboard = {
  activeSession: 'Séance en cours',
  sessionFallback: 'Séance',
  startedOn: '{name} démarrée le {date}',
  resumeSession: 'Reprendre la séance',
  noActiveProgram: 'Aucun programme actif',
  noActiveProgramDescription: 'Activez un programme pour démarrer une séance.',
  viewPrograms: 'Voir les programmes',
  emptyProgram: 'Programme vide',
  emptyProgramDescription: '{name} n’a aucune séance configurée.',
  configureProgram: 'Configurer le programme',
  startSession: 'Démarrer une séance',
  startEmpty: 'Démarrer une séance vide',
  activeProgram: 'Programme actif : {name}',
  chooseSession: 'Choisir une séance',
  programSessions: 'Séances du programme',
  insight: {
    deloadTitle: 'Une récupération semble nécessaire',
    stalledTitle: '{count, plural, one {Un exercice stagne} other {# exercices stagnent}}',
    stalledDetail:
      '{count, plural, one {{names} n’a pas progressé récemment. Un petit changement de charge, de répétitions ou de technique peut relancer la progression.} other {{names} n’ont pas progressé récemment. Consultez la page Progrès pour savoir quoi ajuster.}}',
    prTitle: 'Nouveau record personnel',
    prWeightDetail: 'Votre dernière séance a établi une nouvelle charge maximale sur {name}. Bravo.',
    prOneRmDetail:
      'Votre dernière séance a établi un nouveau meilleur 1RM estimé sur {name}. Bravo.',
    consistentTitle: 'Vous vous entraînez régulièrement',
    consistentDetail:
      '{count, plural, one {# jour d’entraînement} other {# jours d’entraînement}} cette semaine. Gardez le rythme.',
    deloadStalledReason:
      '{count, plural, one {# exercice stagne : {names}.} other {# exercices stagnent : {names}.}}',
    deloadReadinessReason:
      'Votre forme est en moyenne à {average}/5 sur {checkins, plural, one {votre dernier bilan} other {vos # derniers bilans}}.',
  },
} satisfies MessageShape<typeof english>;
