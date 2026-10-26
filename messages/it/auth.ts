import { auth as english } from '../en/auth';
import type { MessageShape } from '@/i18n/message-types';

export const auth = {
  login: {
    title: 'Accedi',
    description: 'Accedi al tuo diario di allenamento.',
    submit: 'Accedi',
    submitting: 'Accesso in corso...',
    demoTitle: 'Account demo',
    demoSubmit: 'Entra con la demo',
    noAccount: 'Non hai ancora un account?',
    createAccount: 'Creane uno',
    error: 'Errore di accesso.',
  },
  signup: {
    title: 'Crea account',
    description: 'Inizia a registrare i tuoi allenamenti.',
    submit: 'Crea account',
    submitting: 'Creazione account...',
    hasAccount: 'Hai già un account?',
    signIn: 'Accedi',
    error: 'Errore di registrazione.',
  },
  logout: 'Esci',
  logoutFailed: 'Impossibile uscire. La sessione è ancora aperta; riprova.',
  validation: {
    invalidEmail: 'Email non valida',
    nameRequired: 'Il nome è obbligatorio',
    passwordRequired: 'La password è obbligatoria',
    passwordMin: 'La password deve contenere almeno 8 caratteri',
  },
} satisfies MessageShape<typeof english>;
