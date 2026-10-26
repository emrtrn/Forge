# FORGE WORLD BUILDER
## AI destekli, prosedürel ve düzenlenebilir açık dünya / level üretim sistemi

**Belge:** `FORGE_WORLD_BUILDER_TASARIM_VE_TEKNIK_PLAN_v0.1.md`  
**Sürüm:** 0.1 — başlangıç tasarımı ve araç yol haritası  
**Tarih:** 25 Ekim 2026  
**İlgili teknoloji:** Forge Editor / Forge Engine — Three.js tabanlı web editörü  
**İlk kullanım senaryosu:** Forge Offroad (lojistik ve taşımacılık; izole dağ yerleşimleri)  
**Uzun vadeli kapsam:** Farklı oyun türlerinde yeniden kullanılabilir genel amaçlı world/level üretimi  
**Belge durumu:** Tasarım önerisi; bu belgede önerilen World Builder modülleri uygulanmış kabul edilmez.

---

## 0. Belgenin amacı ve bilgi kaynakları

Bu belge, tek bir **AI referans görselinden** başlayarak Forge'da **aşamalı, denetlenebilir, yeniden üretilebilir ve elle düzenlenebilir** bir oyun dünyası oluşturma sisteminin mimarisini tanımlar. Codex veya Claude referansı inceler, bir **World Plan / World Recipe** üretir; Forge ise kendi editör araçlarıyla dünyayı oluşturur ve doğrular.

**En önemli tasarım kararı:** AI'ın on binlerce ayrı fare/fırça işlemini taklit etmesi yerine, parametreleri ve ilişkileri tanımlayan bir üretim tarifi vermesi hedeflenir. Uygulanmış editör işlemleri ve yeni prosedürel modüller bu tarifi çalıştırır.

### 0.1. Durum bilgisinin kaynağı

| Bilgi | Durum | Dayanak |
|---|---|---|
| Forge'da açık dünya arazi oluşturma kullanılabiliyor | **Kullanıcı tarafından bildirilen güncel durum** | 25.10.2026 tarihli proje görüşmesi |
| Forge'da arazi deformasyonu mümkün | **Kullanıcı tarafından bildirilen güncel durum** | 25.10.2026 tarihli proje görüşmesi; hangi deformasyon türleri olduğu kodda ayrıca doğrulanmalı |
| Spline yol, nehir, göl ve su birikintisi araçları büyük landscape ile bütünleştiriliyor | **Aktif geliştirme** | 25.10.2026 tarihli proje görüşmesi |
| Sculpt, paint, spline yol/deformasyon, foliage instancing, nehir görselleştirme temelleri bulunuyor | **23.10.2026 teknik raporunda doğrulanmış** | `FORGE_OFFROAD_FORGE_TEKNIK_DURUM_RAPORU_2026-10-23.md` |
| World Recipe, World Builder işlem zinciri, yerleşim/rota üreticileri, otomatik biyom maskeleri | **Bu belgedeki öneriler** | Henüz uygulama doğrulaması yok |

> **Sürüm farkı notu:** 23 Ekim teknik raporu eski bir kod anını inceliyor ve o tarihte çoklu tile renderer/streaming entegrasyonunun tamamlanmadığını yazıyor. Kullanıcının 25 Ekim'deki açık dünya işlevi açıklaması daha güncel olduğundan burada esas alınmıştır. Bununla birlikte güncel Git commit, performans, tile sınırı ve streaming davranışı yeniden ölçülmemiştir. Eski rapordaki eksikler bugün hâlâ varmış gibi sunulmamalıdır.

> **Deformasyon sınırı:** Editörde landscape yüksekliğinin değiştirilmesi, spline'ın zemini kazması/düzleştirmesi ve **oyun sırasında lastik izleriyle dinamik deformasyon** teknik olarak farklı işlevlerdir. Kullanıcının 'arazi deformasyonu mümkün' ifadesi kayda alınır; üç alt türün kapsamı repo incelemesinde ayrı işaretlenir.

### 0.2. Proje bağlamı

Forge Offroad'ın kesinleşmiş ana deneyimi **lojistik ve taşımacılık**, dünyası ise **izole dağ yerleşimleri**dir. World Builder'ın ilk kabul senaryosu bu çerçeveyi kullanabilir; buna karşın mimari sadece Offroad'a özgü olmamalıdır.

---

## 1. Vizyon ve ürün ilkeleri

**Vizyon:** “Bir referans görseli, kısa tasarım açıklaması ve birkaç oyun kısıtı ver; Forge yerleşimleri, yolları, araziyi, suyu, doğayı ve sahne öğelerini kontrollü aşamalarla oluştursun. Oluşturulan dünya oyun motorunda çalışsın ve gerektiğinde yalnız etkilenen kısımları yeniden üretilebilsin.”

**İlkeler**

1. **Önce plan, sonra geometri:** Dağ/vadi, su koridoru, ana ulaşım ve yerleşim konumları gerçek mesh ve asset yerleşiminden önce tasarlanır.
2. **Referansa benzerlik + oynanabilirlik:** Görsel hedef, eğim, yol genişliği, araç geçişi, görev ilişkileri ve performansla birlikte değerlendirilir.
3. **Tek yönlü makro değil, bağımlılık grafı:** Nehir-yol-köprü-yerleşim-foilage değişiklikleri birbirini etkiler; gerektiğinde ilgili aşamalar yeniden çalışır.
4. **Non-destructive authoring:** Prosedürel ve manuel işlemler ayrı katman/override verilerinde korunur; onaysız silme yapılmaz.
5. **Deterministik üretim:** Aynı tarif, seed, asset sürümleri ve jeneratör sürümleri aynı çıktıyı üretmeyi hedefler; farklılıklar raporlanır.
6. **Editör verisi ve runtime verisi ayrı:** Yüksek maliyetli dünya üretimi çoğunlukla editörde yapılır; oyun sırasında sadece gereken davranış sistemleri çalışır.
7. **Ölçülebilir kalite kapıları:** Her üretim aşamasının başarı ölçütleri ve testleri bulunur.
8. **Motor bağımsız tasarım bilgisi:** World Plan, World Recipe ve semantik asset bilgileri yalnız belirli bir editör paneline bağlı kalmaz.

