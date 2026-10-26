import { navigation as english } from '../en/navigation';
import type { MessageShape } from '@/i18n/message-types';

export const navigation = {
  home: 'Início',
  history: 'Histórico',
  progress: 'Progresso',
  coach: 'Coach',
  chat: 'Chat',
  programs: 'Programas',
  catalog: 'Catálogo',
  settings: 'Configurações',
} satisfies MessageShape<typeof english>;
