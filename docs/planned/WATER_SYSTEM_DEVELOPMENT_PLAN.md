# Forge Su Sistemi — Görsel Gelişim ve Entegrasyon Planı

Tarih: 29 Ekim 2026 · Durum: V1b ve V1c + güneş parıltısı uygulandı; son Lake görünümü kullanıcı tarafından kabul edildi. Teknik doğrulama ve yeni GPU maliyeti açık.

**30 Ekim 2026 güncellemesi — River görsel yakınlaştırma:** Kullanıcı, memnun
olduğu Lake görünümünü referans alarak River yüzeyinin iyileştirilmesini istedi.
Kod karşılaştırmasına dayanan uygulama planı [§7.1](#71-river-görsel-yakınlaştırma-planı--30-ekim-2026)
altındadır. Bu teslim yalnız planlamadır; River uygulaması ve görsel/performans
kabulü henüz yapılmadı. Lake'in kabul edilmiş görünümü korunacak referanstır.

**Uygulama notu:** Kullanıcı önceliğiyle V1b köpük malzemesi öne alındı.
Ortak 512² doku, yoğunluğa bağlı desen ve kabarıklık ışıklandırması Lake/River'a
uygulandı. [Uygulama, doğrulama ve açık sınırlar](../reports/WATER_FOAM_MATERIAL_V1B_2026-10-29.md).
V0'ın geniş kapsamı ve P0 genel kabulü tamamlanmış sayılmaz.

**Son uygulama:** Lake ortam/planar yansıma birleşimi ve Lake/River ortak GGX
güneş parıltısı eklendi. Kullanıcının açık isteğiyle bu teslimde TypeScript,
test, build veya tarayıcı kontrolü çalıştırılmadı. [Uygulama ve elle kontrol
notları](../reports/WATER_REFLECTION_SUN_GLINT_2026-10-29.md). V1c kabul
maddelerinin teknik doğrulaması yapılmış sayılmaz.

Kullanıcının ardından paylaştığı görüntüler üzerine paralel mikro-normal
bantları düzensiz gradyanlarla değiştirildi; atmosfer mesh'inin planar'a güneş
diskini tekrar çizmesi engellendi. Bloom öncesi sonlu HDR güneş yansıması
eklendi. Kullanıcı son Lake görüntüsü için “şuan çok daha iyi, görsel kabul
tamam” onayını verdi. Kabul, gösterilen göl görünümüne aittir; River, bütün
kalite/gece/gölge senaryoları ve performans kabulüne genişletilmez. Ayrıntılar
aynı uygulama raporundadır. Sonraki onaylı kapsam V2a Lake kırılmadır.

**Hedef:** Mevcut Lake/River altyapısını koruyarak suyun renk, ışık, köpük ve kırılma kalitesini geliştirmek; daha sonra kalıcı köpük, rüzgârlı yüzey, nesne izi, su altı ve Ocean çalışmalarını ayrı teslimlerle ilerletmek.

**V2a ilk uygulama:** Lake için bağlı kaynak yüzü ve depth denetimli ekran
kırılması eklendi. Yeni `Refraction Strength` alanı 0–2, başlangıç 0,65; sıfır
etkiyi kapatır. Yüksek/Ultra profilinde ve geçerli renk/depth snapshot yolunda
etkindir. [Uygulama ve elle kontrol](../reports/LAKE_REFRACTION_V2A_2026-10-29.md).
Kullanıcı Lake kırılma görünümünü iyi buldu ve test/commit istedi. Teknik ve
GPU kabul katmanları ayrı izlenir. Kullanıcı, bundan sonraki commit isteklerinde
uygun testlerin topluca çalıştırılmasına izin verdi; ara adımlarda tekrar koşu
yapılmaması tercihi sürüyor.

İlk uygulama paketi **V0–V2** olarak önerilir. Açık Lake performans işleri **P0** hattında ayrıca izlenir. FFT, WebGPU geçişi veya su sisteminin topluca değiştirilmesi ilk paketin ön koşulu değildir.

## 1. Kaynaklar ve planın konumu

| Kaynak | Bu plandaki rolü |
| --- | --- |
| [World Terrain / Water Body planı](WORLD_TERRAIN_WATER_BODY_PLAN.md) | Mevcut altyapı, kullanıcı kararları, geçmiş uygulamalar ve açık kabul sınırları |
| [WaterPro görsel araştırması](../reports/WATERPRO_VIDEO_VISUAL_RESEARCH_2026-10-29.md) | Görsel hedefler ve V0–V5 aşamaları |
| [Ultra-Water entegrasyon incelemesi](../reports/ULTRA_WATER_FORGE_INTEGRATION_REVIEW_2026-10-29.md) | Kaynak uyarlama adayları, entegrasyon riskleri ve W4 Ocean seçeneği |
| [Lake dilimlenmiş hazırlık raporu](../reports/LAKE_COOPERATIVE_PREPARATION_2026-10-29.md) | En yeni CPU hazırlığı ölçümü ve açık performans işleri |
| [Lake kalite raporu](../reports/LAKE_QUALITY_2026-10-29.md) | Mevcut kalite tavanları ve kaynak ömrü |
| [River efektleri / F4](../reports/WATER_RIVER_EFFECTS_F4_2026-10-29.md) | Otomatik köpük, River caustics ve sınırlı fixture kabulü |

Bu doküman, sonraki su geliştirmeleri için birleştirilmiş çalışma sırası önerir. Önceki ana plan uygulama geçmişi olarak korunur. Eski plandaki bütün işaretlenmemiş maddeler buraya aktif iş olarak taşınmaz; özellikle kaldırılmış W2 yatak oyma akışı ve manuel köpük yerleştirme geri açılmaz.

Mevcut durum aşağıdaki yerel plan ve raporlardan alınmıştır. Bu doküman hazırlanırken yeni tarayıcı, GPU veya engine kabulü yapılmadı; dış kaynaklar yeniden incelenmedi. WaterPro videosundaki görünüm algoritma veya performans kanıtı değildir. Ultra-Water kaynak incelemesi de Forge entegrasyonunun çalıştığını kanıtlamaz.

## 2. Başlangıç durumu ve korunacak kararlar

### 2.1. Yeniden yapılmayacak mevcut temel

| Alan | 29 Ekim 2026 kayıtlarına göre durum | Yeni plandaki karşılığı |
| --- | --- | --- |
| World Terrain yol/nehir aktarımı | 8A0–8A5 tamamlandı | Su görsel gelişiminin altyapısı |
| Lake oluşturma | Sculpt ile hazırlanmış çukura tıklama; bağlı havzanın gerçek terrain üçgenlerinde doldurulması | Geometri ve kuru alan doğruluğu korunur |
| Lake yüzeyi | Çok ölçekli normaller, filtreli roughness, hafif geometrik dalgalar, yumuşak kıyı geçişi | V1 ve V4 mevcut sistemi geliştirir |
| Lake etkileşimi | Mud sisteminden bağımsız tekerlek dalgaları | V5 iz sisteminin tamamı sayılmaz |
| Kıyı/dip sunumu | Islak kıyı, dip ıslaklığı, Lake/River terrain caustics | V1 ayarı; yeni caustics sistemi zorunlu değil |
| Otomatik engel köpüğü | Lake ve eğimli River için gerçek mesh–su kesişimi; kalıcı binary maske | V1 malzeme, V3 kaynak alanı olarak kullanır |
| Köpük iş akışı | Calculate / Recalculate / Cancel / Clear; Reload/Play sırasında mesh taraması yok | Aynı akış sürer |
| Lake kalite bağlantısı | Düşük/Orta/Yüksek/Ultra ve adaptif kalite; authored ayarlara tavan uygular | Yeni efektler bu yapıya katılır |
| Kaynak/hazırlık | Katman güncellemesi, iptal edilebilir CPU dilimleri, önceki geçerli mesh'i koruma | P0 ve bütün yeni işlerin yaşam döngüsü |
| Görsel kabul | L1/L2/L3 ve F4 için ana planda kullanıcı kabul kayıtları var | Yeni görünüm ayrıca değerlendirilir; genel performans kapanmış sayılmaz |

### 2.2. Değişmeyecek çalışma kuralları

1. **Yalnız otomatik engel köpüğü:** Taş başına manuel temas alanı veya Radial Foam kontrolleri geri gelmez. Eski kayıtların korunması devam eder.
2. **Kullanıcı kontrollü hesap:** Statik nesne taşındığında Recalculate kullanılır. Her kare mesh taraması veya Reload/Play sırasında gizli yeniden bake yapılmaz.
3. **Gerçek su kapsamı:** Ada, kuru kıyı, bağlantısız çukur, farklı kot ve eksik tile davranışı görsel uğruna gevşetilmez. Yardımcı dalga alanı, gerçek su maskesinin yerine geçmez.
4. **Mevcut içerik:** Kullanıcının sahneleri, terrain verisi, ışıkları ve onaylı yoğunlukları topluca değiştirilmez. Yeni görünüm önce ayrı fixture ve açıkça seçilen profillerde geliştirilir.
5. **Genel engine:** Ortak shader, sorgu ve kaynak yönetimi engine katmanında kalır. Projeye özgü tekne/araç/oyun kuralları runtime veya veridedir.
6. **Sorgu tutarlılığı:** Çizilen yüzey, CPU su sorgusu, bounds ve AO/DoF depth/normal yolları aynı hareketi izler. Gecikmeli GPU readback hassas teker sorgusunun yerine doğrudan geçmez.
7. **Açık hata ve geri dönüş:** Bütçe aşımı, desteklenmeyen GPU formatı veya iptal durumunda geçerli görünüm korunur. Sessiz çözünürlük düşürerek kıyı doğruluğu değiştirilmez.

## 3. Çalışma hatları ve teslim sırası

Aşağıdaki işlerin tamamı bu plan oluşturulurken **başlanmadı** durumundaydı.
Sonrasında kullanıcı önceliğiyle V1b'nin ilk uygulaması yapıldı; kalan kabul
sınırları yukarıdaki uygulama raporundadır. “Mevcut” olarak anlatılan özellikler
§2'deki önceki teslimlerdir.

| Kimlik | İş | Öncelik / bağımlılık | Teslim |
| --- | --- | --- | --- |
| P0 | Açık Lake performans kabulü | V0 ile başlayabilir; yeni ağır sistemlerden önce ele alınır | Güncel kaynakta CPU/GPU/bellek ve production sınırları |
| V0 | Ayrı referans fixture ve başlangıç görünüm profilleri | İlk görsel iş | Tekrarlanabilir Lake/River karşılaştırması |
| V1a | Renk, ışık ve caustics dengesi | V0 | Berrak Lake / bulanık River / rüzgârlı Lake görünüm tanımları |
| V1b | Ortak köpük malzemesi | V0; V1a ile aynı referans ışığı | Mevcut maskeler üzerinde çok ölçekli köpük |
| V1c | Ortam ve planar yansıma birleşimi | V0, V1a | Planar kapalı/açık sürekliliği |
| V2a | Lake için depth kontrollü kırılma | V1 referansı sabitlendikten sonra | Sınırlı UV kaydırma ve güvenli fallback |
| V2b | River kırılma değerlendirmesi ve adaptörü | V2a kabulü | Eğimli yüzey ve yerel su kotuyla aynı optik hedef |
| V3 | Kalıcı, akışla taşınan köpük | V0–V2 değerlendirmesi ve P0 kaynak bütçesi | Görünür alanda sınırlı GPU geçmişi |
| V4 | Rüzgârlı Lake dalga/tepe ışığı | V1; V3 zorunlu bağımlılık değil | Sorguyla uyumlu değişken dalga paketleri |
| V5a | Hareketli nesne izi | Kullanım senaryosu; köpük izi için V3 | Otomatik runtime kaynaklarıyla sınırlı iz |
| V5b | Su altı ve su çizgisi | Kamera su altına girecekse; V2 ve gövde sorgusu | Yüzey geçişi, sis ve alttan yüzey |
| W4-O | Ocean prototipi | Ayrı geniş su hedefi ve bütçesi | FFT/analitik seçenek, yakın yüzey ve ufuk/LOD |

Önerilen ilk sıra: **V0 → V1a → V1b → V1c → V2a → V2b**. P0 ölçümleri bu hattın başında baseline üretir ve sonunda yeni maliyeti değerlendirir. P0'ın genel kabulünün açık olması V0–V2 prototipini engellemez; ilk paketin görsel başarısı da bu açık kabulü kapatmaz. V3, V4, V5 ve Ocean ilk paketin tamamlanma koşulu değildir.

## 4. P0 — Mevcut performans sınırlarını kapatma

### 4.1. Başlangıç kanıtı

En yeni [dilimlenmiş hazırlık raporunda](../reports/LAKE_COOPERATIVE_PREPARATION_2026-10-29.md), RTX 3060 / Chrome / ANGLE D3D11 / 1920×1080 / Ultra / adaptif kapalı / dört CSM / planar kapalı koşulunda, sekiz Lake ve 259.200 hücreli 4 km dünyada:

- Warm rebuild p95 **363,6 ms**, rebuild penceresindeki en uzun RunTask **19,628 ms**, >50 ms görev **0**.
- Geometri çekirdeğinde **7 adet >4 ms dilim**, maksimum **7,3 ms**. Diğer ölçülen hazırlık aşamalarında maksimum ≤2,8 ms.
- Ölçüm Vite geliştirme sunucusunda yapıldı; production paket kabulü değildir. Geniş profil köpük/ıslak kıyı için açıkça **2 m bant** kullanır; bu, 1 m bandın aynı alanda bütçeye uyduğunu göstermez.

Bu sonuç genel ≤4 ms dilim hedefini, GPU kabulünü ve transient bellek bütçesini birlikte kapatmaz. [Önceki Lake performans raporundaki](../reports/LAKE_PERFORMANCE_2026-10-29.md) sekiz gövdeli **2,222 ms** GPU farkı ile F4'ün bir Lake + bir River için **0,568 ms** farkı farklı kaynak/fixture kapsamlarıdır. Toplanarak yeni efekt bütçesi çıkarılmaz.

### 4.2. Yapılacaklar

- [ ] P0.1 — Geometri çekirdeğindeki aykırı dilimleri profil çıkararak daralt; gerekiyorsa ek bölme veya worker seçeneğini değerlendir. Senkron/asenkron sonuç eşitliğini koru.
- [ ] P0.2 — Güncel kaynakta küçük Lake, 65.536 hücreli Lake ve sekiz gövdeli 4 km fixture için GPU farkını yeniden ölç. Planar kapalı ve açık sonuçları ayır.
- [ ] P0.3 — Suya ait tutulan/transient CPU ve GPU byte'larını süreç toplamından ayır; eski+yeni buffer, maskeler, paylaşılan texture ve pending işler dahil tepeyi kaydet.
- [ ] P0.4 — Cold açılış, production paket, kalite geçişi, iptal, Undo/Reload ve level travel kabulünü kapsamları ayrı belirtilerek tamamla.
- [ ] P0.5 — Geçen ve açık kalan hedefleri ölçüm raporunda tek tabloda göster; yalnız rebuild p95 iyileşmesini genel kabul olarak işaretleme.

Eski W1 hedefleri başlangıç referansıdır: tek Lake ≤65.536, level toplamı ≤262.144 çalışma hücresi ve ≤8 Lake; tek gövde geometri CPU/GPU ayrı ≤16 MiB; toplam ek CPU transient/cache ≤64 MiB, GPU ≤32 MiB; iş dilimi ≤4 ms ve Lake nedeniyle >50 ms long task olmaması. Warm rebuild için ana plandaki 96×96 m kabul fixture'ında p95 ≤100 ms, üst sınır alanda ≤500 ms; cold açılış aynı fixture'da p95 ≤1 s; yansıma kapalı tek fixture Lake için ek GPU p95 ≤1 ms hedefi korunur. [Ayrıntılı sınırlar ve ölçüm koşulları](WORLD_TERRAIN_WATER_BODY_PLAN.md#128-önerilen-performans-ve-kaynak-bütçesi).

Bu değerler bütün yeni sistemlerin otomatik bütçesi değildir. V0'da ilk paket için ayrıca efekt bazında p95 GPU, sampler, draw/capture ve byte tavanı kayda geçirilir. Sayısal tavanı tanımlanmayan veya ölçümü eksik efektin performans kabulü açık kalır. Ocean için ayrı bütçe gerekir.

## 5. V0 — Adil karşılaştırma zemini

**Çıktı:** Kullanıcının mevcut sahnesinden ayrı, yeniden kurulabilir bir görsel/perf fixture; sabit kamera konumları ve baseline kanıtları.

- [ ] Açık kum/küçük taş taban, doğal kaya, sığ–derin geçiş, ada ve bağlantısız kuru çukur içeren bir Lake hazırla.
- [ ] Aynı taban ve ışıkla eğimli River ekle; farklı kotlu ikinci gövde ve tile sınırı durumunu ekle.
- [ ] Yakın eğik kıyı, üstten ada, kaya teması, güneşe karşı yüzey ve uzak yüzey için kamera/pozlama/güneş/simülasyon zamanını sabitle.
- [ ] Berrak Lake, bulanık River ve rüzgârlı Lake için başlangıç görünüm değerlerini kaydet. Rüzgârlı görünümün V4 hareket geliştirmesini henüz tamamlamadığını belirt.
- [ ] Gündüz, düşük güneş, gölge ve gece varyantlarını; 1080p ve daha düşük çözünürlüğü karşılaştırma setine ekle.
- [ ] Kaynak sürümü, fixture verisi, kalite/adaptif durumu, GPU/driver, DPR, post-process ve CSM ayarlarıyla başlangıç ölçümünü sakla.

**Çıkış:** Aynı açılarda taban, yüzey, köpük ve yansıma ayırt edilebilir; sonraki her değişiklik aynı fixture'da açılıp kapatılabilir. Güzel bir kıyı sahnesiyle basit işlev fixture'ının sonuçları birbirinin yerine kullanılmaz.

## 6. V1 — Mevcut yüzeyin malzeme ve ışık gelişimi

### V1a — Renk, geçirgenlik ve caustics

Başlangıç noktası: [waterOptics.ts](../../engine/render-three/waterOptics.ts), [lakeSurface.ts](../../engine/render-three/lakeSurface.ts), [lakeWater.ts](../../engine/render-three/lakeWater.ts), [riverWater.ts](../../engine/render-three/riverWater.ts), [terrainCaustics.ts](../../engine/render-three/terrain/terrainCaustics.ts).

- [ ] Mevcut kanal bazlı soğurulma, Fresnel ve roughness filtrelemesini kullan; berrak sığlıkta açık tabanı korurken derinde yumuşak renk doygunluğu üret.
- [ ] River ve Lake'i aynı ışık/tabanda karşılaştır; bulanıklık ile renk kontrolünü birbirine karıştırmadan görünüm profillerini düzenle.
- [ ] Güneş izi, ortam yansıması ve dip rengi birlikte okunacak şekilde normal/roughness dengesini ayarla. Pozlamayı karşılaştırma ortasında değiştirme.
- [ ] Caustics kontrastı, ölçeği ve derinlik sönmesini referans profilde değerlendir; kuru alan ve güneş gölgesi maskelerini koru.

**Çıkış:** Üç profil ayırt edilebilir; her su turkuaza dönüşmez, sığ taban kaybolmaz, gölge/gecede yapay parlama görülmez. Önceki onaylı sahne değerleri otomatik olarak üzerine yazılmaz.

### V1b — Ortak köpük malzemesi

Başlangıç noktası: [waterFoam.ts](../../engine/render-three/waterFoam.ts) ve [lakeFoamTexture.ts](../../engine/render-three/lakeFoamTexture.ts). Uyarlama adayı Ultra-Water `bakeTextures.js` ve `OceanSurface.js` içindeki köpük sunumudur; sabit sürüm ve lisans kuralları §12'dedir.

- [ ] İlk prototipte ortak, döşenebilir **512²** köpük dokusunu değerlendir: yoğunluk/desen, yükseklik ve eğim kanalları. Nihai format/çözünürlüğü ölçüme göre belirle.
- [ ] Aynı doku tüm tüketicilerce paylaşılır; gövde başına üretim yapılmaz. GPU üretimi seçilirse render target ile texture'ın sahipliği birlikte yönetilir.
- [ ] Büyük parçalar, orta dallanmalar ve ince gözenekleri; yoğunluğa göre aşınma, köpük normali ve ince/yoğun renk ayrımıyla işle.
- [ ] Gerçek köpük kapsamını mevcut kıyı ve otomatik geometri maskeleri belirler. Ayrıntı River akışına hizalanır, Lake'te yavaş sürüklenebilir; temas bandı kayanın üzerinden kaymaz.
- [ ] Mip/filtre ve uzak görünümü, ışık/gölge/gece tepkisini, sampler sayısını ve ilk üretim takılmasını ölç.
- [ ] Kalite kapatma, son tüketicinin ayrılması ve level travel sonrası ortak kaynakları bırak; editörün bake/undo artifact'larını koru.

**Çıkış:** Yakında parçalı köpük, uzakta kararlı görünüm; kayanın çevresinde sabit temas, gölgede ışığa uyum ve mevcut Calculate/Recalculate/Cancel/Clear davranışı. Bu dilim **köpük geçmişi veya akış simülasyonu sağlamaz**.

### V1c — Ortam / planar yansıma sürekliliği

Başlangıç noktası: [waterEnvironment.ts](../../engine/render-three/waterEnvironment.ts) ve mevcut planar paylaşımı.

**Uygulama notu:** Ortam temeli, alpha kapsamıyla planar birleştirme ve ortak
GGX/parıltı kodu eklendi; doğrulama kullanıcı isteğiyle yapılmadı. Lake'te
authored `Off` bütün ortam/planar yansımayı kapatır. Kalite tavanı planar'ı
kapattığında ise `Low` yolu mevcut ortamı ödünç alır; yeni capture açılmaz.
Nehir mevcut ortam/probe yolunu kullanır; yeni River planar adaptörü eklenmedi.
Güneş parıltısı bu teslimde V4 dalga hareketinden bağımsız malzeme gelişimidir.

- [ ] Mevcut ortam/probe verisini temel yansıma olarak değerlendir; geçerli planar katkısını bununla birleştir. Roughness/mip, Fresnel, renk uzayı ve tone mapping'i birlikte kontrol et.
- [ ] Planar off/on ve kalite geçişlerinde güneş/ortam katkısını iki kez ekleme; probe/sky verisinin bulunmadığı durumda mevcut güvenli görünümü koru.
- [ ] Aynı düzlem/grup/kalitedeki reflection paylaşımını sürdür; gövde sayısıyla gereksiz capture artışı oluşturma.

**Çıkış:** Planar kapandığında yansıma sürekliliği korunur, açıldığında çift parlama/pozlama sapması oluşmaz. Ultra-Water atmosferi veya tüm post-process zincirini taşımak gerekmez.

## 7. V2 — Derinlikle doğrulanan hafif kırılma

### V2a — Lake

İlk uygulama kodlandı, kullanıcı görünümü iyi buldu ve commit öncesi
`build:verify` (2.131 engine kontrolü dahil) ile yeni kırılma browser testi
geçti. Geniş kalite/çoklu Play senaryosu ve GPU kabul sınırları V2a raporunda
ayrıca izlenir; aşağıdaki genel maddeler tüm matrisin kabulü değildir. Varsayılan
0,65 güçle başlanır; eski kayıtta alan yoksa aynı runtime varsayılanı uygulanır.
Kaydetme allowlist'i, `tools/saveValidator.ts` tarafından çağrılan ortak
`validateWaterBodies` / `validateWaterBody` içinde güncellendi.

Başlangıç noktası: [waterSceneSnapshot.ts](../../engine/render-three/waterSceneSnapshot.ts) ve Lake shader'ı. Uygun render yolundaki mevcut renk/depth snapshot paylaşılır; ilk çözüm gövde başına yeni sahne capture'ı açmaz.

- [ ] Mikro/geometrik normal yönünde sınırlı ekran UV kaydırması uygula; ince suda etkinin sıfıra yaklaşmasını sağla.
- [ ] Kaydırılmış depth'i su yüzeyine göre doğrula. Ön kaya/karaktere, ekran dışına veya geçersiz su örneğine denk gelirse kaydırmayı azalt ya da kaydırmasız örneğe dön.
- [ ] Hareketli dalganın yüzey derinliği ile snapshot/depth karşılaştırmasının kullandığı koordinat ve zamanın tutarlı olduğunu kontrol et.
- [ ] Direct/MSAA ve snapshot bulunmayan yollarda mevcut görünümü koru. Güç sıfırda baseline'a dönüş sağla.
- [ ] Kıyı, ada, ince bitki, karakter, ekran kenarı, farklı kotlu/üst üste görünen gövdeler ve düşük çözünürlükte dene.

**Çıkış:** Dipte kontrollü bükülme; kıyıda halo, öndeki siluetin suya çekilmesi veya çift nesne görüntüsü yok. Ekran dışı görüntü üretilemediği kayıtlıdır; teknik tam fiziksel ışın izleme olarak sunulmaz.

### V2b — River

**Planlandı, uygulama başlamadı:** 29 Ekim'de ayrı çalışmaya ertelenen River,
30 Ekim kullanıcı isteğiyle aşağıdaki görsel yakınlaştırma planında ele alındı.
V2b kırılma bu çalışmanın R3 dilimidir; planın yazılması uygulama kabulü değildir.

- [ ] Lake sonucu kabul edildikten sonra River render yolunun snapshot erişimini ve yerel yüzey kotunu ayrı incele.
- [ ] Eğime, yerel derinliğe ve gerçek River üçgenlerine bağlı doğrulamayla adaptör geliştir; sıfır deniz seviyesi varsayımı kullanma.
- [ ] Lake/River birlikteyken snapshot paylaşımı, optik tutarlılık, fallback ve kaynak ömrünü doğrula.

**Çıkış:** Lake için geçen kontrol seti eğimli River'da da geçer. River bağlantısı hazır değilse V2a ayrı teslim edilir ve V2b açık kalır; iki gövde türü için tamamlandı denmez.

### 7.1. River görsel yakınlaştırma planı — 30 Ekim 2026

**Hedef:** River'ın renk, dip geçirgenliği, mikro yüzey, yansıma ve güneş
parıltısını kabul edilmiş Lake malzemesine yaklaştırmak. Spline eğimi, yerel su
kotu, akış yönü/hızı, kıyıda yavaşlama ve rapid bölgeleri korunur. Lake'in
görünümü değiştirilmez; ortak yardımcı çıkarılırsa Lake sonucu regresyonla
korunur. Aynı malzeme hissi hedeflenir, akan nehrin hareketsiz göle dönüşmesi değil.

#### Koddan başlangıç bulguları

İncelenen kaynak `f06cacdd` sürümüdür. Bunlar statik kod bulgularıdır;
aynı ışık/kamera altında görsel veya GPU ölçümü yapılmış sayılmaz.

| Alan | Lake | River | Uygulamadaki karşılığı |
| --- | --- | --- | --- |
| Dip/kırılma | `lakeWater.ts`: scene color/depth, kanal bazlı soğurma ve su sütunu boyunca renk bütünleştirme; `lakeRefraction.ts`: doğrulanan UV kaydırma | `riverWater.ts`: geometriye işlenmiş derinlik, şeffaf `waterComposite`; scene snapshot/kırılma yok | R2 dip optiği, R3 yerel yüzey doğrulamalı kırılma |
| Yansıma | Ortam/probe + kapsama göre planar birleşimi, doğrudan rough Fresnel | Yalnız ortam/probe; RGB `2.0` tavanı ve `0.025 + fresnel * 0.425` ağırlığı | R1 ortam enerjisi ve açı davranışı |
| Güneş | Ortak GGX ve sparkle, yüzeyle ortak roughness | Aynı yardımcılar; ek `0.35` çarpanı ve sığlık sönümü; güneş roughness `0.28` | R1 aynı ışıkta dengelenmiş parlama |
| Mikro yüzey | `lakeSurface.ts`: üç normal örneği, döndürülmüş katmanlar, analitik gradyanlar, uzak ince detay sönümü | Akış UV'sinde iki normal, iri akıntı yamaları; yüzey şiddeti/roughness ayrı kontrol edilmiyor | R1 akış uzayına uyarlanan çok ölçekli detay |
| Renk | Üstel derinlik geçişi; snapshot yolunda bütünleştirilmiş saçılma | 2.2 m'ye kadar doğrusal geçiş, renge `0.84–1.16` türbülans çarpanı | R2 derinlik bantlarını ve boyalı yüzey hissini azaltma |
| Kıyı | Kaynak ve görünür derinlik, noise'lu blend; köpük dahil gerçek dibe geçiş | Kuru dip discard ve sığlık alpha'sı; Lake'in son birleşim bandı yok | R2 su/köpük için tutarlı kıyı geçişi |
| Köpük | Ortak `WaterFoamMaterial`, kıyı/bake maskeleri, taban renk `(.82,.87,.84)` | Ortak malzeme; rapid köpüğü, akış ve aşağı akış bake örnekleri, varsayılan `#e8fff5` | R4 ortak ışık/renk hissi, River dağılımını koruma |

Kaynaklar: `engine/render-three/{lakeWater,riverWater,lakeSurface,waterOptics,
waterEnvironment,waterSunGlint,waterSceneSnapshot,lakeRefraction,waterFoamMaterial}.ts`;
ayarlar `engine/scene/{waterBody,riverWater}.ts`.

Lake runtime fallback'i ile editörün `createLakeAppearance()` başlangıcı aynı
değildir. Örneğin editör profili surfaceStrength `2`, roughness `0.2`, absorption
`2` ve sharedPlanar kullanırken eski kayıt fallback'inde sırasıyla `1`, `0.22`,
`4` ve reflection off bulunur. River varsayılan opacity `0.65`, Lake fallback
`0.35`'tir. Bu sayılar kabul edilmiş sahnenin etkin değerleri sanılmayacak;
R0'da kayıtlı değerler, kalite tavanları ve aktif render yolu birlikte çıkarılacak.

#### R0 — Referansı sabitleme ve karşılaştırma zemini

- [ ] Kullanıcının kabul ettiği Lake/sahne kimliğini ve etkin görünüm değerlerini
  belirle; kaynak commit'i, ışık/exposure, post-process, kalite/adaptif durum,
  çözünürlük ve kameraları kaydet. Belirsizse görünümü tahmin ederek değiştirme.
- [ ] Kullanıcı sahnesini düzenlemeden ayrı fixture'da düz, eğimli, virajlı,
  sığ/derin River; taş teması, kuru kıyı ve farklı kotlu Lake/River hazırla.
- [ ] İki karşılaştırma yap: mevcut ayarlarla önce/sonra ve eşit renk/ışık/değerlerle
  malzeme farkı. Planar kapalı Lake de çekilsin; geometri yansıması eksikliği ile
  temel malzeme farkı ayrı ölçülsün.
- [ ] Gündüz/gölge/gece, üstten/eğik/yatay, yakın/uzak görüntü ve hareket dizisi
  üret. Mevcut draw/capture, CPU/GPU ve bellek başlangıcını kaydet.

**Çıkış:** Kabul edilmiş Lake'e dokunmadan tekrarlanabilir River baseline'ı.

#### R1 — Mikro yüzey, ortam yansıması ve güneş parıltısı

- [ ] Lake'in çok ölçekli mikro detay ve footprint sönümünü River'ın eğime bağlı
  tangent/bitangent uzayına uyarla; desen akışla taşınsın. Göldeki dünya-XZ
  normalini eğimli nehre doğrudan yapıştırma. Kıyıda yavaşlama ve rapid etkisi kalsın.
- [ ] Surface strength/roughness için açık River sözleşmesi oluştur; normalScale
  doku ölçeği olarak kalsın. Güneş ve ortam roughness ilişkisini Lake ile tutarlı
  yap; bağımsız katsayı gerekiyorsa görsel gerekçe ve ölçümle kaydet.
- [ ] `0.35` güneş çarpanı, yansıma RGB tavanı ve daraltılmış Fresnel'i tek tek
  karşılaştır; körlemesine kaldırma. HDR/bloom öncesi sonlu enerji, gece/gölge
  davranışı ve düşük kalite kararlılığını koruyarak Lake'e yakın profili seç.
- [ ] İlk dilimde yeni River planar capture ekleme. Mevcut ortam/probe yolunu
  iyileştir; planar'sız giderilemeyen farkı sonuçlarda açıkça belirt.

**Çıkış:** Akış okunur kalırken ince detay ve güneş/ortam tepkisi Lake ile
uyumlu; uzakta titreme, çizgilenme veya patlayan highlight yok.

#### R2 — Dip optiği, renk ve kıyı geçişi

- [ ] Paylaşılan `WaterSceneSnapshot` yoluna River tüketicisini bağla. River-only
  sahnede de çalışsın; ilk su çiziminden önceki opaque renk/depth bir kez alınsın.
  Çizim sırası, çoklu su ve örtüşen yüzeylerin kapsamı açıkça tanımlansın;
  Lake'i içeren veya nehrin kendisini tekrar örnekleyen geri besleme oluşmasın.
- [ ] Görünür dip ile yerel River yüzeyi arasındaki su yolundan soğurma ve
  saçılmayı hesapla. Eğime uygun yerel derinlik tanımı kullan; normal yönündeki
  kalınlığı düşey derinlikle karıştırma. Lake'in sabit kot varsayımını taşıma.
- [ ] Kanal bazlı soğurma ve bütünleştirilmiş sığ/derin renk yaklaşımını paylaş
  veya River'a uyarla. Renk türbülansını azaltmayı ayrı karşılaştır; akış hissini
  yalnız dip rengini dalgalandırarak üretme. Güneş/gölge katkılarını ayrıca doğrula.
- [ ] Gerçek kaynak su kapsamı ve görünür dip derinliğiyle kıyı geçişi oluştur;
  normal ve köpük de bu geçişe katılsın. Kuru alan, eksik tile ve dar su kanalı
  davranışını koru; blend su kapsamını genişletmesin.
- [ ] Snapshot yoksa mevcut güvenli şeffaf optik yoluna dön; çift dip birleşimi,
  halo ve render target'a bağlı/çözümlenmemiş texture okuması olmasın.

**Çıkış:** Önce kırılma kapalıyken dip/renk/kıyı tutarlı; Lake ortak yardımcı
değişikliğinden etkilenmiyor. Snapshot desteği genel performans kabulü değildir.

#### R3 — V2b: Eğimli River kırılması

- [ ] Yerel yüzey yüksekliği/eğimi ve gerçek River üçgen kapsaması sağlayan
  adaptör tasarla. Aday ve ara UV'deki ışın-yüzey kesişimini yerel suyla doğrula;
  Lake'in yatay düzlem/bağlı havza maskesini aynen kullanma.
- [ ] Mevcut River sorgusunu yeniden kullanma olanağını incele; shader için ek
  maske/alan gerekirse çözünürlük, doğruluk, GPU maliyeti, revision ve sahipliğini
  önceden belirt. Her kare terrain veya sahne mesh taraması ekleme.
- [ ] Ekran kenarı, ön plandaki kaya/kara, kuru hücre, farklı kot ve komşu gövde
  örneklerini reddet; sığlık/yatay bakışta etkiyi azalt, UV kaymasını piksel
  bütçesiyle sınırla. Başarısız örnekte doğrulanmış kaydırmasız dibe dön.
- [ ] Strength `0`, destek yokluğu ve kalite kapalı durumunu doğrula. Yalnız
  River bulunan sahne, Lake+River ve ters çizim sırası ayrı kontrol edilsin.

**Çıkış:** Hareketli yüzey dipte kontrollü kırılma üretir; kıyı çekilmesi,
kayaların uzaması veya başka kot/gövdeden renk sızması yok. Bu dilim ayrı kabul alır.

#### R4 — Köpük dengesi, kayıt ve kalite entegrasyonu

- [ ] Lake referansıyla köpük rengi/ışığını karşılaştır; River'ın rapid, kıyı ve
  aşağı akış engel dağılımını koru. Mevcut Calculate/Recalculate/Clear ve kalıcı
  bake akışı değişmesin; manuel temas aracı veya runtime yeniden bake eklenmesin.
- [ ] Yeni kalıcı alanlar için layout tipleri, `resolveRiverWater`, ortak
  validator/save allowlist, Details ve serialization testlerini birlikte güncelle.
  Eski kayıtların mevcut görünümünü koruyan sürüm/profil veya açık opt-in yolu
  seç; iyileştirmeyi bütün sahnelere sessizce dayatma. İngilizce UI/Türkçe tooltip.
- [ ] River kalite tavanlarını mevcut Lake politikasıyla açıkça eşleştir;
  authored kapalı etki açılmasın. Düşük/Orta fallback ve adaptif geçişler kayıtlı
  değerleri değiştirmesin. Kırılma kapalıyken gereksiz maske/update işi kalmasın;
  başka su tüketicisinin kullandığı snapshot kaynağı bırakılmasın.

**Çıkış:** Save/Reload/Play, undo/redo, kalite geçişi ve level travel tutarlı;
geçerli bake verisi ve kullanıcı sahneleri korunuyor.

#### Teslim sırası ve kabul

Sıra **R0 → R1 → R2 → R3 → R4**; her dilim ayrı önce/sonra kanıtı ve geri alma
noktasıyla teslim edilir. Veri uyumluluğu/kalite kuralları ilgili alan ilk eklendiği
anda uygulanır; R4'e kadar ertelenmez. Geometrik dalga modeli ilk kapsamda
değişmez; gerekirse CPU sorgusu, bounds ve yardımcı depth/normal geçişleriyle
birlikte ayrı tasarlanır. Planar River, akış simülasyonu, V3 köpük geçmişi,
Ocean ve Lake görünümünü yeniden tasarlama bu teslimin dışında kalır.

- [ ] İlgili dilim tamamlandığında uygun kontroller topluca çalıştırılır:
  `npx tsc --noEmit`, `npm run test:engine`, `npm run build:verify` ve değişen
  davranışı kapsayan Playwright editor/runtime testleri. Ara görsel ayarlarda
  aynı geniş test koşusu gereksiz tekrarlanmaz.
- [ ] §11 görsel/hareket/kayıt/yaşam döngüsü matrisi River fixture'larına
  uygulanır; Lake referans görüntüsü aynı koşullarda regresyon için karşılaştırılır.
- [ ] Aynı gerçek GPU'da baseline/sonuç AB/BA ölçümü yapılır: GPU p50/p95,
  CPU kare/dilim, draw/capture, texture/buffer byte ve transient tepe raporlanır.
  Snapshot kopyası ile ek sahne render'ı ayrı sayılır; gövde sayısı ve quality
  geçişlerinde maliyet sınırsız büyümez. R0 sonrasında sayısal bütçe belirlenir;
  ölçüm yoksa performans kabulü açık kalır.
- [ ] Sonuç raporu her dilimi uygulandı/teknik doğrulandı/görsel kabul edildi/
  performans kabul edildi olarak ayrı kaydeder. Kullanıcının River için görsel
  onayı alınmadan Lake onayı River'a genişletilmez.

**İlk somut uygulama:** R0 etkin Lake referansını ve River baseline'ını kaydetmek,
ardından R1'i izole fixture'da geliştirmek. Bu doküman commit'i bu adımları
uygulamaz ve yeni test/GPU sonucu iddia etmez.

## 8. V3–V4 — Hareketin sonraki gelişimi

### V3 — Kalıcı ve akışla taşınan köpük

**Yeni altyapı:** Görünür alanla sınırlı, başlangıçta **256²** iki GPU hedefiyle enerji geçmişi prototipi. Desteklenen format cihazda sınanır; destek yoksa V1 köpüğüne dönülür. Ultra-Water'ın FFT köpük geçmişi bu işi hazır olarak sağlamaz.

Önerilen kavramsal güncelleme:

```text
E_yeni(x) = clamp(E_eski(x - akış * dt) * exp(-dt / ömür)
                   + kaynak(x) * dt, 0, E_max)
```

- [ ] Mevcut otomatik engel/kıyı maskelerini kaynak yap; River yön/hız verisini ilk taşıma alanı olarak kullan. Statik mesh yeniden taranmaz.
- [ ] Kaynak enjeksiyonu, taşıma ve son çizimde gerçek su maskesini uygula; ada üzerinden veya gövdeler arasında enerji geçmesini önle.
- [ ] Lake rüzgârı ve yaklaşık tepe göstergesini açıkça görsel yaklaşım olarak tanımla. Yalnız düşey dalgaya gerçek yatay sıkışma Jacobian'ı atfetme.
- [ ] Dünya koordinatında kararlılık, kamera yeniden merkezleme, görünürlük dışı durum, duraklatma, teleport temizliği ve büyük `dt` politikasını tanımla.
- [ ] 30/60/120 FPS'te benzer ömür/taşıma sağla; Recalculate/Clear ve yeni maske revision'ında eski geçmişin temizlenme davranışını belirle.
- [ ] Toplam görünür alan/gövde bütçesi uygula; her göle koşulsuz target ayırma. Kalite kapalıyken update işi ve hedefler bırakılır.

İki mip'siz RGBA16F hedefin ham renk belleği 256² için **1 MiB**, 512² için **4 MiB**, 1024² için **16 MiB** olur. Maske, akış, depth, sürücü ve transient payları bu hesaba dahil değildir. Bu hesap ölçülmüş tepe veya kabul bütçesi değildir.

**Çıkış:** Zaman dizisinde köpük doğar, taşınır ve söner; yalnız kayan UV deseninden ayrılır. Kuru alana sızma ve kamera/kalite geçişinde sıçrama yoktur. Gerçek girdap, su hacmi veya Navier–Stokes çözümü vaat edilmez.

### V4 — Rüzgârlı Lake profili ve tepe ışığı

- [ ] Mevcut üç düşük genlikli bileşeni kontrollü yön dağılımı ve zamanla değişen paketlerle geliştir; sakin/rüzgârlı profilleri ayır.
- [ ] Geometrik eğim, mikro normal, kıyı sönümü, CPU sorgusu, bounds ve AO/DoF yollarını aynı modelde tut.
- [ ] Tepe geçirgenliği/saçılmasını sınırlı olarak dene; gece/gölgede emissive renk üretme. V3 kullanılıyorsa tepe kaynağını aynı hareketten türet.
- [ ] Yatay deplasman gerekiyorsa ayrı sorgu/inversiyon tasarımı çıkar; mevcut düşey yükseklik sorgusuna gizlice ekleme.

**Çıkış:** Rüzgârlı profil siluette ve ışıkta okunur, kıyıda sönümlenir; tekerlek teması ve yardımcı geçişler çizilen suyla uyumludur. V4 için FFT zorunlu değildir.

## 9. V5, Ocean ve eski planın kalan kapsamları

| İş | Sınırlı ilk teslim | Ayrı tutulacak işler / kabul |
| --- | --- | --- |
| V5a — Hareketli nesne izi | Runtime nesnesinden otomatik yön/hız kaynağı; ilk ihtiyaç köpükse V3 üzerinde köpük izi | Yüzey yüksekliği dalgası ve fiziksel tepki ayrı teslimler. Dururken iz yok; teleport uzun çizgi üretmez. Kelvin izi sığ River'a doğrudan taşınmaz |
| V5b — Su altı | Gövde aidiyeti, per-pixel su çizgisi, derinlik sisi, yüzeyin alttan görünümü ve kamera geçişi | Çok kotlu Lake/River, yüzey sınırında titreme, gölge ve caustics uyumu; ışık huzmesi/parçacık sonra |
| Fizik / yüzdürme | Geçerli su sorgusundan Rapier kuvvet/torque adaptörüne sınırlı deney | Yüzme, akış kuvveti, araç su davranışı ayrı oyun/engine sözleşmeleri. Demo fizik döngüsü kopyalanmaz |
| Hava / yağmur | Ortak rüzgâr/ışık durumu ve yerel yağmur/sıçrama kaynakları | Yağmurla dolma/kuruma, taşma ve hacimsel akış simülasyonu ayrı kapsam |
| W3 — Puddle | Küçük sığ alan/ıslaklık ve terrain ile ilişki tasarımı | Eski planda uygulanmadı; V0–V2'yi bloke etmez, yeni araç/veri/kabul gerektirir |
| W5 — River/Lake ortaklaşması | Kanıtlanan optik/köpük/kalite yardımcılarını paylaşma | Ortak Water Body veri modeli ve birleşim çizimi ayrı iş. Ortak shader kullanmak W5'i tamamlamaz |
| W4-O — Ocean | Deniz seviyesi, kara/ada maskesi, yakın yüzey ve uzak LOD için izole prototip | FFT, su altı ve yüzdürmenin her biri ayrı performans/görsel kabul alır |

### W4-O prototip sırası

1. Su kotu/dünya dönüşümü, çok tile'lı terrain, değişen Sculpt verisi, kıyı maskesi ve ufuk gereksinimini yaz.
2. Basit analitik geniş yüzey ile Ultra-Water FFT seçeneğini aynı Forge fixture'ında karşılaştır. Kamerayı izleyen polar grid, clipmap veya başka LOD seçimi prototip sonucuna bağlıdır.
3. GPU float/half-float render target, MRT ve sampler sınırlarını cihazda doğrula; desteklenmeyen cihaz için fallback belirle.
4. Yeni yükseklik alanının CPU/fizik sorgusunu tasarla. Ultra-Water sorgusundaki raporlanmış 1–3 kare readback gecikmesi sabit fizik adımıyla doğrudan eşdeğer kabul edilmez.
5. İptal, revision, terrain değişimi, kalite, level travel ve geç GPU yanıtlarının yaşam döngüsünü Forge'a uyarla.
6. Ayrı Ocean bütçesi ve görsel kanıt olmadan üretim Lake/River yoluna taşıma.

Ultra-Water incelemesindeki dört 256² kademeli FFT, normal update'te **21 GPU çizimi** ve yaklaşık **22,67 MiB teorik FFT texture verisi** içerir. Bu, ölçülmüş GPU bellek tepesi veya 21 sahne capture'ı değildir; diğer su/render kaynaklarını içermez. Demoya ait toplam kare süreleri Forge'un ek maliyeti olarak kullanılamaz. Kaynakta sürekli hareket wake'i hazır değildir. Dalga türevli caustics ileride denenirse mevcut terrain caustics üzerine eklenmek yerine ayrı alternatif olarak karşılaştırılır.

## 10. Kalite, veri ve kaynak yaşam döngüsü

### 10.1. Kalite sözleşmesi

Mevcut Lake tavanları korunur: Düşükte caustics/köpük/ıslak kıyı/planar kapalı ve 8 teker dalgası; Ortada köpük/ıslak kıyı izinli, caustics/planar kapalı ve 12 dalga; Yüksekte caustics izinli, planar en fazla medium ve 24 dalga; Ultra'da planar en fazla high ve 24 dalga. Profil, authored olarak kapalı özelliği açmaz.

Yeni özellikler için aşağıdaki dağılım **öneridir; henüz uygulanmadı**:

| Yeni etki | Düşük | Orta | Yüksek / Ultra |
| --- | --- | --- | --- |
| V1 renk/temel yüzey | Ana renk ve hareket kimliği korunur | Korunur | Korunur |
| V1 köpük malzemesi | Mevcut köpük tavanı gereği kapalı | Ölçülen sade örnekleme | Ayrıntı, sampler/GPU sınırına göre |
| V1 ortam fallback | Destek/maliyet doğrulanırsa | Aynı temel yön | Planar ile tutarlı birleşim |
| V2 kırılma | Kapalı, mevcut optik yol | Ölçüm sonrası karar | Destek varsa, authored tavanla |
| V3 kalıcı köpük | Kapalı; update/target yok | İlk prototipte kapalı | Yalnız sınırlı alan ve ayrılmış bütçeyle |
| V4 hareket | Sakin ana dalga karakteri | Sınırlı ayrıntı | Ölçülen rüzgârlı profil |

River'a aynı tavanların otomatik bağlı olduğu varsayılmaz; ortak politika/adaptör V1–V2 sırasında ayrıca doğrulanır. Adaptif sistem yeni etkilerin azaltma/geri yükseltme sırasını açıkça tanımlar; profil geçişi terrain/geometriyi gereksiz yeniden hazırlamaz ve kalıcı ayarlara yazmaz.

### 10.2. Kayıt ve editör

- Yeni kalıcı görünüm alanı gerekiyorsa ortak runtime veri sözleşmesi, varsayılan/migration davranışı, validator allowlist ve `tools/saveValidator.ts` birlikte güncellenir. Eski kayıtların görünümü için uyumluluk yolu belirlenir.
- Yeni kontrol mevcut su Details düzeninde sunulur; geçerli UI geleneği olan İngilizce etiket/Türkçe açıklama sürdürülür. Yeni kontrol eklemek gerekmiyorsa mevcut parametre kullanılır.
- Save/Reload/Play ve undo/redo aynı sonucu üretir; kalite tavanı authored değeri üzerine yazmaz.
- V3 GPU köpük geçmişi ilk tasarımda geçici runtime verisidir; sahne dosyasına her kare yazılmaz. Kalıcı ayarlar ile geçici simülasyon ayrı tutulur.
- Bake maskesi değişmedikçe V1 malzeme değişimi yeniden mesh hesabı istemez. Hazırlık sırasında Calculate'ın mevcut hazır-yüzey koşulu korunur.

### 10.3. Sahiplik ve iptal

Her yeni texture/render target/buffer için oluşturucu, paylaşılan tüketiciler ve son bırakma noktası belirlenir. Geç tamamlanan üretim/readback eski revision'a veya kapanmış level'a kaynak yayımlayamaz. Texture ile onu taşıyan render target birlikte yönetilir. Son tüketici ayrıldığında, efekt kapandığında veya level değiştiğinde gereksiz kaynak/update işi biter; başka tüketicinin ortak lease'i korunur.

Yeni görünüm hazırlanırken önceki geçerli mesh/görünüm korunur. Başarısızlık/iptal geçici kaynakları bırakır. Ölçümler yalnız kaynak sayısını değil buffer/texture byte'larını ve replacement sırasındaki eski+yeni tepeyi de içerir.

## 11. Doğrulama ve tamamlanma ölçütleri

Her teslimde **işlev, görsel, hareket, kayıt, kaynak ve performans** sonucu ayrı yazılır. Bir katmanın geçmesi diğerinin yerine kullanılmaz.

| Katman | Gerekli kanıt |
| --- | --- |
| Tür / engine / build | TypeScript değişirse `npx.cmd tsc --noEmit`; engine/runtime için `npm.cmd run test:engine` ve `npm.cmd run build:verify`. Değişen sözleşmeye uygun regresyonlar |
| Browser | Playwright ile `?editor` ve Play; konsol, çok açılı kıyı/ada/kaya, eğimli River, farklı kot ve çoklu gövde |
| Görsel | V0 kameralarında önce/sonra, gündüz/gölge/gece ve yakın/uzak; yeni görünüm için kullanıcı değerlendirmesi |
| Hareket | Video veya zaman dizisi; köpük/dalga/iz için 30/60/120 FPS, durma/başlama, kamera kayması ve teleport |
| Kayıt | Yeni alan varsa Save/Reload/Play ve undo/redo; eski kayıt ve bilinmeyen/bozuk veri davranışı |
| Yaşam döngüsü | En az 20 kalite/clear–undo/rebuild/reload/travel tekrarı; geciken iş ve iptal dahil kaynak sayısı/byte ve tepe |
| Donanım | Aynı gerçek GPU, aynı sahne/kamera/ışıkta AB/BA; p50/p95 GPU farkı, draw/capture, CPU dilimi ve transient bellek |
| Production | Geliştirme sunucusu ölçümünden ayrı paket/preview koşusu ve cold açılış kaydı |

GPU için en az **300 AB/BA çift örnek**, rebuild için **5 hazırlık + 30 ölçüm**, cold için cache koşulu belirtilmiş en az **10 örnek** başlangıç yöntemidir. `npm.cmd run perf:lake` mevcut tekrar aracıdır; yeni efekt/fixture kapsamını ölçtüğü ayrıca doğrulanır. Donanım timer desteği yoksa GPU kabulü açık raporlanır. Ortalama FPS veya sabit ekran görüntüsü tek başına yeterli değildir.

İlk paket için tamamlanma kontrolü:

- [ ] V0 fixture, kaynak sürümü ve baseline tekrarlanabiliyor.
- [ ] V1a/b/c ayrı karşılaştırılıyor; otomatik köpük akışı ve eski içerik uyumluluğu korunuyor.
- [ ] V2a fallback/halo kontrol seti geçiyor; V2b sonucu ayrıca belirtiliyor.
- [ ] Kalite, kayıt ve kaynak yaşam döngüsü geçiyor; yeni GPU/CPU maliyeti belirlenmiş tavanla karşılaştırılıyor.
- [ ] Yeni görsel sonuç değerlendiriliyor; kalan P0 ve donanım sınırları açıkça listeleniyor.
- [ ] Uygulama raporu bu planın ilgili maddelerine bağlanıyor; tamamlanmayan katmanlar işaretlenmiyor.

Yalnız bu plan dokümanının hazırlanması için engine testi/build çalıştırılmaz. Uygulama save/load doğrulaması, asset alımı veya izin sınırlarını değiştirirse uygun kapsamlı Codex Security diff incelemesi önerilir; tarama kullanıcı başlatması/onayıyla yürütülür.

## 12. Ultra-Water uyarlama ve lisans kaydı

Kaynak referansı, entegrasyon raporunda incelenen **`ce9248fa20afbdf63fd4c11709f68d7368aca0a0`** sürümüdür. Bu plan, değişebilen `master` içeriğine göre otomatik entegrasyon önermez.

- İlk adaylar: `bakeTextures.js` köpük üretimi, `OceanSurface.js` köpük sunumu, depth kontrollü kırılma ve ortam/planar birleşimi.
- Kod uyarlama yapılırsa alınan dosya/fonksiyon, sabit commit, Forge'daki hedef ve değişiklikler kayda geçirilir; MIT lisansı, `Copyright (c) 2026 Humpalumps` ve alınan parçalarla ilgili üçüncü taraf bildirimleri dağıtımda korunur. Ayrıntılı lisans değerlendirmesinin kaynağı entegrasyon raporudur.
- WaterPro'nun ücretli dokuları/kaynakları ve araştırma video kareleri oyun asset'i olarak kullanılmaz. Bağımsız üretim veya uygun lisanslı kaynak seçilir.
- Demo adası, GUI, OrbitControls, atmosfer, post-process ve özel fizik döngüsü birlikte Forge'a alınmaz. Gerekli küçük parçalar mevcut render ve Rapier düzenine uyarlanır.
- İncelemede Ultra-Water `three ^0.186.1` / `vite ^8.3.5`, Forge ise `three 0.184.0` / `vite ^7.0.0` kullanıyor. İlk pakette toplu bağımlılık yükseltmesi planlanmaz; uygulama anında gerçek sürümler ve shader/API uyumu yeniden kontrol edilir.

## 13. Sonraki oturumun somut başlangıcı

**30 Ekim güncel yön:** Sonraki River çalışması §7.1'deki R0 ile başlar;
ardından R1–R4 izlenir. Aşağıdaki 29 Ekim kaydı geçmiş teslim bağlamıdır.

**Güncel durum:** V1b köpüğün ardından V1c ortam/planar birleşimi ve Lake/River
GGX güneş parıltısı kodlandı. Kullanıcı, görüntüler üzerinden yapılan son
düzeltmenin Lake görünümünü kabul etti. Kullanıcının isteğiyle otomatik veya
tarayıcı doğrulaması yapılmadı; tür/build/engine ve GPU maliyeti açık kalır.
Yansıma/güneş değişiklikleri `c5d1b4a1` ile commit edildi. Ardından V2a Lake
kırılma kodlandı ve kullanıcı görünümü iyi buldu. Ortak index'teki göl kodu
eşzamanlı `671f4386` commit'ine dahil oldu; kalan test/rapor kaydı ayrı Lake
doğrulama commit'iyle tamamlanır. Sonuçlar V2a raporunda izlenir. Kullanıcı
kararıyla nehir ayrı ve daha kapsamlı bir çalışmaya ertelendi.
Aşağıdaki sıra, planın ilk oluşturulduğu andaki başlangıç önerisidir.

İlk uygulama adımı **V0 ve P0 baseline**: ayrı Lake/eğimli River fixture'ı, sabit kameralar, üç görünümün başlangıç değerleri ve güncel kaynak ölçümü. Sonraki adım V1a ile optik denge, ardından V1b ortak köpük malzemesidir. Yeni kalıcı alanların gerekip gerekmediği ve efekt bütçeleri fixture sonuçlarıyla netleştirilir.

Bu plan ilk hazırlanırken engine/editor kodu, sahne/terrain, bağımlılıklar ve önceki plan/raporlar değiştirilmedi. Sonraki uygulamalar yukarıdaki teslim notlarıyla izlenir; kodlanmış olmak kabul edilmiş olmak anlamına gelmez.