### 1.1. Kapsam dışı varsayımlar

- Tek perspektif referanstan eksiksiz, fiziksel olarak doğru 3B dünya çıkarıldığı **iddia edilmez**.
- Her referans görseli tek başına kesin harita ölçeği, gizlenmiş topografya ve zemin fiziği sağlamaz; bunlar kullanıcı kısıtları veya tasarım varsayımlarıyla tamamlanır.
- AI'ın her işlemde doğru asset seçmesi garanti edilmez; uygun etiketli asset bulunmuyorsa placeholder ve eksik-asset uyarısı kullanılır.
- Nehir/gölün görsel mesh olarak oluşması, akıntı, yüzdürme veya araç motorunun su altında kalması gibi gameplay fiziğinin hazır olduğu anlamına gelmez.
- Dünya ölçeğinin büyüklüğü, performans ve bellek testleri yapılmadan kalite garantisi değildir.

---

## 2. Ana kavramlar ve veri otoritesi

| Kavram | Açıklama |
|---|---|
| **Reference Pack** | Bir veya birkaç görsel, açıklama, görsel stil, ölçek varsayımı, oynanış kısıtları |
| **Semantic World Plan** | Dünya sınırı, coğrafya bölgeleri, su ağı, POI'lar, yol bağlantıları, yerleşim alanları ve ilişkiler |
| **World Recipe** | Parametreler, generator sürümleri, seed, seçili asset katalogları, üretim kuralları ve aşama bağımlılıkları |
| **World Generator** | Recipe komutlarını terrain, yol, su, foliage vb. gerçek Forge verisine dönüştüren yürütücü |
| **Spatial Mask** | Eğim, yükselti, kıvrım/curvature, su mesafesi, biyom, yol ve yapı hariç alanları gibi mekânsal veri |
| **World Layer** | Base terrain, hydrology deform, road deform, foundation, surface paint, manual override gibi bağımsız katkılar |
| **Generated Object** | Kaynak tarif/aşama kimliği ve kalıcı obje ID'si olan sahne varlığı |
| **World Validation** | Geometri, bağlantı, çakışma, fizik, görsel uyum ve performans denetimleri |
| **Bake / Commit** | Önizleme üretimini açık onayla kalıcı level verisine dönüştürme |

### 2.1. Önerilen veri akışı

```text
AI REFERANS GÖRSELİ + METİN + OYUN KISITLARI
                         |
                         v
            [Reference Interpreter]
            [Semantik özellik çıkarımı]
                         |
                         v
               [Semantic World Plan]
               POI / yollar / su / biyom
                         |
                  plan kontrolü
                         v
                  [World Recipe]
           seed / aşamalar / kısıtlar
                         |
                         v
             [Forge World Generator]
        terrain -> su/yol -> yerleşim -> doğa
                         |
               aşama doğrulamaları
                         v
           [Preview / Diff / Manual Fix]
                         |
                         v
             [Bake / Save / Playtest]
```

### 2.2. Önerilen katman sahipliği

| Katman | Değişiklik sahibi | Değiştiğinde etkilediği sistem |
|---|---|---|
| Base Heightfield | Macro Terrain Generator | Tüm terrain bağımlıları |
| Terrain Detail / Erosion | Terrain Detail Generator | Yerel yüzey, paint, foliage |
| Hydrology Deform | River/Lake/Pond Generator | Yol geçişleri, kıyı, boya, foliage |
| Road Deform | Road Generator | Kesişim, yol kenarı, paint, foliage |
| Settlement / Foundation | Settlement Generator | Parsel, yapı, props, foliage |
| Surface / Biome Paint | Mask & Material Generator | Zemin görseli, varsa yüzey fiziği, foliage |
| Generated Foliage / Props | PCG Scatter Generator | Yalnız üretilen instance kümeleri |
| **Manual Overrides** | Kullanıcı / editör | Yetkisiz otomatik değiştirilemez |

Katmanlar tek bir heightmap'e kalıcı olarak gömülmemeli; mümkün olduğunca kaynak parametreleri ve etkileri saklanmalıdır. Bazı sistemlerde performans için bake gerekir; bake, kaynak tarifin kaybı anlamına gelmemelidir.

---

## 3. Referanstan level'a önerilen 13 aşamalı iş akışı

Aşağıdaki sıra **çalışma akışıdır**, katı tek-geçiş algoritması değildir. World Plan'ın taslak POI ve su/yol koridorları oluşturması, arazi ve suyun sonradan birbirini düzeltmesine izin verir.

