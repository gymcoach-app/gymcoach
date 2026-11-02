import { navigation as english } from '../en/navigation';
import type { MessageShape } from '@/i18n/message-types';

export const navigation = {
  home: 'Home',
  history: 'Geschiedenis',
  progress: 'Voortgang',
  coach: 'Coach',
  chat: 'Chat',
  programs: "Programma's",
  catalog: 'Catalogus',
  settings: 'Instellingen',
} satisfies MessageShape<typeof english>;
