# River R3 — Yerel yüzey doğrulamalı kırılma

Tarih: 30 Ekim 2026. Ana plan: [§7.1 R3](../planned/WATER_SYSTEM_DEVELOPMENT_PLAN.md).

Durum: İlk uygulama ve aşağıdaki teknik kontroller tamamlandı. Kullanıcı görsel kabulü,
gerçek GPU AB/BA maliyeti ve production tarayıcı kabulü açık.

## Kullanım ve kayıt

Landscape → Water → River → **Refraction Strength**: 0–2; varsayılan **0,65**.
Sıfır ek yüzey atlasını hazırlamaz. Mevcut Surface Strength/Roughness, akış,
geometrik dalga ve dip optiği kontrolleri korunur. Stil ayrımı eklenmez.

`refractionStrength`, layout/resolver, ortak read/save guard'ı, save allowlist,
Details patch ve undo/redo yoluna birlikte eklendi. Sonlu olmayan veya aralık
dışı kayıt reddedilir. Eski kayıtlarda varsayılan değer kullanılır; kullanıcı
sahnesine yeni alan veya başka görünüm/ışık ayarı otomatik yazılmaz.

Yeni efekt, mevcut `lakeReflectionQuality` grafik tavanı `off` değilse
(Yüksek/Ultra) ve authored River ayrıntısı Low değilse izinlidir. Editör ve runtime
kalite/adaptif güncellemesi yalnız atlası bırakır/yeniden hazırlar; geometriyi ve
kayıtlı ayarı değiştirmez. Bu sınırlı kapı R4'ün diğer River efektlerini kapsamaz.

## Yüzey adaptörü

`riverRefraction.ts`, mevcut `RiverSurfaceQuery` mekânsal indeksini kullanarak
tek float texture içinde hücre aralıkları, üçgen referansları, vertex konumu,
imzalı dip derinliği ve dalga girdilerini saklar. Grid su maskesi değildir:
kapsam, barycentric üçgen ve signed-depth testiyle doğrulanır. Dar kanal, gerçek
boşluk ve kısmen kuru üçgeni daha düşük çözünürlükte yeniden rasterize etmez.

Shader, mevcut fragment'in eğimli teğet düzlemiyle aday hücreyi bulur; aday
ışın ile gerçek üçgenlerin kesişimini sınar. Hücre tahmini gerçek yüzeyi
bulamazsa kaydırmasız R2 rengine döner. Dünya-Y sabit göl düzlemi kullanılmaz.
Perspektif ve orthographic ışınlar, CPU'da birleştirilmiş view↔local matrisleriyle
sorgulanır; GPU'da büyük dünya origin'leri birbirinden çıkarılmaz.

Mevcut vertex dalgası `riverWaves.ts` yardımcı fonksiyonuna çıkarıldı. Çizilen
vertex ve sorgulanan üçgen vertex'i aynı zaman/UV/rapid/flow girdileriyle aynı
hareketi uygular. Yeni geometrik dalga veya CPU fizik sorgusu modeli eklenmedi.

## Kenar korumaları

- Kaydırma en fazla **8 ekran pikselidir**; sığlık ve yatay bakışta azalır.
- Orta ve son aday UV, bu nehrin gerçek üçgenleriyle doğrulanır. Yakın düzlem
  önündeki, dip arkasındaki, kuru veya bağlantısız kot kesişimleri reddedilir.
- Kaydırılan rengin bilinear dört pikselinin her biri depth ile denetlenir.
  Tek nearest depth örneği, komşu kaya siluetinin renge karışmasına izin vermez.
- Kaya yüzü ile uzak dip arasındaki ani yol uzunluğu değişiminde kırılma
  reddedilir. Ekran kenarı, boş depth ve başarısız aday kaydırmasız R2'ye döner.
- Atlas sadece kendi nehrine aittir; başka Lake/River'ı kapsama diye kullanmaz.
  Ortak snapshot zaten bütün şeffaf su çizimlerinden önce alınır.
- Snapshot yoksa veya kamera/target yolu uygun değilse kırılma kapalıdır.
  Atlas GPU'ya yalnız geçerli snapshot yolunda bağlanır.

## Bütçe ve kaynak ömrü

| Alan | Uygulanan tavan |
| --- | --- |
| Tek atlas CPU backing / GPU veri | Ayrı ayrı en fazla 8 MiB |
| Kaynak vertex / üçgen | 65.536 / 32.768 |
| Atlas indeks referansı | 262.144 |
| Hücre başına GPU aday | 16; orta ve son UV için ayrı sınır |
| Ek sampler / sahne render'ı / draw | 1 / 0 / 0 |
| Texture filtreleme | Float RGBA, nearest; mipmap yok |

Bütçe aşılırsa bütün gövdenin kırılması kapanır; çözünürlük sessizce düşürülmez.
R2 mesh'i korunur ve Details'ta fallback notu görünür. Sayılar teorik depolama ve
iş sınırlarıdır; ölçülmüş GPU süresi veya süreç transient bellek tepesi değildir.
Birden fazla nehrin toplam bellek/GPU kabulü ayrıca açıktır.