| ID | Aşama | Üretilen veri/çıktı | Bir sonraki aşamaya geçiş koşulu |
|---|---|---|---|
| **00** | Reference Analysis | Görseldeki semantik öğeler, kamera/tarz tahmini, belirsizlik notları | Ana görsel hedefler ve tahmini öğeler listelenmiş |
| **01** | World Layout & Gameplay Blockout | Dünya sınırı, dağ/vadi zonları, su koridoru, POI/yerleşimler, rota alternatifleri | Yol hedefleri bağlantı açısından anlamlı; temel ölçek kabul edilmiş |
| **02** | Scene & Environment Setup | Level dosyası, koordinat sistemi, güneş, skylight, gökyüzü/bulut/sis taslağı | Editörde sahne açılır ve kaydedilir |
| **03** | Macro Terrain | Ana heightfield, sırt-vadi-plato, büyük yükselti farkları | Arazi ölçüleri/tile dikişleri geçerli; kritik POI alanları erişilebilir |
| **04** | Hydrology Draft & Carving | Akış havzası, nehir koridorları, göllerin su kotu, nehir yatağı/kıyı deformu | Su kotları/akış eğimi tutarlı; yol planı suyu tanır |
| **05** | Road Network & Terrain Conform | Yol grafı, spline'lar, yatay/düşey profil, yol yüzeyi, kesme/dolgu, geçit/köprü adayları | Hedefler bağlı; yol eğimi/dönüşleri araç profilini ihlal etmiyor |
| **06** | Settlement Layout | Köy sınırı, sokaklar, yapı parselleri, depo ve yapı pedleri | Yol erişimi/çakışmalar kontrol edildi |
| **07** | Terrain Detail & Surface Paint | Erozyon detayları, kayalık/çamur/toprak/ot/kar maskeleri, kıyı/yol boya geçişleri | Kritik yol ve bina yüzeyleri korunuyor |
| **08** | Structure Placeholder Placement | Bina hacimleri, giriş yönleri, bağlantı ve kullanım etiketleri | Parsel uyumu ve giriş erişimi geçerli |
| **09** | Foliage & Rock Distribution | Ağaç, çalı, ot, taş, kayalık instance kümeleri | Yol/su/yapı hariç alanlar boş; yoğunluk bütçesi içinde |
| **10** | Props & Environmental Dressing | Çit, direk, tabela, yük, kasalar, yol ayrıntıları, çevre izleri | Çarpışma ve oynanış alanları kapatılmamış |
| **11** | AI & Navigation Setup | Araç rotası, spawn/navigasyon bölgeleri; gerekiyorsa insan/hayvan aktörleri | Ulaşılabilir/uygun spawn, temel AI hareket testi |
| **12** | Final Lighting, Validation & Optimization | Son ışık, görsel kontrol, sürüş testi, performans/bellek kayıtları, bake/save | Kritik testler geçiyor; açık kusurlar kayıtlı |

### 3.1. Aşama sırası neden böyle?

- **Yerleşimin yeri** erken seçilir; **ev ve sokak yerleşimi** sonradan kesinleşir.
- Nehir ana vadinin ve yolların geometrisini etkilediğinden yolun tamamlanmasını beklemez.
- Yol ve yapı alanları araziyi yerel olarak değiştirir; son detay sculpt/paint onlardan sonra temizlenir.
- **Su birikintileri** çoğunlukla Aşama 04'te potansiyel çukur/nem zonu olarak planlanır; yol drenajı ve paint sonrası Aşama 07/10'da son hâlini alır.
- Büyük kayalıklar ve jeolojik yapılar Aşama 03/07'yi etkileyebilir; küçük/orta kaya dağılımı Aşama 09'da yapılır.
- Görsel atmosfer Aşama 02'de başlatılır fakat son ışık düzeni Aşama 12'de yapılır.

### 3.2. Bağımlılık ve kısmi yeniden üretim

Örnek: Kullanıcı nehir yatağını değiştirirse öncelikle hydrology deform yeniden üretilir. Etkilenen köprü/yol parçaları, kıyı boya maskeleri, kıyı foliage ve props tekrar hesaplanır. Uzak köyler ve elle kilitlenmiş nesneler otomatik silinmez.

Örnek: Köy başka bir yamaca taşınırsa köy parselleri, yol bağlantısı, bina placeholder'ları ve yeni etki alanındaki foliage güncellenir; ana dağ kütlesi zorunlu değilse yeniden üretilmez.

Gerekli mekanizmalar: `dependencyGraph`, `dirtyBounds`, `generatedBy`, `stableId`, `preserveManual`, `previewDiff`, `transactionId`.

---

## 4. Forge'un araç yol haritası — yeni geliştirme önerileri

Öncelikler **P0 (temel)**, **P1 (ilk kullanışlı sürüm)**, **P2 (ileri kalite)** olarak tanımlanmıştır. Bir modülün önerilmesi, Forge'da bugün bulunmadığına ilişkin doğrulanmış iddia değildir; özellikle geliştirilmekte olan modüller kod incelemesiyle eşleştirilmelidir.

### 4.1. P0 — World Builder'ın çalışması için gerekli araçlar

