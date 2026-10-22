# Forge güvenilirlik — aktif iş listesi

Tarih: 21 Ekim 2026. Son güncelleme: 22 Ekim 2026.
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

## 5. F10 + F13 — Erken açılış hatası ve güncel sözleşmeler

Tarih: 22 Ekim 2026.

- Kod/belge: uygulandı.
- Otomatik doğrulama: tam `build:verify`, kritik Chromium paketi ve
  root/subpath production paketi geçti; ayrıntılar aşağıda.
- Görsel kontrol: hata ekranı 1280×720 ve 390×844 görünümde incelendi.
- Kullanıcı kabulü, gerçek desteklenmeyen cihaz ve uzak CI: yapılmadı.

### Uygulanan davranış

- [Boot hata ekranı](../../src/bootError.ts) Three.js, renderer, project
  veya oyun modülüne bağımlı değildir. `main()` rejection'ı görünür bir açıklama,
  açılabilir hata ayrıntısı ve **Reload page** düğmesiyle karşılanır.
- WebGL2 yokluğu için donanım hızlandırma/tarayıcı desteği açıklaması vardır.
  Diğer renderer ve kritik modül yükleme hatalarında bağlantı ve yeniden
  yükleme önerisi gösterilir. Ayrıntılar düz metindir; asıl hata konsola yazılır.
- Runtime/capability/game import'ları `main()` içindeki dinamik yüklemeye
  taşındı; kritik runtime chunk'ı indirilemediğinde de hata ekranı çalışır.
  Editör import'ları aynı catch sınırındadır. Debug chunk'ının paketlenip yalnız
  `?debug` ile yüklendiğini açıklayan eski yorum düzeltildi.
- Hata paneli odak alır, kısmen kurulmuş arayüz `inert` olur. Ayrıntılar ve
  Reload klavyeyle kullanılabilir. Reload yeni sayfa yüklemesidir; yarım kalan
  runtime üzerinde tekrar kurulum denenmez.
- Renderer kurulduktan sonraki project/level hatalarının mevcut LoadingOverlay
  **Retry** akışı korunur.
- [Save sözleşmesi](../architecture/SAVE_GAME_CONTRACT.md) engine payload,
  capability ve host sahipliğiyle güncellendi. Araç pose/hız/drivetrain,
  `drivingVehicleId`, eski save uyumu ve gerçek restore sırası belgelendi.
  Aynı origin'deki fork'ların farklı manifest adı kullanması gerektiği açıklandı.
- [Katmanlı runtime planında](../architecture/FORGE_LAYERED_RUNTIME_PLAN.md)
  tamamlanan A–I kod fazları, tarihsel otomatik kanıtlar ve açık kaynak denetimi
  ayrıldı; eski ilk-oturum uygulama talimatı aktif plana yönlendirildi.
- Eski yeterlilik analizi tarihsel/kısmi olarak işaretlendi. Skeletal-facing
  backlog'undaki movement/AI yolları güncellendi; aktivasyon koşulu korunur.
  Smoke README artık mevcut CI kritik/production komutlarını açıklar.
  Araç planındaki 60/144 Hz kullanıcı kabulü açık kalır.

### Doğrulama

- `npx.cmd tsc --noEmit` ve `tsconfig.smoke.json` geçti; yeni development ve
  production testleri tip kapsamına dahil.
- `npm.cmd run build:verify`: **1.236 engine kontrolü**, 10 import denetleyici,
  5 fixture ve 9 yayın/URL testi geçti. Production build ve sıkı dist taraması
  geçti; 368 kaynak dosyasında yasak doğrudan import yok.
- `npm.cmd run smoke:critical`: **9/9 geçti (43,8 s)**. Altı yeni
  [boot regresyonu](../../tests/smoke/boot-errors.spec.ts): runtime/editör
  WebGL2 yokluğu ve klavyeyle reload sonrası toparlanma, iki modda kritik
  modül hatası, beklenmeyen renderer hatası, project hatasında mevcut Retry
  ve başarılı reload. Normal authoring/save/Play, checkpoint ve save/load/travel
  üç akışı da geçti. Yeni boot testleri CI kritik komutuna dahil edildi.
