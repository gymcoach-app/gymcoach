import { coach as english } from '../en/coach';
import type { MessageShape } from '@/i18n/message-types';

export const coach = {
  title: 'Coach',
  description: 'Wöchentliche AI-Auswertung deines Trainings.',
  chatTitle: 'Chat',
  chatDescription: 'Sprich mit deinem Coach, mit deinen Trainingsdaten im Kontext.',
  conversation: 'Unterhaltung',
  client: {
    generating: 'Generiert (10-20s)...',
    request: 'Wöchentliche Auswertung anfordern',
    empty: 'Noch keine Auswertung. Starte die erste oben.',
    unknownError: 'Unbekannter Fehler',
    tooManyDebriefs: 'Du hast in kurzer Zeit mehrere Auswertungen angefordert. Versuche es später noch einmal.',
    keyMissing: '{provider}-Schlüssel fehlt',
    keySetup: 'Setze {variable} in .env, um den Coach zu aktivieren.',
    applied: 'Angewendet',
    debriefFrom: 'Auswertung vom {date}',
    weekOf: 'Woche vom {date}',
  },
  chat: {
    apiKey: 'Setze {variable} in .env, um den Chat zu aktivieren.',
    liveSession: 'Live-Einheit angehängt.',
    new: 'Neu',
    placeholder: 'Nachricht an deinen Coach...',
    send: 'Senden',
    liveSessionDescription:
      'Der Coach sieht die bisher geloggten Sätze und die Programmziele für dieses Workout.',
    emptySession:
      'Frage mitten im Workout? Frag nach deinem nächsten Satz, einem Gewicht das sich komisch anfühlt oder einem Übungstausch.',
    empty:
      'Frag nach dem Durchbrechen eines Plateaus, Trainingsvolumen, Progression, Regeneration oder Anpassungen bei Verletzungen.',
    advisory:
      'Der Chat berät, kann aber deine Daten nicht bearbeiten. Wende Änderungen selbst auf der Programme-Seite an oder über die wöchentliche Auswertung.',
  },
  context: {
    title: 'Was dein Coach sieht',
    teaser: 'Der Trainingskontext hinter jeder Auswertung. Tippen zum Ausklappen.',
    history: 'Trainingsverlauf',
    goals: 'Ziele',
    achieved: 'erreicht',
    noGoals: 'Keine Übungsziele gesetzt.',
    fatigue: 'Ermüdung',
    conditioning: 'Kondition',
    readiness: 'Bereitschaft',
    historySummary:
      '{weeks, plural, one {# Woche} other {# Wochen}} aktuelle Historie über {exercises, plural, one {# Übung} other {# Übungen}}.',
    noHistory: 'Noch keine geloggten Einheiten - der Coach lernt ab deinem ersten Workout.',
    goalProgress: '({percent}% erreicht)',
    stalled: 'Stagnierende Übungen: {names}.',
    noStalled: 'Keine stagnierenden Übungen erkannt.',
    deloadActive: 'Eine geplante Deload-Woche ist aktiv.',
    deloadRecommended: 'Deload empfohlen{reasons, select, none {.} other {: {reasons}.}}',
    noDeload: 'Kein Deload empfohlen.',
    conditioningSummary:
      'Diese Woche: {minutes} min{km, select, none {} other { · {km} km}} · {sessions, plural, one {# Einheit} other {# Einheiten}} (Ziel {target} min/Woche)',
    today: 'heute',
    daysAgo: '{days, plural, one {vor # Tag} other {vor # Tagen}}',
    readinessSummary: 'Letzter Check-in {when}: Bereitschaft {readiness}/5, Schlaf {sleep}/5.',
    noReadiness: 'Kein Bereitschafts-Check-in in den letzten 7 Tagen.',
    privacy:
      'Eine kompakte Zusammenfassung wie diese, plus deine aktuellen Satz-für-Satz-Trainingslogs, ist das was die AI erhält - niemals deine Account-Daten oder irgendetwas außerhalb deiner Trainingshistorie.',
  },
  note: {
    title: 'Notiz an deinen Coach',
    description:
      'Füge Kontext hinzu, den die Trainingsdaten nicht zeigen, wie eine Verletzung, Krankheit oder Reise.',
    placeholder: 'z.B. Schulter macht Probleme, geh diese Woche leicht mit Druckübungen um.',
    clear: 'Löschen',
    save: 'Speichern',
    saved: 'Notiz gespeichert.',
    cleared: 'Notiz gelöscht.',
    error: 'Notiz konnte nicht gespeichert werden.',
  },
  adjustments: {
    title: 'Vorgeschlagene Anpassungen',
    applied: 'Bereits angewendet',
    description:
      'Wähle aus, was du auf das aktive Programm anwenden möchtest. Du kannst Werte vor der Bestätigung bearbeiten.',
    aria: 'Anpassung für {exercise} anwenden',
    repsMin: 'Wdh. min',
    repsMax: 'Wdh. max',
    sets: 'Sätze',
    rest: 'Pause (s)',
    targetLoad: 'Zielgewicht',
    versus: ' (vs {value})',
    applying: 'Wird angewendet...',
    apply: '{count, plural, one {# Anpassung} other {# Anpassungen}} anwenden',
  },
} satisfies MessageShape<typeof english>;
