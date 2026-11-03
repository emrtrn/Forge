# Puddle — çamurlu zemin ve gerçek tekerlek oyukları

Tarih: 3 Kasım 2026. Durum: **İzole prototip, Landscape/Water önizlemesi ve
kalıcı Puddle kaydı, planar yansıma ve canlı deforme yatak bağlantısı uygulandı.**
Editör ve Play aynı terrain örnekleme/doldurma çekirdeğini paylaşır. Puddle Wheel
Ripples (Faz 3) uygulandı. Faz 4–5 için kullanıcı görsel kabulü verildi;
genel W3/hedef donanım performans kabulü ayrı açık kalır. Kaynak planlar:
[Water Body / W3](WORLD_TERRAIN_WATER_BODY_PLAN.md),
[Terrain Deformasyonu](TERRAIN_DEFORMATION_PLAN.md).

**Yeni iş sırası — 3 Kasım 2026:** Wheel Ripples (Faz 3) tamamlandıktan sonra
**Faz 4: World Environment rüzgarına bağlı normal-map dalgacıkları** ve
**Faz 5: dibi örten çamurlu su yoğunluğu** sırasını izler. Faz 4 uygulandı;
Faz 5 uygulandı; kullanıcı görsel kabulünden sonra toplu teknik doğrulama ve
main'e teslim istenmiştir. Son durum [Faz 4–5 teslim raporundadır](../reports/PUDDLE_MUD_DENSITY_2026-11-03.md).
Aşağıdaki yeni görünüm kararı, Faz 2'deki
“su altı tabanı/izi okunur” görsel hedefinin yerini alır. Deforme yatak sorgusu,
su sınırı, derinlik ve araç teması hesapları geçerliliğini korur.

**3 Kasım 2026 güncellemesi:** Planar yansıma **Faz 1**, canlı çamur deformasyonu
ile suyun birleşimi **Faz 2** kapsamında uygulandı; Wheel Ripples **Faz 3** olarak
uygulandı. Kullanıcı fazların sırayla uygulanıp ayrı ayrı main'e push edilmesini istedi.
Donanım performansı ve kullanıcı görsel kabulü, teknik doğrulamadan ayrıdır.
Teslim ayrıntıları: [Puddle planar yansıma](../reports/PUDDLE_PLANAR_2026-11-03.md).
[Canlı Puddle yatağı](../reports/PUDDLE_LIVE_BED_2026-11-03.md).
[Faz 3 Wheel Ripples ve doğrulama sınırları](../reports/PUDDLE_WHEEL_RIPPLES_2026-11-03.md).

## Kullanıcı hedefi ve yaklaşım

Referans: çamurlu depo avlusu; geniş sığ birikintiler, kuru tümsekler ve gerçek
tekerlek oyukları. İzler yalnız normal map olmayacak, zemin geometrisi çökecek.

- Landscape Paint zeminin malzemesini, ıslaklığını ve mekanik yumuşaklığını belirler.
- CPU-otoriter mevcut deformasyon alanı oyuk derinliğini sağlar. Görsel geometri
  çökmesi ve kenar kabarması aynı yükseklik fonksiyonundan hesaplanır.
- Puddle, deforme zeminin üzerindeki ayrı yatay su yüzeyidir. Su seviyesi, bir
  başlangıç noktası ve sınırlı çalışma alanıyla yalnız bağlı çukur doldurulur.
- Yeni oyuk suyu kendiliğinden üretmez. İlk sürüm bölgeye atanmış sabit su
  seviyesini kullanır; miktar korunumu, yağmur, taşma ve akış ayrı kapsamdır.

## İlk teslim — avlu prototipi

`tests/smoke/pages/terrain-puddle.html` Vite üzerinden açılır. Su eklemek için
çukura tıkla; seviye kaydırıcısı, kontrollü araç geçişi, suyu gizleme ve sıfırlama
kontrolleri vardır. Sağ fare kamera döndürür, tekerlek yakınlaştırır.

Prototip gerçek `DeformationField.stampWheel` ve mevcut
`terrainDeformationDisplacement` fonksiyonunu kullanır. Avlu zeminindeki vertex
yükseklikleri değiştirilir; bu geometri üzerinde bağımsız su yüzeyi yeniden
kırpılır. Araç kontrollü bir temas kaynağıdır, bu sayfa Rapier sürüş testi değildir.

Genel çekirdek `engine/terrain/terrainPuddle.ts`; renderer
`engine/render-three/terrain/terrainPuddleSurface.ts`. Çağıran, deforme yatak
yüksekliğini ve açık örnekleme aralığını sağlar. Örneklenen üçgenler gerçek bed
mesh'iyle aynı köşegeni/çözünürlüğü kullanmalıdır; bu prototip CDLOD'a henüz bağlı
değildir. Statik mesh veya bilinmeyen terrain verisi varsayımla doldurulmaz.