| ID | Araç / modül | Neden gerekli? | Somut ilk işlev |
|---|---|---|---|
| **T01** | **World Recipe + Schema Validator** | AI ve editörün ortak sözleşmesi | JSON şeması, sürümleme, seed, sınır ve referans doğrulaması |
| **T02** | **World Stage Runner / Job Graph** | Çok aşamalı üretimi güvenle çalıştırmak | `plan`, `preview`, `build(stage)`, `validate`, `rollback`, `save` |
| **T03** | **Non-Destructive Terrain Layers** | Yol/su/yapı deformlarını birbirinden ayırmak | Katman açık/kapalı, yeniden üretim, manuel override korunması |
| **T04** | **Spatial Query & Mask Toolkit** | Diğer bütün jeneratörlerin ortak girdisi | Height, slope, aspect, curvature, suya/yola mesafe, exclusion maskeleri |
| **T05** | **Spline Road – Büyük Terrain Entegrasyonu** | Kullanıcının sürdürdüğü geliştirme | Tile sınırlarından geçen spline, yol mesh'i, deform, paint ve collision |
| **T06** | **River / Lake / Pond – Büyük Terrain Entegrasyonu** | Kullanıcının sürdürdüğü geliştirme | Nehir yatağı/kıyı, göl kotu, su birikintisi alanı, bağlı terrain değişimi |
| **T07** | **Stable IDs + Generated Object Ownership** | Tekrar üretimde nesneleri çoğaltmamak | Her üretilen varlığa `recipeId`, `stageId`, `objectId` yazılması |
| **T08** | **World Validation & Diagnostics** | Sessiz bozuk sahne üretimini önlemek | Spline bağlantı, yol eğimi, su/kıyı, collision ve çakışma kontrolleri |
| **T09** | **Asset Catalog Metadata** | AI'ın doğru model bulmasını sağlamak | Asset'e `type`, `biome`, `size`, `tags`, `collision`, `LOD` vb. eklemek |
| **T10** | **Preview / Diff / Bake / Rollback UI** | Manuel editleri koruyarak otomasyonu denetlemek | Üretilen değişiklikleri önce göster; kabul/geri al |

**P0 için teknik notlar:**

- T05–T06, mevcut çalışmaların **yeniden yazılması** anlamına gelmez; API, veri formatı ve World Builder bağımlılıklarına bağlanmasını kapsar.
- Terrain deformasyonunun layer stack ile birleşmesi için bir **yükseklik otoritesi** belirlenmeli: base heightfield + prosedürel katkılar + manual overrides → son surface. Collision ve yüzey sorguları bu son sürümü kullanmalıdır.
- Çok büyük arazi işlemlerinde tüm dünyanın her küçük editte yeniden hesaplanması önlenmeli; **dirty region/tile** tabanlı güncelleme hedeflenmelidir.
- Büyük dünya üretimi hazır diye otomatik olarak **tile seam, yükleme gecikmesi, GPU belleği, collider aktivasyonu** testleri tamamlandı varsayılmaz.

### 4.2. P1 — Üretimin gerçek anlamda akıllı ve kullanışlı olması

| ID | Araç / modül | Önerilen özellikler |
|---|---|---|
| **T11** | **Procedural Macro Terrain Generator** | Birden çok noise türü, sırt/vadi yönleri, plato, dağ zinciri, bölge maskeleri |
| **T12** | **Erosion / Sediment Tools** | Hidrolik/termal erozyon veya düşük maliyetli yaklaşık erozyon, oyulma ve tortu maskeleri |
| **T13** | **Flow / Drainage Analyzer** | Akış yönü, akış birikimi, havza, çukur tespiti; su ve yol drenajına veri |
| **T14** | **Road Cost Map & Route Solver** | Eğime, mesafeye, malzemeye, su geçişine ve araç profiline göre alternatif rota bulma |
| **T15** | **Road Junction & Cross-Section Builder** | Kavşak, kesit genişliği, banket, hendek, yol eğimi, viraj geçişi |
| **T16** | **Bridge / Culvert / Ford Placement** | Köprü, menfez, sığ geçit adayları; yol-su çakışma çözümü, placeholder |
| **T17** | **Shoreline & Wetness Generator** | Göl kıyısı, nehir bankı, ıslaklık, çamurlu kenar ve birikinti maskeleme |
| **T18** | **Settlement & Parcel Generator** | Köy/yol bağlantısı, sokak planı, parsel sınırları, yapı pedleri ve bina girişleri |
| **T19** | **Biome Rules + PCG Scatter** | Eğim/yükseklik/nem/malzeme maskesine göre ağaç, çalı, kaya ve ot dağıtımı |
| **T20** | **Exclusion / Clearance Volumes** | Yol, su, ev girişi, görüş hattı ve oynanış alanlarında obje yasaklama |
| **T21** | **Road & Building Conform Tools** | Yol için cut/fill, bina temeli için flatten/terrace, kenarlarda doğal geçiş |
| **T22** | **Actor/Navigation Authoring** | Araç şeritleri ve rotalar, aktör spawn alanları, insan/hayvan geçilebilir zonları |
| **T23** | **World Overview / Debug Map** | Üstten semantik harita; POI, yol ağı, su, biyom, hata ve dirty-bounds katmanları |

**T13 neden önemli?** Akış ve drenaj analizi olmadan her göl/nehir görünen yüzeye yerleştirilebilir; fakat suyun vadilere ve yolların drenaj ihtiyacına göre davranması zorlaşır. Gerçekçi tam akışkan simülasyonu ilk sürüm için şart değildir. **Editör-side flow analysis** yeterli bir ilk adımdır.

**T14 neden önemli?** Forge Offroad'da yalnız iki nokta arasına eğri çizmek yeterli değildir. Kısa-zor ve uzun-güvenli güzergâh gibi **oynanış açısından farklı seçenekler** üretilmelidir. Maliyet haritası ve araç profili, bu özelliği rastgele çizimden ayırır.

**T18 neden önemli?** Yapılar arazi üzerine rastgele serpiştirilmemelidir. Yola bakan giriş, çakışmasız bina parseli, ulaşılabilir depo avlusu ve uygun temel kotu gereklidir.

### 4.3. P2 — Görsel kalite, ölçek ve gelişmiş otomasyon

