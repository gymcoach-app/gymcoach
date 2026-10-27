import { coach as english } from '../en/coach';
import type { MessageShape } from '@/i18n/message-types';

export const coach = {
  title: 'Coach',
  description: 'Resoconto settimanale del tuo allenamento con IA.',
  chatTitle: 'Chat',
  chatDescription: 'Parla con il tuo coach con i tuoi dati di allenamento come contesto.',
  conversation: 'Conversazione',
  client: {
    generating: 'Generazione in corso (10-20 s)...',
    request: 'Richiedi un resoconto settimanale',
    empty: 'Ancora nessun resoconto. Richiedi il primo qui sopra.',
    unknownError: 'Errore sconosciuto',
    tooManyDebriefs: 'Hai chiesto diversi resoconti in poco tempo. Riprova più tardi.',
    keyMissing: 'Chiave {provider} mancante',
    keySetup: 'Imposta {variable} in .env per attivare il coach.',
    applied: 'Applicato',
    debriefFrom: 'Resoconto del {date}',
    weekOf: 'Settimana del {date}',
  },
  chat: {
    apiKey: 'Imposta {variable} in .env per attivare la chat.',
    liveSession: 'Sessione in corso allegata.',
    new: 'Nuova',
    placeholder: 'Scrivi al tuo coach...',
    send: 'Invia',
    liveSessionDescription:
      'Il coach vede le serie registrate finora e gli obiettivi del programma per questo allenamento.',
    emptySession:
      'Una domanda a metà allenamento? Chiedi della prossima serie, di un carico che non ti convince o di un cambio di esercizio.',
    empty:
      'Chiedi come superare uno stallo, del volume di allenamento, della progressione, del recupero o di come adattarti a un infortunio.',
    advisory:
      'La chat dà consigli ma non può modificare i tuoi dati. Applica le modifiche tu stesso nella pagina Programmi o dal resoconto settimanale.',
  },
  context: {
    title: 'Cosa vede il tuo coach',
    teaser: 'Il contesto di allenamento dietro ogni resoconto. Tocca per espandere.',
    history: 'Storico allenamenti',
    goals: 'Obiettivi',
    achieved: 'raggiunto',
    noGoals: 'Nessun obiettivo per gli esercizi.',
    fatigue: 'Fatica',
    conditioning: 'Cardio',
    readiness: 'Stato di forma',
    historySummary:
      '{weeks, plural, one {# settimana} other {# settimane}} di storico recente su {exercises, plural, one {# esercizio} other {# esercizi}}.',
    noHistory:
      'Ancora nessuna sessione registrata: il coach inizia a imparare dal tuo primo allenamento.',
    goalProgress: '({percent}% dell’obiettivo)',
    stalled: 'Esercizi in stallo: {names}.',
    noStalled: 'Nessun esercizio in stallo rilevato.',
    deloadActive: 'È in corso una settimana di scarico pianificata.',
    deloadRecommended: 'Scarico consigliato{reasons, select, none {.} other {: {reasons}.}}',
    noDeload: 'Nessuno scarico consigliato.',
    conditioningSummary:
      'Questa settimana: {minutes} min{km, select, none {} other { · {km} km}} · {sessions, plural, one {# sessione} other {# sessioni}} (obiettivo {target} min/settimana)',
    today: 'oggi',
    daysAgo: '{days, plural, one {# giorno fa} other {# giorni fa}}',
    readinessSummary: 'Ultimo check-in {when}: stato di forma {readiness}/5, sonno {sleep}/5.',
    noReadiness: 'Nessun check-in sullo stato di forma negli ultimi 7 giorni.',
    privacy:
      'L’IA riceve un riepilogo compatto come questo, più i tuoi registri recenti serie per serie: mai i dati del tuo account né nulla al di fuori del tuo storico di allenamento.',
  },
  note: {
    title: 'Nota per il tuo coach',
    description:
      'Aggiungi il contesto che i dati di allenamento non mostrano, come un infortunio, una malattia o un viaggio.',
    placeholder: 'Es. La spalla mi dà fastidio, questa settimana vacci piano con gli esercizi di spinta.',
    clear: 'Cancella',
    save: 'Salva',
    saved: 'Nota salvata.',
    cleared: 'Nota cancellata.',
    error: 'Impossibile salvare la nota.',
  },
  adjustments: {
    title: 'Modifiche suggerite',
    applied: 'Già applicato',
    description:
      'Scegli cosa applicare al programma attivo. Puoi modificare i valori prima di confermare.',
    aria: 'Applica la modifica a {exercise}',
    repsMin: 'Rip. min',
    repsMax: 'Rip. max',
    sets: 'Serie',
    rest: 'Recupero (s)',
    targetLoad: 'Carico obiettivo',
    versus: ' (prima {value})',
    applying: 'Applicazione...',
    apply: 'Applica {count, plural, one {# modifica} other {# modifiche}}',
  },
} satisfies MessageShape<typeof english>;
