import { common as english } from '../en/common';
import type { MessageShape } from '@/i18n/message-types';

export const common = {
  metadata: {
    description: 'Дневник силовых тренировок и персональный ИИ-тренер.',
  },
  actions: {
    add: 'Добавить',
    apply: 'Применить',
    back: 'Назад',
    cancel: 'Отмена',
    close: 'Закрыть',
    confirm: 'Подтвердить',
    continue: 'Продолжить',
    create: 'Создать',
    delete: 'Удалить',
    download: 'Скачать',
    edit: 'Изменить',
    finish: 'Завершить',
    generate: 'Сгенерировать',
    import: 'Импортировать',
    loading: 'Загрузка...',
    refresh: 'Обновить',
    remove: 'Убрать',
    resume: 'Продолжить',
    retry: 'Повторить',
    save: 'Сохранить',
    saving: 'Сохранение...',
    start: 'Начать',
    upload: 'Загрузить',
    view: 'Открыть',
  },
  fields: {
    description: 'Описание',
    email: 'Эл. почта',
    name: 'Название',
    notes: 'Заметки',
    password: 'Пароль',
  },
  states: {
    active: 'Активна',
    completed: 'Завершено',
    empty: 'пусто',
    inactive: 'Неактивна',
    no: 'Нет',
    optional: 'Необязательно',
    yes: 'Да',
  },
  counts: {
    exercises:
      '{count, plural, =0 {Нет упражнений} one {# упражнение} few {# упражнения} many {# упражнений} other {# упражнения}}',
    pending:
      '{count, plural, one {# ожидает} few {# ожидают} many {# ожидают} other {# ожидают}}',
    sessions:
      '{count, plural, =0 {Нет тренировок} one {# тренировка} few {# тренировки} many {# тренировок} other {# тренировки}}',
    sets:
      '{count, plural, =0 {Нет подходов} one {# подход} few {# подхода} many {# подходов} other {# подхода}}',
    workouts:
      '{count, plural, =0 {Нет тренировок} one {# тренировка} few {# тренировки} many {# тренировок} other {# тренировки}}',
  },
  days: {
    monday: 'Понедельник',
    tuesday: 'Вторник',
    wednesday: 'Среда',
    thursday: 'Четверг',
    friday: 'Пятница',
    saturday: 'Суббота',
    sunday: 'Воскресенье',
  },
  language: {
    label: 'Язык',
    change: 'Изменить язык',
    description: 'Выберите язык интерфейса GymCoach.',
    english: 'Английский',
    french: 'Французский',
    russian: 'Русский',
    german: 'Немецкий',
    spanish: 'Испанский',
    portuguese: 'Португальский',
    italian: 'Итальянский',
    dutch: 'Нидерландский',
    polish: 'Польский',
    turkish: 'Турецкий',
    error: 'Не удалось сменить язык.',
  },
  theme: {
    dark: 'Тёмная',
    light: 'Светлая',
    system: 'Системная',
    switchToDark: 'Включить тёмную тему',
    switchToLight: 'Включить светлую тему',
  },
  offline: {
    offline: 'Нет сети',
    syncNow: 'Синхронизировать',
    syncing: 'Синхронизация: {count}...',
    pending:
      'Нет сети · {count, plural, one {# ожидает} few {# ожидают} many {# ожидают} other {# ожидают}}',
  },
  errors: {
    generic: 'Что-то пошло не так. Попробуйте ещё раз.',
  },
} satisfies MessageShape<typeof english>;
