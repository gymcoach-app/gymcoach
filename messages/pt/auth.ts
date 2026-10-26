import { auth as english } from '../en/auth';
import type { MessageShape } from '@/i18n/message-types';

export const auth = {
  login: {
    title: 'Entrar',
    description: 'Acesse seu registro de treinos.',
    submit: 'Entrar',
    submitting: 'Entrando...',
    demoTitle: 'Conta de demonstração',
    demoSubmit: 'Entrar com a demo',
    noAccount: 'Ainda não tem conta?',
    createAccount: 'Crie uma',
    error: 'Erro ao entrar.',
  },
  signup: {
    title: 'Criar conta',
    description: 'Comece a registrar seus treinos.',
    submit: 'Criar conta',
    submitting: 'Criando conta...',
    hasAccount: 'Já tem uma conta?',
    signIn: 'Entrar',
    error: 'Erro ao criar a conta.',
  },
  logout: 'Sair',
  logoutFailed: 'Não foi possível sair. Sua sessão continua aberta; tente novamente.',
  validation: {
    invalidEmail: 'E-mail inválido',
    nameRequired: 'O nome é obrigatório',
    passwordRequired: 'A senha é obrigatória',
    passwordMin: 'A senha precisa ter pelo menos 8 caracteres',
  },
} satisfies MessageShape<typeof english>;