- [Production boot testleri](../../tests/production/boot-errors.spec.ts)
  derlenmiş root ve `/oyunlar/demo/` paketlerinde WebGL2 hatası/reload ve gerçek
  runtime chunk HTTP 503 durumunu kapsar. `npm.cmd run smoke:production`:
  normal/debug içerik ve menü akışlarıyla birlikte **8/8 geçti (57,1 s)**.
  Yeni root paket 35 dosya / **3.938.250 bayt**; tüm yayın bütçeleri geçti.
- Desktop ve dar görünüm ekran görüntüleri `test-results/boot-errors-*/`
  altında üretildi; runtime hata ekranında taşma görülmedi. Klavye odağı,
  ayrıntı açma ve Reload düğmesine erişim browser kontrolünde doğrulandı.

İlk sandbox koşumu esbuild üst dizin erişim hatasında durdu; genişletilmiş
yerel izinle aynı browser ve build komutları çalıştı. Bu ortam engeli uygulama
hatası olarak sınıflandırılmadı. Hata senaryoları kontrollü browser enjeksiyonudur.
İlk HTML/entry script'in hiç indirilememesi veya JavaScript'in kapalı olması
bu catch sınırına girmez; context-loss sonrası çalışma zamanı kurtarma bu dilime
dahil değildir. Tam development browser paketi yeniden çalıştırılmadı; önceki
49/49 kanıtı tarihsel kalır. Belge değişiklikleri yeni kullanıcı/donanım kabulü
anlamına gelmez. Kaynak inceleme raporu tarihsel kanıt olarak değiştirilmedi.

## 6. F09 — Runtime okuma sözleşmeleri ve içerik tanılaması

Tarih: 22 Ekim 2026.

- Kod: project/asset manifest, level ve dört model sidecar türü için uygulandı.
- Asset health: preview bilgisi, model companion sınıflandırması ve yeni uyarı
  baseline kapısı uygulandı. Kaynak public dosyaları değiştirilmedi.
- Kullanıcı kabulü, uzak CI ve gerçek cihaz/ağ arızası kabulü: yapılmadı.

### Uygulanan davranış

- [Ortak okuma katmanı](../../src/project/contentLoader.ts), authored dosya yolu
  ve `network`, `http`, `invalid-json`, `invalid-data`, `unsupported-version`
  nedenleriyle `ContentLoadError` üretir. Yanıt gövdesinin bağlantı hatasıyla
  okunamaması, JSON sözdizimi hatasından ayrılır.
- Project manifest schema 1 ve runtime'ın kullandığı temel blok/yollar;
  asset manifest version 1, kayıt alanları ve benzersiz asset ID'leri denetlenir.
  Asset manifest'in mevcut engine doğrulayıcısı kullanılır; Node/save validator
  runtime'a taşınmaz. Başarısız manifest promise'leri sonraki okumayı engellemez.
- [Level okuma kontrolü](../../engine/scene/layoutValidation.ts), schema 1,
  zorunlu koleksiyonlar, yerleşim transform'ları, koleksiyon kimlikleri ve temel
  actor/light/spline yapısını doğrular. Legacy scalar scale/rotationYDeg,
  extension alanları ve eski reflection dönüşümü korunur.
- Collision, UVW, skeleton ve material-slot sidecar'larında opsiyonel 404
  sessizce taze default döndürür. Diğer HTTP/ağ, JSON, üst yapı ve sürüm
  hataları dosya yolu/neden/default seçimiyle bir kez uyarılır. Aynı hatanın
  eşzamanlı tekrarları log yağmuru oluşturmaz; başarı/404 tanılamayı yeniden kurar.
  Schema 1 ve versionless legacy sidecar'lar desteklenir.
- Runtime boot ve travel hata ekranları artık sorunlu dosya/alanı gösterir;
  mevcut Retry sayfayı yeniden yükler. Editor aynı read sözleşmelerini kullanır.
- Yeni travel testi gerçek bir pointer-lock sorunu yakaladı: loading sırasında
  menü stack'i temizlenince fare yeniden kilitleniyor ve Retry normal tıklamayı
  alamıyordu. Loading sırasında kilit serbest bırakılır ve stack kapanışı kilidi
  geri alamaz; kilit kaybı loading üstüne pause menüsü açmaz.
- Eksik thumbnail kayıtları `info` olarak tek satırda özetlenir. Kayıtlı modele
  bağlı skeleton/collision/material/UVW/vertex-color sidecar'ları ayrı manifest
  asset'i gerektirmez; gerçek orphan companion dosyaları uyarı olarak kalır.
