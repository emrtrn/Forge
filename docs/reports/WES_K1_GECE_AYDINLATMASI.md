# WES K1 — gece aydınlatması düzeltmesi

**Tarih:** 2 Kasım 2026 · **Taban:** `main@995b713`.
**Hedef:** Kullanıcının seçimi: “Karanlık, araç ve yol seçilsin.”
**Durum:** Kod, otomatik doğrulama ve SwiftShader karşılaştırması tamam. Gerçek GPU'da araç/yol görsel kabulü ve E-015 performans ölçümü açık.

## Sorun ve ölçüm

`resolveSceneWorldSettings` varsayılan ambient şiddetini **0** çözüyor; `applySceneBackgroundAndAmbient` bu durumda ışığı oluşturmuyor. Dolayısıyla mevcut `ambientFloor` çarpanı gece için ışık üretemiyor. Ay authored Sun'ın şiddetiyle çarpılıyor; gece göğünden yakalanan IBL de ışık almayan bir yüzeyi görünür kılmaya yetmiyor.

RuntimeParity'nin Sun, Sky Light ve Post Process ayarlarıyla, gölgesiz ve emissive olmayan gri bir kart ölçüldü. Kamera ve materyal sabit: `#808080`, roughness 1, metalness 0; 128×128 framebuffer'ın merkezindeki 64×64 piksel. Çıktı parlaklığı `0.2126 R + 0.7152 G + 0.0722 B` (8-bit, 0–255); fiziksel lineer luminans veya tüm sahne ortalaması değildir.

| Saat | Dolgu kapalı (önceki görünüm) | Dolgu açık |
|---|---:|---:|
| 12:00 | 121.29 | 121.29 |
| 00:00 | 0.00 | 12.30 |
| 23:00 | 0.00 | 13.30 |

Gece 00:00'da yalnız dolgu katkısı 12.23 ölçüldü; dolgu kapalıyken directional ve IBL birlikte kartı görünür kılamadı. Yeni dolgu ile kartın gece parlaklığı öğlenin yaklaşık %10'u. Bu oran bu test yüzeyinin sonucudur; sahnenin tamamı veya kabul edilmiş genel bir eşik değildir. Aynı koşudaki WebGL testi öğlede dolgulu/dolgusuz görüntünün eşitliğini doğrular.

**Ortam:** Chromium 154.0.8037.57, Linux, ANGLE / Vulkan SwiftShader. Ham değerler ve katkı ayrıştırması: [photometry.json](wes-k1/night/photometry.json), doğrudan `world-environment-night.spec.ts` testinin JSON ekinden alındı. Testi `npx playwright test world-environment-night.spec.ts` ile tekrar çalıştırmak mümkündür. GPU ms, frame p50/p95/p99 ve IBL yakalama süresi bu çalışmada ölçülmedi.

## Uygulama

- Yeni opsiyonel `worldEnvironment.night.ambientIntensity`: varsayılan **1.5**, aralık **0–10**, **0** dolguyu kapatır. Mevcut sparse level dosyaları değiştirilmedi; alan yoksa yeni varsayılan okunur.
- Dolgu `moonColor` renginde ayrı bir render `AmbientLight` katkısıdır; şiddeti `ambientIntensity × (1 − daylight)`. Mevcut `ambientFloor` ve `moonIntensity` anlamları korunur; exposure ve IBL politikası değiştirilmez.
- Editör ve Play aynı `AuthoredEnvironment` bağını kullanır. Yeni level actor'ü, directional ışık, gölge haritası veya materyal shader yaması eklenmez. Tek dolgu nesnesi WES aktifken tekrar kullanılır; gündüz şiddeti sıfırdır. WES gizlenince, kaldırılınca, state bitince veya teardown'da kaldırılır.
- Details → World Environment → Night → **Night Fill** ile düzenlenir. Yeni alan normalizer üzerinden kayıt allowlist'ine girer; maximal fixture sayesinde serialization-drift ve dropped-fields testlerine dahildir.
- Gece görünümü kasten değişir. Daha karanlık bir sahne isteyen level `night.ambientIntensity: 0` ile önceki dolgusuz görünümü seçebilir. Dolgu, authored ambient varsa onun gece katkısına eklenir; fiziksel gölge/örtülme hesabı yapmaz.

## Görüntüler

RuntimeParity, editör, 1280×720, aynı başlangıç kamerası. Level ve proje seçimleri yalnız tarayıcı yanıtlarında değiştirildi; `public/` altındaki kullanıcı dosyaları yazılmadı. Hareketli sahne öğeleri dondurulmadığından bu kareler piksel-kimlik testi değildir.

- [Öğle](wes-k1/night/noon.png)
- [23:00 — dolgu kapalı](wes-k1/night/night-before.png)
- [23:00 — dolgu 1.5](wes-k1/night/night-after.png)

Bu sahnede araç yoktur. Görüntüler zemin ve nesne sınırlarının iyileşmesini gösterir; gerçek sürüş sahnesindeki araç/yol kabulünün yerini tutmaz.

## Doğrulama

- `npx tsc --noEmit`: geçti.
- `npm run build:verify`: geçti; **2193 motor kontrolü**, import sınırları, fixture/type/serialization kontrolleri, üretim derlemesi, strict dist ve world-data kontrolleri.
- `npm run check:assets`: geçti.
- `world-environment-night.spec.ts`: geçti. Gerçek WebGL'de gece katkısı; öğlede sıfır etki; sunrise/sunset ±0.0001 saat aralığında sıçrama olmaması; gün/gece boyunca program sayısının sabitliği; layout'un değişmemesi.
- `world-environment.spec.ts`: geçti. Night Fill düzenleme/kayıt/reload; mevcut preview/Make Default/undo/redo/Play akışı.
- `sky-light-capture.spec.ts`: geçti. IBL sonlu ve sürekli kalıyor.
- Motor testleri ayrıca authored Sun/ambient yokluğunu, alanın sınırlarını ve sıfırla kapatmayı, şafakta monoton azalmayı, dolgu nesnesinin tekrar kullanımını ve gizleme/unload/teardown temizliğini kapsar.

## Sonraki adım

Gerçek tarayıcı/GPU'da hedef sürüş sahnesini 23:00, şafak ve gün batımında kontrol et; Night Fill şiddetini araç/yol okunurluğuna göre gerekirse ayarla. K1'in eksik senaryo karelerini ve E-015 ölçümlerini tamamla. Bunların ardından K2 görev talimatı ve E-023 içerik hazırlığı gelir.
