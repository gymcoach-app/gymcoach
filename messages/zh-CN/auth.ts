import { auth as english } from '../en/auth';
import type { MessageShape } from '@/i18n/message-types';

export const auth = {
  login: {
    title: '登录',
    description: '查看和管理你的训练记录。',
    submit: '登录',
    submitting: '正在登录...',
    demoTitle: '演示账户',
    demoSubmit: '使用演示账户登录',
    noAccount: '还没有账户？',
    createAccount: '立即注册',
    error: '登录失败。',
  },
  signup: {
    title: '创建账户',
    description: '开始记录你的训练。',
    submit: '创建账户',
    submitting: '正在创建账户...',
    hasAccount: '已有账户？',
    signIn: '登录',
    error: '注册失败。',
  },
  logout: '退出登录',
  logoutFailed: '退出登录失败。你目前仍处于登录状态，请重试。',
  validation: {
    invalidEmail: '邮箱格式不正确',
    nameRequired: '请输入姓名',
    passwordRequired: '请输入密码',
    passwordMin: '密码至少需要 8 个字符',
  },
} satisfies MessageShape<typeof english>;