- `check:assets`, tam JSON raporunu `builds/reports/asset-health.json` içine
  yazar. Yeni actionable uyarılar [baseline](../../tools/baselines/asset-health.json)
  dışındaysa komut başarısız olur. Mevcut kayıt dışı `SaveLoadMenu.ui.json`
  bilinen tek uyarıdır; dosya/manifest değiştirilmedi. CI rapor artifact'i eklenmiştir.

### Doğrulama

- Yeni [12 engine regresyonu](../../tests/engine/contentLoading.test.ts):
  bozuk/future project/manifest/level, güncel public/starter/smoke level'larının
  uyumu, legacy dönüşümler, HTTP/ağ/yarım yanıt/JSON ayrımı, manifest retry/cache,
  dört sidecar türünde sessiz 404, taze defaults, eşzamanlı uyarı dedup ve re-arm,
  preview/companion/orphan sınıflandırması ve baseline karşılaştırması.
- `npx.cmd tsc --noEmit` geçti. `verify:content-types`, bu test dosyasını ve
  asset-health aracını ayrıca tip denetimine alır; tam kapıya dahildir.
- `build:verify`: **1.248 engine kontrolü**, 10 import, 5 fixture ve 9 yayın/URL
  kontrolü geçti. 371 kaynak dosyasında yasak doğrudan import yok; production
  build ve sıkı dist taraması geçti.
- `smoke:critical`: **16/16 geçti (yaklaşık 1,1 dakika)**. Yedi yeni content
  browser senaryosu, önceki boot hataları ve normal editor/runtime akışları dahil.
  İlk koşumda yalnız travel Retry başarısızdı (15/16); pointer-lock düzeltmesiyle
  hedefli senaryo ve ardından kritik paketin tamamı geçti. Forced click yoktur.
- Pointer/input değişikliği için mevcut locomotion ve yürüyerek portal
  round-trip testleri ayrıca **2/2 geçti (22,5 s)**.
- `smoke:production`: derlenmiş root ve `/oyunlar/demo/` starter paketlerinde
  **10/10 geçti (yaklaşık 1 dakika)**. Desteklenmeyen level sürümünde dosya
  açıklaması ve normal Retry; önceki WebGL/chunk hataları, normal/debug içerik,
  menü, save/load ve iki yönlü travel dahil. Yayın bütçeleri geçti.
- `check:assets`: **879 asset / 47 placeable / 0 hata / 1 uyarı / 877 bilgi**.
  Boş geçici baseline ile bilinen uyarının exit code `1` ürettiği doğrulandı;
  normal baseline ile komut tekrar geçti. Baseline otomatik genişletilmedi.
- Dosya yolu içeren hata ekranı 1280×720 ve 390×844 görünümde incelendi;
  yatay taşma yok, Retry erişilebilir. Görseller `builds/evidence/f09/` altında.

Sözleşme ve kullanım ayrıntıları:
[CONTENT_LOADING_CONTRACT](../architecture/CONTENT_LOADING_CONTRACT.md).

### Kalan sınırlar

Bu, bütün nested feature parametrelerini doğrulayan eksiksiz JSON şeması
değildir. Mevcut feature normalizer'ları enum/default ve bazı bozuk nested
değerleri işlemeye devam eder. Diğer asset/landscape/foliage/VFX yükleyicileri
bu ortak tanılama katmanına taşınmadı. Yeni editor-specific hata diyaloğu
eklenmedi. Tam development browser paketi yeniden çalıştırılmadı. Hata
senaryoları kontrollü browser/fetch enjeksiyonudur; gerçek ağ/disk kesintisi,
güvenlik taraması, uzak CI veya canlı hosting kabulü anlamına gelmez.

## 7. Sonraki dilimler

- F01'in sunucu/disk kesintisi ve farklı istemcilerde çakışan yazma sınırları.
- F08 için davranışı koruyan dar controller/test bakım dilimleri.
- Gerçek ihtiyaç oluşursa F09'un diğer loader/nested değer tanılama kapsamı.
- Gerçek oyun ihtiyacına göre F11/F12/F14 yaşam döngüsü, klavye ve donanım kabulü.

Kayıt endpoint/validator/asset yükleme güvenlik incelemesi ayrı öneridir.
Bu uygulama diliminde Codex Security taraması başlatılmadı.
