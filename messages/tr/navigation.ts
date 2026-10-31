import { navigation as english } from '../en/navigation';
import type { MessageShape } from '@/i18n/message-types';

export const navigation = {
  home: 'Ana sayfa',
  history: 'Geçmiş',
  progress: 'İlerleme',
  coach: 'Koç',
  chat: 'Sohbet',
  programs: 'Programlar',
  catalog: 'Katalog',
  settings: 'Ayarlar',
} satisfies MessageShape<typeof english>;