Sınırlar:

- Gövde başına en fazla 128×128 hücre; avlu 96×96, 12,5 cm aralıklıdır.
- Avluda en fazla dört birikinti. Ada ve bağlı olmayan diğer çukur kuru kalır.
- Su alanı çalışma sınırına erişirse veya gerekli zemin bilinmiyorsa açık sonuç
  döner, son geçerli yüzey korunur. Kuru sonuç yüzeyi temizler.
- Yatak revizyonları fixture'da 100 ms aralıklarla birleştirilir. Senkron geometri
  kurulumu production CPU dilim bütçesini sağlamış sayılmaz.
- Ortam yansıması ve derinliğe bağlı kıyı alpha geçişi; isteğe bağlı sahne-owned
  planar binding. Avlu aynı seviyedeki gövdeler için tek mevcut Medium planar
  kaynağı paylaşır (256 px, en az 32 ms aralık); gövde başına capture yoktur.
  Kırılma render target'ı yoktur. Bu limitler GPU süre kabulü değildir.
- En fazla 12 analitik tekerlek dalgası; iki saniyede söner. Henüz genel
  Lake/River etkileşim aboneliği ve kuru engellerde dalga yayılımı çözümü yoktur.
- Collider sabit kalır. Mevcut sistemde araç gömülmesi süspansiyon/kuvvet
  adaptörüyle sağlanır; bütün rigid body'ler deforme collider'a oturmaz.
- Runtime izleri authored terrain'e yazılmaz. Prototip kayıt/undo endpoint'i
  veya kalıcı Puddle şeması eklemez; reset izleri ve su seçimini temizler.

## Sonraki uygulama dilimleri

1. **Prototip kabulü:** yakın/eğik açıda gerçek oyuk, yükselen çamur kenarı,
   sabit seviyede değişen su sınırı; hedef GPU'da CPU/GPU ölçümü. Örnekleme
   doğruluğu ve kabul edilen görünüm belirlenmeden büyük dünya entegrasyonu yok.
2. **Landscape Puddle önizlemesi — uygulandı:** mevcut çukura tıklama, çalışma
   alanı ve su seviyesi; kuru/ıslak önizleme ve taşan sınır uyarısı. Water / Add
   Puddle akışı Lake ile aynı taslak korumasını kullanır. Create yapılmamış
   taslak Save/Play içine alınmaz; oluşturulan gövde kalıcıdır. Gerçek terrain
   aralığı kullanılır; düzlemi ayarlamak yeni Sculpt veya paint verisi üretmez.
3. **Kalıcı veri — uygulandı:** ayrı `puddleWaters` koleksiyonu; Puddle kimliği,
   terrain referansı, seed, sınır, kot, görünüm ve hidden/locked. Ortak read/save
   validator, Outliner/Water seçimi, oluştur/düzenle/sil undo/redo ve Save/Reload/Play
   desteği vardır. Geometri kaydedilmez. [Teslim raporu](../reports/PUDDLE_PERSISTENCE_2026-11-03.md).
4. **World Terrain bağlantısı — sınırlı canlı yatak uygulandı:** gerçek tile üçgenleri, Sculpt revizyonları,
   deformasyonun render filtrelemesi, CDLOD detayı, dirty rect güncellemeleri,
   eksik tile ve tile sınırları. Kaynak iptali ve travel temizliği. Sabit yerel
   detay/iş bütçeleri Faz 2 raporundadır; büyük dünya streaming/GPU kabulü ayrıdır.
5. **Araç entegrasyonu:** gerçek araç temas aboneliği; su derinliği, hareket ve
   patinaja bağlı dalga/çamur sıçraması. Kuru çukura su eklememe; basin ayrımı ve
   dalganın ada/kuru boşluk üzerinden atlamamasını doğrulama.
6. **Kaynak ve kabul:** kalite tavanları, kontrollü yansıma paylaşımı, production
   açılışı, çok gövde/araç, reset/rebuild/travel ve gerçek GPU ölçümü. Runtime
   iz kalıcılığı mevcut deformasyon planının ayrı açık işidir.

## Doğrulama

Engine testleri: bağlı çukur/ada, yatay su, açık sınır/eksik veri, son geçerli
geometriyi koruma ve gerçek tekerlek derinliğiyle büyüyen su alanı.
Playwright: kontrollü tekerlek geçişi, değişen geometri/alan, sabit su seviyesi,
su seviyesi değişirken izlerin korunması, konsol/WebGL ve tekrar reset kaynakları.
Nihai koşu sonuçları `docs/reports/PUDDLE_PROTOTYPE_2026-11-03.md` içindedir.