| ID | Araç / modül | Önerilen özellikler |
|---|---|---|
| **T24** | **Advanced Biome Blending** | Orman/çayır/kayalık geçişleri, mevsim ve nem bantları |
| **T25** | **Procedural Props / Rule Grammars** | Çit, elektrik direği, taş duvar, yol tabelası, yük istifi, sokak eşyası |
| **T26** | **Cliff / Overhang Mesh Tools** | Heightfield'in üretemeyeceği dik/altı oyuk kaya, mağara ve kaya mesh geçişleri |
| **T27** | **Terrain Material & Physical Surface Map** | Görsel paint'ten ayrı zemin tipi; daha sonra lastik tutuşu/batma/sürtünme sistemine bağlama |
| **T28** | **Water Gameplay Profiles** | Sığlık, akıntı yönü, yüzdürme veya araç için su etkileri; görsel su sisteminden ayrı |
| **T29** | **World Streaming / LOD / HLOD Diagnostics** | Büyük dünya ölçeğinde tile residency, fizik/collider aktivasyonu, instancing ve bütçe görünümü |
| **T30** | **Reference Camera Matching** | Görselin perspektifine yakın kamera seçme, siluet/görüş alanı karşılaştırma |
| **T31** | **Automatic Review Agent** | Render karşılaştırma, hata raporu, sınırlı düzeltme önerileri; kayıt öncesi onay |
| **T32** | **World Templates & Presets** | Alp vadisi, orman köyü, ada, kırsal yerleşim, endüstriyel saha vb. reçeteler |
| **T33** | **World Generation Profiler** | Aşama başına süre, üretilen instance, RAM/VRAM, frame/GPU ve en pahalı bölgeler |

### 4.4. Önce hangi araçları geliştirmek daha değerli?

**Önerilen ilk teknik sıra:**

1. **Recipe + Stage Runner + Stable IDs (T01, T02, T07)** — AI entegrasyonunun ortak temelini kur.
2. **Non-destructive layers + spatial masks (T03, T04)** — bütün terrain işlemlerini güvenle birleştir.
3. **Mevcut yol ve su araçlarını üretim API'sine bağla (T05, T06)** — tek büyük landscape üzerinde uçtan uca test et.
4. **Validation + Preview/Diff (T08, T10)** — başarısız üretimi ve kullanıcı işinin kaybını önle.
5. **Macro Terrain + Flow (T11, T13)** — referanstan coğrafi şekil ve su koridoru oluştur.
6. **Road Solver + Road/Junction/Bridge (T14–T16)** — sürülebilir ağ üret.
7. **Settlement + Biome Scatter (T18–T20)** — level'ı oynanabilir ve görsel olarak tamamla.
8. **AI Reference Planner + Automated Review (T30–T31)** — görselden plan üretme ve sonuç denetimini üst katmana ekle.

**P0/P1/P2 gerçek geliştirme takvimi değildir**; repo incelemesi ve prototip testleriyle yeniden sıralanmalıdır. Daha önce uygulanmış özellikler bu sıralamada yeni kod olarak değil, yeniden kullanılacak yetenek olarak ele alınmalıdır.

---

## 5. Önemli alt sistemlerin teknik gereksinimleri

### 5.1. Landscape ve terrain

- World-space metre ve tile-space koordinat dönüşümleri ortak servis olmalı.
- Height query, normal, slope, curvature ve material query aynı son yüzey sürümünü okumalı.
- Yüzey değişiklikleri dirty bounds oluşturmalı; render, collision, paint ve foliage gerektiğinde yenilenmeli.
- Büyük şekiller için **coarse-to-fine** yaklaşımı: düşük çözünürlükte kütle, sonra daha yüksek çözünürlükte detay.
- Heightfield dik/altı boş geometriyi temsil edemez; cliff/mağara gibi bölgeler için ayrı mesh gerekebilir.

### 5.2. Yol sistemi

- Hem **yol ağı grafı** (bağlantı) hem **spline/mesh geometrisi** (görsel) bulunmalı.
- Segment profili: `roadClass`, `width`, `shoulder`, `surfaceType`, `maxSlope`, `minTurnRadius`, `allowedVehicleClasses`.
- Yol terrain'e uyarken banket, kazı/dolgu ve drenaj etkilerini de üretebilmeli.
- Kavşaklar ayrı işlem görmeli; iki spline'ın çapraz görünmesi otomatik gerçek kavşak sayılmamalı.
- Köprü/menfez/sığ geçit, yol-su çakışmasının semantik çözümü olarak tanımlanmalı.
- Sürüş testi, geometri testinden ayrı olmalı (özellikle ağır yük aracı için).

### 5.3. Nehir, göl ve su birikintisi

- **Nehir:** spline/akış yönü, değişken genişlik, su seviyesi, yatak carve, kıyı blend, geçiş bölgeleri.
- **Göl:** kapalı shoreline, sabit veya tanımlı su kotu, göl havzası, çevre kıyı maskesi.
- **Su birikintisi:** küçük/yerel su maskesi veya su yüzeyi, çukur ve yüzey ıslaklığı; yol drenajı sonrasında dağıtımı güncellenebilir.
- **Ayrım:** Su görselleştirmesi, hydrology planı ve fiziksel su etkileşimi üç ayrı sorumluluktur. İlk aşamada yalnız görsel/authoring hedeflenebilir.
- Terrain spline'ın altından geçiyor diye nehir geometrisi otomatik gerçek hidrolojik bağlantı anlamına gelmez; bağlantı grafı ve akış yönü saklanmalıdır.

