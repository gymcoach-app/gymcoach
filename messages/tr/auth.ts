import { auth as english } from '../en/auth';
import type { MessageShape } from '@/i18n/message-types';

export const auth = {
  login: {
    title: 'Giriş yap',
    description: 'Antrenman günlüğünü aç.',
    submit: 'Giriş yap',
    submitting: 'Giriş yapılıyor...',
    demoTitle: 'Demo hesabı',
    demoSubmit: 'Demo olarak giriş yap',
    noAccount: 'Henüz hesabın yok mu?',
    createAccount: 'Hesap oluştur',
    error: 'Giriş hatası.',
  },
  signup: {
    title: 'Hesap oluştur',
    description: 'Antrenmanlarını kaydetmeye başla.',
    submit: 'Hesap oluştur',
    submitting: 'Hesap oluşturuluyor...',
    hasAccount: 'Zaten hesabın var mı?',
    signIn: 'Giriş yap',
    error: 'Kayıt hatası.',
  },
  logout: 'Çıkış yap',
  logoutFailed: 'Çıkış yapılamadı. Oturumun hâlâ açık; tekrar dene.',
  validation: {
    invalidEmail: 'Geçersiz e-posta',
    nameRequired: 'Ad gerekli',
    passwordRequired: 'Şifre gerekli',
    passwordMin: 'Şifre en az 8 karakter olmalı',
  },
} satisfies MessageShape<typeof english>;
