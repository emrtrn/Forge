# Lake / River — ortak köpük malzemesi, V1b

29 Ekim 2026. Kullanıcı önceliğiyle görsel köpük geliştirmesi öne alındı.
[Su gelişim planındaki V1b](../planned/WATER_SYSTEM_DEVELOPMENT_PLAN.md#v1b--ortak-köpük-malzemesi)
için ilk uygulama yapıldı. Görsel kullanıcı kabulü ve yeni GPU maliyeti açık.

## Uygulama

- Ultra-Water `ce9248fa20afbdf63fd4c11709f68d7368aca0a0` sürümündeki
  `bakeTextures.js` ve `OceanSurface.js` köpük yaklaşımı uyarlandı.
- `tools/bake-water-foam.mjs`, döşenebilir 512×512 RGBA dokuyu geliştirme
  sırasında üretir. R çok ölçekli ağ/kabarcık deseni, G kabarıklık, BA eğimdir.
  Başlangıçta veya gövde başına Voronoi hesabı/GPU bake geçişi yapılmaz.
- `waterFoamMaterial.ts` Lake/River için aynı texture'ı kiralar. İlk gerçek
  köpük çiziminde yüklenir; yükleme sürerken veya başarısızsa prosedürel desen
  kullanılır. Son kiracı bırakıldığında texture dispose edilir. Geç yükleme,
  kapanmış kaynağı veya başka bir kirayı ready yapamaz.
- Yoğunlukla değişen desen eşiği, ince boşluklar ve parçalı kümeler üretir.
  Kabarıklık/eğim ışığı etkiler; ince ve yoğun köpük rengi ayrılır. Güneş,
  mevcut gölge görünürlüğü, ortam ışığı ve ortam haritası kullanılır. Lake
  geometrik dalga eğimi ve River yüzey eğimi köpük normaline katılır.
- Lake'te yavaş detay sürüklenmesi, River'da mevcut akış hızı/yönüne bağlı
  detay hareketi vardır. Otomatik maskenin temas bandı hareket ettirilmez.
  River'ın sınırlı downstream maske örnekleri aynı detay koordinatını paylaşır.
- Calculate/Recalculate/Cancel/Clear ve binary maskeler değişmedi. Yeni kayıt
  alanı veya editör kontrolü yok; mevcut scale/speed/strength/opacity kullanılır.
  Kullanıcı sahneleri, terrain ve bağımlılıklar bu iş kapsamında düzenlenmedi.
- MIT bildirimi ve alınan hash yaklaşımının Dave Hoskins bildirimi
  `public/licenses/ultra-water.txt` içinde, production dağıtımında korunur.

## Kaynak maliyeti

| Alan | Bu teslim |
| --- | --- |
| Paylaşılan doku | 512×512 RGBA8, linear veri, repeat, trilinear mip |
| Dosya | 1.022.148 byte PNG |
| Ham GPU renk verisi | Miplerle 1.398.100 byte; sürücü tepe ölçümü değil |
| Ek sampler | Her su shader'ında 1; gövde başına ayrı doku yok |
| Detay örnekleme | Çağrı başına 2 texture örneği; River wake örnekleri tekrar kullanır |
| Ek çizim / sahne capture | 0; ilk yüklemede texture upload ve mip üretimi var |
| Runtime simülasyon/geçmiş | Yok; gerçek köpük taşınımı veya yaş geçmişi değil |

## Doğrulama ve kanıt

- TypeScript ve smoke TypeScript kontrolleri geçti.
- Production build, import sınırları ve strict dist geçti; doku ve lisans
  production çıktısında mevcut. Tam kapı logları aşağıdadır.
- İlk tam kapının engine sonucu **2.127 kontrol geçti**. Çalışma ağacında
  eşzamanlı başka işler vardır; bu sayı daha sonraki ek testleri kapsamaz.
- Son `build:verify`, TypeScript ve production build sonrasında eşzamanlı
  eklenen `recast nav: tiles stream — dropped tiles stop a path, rebuilt ones
  restore it` testinde `failure` / beklenen `success` ayrımıyla durdu.
  Recast/navigation/physics dosyaları bu köpük işi kapsamında düzenlenmedi.
  Son köpük engine koşusu **12 geçti** (filtreli, genel suite kabulü değil).
  Son genel kapı bu nedenle yeşil olarak raporlanmaz.
- Köpük tarayıcı koşusu **5/5 geçti**: ortak 512² kaynak, yakın/uzak ve ters
  açı, hareket, doğrudan ışık kapalı/gündüz/gece; 20 kalite geçişinde kaynak
  sayısı sabit; son kiracı dispose; gecikmiş başarılı yükleme; 404 fallback;
  Lake mesh teması ve River akışı, GL/console hataları ve çizim sayısı.
- Mevcut editör/Play senaryoları **3/3 geçti**: Lake kalite menüsü ve canlı
  Play; Lake otomatik geometri köpüğü Calculate/Recalculate/undo/binary
  Save/Reload/Play; River otomatik köpük ve caustics Save/Reload/Play.
- Sayılan kullanıcı su texture'larının tamamı bırakılır. Three'nin dahili
  boş sampler2DArray texture'ı renderer ömrünce kalır; genel sayaçta 1 olması
  suya ait bir sızıntı olarak yorumlanmaz.
- Görsel inceleme: RTX 3060 / Chrome / ANGLE D3D11; 800×600 canvas,
  DPR 1; 1000×720 tarayıcı viewport'u. Yakın Lake/River, ters açı,
  uzak görünüm ve doğrudan ışık kapalı/gece görüntüleri incelendi.
  Malzeme deseninde kesik ekran kenarı veya GL shader hatası görülmedi.

Kanıtlar (yerel, Git dışında):

- `.dev-server/foam-material/lake-before.png`, `river-before.png`:
  kaynak değişmeden önce, mevcut sabit kameralardaki görüntüler.
- Aynı dizindeki `lake-after.png`: ilk aynı-kamera Lake karşılaştırması.
- `lake-close.png`, `river-close.png`, `*-shadow.png`, `*-night.png`,
  `*-far.png`: yeni malzemenin ayrıntı/ışık kontrolü. Önceki yakın-açı
  görüntüsü yok; bu dosyalar yakın açı için önce/sonra çifti değildir.
- `browser-accepted.log`: son köpük koşusu, 5/5.
- `editor-gate.log`: editör/Play, 3/3.
- `build-verify.log`, `build-final.log`: tam doğrulama kayıtları.
- `engine-final.log`: son kaynakta 12 köpük kontrolü; filtreli koşu.
- `source-hashes.json`: ilgili son kaynak ve doku hash'leri.

## Açık kabul

- Kullanıcının gerçek sahnesinde görünüm değerlendirmesi yapılmadı.
- Yeni shader'ın eşlenmiş AB/BA GPU farkı, ilk upload takılması, transient
  bellek tepesi ve bütün kalite/donanım matrisi ölçülmedi. Kaynak sayısının
  sabitliği bu kabulleri kapatmaz. Genel P0 açık kalır.
- Gölge görünürlüğü mevcut CSM yoluna bağlıdır. Bu malzemeye özel fixture
  doğrudan ışık kapatma kontrolü yapar; yeni, ayrı CSM gölge sınırı ölçümü
  veya bütün gün/gece ortam profilleri için kabul değildir.
- V0'ın geniş referans sahnesi, V1a optik profilleri, V1c yansıma ve V2
  kırılma bu teslimle tamamlanmış sayılmaz. V1b'nin kullanıcı görsel kabulü
  ve GPU/sampler bütçe kabulü açık tutulur.
