# Forge Su Sistemi — Görsel Gelişim ve Entegrasyon Planı

Tarih: 29 Ekim 2026 · Durum: V1b ilk uygulaması yapıldı; kullanıcı görsel kabulü ve yeni GPU maliyeti açık.

**Uygulama notu:** Kullanıcı önceliğiyle V1b köpük malzemesi öne alındı.
Ortak 512² doku, yoğunluğa bağlı desen ve kabarıklık ışıklandırması Lake/River'a
uygulandı. [Uygulama, doğrulama ve açık sınırlar](../reports/WATER_FOAM_MATERIAL_V1B_2026-10-29.md).
V0'ın geniş kapsamı ve P0 genel kabulü tamamlanmış sayılmaz.

**Hedef:** Mevcut Lake/River altyapısını koruyarak suyun renk, ışık, köpük ve kırılma kalitesini geliştirmek; daha sonra kalıcı köpük, rüzgârlı yüzey, nesne izi, su altı ve Ocean çalışmalarını ayrı teslimlerle ilerletmek.

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

- [ ] Mevcut ortam/probe verisini temel yansıma olarak değerlendir; geçerli planar katkısını bununla birleştir. Roughness/mip, Fresnel, renk uzayı ve tone mapping'i birlikte kontrol et.
- [ ] Planar off/on ve kalite geçişlerinde güneş/ortam katkısını iki kez ekleme; probe/sky verisinin bulunmadığı durumda mevcut güvenli görünümü koru.
- [ ] Aynı düzlem/grup/kalitedeki reflection paylaşımını sürdür; gövde sayısıyla gereksiz capture artışı oluşturma.

**Çıkış:** Planar kapandığında yansıma sürekliliği korunur, açıldığında çift parlama/pozlama sapması oluşmaz. Ultra-Water atmosferi veya tüm post-process zincirini taşımak gerekmez.

## 7. V2 — Derinlikle doğrulanan hafif kırılma

### V2a — Lake

Başlangıç noktası: [waterSceneSnapshot.ts](../../engine/render-three/waterSceneSnapshot.ts) ve Lake shader'ı. Uygun render yolundaki mevcut renk/depth snapshot paylaşılır; ilk çözüm gövde başına yeni sahne capture'ı açmaz.

- [ ] Mikro/geometrik normal yönünde sınırlı ekran UV kaydırması uygula; ince suda etkinin sıfıra yaklaşmasını sağla.
- [ ] Kaydırılmış depth'i su yüzeyine göre doğrula. Ön kaya/karaktere, ekran dışına veya geçersiz su örneğine denk gelirse kaydırmayı azalt ya da kaydırmasız örneğe dön.
- [ ] Hareketli dalganın yüzey derinliği ile snapshot/depth karşılaştırmasının kullandığı koordinat ve zamanın tutarlı olduğunu kontrol et.
- [ ] Direct/MSAA ve snapshot bulunmayan yollarda mevcut görünümü koru. Güç sıfırda baseline'a dönüş sağla.
- [ ] Kıyı, ada, ince bitki, karakter, ekran kenarı, farklı kotlu/üst üste görünen gövdeler ve düşük çözünürlükte dene.

**Çıkış:** Dipte kontrollü bükülme; kıyıda halo, öndeki siluetin suya çekilmesi veya çift nesne görüntüsü yok. Ekran dışı görüntü üretilemediği kayıtlıdır; teknik tam fiziksel ışın izleme olarak sunulmaz.

### V2b — River

- [ ] Lake sonucu kabul edildikten sonra River render yolunun snapshot erişimini ve yerel yüzey kotunu ayrı incele.
- [ ] Eğime, yerel derinliğe ve gerçek River üçgenlerine bağlı doğrulamayla adaptör geliştir; sıfır deniz seviyesi varsayımı kullanma.
- [ ] Lake/River birlikteyken snapshot paylaşımı, optik tutarlılık, fallback ve kaynak ömrünü doğrula.

**Çıkış:** Lake için geçen kontrol seti eğimli River'da da geçer. River bağlantısı hazır değilse V2a ayrı teslim edilir ve V2b açık kalır; iki gövde türü için tamamlandı denmez.

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

**Güncel durum:** Köpük önceliğiyle V1b ilk uygulaması teslim edildi. Sonraki
görsel adım, bu malzemeyi kullanıcının gerçek Lake/River sahnesinde değerlendirip
gerekli görünüm ayarını yapmaktır; yeni GPU maliyeti ayrıca ölçülmelidir.
Aşağıdaki sıra, planın ilk oluşturulduğu andaki başlangıç önerisidir.

İlk uygulama adımı **V0 ve P0 baseline**: ayrı Lake/eğimli River fixture'ı, sabit kameralar, üç görünümün başlangıç değerleri ve güncel kaynak ölçümü. Sonraki adım V1a ile optik denge, ardından V1b ortak köpük malzemesidir. Yeni kalıcı alanların gerekip gerekmediği ve efekt bütçeleri fixture sonuçlarıyla netleştirilir.

Bu plan hazırlanırken engine/editor kodu, sahne/terrain, bağımlılıklar ve önceki plan/raporlar değiştirilmedi. Yeni işlerin hiçbirine uygulandı veya kabul edildi durumu verilmedi.
