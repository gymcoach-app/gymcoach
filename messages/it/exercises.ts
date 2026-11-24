import { exercises as english } from '../en/exercises';
import type { MessageShape } from '@/i18n/message-types';

export const exercises = {
  title: 'Catalogo esercizi',
  savedCount:
    '{count, plural, =0 {Nessun esercizio salvato.} one {# esercizio salvato.} other {# esercizi salvati.}}',
  search: 'Cerca esercizi per nome',
  emptyTitle: 'Nessun esercizio',
  emptyDescription:
    'Il catalogo è vuoto. Aggiungi il tuo primo esercizio per poterlo usare in un programma.',
  noMatchTitle: 'Nessun esercizio corrisponde',
  noMatchDescription: 'Nessun nome di esercizio corrisponde a «{query}». Prova un’altra ricerca.',
  restSeconds: 'recupero {seconds} s',
  editTitle: 'Modifica esercizio',
  addTitle: 'Aggiungi un esercizio',
  formDescription: 'Inserisci il nome, il gruppo muscolare e la categoria.',
  muscleGroup: 'Gruppo muscolare',
  category: 'Categoria',
  equipmentType: 'Tipo di attrezzatura',
  defaultRest: 'Recupero predefinito (secondi)',
  bodyweight: 'Esercizio a corpo libero',
  bodyweightDescription:
    'Per trazioni, dip e piegamenti, il tonnellaggio effettivo include il tuo peso corporeo. Inserisci solo il peso aggiunto; usa un valore negativo per l’assistenza.',
  notes: 'Note / istruzioni (facoltative)',
  created: 'Esercizio creato.',
  updated: 'Esercizio aggiornato.',
  deleted: 'Esercizio eliminato.',
  saveError: 'Impossibile salvare l’esercizio.',
  deleteError: 'Impossibile eliminare l’esercizio.',
  favorites: 'Preferiti',
  favorite: 'Aggiungi {name} ai preferiti',
  unfavorite: 'Rimuovi {name} dai preferiti',
  favoriteError: 'Impossibile aggiornare i tuoi preferiti.',
  deleteTitle: 'Eliminare questo esercizio?',
  deleteDescription:
    '{name} verrà rimosso dal catalogo. Non può essere eliminato finché è usato in un programma o nello storico di allenamento.',
  deleting: 'Eliminazione...',
  media: {
    button: 'Tecnica',
    open: 'Vedi la tecnica di {name}',
    description:
      'Le immagini di inizio e fine si alternano automaticamente. Metti in pausa per osservare una delle due posizioni.',
    start: 'Inizio',
    finish: 'Fine',
    startAlt: 'Posizione iniziale di {name}',
    finishAlt: 'Posizione finale di {name}',
    showStart: 'Mostra la posizione iniziale',
    showFinish: 'Mostra la posizione finale',
    play: 'Avvia animazione',
    pause: 'Metti in pausa l’animazione',
    similarVariant: 'Variante simile',
    equipment: 'Attrezzatura',
    equipmentDescription:
      'Attrezzatura necessaria: {equipment}. Le immagini mostrano anche come deve apparire ed essere posizionata l’attrezzatura o la macchina.',
    disclaimer:
      'Usa le immagini come riferimento visivo, non come sostituto di un allenatore. Fermati se il movimento provoca un dolore acuto.',
    source: 'Fonte: {source} · {license}',
    missing:
      'A questo esercizio personalizzato non sono ancora associate immagini locali verificate.',
    searchCommons: 'Cerca su Wikimedia Commons',
  },
  detail: {
    back: 'Torna agli esercizi',
    backToSession: 'Torna all’allenamento',
    information: 'Informazioni sull’esercizio',
    muscle: 'Gruppo muscolare principale',
    equipment: 'Attrezzatura',
    defaultRest: 'Recupero predefinito',
    seconds: 's',
    history: 'Storico allenamenti',
    openChart: 'Grafico dei progressi',
    noHistory: 'Ancora nessuna serie completata per questo esercizio.',
    openSession: 'Apri l’allenamento',
  },
  // Catalog filters (issue #402).
  filters: {
    title: 'Filtri',
    muscles: '{count, plural, =0 {Muscoli} other {Muscoli (#)}}',
    muscleListLabel: 'Filtra per gruppo muscolare',
    muscleHint: 'Tocca un muscolo sulla figura o sceglilo nell’elenco.',
    otherHint: 'Il cardio e gli esercizi non classificati sono in Altro.',
    gymOnly: 'Solo quello che ha la mia palestra',
    gymSelect: 'Palestra',
    gymRule:
      'Confrontato con l’attrezzatura salvata per {gym}. Gli esercizi con manubri e con bilanciere vengono nascosti se la palestra non ha quei pesi, così come ogni esercizio segnato come non disponibile in questa palestra. Gli esercizi a corpo libero, alle macchine, ai cavi e di cardio, e quelli senza un tipo di attrezzatura definito, restano nell’elenco.',
    gymEmpty:
      'Per {gym} non è ancora stata salvata alcuna attrezzatura, quindi gli esercizi con manubri e con bilanciere vengono nascosti, così come ogni esercizio segnato come non disponibile in questa palestra. Gli esercizi a corpo libero, alle macchine, ai cavi e di cardio, e quelli senza un tipo di attrezzatura definito, restano nell’elenco.',
    noGym:
      'Salva una palestra e la sua attrezzatura per vedere solo gli esercizi che puoi fare lì.',
    manageGyms: 'Palestre e attrezzatura',
    clear: 'Rimuovi filtri',
    noResultsTitle: 'Nessun esercizio corrisponde a questi filtri',
    noResultsDescription:
      'Niente nel catalogo corrisponde insieme alla ricerca, ai muscoli e all’attrezzatura della palestra.',
    resultCount:
      '{count, plural, =0 {Nessun esercizio mostrato.} one {# esercizio mostrato.} other {# esercizi mostrati.}}',
  },
  muscleGroups: {
    chest: 'Petto',
    backWidth: 'Dorso (ampiezza)',
    backThickness: 'Dorso (spessore)',
    shouldersFront: 'Deltoidi anteriori',
    shouldersLateral: 'Deltoidi laterali',
    shouldersRear: 'Deltoidi posteriori',
    biceps: 'Bicipiti',
    triceps: 'Tricipiti',
    forearms: 'Avambracci',
    quads: 'Quadricipiti',
    hamstrings: 'Femorali',
    glutes: 'Glutei',
    calves: 'Polpacci',
    abs: 'Addominali',
    lowerBack: 'Zona lombare',
    other: 'Altro',
  },
  categories: {
    compound: 'Multiarticolare',
    isolation: 'Isolamento',
    cardio: 'Cardio',
  },
  equipmentTypes: {
    dumbbell: 'Manubri',
    barbell: 'Bilanciere',
    machine: 'Macchina',
    cable: 'Cavi',
    bodyweight: 'Corpo libero',
    cardio: 'Attrezzi cardio',
    other: 'Altro / senza limiti',
  },
  // Compact forms for the catalog card, where the label shares a line with
  // the category and rest time at mobile width (issue #330).
  equipmentTypesShort: {
    dumbbell: 'Manubri',
    barbell: 'Bilanciere',
    machine: 'Macchina',
    cable: 'Cavi',
    bodyweight: 'Corpo libero',
    cardio: 'Cardio',
    other: 'Qualsiasi',
  },
} satisfies MessageShape<typeof english>;
