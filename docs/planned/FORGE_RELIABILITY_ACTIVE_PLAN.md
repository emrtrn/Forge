# Forge güvenilirlik — aktif iş listesi

Tarih: 21 Ekim 2026.
Kaynak: [kapsamlı inceleme](../reports/FORGE_KAPSAMLI_INCELEME_2026-10-21.md).

Bu dosya seçilen uygulama dilimlerini izler. Kaynak rapor, inceleme anının
kanıt kaydı olarak korunur. Kod, otomatik doğrulama ve kullanıcı kabulü ayrı
değerlendirilir.

## 1. F01 — Editör kayıt yarışı

- Kod: uygulandı.
- Otomatik doğrulama: TypeScript, tam `build:verify` ve hedefli browser akışları geçti.
- Kullanıcı kabulü: bekliyor.

### Uygulanan davranış

- Arazi, foliage ve mesh-paint düzenlemeleri bellek içinde sürümlenir; içerik
  dosyalarının şeması değişmez.
- Bir kayıt yanıtı yalnız gönderdiği sürümü temizleyebilir. Yanıt beklenirken
  yapılan yeni düzenleme dirty kalır.
- Save, autosave ve doğrudan arazi kaydı aynı editör oturumunda sırayla çalışır.
  Her kayıt turu, layout ve dirty sidecar verilerini ilk istekten önce yakalar.
- Kısmi hatada tamamlanan ve bekleyen dosyalar hata mesajında gösterilir.
  Başarısız/denenmemiş sidecar'lar dirty kalır; sonraki Save tekrar dener.
- Kayıt sürerken yeni sidecar düzenlemesi varsa durum mesajı tekrar Save
  gerektiğini belirtir. Arazi ekleme ve heightmap import kayıt hataları gizlenmez.
- Landscape silinip aynı kimlikle yeniden eklendiğinde eski yanıt yeni kaydın
  dirty durumunu temizleyemez.

### Doğrulama

- [12 yeni regresyon kontrolü](../../tests/engine/editorSaveCoordinator.test.ts):
  üç sidecar türünde geciken yanıt, ortak snapshot, kayıt sıralaması, dört hata
  noktası ve retry, belge değişimi, aynı landscape kimliğinin yeniden kullanımı,
  snapshot hazırlama hatasından sonra kuyruğun çalışması.
- `npx.cmd tsc --noEmit`: geçti. Değişen test dosyaları ayrıca TypeScript
  programına dahil edilerek kontrol edilir.
- F01 checkpoint'inde `npm.cmd run build:verify`: **1.234 kontrol geçti**;
  import denetimi, build ve sıkı production paket taraması geçti. O koşumda
  mevcut olan import denetleyicisi sınırlaması aşağıdaki F02 diliminde düzeltildi.
- Browser kapsamı: editör authoring/save/reload/Play; landscape paint;
  landscape sculpt sırasında gerçek başarılı HTTP yanıtını bekletme,
  bu sırada Undo, sonraki Save ve disk/reload doğrulaması.
  Authoring ve paint ilk koşumda geçti. Gecikmeli sculpt testi, önceden kuyruğa
  girmiş autosave'i ayırt edecek şekilde düzeltildikten sonra ayrı koşumda geçti.
  Toplam **3 hedefli Chromium akışı** doğrulandı; tüm browser paketi çalıştırılmadı.
  Test teardown'u ortak proje/asset manifestlerini, test seviyelerini ve arazi
  sidecar'ını geri yükledi.

Hata testleri kontrollü HTTP/saver hata enjeksiyonudur; fiziksel disk arızası
veya gerçek süreç kesintisi testi değildir.

### Açık sınırlar

