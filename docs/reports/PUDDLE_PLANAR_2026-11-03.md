# Puddle planar yansıma — Faz 1 / 3 Kasım 2026

Durum: **Uygulandı ve teknik doğrulandı.** Hedef GPU'da eşlenik CPU/GPU süre ve
tepe bellek kabulü ile kullanıcı görsel kabulü ayrıca açık kalır.
[Ana plan](../planned/PUDDLE_DEVELOPMENT_PLAN.md#faz-1--göldeki-gibi-planar-yansıma).
Canlı deforme yatak ve gerçek araç Wheel Ripples bağlantısı bu teslimde yoktur;
Faz 2 ve Faz 3 ayrı uygulanacaktır.

## Kullanım

World Terrain → Landscape Mode: Water → Add Puddle → çukura tıkla. Taslakta veya
Water Bodies listesinden seçilen kalıcı Puddle'da **Reflection** bölümünü aç:

- **Mode:** Environment veya Planar Reflection.
- **Quality:** Low ortam yansıması; Medium 256 px / en az 32 ms, High 512 px /
  en az 4 ms mevcut planar kaynak profilidir. Genel grafik kalitesi tavan koyar;
  örneğin High grafik profili authored High yansımayı Medium ile sınırlar.
- **Planar Strength:** 0–1, yalnız planar birleşimin etkisi.
- **Environment Reflection:** 0–3, mevcut ortam yansıması yoğunluğu.

Yeni Puddle taslağı Planar / Medium ile başlar. Create Puddle aynı ayarları
kalıcı gövdeye aktarır. Yeni alanları olmayan eski kayıtlarda Environment
davranışı ve eski `reflectionStrength` anlamı korunur. Canlı yansıma görüntüsü
kaydedilmez; yalnız ayarlar Save/Reload/Play ve undo/redo'ya katılır.

## Uygulama ve kaynak sınırları

- `PuddlePlanarReflections` editörde taslak ve kalıcı gövdeler, Play'de runtime
  gövdeleri için tek sahne sahibi olarak kullanılır. `WaterReflectionRegistry`
  üzerinden varsayılan `water` grubundaki aynı kot/etkin kalitedeki Lake/River
  kaynağını ödünç alır. Farklı kotlar aynı kamerayla yansıtılmaz.
- Görünür gruplar için Puddle nedeniyle en fazla iki ek bağımsız kaynak
  oluşturulur. Önceden var olan coplanar kaynak ikinci kez sayılmaz. Mevcut
  görünür gruplar kararlı öncelik taşır; eşitlikte kot/kalite anahtarı sırası
  kullanılır. Grup seçimi en fazla 100 ms aralıkla yenilenir; ayar değişimi ve
  kamera nesnesi değişimi anında geçersizleştirir. %1 ekran kaplama eşiği ve
  mevcut gruplar için %0,75 bırakma eşiği kullanılır; capture'ın kendi %1 eşiği
  de geçerlidir. Eşik altı, bütçe dışı veya Low kalite ortam yansımasına döner.
- Bir ana sahne çiziminde sonraki Puddle consumer'ları aynı kaynak güncellemesini
  tekrar başlatmaz. Paylaşılan capture'ın kendi zaman ve recursive-camera
  korumaları korunur. Bu, Lake/River'ın tüm sahne maliyetine yeni bir global
  tavan getirildiği anlamına gelmez.
- İlk gerçek capture'a kadar ortam yansıması kalır. Shader Fresnel, kenar fade'i,
  roughness'a bağlı küçük filtre ve premultiplied HDR renk/coverage birleşimi
  kullanır. Ortam ile planar görüntü toplanmaz; kapsanan geometri karıştırılır.
- Su yüzeyleri ve taslak yardımcıları mevcut capture dışlama yolunu kullanır.
  Hide/Delete/Discard, kalite/kot değişimi, undo/redo ve level/Edit/Play geçişleri
  consumer bağlarını ve kaynak paylarını bırakır. Genel kalite değişimi terrain
  veya su geometrisini yeniden kurmaz, kayıtlı kaliteyi değiştirmez.
- Alanlar ortak `validatePuddleWater` ile doğrulanır. Save validator zaten bu
  fonksiyonu çağırır; yeni endpoint veya ayrı save allowlist'i eklenmemiştir.

## Doğrulama

- `npx.cmd tsc --noEmit`: geçti.
- `npm.cmd run build:verify`: geçti; **2353 engine kontrolü**, smoke/content/UI
  tür kontrolleri, builder kontrolleri, üretim derlemesi, strict dist ve world-data.
- Puddle engine regresyonları: eski dosyanın görünüm varsayılanı, yeni alanların
  save/read/partition round-trip'i, geçersiz enum/sayı reddi, Lake lease paylaşımı,
  iki ek kaynak tavanı, boşalan slot, 512 px High / 256 px kalite tavanı, gizli
  parent/ekran dışı yüzey ve taslak ayarlarının kalıcı gövdeye aktarımı.
- Puddle editör testleri: **3 geçti**; oluşturma/taslak koruması, mevcut kalıcılık
  akışı ve yeni planar GPU/kalite/Save/Reload/Play senaryosu. Son panel düzenlemesi
  sonrası planar testi ve avlu prototip regresyonu ayrıca **2/2 geçti**. Toplam
  dört farklı tarayıcı senaryosu doğrulandı; planar senaryo iki koşuda da geçti.
- Yeni GPU testi aynı marker ve kamera ile planar açık/kapalı gerçek render
  piksellerinde fark arar; capture oluşmasını, kaynak sayısını, kalite tavanını,
  undo'yu ve kaydın runtime'da tekrar yansıma üretmesini doğrular. Terrain dosya
  hash'leri korunur; testlerde console/WebGL hatası yoktur. Yazılım/CI WebGL
  doğrulaması hedef donanım FPS/GPU süresi kabulü olarak sunulmaz.
- Kayıt sözleşmesi değiştiğinden Codex Security diff incelemesi önerildi; tarama
  için kullanıcı ayrıca onay vermediğinden güvenlik taraması çalıştırılmadı.

## Görsel kanıtlar

- [Taslak ve Reflection kontrolleri](evidence/puddle-planar/puddle-planar-draft.png)
- [Planar açık: marker'ın su üzerindeki yansıması](evidence/puddle-planar/puddle-planar-created.png)
- [Environment: aynı marker ve kamerada planar kapalı](evidence/puddle-planar/puddle-planar-environment.png)
- [Kaydedilen Puddle'ın runtime yansıması](evidence/puddle-planar/puddle-planar-runtime.png)

Bu görüntüler kontrollü küçük havza fixture'ıdır; kullanıcının çamurlu araç
sahnesinde sanat/görsel kabulü veya deformasyon sorununun çözümü sayılmaz.
Faz 2'de yatak/su sınırı; Faz 3'te gerçek teker temasından dalga üretimi ele alınır.