## Landscape / Water oluşturma akışı

World Terrain seç → **Landscape Mode: Water** → **Water / Add Puddle** →
çukura tıkla → **Draft Preview** → **Create Puddle**.
Add Puddle, Add River ve Add Lake ile aynı Water bölümündedir; bağımsız bir
Puddle Preview giriş bölümü yoktur. Nokta seçiminde **Finish Picking** veya Esc
seçimi bitirir. **Water Level (World Y)** yatay su kotunu,
**Working Area (m)** başlangıç noktası çevresindeki kare bölgeyi ayarlar.
Alan native terrain grid'ine hizalanır. İlk kot tıklanan tabanın 5 cm üzeridir;
çukur sınıra kadar açık kalırsa alanı genişletmek veya kotu düşürmek gerekir.

Hazır önizlemede **Create Puddle** kalıcı gövdeyi oluşturur. Outliner veya Water
Bodies listesinden seçilen Puddle'ın kotu, alanı ve görünümü düzenlenir; hidden,
locked ve silme desteklenir. Create/Edit/Delete komutları undo/redo'ya katılır.
Save gövdeyi level'e yazar; Reload ve Play aynı kaynaktan yüzeyi tekrar üretir.

Taslak oluştuğunda Esc onu silmez; **Finish Editing** veya başka nesneye geçiş
girişimi **Pending Draft** durumunu açar. **Create Puddle and Continue** oluşturup
bekleyen seçime geçer, **Discard Draft** taslağı siler, **Resume Editing** geri
döner. Taslak/nokta seçimi sürerken diğer Water araçları ve gövde listesi
kilitlenir. Level değişimi geçici yüzeyi temizler. Esc panel alanında yazarken de
çalışır. Eksik tile yüklemeleri
iptal edilebilir; geç tamamlanan yükleme temizlenmiş yüzeyi geri getirmez.
Tek önizleme ve en fazla 16 eksik tile okuması vardır; gövde başına ek planar
capture tahsis edilmez. Önizleme Create yapılmadan kaydedilmez. Kalıcı gövdelerin
gerçek araç izlerinden canlı yatak bağlantısı Faz 2'de eklendi; yüzeyde Wheel
Ripples üretimi Faz 3'tedir. Teknik kayıt:
[Landscape Puddle önizlemesi](../reports/PUDDLE_EDITOR_PREVIEW_2026-11-03.md).

## Sıralı uygulama fazları — 3 Kasım 2026

İlk üç kullanıcı isteği ve bunları izleyen Faz 4–5 sırayla uygulanır. Her fazın teknik kontrolleri ve görsel
kabulü ayrı kaydedilir; bir fazın geçmesi diğerlerini tamamlanmış saydırmaz.
Araç ve deformasyon entegrasyonunun ortak temeli Faz 2'de hazırlanır, Wheel
Ripples bu temeli Faz 3'te kullanır. Mevcut kaynak/kabul dilimleri de geçerlidir.

### Mevcut durum ve görüntüdeki sorun

- `TerrainPuddleSurface` harici planar binding ve en fazla 12 analitik ripple
  destekler. Faz 1 ile kalıcı Puddle ve taslak aynı planar kaynak yöneticisine
  bağlandı. Gerçek araç teması/ripple bağlantısı Faz 3'te açık kalır.
- `terrainPuddlePreparation.ts` suyu authored terrain yüksekliğinden hazırlar;
  Faz 2 ile doldurma çekirdeği `DeformationField`'ın renderer'a yüklenen
  filtrelenmiş/quantize kopyasını da okuyarak yüzeyi yeniden kırpar.
- Terrain renderer kendi tekerlek oyuklarını, yükselen çamur kenarını ve yerel
  ıslak iz/su filmi görünümünü üretir. Bu görünüm, authored Puddle yüzeyinden
  ayrıdır; Lake altında bastırılan yerel film için Puddle ilişkisi incelenmelidir.
- Kullanıcının eklediği araç görüntüsünde izlerle su görünümü birbirinden
  kopmaktadır. Statik su geometrisi, ayrı terrain filmi, derinlik/şeffaflık ve
  yakın zemin detayının etkisi ayrı ayrı doğrulanacak; görüntü tek başına kesin
  shader/render sırası teşhisi sayılmaz.
- **Hedef:** su seviyesi yatay kalır. Oyuk açılınca taban alçalır ve su derinliği
  artar; yükselen çamur kenarı su kotunu aşarsa görünür ve suyu keser. Su yüzeyi
  tekerlek izi şeklinde aşağı bükülmez. Su altındaki izin okunması, doğru taban
  görünürlüğü ve kıyı geçişiyle sağlanır.