Atlas, River mesh revision'ına aittir. Oluşturma/rebuild veya kalite geçişinde
bir kez hazırlanır; her kare terrain/nesne taraması, CPU geometri güncellemesi
veya readback yoktur. Son tüketici atlası bırakır; başka suyun snapshot'ını
bozmaz. Dispose edilmiş mesh geç kalite çağrısıyla atlasını yeniden üretemez.
Hazırlıkta mevcut Query'nin geçici indeks belleği de vardır; gerçek transient
tepe bu teslimde ölçülmüş sayılmaz.

## Doğrulama

Son üretim kodunda:

- TypeScript geçti; son fixture genişletmesinden sonra da yeniden geçti.
  `verify:smoke-fixtures` son kaynakta geçti.
- `npm.cmd run build:verify`: **çıkış kodu 0**; slow engine **2168 kontrol**,
  strict runtime-only dist ve dünya verisi denetimi dahil.
- Birleşik Playwright koşusu **27/27 geçti**: 21 optik (3 R3 dahil), 1 gerçek
  editör kayıt/runtime akışı ve 5 otomatik köpük/malzeme kontrolü.
- İlk runtime fixture'ında authored post-process pass yoktu; strength 0 ile
  doğrudan render fallback'i kullandı. Editörde kayıtlı strength **1,2**, atlas
  **163.840 byte**. Etkin runtime High→Low→High kontrolü için yalnız izole
  fixture'a açık SMAA actor ayarı eklendi; ürün direct fallback'i değiştirilmedi.
- Genişletilen gerçek editör/runtime testi ayrıca **1/1 geçti**: Yüksek kalitede
  strength **1,2** / atlas **163.840 byte**, Low'da **0 / 0**, tekrar Yüksek'te
  **1,2 / 163.840 byte**. Kayıtlı değer ve kaynak geometri korunur. Birleşik 27'lik
  koşudan sonra yalnız bu genişletilen kontrol ve tür kontrolleri tekrarlandı.

Kontrol kapsamı:

- Engine: kayıt aralıkları/varsayılanlar, atlasın birebir vertex/üçgen verisi,
  imzalı kuru derinlik, gerçek boşluk, bütçe aşımı, strength 0 ve Low.
- Engine: 20 kalite kapısı geçişi, aynı geometri buffer'ı, tek atlas sahipliği,
  dispose sonrası geç kalite çağrısı ve bütçe aşımında R2 mesh'inin korunması.
- WebGL: eğimli perspektif/orthographic kırılma, sahne dönüşümü, strength 0,
  Low/direct fallback; kaya rengi, gerçek boşluk, kuru kıyı ve sığlık korumaları.
- WebGL: çizilen geometrik dalga vertex'leri, iki farklı kotta Lake+River,
  ters çizim sırası ve 20 kalite tavanı döngüsünde kararlı texture sayısı.

Tarayıcı sistem Chromium / ANGLE Vulkan **SwiftShader** kullanır; gerçek GPU
timer desteği yoktur. GPU süre bütçesi, transient süreç byte tepesi, production
tarayıcı koşusu ve kullanıcının gündüz/gölge/gece görsel kabulü açık kalır.

Kayıtlı Terrain sahnesinin yalnız CPU source/atlas kontrolünde **2756 vertex**,
**5064 üçgen**, **557.056 byte (544 KiB)** atlas bulundu. Okunan level/terrain/tile
hash'leri [kaynak bütçesi kaydındadır](evidence/river-refraction-r3/terrain-source-budget.json).
Bu kontrol sahneyi değiştirmez ve GPU veya kullanıcı sahnesi görsel kabulü değildir.

Kanıtlar:

- [Eğim, kamera ve fallback](evidence/river-refraction-r3/river-r3-motion.json),
  [perspektif görüntü](evidence/river-refraction-r3/river-r3-false.png).
- [Kaya, kuru kıyı, boşluk ve sığlık](evidence/river-refraction-r3/river-r3-guards.json).
- [Dalga, farklı kotlar ve kaynak döngüleri](evidence/river-refraction-r3/river-r3-mixed-lifecycle.json).
- [Editör/runtime kaydı](evidence/river-refraction-r3/world-river.json),
  [editör görüntüsü](evidence/river-refraction-r3/world-river-editor.png).

İlk kaya kontrolü bilinear renk örneklemesinde 6 piksellik sızma yakaladı.
Dört depth tap'i ve yol sürekliliği korumasından sonra aynı kontrol geçti.
Bu fixture kanıtı kullanıcı sahnesinin sanatsal kabulü yerine geçmez.

Yeni kalıcı alan nedeniyle kapsamlı Codex Security diff incelemesi önerildi;
kullanıcı başlatmadığı/onaylamadığı için tarama yapılmadı.

## Kaynak uyarlama kaydı

Ekran kaydırma/depth fallback yaklaşımı mevcut `lakeRefraction.ts` yolundan
uyarlandı; onun Ultra-Water `OceanSurface.js` kaynak sürümü
`ce9248fa20afbdf63fd4c11709f68d7368aca0a0` olarak korunur. Yeni River exact-atlas,
yerel ray/üçgen ve dört renk tap'i korumaları Forge'a aittir. Mevcut MIT bildirimi
ve `Copyright (c) 2026 Humpalumps`, `public/licenses/ultra-water.txt` içinde kalır;
başka demo/atmosfer/fizik kodu veya yeni bağımlılık alınmadı.
