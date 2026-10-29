# Lake — derinlik kontrollü kırılma, V2a

29 Ekim 2026. Kullanıcı Lake kırılma görünümünü iyi buldu ve test/commit istedi.
Önceki yansıma/güneş görünümü kabulden sonra `c5d1b4a1` ile commit edildi.
Commit hazırlığı sırasında ortak index'teki V2a kodu, UI ve test dosyaları,
eşzamanlı oturumun `671f4386` (`fix(game-mode): TPS spawns the starter player
class instead of a deleted model`) commit'ine de dahil oldu. Bu commit geçmişi
yeniden yazılmadı. Kalan raporlar ve fixture'ın gereksiz `hidden: false` alanını
kaldıran tek satırlık düzeltme ayrı Lake doğrulama commit'iyle tamamlanır.
Nehir, kullanıcı kararıyla daha kapsamlı ayrı bir çalışmaya ertelendi.

## Uygulama

- `lakeRefraction.ts`, mikro/geometrik normal eğimine göre mevcut opaque
  renk/depth snapshot'ından hafif kaydırılmış dip örneği okur. Yeni sahne
  capture'ı veya renk/depth hedefi açılmaz.
- **Refraction Strength**: Appearance altında 0–2, başlangıç **0,65**. Sıfırda
  kaydırmasız optik yol kullanılır. Eski kayıtta alan yoksa runtime başlangıcı
  0,65'tir; sahne dosyaları bu çalışma sırasında düzenlenmedi.
- Veri tipi, Türkçe tooltip ve ortak `validateWaterBody` allowlist'i
  güncellendi. `tools/saveValidator.ts` zaten bu ortak doğrulayıcıyı çağırır.
  Mevcut edit/undo/save akışı kullanılır.
- İlk kalite politikası Yüksek/Ultra'dır: Lake profilinin planar kalite
  tavanı `off` ise kırılma da kapanır. Authored Reflection Mode ayrı kalır.
  Snapshot olmayan direct/MSAA ve alttan görünümde mevcut optik yol sürer.
- Sığ kıyıda/eğik bakışta etki söner; kaydırma en fazla 10 snapshot pikselidir.
  Ekran kenarında örnek ağırlığı azalır. Orta nokta ve son örneğin depth'i
  hareketli yerel yüzey yüksekliğine göre denetlenir. Güneş/köpük hesabı ve
  çizilen geometri değiştirilmez.
- Bağlı kaynak üçgenler hücre başına iki R8 texel ile örneklenir. Ada ve
  bağlantısız çukur koruması bağlı yüz maskesiyle opaque depth'in birlikte
  uygulanmasına dayanır; kısmen kuru bir yüzün bütünü su sayılmaz. İki geçerli
  uç rengin karışımı kullanılır; ara UV'den doğrulanmamış renk okunmaz.
- Soğurulma kaydırılmış örneğin su yolunu, son kıyı bileşimi kaydırmasız dip
  görüntüsünü kullanır. Çok kotlu/örtüşen su, ince nesne ve siluet davranışının
  görsel kabulü açık kalır. Ekran dışı veri ve saydam ön nesneler çözülemez.

## Kaynak ve doğrulama

Maske immutable `coverage.triangles` CPU dizisini ödünç alır; büyük CPU bake
veya kopya yoktur. GPU'da mip'siz/nearest R8 maske en fazla 65.536 hücrede
**128 KiB/göl** ham veri kullanır; bu tepe bellek ölçümü değildir. Bir ek
sampler ve geçerli kaydırmada en çok iki depth, iki maske, bir renk okuması
vardır. Maskenin sahibi LakeWaterObject'tir; kalite kapatma/dispose sırasında
bırakılır. Bir eksen 2048 texel'i aşarsa maskeyi küçültmek yerine kırılma
kapanır; gerekçe `userData.lakeRefractionFallback` içinde tutulur.

Fikir kaynağı Ultra-Water `ce9248fa20afbdf63fd4c11709f68d7368aca0a0` /
`OceanSurface.js` depth-offset fallback'idir. Lisans bildirimi güncellendi.
Yeni kayıt alanı için dar kapsamlı Codex Security diff incelemesi önerildi;
tarama başlatılmadı.