### Faz 1 — Göldeki gibi planar yansıma

Durum: **Uygulandı.** Teknik testler ve sınırlar teslim raporunda; hedef GPU'da
eşlenik süre/bellek ölçümü ve kullanıcı görsel kabulü henüz tamamlanmadı.

**Amaç:** sahnedeki araç, ağaç ve yapıların Puddle üzerinde doğru düzlemden
yansıması; Draft Preview, oluşturulan gövde ve Play arasında tutarlı görünüm.

- [x] Puddle görünümüne `reflectionMode`, `reflectionQuality` ve ayrı
  `planarReflectionStrength` alanları ekle. Mevcut `reflectionStrength` ortam
  yansıması anlamını korusun. Eski kayıtlarda alanların yokluğu mevcut görünümü
  korusun; yeni gövdeler için önerilen başlangıç Planar / Medium olsun.
- [x] Reflection paneli: Mode (Environment / Planar Reflection), Quality
  (Low / Medium / High), Planar Strength ve mevcut Environment Reflection.
  Low ek planar capture açmasın; genel grafik kalitesi etkin kaliteye tavan koysun.
- [x] `SceneApp` ve `RuntimeSceneApp` içindeki mevcut `WaterReflectionRegistry`
  kalıcı Puddle controller'ına ve taslak önizlemesine bağlansın. Aynı düzlem,
  grup ve etkin kalitedeki Lake/River/Puddle aynı kaynağı paylaşabilsin; farklı
  kotlar yanlışlıkla tek yansıma kamerasına bağlanmasın.
- [x] `TerrainPuddleSurface` mevcut capture'ı render sırasında güncellesin;
  ilk geçerli capture'dan önce ortam yansımasını kullansın. Fresnel, roughness,
  renk uzayı/HDR ve premultiplied alpha birleşimi Lake yaklaşımıyla doğrulansın.
  Planar şiddeti ortam yansımasını iki kez ekleyerek parlama üretmesin.
- [x] Su yüzeyleri/editör yardımcıları capture dışında kalsın. Var olan ekran
  kaplama, görünürlük ve güncelleme aralığı kontrolleri kullanılsın.
- [x] Uygulanan bütçe: Puddle nedeniyle eklenen en fazla **iki bağımsız planar
  kaynak**. Zaten paylaşılan kaynak ikinci kez sayılmasın. Fazla gruplar kararlı
  görünürlük/öncelik seçimi ve ortam yansımasına dönüş kullansın; hızlı kamera
  hareketinde kaynak aç/kapat titreşimi önlensin. Bu tavan Lake/River'ın mevcut
  toplam maliyetini sınırladığı iddiası değildir; hedef GPU ölçümüyle kabul edilir.
- [x] Hide/Delete/Discard, kot-kalite değişimi, undo/redo, level ve Edit/Play
  geçişlerinde consumer ve kaynak payları bırakılıp doğru yeniden edinilsin.
- [x] Alanlar `validatePuddleWater` üzerinden read/save yoluna alınsın;
  `tools/saveValidator.ts` bu ortak doğrulamayı kullandığı için alanların gerçekten
  korunması round-trip testiyle doğrulansın. Yeni endpoint gerekmez.

**Kabul:** ayırt edilebilir bir nesnenin yansıması hareketle güncellenir;
aynı kotta iki Puddle ile uygun Lake tek capture paylaşır, farklı kot doğru
yansır; Low/Off ve ekran dışı durumlar gereksiz capture üretmez. Save/Reload/Play,
undo/redo ve tekrarlı oluştur/sil sonrası kaynak sayıları doğrulanır. Hedef GPU'da
planar açık/kapalı eşlenik CPU/GPU ölçümü ayrıca raporlanır.

### Faz 2 — Deforme çamur yatağı ve yatay su yüzeyinin birleşimi

Durum: **Uygulandı ve teknik doğrulandı.** Gerçek Rapier tekerlekleriyle havza
testi ve su açık/kapalı görüntüler rapordadır. Renderer ile aynı sabit yerel
ızgara ve değişen alan bildirimleri kullanılır; bir gövde en fazla 10 Hz'de,
tek cooperative iş kuyruğundan güncellenir. Hedef GPU/büyük dünya ve kullanıcının
kendi sahnesindeki görsel kabul ayrıca açıktır.

**Amaç:** Mud fiziksel materyalindeki gerçek tekerlek oyuklarının Puddle altında
doğru okunması; yükselen kuru çamur kenarları üzerinde eski su örtüsünün kalmaması.