### 5.4. Foliage, kayalar ve props

- Scatter girdileri: biome/soil/height/slope/distance-to-road/distance-to-water/exclusion/density.
- Büyük kayalar, ağaç kümeleri, otlar ve küçük taşlar farklı grid/yayılım çözünürlükleri kullanmalı.
- Seçilen yerleştirme `seed` ile tekrarlanabilir, her instance veya cluster stabil ID'ye sahip olmalı.
- Çarpışma gerekiyorsa yakın çevreyle sınırlı aktivasyon ve seyrek collider kullanımı değerlendirilmeli.
- Köy/yol/oynanış alanları ve AI görüş/seyir hatları açık tutulmalı.

### 5.5. Yerleşim ve yapılar

- **Makro:** Köy merkez noktası, yerleşim sınırı, ana yol bağlantısı, yüksekliğe ve su taşkınına göre alan seçimi.
- **Mezo:** Yerel sokak ağı, parsel, ortak alan, depo, servis alanı.
- **Mikro:** Bina placeholder, giriş, temel, kapı önü boşluğu, dekorasyon.
- Fiziksel bina modelleri bulunmuyorsa semantik placeholder kullanılmalı; sonradan model değiştirilince ID ve giriş yönü korunmalı.

---

## 6. Codex / Claude ile çalışma sözleşmesi

### 6.1. AI'ın görevi

AI'ın birincil görevleri:

1. Referansı analiz etmek ve **gözlenen** unsurlarla **tahmin edilen** unsurları ayrı yazmak.
2. Referans ölçeği, coğrafya ve kullanıcı kısıtlarından World Plan önermek.
3. Forge'da mevcut araç/asset kataloglarını sorgulamak; olmayan API veya asset uydurmamak.
4. Sürüm doğrulanmış World Recipe üretmek ve her aşamayı önerilen sıra/bağımlılıkla çalıştırmak.
5. Hata/uyarı raporunu incelemek; kritik kusurları düzeltmek veya kullanıcı onayı istemek.
6. Değişiklikleri ve test sonuçlarını raporlamak.

**AI'ın yapmaması gerekenler:** Var olmayan motor özelliğini çalışıyor saymak; kullanıcı editlerini sessizce silmek; test edilmemiş su/zemin fiziğine dayalı gameplay sonucu bildirmek; referansta görünmeyen yerleri kesin gerçek olarak sunmak.

### 6.2. Önerilen komut yüzeyi — taslaktır, mevcut API değildir

```text
world.inspectCapabilities()
world.inspectAssets(filters)
world.analyzeReference(referencePack)
world.createPlan(constraints)
world.validatePlan(plan)
world.createRecipe(plan, generatorVersions, seed)
world.previewStage(stageId, region?)
world.executeStage(stageId, region?, dryRun?)
world.validate(stageId | "all")
world.diff(transactionId)
world.rebuildAffected(changedObjectIds)
world.commit(transactionId)
world.rollback(transactionId)
world.save(levelId)
```

**Güvenli çalışma sırası:** inspect → plan → dry-run → validate → preview diff → execute → validate → save. Yazma yetkisi ve kapsam sınırlaması editör tarafında uygulanmalıdır.

### 6.3. Önerilen minimal World Recipe şeması

Aşağıdaki JSON gerçek Forge dosya şeması değildir, şema tasarımına başlangıç örneğidir.

```json
{
  "schemaVersion": "0.1",
  "recipeId": "mountain_delivery_demo",
  "seed": 42017,
  "reference": {
    "assetId": "ref_mountain_valley_01",
    "cameraMatch": "approximate",
    "unknownGeometryPolicy": "plausible_fill"
  },
  "world": {
    "units": "meters",
    "size": { "x": 512, "z": 512 },
    "terrainPreset": "mountain_valley"
  },
  "landmarks": [
    { "id": "depot_01", "kind": "logistics", "zone": "valley_low" },
    { "id": "village_01", "kind": "settlement", "zone": "hillside" }
  ],
  "water": [
    { "id": "river_01", "kind": "river", "followValley": true }
  ],
  "routes": [
    { "id": "route_safe", "from": "depot_01", "to": "village_01", "profile": "safe" },
    { "id": "route_short", "from": "depot_01", "to": "village_01", "profile": "challenging" }
  ],
  "generation": {
    "preserveManualOverrides": true,
    "previewBeforeCommit": true,
    "stages": ["terrain", "hydrology", "roads", "settlement", "surface", "scatter", "props", "validation"]
  }
}
```

Burada `512 × 512 m` yalnızca örnek konfigürasyondur; performans veya seçilmiş oyun dünya ölçüsü olarak kabul edilmez.

### 6.4. Codex'e verilecek ilk geliştirme görevi — örnek iş tanımı

> Önce mevcut Forge repo ve `AGENTS.md` kurallarını incele. Landscape, spline, water, foliage, save/load ve mevcut büyük dünya veri yollarını envanterle. Kod değiştirmeden önce mevcut API'leri ve eksikleri belgeleyip önerilen World Recipe/Stage Runner mimarisiyle eşleştir. İlk iterasyonda yalnız veri sözleşmesi, sahne kapasitesi sorgusu, dry-run, stabil ID, üretim sonucu diff ve temel stage validation uygula. Mevcut editör sahnelerini, assetleri ve kayıt biçimlerini bozma. Yeni üretim API'lerini başta sınırlı bir test level'ında, mevcut testlerle birlikte doğrula. Açık dünya ve deformasyonun güncel kod durumunu 23 Ekim raporundan otomatik varsayma; mevcut commit'e göre yeniden kontrol et.

