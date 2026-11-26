import { common as english } from '../en/common';
import type { MessageShape } from '@/i18n/message-types';

export const common = {
  metadata: {
    description: 'Krafttrainings-Tracker und persönlicher AI-Coach.',
  },
  actions: {
    add: 'Hinzufügen',
    apply: 'Anwenden',
    back: 'Zurück',
    cancel: 'Abbrechen',
    close: 'Schließen',
    confirm: 'Bestätigen',
    continue: 'Weiter',
    create: 'Erstellen',
    delete: 'Löschen',
    download: 'Herunterladen',
    edit: 'Bearbeiten',
    finish: 'Beenden',
    generate: 'Generieren',
    import: 'Importieren',
    loading: 'Lädt...',
    refresh: 'Aktualisieren',
    remove: 'Entfernen',
    resume: 'Fortsetzen',
    retry: 'Wiederholen',
    save: 'Speichern',
    saving: 'Speichert...',
    start: 'Starten',
    upload: 'Hochladen',
    view: 'Ansehen',
  },
  fields: {
    description: 'Beschreibung',
    email: 'E-Mail',
    name: 'Name',
    notes: 'Notizen',
    password: 'Passwort',
  },
  states: {
    active: 'Aktiv',
    completed: 'Abgeschlossen',
    empty: 'leer',
    inactive: 'Inaktiv',
    no: 'Nein',
    optional: 'Optional',
    yes: 'Ja',
  },
  counts: {
    exercises: '{count, plural, =0 {Keine Übungen} one {# Übung} other {# Übungen}}',
    pending: '{count, plural, one {# ausstehend} other {# ausstehend}}',
    sessions: '{count, plural, =0 {Keine Einheiten} one {# Einheit} other {# Einheiten}}',
    sets: '{count, plural, =0 {Keine Sätze} one {# Satz} other {# Sätze}}',
    workouts: '{count, plural, =0 {Keine Workouts} one {# Workout} other {# Workouts}}',
  },
  days: {
    monday: 'Montag',
    tuesday: 'Dienstag',
    wednesday: 'Mittwoch',
    thursday: 'Donnerstag',
    friday: 'Freitag',
    saturday: 'Samstag',
    sunday: 'Sonntag',
  },
  language: {
    label: 'Sprache',
    change: 'Sprache ändern',
    description: 'Wähle die Sprache für die GymCoach-Oberfläche.',
    english: 'Englisch',
    french: 'Französisch',
    russian: 'Russisch',
    german: 'Deutsch',
    spanish: 'Spanisch',
    portuguese: 'Portugiesisch',
    italian: 'Italienisch',
    dutch: 'Niederländisch',
    polish: 'Polnisch',
    turkish: 'Türkisch',
    chinese: 'Vereinfachtes Chinesisch',
    error: 'Sprache konnte nicht geändert werden.',
  },
  units: {
    bpm: '{value} bpm',
  },
  theme: {
    dark: 'Dunkel',
    light: 'Hell',
    system: 'System',
    switchToDark: 'Zum dunklen Modus wechseln',
    switchToLight: 'Zum hellen Modus wechseln',
  },
  offline: {
    offline: 'Offline',
    syncNow: 'Jetzt synchronisieren',
    syncing: 'Synchronisiere {count}...',
    pending: 'Offline · {count, plural, one {# ausstehend} other {# ausstehend}}',
  },
  errors: {
    generic: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.',
  },
  // A failed AI provider call, by class (issue #571). {variable} is the name
  // of an environment variable, never its value.
  aiErrors: {
    invalidKey:
      'Der KI-Anbieter hat den API-Schlüssel abgelehnt. Prüfe {variable} in deiner .env und starte neu.',
    quota:
      'Der KI-Anbieter hat die Anfrage abgelehnt: Ratenlimit erreicht oder Guthaben aufgebraucht. Warte kurz und versuche es erneut, oder prüfe das Guthaben deines Anbieterkontos.',
    model:
      'Das KI-Modell hat die Anfrage abgelehnt oder eine unbrauchbare Antwort geliefert. Prüfe den Modellnamen in {variable} oder wähle ein anderes Modell.',
    outage: 'Der KI-Anbieter ist gerade nicht verfügbar. Versuche es später erneut.',
    timeout:
      'Der KI-Anbieter hat nicht rechtzeitig geantwortet oder war nicht erreichbar. Versuche es erneut.',
    truncated:
      'Die KI-Antwort wurde abgeschnitten: Dem Modell sind die Ausgabe-Tokens ausgegangen. Erhöhe {variable} oder versuche es erneut.',
    notConfigured:
      'Der KI-Anbieter ist nicht richtig konfiguriert. Prüfe {variable} in deiner .env und starte neu.',
    unknown:
      'Die KI-Anfrage ist fehlgeschlagen. Versuche es erneut; wenn es weiter fehlschlägt, sieh im Serverprotokoll nach.',
  },
} satisfies MessageShape<typeof english>;
