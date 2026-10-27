import { coach as english } from '../en/coach';
import type { MessageShape } from '@/i18n/message-types';

export const coach = {
  title: 'Coach',
  description: 'Débrief IA hebdomadaire de vos entraînements.',
  chatTitle: 'Chat',
  chatDescription: 'Discutez avec votre coach, vos données d’entraînement en contexte.',
  conversation: 'Conversation',
  client: {
    generating: 'Génération (10-20 s)...',
    request: 'Demander un débrief hebdomadaire',
    empty: 'Aucun débrief pour l’instant. Lancez le premier ci-dessus.',
    unknownError: 'Erreur inconnue',
    tooManyDebriefs: 'Vous avez demandé trop de débriefs. Réessayez plus tard.',
    keyMissing: 'Clé {provider} manquante',
    keySetup: 'Définissez {variable} dans .env pour activer le coach.',
    applied: 'Appliqué',
    debriefFrom: 'Débrief du {date}',
    weekOf: 'Semaine du {date}',
  },
  chat: {
    apiKey: 'Définissez {variable} dans .env pour activer le chat.',
    liveSession: 'Séance en cours attachée.',
    new: 'Nouveau',
    placeholder: 'Écrivez à votre coach...',
    send: 'Envoyer',
    liveSessionDescription:
      'Le coach voit les séries déjà enregistrées et les objectifs du programme pour cette séance.',
    emptySession:
      'Une question en pleine séance ? Demandez conseil sur votre prochaine série, une charge qui semble anormale ou un changement d’exercice.',
    empty:
      'Posez vos questions : sortir d’un plateau, volume d’entraînement, progression, récupération ou adaptation à une blessure.',
    advisory:
      'Le chat conseille mais ne modifie pas vos données. Appliquez les changements vous-même depuis la page Programmes ou depuis le débrief hebdomadaire.',
  },
  context: {
    title: 'Ce que voit votre coach',
    teaser: 'Le contexte d’entraînement derrière chaque débrief. Touchez pour développer.',
    history: 'Historique d’entraînement',
    goals: 'Objectifs',
    achieved: 'atteint',
    noGoals: 'Aucun objectif d’exercice défini.',
    fatigue: 'Fatigue',
    conditioning: 'Cardio',
    readiness: 'Forme',
    historySummary:
      '{weeks, plural, one {# semaine} other {# semaines}} d’historique récent sur {exercises, plural, one {# exercice} other {# exercices}}.',
    noHistory:
      'Aucune séance enregistrée pour l’instant - le coach commence à apprendre dès votre première séance.',
    goalProgress: '({percent} % de l’objectif)',
    stalled: 'Exercices qui stagnent : {names}.',
    noStalled: 'Aucun exercice en stagnation détecté.',
    deloadActive: 'Une semaine de décharge planifiée est en cours.',
    deloadRecommended: 'Décharge recommandée{reasons, select, none {.} other { : {reasons}.}}',
    noDeload: 'Aucune décharge recommandée.',
    conditioningSummary:
      'Cette semaine : {minutes} min{km, select, none {} other { · {km} km}} · {sessions, plural, one {# séance} other {# séances}} (objectif {target} min/semaine)',
    today: 'aujourd’hui',
    daysAgo: '{days, plural, one {il y a # jour} other {il y a # jours}}',
    readinessSummary: 'Dernier bilan {when} : forme {readiness}/5, sommeil {sleep}/5.',
    noReadiness: 'Aucun bilan de forme au cours des 7 derniers jours.',
    privacy:
      'L’IA reçoit un résumé compact comme celui-ci, plus vos dernières séries enregistrées - jamais vos données de compte ni quoi que ce soit hors de votre historique d’entraînement.',
  },
  note: {
    title: 'Note à votre coach',
    description:
      'Ajoutez du contexte que les données ne montrent pas, comme une blessure, une maladie ou un déplacement.',
    placeholder: 'ex. Épaule douloureuse, allège les développés cette semaine.',
    clear: 'Effacer',
    save: 'Enregistrer',
    saved: 'Note enregistrée.',
    cleared: 'Note effacée.',
    error: 'Impossible d’enregistrer la note.',
  },
  adjustments: {
    title: 'Ajustements proposés',
    applied: 'Déjà appliqué',
    description:
      'Choisissez ce qui doit être appliqué au programme actif. Vous pouvez modifier les valeurs avant de confirmer.',
    aria: 'Appliquer l’ajustement à {exercise}',
    repsMin: 'Reps min',
    repsMax: 'Reps max',
    sets: 'Séries',
    rest: 'Repos (s)',
    targetLoad: 'Charge cible',
    versus: ' (au lieu de {value})',
    applying: 'Application...',
    apply: 'Appliquer {count, plural, one {# ajustement} other {# ajustements}}',
  },
} satisfies MessageShape<typeof english>;