---

## 7. Doğrulama ve kabul kriterleri

### 7.1. Her aşamanın raporu

```text
Stage ID | Input recipe hash | Generator version | Seed
Output object count | Affected tile/region bounds
Warnings | Errors | Elapsed time | Memory observations
Validation result | Manual overrides preserved?
Preview screenshot(s) | Commit ID | Undo / rollback result
```

### 7.2. Önerilen test matrisi

| Test | Beklenen kanıt |
|---|---|
| **WB-01 Determinism** | Aynı recipe/seed/sürümler → aynı sayısal terrain ve obje kimlikleri (tasarım toleransı içinde) |
| **WB-02 Idempotency** | Aynı stage ikinci kez çalışınca sahnede mükerrer obje yok |
| **WB-03 Road Conform** | Yol ile heightfield/collision kopuk değil, araç profili geçerli |
| **WB-04 Water Terrain Fit** | Nehir/göl/su birikintisi ile arazi seviyesi ve kıyı örtüşmeleri tutarlı |
| **WB-05 Cross-Tile** | Spline, su, paint ve foliage tile sınırlarında kopmuyor |
| **WB-06 Settlement Access** | Her zorunlu parsel yola ve görev POI'sine bağlı |
| **WB-07 Scatter Exclusion** | Yol, bina girişi ve su yasak alanlarında büyük foliage yok |
| **WB-08 Manual Preservation** | Kullanıcının kilitlediği/override ettiği öğeler korunuyor |
| **WB-09 Partial Rebuild** | Tek nehir/POI değişikliği sadece bağımlı bölgeleri güncelliyor |
| **WB-10 Save/Reload** | Editor → save → reload → Play akışında referanslar ve nesneler korunuyor |
| **WB-11 Runtime Drive Test** | Offroad aracı en az bir oluşturulmuş rotayı gerçekten geçiyor |
| **WB-12 Performance** | Temsili dünyada FPS/frame, RAM/VRAM, collider ve yükleme maliyeti ölçülüyor |

**Sayı hedefleri:** Harita boyutu, maksimum instance, izin verilen build süresi, minimum FPS ve bellek bütçeleri hedef cihaz ve güncel motor profili ölçüldükten sonra belirlenecektir.

### 7.3. Üretim kalitesi boyutları

- **Yapısal:** Yol, su, POI, yerleşim bağıntıları doğru.
- **Mekânsal:** Çakışma, diklik, su seviyesi, erişim, sınır dikişi doğru.
- **Görsel:** Referans kompozisyonuna ve seçili sanat stiline makul benzerlik var.
- **Oynanış:** Rotalar, yük ve araç profilleriyle anlamlı seçenekler sunuyor.
- **Teknik:** Runtime stabil, kayıt dosyası geçerli, bütçeler ölçülmüş.

---

## 8. İlk prototip: Mountain Delivery World Builder

**Amaç:** Mevcut Forge açık dünya altyapısı ve geliştirilmekte olan spline/su araçları üzerinde **tek bir referans görselden, aşamalı ve düzenlenebilir bir küçük nakliye bölgesi** üretmek.

**İçerik:** Bir vadi, iki yükselti bandı, bir nehir, bir köy placeholder alanı, bir lojistik depo, iki alternatif yol profili, bir köprü/su geçişi, basit orman/kaya dağılımı, en az bir AI/sürüş kontrol rotası.

**Üretim sırası (prototip):**

1. Referans ve semantik plan; 2–3 kontrol noktasıyla kullanıcı değerlendirmesi.
2. World Recipe oluşturma, sahne/terrain setup.
3. Macro terrain ve ilk water corridor.
4. Spline yolların üretimi, terrain conform, köprü placeholder.
5. Köy/depo foundation ve yapı placeholder.
6. Surface paint ve exclusion maskeleri.
7. Foliage/kaya üretimi.
8. Save/reload ve araçla sürüş testi.

**İlk başarı tanımı:** Kullanıcı aynı referansla tutarlı bir level oluşturabiliyor; yol veya köy konumu değiştiğinde etkili bölge güvenle güncelleniyor; manuel override korunuyor; sahne kaydedilip sürülebiliyor. Görselin fotogerçekçi kopyası hedef değildir.

### 8.1. Daha büyük dünya aşaması

İlk deneme başarılı olunca çoklu tile ve uzun mesafeli rota aynı tarif modeliyle denenir. Bu fazda özellikle streamer/LOD, collider aktivasyonu, foliage yoğunluğu, tile sınırı spline/su bağlantıları ve uzun sürüş bellek testi gerekir. Güncel kodda bunların ne kadarının hazır olduğu yeni repo incelemesiyle doğrulanır.

---

## 9. Uygulama fazları ve çıkış kapıları

| Faz | Teslim edilecek iş | Çıkış kapısı |
|---|---|---|
| **F0 — Güncel envanter** | Büyük terrain, deform, spline, su, foliage, save ve runtime test haritası | Her modülün gerçek kapasitesi ve API'si belgelenmiş |
| **F1 — World Recipe çekirdeği** | Şema, stage runner, stable ID, diff, dry-run, rollback | Aynı tarif güvenle tekrar çalıştırılabiliyor |
| **F2 — Terrain + Roads + Water** | Mevcut sistemlerle kısmi deform/paint ve su/yol bağlantıları | Tek test level'ı tekrar üretilebilir; tile sınırları valid |
| **F3 — Spatial Tools + Settlement** | Mask, flow, route solver, kavşak/köprü, parsel/yapı pedi | Yol bağlantıları ve köy yerleşimi doğrulanıyor |
| **F4 — PCG Nature & Props** | Biyom scatter, exclusion, props, asset metadata | Dağıtım tekrar üretilebilir, çakışma kontrolü geçiyor |
| **F5 — AI Director** | Görselden semantik harita/recipe, screenshot karşılaştırma, düzeltme | Referans → test level uçtan uca tamamlanıyor |
| **F6 — Scale/Optimization** | Tile streaming/LOD/QA profiler değerlendirmesi | Seçili hedef cihazda uzun sürüş ve kaynak bütçeleri ölçülmüş |

