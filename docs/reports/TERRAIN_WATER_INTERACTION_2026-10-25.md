# Arazi suyu: tekerlek etkileşimi ve yerel planar yansıma

## Ultra yansıma düzeltmesi — 26 Ekim 2026

Açık dünya kamerası reversed-Z kullanırken planar kaynak standart derinlik
uzayının kesme formülünü uyguluyordu. Ayrıca Three.js `Camera.copy()`,
`reversedDepth` durumunu kopyalamıyor; renderer yansıma kamerasının projeksiyonunu
yeniden kurup eğik kesme düzlemini kaybedebiliyordu. Yansıma kamerası artık
kaynağın derinlik modunu koruyor; kesme düzlemi standart ve reversed-Z için
ayrı hesaplanıyor ve ters projeksiyon matrisi güncelleniyor. Ortak kaynak
kullanıldığı için düzeltme River yansımaları için de geçerli.

Regresyon kapsamı perspektif ve ortografik kameraların iki derinlik modundaki
kesme yarı uzayını ve reversed-Z WebGL görüntüsündeki nesne yansımasını içerir.
Dar 25 cm izler de gerçek shader üzerinden kontrol edilir.

GAZ-52 runtime kontrolü, LandscapeTest'in gerçek arazisini, ışıklarını,
atmosferini, post-process hattını ve araç/fizik modüllerini açar. Test HTTP
yanıtında yalnızca fizik profili çamur yapılır ve ilgisiz world-cell prop'ları
çıkarılır; kayıtlı sahneye yazılmaz. Önce doğal tekerlek temaslarının su
sistemine ulaştığı doğrulanır. Yazılımsal renderer'da uzun sürüş beklememek için
sonraki görsel kontrolde bu temasların izleri geçici olarak uzatılır.
Ana görüntüde araç görünür kalırken yalnızca planar capture içindeki araç
açılıp kapatılır; iki görüntünün piksel farkı ölçülür.

Son doğrulama: `npm.cmd run build:verify` başarılı; TypeScript, smoke fixture
tipleri, üretim build'i, **1.936 engine kontrolü**, strict dist ve world-data
kontrolleri geçti. Dinamik su WebGL testi standart/reversed-Z, üç kalite ve
dar iz kontrolleriyle geçti. GAZ-52/Ultra runtime testi de geçti: yalnızca
araç yansımasının değişmesi **5.204 pikselde** en az 15/255 RGB farkı oluşturdu;
en büyük kanal farkı 76/255. Bu test yansımanın gerçek görüntüye katkısını
kontrol eder; kullanıcının açık editör oturumunun görsel kabulü değildir.

Güncel kanıtlar:

- `.dev-server/terrain-water-runtime-causal/`: GAZ-52, Ultra, yansımalı ve
  araç yansıması çıkarılmış iki görüntü, fizik/su snapshot'ı ve piksel farkı.
- `.dev-server/terrain-water-reversed/`: üç kalite, dalga sönümü, kaynak
  temizliği, dar iz ve reversed-Z görüntüleri.
- `.dev-server/terrain-water-static-final/`: mevcut çamur/su görünümü ve
  editörde beşinci katman ekle/geri al/boya/kaydet/yeniden yükle regresyonları;
  iki test de geçti.
- `.dev-server/terrain-water-build-verify.log`: tam doğrulama çıktısı.

Su hareketi, fizik ve kayıt verisinden ayrı bir sunum alanıdır. Gerçek tekerlek
teması, konum değişimi ve tekerlek dönüşü iki GPU yükseklik/hız tamponunu
besler. Duran tekerlek enerji eklemez; yerinde patinaj ekler. Havada kalma ve
teleport eski temasla uzun bir iz oluşturmaz. Dalga yüksekliği normal hesabına
dönüştürülür; arazi collider'ı ve tekerlek fiziği değişmez.

## Kapsam

- Yerel pencere 32 × 32 m; oyuncu aracını izler ve taşınırken korunabilen
  hücreler dünya konumlarında kalır. CPU ıslaklık maskesi 256²'dir.
- Sabit 60 Hz dalga adımı, render başına en fazla dört telafi adımı ve en
  fazla 64 temas dürtüsü vardır. Islak temas geçmişi pencere içinde sınırlıdır.
  Kuru hücreler ve farklı seviyeler arasındaki büyük yükseklik farkları dalga
  aktarımını bastırır.
