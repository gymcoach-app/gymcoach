import { settings as english } from '../en/settings';
import type { MessageShape } from '@/i18n/message-types';

export const settings = {
  title: 'Ayarlar',
  account: 'Hesap',
  appearance: 'Görünüm',
  session: 'Seans',
  deviceOnly: 'Bu tercihler yalnızca bu cihazda kaydedilir.',
  vibration: 'Titreşim',
  vibrationDescription: 'Set kaydedilince ve sayaç bitince.',
  timerSound: 'Sayaç sonu sesi',
  timerSoundDescription: 'Dinlenme bitince kısa bir 880 Hz bip sesi çalar.',
  restFlash: 'Dinlenme bitince ekranı yakıp söndür',
  restFlashDescription:
    'Gürültülü salonlar için dinlenme sonunda ekran yanıp söner. Hareketi azalt ayarı açıkken ekran yanıp sönmeden renk değiştirir.',
  readiness: 'Hazırlık ve kas ağrısı önerilen ağırlıklarımı değiştirebilsin',
  readinessDescription:
    "Açıkken, yakın tarihli bir hazırlık check-in'i önerilen ağırlığı sabit tutabilir ya da düşürebilir. Kapalıyken öneriler yalnızca programlanan ilerlemeyi izler.",
  plateCalculator: 'Plaka hesaplayıcı',
  plateCalculatorDescription:
    'Bar ağırlığı ve taraf başına mevcut plakalar; kayıtlı bir salon aktif değilken antrenman içindeki plaka hesaplayıcı tarafından kullanılır. Değerleri antrenman yaptığın birimde gir.',
  equipment: 'Ekipman ({unit})',
  barWeight: 'Bar ağırlığı ({unit})',
  platesPerSide: 'Taraf başına plaka ({unit})',
  platesPlaceholder: 'örn. 25, 20, 15, 10, 5, 2,5, 1,25',
  platesHint: 'Plakaları virgül ve boşlukla ayır.',
  gyms: {
    title: 'Salonlar ve ekipman',
    description:
      'Birden fazla salon kaydet. Ağırlık önerileri, antrenman seansına kaydedilen ekipmanı kullanır.',
    savedGyms: 'Kayıtlı salonlar',
    newGym: 'Salon ekle',
    active: 'aktif',
    name: 'Salon adı',
    namePlaceholder: 'örn. Bodrumdaki salon',
    dumbbells: 'Dambıllar (kg)',
    plates: 'Plaka ağırlıkları (kg, taraf başına)',
    bars: 'Bar ağırlıkları (kg)',
    exerciseAvailability: 'Egzersizler ve makineler',
    exerciseAvailabilityDescription:
      'Eksik ekipmanı işaretle. Makineler ve kablolar için istersen seçilebilen her ağırlık kademesini gir.',
    searchExercises: 'Egzersiz ara',
    available: 'Mevcut',
    machineWeights: 'Seçilebilen ağırlıklar (kg)',
    makeActive: 'Bu salonu kullan',
    saved: 'Salon kaydedildi.',
    saveError: 'Salon kaydedilemedi.',
    activated: 'Aktif salon değiştirildi.',
    activateError: 'Aktif salon değiştirilemedi.',
    deleted: 'Salon silindi.',
    deleteError: 'Salon silinemedi.',
    deleteTitle: 'Bu salon silinsin mi?',
    deleteDescription: 'Kaldırılacak salon: {name}. Mevcut seanslar antrenman geçmişini korur.',
  },
  profile: {
    title: 'Profil',
    description:
      'Profilin yapay zekâ koçunu sana göre ayarlar. Vücut ağırlığı, vücut ağırlığı egzersizlerinin etkili tonajını hesaplamak için de kullanılır; değiştirmek geçmişi yeniden hesaplar.',
    displayName: 'Görünen ad',
    namePlaceholder: 'Adın',
    bodyweight: 'Vücut ağırlığı',
    bodyweightLabel: 'Vücut ağırlığı (kg)',
    bodyweightRange: '20 ile 300 kg arası.',
    sex: 'Cinsiyet',
    height: 'Boy',
    heightLabel: 'Boy (cm)',
    heightRange: '100 ile 250 cm arası.',
    goal: 'Hedef',
    weeklyFrequency: 'Haftalık antrenman günü',
    weeklyFrequencyLabel: 'Seans / hafta',
    weeklyFrequencyRange: '1 ile 14 arası.',
    unit: 'Ağırlık birimi',
    unitDescription:
      'Ağırlıkların nasıl gösterilip girildiğini değiştirir. Verilerin her zaman kg olarak saklanır, bu yüzden birim değiştirmek geçmiş seansları asla etkilemez.',
    effortScale: 'Efor ölçeği',
    effortScaleDescription:
      'Eforun nasıl gösterilip girildiğini değiştirir. Setler her zaman yedekteki tekrarı saklar (RPE = 10 - RIR), bu yüzden ölçek değiştirmek geçmiş seansları asla etkilemez.',
    effortRir: 'RIR (yedekteki tekrar)',
    effortRpe: 'RPE (algılanan efor)',
    notSet: 'Belirlenmedi',
    fixFields: 'Lütfen işaretli alanları düzelt.',
    saved: 'Profil güncellendi.',
    saveError: 'Profil kaydedilemedi.',
    male: 'Erkek',
    female: 'Kadın',
    other: 'Diğer',
    strength: 'Kuvvet',
    hypertrophy: 'Hipertrofi',
    fatLoss: 'Yağ kaybı',
    recomp: 'Rekompozisyon',
    generalFitness: 'Genel fitness',
    kilograms: 'Kilogram (kg)',
    pounds: 'Libre (lb)',
    distanceUnit: 'Mesafe birimi',
    distanceUnitDescription:
      'Kardiyoda mesafenin, temponun ve hızın nasıl gösterilip girildiğini değiştirir. Mesafeler her zaman metre olarak saklanır, bu yüzden birim değiştirmek geçmiş seansları asla etkilemez. Otomatik seçenek ağırlık birimini izler: libre ile mil, kilogram ile kilometre.',
    distanceAuto: 'Otomatik (ağırlık birimini izler)',
    kilometers: 'Kilometre (km)',
    miles: 'Mil (mi)',
  },
  backup: {
    title: 'Veriler',
    description: 'Yerel yedek al ya da bir JSON dosyasından geri yükle.',
    export: 'Tüm verilerimi dışa aktar (JSON)',
    exportDone: 'Dışa aktarım indirildi.',
    exportError: 'Dışa aktarım başarısız oldu.',
    import: 'Yedeği içe aktar',
    invalidJson: 'Geçersiz JSON dosyası.',
    importDone: 'İçe aktarım tamamlandı. Mevcut veriler değiştirildi.',
    importError: 'İçe aktarım başarısız oldu.',
    confirmTitle: 'İçe aktarımı onayla',
    confirmDescription:
      "{file} dosyası mevcut tüm verilerinin yerine geçecek (programlar, seanslar, setler, hedefler, vücut ağırlığı geçmişi, check-in'ler, koç konuşmaları). Bu işlem geri alınamaz.",
    replace: 'Evet, değiştir',
  },
  imports: {
    title: 'Antrenman geçmişini içe aktar',
    description: 'Başka bir antrenman uygulamasından dışa aktarılan antrenmanları içe aktar.',
    source: 'Kaynak uygulama',
    strongUnit: 'Strong ağırlık birimi',
    chooseFile: '{kind} dosyası seç',
    chooseFitFiles: 'FIT dosyaları seç',
    fileTooLarge: 'Bir dosya çok büyük: dosya başına sınır 5 MB.',
    fitLimit: 'Tek seferde en fazla {count} FIT dosyası.',
    previewFailed: 'Önizleme başarısız oldu.',
    importFailed: 'İçe aktarım başarısız oldu.',
    confirm: 'İçe aktarımı onayla',
    previewOf: 'Önizleme: {file}',
    cardioTitle: '{kind} aktivitesi içe aktar',
    appTitle: 'İçe aktar: {app}',
    cardioDescription: 'Bir kardiyo antrenmanı ekle: {hint}. Burada önizle, sonra onayla.',
    appDescription:
      'Antrenman geçmişini {app} uygulamasından getir: {hint}. Burada önizle, sonra onayla.',
    activitiesSummary:
      'İçe aktarılacak: {count, plural, one {# aktivite} other {# aktivite}}{skipped, plural, =0 {} other { · # atlandı}}',
    possibleDuplicate: 'olası kopya',
    fileSkipped: 'Dosya {index} atlandı: {error}',
    importSessions: '{count, plural, one {# seansı içe aktar} other {# seansı içe aktar}}',
    cardioSession: '1 kardiyo seansı ({sport}), {date}',
    loggedAs: 'kayıt adı: {name}',
    duplicateWarning:
      'Olası kopya: bu aktiviteden 2 dakika önce ya da sonra başlayan bir seansın zaten var.',
    strengthSummary:
      'İçe aktarılacak: {sessions, plural, one {# seans} other {# seans}}, {sets, plural, one {# set} other {# set}}',
    newExercises:
      '{count, plural, one {# yeni egzersiz oluşturulacak} other {# yeni egzersiz oluşturulacak}}: {names}',
    duplicatesSkipped:
      '{count, plural, one {# birebir kopya atlanacak} other {# birebir kopya atlanacak}}',
    cardioIncluded:
      '{count, plural, one {# kardiyo seti} other {# kardiyo seti}} (süre/mesafe) dahil',
    cardioSkipped:
      'Kullanılabilir süresi olmayan {count, plural, one {# kardiyo satırı} other {# kardiyo satırı}} atlanacak',
    nonSetRowsSkipped:
      'Set olmayan {count, plural, one {# dinlenme sayacı veya not satırı} other {# dinlenme sayacı veya not satırı}} atlanacak',
    existingDates: 'Şu tarihlerde zaten seansın var: {dates}',
    unreadable:
      '{count, plural, one {# satır okunamadı ve atlanacak:} other {# satır okunamadı ve atlanacak:}}',
    lineError: 'Satır {line}: {reason}',
    moreErrors: '... ve {count} tane daha',
    importDone:
      'İçe aktarıldı: {sessions, plural, one {# seans} other {# seans}}, {sets, plural, one {# set} other {# set}}{exercises, plural, =0 {} one {, # yeni egzersiz} other {, # yeni egzersiz}}.',
    fitImportDone:
      'İçe aktarıldı: {sessions, plural, one {# seans} other {# seans}}{exercises, plural, =0 {} one {, # yeni egzersiz} other {, # yeni egzersiz}}{skipped, plural, =0 {.} one { (# dosya atlandı).} other { (# dosya atlandı).}}',

    file: '{format} dosyası',
    exportHints: {
      strong: 'CSV olarak dışa aktar (Settings, ardından Export data)',
      hevy: 'CSV olarak dışa aktar (Settings, ardından Export & Import Data)',
      gymcoach:
        'Geçmiş sayfasından dışa aktarılan CSV dosyasını veya aynı sütunlara sahip bir elektronik tabloyu kullan (session_date, workout, exercise, set_number, external_load_kg, reps, ...)',
      tcx: 'etkinliği saat platformundan (Garmin Connect, Polar Flow, ...) TCX olarak dışa aktar; süre, mesafe ve kalp atış hızı içeren tek bir kardiyo seansına dönüştürülür',
      gpx: 'rotayı Strava, Komoot veya Apple Fitness üzerinden GPX olarak dışa aktar; süre, mesafe ve kalp atış hızı içeren tek bir kardiyo seansına dönüştürülür',
      fit: 'etkinliği Garmin (veya başka bir marka) saatinden FIT dosyası olarak dışa aktar; süre, mesafe ve kalp atış hızı içeren tek bir kardiyo seansına dönüştürülür',
      appleHealth:
        'Sağlık uygulamasında profil resminize, ardından Tüm Sağlık Verilerini Dışa Aktar’a dokunun ve oluşturulan export.zip dosyasını (veya içindeki export.xml dosyasını) seçin',
      strava:
        'strava.com’da Ayarlar, Hesabım bölümünü açın, Hesabınızı İndirin veya Silin altında Başlayın’a tıklayın, arşivinizi isteyin ve Strava’nın e-postayla gönderdiği zip dosyasını seçin',
    },
    appleHealth: {
      description:
        'Kardiyo antrenmanlarınızı Apple Sağlık’tan getirin: {hint}. Önizlemeyi burada kontrol edin, sonra onaylayın.',
      chooseFile: 'export.zip seç',
      privacy:
        'Dışa aktarım, boyutu ne olursa olsun bu cihazda okunur: GymCoach sunucunuza yalnızca antrenman özetleri (tür, tarih, süre, mesafe, nabız) gönderilir. Kuvvet antrenmanları atlanır ve geçmişinizde zaten bulunan antrenmanlar ikinci kez içe aktarılmaz.',
      reading: 'Dışa aktarım okunuyor: {read} / {total} MB',
      sending: 'Paket gönderiliyor: {done} / {total}',
      waiting: 'İçe aktarma sınırına ulaşıldı, {seconds} sn sonra devam edilecek',
      nothingFound: 'Bu dosyada antrenman veya vücut ağırlığı kaydı bulunamadı.',
      noExportXml:
        'Bu arşivde export.xml yok. Sağlık uygulamasının oluşturduğu export.zip dosyasını seçin.',
      unreadable: 'Bu dosya okunamadı.',
      workouts:
        '{count, plural, one {# kardiyo antrenmanı içe aktarılacak} other {# kardiyo antrenmanı içe aktarılacak}}',
      byType: '{name}: {count}',
      duplicates:
        '{count, plural, one {Geçmişinizde zaten bulunan # antrenman atlanacak} other {Geçmişinizde zaten bulunan # antrenman atlanacak}}',
      strengthSkipped:
        '{count, plural, one {# kuvvet antrenmanı atlanacak} other {# kuvvet antrenmanı atlanacak}}',
      invalidSkipped:
        '{count, plural, one {Kullanılabilir tarihi veya süresi olmayan # antrenman atlanacak} other {Kullanılabilir tarihi veya süresi olmayan # antrenman atlanacak}}',
      conflicts:
        '{count, plural, one {# antrenman içe aktarılamıyor} other {# antrenman içe aktarılamıyor}}: kardiyo olmayan egzersizlerinizden biri zaten bu adı taşıyor',
      bodyMass:
        '{count, plural, one {# vücut ağırlığı kaydını da içe aktar} other {# vücut ağırlığı kaydını da içe aktar}}',
      bodyMassDuplicates:
        '{count, plural, one {Zaten kayıt bulunan bir güne ait # vücut ağırlığı kaydı atlanacak} other {Zaten kayıt bulunan günlere ait # vücut ağırlığı kaydı atlanacak}}',
      done:
        'İçe aktarıldı: {sessions, plural, one {# antrenman} other {# antrenman}}{weights, plural, =0 {} one {, # vücut ağırlığı kaydı} other {, # vücut ağırlığı kaydı}}{skipped, plural, =0 {.} other { (# atlandı).}}',
    },
    strava: {
      description:
        'Etkinliklerinizi Strava’dan getirin: {hint}. Önizlemeyi burada kontrol edin, sonra onaylayın.',
      chooseFile: 'Strava arşivini seç',
      privacy:
        'Arşiv bu cihazda açılır: GymCoach sunucunuza yalnızca etkinlik dosyaları (FIT, GPX, TCX) gönderilir; fotoğraflar ve geri kalan her şey asla okunmaz. İçe aktarma dakikada 10 istekle sınırlıdır, bu yüzden uzun bir geçmiş biraz zaman alır: bu sekmeyi açık tutun. Geçmişinizde zaten bulunan etkinlikler ikinci kez içe aktarılmaz.',
      checking:
        'Arşiv kontrol ediliyor: {read} / {total} MB, {count, plural, one {# etkinlik kontrol edildi} other {# etkinlik kontrol edildi}}',
      importing:
        'İçe aktarılıyor: {read} / {total} MB, {count, plural, one {# etkinlik gönderildi} other {# etkinlik gönderildi}}',
      waiting: 'İçe aktarma sınırına ulaşıldı, {seconds} sn sonra devam edilecek',
      cancelled: 'İçe aktarma iptal edildi. Hiçbir şey içe aktarılmadı.',
      cancelledAfterStart:
        'İçe aktarma iptal edildi. Zaten içe aktarılan etkinlikler geçmişinizde kalır.',
      notZip:
        'Bu dosya bir zip arşivi değil. Strava’nın size e-postayla gönderdiği zip dosyasını seçin.',
      notStrava:
        'Bu arşivde activities.csv dosyası da activities klasörü de yok. Strava’nın size e-postayla gönderdiği zip dosyasını seçin.',
      unreadable: 'Bu arşiv okunamadı.',
      activities:
        '{count, plural, one {# etkinlik içe aktarılacak} other {# etkinlik içe aktarılacak}}',
      byType: '{name}: {count}',
      duplicates:
        '{count, plural, one {Geçmişinizde zaten bulunan # etkinlik atlanacak} other {Geçmişinizde zaten bulunan # etkinlik atlanacak}}',
      withoutFile:
        '{count, plural, one {Dosyası olmayan (Strava’ya elle girilmiş) # etkinlik atlanacak} other {Dosyası olmayan (Strava’ya elle girilmiş) # etkinlik atlanacak}}',
      unsupported:
        '{count, plural, one {GymCoach’un okumadığı bir biçimdeki # dosya atlanacak} other {GymCoach’un okumadığı bir biçimdeki # dosya atlanacak}}',
      tooLarge:
        '{count, plural, one {5 MB’tan büyük # dosya atlanacak} other {5 MB’tan büyük # dosya atlanacak}}',
      unreadableFiles:
        '{count, plural, one {Okunamayan # dosya atlanacak} other {Okunamayan # dosya atlanacak}}',
      skippedFiles: 'Atlanacak dosyalar',
      done:
        'İçe aktarıldı: {sessions, plural, one {# etkinlik} other {# etkinlik}}{skipped, plural, =0 {.} other { (# atlandı).}}',
    },
  },
  mcp: {
    title: 'ChatGPT ve MCP',
    description:
      "Harici bir yapay zekâ ajanını GymCoach verilerine bağla. Token'ları istediğin zaman iptal edebilirsin.",
    keyName: 'Bağlantı adı',
    create: 'Bağlantı oluştur',
    created: 'MCP bağlantısı oluşturuldu.',
    createError: 'MCP bağlantısı oluşturulamadı.',
    writeAccess: 'Kayıtlı verilerde değişikliğe izin ver',
    writeAccessDescription:
      'ChatGPT, işlemi onayına sunduktan sonra program oluşturup düzenleyebilir, salon ekipmanını (serbest ağırlıklar, ekipman ve fotoğrafları) güncelleyebilir ve geçmiş setlere kaydedilen ekipman gibi antrenman geçmişi verilerini güncelleyebilir.',
    readyTitle: "ChatGPT bağlayıcı URL'si hazır",
    readyDescription:
      'Şimdi kopyala. Gizli kısım yalnızca bir kez gösterilir. ChatGPT\'de kimlik doğrulama olarak "yok" seç, çünkü URL zaten özel bir token içeriyor.',
    copied: "Bağlayıcı URL'si kopyalandı.",
    copy: "Bağlayıcı URL'sini kopyala",
    activeKeys: 'Aktif bağlantılar',
    noKeys: 'Henüz MCP bağlantısı yok.',
    readWrite: 'Okuma ve yazma',
    readOnly: 'Yalnızca okuma',
    lastUsed: 'son kullanım: {date}',
    revoke: 'Bağlantıyı iptal et',
    revoked: 'MCP bağlantısı iptal edildi.',
    revokeError: 'MCP bağlantısı iptal edilemedi.',
  },
} satisfies MessageShape<typeof english>;
