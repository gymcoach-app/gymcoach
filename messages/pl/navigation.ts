import { navigation as english } from '../en/navigation';
import type { MessageShape } from '@/i18n/message-types';

export const navigation = {
  home: 'Start',
  history: 'Historia',
  progress: 'Postępy',
  coach: 'Trener',
  chat: 'Czat',
  programs: 'Programy',
  catalog: 'Katalog',
  settings: 'Ustawienia',
} satisfies MessageShape<typeof english>;
