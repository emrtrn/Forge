# Ortak Forge Kaynağı ve Bağımsız Oyun Projesi

> Tarih: 2026-10-25
> Durum: **Hedef çalışma ilkesi onaylı; teknik uygulama ve kabul bekliyor.**
> Kapsam: Forge motor/editör kaynağı ile bağımsız oyun projelerinin geliştirme,
> kayıt ve build ilişkisi. Bu belge çalışan özellik veya test başarısı raporu değildir.
> İlk tüketici: Forge Offroad. Mevcut oyunlar için otomatik migrasyon kararı yoktur.

## 1. Problem ve karar

Kullanıcının ThreeAges deneyiminde Forge kopyasından oluşturulan oyun içinde
yapılan genel motor düzeltmeleri Forge'a kendiliğinden dönmedi. Aynı değişikliğin
elle taşınması gerekti veya ortak motor bu iyileştirmeden mahrum kaldı.

Mevcut [GAME_FORK_WORKFLOW.md](GAME_FORK_WORKFLOW.md), Forge'dan oyuna
`upstream` birleştirmesini ve ters yönde elle `cherry-pick` işlemini tarif ediyor.
`tools/sync-forge-to-games.ps1` de Forge değişikliklerini oyunlara birleştiriyor;
oyunda başlayan motor geliştirmesini ortak kaynağa taşıyan bir mekanizma değil.

**Karar:** Yeni Offroad geliştirme akışında oyun projesi Forge'un düzenlenebilir
motor/editör kopyasını taşımaz. Oyun, geliştirme sırasında tek yetkili Forge
kaynağını kullanır. Genel motor/editör düzeltmesi, hangi oyun sırasında fark
edilirse edilsin, gerçek Forge kaynak dosyasında yapılır ve Forge deposunda tutulur.

Bu hedefin kabulü, mevcut kodun bu desteği sağladığı anlamına gelmez. İki yönlü
dosya kopyalama veya otomatik oyun deposu → Forge merge akışı hedef çözüm değildir.

## 2. Hedef sahiplik ve yerleşim

Temsili yerleşim; aşağıdaki oyun klasörünün oluşturulduğu iddia edilmez:

```text
C:/Users/emret/Desktop/
  Forge/                 # Yetkili motor, editör, ortak araçlar ve bunların Git deposu
  Games/
    Offroad/             # Ayrı oyun Git deposu; oyun kodu, proje verisi ve belgeleri
```

| Sınıf | Yetkili kaynak | Örnek |
|---|---|---|
| ENGINE | Forge | Genel araç kütle/COM API'si, arazi fiziği |
| EDITOR | Forge | Genel içerik düzenleme ve kamera araçları |
| TOOLS | Forge | Proje başlatma, doğrulama ve ortak build araçları |
| GAME | Offroad | Sözleşme, yükleme/teslim koşulları, ödül, HUD, oyun kayıt modeli |
| CONTENT | Offroad | Sahne, terrain sidecar, kargo profili, proje manifesti, varlıklar |
| DESIGN | Offroad | GDD, oyun kabul raporu ve içerik kararları |

Forge'un kendi örnekleri ve test fixture'ları Forge'da kalabilir; bağımsız oyunun
verisi bunların üzerine kaydedilmez. Mevcut `src/game`, `src/project`, `engine`,
`editor` yerleşimi yalnız örnek bir paket ağacına uymak için topluca taşınmaz.

## 3. Geliştirme akışı

1. Geliştirme ortamı hem Forge hem oyun deposunu erişilebilir hale getirir.
2. Oyun, seçilmiş yerel Forge kaynağından motor/editör ve ortak araçları kullanır.
3. Oyun kodu ve veri değişiklikleri oyun deposunda yapılır.
4. Genel bir motor eksiği bulunursa sorun oyun sahnesinde yeniden üretilir;
   düzeltme Forge deposundaki gerçek kaynakta yapılır. Oyun içine motor yaması eklenmez.
5. Ortak motor testleri ve oyunun ilgili senaryosu aynı değişiklikle doğrulanır.
6. Motor değişikliği Forge'da, oyun değişikliği oyun deposunda ayrı kaydedilir.
   Commit/push/merge işlemleri mevcut kullanıcı yetkisi ve repo kurallarına tabidir.

**Örnek:** Ağır kargoda fren davranışı hatalıysa genel fren hesabı Forge'da;
kargonun ağırlığı ve hangi işte yüklendiği Offroad'da değiştirilir. Offroad testi
aynı Forge dosyasını kullanır. Düzeltmeyi oyundan Forge'a tekrar taşıma adımı yoktur.

Yerel bir kaynağa bağlanmak değişikliği otomatik commit/push yapmaz. HMR veya
yeniden derleme davranışı da uygulamada doğrulanmalıdır; her dosya değişikliğinin
yeniden başlatma gerektirmeden görüneceği henüz vaat edilmez.

## 4. Claude bulut oturumu ve yerel geliştirme

