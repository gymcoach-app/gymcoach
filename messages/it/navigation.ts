import { navigation as english } from '../en/navigation';
import type { MessageShape } from '@/i18n/message-types';

export const navigation = {
  home: 'Home',
  history: 'Storico',
  progress: 'Progressi',
  coach: 'Coach',
  chat: 'Chat',
  programs: 'Programmi',
  catalog: 'Catalogo',
  settings: 'Impostazioni',
} satisfies MessageShape<typeof english>;
