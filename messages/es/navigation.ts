import { navigation as english } from '../en/navigation';
import type { MessageShape } from '@/i18n/message-types';

export const navigation = {
  home: 'Inicio',
  history: 'Historial',
  progress: 'Progreso',
  coach: 'Coach',
  chat: 'Chat',
  programs: 'Programas',
  catalog: 'Catálogo',
  settings: 'Ajustes',
} satisfies MessageShape<typeof english>;
