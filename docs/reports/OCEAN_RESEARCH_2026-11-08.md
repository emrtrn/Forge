# Ocean — Water Pro hedefi ve Forge teknik araştırması

Tarih: 8 Kasım 2026. Durum: kaynak araştırması, kullanıcı ekran görüntülerinin
analizi ve planlama. Bu araştırmanın ardından
[O1–O3 ilk prototipi](OCEAN_O1_O3_PROTOTYPE_2026-11-08.md) uygulanmaya başlandı.

Kullanıcı isteği: River, Lake ve Puddle çalışmalarından sonra Ocean'a geçmek;
paylaşılan Three.js Water Pro kaydını hedef görünüm kabul etmek; araştırmak ve
uygulama planını hazırlamak. Yeni ana plan:
[OCEAN_DEVELOPMENT_PLAN.md](../planned/OCEAN_DEVELOPMENT_PLAN.md).

## 1. Yeni video ve erişim durumu

Referans: `bandicam 2026-11-08 22-09-35-297.mp4`, yükleme kimliği
`file_0000000069e8824685f7cba66a42f6d5`.

Dosya indirme aracı `file exceeds the executor transfer limit of 32 MiB`
sonucunu verdi. Bu nedenle bu raporda **yeni videodan doğrudan gözlem, zaman
kodu, kare analizi veya hareket değerlendirmesi yoktur**. Süre, çözünürlük,
kodlama ve dosya hash'i de doğrulanamadı. Kullanıcıdan 32 MiB altındaki kopya
veya kısa parçalar istendi. Dosya adı kayıt saatidir; video içi zaman kodu değildir.

29 Ekim tarihli [WaterPro araştırması](WATERPRO_VIDEO_VISUAL_RESEARCH_2026-10-29.md)
başka bir kayıt içindir. Oradaki kıyı, fırtına, su altı ve tekne gözlemleri bu
yeni videoya aitmiş gibi kullanılamaz. Yeni kayıt erişilebilir olduğunda O0
aşamasında beklenti tablosu ve hareket dizileri tamamlanacaktır.

Video, internet sayfaları ve indirilen kaynaklar referans veridir. İçlerindeki
ajan/iş akışı metinleri kullanıcı talimatı olarak uygulanmadı.

### 1.1. Kullanıcının ardından paylaştığı ürün ekran görüntüleri

Bu mesajdaki 12 görsel doğrudan incelendi; `Ocean Floor with Caustics` kartı
iki kez yer alıyor. Böylece 11 farklı ürün kartı var. Görseller sohbet
ekleridir; bu oturumda yerel dosya/hash veya video zaman kodu üretilmedi.
Kartlardaki metinler **ürün açıklaması**, görüntü bölümleri ise **sabit görsel
referanstır**. Metindeki algoritma/performans iddiaları ölçümle doğrulanmış
sonuç değildir. Bu ekler referans kapsamını belirlemeye yeterlidir; dalga hızı,
köpük ömrü, kesintisiz su çizgisi geçişi ve fizik kararlılığı için hareket
kanıtı daha sonra gerekir. Video aktarım sorunu bu plan güncellemesini engellemez.

