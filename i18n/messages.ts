import type { Locale } from './config';
import type englishMessages from '@/messages/en';

type AppMessages = typeof englishMessages;

const loaders = {
  en: () => import('@/messages/en').then((module) => module.default),
  fr: () => import('@/messages/fr').then((module) => module.default),
  ru: () => import('@/messages/ru').then((module) => module.default),
  de: () => import('@/messages/de').then((module) => module.default),
  es: () => import('@/messages/es').then((module) => module.default),
  pt: () => import('@/messages/pt').then((module) => module.default),
  it: () => import('@/messages/it').then((module) => module.default),
  'zh-CN': () => import('@/messages/zh-CN').then((module) => module.default),
} satisfies Record<Locale, () => Promise<AppMessages>>;

export async function loadMessages(locale: Locale): Promise<AppMessages> {
  return loaders[locale]();
}
