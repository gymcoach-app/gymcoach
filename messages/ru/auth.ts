import { auth as english } from '../en/auth';
import type { MessageShape } from '@/i18n/message-types';

export const auth = {
  login: {
    title: 'Вход',
    description: 'Откройте свой дневник тренировок.',
    submit: 'Войти',
    submitting: 'Вход...',
    demoTitle: 'Демо-аккаунт',
    demoSubmit: 'Войти в демо',
    noAccount: 'Ещё нет аккаунта?',
    createAccount: 'Создать',
    error: 'Не удалось войти.',
  },
  signup: {
    title: 'Создание аккаунта',
    description: 'Начните вести дневник тренировок.',
    submit: 'Создать аккаунт',
    submitting: 'Создание аккаунта...',
    hasAccount: 'Уже есть аккаунт?',
    signIn: 'Войти',
    error: 'Не удалось зарегистрироваться.',
  },
  logout: 'Выйти',
  logoutFailed: 'Не удалось выйти. Вы всё ещё в системе; повторите попытку, когда будете онлайн.',
  validation: {
    invalidEmail: 'Введите корректный адрес эл. почты',
    nameRequired: 'Введите имя',
    passwordRequired: 'Введите пароль',
    passwordMin: 'Пароль должен содержать не менее 8 символов',
  },
} satisfies MessageShape<typeof english>;
