import { dashboard as english } from '../en/dashboard';
import type { MessageShape } from '@/i18n/message-types';

export const dashboard = {
  activeSession: 'Aktif seans',
  sessionFallback: 'Seans',
  startedOn: '{name} · başlangıç: {date}',
  resumeSession: 'Seansa devam et',
  noActiveProgram: 'Aktif program yok',
  noActiveProgramDescription: 'Seans başlatmak için bir program etkinleştir.',
  viewPrograms: 'Programları gör',
  emptyProgram: 'Boş program',
  emptyProgramDescription: 'Bu programda henüz seans yok: {name}.',
  configureProgram: 'Programı ayarla',
  startSession: 'Seans başlat',
  activeProgram: 'Aktif program: {name}',
  chooseSession: 'Bir seans seç',
  programSessions: 'Programdaki seanslar',
  insight: {
    deloadTitle: 'Toparlanma zamanı gelmiş olabilir',
    stalledTitle:
      '{count, plural, one {Bir hareket yerinde sayıyor} other {# hareket yerinde sayıyor}}',
    stalledDetail:
      '{count, plural, one {Son zamanlarda ilerleme yok: {names}. Ağırlıkta, tekrarda ya da teknikte küçük bir değişiklik tekrar ilerletebilir.} other {Son zamanlarda ilerleme yok: {names}. Neyi değiştireceğini görmek için ilerleme sayfasına bak.}}',
    prTitle: 'Yeni kişisel rekor',
    prWeightDetail: 'Son seansında {name} hareketinde en ağır setini yaptın. Harika iş.',
    prOneRmDetail:
      'Son seansında {name} hareketinde yeni en iyi tahmini 1RM değerine ulaştın. Harika iş.',
    consistentTitle: 'Düzenli antrenman yapıyorsun',
    consistentDetail:
      'Bu hafta {count, plural, one {# gün} other {# gün}} antrenman yaptın. Böyle devam.',
    deloadStalledReason:
      '{count, plural, one {# hareket yerinde sayıyor: {names}.} other {# hareket yerinde sayıyor: {names}.}}',
    deloadReadinessReason:
      'Son {checkins, plural, one {# check-in} other {# check-in}} boyunca hazırlık ortalaman {average}/5.',
  },
} satisfies MessageShape<typeof english>;