- [x] Gerçek araçla sorunu tekrar üret. Aynı kamera için Puddle açık/kapalı,
  terrain yerel su filmi açık/kapalı ve deformasyon açık/kapalı görüntülerini al.
  Su seviyesi, terrain tabanı, deformasyon derinliği ve yükselen kenarı ölçerek
  geometri, yüzey filmi ve şeffaflık/depth kaynaklarını ayır.
- [x] Ortak deforme yatak sorgusu oluştur: authored yükseklik + mevcut
  `terrainDeformationDisplacement` hesabı. Derinlik kadar kenar kabarması, filtre,
  pencere kenarı sönümü ve terrain katmanının deformasyona uygunluğu da eşleşsin.
  Yalnız `sample().depth` çıkarmak yeterli kabul edilmesin.
- [x] Deformasyon servisinin mevcut `sample/snapshot` sözleşmesine gerekiyorsa
  salt okunur pencere/revizyon/değişen alan bildirimi ekle. Renderer'ın
  `takeDirty()` kuyruğunu ikinci tüketiciyle boşaltma; Puddle kendi revizyonunu izlesin.
- [x] Terrain tile/CDLOD üçgenleriyle uyumlu yakın detay seç. 1 m grid'in
  12,5 cm teker izi ayrıntısını temsil ettiği varsayılmasın. Paylaşılan sorgu,
  yakın zemin geometrisi ve su kırpma çözünürlüğü birlikte doğrulansın; gerekirse
  sınırlı yerel detay kullanılsın. Terrain ile ayrı bir sahte taban üretme.
- [x] Sadece etkilenen görünür/etkin Puddle bölgelerinin derinlik ve sınırını
  güncelle. Değişiklikler birleştirilsin, işler iptal edilebilir ve kare başına
  bütçeli olsun; tüm gövdelerin her kare yeniden taranması yapılmasın.
- [x] `surfaceLevel` sabit kalsın. Su altında açılan oyuk dolu görünürken kotun
  üstüne çıkan çamur kenarı kuru/ıslak zemin olarak görünür olsun. Ada, bağlı
  havza ve sınır aşımı kuralları deforme tabanda da uygulansın.
- [x] Puddle'ın gerçekten kapladığı su altı bölgesinde terrain'in yerel rut su
  filmiyle çifte parlama/yüzey üretimi önlensin. Yerel filmi bütün Mud katmanında
  kapatma; Puddle dışında mevcut davranış korunsun. Opacity, derinlik fade'i ve
  render sırası yakın/eğik açıda birlikte ayarlansın.
- [x] Ortak bir su sorgusu hazırlansın: gövde kimliği, su kotu, deforme taban,
  su derinliği ve bağlı ıslak bölge. Faz 3 temas uygunluğu bunu kullansın.
- [x] Deformasyon penceresi kayması, recovery/reset, eksik tile, streaming ve
  level geçişinde statik/deforme veri tutarlılığı sağlansın. Son geçerli yüzey
  hata durumunda korunursa bunun güncelliği açık durum bilgisiyle belirtilsin.

**Kabul:** gerçek araçla sığ Mud birikintisinden geçildiğinde oyuklar ve çamur
kenarları su açık/kapalı görüntülerde aynı yerde kalır; su kotu değişmez.
Kotu aşan kenar örtülmez, su altı tabanı okunur, çift su/parlama oluşmaz.
Tile/LOD/pencere sınırları, tekrarlı geçiş, kuru komşu çukur ve reset sınanır.
Geometri sınırları ve CPU dilim/tepe bellek ölçülür. Küçük geometri bütçesi
yetmiyorsa doğruluk sessizce düşürülmez; açık sınır sonucu verilir.

### Faz 3 — Gerçek araç temasından Wheel Ripples

**Amaç:** Lake'teki gibi, Puddle içindeki hareket eden/patinaj yapan tekerleklerin
su yüzeyinde sönümlenen halkalar üretmesi. Zemindeki kalıcı oyukla geçici su
dalgası iki ayrı etkidir.

- [x] Editörde Puddle için **Wheel Ripples** bölümü ekle: Enabled, Strength,
  Spread Speed, Ring Width, Wavelength, Lifetime, Emission Interval ve Reset.
  Sığ/küçük yüzeye uygun başlangıç değerleri ve sınırlı aralıklar kullan.
- [x] Gerçek `VehicleHost.onPhysicsStep` temaslarını kullan. Ground entity ve
  terrain kimliği, gerçek temas, su kotu/derinliği ve bağlı ıslak bölgeyi Faz 2
  sorgusuyla doğrula; yalnız XZ bounds içinde olmak yeterli olmasın.
- [x] Hız ve patinaja göre emisyon üret; düz sürüş patinajında
  `tractionSlip` kullan, tekerlek dönüş farkını tek belirleyici yapma. Havada,
  kuru yerde veya durup patinaj yapmayan tekerde yeni halka üretme.
