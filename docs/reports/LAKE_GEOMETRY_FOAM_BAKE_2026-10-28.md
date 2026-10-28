# Lake geometri temas köpüğü — 2026-10-28

## Davranış ve kullanım

Lake Details → **Obstacle Foam → Calculate / Recalculate** gerçek statik sahne
geometrisinden topluca temas köpüğü üretir. Kullanıcı taşları normal şekilde
yerleştirir; her taş için merkez/yarıçap veya proxy girmez. İlk kapsam Lake'tir;
River'ın eğimli yüzeyine otomatik bake bu teslimde eklenmedi.

UI başlıkları, düğmeleri, alanları ve durumları **İngilizce**; tooltip
açıklamaları **Türkçe**. Kullanıcı geometri köpüğünü masaüstünde denedi ve başarılı
bulduğunu bildirdi. Bu kabul, donanım performans ölçümü anlamına gelmez.

- **Calculate / Recalculate:** Kayalar ve iskele ayağı gibi uygun statik mesh
  yerleşimlerinin üçgenleri, ortalama Lake düzlemiyle kesiştirilir.
- **Contact Width:** Hesap girdisi. Değişince yeniden hesaplama gerektiği
  gösterilir; kendiliğinden hesap yapılmaz.
- **Foam Strength / Pattern Size / Animation Speed / Enabled:** Kaydedilmiş
  maskenin sunumunu değiştirir; kaya üçgenleri tekrar taranmaz.
- **Cancel:** Önceki başarılı sonuç korunur. Değişen kaynak veya level/selection
  için iş bitimindeki revision kontrolleri eski sonucu yayınlatmaz.
- **Clear / Undo / Redo:** Sonucu bir komutla kaldırır veya geri getirir;
  yeniden mesh hesabı yapmaz.
- Taşı taşımak, gizlemek/silmek veya terrain/su ayarını değiştirmek otomatik
  bake başlatmaz. Kaynak fingerprint'i değişince **Recalculation required**
  gösterilir. Eski maske dünya XZ çerçevesinde kalır. Su kotu değişirse eski
  kotun köpüğü yeni su yüzeyine taşınmaz; yeniden hesaplanana kadar bu efekt
  çizilmez. Ana Lake yüzeyi çalışmaya devam eder.

## Geometri ve sunum

Kaynak, modelin render geometrisi ve her placement'ın dünya matrisidir.
GLTF alt node dönüşümleri, aynı asset'in instanced yerleşimleri, nonuniform ve
negatif ölçek desteklenir. Editör level yüklerken partition hücrelerini
birleştirdiğinden yalnız kamera çevresindeki görünür hücrelerle sınırlanmaz.
Eksik model yüklenemiyorsa eksik sahneden başarılı bake üretmek yerine hata verilir.

Bounds yalnız ön eleme içindir. Havada/tamamen derindeki yüzler elenir;
taşın merkezinin suda olması gerekmez. Kesitler, kaynak başına winding dolumu
ve nesneler arasında birleşim ile maskelenir. Aynı GLTF'teki örtüşen alt meshler
de ayrı placement'larla aynı birleşimi üretir. İç örtüşme kenarları beyaz çizgi
oluşturmaz. Coplanar yüzlerin iç triangulation kenarları köpük kaynağı değildir.
Açık kesitler mevcut temas çizgileriyle sınırlıdır; eksik hacim tahmin edilmez.
Lake'in gerçek ıslak geometri sorgusu kuru ada/ayrı havza ve kuru kıyıyı eler.

Sonuç R8 mesafe alanıdır. 1024² parçalara ayrılan texture array'de sınırları
aşan dört-texel bilinear örnekleme kullanılır; halo kopyası gerekmez. Mevcut
parçalı köpük, güneş/gölge ve su kompozisyonu kullanılır. Taş başına uniform/draw
yoktur; efekt için ek capture veya su mesh draw'u eklenmez. Hafif su dalgaları
kesiti her kare yeniden hesaplatmaz. Dinamik/skinned mesh, araç/karakter köpüğü,
foliage-paint yerleşimleri ve akış fiziği bu kapsamda değildir.

## Kayıt ve kaynak ömrü

`geometryFoam` ortak Lake runtime/save allowlist'ine eklendi. Başarılı sonucun
manifest referansı ve kaynak fingerprint'i level'da; metadata ve R8 texelleri
level'a ait `<level>.foam/<sha256>.foam.json` + `.foam.bin` dosyalarındadır.
Dosya adının SHA-256 değeri binary içeriğiyle sunucu ve runtime'da doğrulanır.