- Motor geliştirmesi mevcut Claude Code bulut oturumunda Forge deposunda sürer.
- Kullanıcı onaylı Forge değişikliklerini yerel Forge deposuna çeker.
- Bağlı oyun geliştirme ortamı bu yerel kaynağı kullanır; motor dosyaları oyun
  deposuna ayrıca merge edilmez. Bağımlılık değişmişse kurulum/yeniden başlatma
  gerekebilir; oyun uyumluluğu kontrol edilmeden güncelleme kabul edilmiş sayılmaz.
- Yerelde Forge değişikliği varsa pull öncesi korunur. Paralel yerel/bulut
  geliştirme Git çatışmalarını ortadan kaldırmaz; tek kaynak, çift uygulamayı önler.
- Bulut/CI ortamında oyun ve kullanılan Forge commit'i birlikte hazırlanır.
  Kullanıcının Windows yolunun diğer makinelerde var olduğu varsayılmaz.

**Bu oturumun sınırı:** Şimdilik motor kodu geliştirmiyoruz. Aşağıdaki ortak
altyapı işi Claude'un motor geliştirme akışında ele alınacak görev tanımıdır.

## 5. Mevcut koddan bilinen sınırlar

2026-10-25 tarihli kaynak incelemesinin bulguları; uygulama başlarken tekrar kontrol edilir:

- `src/scene/ForgeGameModule.ts` oyun modülü yaşam döngüsünü tanımlar.
  `src/main.ts`, `src/game/gameModule.ts` modülünü runtime'a bağlar.
- `vite.config.ts`, `PUBLIC_DIR` ve `PROJECT_MANIFEST_PATH` için repo içindeki
  `public` yollarını kullanır. Bağımsız proje kökü hazır varsayılamaz.
- `tsconfig.json` içindeki alias'lar mevcut repo kaynaklarına bağlıdır.
  Yalnız klasör bağlantısı kurmak tüm import, derleme ve editör yazma yollarını çözmez.
- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) önceki fork modelini ve eski
  dış proje/launcher sisteminin kaldırıldığını kaydeder. Bu hedef, eski Studio
  veya Project Browser'ı bütünüyle geri getirme kararı değildir.

Bu belge için runtime/build testi yapılmamıştır. Güncel başlangıç SHA'sı ve
korunacak değişiklikler uygulama kaydına yazılacaktır.

## 6. Claude için uygulama görevi ve sıra

### P0 — En küçük teknik tasarım

Önce Git durumu, `AGENTS.md`, aktif kaynaklar ve mevcut testler incelenir.
Motor kaynağı, oyun giriş/modül yolu, proje veri kökü ve çıktı kökü arasındaki
sözleşme tanımlanır. Mevcut Forge örnek akışı korunur.

Yerel paket bağlantısı, çalışma alanı veya eşdeğer bir yöntem değerlendirilebilir.
**Kesin paket yöneticisi, komut, manifest alanı veya dizin migrasyonu bu belgede
seçilmiş değildir.** Seçim; kaynak sahipliği, build ve kayıt izolasyonu ile kanıtlanır.
`node_modules` içinde kalıcı motor düzeltmesi yapılmaz. Three.js/Rapier gibi ortak
bağımlılıkların farklı kopyalarla yüklenme riski ele alınır.

### P1 — Küçük bağımsız proje prototipi

Bir oyun modülü ve küçük bir sahneyle aşağıdakiler uygulanır:

1. Seçilen Forge kaynağı + oyun modülü + oyun manifestiyle başlatma.
2. Ortak Forge editöründe oyuna ait içeriği açma ve kaydetme.
3. Aynı oyun verisini runtime'da açma.
4. Bağımsız runtime build'i alma; mevcut editör/runtime import sınırlarını koruma.
5. Kullanılan Forge kaynağı, oyun kaynağı ve build girdilerini raporlama.

Editör ve runtime için ayrı motor kopyaları veya paralel scene loader'lar
üretilmez. Varsa mevcut genel API'ler kullanılır; gereken yeni davranış genel kalır.

### P2 — Kabul ve iş akışı belgeleri

Aşağıdaki kabul tablosu kanıtlarla doldurulur. İlgili mimari belgeleri, başlatma
talimatları ve mevcut fork araçlarının kapsamı gerçek uygulamaya göre güncellenir.
Eski oyunlar taşınmaz; her oyun için ayrı fark analizi ve geçiş kararı gerekir.

## 7. Proje kökü ve yazma sınırları

Bağımsız proje desteğinde okuma/yazma kökü açıkça seçilir. Proje manifesti,
sahne, terrain/tile, asset sidecar, import, oluşturma, yeniden adlandırma, silme
ve autosave işlemleri seçili oyunun izin verilen veri kökünde kalmalıdır.

- Geçersiz proje yolu sessizce Forge `public/` alanına geri düşmez; anlaşılır hata verir.
- Yol çözümlemesi ve bağlantıların gerçek hedefi doğrulanır; proje dışına taşan
  dosya işlemleri engellenir. İstemciden gelen keyfi bir yol yetki sayılmaz.
