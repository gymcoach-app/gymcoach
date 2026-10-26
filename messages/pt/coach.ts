import { coach as english } from '../en/coach';
import type { MessageShape } from '@/i18n/message-types';

export const coach = {
  title: 'Coach',
  description: 'Resumo semanal do seu treino feito por IA.',
  chatTitle: 'Chat',
  chatDescription: 'Converse com seu coach tendo seus dados de treino como contexto.',
  conversation: 'Conversa',
  client: {
    generating: 'Gerando (10-20 s)...',
    request: 'Pedir um resumo semanal',
    empty: 'Ainda não há nenhum resumo. Peça o primeiro acima.',
    unknownError: 'Erro desconhecido',
    keyMissing: 'Chave de {provider} ausente',
    keySetup: 'Defina {variable} no .env para ativar o coach.',
    applied: 'Aplicado',
    debriefFrom: 'Resumo de {date}',
    weekOf: 'Semana de {date}',
  },
  chat: {
    apiKey: 'Defina {variable} no .env para ativar o chat.',
    liveSession: 'Sessão em andamento anexada.',
    new: 'Nova',
    placeholder: 'Mande uma mensagem para o seu coach...',
    send: 'Enviar',
    liveSessionDescription:
      'O coach vê as séries registradas até agora e as metas do programa para este treino.',
    emptySession:
      'Dúvida no meio do treino? Pergunte sobre a próxima série, uma carga que parece estranha ou a troca de um exercício.',
    empty:
      'Pergunte como sair de um platô, sobre volume de treino, progressão, recuperação ou como adaptar o treino a uma lesão.',
    advisory:
      'O chat dá conselhos, mas não pode editar seus dados. Aplique as mudanças você mesmo na página de programas ou a partir do resumo semanal.',
  },
  context: {
    title: 'O que o seu coach vê',
    teaser: 'O contexto de treino por trás de cada resumo. Toque para expandir.',
    history: 'Histórico de treino',
    goals: 'Metas',
    achieved: 'atingida',
    noGoals: 'Nenhuma meta de exercício definida.',
    fatigue: 'Fadiga',
    conditioning: 'Cardio',
    readiness: 'Prontidão',
    historySummary:
      '{weeks, plural, one {# semana} other {# semanas}} de histórico recente com {exercises, plural, one {# exercício} other {# exercícios}}.',
    noHistory:
      'Nenhuma sessão registrada ainda: o coach começa a aprender a partir do seu primeiro treino.',
    goalProgress: '({percent}% atingido)',
    stalled: 'Exercícios estagnados: {names}.',
    noStalled: 'Nenhum exercício estagnado detectado.',
    deloadActive: 'Uma semana de deload planejada está em andamento.',
    deloadRecommended: 'Deload recomendado{reasons, select, none {.} other {: {reasons}.}}',
    noDeload: 'Nenhum deload recomendado.',
    conditioningSummary:
      'Nesta semana: {minutes} min{km, select, none {} other { · {km} km}} · {sessions, plural, one {# sessão} other {# sessões}} (meta de {target} min/semana)',
    today: 'hoje',
    daysAgo: '{days, plural, one {há # dia} other {há # dias}}',
    readinessSummary: 'Último registro {when}: prontidão {readiness}/5, sono {sleep}/5.',
    noReadiness: 'Nenhum registro de prontidão nos últimos 7 dias.',
    privacy:
      'A IA recebe um resumo compacto como este e seus registros recentes série a série; nunca os dados da sua conta nem nada fora do seu histórico de treino.',
  },
  note: {
    title: 'Nota para o seu coach',
    description:
      'Adicione o contexto que os dados de treino não mostram, como uma lesão, uma doença ou uma viagem.',
    placeholder: 'ex.: Meu ombro está incomodando, pegue leve nos empurrões esta semana.',
    clear: 'Limpar',
    save: 'Salvar',
    saved: 'Nota salva.',
    cleared: 'Nota apagada.',
    error: 'Não foi possível salvar sua nota.',
  },
  adjustments: {
    title: 'Ajustes sugeridos',
    applied: 'Já aplicado',
    description:
      'Escolha o que aplicar ao programa ativo. Você pode editar os valores antes de confirmar.',
    aria: 'Aplicar o ajuste em {exercise}',
    repsMin: 'Reps mín.',
    repsMax: 'Reps máx.',
    sets: 'Séries',
    rest: 'Descanso (s)',
    targetLoad: 'Carga alvo',
    versus: ' (antes {value})',
    applying: 'Aplicando...',
    apply: 'Aplicar {count, plural, one {# ajuste} other {# ajustes}}',
  },
} satisfies MessageShape<typeof english>;