Kullanıcı ara adımlarda otomatik kontrol istemedi; commit isteği üzerine
kontroller topluca çalıştırıldı. Göl görünümünü kullanıcı iyi buldu; bu onay
bütün donanım/performance senaryolarının kabulü değildir. V2b River eklenmedi.

### Commit öncesi sonuçlar

- `npm.cmd run build:verify` **geçti**: import sınırları, smoke/content/UI tip
  kontrolleri, release araçları, `tsc --noEmit`, production Vite build,
  **2.131 engine kontrolü** (slow dahil), strict dist ve world-data doğrulaması.
- Yeni browser testi eklendikten sonra smoke TypeScript kontrolü ayrıca geçti.
  Ortak schema/save/partition testi Refraction Strength'in korunmasını ve
  hatalı değerlerin reddini içerir; tam engine koşusunda geçti.
- `Lake refraction bends the bed, preserves dry areas and persists through
  Save Reload Play` **geçti**. Kırılma açık/kapalı farkı, güç sıfırda geri dönüş,
  kuru/ada/bağlantısız alan probları ve snapshot olmayan direct fallback
  denetlendi. Son, post-process açık fixture'da çizim sayısı 26 → 26, GL hatası
  0. Save/Reload/Play sonrasında authored 1,2 güç, kaynak maske ve gerçek runtime
  snapshot yolu korundu. İlk koşu runtime'da yalnız fallback'i kapsıyordu;
  son test bu nedenle gerçek post-process yolunu açıkça etkinleştirip
  `snapshotUsed === true` sonucunu da doğrular. Bu ölçümler GPU süre/bellek
  performans kabulü değildir.
- Geniş, önceden mevcut `Lake quality menu ... updates live Play` senaryosu ilk
  koşuda ikinci Play sayfasındaki hook'u beklerken toplam 300 saniye sınırına
  takıldı. Tek başına tekrar da toplam süre sınırına takıldı; bu koşuda API
  stream/trace kapanışı hatası da kaydedildi. Senaryonun genel kalite/çoklu Play
  kabulü açık bırakılır; yeni kırılma testinin sonucu yerine kullanılamaz.
- İlk sandbox denemeleri esbuild'in üst dizin okumasındaki `Access is denied`
  engeli nedeniyle geçersizdi. Yukarıdaki build/browser sonuçları gereken
  yerel erişim izniyle alınan koşulara aittir. Başka oturumların authored sahne,
  manifest ve AI değişiklikleri bu oturumun tamamlayıcı Lake commit'ine
  alınmaz; ortak index'ten önce oluşan commit durumu yukarıda ayrıca açıklanır.

Kanıtlar (yerel, Git dışında): `.dev-server/lake-refraction-final/` altındaki
`build-verify.log`, `smoke-types.log`, `browser.log`, `quality-final.log`,
`refraction-final.log` ve
`refraction-final-results/terrain-lake-editor-Lake-r-c01d8-ts-through-Save-Reload-Play-chromium/`
altındaki JSON ile `lake-refraction-off.png` / `lake-refraction-on.png`.

Kalan sınırlar: yeni GPU farkı, tüm yaşam döngüsü/cihaz matrisi ve production
browser kabulü açık. Engine/build geçmesi bu sınırları kapatmaz.

## Elle kontrol

1. Editörü yenile. Genel grafik kalitesi Yüksek/Ultra ve post-process açıkken,
   görünür taş/kum tabanı olan gölü seç.
2. Appearance / Refraction Strength: **0 → 0,65 → 1,5 → 0,65** karşılaştır.
   Hareketi dip deseninde ara; güneş parıltısı veya caustics ile karıştırma.
3. Sığ kıyı, ada, kaya teması ve ekran kenarında görüntü çekilmesi/çift siluete
   bak; yukarıdan ve eğik açıdan karşılaştır.
4. Save/Reload/Play, Undo/Redo ve grafik kalitesini düşürüp geri yükseltme
   sonrasında ayar ve görünüme bak.
