import { common as english } from '../en/common';
import type { MessageShape } from '@/i18n/message-types';

export const common = {
  metadata: {
    description: 'Registro de treino de força e coach pessoal com IA.',
  },
  actions: {
    add: 'Adicionar',
    apply: 'Aplicar',
    back: 'Voltar',
    cancel: 'Cancelar',
    close: 'Fechar',
    confirm: 'Confirmar',
    continue: 'Continuar',
    create: 'Criar',
    delete: 'Excluir',
    download: 'Baixar',
    edit: 'Editar',
    finish: 'Concluir',
    generate: 'Gerar',
    import: 'Importar',
    loading: 'Carregando...',
    refresh: 'Atualizar',
    remove: 'Remover',
    resume: 'Retomar',
    retry: 'Tentar de novo',
    save: 'Salvar',
    saving: 'Salvando...',
    start: 'Começar',
    upload: 'Enviar',
    view: 'Ver',
  },
  fields: {
    description: 'Descrição',
    email: 'E-mail',
    name: 'Nome',
    notes: 'Notas',
    password: 'Senha',
  },
  states: {
    active: 'Ativo',
    completed: 'Concluído',
    empty: 'vazio',
    inactive: 'Inativo',
    no: 'Não',
    optional: 'Opcional',
    yes: 'Sim',
  },
  counts: {
    exercises: '{count, plural, =0 {Nenhum exercício} one {# exercício} other {# exercícios}}',
    pending: '{count, plural, one {# pendente} other {# pendentes}}',
    sessions: '{count, plural, =0 {Nenhuma sessão} one {# sessão} other {# sessões}}',
    sets: '{count, plural, =0 {Nenhuma série} one {# série} other {# séries}}',
    workouts: '{count, plural, =0 {Nenhum treino} one {# treino} other {# treinos}}',
  },
  days: {
    monday: 'Segunda-feira',
    tuesday: 'Terça-feira',
    wednesday: 'Quarta-feira',
    thursday: 'Quinta-feira',
    friday: 'Sexta-feira',
    saturday: 'Sábado',
    sunday: 'Domingo',
  },
  language: {
    label: 'Idioma',
    change: 'Mudar idioma',
    description: 'Escolha o idioma da interface do GymCoach.',
    english: 'Inglês',
    french: 'Francês',
    russian: 'Russo',
    german: 'Alemão',
    spanish: 'Espanhol',
    portuguese: 'Português',
    italian: 'Italiano',
    dutch: 'Neerlandês',
    polish: 'Polonês',
    turkish: 'Turco',
    chinese: 'Chinês simplificado',
    error: 'Não foi possível mudar o idioma.',
  },
  theme: {
    dark: 'Escuro',
    light: 'Claro',
    system: 'Sistema',
    switchToDark: 'Mudar para o modo escuro',
    switchToLight: 'Mudar para o modo claro',
  },
  offline: {
    offline: 'Offline',
    syncNow: 'Sincronizar agora',
    syncing: 'Sincronizando {count}...',
    pending: 'Offline · {count, plural, one {# pendente} other {# pendentes}}',
  },
  errors: {
    generic: 'Algo deu errado. Tente novamente.',
  },
  // A failed AI provider call, by class (issue #571). {variable} is the name
  // of an environment variable, never its value.
  aiErrors: {
    invalidKey:
      'O provedor de IA recusou a chave de API. Verifique {variable} no seu .env e reinicie.',
    quota:
      'O provedor de IA recusou a solicitação: limite de uso atingido ou créditos esgotados. Aguarde um momento e tente novamente, ou verifique os créditos da sua conta no provedor.',
    model:
      'O modelo de IA recusou a solicitação ou devolveu uma resposta que não pôde ser usada. Verifique o nome do modelo em {variable} ou escolha outro modelo.',
    outage: 'O provedor de IA está indisponível no momento. Tente novamente mais tarde.',
    timeout: 'O provedor de IA não respondeu a tempo ou não pôde ser alcançado. Tente novamente.',
    truncated:
      'A resposta da IA foi cortada: o modelo ficou sem tokens de saída. Aumente {variable} ou tente novamente.',
    notConfigured:
      'O provedor de IA não está configurado corretamente. Verifique {variable} no seu .env e reinicie.',
    unknown:
      'A solicitação à IA falhou. Tente novamente; se continuar falhando, verifique o log do servidor.',
  },
} satisfies MessageShape<typeof english>;
