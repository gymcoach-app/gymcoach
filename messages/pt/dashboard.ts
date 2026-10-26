import { dashboard as english } from '../en/dashboard';
import type { MessageShape } from '@/i18n/message-types';

export const dashboard = {
  activeSession: 'Sessão ativa',
  sessionFallback: 'Sessão',
  startedOn: '{name} começou em {date}',
  resumeSession: 'Retomar sessão',
  noActiveProgram: 'Nenhum programa ativo',
  noActiveProgramDescription: 'Ative um programa para começar uma sessão.',
  viewPrograms: 'Ver programas',
  emptyProgram: 'Programa vazio',
  emptyProgramDescription: '{name} não tem nenhuma sessão configurada.',
  configureProgram: 'Configurar programa',
  startSession: 'Começar uma sessão',
  activeProgram: 'Programa ativo: {name}',
  chooseSession: 'Escolha uma sessão',
  programSessions: 'Sessões do programa',
  insight: {
    deloadTitle: 'Talvez seja hora de recuperar',
    stalledTitle: '{count, plural, one {Um exercício estagnou} other {# exercícios estagnaram}}',
    stalledDetail:
      '{count, plural, one {{names} não progrediu nos últimos treinos. Uma pequena mudança na carga, nas repetições ou na técnica pode destravar o progresso.} other {{names} não progrediram nos últimos treinos. Veja a página de progresso para saber o que ajustar.}}',
    prTitle: 'Novo recorde pessoal',
    prWeightDetail: 'Na sua última sessão você fez sua série mais pesada em {name}. Mandou bem!',
    prOneRmDetail: 'Na sua última sessão você bateu seu melhor 1RM estimado em {name}. Mandou bem!',
    consistentTitle: 'Você está treinando com constância',
    consistentDetail:
      'Você treinou {count, plural, one {# dia} other {# dias}} nesta semana. Continue assim.',
    deloadStalledReason:
      '{count, plural, one {# exercício estagnou: {names}.} other {# exercícios estagnaram: {names}.}}',
    deloadReadinessReason:
      'Sua prontidão ficou em média {average}/5 {checkins, plural, one {no último registro} other {nos últimos # registros}}.',
  },
} satisfies MessageShape<typeof english>;