- [x] Lake'in temas/emisyon mantığının yeniden kullanılabilir kısımlarını paylaş;
  Lake'in renderer'ını veya büyük su dalgalarını Puddle'a taşımak gerekmez.
  Abonelik ve güncellemeler tek sahipte olsun; FPS'e bağlı çift emisyon oluşmasın.
- [x] Mevcut 12 halkalık yüzey sınırını ve sonlu ömür yaklaşımını temel al;
  çok gövde/araç için toplam aktif halka ve güncelleme bütçesi belirle.
- [x] Halka görünümü Puddle sınırı/deforme ıslak maske ile kesilsin. Kuru ada veya
  çamur engelinin ötesine analitik çember çizmek fiziksel yayılım sayılmaz:
  ilk sürümde engelde sonlandırma ya da bağlantı farkında sınırlı maskeleme
  seçilip doğrulansın; ayrı çukura halka atlamasın.
- [x] Faz 1 planar yansımasında dalga normal etkisi doğal görünsün; ripple
  animasyonu su kotunu veya Faz 2'nin sakin yüzey sınırını oynatmasın.
- [x] Grafik kalite değişimi kayıtlı ayarları değiştirmeden etkin halka sayısını
  sınırlasın. Hide/Delete/respawn/reset/level geçişinde geçmiş ve abonelik temizlensin.
- [x] Yalnız ayarlar kaydedilsin; canlı halka geçmişi Save/Reload ile saklanmasın.

**Kabul:** 30/60/144 Hz'de gerçek araç geçişi ve patinaj görünür, sınırlı ve
benzer sıklıkta dalga üretir. Durma, havaya kalkma ve kuru zeminde yeni emisyon
kesilir; mevcut dalga ömrünü tamamlar. Çok araç, iki ayrı çukur, ada/kuru kenar,
kalite değişimi, respawn ve tekrar Edit/Play ile sızıntı/çift abonelik sınanır.
Save/Reload/undo/redo ayarları korur; Lake/River dalgaları regresyona uğramaz.

### Faz 4 — World Environment rüzgarına bağlı normal-map dalgacıkları

Durum: **Uygulandı.** Faz 3 teslimi okunup temel alındı. Normal-map katmanı,
World Environment bağlantısı, taslak/kalıcı ayarlar ve Play saati eklendi.
Kullanıcı sahnesindeki son görünüm kabul edildi. Hedef donanım GPU/bellek
performans kabulü açık. [Faz 4 teslim raporu](../reports/PUDDLE_WIND_RIPPLES_2026-11-03.md).

**Görünüm referansı:** kullanıcının ilettiği kavisli, ince, birbirini izleyen
çizgi biçimli dalga sırtları esas alınır. Genel normal-map ayrıntısı yardımcı
katmandır; görünür ana desen rüzgar yönünde ilerleyen yumuşak yaylardır.

**Amaç:** araç yokken de Puddle üzerinde rüzgar esintisini gösteren küçük,
doğal yüzey dalgacıkları. Su geometrisi ve kotu yatay kalır; etki normal map,
ışık ve yansıma üzerinden görünür.

- [x] `engine/environment/wind.ts` içindeki `resolveLevelWind` sonucunu kullan:
  yön, etkin şiddet ve gust. World Environment canlı hava/mevsim etkileri,
  editör önizlemesi ve Play durumu aynı mevcut çözümleme kurallarını izlesin.
  World Environment yokken/gizliyken World Settings ve varsayılanlara dönüş
  korunsun. Puddle için bağımsız rüzgar yönü veya hava sistemi kurulmasın.
- [x] `SceneApp` ve `RuntimeSceneApp` üzerinden kalıcı controller ve Draft
  Preview'ya rüzgar/zaman aktar. Bağlantı foliage varlığına bağlı olmasın:
  mevcut `updateWindSway` fonksiyonları foliage yoksa erken dönüyor.
  Editör kendi önizleme saatini, Play simülasyon saatini kullansın; pause
  dalgacık animasyonunu dondursun. Ayar değişiminde faz atlaması önlensin.
- [x] Mevcut manifestteki uygun su normal asset'ini değerlendir; dünya XZ
  metre ölçeğinde iki farklı ölçek/hızda örnekle. Kayma yönü global rüzgarla
  uyumlu olsun; şiddet normal genliğini, gust zamana yayılan esintiyi etkilesin.
  Güç sıfırken rüzgar katkısı sıfır olsun. Sığ kıyıda sönüm, uzak görünümde
  mip/filtre ve parlama kontrolü ile tekrar eden kayış görünümü azaltılsın.
