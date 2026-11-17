import { common as english } from '../en/common';
import type { MessageShape } from '@/i18n/message-types';

export const common = {
  metadata: {
    description: 'Tracker voor krachttraining en persoonlijke AI-coach.',
  },
  actions: {
    add: 'Toevoegen',
    apply: 'Toepassen',
    back: 'Terug',
    cancel: 'Annuleren',
    close: 'Sluiten',
    confirm: 'Bevestigen',
    continue: 'Doorgaan',
    create: 'Aanmaken',
    delete: 'Verwijderen',
    download: 'Downloaden',
    edit: 'Bewerken',
    finish: 'Afronden',
    generate: 'Genereren',
    import: 'Importeren',
    loading: 'Laden...',
    refresh: 'Vernieuwen',
    remove: 'Verwijderen',
    resume: 'Hervatten',
    retry: 'Opnieuw proberen',
    save: 'Opslaan',
    saving: 'Opslaan...',
    start: 'Starten',
    upload: 'Uploaden',
    view: 'Bekijken',
  },
  fields: {
    description: 'Beschrijving',
    email: 'E-mail',
    name: 'Naam',
    notes: 'Notities',
    password: 'Wachtwoord',
  },
  states: {
    active: 'Actief',
    completed: 'Voltooid',
    empty: 'leeg',
    inactive: 'Inactief',
    no: 'Nee',
    optional: 'Optioneel',
    yes: 'Ja',
  },
  counts: {
    exercises: '{count, plural, =0 {Geen oefeningen} one {# oefening} other {# oefeningen}}',
    pending: '{count, plural, one {# in wachtrij} other {# in wachtrij}}',
    sessions: '{count, plural, =0 {Geen sessies} one {# sessie} other {# sessies}}',
    sets: '{count, plural, =0 {Geen sets} one {# set} other {# sets}}',
    workouts: '{count, plural, =0 {Geen trainingen} one {# training} other {# trainingen}}',
  },
  days: {
    monday: 'Maandag',
    tuesday: 'Dinsdag',
    wednesday: 'Woensdag',
    thursday: 'Donderdag',
    friday: 'Vrijdag',
    saturday: 'Zaterdag',
    sunday: 'Zondag',
  },
  language: {
    label: 'Taal',
    change: 'Taal wijzigen',
    description: 'Kies de taal van de GymCoach-interface.',
    english: 'Engels',
    french: 'Frans',
    russian: 'Russisch',
    german: 'Duits',
    spanish: 'Spaans',
    portuguese: 'Portugees',
    italian: 'Italiaans',
    dutch: 'Nederlands',
    polish: 'Pools',
    turkish: 'Turks',
    error: 'Kon de taal niet wijzigen.',

    chinese: 'Vereenvoudigd Chinees',
  },
  theme: {
    dark: 'Donker',
    light: 'Licht',
    system: 'Systeem',
    switchToDark: 'Overschakelen naar donkere modus',
    switchToLight: 'Overschakelen naar lichte modus',
  },
  offline: {
    offline: 'Offline',
    syncNow: 'Nu synchroniseren',
    syncing: 'Synchroniseren ({count})...',
    pending: 'Offline · {count, plural, one {# in wachtrij} other {# in wachtrij}}',
  },
  errors: {
    generic: 'Er ging iets mis. Probeer het opnieuw.',
  },
  // A failed AI provider call, by class (issue #571). {variable} is the name
  // of an environment variable, never its value.
  aiErrors: {
    invalidKey:
      'De AI-provider heeft de API-sleutel geweigerd. Controleer {variable} in je .env en start opnieuw.',
    quota:
      'De AI-provider heeft het verzoek geweigerd: limiet bereikt of tegoed op. Wacht even en probeer het opnieuw, of controleer het tegoed van je provideraccount.',
    model:
      'Het AI-model heeft het verzoek geweigerd of gaf een onbruikbaar antwoord. Controleer de modelnaam in {variable} of kies een ander model.',
    outage: 'De AI-provider is op dit moment niet beschikbaar. Probeer het later opnieuw.',
    timeout: 'De AI-provider antwoordde niet op tijd of was niet bereikbaar. Probeer het opnieuw.',
    truncated:
      'Het AI-antwoord is afgekapt: het model had geen uitvoertokens meer. Verhoog {variable} of probeer het opnieuw.',
    notConfigured:
      'De AI-provider is niet goed ingesteld. Controleer {variable} in je .env en start opnieuw.',
    unknown:
      'Het AI-verzoek is mislukt. Probeer het opnieuw; als het blijft mislukken, bekijk dan het serverlog.',
  },
} satisfies MessageShape<typeof english>;
