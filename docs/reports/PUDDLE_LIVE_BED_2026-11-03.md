# Puddle canlı yatak — Faz 2 / 3 Kasım 2026

Durum: **Uygulandı ve teknik doğrulandı.** Hedef donanım performansı, büyük dünya
streaming matrisi ve kullanıcının kendi sahnesindeki görsel kabul ayrıca açıktır.
[Ana plan](../planned/PUDDLE_DEVELOPMENT_PLAN.md#faz-2--deforme-çamur-yatağı-ve-yatay-su-yüzeyinin-birleşimi).
Wheel Ripples üretimi Faz 3'tür; bu teslimde dalga/çamur VFX eklenmedi.

## Davranış

Sculpt'taki aynı bağlı çukur doldurma hesabı Play'de de kullanılır. Fark,
hesaba verilen tabanın authored terrain yüksekliği ile canlı tekerlek
deformasyonunun toplamı olmasıdır. Su kotu yatay/sabit kalır; bağlı oyukta
derinlik ve su sınırı değişir. Su kotunu aşan çamur kenarı kuru ada/kenar olur.
Araç izi su yüzeyini aşağı bükmez ve kuru komşu havzada kendiliğinden yeni
Puddle oluşturmaz.

## Ortak taban ve güncelleme yolu

- `TerrainDeformationTexture.captureBed()` renderer'a yüklenen tent filtresi,
  RGBA8 derinlik quantization'ı ve bilinear örneklemeyle aynı derinliğin tutarlı,
  salt okunur bir kopyasını üretir. Aynı `terrainDeformationDisplacement`
  fonksiyonu kenar kabarması ve hareketli pencere sönümünü uygular. Ham fizik
  derinliğini çıkarmakla yetinilmez; fizik/renderer dirty kuyruğu tüketilmez.
- Derinlik revizyonları ve sınırlı değişen alan geçmişi, iz etkisi ilgili Puddle'a
  değmedikçe geometri kurulumunu atlar. Pencere kayması/detach tüm eski veriyi
  geçersizleştirir. Trail/ıslaklık kanalı tek başına tabanı yeniden kurmaz.
- Terrain tile okuması authored değişimde yapılır. Sonraki canlı işler yalnız
  gövdenin kapsadığı tile'ları tutan cache'i kullanır; o anda resident olan tüm
  dünyanın tile'ları Puddle tarafından tutulmaz.
- `terrainPuddleSteps` mevcut doldurucunun cooperative sürümüdür. Tek iş kuyruğu,
  yaklaşık 2 ms dilim hedefi ve gövde başına en fazla 10 Hz birleştirme kullanır.
  Bu gerçek zaman garantisi değildir; birden fazla gövdede yayın sıklığı iş
  yüküne bağlıdır. Kare başına bütün arazi taranmaz. Devam eden işin snapshot'ı
  değişmez; yeni deformasyon sonraki güncellemede işlenir, sürekli araç hareketi
  işi sonsuza kadar iptal ettirmez. Silme/level/authoring değişimi işi iptal eder.
- Kaliteye bağlı en fazla iki ek detay seviyesi kullanılır. Native 1 m terrain
  High/Ultra'da 0,25 m olur; 1 m grid 12,5 cm ayrıntı gibi sunulmaz. Aynı alanda
  gerçek CDLOD düğümleri bu grid'e sabitlenir ve morph kapatılır. Su geometrisi
  ile görünen taban aynı b–c üçgenlerini kullanır; ayrı sahte taban mesh'i yoktur.
- Toplam 65536 ve gövde başına 128×128 hücre sınırları korunur. Örneğin native
  1 m / iki detay seviyesinde çalışma kenarı en fazla 32 m olabilir. Sınır aşımı
  açık hata sonucu verir; önceki geçerli yüzey korunur. Ayrıntı sessizce azaltılmaz.
  Snapshot kopyası en fazla 1024² derinlik baytıdır; varsayılan 512² pencere
  256 KiB kopya üretir. Tek canlı iş yürür.

## Su filmi ve sorgu

- Terrain'in yerel ıslak rut/su filmi, yalnız ilgili terrain'e ait gerçek bağlı
  Puddle yüzünün altında ve çizilen taban su seviyesinden aşağıdaysa bastırılır.
  Çamur rengi, ıslaklık ve gerçek oyuklar korunur; Puddle dışında film değişmez.
- Bir sahneye ait tek R8 array maskesi en fazla 16 kalıcı gövde + bir taslağı
  taşır. Aktif deformasyon ve kayıtlı Puddle yokken sampler shader'dan çıkar;
  diğer sahnelerin gölge bütçesi değişmez. Aktif maskede bir sampler ayrılır;
  16 birimli GPU'da gerektiğinde mevcut cascade bütçesi bir kademe azalır.
- `sample(terrainRef, x, z)` gövde kimliği, sabit su kotu, yayımlanmış deforme
  taban, derinlik ve revizyon/güncellik bilgisi döndürür. Bağlı olmayan, kuru veya
  farklı terrain noktaları null döner. Önceki yüzey hata sırasında korunuyorsa
  sorgu `stale: true` ile döner; Faz 3 bunu geçerli yeni temas saymamalıdır. Faz 3 bu
  sorguyu kullanabilir; yeni tekerlek dalgası aboneliği bu faza eklenmedi.
- Reset, pencere kayması, Hide/Delete, başarısız rebuild, geç tile yanıtı ve
  level değişiminde önceki geçerli yüzey/iptal kuralları korunur. Hata durumunda
  sonuç mesajı yüzeyin önceki olduğunu belirtir. Collider yeniden kurulmaz;
  araç gömülmesi mevcut süspansiyon/kuvvet adaptörüyle çalışır.

## Doğrulama ve kanıt

- TypeScript, üretim `npm.cmd run build`, strict dist ve world-data geçti.
- Tam `npm.cmd run test:engine:slow`: **2376 kontrol geçti**. Önceki
  `build:verify` koşusunun builder/tür kontrolleri geçti; engine aşamasındaki
  sabit sampler beklentileri yeni koşullu maskeye göre güncellendikten sonra
  tam engine ve üretim/dağıtım kontrolleri tekrar çalıştırıldı.
- Yeni engine kontrolleri: immutable filtreli snapshot, dirty kuyruğunun
  korunması, yakın detayın gerçek CDLOD grid'iyle eşleşmesi, suya bağlanan yeni
  tekerlek oyuğu, kuru çamur kenarı, sabit kot, idle frame, reset/pencere ve
  bekleyen iş sırasında silme. Sampler ve cascade bütçeleri ayrıca sınandı.
- **Altı farklı tarayıcı senaryosu geçti:** gerçek Rapier aracı, Puddle taslak
  akışı, kalıcılık/undo/Save/Reload/Play, planar yansıma, Lake kıyı–yerel film
  geçişi ve ıslak zemin glare regresyonu. Gerçek araç testi iki başarılı koşuda
  doğrulandı. İlk araç fixture'ındaki import/yükseklik özeti hataları düzeltildi;
  başarısız fixture koşuları geçerli kabul sayılmadı.
- Araç testinde gerçek runtime capability sırası ve Rapier fizik adımları
  kullanılır. Tek araca kontrollü giriş impulsu verilir; oyuklar doğrudan test
  tarafından stamp edilmez. En az iki tekerlek teması, aktif iz hücreleri,
  artan taban derinliği, 0,25 m örnekleme ve sabit Y doğrulanır. GPU shader
  probu Puddle altındaki ikinci filmin bastırıldığını gösterir; terrain binary
  hash'i korunur ve console/WebGL hatası yoktur.
- [Su açık: bağlı oyuklar ve çamur kenarları](evidence/puddle-live-bed/puddle-real-wheels-water.png)
- [Aynı kamera/izler, su materyali gizli](evidence/puddle-live-bed/puddle-real-wheels-bed.png)

Görseller kontrollü küçük havza ve ReferenceCar fixture'ıdır. Kullanıcının
kamyon sahnesi değiştirilmedi; o sahnedeki görünüm ve çok araç/GPU kabulü ayrıca
kontrol edilmelidir. Yağmur, akış/taşma, su miktarı korunumu ve runtime izlerinin
diske kaydı bu teslimin kapsamında değildir.