- [x] Rüzgar normali ile Faz 3 tekerlek dalga eğimini aynı dünya/view uzayında
  birleştir; toplam normal planar ve ortam yansımalarına tutarlı uygulansın.
  Wheel Ripples kapatılması rüzgarı kapatmasın; rüzgarın sıfırlanması araç
  halkalarını durdurmasın. Faz 3 emisyonu, havza maskesi ve halka bütçesi korunsun.
- [x] Puddle Details ve taslakta küçük bir **Wind Ripples** bölümü ekle:
  Enabled, Normal Strength, World Scale ve Speed Response. Yön/etkin güç
  World Environment'tan gelsin. Nihai varsayılan ve aralıklar küçük/sığ
  birikintide görsel karşılaştırmayla seçilsin; göl boyutunda dalga oluşmasın.
- [x] Normal doku lineer veri olarak yüklensin; paylaşılan asset ownership ve
  dispose kuralları korunsun. Eksik doku konsol/WebGL hatası üretmesin ve
  Wheel Ripples çalışmaya devam etsin. Geç gelen yükleme silinmiş gövdeyi
  geri getirmesin. Yeni gövde başına capture veya her kare geometri rebuild yok.

**Kabul:** sabit kamera ve araçsız yüzeyde 0/düşük/yüksek rüzgar, yön değişimi
ve gust karşılaştırılır. Foliage olmayan sahnede de çalışır. Üstten/yakın eğik
açıda küçük esintiler ve yansıma kırılması görülür; kot ve su alanı değişmez.
Wind/Wheel Ripples ayrı ayrı ve birlikte sınanır. Draft/Create/Edit/Play,
pause, World Environment gizleme ve hava/mevsim değişimleri doğrulanır.

### Faz 5 — Dibi örten çamurlu su yoğunluğu

Durum: **Uygulandı / kullanıcı görsel kabulü verildi.**
Son kullanıcı kararı: su bütünüyle opak olmayacak; sığ kısımlarda dip kısmen
görünecek, derinleştikçe çamur rengi ve örtücülük artacak. Bu karar aşağıdaki
eski “sığ iç bölgede de dip görünmesin” kabulünün yerini alır. Gerçek yatak
derinliğine üstel soğurma, Mud Density ve Mud Color kontrolleri eklendi.
Görsel kabulden sonraki toplu koşuda tam `build:verify`, 2396 engine kontrolü
ve 5 Puddle tarayıcı regresyonu geçti. Son sonuçlar teslim raporundadır.

**Amaç:** kahverengi, derinliğe bağlı bulanık birikinti. Sığ suyun altında dip
kısmen görünür; derinleştikçe çamur rengi ve örtücülük artar. Su kotunu aşan
çamur sırtları, kuru adalar ve kıyılar görünmeye devam etsin.

- [ ] Faz 3 sonrası aynı kamera/ışıkta mevcut görünümü kaydet. Renk, mevcut
  `opacity` ve derinlik alpha geçişinin etkilerini ayrı karşılaştır. Şu anki
  `.82` opaklık ve `smoothstep(0, .012, depth)` yaklaşımını başlangıç kabul et;
  yalnız rengi koyulaştırmayı dip gizleme çözümü sayma.
- [x] Gerçek yatak derinliğine göre üstel soğurma ve çamur rengi uygula.
  Sığ bölgeler daha saydam, derin bölgeler giderek daha örtücü olsun.
  Gerçek su sınırında dar, yumuşak coverage geçişi kalsın;
  geometri maskesi kuru bölgeleri dışarıda tutsun.
- [x] Details'ta Color, Opacity, Mud Color ve Mud Density görevlerini netleştir.
  Mud Density derinlikle artan örtücülüğün hızını, Mud Color çamur tonunu
  belirlesin. Opacity optik yoğunluğu ölçeklesin; 0 yüzeyi gizlesin.
  Renk değerleri ışık altında seçilsin;
  yalnız siyah veya aşırı parlak vernik görünümü oluşmasın.
- [x] Fiziksel materyal roughness/Fresnel ve planar karışımını birlikte ayarla:
  kahverengi gövde rengi okunurken rüzgar dalgacıkları, araç halkaları ve
  nesne yansımaları görünür kalsın. Planar kapalı/Low durumda da dip gizlensin.
  Depth/sıralama davranışı araç tekerini veya su üstü çamurunu yanlış örtmesin.
- [x] Deforme yatak ve derinlik sorgularını görünürlükten ayır: dibi gizlemek
  deformasyonu veya Wheel Ripples temas hesabını kapatmasın. Çamur sırtının
  su kotunu aşması yüzeyi kesmeye devam etsin. Yeni refraction/underwater
  render target veya çamur taşınım simülasyonu eklenmesin.