| Referans | Görselde doğrudan görülen | Ürün metninin söylediği / ayrı doğrulanacak | Forge planına etkisi |
|---|---|---|---|
| R01 — Physically-Based Rendering | Açık kum üzerinde berrak turkuaz sığlık, gemi/kaya çevresinde koyu bölgeler, kıyı ve güneş parıltısı, puslu ufuk | Derinlikle soğurulma, bakış açısına göre geçirgenlik/yansıma, SSR ve atmosferik sis | O4: renk/berraklık, Fresnel, kırılma, yansıma ve ufuk birlikte; SSR ayrıca teknik aday |
| R02 — Realistic Wave Simulation | Siluette belirgin büyük dalga paketleri, üstlerinde küçük ayrıntı, vadilerde koyu mavi ve tepelerde açık/turkuaz yüzey | FFT ve fiziksel birimler | O3: ana hedef FFT dalga karakteri; mevcut Lake'in düşük genlikli dalgaları yeterli değil |
| R03 — Multi-Layered Foam System | Kayalar/sahil çevresinde genişliği değişen parçalı köpük ve açık su üzerinde seyrek lekeler | Whitecap, ambient surface ve shoreline olmak üzere üç bağımsız katman; ayrı texture/renk/coverage | O5: üç katmanın kaynakları ve kontrolleri ayrı; kaya teması shoreline katmanında alt kaynak |
| R04 — Buoyancy Physics | Dalgalı denizde tekne ve çevresinde örnekleme/debug işaretleri | GPU height sampling; çok noktayla pitch/roll, tek noktayla bobbing | O8a: çok noktalı Rapier kaldırma/drag deneyi ve tek noktalı basit yüzme; sabit kare fizik davranışını kanıtlamaz |
| R05 — Underwater Effects | Kamera su altında; dalgalı yüzeyin altı, tekne gövdesi, mavi/yeşil mesafe kaybı ve dip | Animasyonlu distortion, kesintisiz per-pixel waterline | O7: su altı ve yüzey geçişi tam referansın parçası; hareketli sınır ayrıca test edilir |
| R06 — Ocean Floor with Caustics | Kumda parlak ağ biçimli ışık izleri, bitkiler/taşlar ve uzaklıkla azalan görünürlük | Dalgalardan kırılan hareketli ışık ve özelleştirilebilir prosedürel dip | O4/O7: görünür ve su altındaki dipte aynı caustics/soğurulma; Forge World Terrain kullanılır; balık/bitki oynanışı su özelliği sayılmaz |
| R07 — Boat Wake | Gemi kıçından geriye uzanan, kenarları parçalanan geniş köpük izi | Yüzey deplasmanı + köpük ve farklı kaynak izlerinin etkileşimi | O8b: köpük izi tek başına tamamlanma ölçütü değil; bozuntu ve çoklu kaynak etkileşimi de değerlendirilir |
| R08 — Infinite Water with LOD | Adanın çevresinde geniş deniz; uzak çizimde yükselmiş/poligonal bir yüzey sınırı görünür | Geometry clipmap, çoklu LOD halkaları ve ayarlanabilir draw distance | O2: clipmap öncelikli aday; sınırın nedeni tek kareden çıkarılamaz ve görünür kenar hedefe kopyalanmaz; temiz ufuk/geçiş aranır |
| R09 — 8 Environment Presets | Bulutlu, koyu ve puslu ada/su sunumu | Tropikal, fırtınalı, ay ışıklı dahil sekiz preset; runtime geçişi | O4/O6: mevcut WES üzerinden uyumlu ortam/deniz profilleri ve kesintisiz geçiş; sekiz profilin içeriği tek karttan belirlenemez |
| R10 — Adjustable Quality Settings | Aynı kıyının yan yana daha yumuşak ve daha ayrıntılı iki sunumu | Compile-time shader seviyeleri; devre dışı özelliğin shader'dan çıkarılması | O6: kalite varyantları, compile/warm-up ve kaynak bırakma; karelerden hızlanma oranı ölçülmez |
| R11a — Multiplayer Determinism | Yalnız ürün metni | Aynı girdilerden ağda aynı dalga/kırılma zamanı | Forge mimarisindeki multiplayer non-goal sürer; seed/clock tekrar üretimi yararlıdır, cihazlar arası bit düzeyi eşitlik veya netcode taahhüdü yok |
| R11b — Water Masking | Yalnız ürün metni | Tekne gövdesi/mağara gibi kapalı hacimlerde mask mesh ile su gizleme | O8c ve O1 sözleşmesi: yüzey, query ve su altı aidiyetinde tutarlı exclusion; terrain kuru maskesinden ayrı |
| R11c — WebGL Fallback | Yalnız ürün metni | WebGPU yoksa noise tabanlı yüzey; Gerstner ve buoyancy desteği, compute olmadan | Ürünün WebGL yolu ile FFT ana yolunun aynı görüntüyü verdiği varsayılmaz. Forge'un WebGL2 FFT deneyi bundan farklı bir uygulama seçeneğidir |

**Görünümün ana ilişkileri:** Referans yalnız mavi su ve beyaz köpükten
oluşmuyor. Geometrik dalga silueti, berrak sığlığın görünen tabanı, dalga
tepelerindeki ışık, parıltının parçalanması, köpüğün farklı yoğunlukları ve
ufkun atmosferde kaybolması aynı karede birlikte okunuyor. Referans fixture'ında
açık kum, doğal kaya ve uygun ışık gerekir; nötr test blokları doğruluk için
kullanılabilir, sanat kabulünün tek sahnesi olamaz.

