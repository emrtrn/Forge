# Ocean — geliştirme ve kabul planı

Tarih: 8 Kasım 2026. Durum: O1 veri/kapsam çekirdeği, ilk O2 yüzeyi ve O3 FFT
deneyi izole prototipte uygulandı; tam faz kabulleri açık.
[İlk uygulama ve doğrulama kaydı](../reports/OCEAN_O1_O3_PROTOTYPE_2026-11-08.md).
[Native editör/runtime devamı](../reports/OCEAN_EDITOR_RUNTIME_INTEGRATION.md):
Water paneli, Outliner, undo/redo, Save/Reload/Play ve ortak controller eklendi;
O4/O5 görsel gelişim, O6 kalite/performans ve O7/O8 kabulleri açık.
Kaynak: [Ocean araştırması](../reports/OCEAN_RESEARCH_2026-11-08.md).

Kullanıcı hedefi: River, Lake ve Puddle'dan sonra Ocean; referans olarak
paylaşılan Three.js Water Pro videosunun görünümü ve hareketi. Ocean yalnız
geniş bir düzlem/normal animasyonu olarak tamamlanmış sayılmayacaktır.

**Referans durumu:** Kullanıcının paylaştığı 12 ekran görüntüsü incelendi
(11 farklı ürün kartı; caustics kartı tekrarlanıyor).
[R01–R11 analiz matrisi](../reports/OCEAN_RESEARCH_2026-11-08.md#11-kullanıcının-ardından-paylaştığı-ürün-ekran-görüntüleri)
görsel ve özellik hedefini belirler. `bandicam 2026-11-08 22-09-35-297.mp4`
32 MiB aktarım sınırı nedeniyle açılamadı; yalnız hareket/zaman analizi açık.
Ürün metnindeki teknik beyanlar doğrudan çalıştırılmış veya ölçülmüş sayılmaz.
Planlama/kod hazırlığı videonun yeniden yüklenmesine bağlı değildir.

## 1. Hedef ve ilk teslim sınırı

İlk ürün hedefi: World Terrain kıyısı/adaları olan bir level'da editörden
oluşturulabilen; açık deniz ufku, büyük/küçük dalga ölçekleri, kıyıya gelen
dalgalar, köpük ve derinlikle tutarlı optik sunan; Save/Reload/Play ile aynı
çalışan Ocean. Görsel referans R01–R11 kartlarıdır; O0'da sahne/kamera ve
hareket kabulü ayrıntılandırılır.

İlk iterasyon için öneri: level başına tek Ocean; ortalama deniz seviyesi
yatay ve dünya Y koordinatında. Sıfır kotu zorunlu değildir. Birden fazla
bağımsız deniz kotu, gelgit, tam akış/hacim koruma ve üstüne kıvrılan dalga
tüpü ilk iterasyonun dışında. Bunlar onaylanmış teknik sınırlamalar değil,
kapsamı ölçülebilir tutan önerilerdir; O0 karar kaydında kesinleşir.

Su altı ve dip caustics O7'de; yüzdürme, wake ve kapalı hacim maskeleri O8'de
ayrı teslimlerdir ve **tam Water Pro referans hedefinin parçasıdır**.
O6 ilk yüzey/editör teslimidir; O7/O8 bitmeden bütün Ocean hedefi tamamlandı
denmez. World Builder Ada/Kıyı otomasyonu O9'dadır; elle oluşturmayı bloke etmez.
Sekiz ortam profili, ürün kartındaki sayıyı kopyalamak yerine mevcut WES
üzerinde kapsamı belirlenerek sunulur. Multiplayer Forge'un kapsamı dışındadır.

## 2. Korunacak mimari ve çalışma ilkeleri

- Lake/River/Puddle görünümü, veri dosyaları ve varsayılanları korunur.
  Ocean işi bu sistemlerin toplu refactor'ına veya renderer göçüne dönüşmez.
- WebGL2 üzerinde çalışılır. Referansın ana dalga hedefi FFT'dir; analitik dalga aynı
  sahnede karşılaştırma ve desteklenmeyen donanım için fallback adayıdır.
  Analitik yolun daha düşük görsel sonucu, ana hedefin kabulü yerine geçmez.
  Ürün kartının WebGL fallback'i noise/Gerstner olarak tarif edilmiştir;
  bu yolun WebGPU FFT ile aynı sonucu verdiği varsayılmaz. Forge'un WebGL2
  FFT uygulama adayı teknik olarak farklı bir yoldur.
- Engine saf veri/hesap ve render modüllerini taşır; iki scene shell yalnız
  controller'ı bağlar. Tekne/oyun/araç kuralları genel editöre yazılmaz.
- Aynı simülasyon anı beauty, planar, depth/normal ve sorgu yollarında kullanılır.
  Reflection/capture render'ları FFT zamanını ikinci kez ilerletemez.
- Mevcut optik, köpük malzemesi, ortam ve yansıma paylaşımı değerlendirilir.
  Baked temas maskesi, dalga yön alanı ve gerçek kuru/su kapsamı ayrı verilerdir.
  Referansın üç köpük katmanı whitecap / ambient surface / shoreline'dır;
  kaya teması kıyı/nesne katmanına ait bir kaynaktır, ambient katmanını ikame etmez.
- WES rüzgârı birimsizdir. FFT'nin m/s/fetch parametrelerine dönüşümü ayrıca
  tanımlanır; WES gücü doğrudan m/s kabul edilmez. Rüzgâr değişiminde faz sıçraması
  yerine spektrum geçişi tasarlanır; swell anlık rüzgârdan bağımsız olabilir.
- Ücretli Water Pro kod/dokuları kopyalanmaz. MIT kaynak uyarlaması sürüm,
  dosya/fonksiyon ve lisans bildirimiyle kayda geçirilir.

## 3. Ocean kapsamı ve veri önerisi

**O1 şema kararı:** ayrı `oceanWaters` koleksiyonu uygulanmıştır.
`LayoutWaterBody` yalnız `LayoutLakeWaterBody` alias'ı olduğu ve mevcut tüketiciler
Lake varsaydığı için bu ilk teslimde union genişletilmedi. Ocean loader/save
allowlist'i ayrıdır; iki eski koleksiyonun davranışı korunur.

Kalıcı alanlar: schema/id/name/hidden/locked; sea level; terrain referansları;
deniz çalışma alanı ve denize bağlı başlangıç/sınır; açık deniz politikası;
dalga/swell, renk-berraklık, köpük, yansıma ve isteğe bağlı su altı ayarları.
İlk alanlar ve aralıklar `engine/scene/oceanWater.ts` içindedir; tam optik,
köpük, su altı ve actor etkileşim ayarları kendi fazlarında genişleyecektir.

Kapalı hacim exclusion/mask referansları ayrıca tasarlanır. Terrain kara maskesi
tekne içini çözmez; yalnız görünür suyu silmek de kuru iç hacmin su altı
efekti/sorgu davranışını çözmüş sayılmaz. Wake kaynaklarının hız/deplasman/köpük
ayarları ile yüzdürme örnek noktaları authored veridir; canlı iz ve kuvvetler
runtime durumudur. Veri sahipliği O1'de body/actor sınırında belirlenir.

GPU texture'ları, foam history, kamera grid konumu, hesaplanmış mesh ve her
kare dalga verisi layout'a yazılmaz. Bake gerekiyorsa ayrı sürümlü yan dosya,
terrain/sea-level/settings fingerprint'i ve stale davranışı tanımlanır.

### Kıyı doğruluğu

1. Kara ve adalar terrain ile belirlenir. Deniz seviyesinden düşük her kapalı
   iç çukur otomatik deniz olmaz; denize bağlılık başlangıç/açık sınırdan çözülür.
2. Bilinen derin deniz alanı, bilinen kuru alan ve **bilinmeyen terrain** ayrı
   durumdur. Eksik/yüklenmemiş tile deniz tabanı veya sıfır yükseklik sayılmaz.
3. Terrain dışındaki ufuk için açıkça tanımlanmış offshore alanı kullanılabilir.
   Terrain içindeki eksik tile bu kuralla gizlenemez. O1/O2 bunun görünüm ve
   sorgu davranışını belirler; önceki geçerli kıyı hazırlık boyunca korunur.
4. Yakın kıyı kesin terrain üçgenlerini kullanır; uzak/yardımcı alanlar
   sadeleştirilebilir. Sadeleştirme gerçek kuru alan maskesini değiştiremez.
5. Yatay dalga deplasmanı kuru alanlara sızmayı artırabilir. Sığlıkta dalga
   sınırlandırma, kıyı fazı ve son deplase konumdaki kapsam birlikte doğrulanır.
6. Sahile çıkan ince film/ıslaklık O5'in açık davranışıdır; terrain üstüne
   rastgele geçen deniz mesh'i run-up kabul edilmez. Runtime ıslaklığı Sculpt
   veya kalıcı paint katmanına her kare yazılmaz.

## 4. Uygulama aşamaları

Her aşama ayrı doğrulama ve görsel sonuç üretir. Bir prototipin çalışması
sonraki aşamanın tamamlandığı anlamına gelmez.

### O0 — Yeni referansı çözümleme ve karşılaştırma sahnesi

- [x] Kullanıcı ürün görsellerini incele; görsel gözlem ile ürünün teknik
  beyanını ayır; R01–R11 kapsam/faz eşleştirmesini kaydet.
- [ ] Video erişimini tamamla; ffprobe, SHA-256, süre/çözünürlük kaydı.
- [ ] Genel tarama ve hareketli bölümlerde zaman dizileri: dalga silueti,
  köpük doğumu/ömrü, kıyı, ufuk, ışık; varsa su altı/nesne etkileşimi.
- [x] Statik referans için `görselde görülen / ürünün beyanı / Forge önerisi`
  ayrımı; su altı/caustics, yüzdürme, wake ve masking'i tam hedefe bağla.
- [ ] Kullanıcı sahnelerinden ayrı `ocean-reference` fixture tasarımı:
  açık deniz, kumlu kıyı, kayalık kıyı, küçük ada ve kapalı iç çukur;
  iki tile sınırı, farklı deniz kotu ve eksik tile varyantı.
- [ ] Sabit kamera/ışık/pozlama: su hizası, eğik kıyı, kuşbakışı, ufuk;
  gündüz/akşam/gece ve sakin/rüzgârlı koşullar.

İlk fixture `tests/smoke/pages/ocean-reference.html` altında çalışır:
kıyı/açık deniz/kuşbakışı, ada ve bağlantısız iç çukur; FFT/analitik seçimi,
pause ve rebuild. Tam doğal kaya/kum sanat sahnesi ve ışık/hava matrisi açık.

**Çıkış:** R01–R11 matrisi ve tekrar üretilebilir baseline. Matris hazır;
fixture/baseline ve hareket incelemesi henüz yapılmadı. Video adımı diğer
bağımsız hazırlık işlerini bloke etmez; statik kare hareket kabulünü kapatmaz.

### O1 — Veri, kapsam ve sorgu sözleşmesi

- [x] Ocean şeması ve collection kararı; eski layout'larda yoksa değişmeyen davranış.
- [ ] Deniz bağlantısı, terrain dönüşümleri, offshore/unknown ayrımı ve limitler.
- [ ] Sorgu sonucu: body id, wet/dry/unknown, height, normal, velocity,
  simulation time/revision, doğruluk/gecikme bilgisi; kesin/approximate ayrımı.
- [ ] CPU analitik eşleniği; FFT için asenkron/prediction seçenekleri.
  Yatay deplasman varsa world XZ → yüzey parametre inversiyonu ve hata ölçüsü.
- [x] İlk Ocean alanlarında Save/read ortak normalizer/allowlist ve bozuk/sınırsız veri davranışı.

**Çıkış:** kodlanabilir sözleşme ve karar kaydı. Denizi çukur dolduran büyük
Lake olarak kuran varsayımlar kabul edilmez.

### O2 — Kıyı ve ufka uzanan yüzey

- [ ] Kesin kuru/su kapsamı ve sığlık derinliği; bağlantısız çukur kuru kalır.
- [ ] Bütçeli tile okumaları, iptal, revision, Sculpt dirty rect güncellemesi.
- [ ] R08'e göre geometry clipmap/iç içe halkalar öncelikli aday;
  polar grid ile maliyet/görünüm karşılaştırması;
  sabit world-space faz, yakın su hizasında yeterli detay, LOD dikiş/morph.
- [ ] Ufuk, camera far, sis ve büyük dünya koordinat hassasiyeti birlikte ele alınır.
  Küçük fixture'da çalışan dev düzlem bütün dünya için yeterli sayılmaz.
- [ ] Başlangıç düz/analitik yüzey; kamera hareketinde desen kayması,
  tile sınırında dikiş ve kuru ada sızıntısı test edilir.

**Çıkış:** doğru kapsam ve sürekli ufuk; henüz nihai dalga/görünüm kabulü değil.

### O3 — Büyük dalga ve FFT karşılaştırması

- [ ] Mevcut Three.js r187 üzerinde float/half-float FBO, MRT, sampler/vertex
  texture ve filtreleme desteğini gerçek framebuffer denemesiyle kontrol et.
- [ ] Sabit Ultra-Water sürümünden izole FFT uyarlama deneyi; demo atmosferi,
  GUI ve fizik döngüsü alınmaz. Alınan parçalar ve lisanslar kaydedilir.
- [ ] Aynı ışık/kamera/deniz durumunda analitik ve FFT yüzeyini karşılaştır:
  büyük swell, kısa rüzgâr dalgası, mikro normal ve tekrar eden örüntüler.
- [ ] Dalga frekanslarını mesh LOD'una göre filtrele; uzak yüzeyde
  parıltı/aliasing, kamera kayması ve sığlıkta yatak delme kontrolü.
- [ ] Tek simulation clock; pause/resume, zaman ölçeği ve rüzgâr geçişleri.
- [ ] Yükseklik/normal/deplasman sorgusu ile çizimin karşılaştırması;
  asenkron sorguda zaman damgası ve eski sonuç reddi.

**Çıkış:** görüntü + ölçümle FFT/LOD kararı. FFT çalışıyor olması tek başına
Water Pro hedefinin karşılandığı anlamına gelmez.

### O4 — Ocean optiği ve ışık

**Devam ediyor — ilk ortak optik bağlantısı:** Ocean artık ortak Fresnel/GGX,
WES ortam/probe, canlı directional ışık ve gölge, renderer sisi, tek sahne
renk/depth kopyası üzerinden soğurulma ve kontrollü kırılmayı kullanıyor.
AO/DoF normal/depth çizimleri aynı FFT deplasmanı ve deniz kapsamını izliyor.
Ortak planar registry bağlantısı, authored mod/grup/kalite ve FFT'yi koruyan
optik güncellemeler de eklendi: [Planar yansıma](../reports/OCEAN_PLANAR_REFLECTIONS.md).
Terrain caustics de Ocean kapsamı, FFT saati, spectral soğurulma ve ortak güneş
gölgesiyle bağlandı: [Ocean caustics](../reports/OCEAN_CAUSTICS.md).
Bu ara teslim aşağıdaki maddelerin tamamını kapatmaz: SSR karşılaştırması,
su altı ve ortam profillerinin görsel kabulü açık.
Detay ve doğrulama: [Ortak Ocean optiği](../reports/OCEAN_SHARED_OPTICS.md).

- [x] Ortak Fresnel/soğurulma, depth kontrollü kırılma, ortam ve planar yansıma.
- [ ] R01 ürün kartındaki SSR'yi değerlendir: mevcut ortam/planar ile
  aynı kamera karşılaştırması; ekran dışı nesne, occlusion, kenar kaybı ve
  temporal kararlılık. Eklenirse ayrı bütçe ve fallback; görünüm hedefi ile
  aynı iç algoritmayı kullanma gereksinimi birbirinden ayrılır.
- [ ] Berrak kıyıdan derin denize renk/berraklık; görünür dip, gölge ve
  dalga tepesi ışığı. Beyaz köpük ile sığlık rengini birbirine karıştırmama.
- [ ] WES güneş/ay/gökyüzü, sis, HDR ve pozlama ile uyum;
  ikinci atmosfer, ikinci tone mapper veya çift güneş katkısı oluşturulmaz.
- [ ] Planar off/on sürekliliği, foreground halo ve ekran kenarı fallback;
  AO/DoF depth/normal yardımcı yollarında aynı deplasman.
- [x] R06 ilk bağlantı: mevcut terrain caustics'i Ocean kapsamı, derinlik,
  FFT saati, soğurulma ve ortak güneş/gölge hesabına bağla. Ayrı ışık katkısı yok.
- [ ] R06 görsel kabul: yüzeyden ve su altından aynı deseni/soğurulmayı
  değerlendir (su altı kamera yolu O7). Dalga türevli alternatif denenirse
  mevcut desenin üstüne ikinci ışık katkısı ekleme.
- [ ] R09 ortam profilleri: en az tropikal, fırtınalı ve ay ışıklı görsel
  karşılaştırma; kalan sekizli ürün setinin içerikleri bilinmediği için
  uydurulmaz. WES hava/güneş/ay/sis ve Ocean ayarları birlikte geçiş yapar.

**Çıkış:** O0 kameralarında açık deniz ve sığlık optiği için görsel değerlendirme.

### O5 — Kıyı dalgaları, köpük ve ıslaklık

- [ ] Kıyıya gelen dalga yön/hız alanı; derinlikte değişen faz ve sığlaşma.
  FFT derin deniz dalgası ile kıyı dalgası arasında enerji/geometri geçişi.
- [ ] R03'ün üç katmanı: kırılan dalga tepesi whitecap, açık yüzeyde kalan
  ambient köpük, kıyı/nesne temas köpüğü. Her biri için ayrı enabled,
  renk/yoğunluk/coverage ve ölçek ayarı; ortak doku paylaşımı ayrı katmanları
  tek yoğunluk slider'ına indirgemez. Ambient katman kıyıdan uzakta da okunur.
- [ ] Köpük doğumu, taşınımı ve sönümü: sabit dt varsaymadan;
  geçmiş texture'larının çözünürlük/alan/byte bütçesi ve world-space ankrajı.
- [ ] Kamera teleport/grid kaymasında history yeniden eşleme veya açık reset;
  eski köpük karaya/başka kıyıya taşınamaz. Kuru ada maskesi her aşamada korunur.
- [ ] Kayalık kıyıda yön/engel tepkisi; otomatik temas verisi ve kontrollü
  Recalculate/stale akışı. Her kare mesh taraması veya taş başına manuel kaynak yok.
- [ ] O0 hedefi gerektiriyorsa sahile çıkıp geri çekilen film ve kuruyan ıslak
  kum bandı; terrain shading ile aynı su/ıslaklık kapsamı.
- [ ] Spray gerekiyorsa ayrıca bütçeli parçacık; köpük veya dalga geometrisi
  yerine kullanılarak kıyı hatası gizlenmez.

**Çıkış:** video/zaman dizisiyle dalga–köpük–kıyı hareketi kabulü.

### O6 — Editör, kayıt, kalite ve kaynak kabulü

- [x] Water panelinde Add Ocean ve deniz kotu; ilk sürüm doğrudan undo edilebilir
  oluşturma kullanır. Ayrı oluşturulmamış taslak/önizleme akışı henüz yoktur.
  UI'da
  İngilizce etiket ve Türkçe açıklama geleneği.
- [x] Create/Edit/Delete, Water/Outliner seçimi, hidden/locked ve undo/redo.
  Deplase yüzeyin viewport picking'i ayrıca açık.
- [x] Save/Reload/Play aynı kalıcı ayarları kullanır;
  `tools/saveValidator.ts`, loader ve yeni şema birlikte round-trip edilir.
- [ ] Tam Ocean fixture'ı ile production browser kabulü.
- [ ] Düşük/Orta/Yüksek/Ultra tavanları ve adaptif sıra; authored ayarlar
  üzerine yazılmaz. Fallback/degraded durum kullanıcıya anlaşılır biçimde gösterilir.
- [ ] R10 shader varyantları: pahalı devre dışı özelliklerin hesap/örnekleme
  ve update/target işini kaldır; yalnız uniform'u sıfırlamakla yetinme.
  Variant cache, shader warm-up, geçişte derleme takılması ve retained kaynakları ölç.
- [ ] Clear, kalite değişimi, iptal ve travel sonrası texture/RT/material/buffer
  sahipliği; eski callback/readback yeni level'a yayın yapamaz.
- [ ] Lake/River/Puddle birlikteyken yansıma ve snapshot paylaşımı;
  nehir ağzı için örtüşme ve z-fighting kararı. Tam birleşim ayrı W5 işi ise
  kalan sınır açıkça kaydedilir; çift su yüzeyi kabul edilmiş sayılmaz.

**Çıkış:** ilk Ocean ürün teslimi; O2–O5'in görsel kabulü ve aşağıdaki teknik
kapılar birlikte tamamlanır. Bu yalnız yüzey/editör teslimidir;
tam referansın su altı/yüzdürme/wake/masking kapsamını kapatmaz.

### O7 — Ocean su altı

- [ ] Mevcut Lake su altı pass'ini dar bir body/surface arayüzüne uyarlama;
  Lake davranışını koruyan Ocean aidiyeti ve optik yol hesabı.
- [ ] Hareketli yüzeyde per-pixel su çizgisi, yüzeyin alttan görünümü,
  sis/soğurulma, animasyonlu distortion ve R06 dip caustics'i.
  Işık huzmesi ayrı adaydır; verilen sabit görsellerde zorunluluğu kanıtlanmadı.
- [ ] Yakın düzlem, yatak altı kamera, çok gövde, hızlı giriş/çıkış ve kalite
  geçişi; kamera aidiyeti araç konumundan türetilmez.

**Çıkış:** R05/R06 su altı görünümü ve kesintisiz su çizgisi geçişi için
ayrı kabul. Kamera sınırda hem su üstünü hem altını aynı karede doğru görür.

### O8 — Yüzdürme, wake ve kapalı hacim maskeleri

- [ ] O8a — R04: görüntüyle tutarlı zaman damgalı su sorgusu; gecikme/hata
  için ölçülen eşik. Tek noktalı bobbing ve çok noktalı pitch/roll fixture'ları.
- [ ] Rapier kuvvet/torque/drag adaptörü, sabit fizik adımı ve kütle/örnek
  alanı; örnek sayısı artınca toplam kaldırma kuvveti keyfî büyümez.
  Demo fiziği kopyalanmaz; su yüzeyini takip eden transform animasyonu
  çok noktalı fizik kabulünün yerine geçmez.
- [ ] O8b — R07: hareket yön/hız/derinliğine bağlı wake kaynağı; durma,
  teleport/reset ve kuru sınırlar. Görünür yüzey deplasmanı ve köpük birlikte;
  yalnız kıça yapışık beyaz doku yeterli değildir.
- [ ] En az iki kaynağın izleri aynı alanda birleşir/etkileşir;
  displacement/normal, depth/normal pass ve gerekli su sorgusu güncellenir.
  Kuyruk uzunluğu/çözünürlük/kaynak sayısı bütçelenir; katmanlar kapandığında
  kaynak işler ve GPU hedefleri bırakılır.
- [ ] O8c — R11b: authored mask mesh/hacim; tekne içi ve kapalı hacim testleri.
  Beauty, yansıma/depth, su altı aidiyeti ve wet/dry query tutarlılığı;
  yalnız shader discard ile kapatılmış sayılmaz. Açık/kapalı geometri,
  hareket eden maske, kamera içeride/dışarıda ve üst üste maskeler değerlendirilir.

**Çıkış:** R04/R07/R11b referans başlıkları için ayrı kanıtlar; tekne
kontrolü/oynanışı kendiliğinden engine Ocean kapsamına alınmaz.

### O9 — World Builder Ada/Kıyı

9 Kasım 2026: ilk Ada dilimi `island` landform'uyla bağlandı. Small sınırı,
ortak kıyı/zemin/önizleme, Ocean aktörü, kara üretim maskeleri ve tek köyün
iç erişim yolu mevcut. Pencere desteklenmeyen boyut/çıkış/nehir seçeneklerini
kapatır. İkinci dilimde Small `coast`, dört deniz yönü, kuru yol çıkışları,
bağlı offshore politikası ve sabit genişlikli düz nehir ağzının River/Ocean
yüzey sahipliği eklendi. Devam diliminde River genişliği/görünürlüğü inlet
maskesine canlı bağlandı; arazi ve FFT kaynakları korunur.
Ada'da nehir, orta/büyük dünya ve tam O9 görsel/performans kabulü açıktır.
Detaylar: [Random World planı](../world-builder/RANDOM_WORLD_PLAN.md).

- [ ] Random World'a Ada/Kıyı landform'ları, Ocean verisi ve uyumlu önizleme.
- [ ] Denizden bağlantı, yerleşim/yol güvenliği ve nehir ağzı kapsamı.
- [ ] Aynı seed ile tekrar üretim; var olan dünya seçeneklerinde regresyon yok.

## 5. Önerilen modül yerleşimi

Controller `src/scene/oceanWaterController.ts` ve Details
`src/editor/panels/details/oceanDetails.ts` eklendi. İki scene shell aynı
controller'ı kullanır; geniş kalite/fizik/optik sistem adları hâlâ taslaktır.

| Sorumluluk | Hedef |
|---|---|
| Ocean veri/normalizer | `engine/scene/oceanWater.ts`, `layout.ts` |
| Kesin kapsam/shore hazırlığı | `engine/terrain/oceanCoverage.ts`, `oceanPreparation.ts` |
| FFT/analitik yüzey ve query sözleşmesi | `engine/ocean/` altında küçük modüller; Three.js bağımlı uygulama render katmanında |
| GPU sim, LOD mesh, malzeme, foam history | `engine/render-three/ocean/` |
| İki scene shell'in kullandığı controller | `src/scene/oceanWaterController.ts` |
| Details/oluşturma/undo | `src/editor/` mevcut Water paneli ve komut modeli |
| Kalite | `engine/perf/` altında Ocean tavanları; Lake kalite limitlerini gizlice genişletmez |

Render akışı: WES/zaman → simülasyonu bir kez ilerlet → ortak dalga snapshot'ı
→ mevcut opaque/depth → Ocean yüzeyi → gerekiyorsa ortak su altı → mevcut
post-process. Planar ve diğer yardımcı geçişler aynı snapshot'ı okur; akışın
kesin render sırası O3/O4'te mevcut pipeline ile doğrulanır.

## 6. Performans hedefleri ve ölçüm

Aşağıdakiler **ilk mühendislik hedefleri**, kullanıcı tarafından onaylanmış
veya ölçümle sağlanmış sonuçlar değildir. O0/O3 raporunda hedef donanım,
çözünürlük/DPR ve gerçek maliyetle revize edilir; aşım gizlenmez.

| Alan | Önerilen başlangıç hedefi |
|---|---|
| Referans desktop koşulu | RTX 3060 sınıfı, 1920×1080 gerçek render, DPR 1, High; browser/driver kaydı |
| Ocean ek GPU maliyeti | Aynı sahnede açık/kapalı p95 fark ≤4 ms; sim + yüzey + köpük + Ocean'a atfedilen capture/optik maliyeti birlikte |
| GPU bellek | Ocean'ın ek kalıcı texture/buffer/RT toplamı ≤64 MiB, replacement/quality geçişi tepe ≤96 MiB; çözünürlüğe bağlı kaynaklar dahil |
| Hazırlık CPU | Hedef dilim ≤4 ms; Ocean kaynaklı >50 ms long task yok; cold/yenileme toplamı ayrıca raporlanır |
| Sahiplik | Level başına tek simülasyon; grid parçası başına sim/reflection capture yok |

4 ms hedefi ilk yüzey teslimi içindir. O7 su altı ve O8 query/wake/mask
maliyeti ayrıca ölçülüp **tam kapsam toplamına** eklenir; O6 sayısı bütün
özelliklerin açık olduğu sonuç gibi sunulmaz. O7/O8 başlamadan ilave GPU,
CPU/fizik ve transient bellek hedefleri aynı cihazdaki baseline ile belirlenir.

En az 300 AB/BA çift örnek; p50/p95 GPU farkı, sim/surface/foam/capture ayrımı,
draw sayısı, byte hesabı ve transient tepe. GPU timer yok/disjoint ise GPU
kabulü açık kalır; sadece FPS ile kapatılmaz. Demo benchmark'ı Forge ölçümü değildir.
Hazırlık için 5 warm-up + 30 tekrar, cold için cache koşulu belirtilmiş 10 örnek.

20 kalite/clear–undo/rebuild/reload/travel döngüsü; kamera teleport ve geciken
iş dahil. 30/60/120 FPS hareket karşılaştırması; pause/resume ve uzun oturumda
faz/koordinat hassasiyeti. İz/köpük için tek screenshot hareket kanıtı sayılmaz.

## 7. Teknik kapılar ve görsel kabul

- TypeScript düzenlendikten sonra `npx tsc --noEmit`.
- Engine/runtime tesliminde `npm run test:engine` ve uygun birleşik
  `npm run build:verify`; son gate'in slow test kapsamı korunur.
- Yeni anlamlı regresyonlar: denizden bağlantı/ada/kapalı çukur, eksik tile,
  farklı kot/dönüşüm, şema round-trip, revision/iptal, yatay dalga inversiyonu,
  LOD dünya fazı, history taşıma ve kaynak bırakma.
- Playwright: `?editor`, Save/Reload/Play, runtime ve production; ayrı smoke
  portu/fixture, console/shader hatası, kıyı ve ufuk kamera dizileri.
- Gündüz/akşam/gece, sakin/rüzgârlı; planarın kapalı/açık ve direct/snapshot
  yolları; gerçek kullanılan depth yapılandırmaları. Desteklenmeyen yol açıkça yazılır.
- Lake/River/Puddle referansları korunur. Ocean görünümü için kullanıcı
  değerlendirmesi, teknik ve donanım sonuçlarından ayrı kaydedilir.
- Save/load veya yeni dev endpoint sınırı değişirse uygun Codex Security diff
  incelemesi önerilir; tarama kullanıcı isteği/onayı olmadan başlatılmaz.

Plan düzenlemesi tek başına engine/build testi gerektirmez. Başlayan kod
uygulamasının teknik/browser sonuçları uygulama raporunda izlenir; hedef
donanım GPU kabulü ve kullanıcı görsel kabulü açık kalır.

## 8. İlk çalışma sırası ve karar kaydı

**Önerilen sıra:** O0/O1 → O2 → O3 → O4 → O5 → O6 → O7 → O8a/b/c.
O6 yüzey/editör ara teslimi, O7/O8 tam referans hedefinin devamıdır. O8'in
query ve maske sözleşmesi O1'de hazırlanır. O9 World Builder işi ardından gelir.

| Karar | İlk öneri | Durum |
|---|---|---|
| Görsel referans | Kullanıcının ürün kartları R01–R11; video hareket incelemesi | Kartlar incelendi; video aktarımı engelli |
| Renderer | Mevcut WebGL2 | Plan önerisi |
| Ana dalga adayı | FFT; analitik yalnız karşılaştırma/fallback | Referans R02; Forge uygulaması O3'te ölçülecek |
| LOD | Clipmap/iç içe grid öncelikli; polar grid karşılaştırması | Referans R08; seçim O2/O3'te |
| Veri | Ayrı `oceanWaters` | İlk veri/read/save uygulaması ve regresyonları eklendi |
| İlk Ocean sayısı | Level başına bir | İlk şema ve editör uygulamasında sınırlı |
| İlk performans hedefi | §6 | Henüz ölçülmedi |
| Su altı/caustics | O4/O7 | Referans R05/R06; tam hedefin parçası |
| Yüzdürme/wake/masking | O8a/b/c | Referans R04/R07/R11b; tam hedefin parçası |
| Ortam profilleri | WES üzerinden tropikal/fırtınalı/ay ışıklı başlangıç | R09; tam sekizli setin içeriği bilinmiyor |
| Multiplayer determinism | Ağ desteği eklenmez; seed/clock tekrar üretimi test edilir | Mimari non-goal korunur; GPU'lar arası bit eşitliği taahhüdü yok |

İlk kod işi bütün sistemi bir kerede kurmak değildir: O1 sözleşmesi ve
izole kıyı/ufuk fixture'ı, ardından aynı sahnede FFT/analitik karşılaştırması.
Ürün görünümünün ana teslimi O4/O5'tir; O2'nin basit yüzeyi nihai sonuç değildir.
