import { auth as english } from '../en/auth';
import type { MessageShape } from '@/i18n/message-types';

export const auth = {
  login: {
    title: 'Zaloguj się',
    description: 'Otwórz swój dziennik treningowy.',
    submit: 'Zaloguj się',
    submitting: 'Logowanie...',
    demoTitle: 'Konto demo',
    demoSubmit: 'Zaloguj się jako demo',
    noAccount: 'Nie masz jeszcze konta?',
    createAccount: 'Załóż je',
    error: 'Błąd logowania.',
  },
  signup: {
    title: 'Załóż konto',
    description: 'Zacznij zapisywać swoje treningi.',
    submit: 'Załóż konto',
    submitting: 'Zakładanie konta...',
    hasAccount: 'Masz już konto?',
    signIn: 'Zaloguj się',
    error: 'Błąd rejestracji.',
  },
  logout: 'Wyloguj się',
  logoutFailed: 'Nie udało się wylogować. Sesja jest nadal aktywna; spróbuj ponownie.',
  validation: {
    invalidEmail: 'Nieprawidłowy adres e-mail',
    nameRequired: 'Imię jest wymagane',
    passwordRequired: 'Hasło jest wymagane',
    passwordMin: 'Hasło musi mieć co najmniej 8 znaków',
  },
} satisfies MessageShape<typeof english>;
