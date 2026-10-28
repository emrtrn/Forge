# Lake Surface Waves — 2026-10-28

Kullanıcı, önerilen kıyıda sakinleşen hafif geometrik dalgaları uygulamaya açtı.
Lake yüzeyi vertex shader'da gerçekten yükselir/alçalır. Ortalama su kotu ve
bağlı havza/kıyı korunur; ince doğal normaller ve tekerlek halkaları bunun
üzerine katmanlanır. Terrain yüksekliği/boyası veya araç kuvveti yazılmaz.

## Kullanım

Lake Details → **Surface Waves**. Editör ve Play'de görünür.

| Kontrol | Varsayılan | Aralık |
| --- | --- | --- |
| Enabled | Açık | Geometrik hareketi açar/kapatır |
| Height (cm) | 2 | 0–10; ortalama seviyeden azami sapma, 0 kapatır |
| Wavelength (m) | 12 | 6–40; baskın dalga boyu |
| Period (s) | 5 | 2–12; baskın salınım süresi |
| Direction (°) | 30 | 0–360; dünya XZ, 0=+X / 90=+Z |
| Shore Fade Depth (m) | 0,5 | 0,1–2; tam şiddete ulaşılacak derinlik |

Reset Surface Waves yalnız bu grubu sıfırlar. Alanlar Türkçe tooltip taşır;
kilit, undo/redo ve Save/Reload/Play mevcut Lake edit yolundadır. Height UI'da
cm, kayıtta `surfaceWaveHeight` olarak metredir. Ortak runtime/save allowlist
`surfaceWavesEnabled`, `surfaceWaveHeight/Length/Period/Direction/ShoreDepth`
alanlarını doğrular. Eski kayıtlarda da yeni dalgalar varsayılan açık/2 cm'dir;
yeni göl preset'i aynı değerleri açıkça içerir. Authored sahne migrasyonu yoktur.

## Uygulama

- `engine/terrain/lakeWaves.ts`: üç yönlü, ağırlıkları toplamı 1 olan sinüs
  bileşeni. Toplam yükseklik mutlak olarak Height ile sınırlıdır. Derinlikte
  smoothstep ile sönme ve `min(Height,depth*0.25)` sınırı kıyıyı sabitler,
  negatif dalganın tabana girmesini önler. Düşey hareket vardır; yatay Gerstner
  kayması, su hacmi/taşma, yüzdürme veya fizik simülasyonu yoktur.
- Dünya ankraj fazı CPU'da modulo 2π'ye indirgenir; GPU yerel XZ kullanır.
  Büyük origin'de hassasiyet korunur ve bounds değişimi deseni dünya üzerinde
  taşımaz. Ortak çevrim on baskın periyottur; zaman sarımı süreklidir.
- `engine/render-three/lakeWaves.ts`: aynı bileşenlerden GLSL üretilir.
  Yükseklik ve analitik eğimler vertex'te hesaplanır. Kıyı sönmesinin türevi
  kaynak derinlik eğimiyle birlikte normal hesabına katılır. Vertex normalleri
  yüzey boyunca yumuşak interpolate edilir; parlamada düz üçgen izleri önlenir.
- `terrainLakeWater.ts`: kaynak derinliğinin alan ağırlıklı, seam-welded
  vertex eğimini çıkarır. Yeni `depthSlopes` buffer'ı vertex başına 8 byte;
  saklanan 16 MiB geometri ve 32 MiB replacement sınırına dahil edilir.
  Geçici ağırlıklar vertex başına 4 byte'tır. Üretim mevcut abort/yield
  dilimlerini kullanır. Geometri subdivision/LOD eklenmedi; büyük terrain
  spacing değerlerinde dalga örneklemesinin görsel kabulü ayrıca gerekir.
- `LakeWaterObject`: WPO; source/visible depth ve yansıma koordinatları
  yükselmiş konumdan geçer. Bounding box/sphere Height kadar genişletilir.
  Yeni texture/sampler/capture veya beauty draw yoktur. Ek vertex sin/cos ALU
  ve derinlik eğimi vertex buffer'ı vardır; gerçek GPU maliyeti ölçülmedi.
- AO normal ve DoF depth override'ları aynı WPO uniform'larını paylaşan
  normal/depth materyalleriyle mevcut su çiziminin yerini alır. Terrain'in
  override yolu korunur; shader-displaced su düz çizilmez. Lazy materyaller
  dispose'ta bırakılır; scene callback/görünürlük/autoClear try/finally ile döner.