Bu dilim editör içindeki kayıt yarışını ve hata sonrası tekrar denemeyi ele alır.
Sunucu tarafında geçici dosya ile değiştirme, birden fazla dosyada crash/disk
kesintisi kurtarma ve farklı sekme/istemcilerin çakışan yazmalarını koordine etme
henüz uygulanmadı. Layout endpoint'inin layout ve manifest yazması tek disk
transaction'ı değildir. Raporun F01 maddesi bu daha geniş kapsamıyla tamamen
kapanmış sayılmaz.

## 2. F02 — AST import denetimi ve engine bağımsızlığı

- Kod: uygulandı.
- Otomatik doğrulama: TypeScript, tam `build:verify` ve hedefli runtime
  browser kontrolü geçti.
- Görsel animasyon/kullanıcı kabulü: bu dilimde yapılmadı.

### Uygulanan davranış

- [Import denetleyicisi](../../builder/web/verify-imports.mjs) TypeScript AST
  kullanır. Çok satırlı import/export, type-only import, import type,
  import-equals ve literal dinamik import ifadelerini denetler; yorum ve metin
  içindeki örnekler bağımlılık sayılmaz. Mevcut katman kuralları korunur.
- Alias ve göreli yollar normalize edilir. Alias içindeki `..` geçişi hedef
  katmanı gizleyemez. Denetlenen dosyada bozuk sözdizimi veya taramada erişim
  hatası varsa denetim sessizce başarılı sayılmaz.
- [Blend-space hesapları ve tipleri](../../engine/animation/blendSpace.ts)
  engine'e taşındı. `locomotionAnimation.ts` doğrudan bu modülü kullanır;
  HTTP sidecar yükleme/normalizasyonu host katmanında kalır.
- `assetSkeletonLoader.ts` ve editör store'unun mevcut export'ları korunur.
  İçerik şeması ve ağırlık hesaplama davranışı değiştirilmedi.
- `verify:imports`, önce denetleyicinin kendi regresyonlarını, ardından mevcut
  kaynak ağacının taramasını çalıştırır; yerel `build:verify` ve mevcut CI kapısı
  bu kontrolleri otomatik içerir.

### Doğrulama

- Düzeltmenin ilk adımında AST denetimi mevcut
  `engine/movement/locomotionAnimation.ts -> @/scene/assetSkeletonLoader`
  bağımlılığını yakaladı ve exit code `1` verdi. Taşıma sonrası **366 kaynak
  dosyasında sıfır yasak doğrudan bağımlılık** ile geçti.
- [10 denetleyici regresyonu](../../tests/builder/verify-imports.test.mjs)
  geçti. Geçici fixture üzerinde gerçek komut akışı, yasak çok satırlı import'ta
  exit code `1`, düzeltildiğinde `0` üretti.
- `npx.cmd tsc --noEmit`: geçti.
- `npm.cmd run build:verify`: **1.235 engine kontrolü + 10 denetleyici testi**
  geçti; üretim build'i ve sıkı dist taraması geçti. Mevcut blend-space/locomotion
  kontrolleri ve eklenen engine/loader/editor export uyumluluk kontrolü dahil.
- Browser: `runtime-locomotion.spec.ts` **1/1 geçti** (37,8 saniye); klavye
  hareketi, durma, zıplama ve debug readout doğrulandı. Teardown geçici proje
  verilerini geri yükledi. Tam browser paketi bu dilimde çalıştırılmadı.

Denetleyici mevcut katman kurallarına göre doğrudan, literal import yollarını
kontrol eder. Hesaplanan dinamik yolların veya transitif bağımlılıkların tamamı
için doğrulama iddiası yoktur. Uzak CI koşumu ve canlı dağıtım yapılmadı.

## 3. F03 + F15 — Bağımsız browser verisi ve debug tıklamaları

- Kod: uygulandı.
- Otomatik doğrulama: tam Chromium paketi **49/49**, güncel tam `build:verify`
  ve TypeScript kontrolleri geçti.
- Kullanıcı/görsel kabulü: yapılmadı.

### Uygulanan davranış

