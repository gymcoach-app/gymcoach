import { coach as english } from '../en/coach';
import type { MessageShape } from '@/i18n/message-types';

export const coach = {
  title: 'Coach',
  description: 'Wekelijkse AI-terugblik op je training.',
  chatTitle: 'Chat',
  chatDescription: 'Praat met je coach, met je trainingsgegevens erbij.',
  conversation: 'Gesprek',
  client: {
    generating: 'Bezig met genereren (10-20 s)...',
    request: 'Vraag een weekterugblik aan',
    empty: 'Nog geen terugblik. Vraag hierboven je eerste aan.',
    unknownError: 'Onbekende fout',
    tooManyDebriefs: 'Je hebt te veel terugblikken aangevraagd. Probeer het later opnieuw.',
    keyMissing: '{provider}-sleutel ontbreekt',
    keySetup: 'Stel {variable} in .env in om de coach te gebruiken.',
    applied: 'Toegepast',
    debriefFrom: 'Terugblik van {date}',
    weekOf: 'Week van {date}',
  },
  chat: {
    apiKey: 'Stel {variable} in .env in om de chat te gebruiken.',
    liveSession: 'Live sessie gekoppeld.',
    new: 'Nieuw',
    placeholder: 'Bericht aan je coach...',
    send: 'Versturen',
    liveSessionDescription:
      'De coach ziet de sets die je tot nu toe hebt gelogd en de doelen van het programma voor deze training.',
    emptySession:
      'Vraag tijdens je training? Vraag naar je volgende set, een gewicht dat niet goed voelt of een andere oefening.',
    empty:
      'Vraag naar het doorbreken van een plateau, trainingsvolume, progressie, herstel of aanpassingen bij een blessure.',
    advisory:
      "De chat geeft advies maar kan je gegevens niet wijzigen. Pas wijzigingen zelf toe op de pagina Programma's of via de weekterugblik.",
  },
  context: {
    title: 'Wat je coach ziet',
    teaser: 'De trainingscontext achter elke terugblik. Tik om uit te klappen.',
    history: 'Trainingsgeschiedenis',
    goals: 'Doelen',
    achieved: 'behaald',
    noGoals: 'Geen doelen per oefening ingesteld.',
    fatigue: 'Vermoeidheid',
    conditioning: 'Conditie',
    readiness: 'Gereedheid',
    historySummary:
      '{weeks, plural, one {# week} other {# weken}} recente geschiedenis over {exercises, plural, one {# oefening} other {# oefeningen}}.',
    noHistory: 'Nog geen gelogde sessies - de coach leert vanaf je eerste training.',
    goalProgress: '({percent}% behaald)',
    stalled: 'Stilstaande oefeningen: {names}.',
    noStalled: 'Geen stilstaande oefeningen gevonden.',
    deloadActive: 'Er loopt een geplande deloadweek.',
    deloadRecommended: 'Deload aanbevolen{reasons, select, none {.} other {: {reasons}.}}',
    noDeload: 'Geen deload aanbevolen.',
    conditioningSummary:
      'Deze week: {minutes} min{km, select, none {} other { · {km} km}} · {sessions, plural, one {# sessie} other {# sessies}} (doel {target} min/week)',
    today: 'vandaag',
    daysAgo: '{days, plural, one {# dag geleden} other {# dagen geleden}}',
    readinessSummary: 'Laatste check-in {when}: gereedheid {readiness}/5, slaap {sleep}/5.',
    noReadiness: 'Geen gereedheidscheck-in in de afgelopen 7 dagen.',
    privacy:
      'Een korte samenvatting zoals deze, plus je recente trainingslogs per set, is wat de AI krijgt - nooit je accountgegevens of iets buiten je trainingsgeschiedenis.',
  },
  note: {
    title: 'Notitie voor je coach',
    description:
      'Voeg context toe die niet in je trainingsgegevens staat, zoals een blessure, ziekte of reis.',
    placeholder: 'bv. Mijn schouder speelt op, doe deze week rustig aan met drukoefeningen.',
    clear: 'Wissen',
    save: 'Opslaan',
    saved: 'Notitie opgeslagen.',
    cleared: 'Notitie gewist.',
    error: 'Kon je notitie niet opslaan.',
  },
  adjustments: {
    title: 'Voorgestelde aanpassingen',
    applied: 'Al toegepast',
    description:
      'Kies wat je wilt toepassen op het actieve programma. Je kunt de waarden aanpassen voordat je bevestigt.',
    aria: 'De aanpassing toepassen op {exercise}',
    repsMin: 'Min. herhalingen',
    repsMax: 'Max. herhalingen',
    sets: 'Sets',
    rest: 'Rust (s)',
    targetLoad: 'Doelgewicht',
    versus: ' (was {value})',
    applying: 'Toepassen...',
    apply: '{count, plural, one {# aanpassing toepassen} other {# aanpassingen toepassen}}',
  },
} satisfies MessageShape<typeof english>;
