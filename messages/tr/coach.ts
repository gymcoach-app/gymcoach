import { coach as english } from '../en/coach';
import type { MessageShape } from '@/i18n/message-types';

export const coach = {
  title: 'Koç',
  description: 'Antrenmanının haftalık yapay zekâ değerlendirmesi.',
  chatTitle: 'Sohbet',
  chatDescription: 'Antrenman verilerini bilen koçunla konuş.',
  conversation: 'Konuşma',
  client: {
    generating: 'Oluşturuluyor (10-20 sn)...',
    request: 'Haftalık değerlendirme iste',
    empty: 'Henüz değerlendirme yok. İlkini yukarıdan iste.',
    unknownError: 'Bilinmeyen hata',
    tooManyDebriefs: 'Çok fazla değerlendirme istedin. Daha sonra tekrar dene.',
    keyMissing: '{provider} anahtarı eksik',
    keySetup: 'Koçu açmak için .env dosyasında {variable} değerini ayarla.',
    applied: 'Uygulandı',
    debriefFrom: 'Değerlendirme: {date}',
    weekOf: 'Hafta: {date}',
  },
  chat: {
    apiKey: 'Sohbeti açmak için .env dosyasında {variable} değerini ayarla.',
    liveSession: 'Canlı seans bağlandı.',
    new: 'Yeni',
    placeholder: 'Koçuna mesaj yaz...',
    send: 'Gönder',
    liveSessionDescription:
      'Koç, şu ana kadar kaydedilen setleri ve bu antrenman için programdaki hedefleri görür.',
    emptySession:
      'Antrenman sırasında bir sorun mu var? Sonraki setini, ağır gelen bir ağırlığı ya da hareket değişikliğini sor.',
    empty:
      'Platoyu kırmak, antrenman hacmi, ilerleme, toparlanma ya da sakatlığa göre uyarlamalar hakkında sor.',
    advisory:
      'Sohbet tavsiye verir ama verilerini değiştiremez. Değişiklikleri Programlar sayfasında ya da haftalık değerlendirmeden kendin uygula.',
  },
  context: {
    title: 'Koçunun gördükleri',
    teaser: 'Her değerlendirmenin arkasındaki antrenman bağlamı. Açmak için dokun.',
    history: 'Antrenman geçmişi',
    goals: 'Hedefler',
    achieved: 'ulaşıldı',
    noGoals: 'Hareket hedefi belirlenmedi.',
    fatigue: 'Yorgunluk',
    conditioning: 'Kondisyon',
    readiness: 'Hazırlık',
    historySummary:
      'Son {weeks, plural, one {# hafta} other {# hafta}}, {exercises, plural, one {# egzersiz} other {# egzersiz}}.',
    noHistory: 'Henüz kayıtlı seans yok - koç ilk antrenmanından itibaren öğrenmeye başlar.',
    goalProgress: '(%{percent} tamam)',
    stalled: 'Yerinde sayan hareketler: {names}.',
    noStalled: 'Yerinde sayan hareket yok.',
    deloadActive: 'Planlı bir deload haftası devam ediyor.',
    deloadRecommended: 'Deload öneriliyor{reasons, select, none {.} other {: {reasons}.}}',
    noDeload: 'Deload önerilmiyor.',
    conditioningSummary:
      'Bu hafta: {minutes} dk{km, select, none {} other { · {km} km}} · {sessions, plural, one {# seans} other {# seans}} (hedef {target} dk/hafta)',
    today: 'bugün',
    daysAgo: '{days, plural, one {# gün önce} other {# gün önce}}',
    readinessSummary: 'Son check-in {when}: hazırlık {readiness}/5, uyku {sleep}/5.',
    noReadiness: "Son 7 günde hazırlık check-in'i yok.",
    privacy:
      'Yapay zekâya yalnızca bunun gibi kısa bir özet ve set set son antrenman kayıtların gider. Hesap verilerin asla gönderilmez; antrenman geçmişin dışındaki hiçbir şey de gönderilmez.',
  },
  note: {
    title: 'Koçuna not',
    description:
      'Antrenman verilerinde görünmeyen bir bilgi ekle: sakatlık, hastalık ya da seyahat gibi.',
    placeholder: 'örn. Omzum ağrıyor, bu hafta itiş hareketlerinde hafif git.',
    clear: 'Temizle',
    save: 'Kaydet',
    saved: 'Not kaydedildi.',
    cleared: 'Not temizlendi.',
    error: 'Not kaydedilemedi.',
  },
  adjustments: {
    title: 'Önerilen değişiklikler',
    applied: 'Zaten uygulandı',
    description:
      'Aktif programa neyi uygulayacağını seç. Onaylamadan önce değerleri düzenleyebilirsin.',
    aria: 'Değişikliği uygula: {exercise}',
    repsMin: 'Min. tekrar',
    repsMax: 'Maks. tekrar',
    sets: 'Set',
    rest: 'Dinlenme (sn)',
    targetLoad: 'Hedef ağırlık',
    versus: ' (önceki: {value})',
    applying: 'Uygulanıyor...',
    apply: '{count, plural, one {# değişikliği uygula} other {# değişikliği uygula}}',
  },
} satisfies MessageShape<typeof english>;