- Her Playwright koşumu ayrı `.playwright-smoke/run-<uuid>` projesi alır.
  `public/` dosyaları gerçek kopyadır; normal statik okumalar ve mevcut Vite
  kayıt middleware'i bu kopyada çalışır. Geliştiricinin manifesti, demo level'ları
  ve sidecar'ları test başlangıcında/sonunda değiştirilmez.
- Kaynak kontrollü test base level'ı, karakter AI actor/behavior/kapalı rotası,
  menü ve üç segmentlik yol tanımı [fixtures](../../tests/smoke/fixtures/)
  altında. Varsayılan sahne seçimi veya kullanıcının arazi düzenlemesi bunları
  belirlemez. Oyun starter'ları ve gerçek asset'ler bağımlılık olarak kopyalanır.
- Bütün spec'ler [test fixture'ını](../../tests/smoke/test.ts) kullanır. Her case
  öncesi üretilmiş level/manifest/menü/sidecar belgeleri başlangıca döner; önceki
  case kaydetmiş veya başarısız olmuş olsa da sonraki aynı ön koşulla başlar.
- Yol testi kendi level ve sidecar'ını açıkça seçer. Sculpt/paint farklı bir
  sidecar'a yazar; testlerin kullanıcı arazisini yedekleyip geri yüklemesi kaldırıldı.
- Teardown yalnız bu koşumun sunucusunu durdurur ve doğrulanmış run dizinini
  siler. Sunucu başlangıcı başarısız olursa kendi geçici projesini temizler.
- Debug readout varsayılan olarak tıklamaları geçirir. **Inspect text** kaydırma
  ve metin seçimini açar; readout odaktayken Escape bu modu kapatır. Kontrol
  düğmeleri her iki durumda da etkileşimlidir. Load testinde zorunlu tıklama yok.
- Araç Load ve kamera sürükleme testlerindeki iki `pointer-events` CSS müdahalesi
  kaldırıldı. İleri/fren/geri sürüş testi, engel senaryolarından ayrı düz test
  şeridinde çalışır; hız beklentileri ve fizik kodu değiştirilmedi.
- `tsconfig.smoke.json` bütün smoke TypeScript dosyalarını ve Playwright ayarını
  denetler. `verify:smoke-fixtures`, bu tip kontrolü ile izolasyon testlerini
  çalıştırır ve mevcut `build:verify` kapısına dahildir.

### Doğrulama

- Beş fixture kontrolü geçti: Terrain/Playground default'undan bağımsız sonuç,
  dosya kopyasında save/delete/cleanup'ın kaynağı değiştirmemesi, başarısız case
  sonrası reset, başarısız kurulumda kaynağın korunması ve dizin sınırları.
- Sabit level fixture'larının save allowlist'inde alan kaybetmediği kontrol edildi.
- Bütün smoke dosyaları, Playwright ayarı ve uygulama tip kontrolünden geçti.
- `npm.cmd run build:verify`: **1.236 engine kontrolü + 10 import denetleyici
  testi + 5 fixture testi** geçti. Uygulama/smoke TypeScript kontrolleri, production
  build ve sıkı dist taraması başarılı.
- Önceden başarısız AI patrol/clearance, üç segmentlik yol ve checkpoint
  save→Load→restore akışları hedefli koşumlarda geçti. Debug testinde pasif/okuma
  modu, Escape, frame table aç/kapa, Pause/Resume ve GPU düğmesine erişim doğrulandı.
- Tam Chromium paketi **49/49 geçti (15,4 dakika)**. Editör authoring/save/Play,
  runtime hareket/travel/checkpoint, AI, landscape, debug panel ve araç akışları
  dahil. İlk tam koşum 48/49 idi; geri sürüş senaryosunu düz şeride ayırdıktan
  sonra paketin tamamı yeniden çalıştırıldı ve geçti.