- Var olan allowlist/validator'lar korunur; yeni alanlar ilgili doğrulayıcıya eklenir.
- Dev dosya erişimi ve editör middleware'i production build'e girmez.
- Geçici iki proje ile kayıt/rename/delete ve proje dışı yol denemeleri sınanır;
  kullanıcının gerçek sahneleri bu testlere fixture yapılmaz.

Bu iş dev-server uçları, save/load ve dosya sınırlarını etkilediği için uygulama
sonrasında ilgili değişikliklere **Codex Security diff taraması önerilir**.
Tarama sessizce başlatılmaz; kullanıcı onayı/isteği beklenir.

## 8. Kabul kapısı — M0 öncesi

Başlangıç durumu her satırda **TEST EDİLMEDİ**. Uygulama raporu test adı,
log/görüntü yolu ve test edilen kaynak durumunu içermelidir.

| ID | Kanıtlanacak davranış |
|---|---|
| SP-01 | Oyun deposu düzenlenebilir Forge motor/editör kopyası içermeden açılır. |
| SP-02 | Editör ve runtime seçilen oyunun manifestini, modülünü ve sahnesini kullanır. |
| SP-03 | Forge'daki küçük bir genel değişiklik aynı kaynaktan oyunda sınanır; oyuna dosya taşıma gerekmez. |
| SP-04 | Oyun değişikliği yalnız oyun deposunda; motor değişikliği yalnız Forge deposunda görünür. |
| SP-05 | Save/autosave ve içerik işlemleri yalnız seçili oyun köküne yazar; Forge fixture'ları ve ikinci proje değişmez. |
| SP-06 | Geçersiz/proje dışına taşan yollar reddedilir; yanlış köke sessiz kayıt yapılmaz. |
| SP-07 | Bağımsız oyun build'i önizlemede çalışır; editör, dev uçları ve makineye özel yollar çıktıya sızmaz. |
| SP-08 | Forge güncellemesinden sonra oyun açılış, kayıt ve temel oynanış kontrolü geçer. |
| SP-09 | Temiz bir ortamda kayıtlı oyun/Forge commit'leri ve build girdileriyle proje yeniden hazırlanabilir. |
| SP-10 | Forge'un mevcut örnek editör/runtime akışı ve uygun regresyon kapıları korunur. |

TypeScript değişikliğinde `npx.cmd tsc --noEmit`; ortak runtime/motor işi için
uygun tam kapı `npm.cmd run test:engine` ve `npm.cmd run build:verify` çalıştırılır.
Editör/proje açma, dosya izolasyonu ve build önizlemesi için hedefli browser testleri
eklenir. Otomatik kontroller, kullanıcı görsel/oynanış kabulünün yerine geçmez.

## 9. M0 → M1 → M2 ile ilişki

Önce SP kabul kapısı, ardından bağımsız Offroad projesinde M0 geliştirmesi.
Bu kapı tüm Open World ve Terrain Deformation planlarının bitmesini gerektirmez.
M0 ayrıca güvenilir araç/sahne ve kendi görev/save kabulünü gerektirir.

- **M0:** İş kabulü, yük alma, taşıma, teslim, tek ödeme ve kayıt tutarlılığı.
- **M1:** Motorun yük-kütle/COM ve yüzey API'leri hazır olduğunda yük/rota farkının
  oyun içinde birleştirilmesi ve karşılaştırmalı kabulü.
- **M2:** Motorun iz/batma altyapısının oyun senaryosunda kullanımı ve performans kabulü.

Eksik genel API, Forge/Claude işi olarak kaydedilir. Oyun içinde geçici motor
kopyasıyla kapatılmaz; ilgili kabul maddesi hazır olana kadar açık tutulur.

## 10. Build kaydı, kapsam dışı işler ve devir

Geliştirmede canlı kaynak kullanılabilir; kabul/yayın için oyun commit'i,
Forge commit'i, bağımlılık kilidi, asset/proje verisi, save şeması ve build ayarları
birlikte kaydedilir. Kaydedilmemiş diff varsa commit SHA tek başına tam kanıt değildir.
Yayımlanmış build sonradan yapılan Forge pull'u ile değişmez; yeni build ayrı doğrulanır.

Bu hedef bağımsız Forge paket release sistemi, her değişiklikte motor sürümü,
genel launcher, marketplace, bütün oyunların migrasyonu veya otomatik çift yönlü
merge gerektirmez. Teknik seçimlerin gerektirdiği büyük taşıma/şema değişiklikleri
ayrı gerekçe ve inceleme konusu yapılır.

**Claude'a devir:** Önce P0 tasarımı ve etkilenen dosyaları çıkar; sonra küçük P1
prototipini SP-01–SP-10 kanıtlarıyla doğrula. Offroad M0 oyun mantığını bu altyapı
görevine ekleme. Mevcut kullanıcı değişikliklerini, sahnelerini ve bulut/yerel
çalışma geçmişini koru. Bu belge commit/push/merge veya yayın talimatı değildir.