- [x] Yeni ve mevcut kayıtlar için geçişi açık yap: eksik yeni alanlar çamurlu
  varsayılanı kullansın; açıkça yazılmış renk/opacity değerleri sessizce ezilmesin.
  Mevcut sahnede kayıtlı düşük opacity varsa ayrıca görünüm ayarı gerektiği
  raporlansın; bu plan authored level/terrain dosyalarını değiştirmez.

**Kabul:** aynı konumda su açık/kapalı karşılaştırmasında sığ taban kısmen
okunur, derin taban örtülür; su üstü sırt/ada her iki durumda doğru yerde kalır.
En sığ iç bölge, daha derin oyuk, güneş/gölge, üstten/eğik açı, planar açık/kapalı
ve farklı kalite seviyeleri incelenir. Faz 4 esintileri ve Faz 3 halkaları yoğun
kahverengi yüzeyde okunur; geniş saydam kıyı bandı veya çift parlama oluşmaz.

### Faz 4–5 uygulama noktaları ve doğrulama

- Veri/varsayılanlar: `engine/scene/puddleWater.ts`; renderer:
  `engine/render-three/terrain/terrainPuddleSurface.ts`; kalıcı/taslak bağlantıları:
  `src/scene/puddleWaterController.ts`, `src/editor/puddlePreview.ts`;
  rüzgar aktarımı: `src/scene/SceneApp.ts`, `src/scene/RuntimeSceneApp.ts`.
  Panel başlangıcı `src/editor/panels/details/puddleDetails.ts` ve taslak
  görünüm panelidir. Yeni kontroller Details finalize düzenini korusun.
- Yeni görünüm alanları ortak `validatePuddleWater` yolunda allowlist ve sonlu
  değer/aralık kontrolüyle eklensin. `tools/saveValidator.ts` üzerinden gerçek
  save/read round-trip, eski kayıt varsayılanları, undo/redo ve Save/Reload/Play
  doğrulansın. Animasyon fazı, çözülmüş rüzgar ve halka geçmişi kaydedilmesin.
- Her fazın ilgili engine regresyonları ve TypeScript kontrolü yapılsın;
  engine/runtime tesliminde `npm.cmd run test:engine` ve
  `npm.cmd run build:verify` çalıştırılsın. Playwright ile gerçek editör/Play
  görünümü ve konsol/WebGL hataları ayrıca doğrulansın. Shader kaynak kontrolü
  veya yalnız test başarısı görsel kabul sayılmasın.
- Aynı kamera/kalite/gövde sayısında özellik açık/kapalı CPU/GPU ölçümü ve doku
  belleği/kaynak sayıları kaydedilsin. İlave draw/capture olmaması, per-frame
  geometri işi açılmaması ve tekrar oluştur/sil/level geçişinde kaynakların
  bırakılması doğrulansın. Hedef donanım kabulü ölçüm yapılmadan tamamlanmasın.
- Yeni save/asset alanları için uygulama sonunda kapsamlı olmayan, bu değişimle
  sınırlı **Codex Security diff incelemesi önerilir**; tarama kullanıcı başlatır
  veya onaylarsa çalıştırılır. Planlama sırasında tarama/test başlatılmaz.

### Fazlar için ortak teslim ve kapsam sınırı

- TypeScript değişikliğinden sonra `npx.cmd tsc --noEmit`; ilgili engine ve
  Playwright kontrolleri, engine/runtime tesliminde pratik olduğunda tam
  `npm.cmd run build:verify` uygulanır. Prototip testi gerçek araç kabulünün
  yerine geçmez. Görsel ve donanım performans kabulü ayrı raporlanır.
- Faz 1 ve 3 kayıt/validator alanlarını genişlettiği için, kullanıcı onayıyla
  Codex Security diff incelemesi önerilir; plan kaydı sırasında tarama başlatılmaz.
- Yağmur, su miktarı korunumu, hidrolik akış/taşma, tam dalga simülasyonu,
  deforme rigid-body collider, runtime iz kalıcılığı, yeni splash/çamur VFX ve
  Puddle su altı sistemi bu üç fazın kapsamında değildir.
- Mud fiziksel materyali tek başına authored Puddle oluşturmaz; kuru bir
  komşu çukurda yeni bir Puddle icat edilmez. Var olan yerel rut ıslaklık sistemi
  ile authored gövde arasındaki ilişki Faz 2'de açıkça sınırlandırılır.
- Kullanıcının mevcut terrain/level, proje ve fracture çalışmalarına dokunulmaz.
  Her faz yalnız ilgili kod/veri sözleşmesini değiştirir; sahne düzenleme ve
  commit/push ayrıca yetkilendirilmedikçe yapılmaz.