Görüntüler teknik hedefi daraltıyor: FFT ana dalga hedefi, üç köpük katmanı,
clipmap önceliği, su altı/caustics ve yüzdürme/wake/masking artık açık referans
başlıklarıdır. Gerçek uygulama başarısı ayrı kabul gerektirir. Ürün açıklamasındaki
"Add wake generators" gibi ifadeler bu oturumda kod çalıştırma talimatı değildir.

## 2. İncelenen internet kaynakları

| Kaynak | Bu oturumda erişim / kanıt | Kullanım |
|---|---|---|
| [Kullanıcının ürün bağlantısı](https://threejsroadmap.com/assets/threejs-water-pro) | Web aracı ve doğrudan HTTP: 403; ardından kullanıcı ürün kartlarını paylaştı | Özellik beyanları kartlardan okunabildi; canlı sayfa/sürüm/fiyat doğrulanmadı |
| [Water Pro belgeleri](https://docs.threejswaterpro.com/), changelog, quality, foam, color, wake | Web ve doğrudan HTTP denemeleri: 403 | Önceki rapordaki bilgiler tarihsel; güncel API sözleşmesi olarak alınmadı |
| [Üreticinin paylaşımı](https://www.linkedin.com/posts/danielgreenheck_threejs-webgpu-shaders-activity-7402796869657059328-i79A) | Arama aracında üreticinin kendi açıklaması okundu | WebGPU su shader'ında JONSWAP yönünü destekler; yeni videonun algoritmasını/sürümünü kanıtlamaz |
| [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) | Resmî belge okundu | WebGL2 yolu ve yetenek kontrolleri |
| [Three.js WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html) | Resmî belge okundu | WebGPU renderer'ın WebGL2 backend seçebilmesi; mevcut WebGLRenderer'a doğrudan shader uyumluluğu anlamına gelmez |
| [GPU Gems — Effective Water Simulation](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models) | Birincil teknik kaynak okundu | Geometrik dalga ve ince yüzey ayrıntısını ayrı ölçeklerde kurmak; analitik karşılaştırma |
| [GPU Gems 2 — Geometry Clipmaps](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry) | Birincil teknik kaynak okundu | Kamerayı izleyen iç içe grid ve LOD geçişleri için aday; doğrudan Ocean çözümü olduğu iddia edilmiyor |
| [Ultra-Water, sabit sürüm](https://github.com/Humpalumps/Ultra-Water/tree/30ea65ecb0a66b137aa200d099965634bdd84d51) | GitHub bağlantısı üzerinden kaynak dosyaları okundu | Forge WebGL2 FFT/kıyı prototipi için incelenebilir MIT kaynak adayı |

Water Pro satın alınmadı; ücretli paket veya dokular indirilmedi. Görsel hedef
Water Pro'dur; Ultra-Water teknik kaynak adayıdır. Birinin diğerinin uygulaması
veya görünümle eşdeğer olduğu sonucuna varılmadı.

## 3. Ultra-Water: önceki incelemeden sonra değişen kaynak

Önceki rapor `ce9248fa20afbdf63fd4c11709f68d7368aca0a0` sürümünü kullanıyordu.
Bu oturumda okunan yeni sabit commit:
`30ea65ecb0a66b137aa200d099965634bdd84d51` (2 Kasım 2026).
Bu iki sürümün maliyet ve davranış kayıtları birbirine karıştırılmamalıdır.

| Dosya | Bu oturumda okunan Git blob kimliği |
|---|---|
| `README.md` | `e95b967c26894a99553a16c0f54d0a1e039f16b7` |
| `src/water/OceanSim.js` | `843b04e84c1cffb910e7be7911b594579645bac9` |
| `src/water/OceanSurface.js` | `c3aa8f81308e0638134691678b76702a8b99f65c` |
| `src/water/shoreMap.js` | `8947427f9ed8ab6459e45794ab41553b79aa4b8a` |
| `src/water/WaterQuery.js` | `f02557729c029ec0848a188b8ee31f95e6f04d4e` |
| `LICENSE` | `a378657b9099d972120e82b064dc9d97b166ecd3` |
| `THIRD_PARTY_NOTICES.md` | `7abc0d9cfa50e774f84e275edafa71592f5a6ea1` |
| `package.json` | `300f7375467bb3183cdb882b526d791899f8f037` |

### 3.1. Dalga ve geniş yüzey

`OceanSim.js`: dört 256² FFT kademesi; 600 / 85 / 12 / 2,1 m alanlar,
JONSWAP rüzgâr denizi ve swell bileşenleri. Son kademe küçük yüzey eğimlerine
ayrılır. Kaynakta yatay deplasman ve Jacobian tabanlı köpük geçmişi vardır.
`update()` normal karede bir evrim, 16 IFFT ve dört çıktı çizimi yapar; spektrum
yenilenirse ek başlangıç çizimi vardır. Mip üretimi ve diğer su geçişleri bu
21 çizimin dışındadır.

Kaynak render target tanımlarından teorik FFT texture verisi yaklaşık
22,67 MiB'dır: başlangıç 4 MiB, iki MRT çalışma hedefi 8 MiB, dört kademenin
çift çıktı/geçmiş hedefleri ve mipleri yaklaşık 10,67 MiB. Bu gerçek GPU
tahsisi/tepe ölçümü değildir; kıyı, geometri, yansıma ve su altı dahil değildir.

`OceanSurface.js` kamerayı izleyen polar grid ve mesh aralığına göre dalga
ayrıntısını sınırlayan örnekleme içerir. World-space faz, kamera hareketinde
yüzeyin kamerayla sürüklenmemesi için Forge adaptöründe korunmalıdır.

### 3.2. Kıyı ve köpük

Yeni kaynakta kıyı dalga cephesi için travel-time alanı, sığlıkta yön/hız
değişimi, dalga kırılma sunumu, sahile çıkan/geri çekilen ince film ve ıslak
kum davranışı bulunur. Bunlar genel Ocean işinin ayrı tasarım parçalarıdır;
yalnız FFT kurmak bu etkileri sağlamaz.

Kaynak `shoreMap.js` alanı demo terrain yüksekliği ve kayalarıyla hazırlanır.
Forge'un çok tile'lı, canlı Sculpt ile değişen dünyasına hazır adaptör değildir.
`ISLET = 64` yardımcı dalga alanında küçük kara bölgelerinin dalga cephesi
üretimine etkisini azaltır; gerçek kuru kara/su kapsamını bununla belirlemek
yanlış olur. Kesin kapsam, dalga yön alanı ve optik derinlik ayrı tutulmalıdır.

### 3.3. Sorgu, yaşam döngüsü ve sınırlar

`WaterQuery.js` ortak yüzey GLSL'ini kullanır ve yatay deplasmanı tersler.
Asenkron readback için kaynaktaki yorum 1–3 kare gecikme bildirir. İki iş
uçuşta olabilir; sonuçlar tag/time taşır. Forge'da eski level/revision veya
daha eski sonuçların sonradan yayımlanması ayrıca engellenmelidir.

İncelenen OceanSim ve WaterQuery sınıflarında bütün kaynakları kapatan bir
`dispose()` bulunmuyor. Forge uyarlaması kaynak sahipliği, renderer state
restorasyonu, hata/iptal ve geç readback sonuçlarını açıkça ele almalıdır.

README sürekli hareket wake'ini hâlâ eksik sayıyor. Kıyı dalgası heightfield'dır;
tüp şeklinde üstüne kıvrılan dalga değildir. Bu sınırlar görsel hedef
karşılaştırmasında kayda geçirilmelidir.

README'deki RTX 3060 sonuçları yazarın demo ölçümleridir. Forge'da bu oturumda
demo çalıştırılmadı ve yeni GPU ölçümü yapılmadı. Forge ek maliyeti olarak
kullanılmaz. Demo atmosferi/fizik/post-process paketi birlikte alınmayacaktır.

MIT uyarlaması yapılırsa Humpalumps telif/izin metni ve alınan parçaların ilgili
üçüncü taraf bildirimleri kaynak ve production dağıtımında korunmalıdır.

## 4. Güncel Forge karşılaştırması

İncelenen Forge HEAD: `ee222184aecb5629ef2ee0d8d15f83e7b4133a5b`.
`package.json`: Three.js `0.187.0`, Vite `^7.0.0`; renderer WebGL2.
Önceki rapordaki Forge r184 bilgisi bu checkout için güncel değildir.

| Alan | Güncel kodda bulunan | Ocean için gerçek fark |
|---|---|---|
| Dalga | `engine/terrain/lakeWaves.ts`, render GLSL eşleniği; üç düşük genlikli bileşen | Çok ölçekli büyük deniz/swell, yatay deplasman, LOD; Lake limitlerini büyütmek yeterli değil |
| Optik/ışık | `waterOptics.ts`, `waterSunGlint.ts`, `waterEnvironment.ts`, `lakeRefraction.ts`, `waterSceneSnapshot.ts` | Ocean yüzeyine bağlama, ufuk/sis ve dalga tepesi ışığı; ortak sun/moon/HDR dengesi |
| Köpük | `waterFoamMaterial.ts`, `waterCrestFoam.ts`, geometri bake maskeleri | Mevcut tepe köpüğünde history buffer yok; Ocean'da doğma/taşınma/sönme ve kıyı beyaz suyu gerekir |
| Yansıma | `WaterReflectionRegistry`, paylaşılan planar kaynaklar | Ocean'ı aynı sahiplik sistemine katma; Ocean grid parçası başına capture açmama |
| Terrain | Lake/Puddle kesin tile verisi ve revision/iptal akışları | Denizden bağlantı, bilinmeyen tile ve açık deniz ayrımı; büyük kıyı alanına bütçeli hazırlık |
| Su altı | `LakeUnderwaterBody`, `LakeUnderwaterPass`, mevcut `PostProcessPipeline` bağlantısı | Lake'e özgü kapalı üçgen hacmini Ocean'a doğrudan kullanamama; Ocean yüzeyi/gövde aidiyeti adaptörü |
| Rüzgâr | `resolveLevelWind`, hava/mevsim bağlantısı; Puddle hareket entegrasyonu | Birimsiz WES gücünden fiziksel spektrum parametresine belgeli dönüşüm; swell ayrı kalabilir |
| Veri/editör | `waterBodies` şu an yalnız Lake union'ı; `puddleWaters` ayrı; Water paneli ve save validator | Ocean şeması, oluşturma/seçim/undo/Save/Reload/Play henüz yok |

Özellikle su altı ve köpükte önceki 29 Ekim raporunun eksik dediği her şeyin
hâlâ eksik olduğu varsayılmadı. Lake su altı kodu vardır; Ocean desteği yoktur.

## 5. Araştırmanın önerisi ve açık kararlar

Önerilen ana deney **mevcut WebGL2 renderer üzerinde izole FFT Ocean**;
analitik yüzey maliyet ve görsel karşılaştırma/fallback adayıdır. Kullanıcının
paylaştığı R02 kartı FFT'yi referansın ana dalga yolu olarak tanımlar. Forge'da
algoritmanın kesin uygulaması ve görsel eşdeğerlik prototipte doğrulanacaktır.
WebGPU/TSL ürününü kullanmak, WebGPURenderer'ın WebGL2 fallback'ine rağmen
Forge'un mevcut ShaderMaterial/post-process düzenine doğrudan takılabileceğini
kanıtlamaz. Motorun tamamını renderer göçüne sokmak ilk Ocean teslimine eklenmez.

Görsel karşılaştırmada R01–R11 matrisi kullanılır. Su altı/caustics ve
yüzdürme/wake/masking artık referansın açık başlıklarıdır; O6 yalnız yüzey
teslimidir, tam referans kabulü O7/O8'i de gerektirir. Yağmur, tekne kontrolü,
balık/bitki simülasyonu ve multiplayer bu kartlardan otomatik görev olarak
çıkarılmaz. Video erişilebilir olduğunda yalnız eksik hareket/zaman kanıtı
tamamlanır; statik gereksinimleri belirlemek için tekrar yükleme beklenmez.

Bu araştırma aşamasında yalnız dokümanlar hazırlandı. Tür/test/build veya browser/GPU
kabulü yapıldığı iddia edilmez. Uygulama sırası, karar noktaları, önerilen
bütçeler ve tamamlanma ölçütleri ana Ocean planındadır.
