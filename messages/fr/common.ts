import { common as english } from '../en/common';
import type { MessageShape } from '@/i18n/message-types';

export const common = {
  metadata: {
    description: 'Suivi de musculation et coach IA personnel.',
  },
  actions: {
    add: 'Ajouter',
    apply: 'Appliquer',
    back: 'Retour',
    cancel: 'Annuler',
    close: 'Fermer',
    confirm: 'Confirmer',
    continue: 'Continuer',
    create: 'Créer',
    delete: 'Supprimer',
    download: 'Télécharger',
    edit: 'Modifier',
    finish: 'Terminer',
    generate: 'Générer',
    import: 'Importer',
    loading: 'Chargement...',
    refresh: 'Actualiser',
    remove: 'Retirer',
    resume: 'Reprendre',
    retry: 'Réessayer',
    save: 'Enregistrer',
    saving: 'Enregistrement...',
    start: 'Démarrer',
    upload: 'Envoyer',
    view: 'Voir',
  },
  fields: {
    description: 'Description',
    email: 'Email',
    name: 'Nom',
    notes: 'Notes',
    password: 'Mot de passe',
  },
  states: {
    active: 'Actif',
    completed: 'Terminé',
    empty: 'vide',
    inactive: 'Inactif',
    no: 'Non',
    optional: 'Facultatif',
    yes: 'Oui',
  },
  counts: {
    exercises: '{count, plural, =0 {Aucun exercice} one {# exercice} other {# exercices}}',
    pending: '{count, plural, one {# en attente} other {# en attente}}',
    sessions: '{count, plural, =0 {Aucune séance} one {# séance} other {# séances}}',
    sets: '{count, plural, =0 {Aucune série} one {# série} other {# séries}}',
    workouts: '{count, plural, =0 {Aucune séance} one {# séance} other {# séances}}',
  },
  days: {
    monday: 'Lundi',
    tuesday: 'Mardi',
    wednesday: 'Mercredi',
    thursday: 'Jeudi',
    friday: 'Vendredi',
    saturday: 'Samedi',
    sunday: 'Dimanche',
  },
  language: {
    label: 'Langue',
    change: 'Changer de langue',
    description: 'Choisissez la langue de l’interface GymCoach.',
    english: 'Anglais',
    french: 'Français',
    russian: 'Russe',
    german: 'Allemand',
    spanish: 'Espagnol',
    portuguese: 'Portugais',
    italian: 'Italien',
    dutch: 'Néerlandais',
    polish: 'Polonais',
    turkish: 'Turc',
    chinese: 'Chinois simplifié',
    error: 'Impossible de changer la langue.',
  },
  theme: {
    dark: 'Sombre',
    light: 'Clair',
    system: 'Système',
    switchToDark: 'Passer en mode sombre',
    switchToLight: 'Passer en mode clair',
  },
  offline: {
    offline: 'Hors ligne',
    syncNow: 'Synchroniser maintenant',
    syncing: 'Synchronisation de {count}...',
    pending: 'Hors ligne · {count, plural, one {# en attente} other {# en attente}}',
  },
  errors: {
    generic: 'Une erreur est survenue. Veuillez réessayer.',
  },
  // A failed AI provider call, by class (issue #571). {variable} is the name
  // of an environment variable, never its value.
  aiErrors: {
    invalidKey:
      "Le fournisseur d'IA a refusé la clé API. Vérifiez {variable} dans votre .env et redémarrez.",
    quota:
      "Le fournisseur d'IA a refusé la requête : limite de débit atteinte ou crédits épuisés. Patientez un instant et réessayez, ou vérifiez les crédits de votre compte fournisseur.",
    model:
      "Le modèle d'IA a refusé la requête ou a renvoyé une réponse inutilisable. Vérifiez le nom du modèle dans {variable}, ou choisissez un autre modèle.",
    outage: "Le fournisseur d'IA est indisponible pour le moment. Réessayez plus tard.",
    timeout: "Le fournisseur d'IA n'a pas répondu à temps ou est injoignable. Réessayez.",
    truncated:
      "La réponse de l'IA a été coupée : le modèle a épuisé ses jetons de sortie. Augmentez {variable} ou réessayez.",
    notConfigured:
      "Le fournisseur d'IA est mal configuré. Vérifiez {variable} dans votre .env et redémarrez.",
    unknown:
      "La requête à l'IA a échoué. Réessayez ; si le problème persiste, consultez le journal du serveur.",
  },
} satisfies MessageShape<typeof english>;