Yeni localhost-only `/__save-lake-foam` yalnız açık level için çalışır. İstemci
keyfi hedef dosya belirleyemez: yol level ve hash'ten türetilir. Boyut/şema/byte
uzunluğu/sayılar doğrulanır. Binary önce, manifest sonra atomik dosya değiştirme
ile yazılır; save coordinator bunları level referansından önce kaydeder.
Başarısız bake kaydı level'a dangling referans yazdırmaz; Retry Save kullanılabilir.
Bu işlem bütün level dosyaları için crash-atomic disk transaction iddiası değildir.

Reload/Play yalnız manifest ve binary yükler, checksum doğrular ve texelleri
GPU'ya aktarır. Kesişim, mesafe rasterizasyonu veya sahne taraması başlatmaz.
Eksik/bozuk kayıt yalnız bu efekti devre dışı bırakır ve tanı verir; Lake yüzeyini
yok etmez. Bake yüklemesi tamamlanmadan yeni Lake sonucu **Ready** yayımlanmaz.
Texture sahipliği Lake nesnesindedir; rebuild/dispose eski GPU kaynağını bırakır.
Paketleyicinin genel JSON/bin referans takibi dosyaları görür. Aynı proje içinde
level kopyası immutable dosyaları paylaşabilir; sonraki Recalculate yeni level'ın
dizinine yazar. Ayrı bir export/clone uçtan uca kabul koşusu bu oturumda yapılmadı.

## Bütçe ve doğrulama sınırı

Başlangıç sınırları: 4.096 aday placement, 2.000.000 aday üçgen, 131.072 kesit
segmenti; dolum ve mesafe rasterizasyonunda ayrı ayrı 32M işlem sınırı. Maske
4096² / 16 MiB ve en çok 16 array layer'dır; toplam Lake foam texture'ları
32 MiB ile sınırlıdır. Bekleyen/undo artifact cache'i 64 MiB, disk okuma cache'i
32 MiB ile sınırlıdır. Decode ve network byte sınırları allocation'dan önce/okuma
sırasında kontrol edilir. Sınıra sığmayan işlem eski sonucu değiştirmez.

Hesap yaklaşık 3 ms hedefli cooperative yield kullanır; worker eklenmedi.
Bu sınırlar ölçülmüş heap tepe değeri, her dilim için ≤4 ms veya GPU p95 kabulü
değildir. Büyük kayalık kümelerinde süre/heap/long-task ve donanım GPU kabulü
açık kalır; dar bant/büyük alan sessizce bulanıklaştırılmaz.

Doğrulama:

- İki yeni odaklı engine grubu geçti: gerçek kesit, üst/alt kaynak elemesi,
  örtüşme/GLTF alt mesh birleşimi, dönüşümler, iptal, deterministik texeller,
  binary/path/allowlist doğrulaması ve GPU texture dispose'u.
  Son Lake odaklı koşu mevcut terrain/foam regresyonlarıyla **15 geçti**;
  filtreli koşudur, tam engine gate olarak sayılmaz.
- Browser **1/1** Calculate/Recalculate/source güncelliği, Clear/Undo/Redo,
  kasıtlı HTTP 503 sonrası Save retry, checksum, Reload/Play ve terrain hash
  korunumu geçti. Runtime'da save/bake isteği oluşmadı.
- Son kontur çekirdeğiyle yakın iki kamera açısından render/animasyon browser
  testi **1/1** geçti. Efekt açık/kapalı draw sayısı eşit; GL/shader hatası yok.
  PNG'ler incelendi; yuvarlak ve uzun gerçek meshlerin çevresinde kırık temas var.
- TypeScript, smoke tipleri, production build, strict dist ve world-data geçti.
- Tam `build:verify` yeşil değildir: eşzamanlı su dışı World Builder bina/pad
  ve SurfaceResponse tutunma katsayısı testlerinde iki koşu durdu. Bu dosyalar
  köpük çalışması adına değiştirilmedi; odaklı sonuçlar tam gate yerine sunulmaz.

Kanıtlar: `.dev-server/lake-geometry-foam-browser-final.log`,
`lake-geometry-foam-final-results/`, `lake-geometry-foam-visual.log`,
`lake-geometry-foam-visual-results/`, `lake-geometry-foam-engine-final.log`,
`lake-geometry-foam-production-final.log`; tam gate sınırı
`lake-geometry-foam-build.log` ve `lake-geometry-foam-final-build.log` içindedir.

Codex Security diff scan önerildi; kullanıcı scan başlatmadığından çalıştırılmadı.
Testler izole smoke projelerine yazdı. Kullanıcının Terrain sahnesi, foam
dosyaları ve eşzamanlı diğer değişiklikleri korundu. Commit/push yapılmadı.