- Başarılı ve başarısız tam koşumların geçici proje dizinleri teardown ile
  temizlendi. Kaynak authoring dosyaları yedekten geri yazılmadı; koşum sırasında
  çalışma ağacına eklenen ayrı Mercedes SLS asset/level düzenlemelerine dokunulmadı.

Koşum başına izolasyon vardır; aynı koşumda hâlâ tek worker ortak projeyi kullanır.
Worker paralelliği artırılmadı. Tamamen zorla sonlandırılan runner ignored
geçici dosya bırakabilir; gerçek authoring dosyalarında geri yükleme gerektirmez.
Uzak browser CI kurulumu F05 kapsamında bekliyor. Kullanım ayrıntıları:
[smoke README](../../tests/smoke/README.md).

## 4. F04–F07 — Küçük starter yayın profili

Tarih: 22 Ekim 2026. Kullanıcı ayrı, küçük starter profilini seçti.

- Kod: uygulandı; son kontroller aşağıda ayrıca kaydedilir.
- Kullanıcı/görsel kabulü ve canlı dağıtım: yapılmadı.
- Uzak CI koşumu: yapılmadı; workflow yapılandırıldı.

### Uygulanan davranış

- `npm.cmd run build:release`, [starter profilini](../../builder/web/profiles/starter.json)
  `builds/release/starter/` altında oluşturur. Normal `build` mevcut demo
  projesinin runtime çıktısını üretmeye devam eder; Terrain, araçlar ve kaynak
  authoring dosyaları değiştirilmez.
- Starter'ın küp geometrisi, checker PNG'si, material, düz arazisi, iki level'ı
  ve HUD/menü JSON'u [proje içindeki üreticide](../../builder/web/starter-content.mjs)
  oluşturulur. Bu özgün içerik için üretim kaydı vardır; mevcut Unknown veya
  placeholder asset'lere yeni lisans atanmamıştır. Dağıtım kararı proje sahibindedir.
- Paketleyici manifest ID'lerini, JSON dosya referanslarını, level loadGroups,
  travel mesajlarını, mevcut model/level sidecar'larını ve glTF/GLB dış
  buffer/image bağımlılıklarını toplar. Game kodunda hesaplanan dinamik
  bağımlılıklar profile açık include listeleriyle eklenmelidir.
- Seçili içerikte eksik kaynak kaydı, Unknown/placeholder lisansı, eksik dosya,
  bozuk JSON veya çözümlenemeyen asset referansı build'i durdurur. Üçüncü taraf
  kayıtları kaynak URL'si, paketlenmiş lisans dosyası ve attribution gerektirir.
  Kayıtların doğruluğunun bağımsız hukuki incelemesi yapılmış sayılmaz.
- Manifest, layout ve landscape URL'leri aynı base yardımcısını kullanır.
  Asset/material/texture ve diğer sidecar yükleyicileri de mevcut
  `projectFileUrl` üzerinden build base'ini kullanır. Node araçlarında base `/` olur.
- Toplam paket, en büyük dosya, en büyük içerik dosyası, ana JS, toplam JS ve
  dosya sayısı için profile ait zorunlu bütçeler vardır. Aşım build'i düşürür.
  Bağımlılık nedenleri/kaynak kayıtları ve boyutlar ayrı JSON raporuna yazılır;
  asset bildirimleri pakete de eklenir. Sıkı dist sınır taraması korunur.
- CI'a kritik Chromium akışları ve gerçek production root/subpath testleri
  eklendi. Rapor, trace/ekran görüntüleri ve paket raporları artifact olarak saklanır.
  Production testi Vite dev server yerine derlenmiş paketleri sunar; alt dizin
  origin'inde kök kopya yoktur, eksik dosyalar HTML fallback yerine 404 döner.
- Production testleri normal/debug modlarında model, harici buffer, texture,
  material, landscape, menü, save/load ve iki yönlü level travel'ı kapsar.

### Doğrulama ve kalan kapsam

