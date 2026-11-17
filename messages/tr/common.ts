import { common as english } from '../en/common';
import type { MessageShape } from '@/i18n/message-types';

export const common = {
  metadata: {
    description: 'Kuvvet antrenmanı günlüğü ve kişisel yapay zekâ koçu.',
  },
  actions: {
    add: 'Ekle',
    apply: 'Uygula',
    back: 'Geri',
    cancel: 'İptal',
    close: 'Kapat',
    confirm: 'Onayla',
    continue: 'Devam',
    create: 'Oluştur',
    delete: 'Sil',
    download: 'İndir',
    edit: 'Düzenle',
    finish: 'Bitir',
    generate: 'Oluştur',
    import: 'İçe aktar',
    loading: 'Yükleniyor...',
    refresh: 'Yenile',
    remove: 'Kaldır',
    resume: 'Devam et',
    retry: 'Tekrar dene',
    save: 'Kaydet',
    saving: 'Kaydediliyor...',
    start: 'Başlat',
    upload: 'Yükle',
    view: 'Görüntüle',
  },
  fields: {
    description: 'Açıklama',
    email: 'E-posta',
    name: 'Ad',
    notes: 'Notlar',
    password: 'Şifre',
  },
  states: {
    active: 'Aktif',
    completed: 'Tamamlandı',
    empty: 'boş',
    inactive: 'Pasif',
    no: 'Hayır',
    optional: 'İsteğe bağlı',
    yes: 'Evet',
  },
  counts: {
    exercises: '{count, plural, =0 {Egzersiz yok} one {# egzersiz} other {# egzersiz}}',
    pending: '{count, plural, one {# bekliyor} other {# bekliyor}}',
    sessions: '{count, plural, =0 {Seans yok} one {# seans} other {# seans}}',
    sets: '{count, plural, =0 {Set yok} one {# set} other {# set}}',
    workouts: '{count, plural, =0 {Antrenman yok} one {# antrenman} other {# antrenman}}',
  },
  days: {
    monday: 'Pazartesi',
    tuesday: 'Salı',
    wednesday: 'Çarşamba',
    thursday: 'Perşembe',
    friday: 'Cuma',
    saturday: 'Cumartesi',
    sunday: 'Pazar',
  },
  language: {
    label: 'Dil',
    change: 'Dili değiştir',
    description: 'GymCoach arayüzünün dilini seç.',
    english: 'İngilizce',
    french: 'Fransızca',
    russian: 'Rusça',
    german: 'Almanca',
    spanish: 'İspanyolca',
    portuguese: 'Portekizce',
    italian: 'İtalyanca',
    dutch: 'Felemenkçe',
    polish: 'Lehçe',
    turkish: 'Türkçe',
    error: 'Dil değiştirilemedi.',

    chinese: 'Basitleştirilmiş Çince',
  },
  theme: {
    dark: 'Koyu',
    light: 'Açık',
    system: 'Sistem',
    switchToDark: 'Koyu moda geç',
    switchToLight: 'Açık moda geç',
  },
  offline: {
    offline: 'Çevrimdışı',
    syncNow: 'Şimdi eşitle',
    syncing: 'Eşitleniyor ({count})...',
    pending: 'Çevrimdışı · {count, plural, one {# bekliyor} other {# bekliyor}}',
  },
  errors: {
    generic: 'Bir şeyler ters gitti. Lütfen tekrar dene.',
  },
  // A failed AI provider call, by class (issue #571). {variable} is the name
  // of an environment variable, never its value.
  aiErrors: {
    invalidKey:
      'Yapay zeka sağlayıcısı API anahtarını reddetti. .env dosyandaki {variable} değerini kontrol et ve yeniden başlat.',
    quota:
      'Yapay zeka sağlayıcısı isteği reddetti: istek sınırına ulaşıldı veya kredi bitti. Biraz bekleyip tekrar dene ya da sağlayıcı hesabındaki krediyi kontrol et.',
    model:
      'Yapay zeka modeli isteği reddetti veya kullanılamayan bir yanıt döndürdü. {variable} içindeki model adını kontrol et ya da başka bir model seç.',
    outage: 'Yapay zeka sağlayıcısı şu anda kullanılamıyor. Daha sonra tekrar dene.',
    timeout: 'Yapay zeka sağlayıcısı zamanında yanıt vermedi veya ona ulaşılamadı. Tekrar dene.',
    truncated:
      'Yapay zeka yanıtı yarıda kesildi: modelin çıktı tokenleri tükendi. {variable} değerini artır veya tekrar dene.',
    notConfigured:
      'Yapay zeka sağlayıcısı doğru yapılandırılmamış. .env dosyandaki {variable} değerini kontrol et ve yeniden başlat.',
    unknown: 'Yapay zeka isteği başarısız oldu. Tekrar dene; hata sürerse sunucu günlüğüne bak.',
  },
} satisfies MessageShape<typeof english>;