- Dalga normali yalnızca mevcut su maskesinde kullanılır; su sınırı dalga
  normalinden hesaplanmaz. Böylece hareket kıyı maskesini açıp kapatmaz.
- Yakındaki su filmleri 5 cm seviyeler halinde gruplanır; en yakın iki grup
  planar render alabilir. Diğer bölgeler mevcut Sky Light/environment yolunu
  kullanır. Su seviyesi değiştiğinde render hedefi yeniden ayrılmaz; havuzdaki
  kaynak yeni seviyede tekrar yakalanır.
- River ile aynı `PlanarReflectionSource` kullanılır. Yansıma kaynakları başka
  bir planar kamera içinden tekrar capture başlatmaz. Arazi görünür kalır;
  su shader'ı capture sırasında kendi planar örneklemesini kapatır.
- Capture çağrısı mesh'in `onBeforeRender` aşamasındadır. Malzeme callback'inde
  başlatılan nested render, three'nin dış çizim için hesapladığı object
  modelView/normal matrislerini bozabildiğinden bu aşama kullanılmaz.
- LOD dikişlerini örten dikey skirt yüzeyleri yalnızca planar geçişte
  kaldırılır. Aksi halde suyun altındaki kamera bu yardımcı yüzeyleri görür ve
  gerçek nesne yansımasını şeritler halinde keser. Ana kamera skirt'leri korur.
- Referans seviyeler GPU'ya yüklenen filtrelenmiş derinlikten seçilir. Su
  pikselinin seviye eşlemesi de aynı derinliği kullanır; daha seyrek vertex
  geometrisinin interpolasyonu dar izlerde yansımayı kesmez.
- Normal ve iki yansıma görüntüsü tek bir texture-array sampler'ını paylaşır.
  Sekiz katmanlı arazide, en az 16 texture unit sunan GPU'larda mevcut
  environment + güneş gölgesine yer bırakmak için yeni su yolu kapatılır.
  Daha fazla unit sunan GPU'larda sekiz katmanla da açılır. Float render target
  desteği yoksa mevcut su görünümü korunur.

| Kalite | Dalga tamponu | Planar yansıma |
| --- | --- | --- |
| Düşük | 256² | Kapalı; mevcut environment |
| Orta | 256² | 256², en az 32 ms aralık |
| Yüksek / Ultra | 512² | 512², 2× MSAA, en az 4 ms aralık |

`QualitySettings.terrainWaterQuality` runtime kalite uygulayıcısına ve custom
ayar normalizasyonuna bağlıdır. Ayrı bir authored actor veya Sphere Capture
oluşturulmaz; Sky Light/environment değiştirilmez. Level unload ve dispose,
tamponları ve yansıma kaynaklarını bırakır.

## Doğrulama ve sınırlar

Engine kontrolleri: hareket/patinaj/durma, kuru ve havada temas, teleport,
zamana bağlı dürtü miktarı, toroidal pencere sınırları, kalite normalizasyonu,
reflection kamera işaretlemesi, kaynak seviyesini yeniden ayırmadan değiştirme,
hata halinde render durumunu geri yükleme ve araç modülünden su alanına veri
akışı. Shader sampler bütçesi 16 ve 32 unit koşullarıyla kontrol edilir.

Tarayıcı fixture'ı gerçek terrain/layer loader ve WebGL shader'larını kullanır.
Sky Light ile aynı environment/PMREM yolunu, hareketten sonra sönmeyi, pencere
kaymasını, zeminin nested render sonrasında görünür kalmasını, renkli nesnenin
planar yansımasını, üç kaliteyi ve unload sonrası kaynak bırakmayı kontrol eder.

Bu bir sığ su filmi yaklaşımıdır. Su hacmi/akışı, taşma, kaldırma kuvveti ve
ayrı yatay su geometrisi eklenmedi. Capture için yatay bir referans seviye
kullanılır; su görüntüsü mevcut deforme arazi üzerinde çizilir. Tam açık dünya
sürüşünde görsel kabul ve gerçek donanım performansı ayrıca değerlendirilmelidir.

Kanıt klasörü `.dev-server/terrain-water-evidence/`; build log'u
`.dev-server/terrain-water-build-verify.log` dosyasıdır. Tarayıcı zamanlaması
SwiftShader üzerinde kontrollü fixture ölçümüdür; GPU timer query sonucu
bulunmadığından gerçek GPU süresi veya açık dünya FPS sonucu değildir.