- `npm.cmd run build:verify`: geçti; **1.236 engine kontrolü**, 10 import
  denetleyici testi, 5 smoke fixture testi ve **9 yeni yayın/URL testi** başarılı.
  Uygulama/smoke TypeScript, normal build ve sıkı dist taraması dahil.
- `npm.cmd run build:release`: geçti. Nihai root starter **5 manifest asset'i,
  27 dosya, 3.931.498 bayt** (yaklaşık 3,93 MB; sıkıştırılmamış disk boyutu).
  Bütün profile ait boyut bütçeleri geçti. Subpath paket **3.931.576 bayt**.
- `npm.cmd run smoke:critical`: **3/3 geçti (39,9 s)**; editör authoring,
  transform/undo/save/reload/Play; runtime save/load/travel; yürüyerek checkpoint
  autosave ve restore.
- `npm.cmd run smoke:production`: son koşum **4/4 geçti (55,4 s)**; root ve
  `/oyunlar/demo/`, normal/debug, Resume dahil menü kontrolleri, save/load ve
  gidiş-dönüş travel. Model/buffer/texture/material/terrain istekleri başarılı,
  base dışına istek ve browser hatası yok; eksik JSON 404. Sahne ve menü
  ekran görüntüleri üretildi; root normal ve subpath debug sahneleri ile root
  normal menü ayrıca görsel olarak incelendi.
- İlk production koşumunda subpath geçti; root'ta anlık Escape down/up çifti
  kare örneklemesi arasında kaçtı. Tuş basışı 150 ms tutulacak şekilde test
  düzeltildi; zorunlu click veya oyun kodunu atlayan çağrı kullanılmadı. Ardından
  normal/debug dört senaryo iki tam koşumda da geçti.
- `npm.cmd run check:assets`: **879 asset, 47 placeable, 0 hata / 879 uyarı**.
  Uyarılar 877 thumbnail ve iki mevcut kayıtsız sidecar/UI dosyasıdır. Mevcut
  public/ dosyaları ve kaynak manifest değiştirilmedi.

Yeni URL yardımcısının Node engine araçlarında Vite env olmadan da çalışması
tam kapıda yakalanıp düzeltildi. Son tam kapı başarılıdır. Windows sandbox'ının
esbuild üst dizin erişim hatası genişletilmiş yerel çalıştırmayla aşıldı; uygulama
kusuru olarak değerlendirilmedi. Uzak CI, commit/push veya deploy yapılmadı.

F04 seçili starter içeriği için ele alındı; genel kütüphanedeki **813 Unknown**
kaydı açık kalır. F05'in uzak CI kabulü ve gerçek hosting dağıtımı yapılmadı.
F07'nin boyut bütçeleri disk baytlarını ölçer; FPS, GPU bellek veya ilk açılış
transferi kabulü değildir. Bütün oyun kodunun dinamik bağımlılıklarını otomatik
çıkarma, tüm tarayıcı/donanım matrisi ve bütün demo içeriğini optimize etme
iddiası yoktur. Tam geliştirme browser paketinin önceki 49/49 kaydı tarihsel
kanıttır; bu dilimdeki hedefli kontrollerle karıştırılmamalıdır.

Kullanım ve profile yeni içerik ekleme sözleşmesi:
[RELEASE_WORKFLOW](../RELEASE_WORKFLOW.md).

## 5. Sonraki dilimler

- F01'in sunucu/disk kesintisi ve farklı istemcilerde çakışan yazma sınırları.
- F08/F09/F10/F13 bakım, veri tanılama, erken boot hatası ve belge güncelliği.
- Gerçek oyun ihtiyacına göre F11/F12/F14 yaşam döngüsü, klavye ve donanım kabulü.

Kayıt endpoint/validator/asset yükleme güvenlik incelemesi ayrı öneridir.
Bu uygulama diliminde Codex Security taraması başlatılmadı.
