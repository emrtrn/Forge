# River yüzeyi — R0 referans kaydı ve R1 ilk uygulama

Tarih: 30 Ekim 2026. Ana plan: [§7.1 River görsel yakınlaştırma](../planned/WATER_SYSTEM_DEVELOPMENT_PLAN.md#71-river-görsel-yakınlaştırma-planı--30-ekim-2026).

Durum: R1 mikro yüzey/ortam yansıması/güneş parıltısı uygulandı; seçilebilir
profil olarak teknik doğrulandı. River için insan görsel kabulü ve gerçek GPU
performans kabulü açık. R0'ın kayıtlı referansı çıkarıldı; tam görsel/donanım
baseline matrisi tamamlanmadı. R2 dip optiği ve R3 kırılma henüz uygulanmadı.

## Kullanım ve uyumluluk

Editörde Landscape → Water → ilgili River → Flow & Waves bölümünde
**Surface Style → Lake-like** seçilir. **Surface Strength** (0–2, başlangıç 2)
ve **Surface Roughness** (0.04–1, başlangıç 0.2) bu profil için kullanılabilir.
Legacy seçimi önceki malzemeyi korur; yeni alanları olmayan eski kayıtlar Legacy
olarak açılır. Stil seçimi ve sayısal ayarlar undo/redo ile geri alınabilir,
Save/Reload ve Play'e taşınır. Yeni alanlar runtime/save ortak guard'ıyla
sonlu sayı ve aralık açısından denetlenir; bilinmeyen stil reddedilir.

Kullanıcının Terrain sahnesine profil otomatik uygulanmadı. Lake shader'ı,
ayarları, terrain, ışıklar ve bake dosyaları değiştirilmedi. Profil seçmek köpüğü
yeniden hesaplamayı gerektirmez; mevcut geometri bake akışı korunur.

## R0 — Kayıtlı referans

Deponun varsayılan sahnesi
`public/assets/starter-content/Levels/Terrain.level.json` içindeki `lake-1` ve
`river-water-1` esas alındı. [Referans JSON](evidence/river-surface-r1/terrain-reference.json),
`8868a1aa` üzerindeki kayıtlı verilerin R1 resolver'larıyla çözümlenmiş halidir;
çalışan grafik profilinin veya GPU baseline'ının ölçümü değildir.

- Lake: surfaceStrength 2, roughness 0.2, absorptionDistance 2,
  reflectionStrength 0.5, sharedPlanar/high, refractionStrength 1.
  Renk fallback'leri `#234f4b` / `#779a82`, opacity 0.35, bedVisibility 0.9.
- River: flowSpeed 0.1, normalScale 1, waveAmplitude 0.1;
  renk fallback'leri `#164c50` / `#76b6a6`, opacity 0.65, absorptionDistance 3,
  bedVisibility 0.88, reflectionStrength 0.34. R1 sonrasında da kayıtta stil
  bulunmadığı için Legacy'dir.
- Kayıtlı çevre: ACES, SMAA, bloom threshold/intensity 1/1, AO açık;
  sky-light capture intensity 0.5, directional intensity 5 ve CSM açık.
  World Environment saati ilerleyebildiği için bu JSON tek başına sabit ışık
  veya kabul edilmiş ekran görüntüsü yerine geçmez.

Teknik fixture `tests/smoke/pages/river-water-optics.ts`: 800×480, DPR 1,
Perspective 48° veya orthographic kamera, deterministik shader zamanı,
checker dip, üretilmiş normal dokusu, sabit renkli PMREM/probe girdileri.
Yeni düz-yüzey karşılaştırmasında Lake planar kapalıdır; yalnız ortak ortam
enerjisi karşılaştırılır. Kullanıcı sahnesinin sanatsal görünüm kabulü değildir.

## R1 — Değişen davranış

- `riverWater.ts` Lake'in mevcut `LAKE_SURFACE_GLSL` yardımcılarını yeniden
  kullanır. Lake dosyası değiştirilmez. Üç normal katmanı, düzensiz gradyanlar
  ve uzak mikro detay sönümü nehrin akış tangent/bitangent çerçevesinde çalışır.
  Kıyıdaki akış yavaşlaması ve rapid bölge etkisi korunur.
- Strength mikro normali, Normal Scale desen ölçeğini kontrol eder. Geometrik
  dalga, spline yüksekliği ve CPU su sorgusu değiştirilmez. Eğim ve nesne
  dönüşümü geometrik yüzey normalinden alınır.
- Lake-like profilinde ortam ve güneş aynı filtrelenmiş roughness'i kullanır.
  Low profilinde roughness 0.15 artırılır ve mevcut sparkle detay anahtarı kapanır.
  Bu, bütün River efektlerinin global Lake kalite politikasına bağlandığı
  anlamına gelmez; o entegrasyon R4'te açık kalır.
- Lake-like ortam yansıması doğrudan rough Fresnel ve gerçek ortam/probe
  kapsamıyla birleştirilir; eski daraltılmış katsayı ve RGB 2 tavanı uygulanmaz.
  Köpük ortak composite aşamasında su arayüzünü örter.
- Yeni profilde güneşin ilave 0.35 çarpanı kaldırılır; Lake ile aynı 0–0.35 m
  sığlık sönümü kullanılır. Ortak sonlu GGX/HDR güneş fonksiyonu korunur;
  çevre ışığı, exposure veya bloom kullanıcı ayarları değiştirilmez.
- River'a yeni planar capture, render target veya scene snapshot eklenmez.
  Ek shader örnekleme/ALU maliyeti gerçek GPU'da henüz ölçülmedi.

Renk türbülansı, eski dip alpha birleşimi ve kırılma eksikliği hâlâ vardır;
Lake ile tam görsel eşdeğerlik iddia edilmez. Planar geometri yansıması ilk
River tesliminin dışında kalır.

## Doğrulama

- `npx tsc --noEmit`: geçti.
- `npm run test:engine`: **2167 kontrol geçti**.
- `npm run build:verify`: geçti; slow engine, strict runtime-only dist ve dünya
  verisi denetimi dahil. Son test-fixture düzenlemelerinden sonra
  `npm run verify:smoke-fixtures` ayrıca geçti.
- Gerçek editor testi: **1/1 geçti**; yeni stil seçimi, undo/redo, sayısal
  kontroller, Save/Reload, terrain sculpt/undo ve runtime ayar aktarımı.
- Optik suite: son geniş koşuda **15/16 geçti**; yeni dört Lake-like kontrolünün
  tamamı geçti. Kalan Lake yeniden oluşturma karşılaştırmasında 1 kanal için
  0.67/255 fark vardı: fixture optik zamanı sabitlerken geometrik dalga gerçek
  saati kullanıyordu. Fixture artık iki saati de sabitler; etkilenen Lake
  kontrolleri tekrar çalıştırıldı: **2/2 geçti**. Böylece bütün 16 optik kontrol
  başlığı geçti; son iki kontrol zaman düzeltmesinden sonra doğrulandı. Ürün
  Lake kodu değişmedi.

Tarayıcı: sistem Chromium + ANGLE/Vulkan **SwiftShader** (yazılım renderer).
Testler repo Playwright düzenini, özel 5273 portunu ve izole smoke verisini
kullanır. Makineye özel Chromium yolu yalnız `/tmp` config'indedir; repo/CI
config'i değiştirilmedi. Yazılım WebGL kontrolleri GPU performans kabulü değildir;
yalnız texture sayısı byte/transient tepeyi ölçmez.

Teknik kanıtlar:

- [Düz Lake/River arayüz enerjisi](evidence/river-surface-r1/lake-like-interface.json):
  aynı ortam/roughness ile üstten ve yatay kamerada RGB enerji farkı <3/255.
- [Eğim/dönüşüm/animasyon](evidence/river-surface-r1/lake-like-motion.json):
  perspective ve orthographic dönüşüm tutarlılığı, hareket ve strength 0.
- [Güneş karşılaştırması](evidence/river-surface-r1/lake-like-sun.json):
  izole fixture'da kırmızı kanal ortalaması Legacy 79.78, Lake-like 84.31/255;
  her ikisinde 7 texture. Bunlar tonemap sonrası piksel değeridir, fiziksel
  enerji veya GPU süresi değildir.
  [Legacy görüntü](evidence/river-surface-r1/river-legacy-sun.png),
  [Lake-like görüntü](evidence/river-surface-r1/river-lake-like-sun.png).
- [20 stil/kalite geçişi](evidence/river-surface-r1/lake-like-lifecycle.json):
  texture sayısı 4'te sabit, WebGL hatası yok. Bu farklı fixture ayarının sayısı
  güneş koşusunun 7 texture'ıyla doğrudan bellek karşılaştırması değildir.
- [Editor](evidence/river-surface-r1/editor-lake-like.png) ve
  [runtime](evidence/river-surface-r1/runtime-lake-like.png) teknik fixture
  görüntüleri; kullanıcı sahnesi görsel kabulü yerine geçmez.

Mevcut tarayıcı fixture'ındaki iki eski varsayım düzeltildi: Lake yansıması
karşılaştırma yapılırken açık olmalı; emekliye ayrılmış manuel point foam'un
çizilmesi beklenmemeli. İkinci test şimdi eski kaydın iki profilde de manuel
halkaları geri getirmediğini denetler. Otomatik bake köpüğü bu testle tamamlandı
sayılmaz; mevcut engine/save testleri korunur.

## Sonraki dilim

R2: River'ın opaque renk/depth snapshot tüketicisi olması, yerel eğime uygun dip
optiği ve köpük dahil kıyı birleşimi. Bundan önce mevcut profili kullanıcı kendi
sahnesinde karşılaştırabilir. R3 kırılma, sabit Lake düzlemi kopyalanmadan,
River yüzeyi/kapsamı doğrulanarak ayrı geliştirilir. R0'ın gündüz/gölge/gece,
yakın/uzak ve gerçek GPU AB/BA baseline'ı ile sayısal bütçesi açık kalır.
