# Islak çamur katmanı ve iz dibinde su görünümü

Kuru `LT Earth and Scree` ayrı kalır. `LT Wet Mud` yeni görsel materyaldir;
Paint > Add Layer ile beşinci katman açılıp Material = LT Wet Mud,
Physical Material = mud seçilerek istenen bölgelere boyanır. Mevcut katmanların
ağırlıkları yeni katman açılırken korunur; yeni katman ağırlıkları sıfır başlar.
Sekiz katman sınırı vardır. Yapı değişikliğinde World Terrain'in bütün tile'ları
yüklenir; undo/redo, yeni weight kanalı, global harita ve kayıt birlikte ilerler.
Kullanıcının açık LandscapeTest dosyaları dışarıdan değiştirilmedi.

Terrain shader'ı sekiz katmanın albedo dokusunu ve materyal roughness değerini
kullanır. Önceden son dört katman yalnız düz renkle çiziliyor, materyal
roughness'ı yüklenmiyordu. Bir tile'lık Landscape normalizasyonu da ek katmanı
artık silmez. Kuru toprak, kaya ve çimenin fiziksel seçimi bu katmanlardan
bağımsızdır: kuru zeminin çamur davranışı istenmiyorsa `mud` atanmaz.

`mud` izleri koyu lineer renk ve yüksek ıslaklık alır. 2–8 cm arasında
belirginleşen iz tabanında su maskesi oluşur; düzeltme dünya eğimi fazla olan
arazide su görünümünü azaltır. Su maskesi roughness'ı 0,035'e yaklaştırır ve
normali yataya düzleştirir. Environment map varsa PBR yansıması, yoksa
bakış açısına bağlı analitik gökyüzü yansıması kullanılır. Suyun görünümü iz
derinliği ve yüzey ıslaklığından türetilir; ayrı sıvı hacmi/akış ve araçların
planar yansımaları hesaplanmaz. Kar ve kuru katmanlar su maskesi üretmez.

## Doku kaynağı

- Üretim: yerleşik OpenAI `image_gen`, imagegen skill.
- Üretim kimliği: `01a171f8-7f37-7b50-9eb3-d98274e3811c`.
- Proje çıktısı: `public/assets/LandscapeTest/Textures/LT_Wet_Mud_BC.webp`.
- Materyal: `public/assets/LandscapeTest/Materials/lt-wet-mud.material.json`.
- PNG çıktısı WebP olarak sıkıştırıldı; dokunun içine iz veya su görüntüsü işlenmedi.

Kullanılan prompt:

```text
Create a single square seamless tileable PBR BASE COLOR terrain texture for a realistic Three.js offroad game, 1024x1024 or larger. This is ONLY an albedo map, orthographic top-down view, no perspective, no scene. Subject: saturated dark brown wet clay mud, fine soft organic soil, subtle compacted swirls and soft tiny clods, occasional minute grit but NO gravel/scree/stones, no grass/leaves, NO tire tracks or footprints. Even diffuse neutral lighting, no baked shadows, no specular highlights, no water puddles painted into the albedo: runtime rendering will add true reflective puddles in depressed wheel ruts. Muted natural dark umber, enough subtle color variation to read as soft wet earth. Entire image filled with continuous material, no borders, no text. All edges must tile seamlessly.
```

## Doğrulama kapsamı

Engine kontrolleri: 4→5 katman geçişi, tüm tile'ların ağırlık/yükseklik
bütünlüğü, undo, binary round-trip, bir tile'lık adaptör, sekiz albedo ve
roughness uniform'u. Tarayıcı kontrolleri: gerçek WebGL shader derlemesi,
su açık/kapalı piksel farkı, iki bakış açısından görüntü; editörde katman
ekleme/undo/redo, çamur atama ve boyama, dört tile'ın kaydı ve yeniden açma.
CPU/GPU performans farkı ölçülmedi. Stok araçla nihai görünüm kullanıcı testindedir.

Sonuç: TypeScript ve `build:verify` geçti (1.844 engine kontrolü).
`wet-mud.spec.ts` içindeki iki senaryo ayrı son koşularında geçti: WebGL
su açık/kapalı karşılaştırması ve iki açı; katman editörü/undo/boyama/kayıt/yeniden açma.
Görüntüler `test-results/wet-mud-wet-mud-fifth-laye-bdb10-ctive-water-on-track-floors-chromium/`
altında `wet-mud-puddles.png` ve `wet-mud-puddles-side.png` olarak üretildi.
