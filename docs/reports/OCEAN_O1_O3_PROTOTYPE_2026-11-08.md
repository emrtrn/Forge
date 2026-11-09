# Ocean O1–O3 — ilk çalışan prototip

Tarih: 8 Kasım 2026. Durum: izole uygulama; tam Ocean teslimi değildir.
Plan: [OCEAN_DEVELOPMENT_PLAN.md](../planned/OCEAN_DEVELOPMENT_PLAN.md).

**Devam kaydı:** Bu ilk izole teslimden sonra
[native editör/runtime bağlantısı](OCEAN_EDITOR_RUNTIME_INTEGRATION.md) eklendi.
Aşağıdaki bağlantıların eksik olduğu notları ilk prototipin sınırlarını anlatır;
güncel entegrasyon ve kalan kabuller devam kaydındadır.

## Çalıştırma ve kapsam

`npm run dev:local` ardından
`http://127.0.0.1:5173/tests/smoke/pages/ocean-reference.html`.
Coast / Open sea / Aerial kamera seçenekleri, FFT / Analytical karşılaştırması,
Pause / Resume ve Rebuild vardır. Kullanıcının layout, terrain ve manifest
dosyaları değiştirilmez. Bu test sayfası production girişine eklenmemiştir.

Bu teslim O1 veri/kayıt ve kapsam çekirdeğini, O2'nin ilk kıyı/LOD yüzeyini ve
O3'ün WebGL2 FFT deneyini somutlaştırır. Ana editörde Add Ocean, iki scene shell'e
Ocean controller bağlantısı ve sıradan level'ın Play yolu henüz eklenmedi.
Yeni Ocean verisi layout read/save/partition sözleşmesinden geçer; bu tek başına
normal oyun rotasında Ocean render edildiği anlamına gelmez.

## Uygulama kararları

- **Ayrı `oceanWaters`:** `waterBodies` tüketicileri şu anda Lake varsaydığı
  için genel union genişletilmedi. Bir level en fazla bir Ocean taşır. Kalıcı
  veri bounds, açık kenarlar, deniz kotu, offshore derinliği, rüzgâr/swell ve
  başlangıç görünüm ayarlarıdır. GPU/mesh/köpük geçmişi kaydedilmez.
- **Gerçek deniz bağlantısı:** Terrain'in b–c üçgenleri, açık kenardaki ıslak
  parçalardan taranır. Kara/ada ve denizden kopuk, deniz kotunun altındaki
  iç çukur kuru kalır. Çalışma alanının dışı açıkça authored offshore'dur.
- **Native World Terrain hazırlığı:** Domain bütün terrain tanımıyla eşleşir.
  Gerçek tile örnekleri ve dünya origin'i kullanılır; en fazla dört geçici
  okuma, kaynak dokümanın residency'sini değiştirmez. Eksik cell/tile gizlenmez;
  paylaşılan kenar uyuşmazlığı hata verir. Hazırlık cooperatively yield eder;
  üretim controller'ı yayın öncesi document revision kontrolünü ayrıca yapmalıdır.
- **Sınırdaki derinlik:** Domain kenarındaki tabandan authored offshore
  derinliğine 64 m smoothstep geçişi CPU ve GPU coverage'da aynıdır. Bu ilk
  sürümün açık offshore taban modelidir; domain içinde eksik veriyi kapatmaz.
- **FFT:** Sabit Ultra-Water sürümünün MIT shader aşamaları; dört 256² kademe,
  JONSWAP rüzgâr denizi + swell, yatay deplasman ve Jacobian köpük girdisi.
  `OceanFft` kendi yetenek/FBO kontrolü, zaman, renderer state ve dispose
  yönetimine sahiptir; simülasyon render callback'inde ilerlemez.
- **LOD yüzey:** Yedi iç içe grid; dış kenar deplasmanı sonraki gridin üçgen
  örneklemesine geçer. Dalga fazı world-space'tir. Büyük koordinat hassasiyeti,
  hızlı teleport ve uzun kamera hareketinde genel LOD kabulü hâlâ açıktır.
- **Sığlık:** Dalga genliği derinlikle söner, son deplase konum tekrar kontrol
  edilir; negatif deplasman yerel derinliğin %70'iyle sınırlanır. İlk görsel
  kontrolde görülen taban açığa çıkması bununla düzeltildi.
- **Yaşam döngüsü:** Surface kendi grid/material/coverage texture'ını, FFT
  kendi RT/material/fullscreen quad'larını bırakır. Hatalı yeniden hazırlık
  önceki geçerli yüzeyi korur. Duraklatma simülasyon/köpük geçmişini dondurur;
  duraklatılmış ve değişmeyen fixture tekrar çizilmez.

FFT texture format hesabı yaklaşık **22,67 MiB**; bu sürücü/GPU tepe ölçümü
değildir. Yüzey geometri/coverage, sahne, render target ve yansıma gibi diğer
kaynakların toplam maliyeti bu sayıya dahil değildir.

## Doğrulama

- Engine'e kayıtlı yedi Ocean regresyonu: gerçek save/read/drop/partition,
  bozuk değerler ve limit, ada/kapalı iç çukur, dünya kotu/üçgen/açık kenarlar,
  eksik veri/iptal, LOD alan/winding ve native çok tile/temporary read.
- Playwright: gerçek shader compile/draw, float GPU probe'da sonlu ve sıfır
  olmayan değişken yükseklikler, duraklatılmış zaman, analitik karşılaştırma,
  üç kamera, eksik terrain'de önceki yüzeyi koruma ve üç rebuild sonrası
  texture/geometri sayılarının büyümemesi. Console/page error kontrolü.
- İlk tarayıcı koşusu yazılımsal GPU'da 150 s zaman aşımına uğradı. Paused
  durumda gereksiz çizimler kaldırıldı; sonraki koşu geçti. Bu bir hedef
  donanım performans kabulü değildir. Son shader düzeltmesi sonrası koşu ve
  birleşik `build:verify` sonucu aşağıdaki son doğrulama kaydında tutulur.

Hedef RTX 3060/1080p p95 GPU bütçesi, uzun kaynak döngüsü, production browser
açılışı ve kullanıcı görsel kabulü açık. Yeni video dosyası hâlâ okunmadı;
görsel hedef kullanıcının paylaştığı ürün kartlarıdır.

## Açık işler

Mevcut yüzey yalnız ilk optik/FFT crest sunumudur. Kabul edilmiş Lake/River
renk/depth snapshot, ortam/probe ve paylaşılan planar yoluna henüz bağlı değildir.
Sığ dip kırılması, gerçek üç katmanlı köpük, kıyı travel-time/breaker/swash,
su altı, yüzdürme, wake, kapalı hacim maskeleri ve WES entegrasyonu sonraki
plan aşamalarındadır. Fixture'ın analitik karşılaştırması aynı FFT saatini
paylaşır; bu sürümde bağımsız analitik backend maliyet benchmark'ı değildir.

O1'de authored dalga/görünüm alanları allowlist'e girdi; tam zaman damgalı
yükseklik/normal/velocity fizik sorgusu henüz yapılmadı. GPU probe yalnız
tanılama içindir, fizik sorgusu değildir. Native hazırlık controller'a
bağlanmadan otomatik Sculpt revision/travel davranışı tamamlandı sayılamaz.

İlk sonraki iş: native terrain hazırlığını revision sahibi ortak controller'a
bağlamak, editör/runtime yüzeyini açmak ve O4 ortak optik yoluna geçmek.