- Runtime wave saati sabit fizik adımından ilerler; görünürlük, reflection veya
  kamera sayısı zamanı ilerletmez. Editör ortak monotonic saat kullanır.
  Yeniden build aynı runtime saatini korur, level dispose sıfırlar.
- `LakeSurfaceQuery.offsetAt`: dalgayı mesh vertex'lerinde hesaplar ve GPU gibi
  üçgende interpolate eder. Sürekli fonksiyonu doğrudan tekerde değerlendirmekten
  kaynaklanacak coarse-grid farkını önler. Teker–su kesişimi bu yükseklikte
  yapılır; eğik teker konumu en çok dört adımda yeniden örneklenir.

Planar capture ortalama su düzleminde kalır; dalga eğimi yansıma sunumunu
değiştirir. Islak kıyı ve caustics bağlantı/derinlik maskeleri de ortalama
seviyededir. Bu, santimetrelik dalgalarda kullanılan bilinçli bir yaklaşımdır;
dinamik kıyı yıkaması, wave-accurate ışık kırılması veya engelde dalga kırınımı
teslimi değildir. Teker halkaları mevcut normal sunumunu korur.

## Doğrulama

Odaklı engine kontrolleri: Height/depth sınırı, sabit kıyı, büyük origin,
zaman çevrimi; kayıt aralıkları; crest/trough'da teker teması; GPU ile aynı
vertex-interpolated CPU yüksekliği ve genişletilmiş bounds. Lake geometri,
seam, iptal/retry, yaşam döngüsü ve yansıma lease regresyonları ayrıca geçti.

Browser QA: Height 0/6 cm ve farklı zamanlar, GPU yüksekliğini renk olarak
okuyarak iki görünür su probunda CPU yüksekliğiyle karşılaştırma; AO/DoF
variant shader'ları; direct/snapshot, kuru/ada/ayrı çukur; toggle/reset/undo,
Save/Reload/Play, GL/konsol ve terrain disk hash korunumu. İlk yakın kamera
probu ekran dışında kaldığı için o koşu kabul edilmedi; yükseklik okuması tüm
probları gören üst kameraya taşındı. İlk düz üçgen normal görüntüsü de nihai
görsel kabul sayılmadı; yumuşak normaller eklendi.

Son kaynakla tam `build:verify` **çıkış 0**: TypeScript, smoke/content/UI test
tipleri, production build, **2.017 engine kontrolü**, strict dist ve world-data
geçti. Yeni engine test dosyasının ayrı TypeScript kontrolü de geçti.
Son toplu browser koşusu **7 geçti / 1 başarısız (16,1 dakika)**: caustics,
kıyı köpüğü/geçişi, ıslak dip, doğal yüzey, teker halkaları ve yeni geometrik
dalga senaryosu geçti. Geometrik dalga testinde GPU/CPU yükseklik eşleşmesi,
AO normal + DoF depth variant'ları ve Save/Reload/Play doğrulandı.
Wheel Ripples arayüzü senaryosu editör Reload sonrasında Lake'in hazır
olmasını beklerken 120 s zaman aşımına uğradı. İzole tekrar kullanıcı
talebiyle durduruldu; başarı olarak sayılmaz. Tam browser kabulü açık kalır.
Bu kayıt sırasında yeni test koşusu başlatılmadı. Kanıtlar:
`.dev-server/lake-waves-acceptance-build.log`,
`lake-waves-acceptance-browser.log`, `lake-waves-acceptance-results/`.
Yeni engine test dosyası ayrıca TypeScript ile denetlenir.

Donanım GPU p95, gerçek sahnede kullanıcı görsel kabulü ve büyük dünya
performansı açıktır. Kullanıcı sahnelerine test verisi yazılmaz; concurrent
World Builder ve authored terrain değişiklikleri korunur. Oturumun göl
kodu/UI/test/dokümanları kullanıcı isteğiyle commit/push kapsamına alındı;
authored Terrain dosyaları kapsam dışıdır. Yayın sonucu görev çıktısında belirtilir.
Yeni save alanları için onaylı Codex Security diff incelemesi önerilir;
bu uygulamada scan başlatılmadı.