> Çıkış kapısı karşılanmadan ilgili faz **tamamlandı** sayılmaz. Fazlar bağımlılığa göre paralel ilerleyebilir; takvim ve süre bu belgede taahhüt edilmez.

---

## 10. Açık tasarım kararları

Aşağıdaki konular bilinçli olarak karara bağlanmadı:

1. World Recipe Forge projesinin içindeki hangi dosyada/sidecar'da saklanacak?
2. Katman birleştirme modeli: tam non-destructive çalışma mı, hibrit bake + kaynak recipe mi?
3. Suya ait terrain carve otoritesi ile yol deformasyon sırası ve çatışma çözümü nasıl olacak?
4. Tile başına üretim birimi ve yeniden hesaplama/undo transaction sınırı ne olacak?
5. AI planı için ilk sürümde görsel giriş, semantik harita veya metin+şablon seçeneklerinden hangisi desteklenecek?
6. Referanstan çıkarılan belirsiz bilgiler kullanıcıya hangi UI ile sunulacak?
7. Fiziksel zemin materyali ile görsel paint ağırlığı arasındaki eşleme nasıl tutulacak?
8. Büyük açık dünya için hedef cihaz, dünya boyutu, asset/bellek/FPS bütçeleri nedir?
9. Prosedürel foliage/props output'unun ne kadarı instance, ne kadarı aktör olarak saklanacak?
10. AI'ın write/commit yetkisi hangi onay ve geri alma politikasıyla sınırlandırılacak?

---

## 11. Kaynaklar ve tasarım gerekçesi

**Proje içi dayanaklar**

- `FORGE_OFFROAD_FORGE_TEKNIK_DURUM_RAPORU_2026-10-23.md` — 23 Ekim commit'inde teknik durum; güncel kodun yerine geçmez.
- `FORGE_OFFROAD_GDD_PROJE_CERCEVESI_v0.3.md` — lojistik ve izole dağ yerleşimleri kararları.
- `01_GAME_VISION_AND_PILLARS_v0.2.md` — rota, zemin, yük ve kurtarılabilir sorunlar tasarım ilkeleri.
- 25 Ekim 2026 proje görüşmesi — açık dünya ve deformasyonun güncel kullanımı; spline yol, nehir, göl, su birikintisinin büyük landscape'e entegrasyonu.

**Dış yöntem referansları (Forge'da hazır özellik kanıtı değildir)**

1. SideFX — *Realistic terrain with heightfields*: kütle/massing, noise, erozyon ve çok kademeli çözünürlük akışı.  
   https://www.sidefx.com/docs/houdini/model/terrain_workflow.html
2. SideFX — *Building terrain with height fields*: noise, masks, terrace, erosion ve heightfield katmanları.  
   https://www.sidefx.com/docs/houdini/model/heightfields.html
3. Epic Games — *Landscape Edit Layers*: non-destructive height/paint ve spline/patch katmanları.  
   https://dev.epicgames.com/documentation/en-us/unreal-engine/landscape-edit-layers-in-unreal-engine
4. Epic Games — *Procedural Content Generation Framework*: kurala/uzamsal veriye dayalı prosedürel üretim.  
   https://dev.epicgames.com/documentation/en-us/unreal-engine/procedural-content-generation-framework-in-unreal-engine
5. Epic Games — *PCG Data Types Reference*: heightfield, spline, hacim ve noktaları ortak spatial data olarak ele alma.  
   https://dev.epicgames.com/documentation/unreal-engine/procedural-content-generation-framework-data-types-reference-in-unreal-engine
6. Epic Games — *Water System*: spline tabanlı nehir/göl sistemlerinin landscape ile entegrasyonu.  
   https://dev.epicgames.com/documentation/unreal-engine/water-system-in-unreal-engine
7. Epic Games — *World Partition*: büyük dünya için hücresel veri yönetimi ve streaming yaklaşımı.  
   https://dev.epicgames.com/documentation/unreal-engine/world-partition-in-unreal-engine

---

## 12. Değişiklik kaydı

| Sürüm | Tarih | Not |
|---|---|---|
| **0.1** | 25.10.2026 | World Builder vizyonu, referanstan level akışı, 13 aşama, 33 araç önerisi, teknik mimari, fazlar ve kabul testleri oluşturuldu. Kullanıcının güncel açık dünya/deformasyon ve aktif spline/su geliştirme bilgisi işlendi. |

**Belge bakım ilkesi:** Yeni kesin kararlar ve güncel repo doğrulamaları `Kesin / Kullanıcı bildirimi / Test edildi / Geliştiriliyor / Öneri` durumlarıyla kaydedilir. Kod uygulanmadan araç durumu “tamamlandı” yapılmaz. Bu belge Forge'un genel world building kabiliyetine ayrıdır; Forge Offroad görev ve hikâye GDD'siyle karıştırılmaz.
