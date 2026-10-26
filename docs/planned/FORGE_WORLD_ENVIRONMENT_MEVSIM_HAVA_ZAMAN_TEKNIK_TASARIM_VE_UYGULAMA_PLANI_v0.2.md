# FORGE — WORLD ENVIRONMENT SYSTEM
## Mevsimler, hava olayları, gün–gece döngüsü, kar/ıslaklık birikimi ve çevresel dönüşüm

**Belge:** `FORGE_WORLD_ENVIRONMENT_MEVSIM_HAVA_ZAMAN_TEKNIK_TASARIM_VE_UYGULAMA_PLANI_v0.2.md`  
**Sürüm:** v0.2 — kullanıcı kararları işlenmiş mimari ve aşamalı uygulama planı  
**Tarih:** 26 Ekim 2026  
**Ana ürün:** Genel amaçlı Forge Editor / Forge Engine (web)  
**İlk kabul dünyası:** Forge Offroad — izole dağ yerleşimleri  
**Durum:** **Dört ürün kararı onaylıdır; teknik entegrasyon ve kabul testleri henüz yapılmamıştır.**

> **Karar politikası:** `[ONAYLANDI]` kullanıcı tercihi; `[MİMARİ İLKE]` onaylı World Builder yaklaşımından türetilen tasarım kısıtı; `[ÖNERİ]` uygulama önerisi; `[TEST]` doğrulanması gereken hipotez; `[AÇIK]` henüz kararlaştırılmamış ayrıntı. Bu belge güncel Forge reposunda bir uygulama yapıldığını iddia etmez.

---

## 0. Onaylı kararlar, kapsam sınırı ve tanımlar — 26 Ekim 2026

Dört tercih kullanıcı tarafından açıkça onaylandı. Bunlar **Forge editörünün genel ürün özelliği** için geçerlidir; Forge Offroad'un oynanış kurallarını kendiliğinden değiştirmez.

| ID | Onaylanan tercih | Uygulamaya bağlayıcı etkisi | Durum |
|---|---|---|---|
| **DEC-WES-01 / E-002** | **Kademeli geliştirme:** Önce manuel mevsim/hava seçimi ve çalışan gün–gece döngüsü | İlk kullanılabilir dilimin girişleri manuel; otomatik meteoroloji zorunlu değil | **[ONAYLANDI]** |
| **DEC-WES-02 / E-004** | **Ağaçlarda hibrit yaklaşım:** Materyal + gerekirse mesh varyantı | Asset family birden çok strateji destekler; dört GLB şart değildir | **[ONAYLANDI]** |
| **DEC-WES-03 / E-006** | **Kar fiziği kademeli:** Önce görünüm; sonra ortak veri üzerinden lastik/zemin fiziği | Kar shader'ı araç tutuşunu doğrudan değiştirmez; SurfaceCondition verisi ilerisi için ayrılır | **[ONAYLANDI]** |
| **DEC-WES-04 / E-008** | **Önce masaüstü WebGL2** | İlk teknik kabul masaüstü Chrome/Edge + Forge'un var olan render hattında; mobil ve WebGPU geçişi ayrı | **[ONAYLANDI]** |

**Kapsamın uygulamadaki karşılığı:**

- **İlk kullanılabilir WES teslimi** = mevsim preset seçicisi, manuel hava presetleri, 24 saatlik çalışabilir / durdurulabilir clock, güneş–gökyüzü–aydınlatma tepkisi, **kışın zemin/uygun model görünümlerinin değişmesi**, en az bir yaprak döken ve bir iğne yapraklı ağaç ailesi, değişiklikleri editörde önizleme ve güvenli kayıt. Hava presetleri bu dilimde yağmur/kar için temel görsel efekt ve manuel örtü/ıslaklık parametresi verebilir; ayrıntılı birikim simülasyonu sonraki kapıdır.
- **Sonraki manuel hava dilimi** = yağış yoğunluğu ve parçacıklar, yağış açıkça seçildiğinde kar/ıslaklığın zamana göre artması, kesildiğinde görsel örtünün hemen yok olmaması, erime/kuruma. Otomatik tahmin veya rastgele hava değişimi gerektirmez.
- **Daha sonra** = otomatik takvim-mevsim, kural tabanlı hava geçişleri, bölgesel iklim, büyük dünya durum kalıcılığı, gerçek snow/mud/grip fiziği.

**Ayırıcı kural:** `season = winter` ile `weather = snow` aynı şey değildir. Kış seçilince mevsimsel ağaç ve atmosfer dönüşümü hemen görülür; kar örtüsü kış presetinin yapılandırılabilir başlangıç değeri veya ayrı `snowCoverage` kontrolüyle gösterilebilir. Kış her biyomda zorunlu kar anlamına gelmez. Kar yağışını açmak ise yağış görselini başlatır; karın zamanla birikmesi yalnız ilgili birikim aşaması uygulandıktan sonra otomatiktir.

**Değişmeyen koruma koşulları:** (a) authored terrain paint ağırlıklarını hava önizlemesi değiştirmez; (b) ağaçların kalıcı ID/transform/collision kimliği mevsimle bozulmaz; (c) `Preview`/`Apply`/`Revert` davranışı ayrılır; (d) WES olmayan eski level'lar migration veya açık opt-in olmaksızın görünüm kaybetmez; (e) World Builder'ın diff/override ilkeleri korunur. Bunlar teknik güvenlik ve entegrasyon ilkeleridir; ayrı oyun tasarımı kararları değildir.

---

## 1. Yönetici özeti

**Ana öneri:** World Builder'ın içine özel bir “mevsim efekti” koymak yerine **World Environment System (WES)** adlı, Forge Engine ve Forge Editor'ın genel yeteneği olacak bir sistem geliştirilsin. World Builder, WES'in **dünya ve iklim tanımlarını** üretsin/düzenlesin. WES ise **zaman, hava, mevsim, yüzey etkileri ve mevsimsel varlık dönüşümlerini** çalıştırsın.

Bu yapı şu sonuçları hedefler:

1. Editörde **Kış** seçildiğinde tek işlemle gökyüzü, ışık, bitki örtüsü, zemin ve desteklenen nesneler mevsime uygun görünür.
2. Kar yağmaya başladığında **yağış partikülleri** belirir; karın zemine ve uygun nesnelerin yukarı bakan yüzeylerine **kademeli yerleşmesi** ayrıca yönetilir.
3. Yağmur, gövde/taş/yol üzerindeki **ıslaklık** görünümünü ve yerel birikintileri etkileyebilir.
4. **Gün–gece döngüsü** güneşin ve ortam ışığının yönünü/rengini değiştirir; gece aydınlatmaları bağımsız kurallara göre devreye girer.
5. Yaprak döken ağaçlar ilkbahar tomurcuklanma, yaz dolgun yaprak, sonbahar renkleri, kış yapraksız silüet gibi **asset-family varyantlarına** sahip olabilir. İğne yapraklılar farklı davranabilir.
6. Görsel zemin örtüsü, hava sistemi ve **fiziksel zemin tepkisi** ortak veriler kullanır fakat birbirine eşitlenmez; kar/çamur lastik etkisi ayrı ve test edilebilir kalır.
7. Mevsim değiştirmek **World Builder'ın authored terrain paint verisini** veya kullanıcının elle koyduğu objeleri silmez; çevre katmanı bunların üzerine non-destructive uygulanır.

**En güçlü öneri:** Mevsim, hava ve birikim için **tek bir “kış shader'ı”** geliştirmeyelim. **İklim/WeatherState → Surface State → Render ve Physics Consumers** ayrımını yapalım. Böylece sistem Forge Offroad dışındaki oyunlarda da kullanılabilir.

---

## 2. İncelenen proje kaynakları ve bugün bildiklerimiz

### 2.1. Son World Builder planı (asıl bağlayıcı bağlam)

- **Belge:** `FORGE_WORLD_BUILDER_TASARIM_VE_TEKNIK_PLAN_v0.1.md`, 25 Ekim 2026.  
  Drive: https://drive.google.com/file/d/1V1Tdqo6UwTk0mtyYGGku_AzojAGrOwsH/view?usp=drivesdk
- Genel amaçlı, AI destekli World Plan / World Recipe / Stage Runner; `dirtyBounds`, `stableId`, `generatedBy`, `preserveManual`, `previewDiff` gibi **non-destructive** ilkeler öneriliyor.
- On üç aşamalı akışın **02 Scene & Environment Setup** adımı güneş/skylight/gökyüzü/bulut/sis kurulumunu içeriyor; **07 Surface/Biome Paint** ve **09 Foliage/Rock Distribution** bu sistemin doğal entegrasyon noktaları.
- **T24 Advanced Biome Blending** içinde mevsim bantları anılıyor; fakat ayrı Weather/Time/Season runtime mimarisi henüz tarif edilmiyor.
- **T27** görsel arazi katmanından ayrı fiziksel zemin haritasını öneriyor. Bu ayrım WES için kritik.
- Plan, büyük terrain ve deformasyon hakkında 25 Ekim kullanıcı bildirimini daha güncel kabul ediyor; mevcut kod, test ve donanım performansı bu görüşmeyle bağımsız doğrulanmış değil.

### 2.2. Önceki teknik envanterin güvenilir ama tarihli bilgileri

Kaynak: `FORGE_OFFROAD_FORGE_TEKNIK_DURUM_RAPORU_2026-10-23.md` (23 Ekim'de incelenen commit `84ff7cf...`, Forge güncel başı için otomatik geçerli sayılmaz).

| Alan | 23 Ekim teknik raporunda görülen temel | Bugünkü uygulama değerlendirmesi |
|---|---|---|
| Three.js | `0.184.0`, `WebGLRenderer`, WebGL2 | WES ilk prototipi için mevcut teknolojiyle uyumlu; güncel sürüm yeniden doğrulanmalı |
| Editör/engine | TypeScript + Vite; editor/runtime ayrımı | WES motor capability'si + editor paneli biçiminde tasarlanmalı |
| Landscape | Grass/dirt/rock/snow görsel katmanları; yeni tiled terrain ağırlıkları | Kar var olan paint'in yerini otomatik almış kabul edilmez; shader/overlay tasarlanmalı |
| Foliage | Instancing, chunk ve mesafe culling | Mevsimsel family grouping ve görünür cluster güncellemeleri eklenebilir |
| Hava/ışık | Sky/fog/cloud sahne ayarlarının varlığına dair kanıtlar | Genel mevsim + hava otomasyonu **hazır kabul edilemez** |
| Yüzey fiziği | Lastik tutuşu görsel paint katmanına bağlanmış değil | Görsel kar ile kayganlık ayrıca modellenmeli |
| Save | Level/asset tanımları + oyun save/load temeli | WES saat, hava ve birikim kalıcılığı için yeni şema gerekiyor |

**Önemli güncellik uyarısı:** 23 Ekim raporunda multi-tile renderer/streaming entegrasyonu kısıtlıydı; 25 Ekim World Builder belgesi ise açık dünya yetenekleri üzerinde güncel çalışma ve kullanıcı bildirimini kaydediyor. **Bu araştırma, güncel repository'yi çalıştırıp test etmediği için “hazır” / “eksik” hükmünü eski commit'ten bugüne otomatik taşımıyor.**

### 2.3. Forge Offroad ile ilişkisi

Offroad'un kesinleşmiş çekirdeği lojistik ve taşımacılık / izole dağ yerleşimleridir. Kışın kapanan rota, yağmurda çamur, güneşten sonra erime, hava tahminine göre teslimat kararı bu deneyimi güçlendirebilir. Ancak **bu gameplay fikirleri onaylanmış GDD kararı değildir.** WES motor özelliği, Offroad görevi/ekonomisi ile karıştırılmamalı.

---

## 3. Dış teknoloji araştırması: motorlar ve web ekosistemi

### 3.1. Unreal Engine: ayrı katmanları materyalde birleştirme

Unreal Engine Landscape Materials, weight ve alpha blend'i birlikte kullanabiliyor; böylece var olan çim/toprak materyalinin üzerinde ayrı bir kar örtüsü görsel olarak karıştırılabiliyor. Epic'in **Layered Materials** örneği, karı yüzeyin yukarı bakan bölgelerine `WorldAlignedBlend` benzeri yönelim hesabıyla uyguluyor. WES için çıkarım: **Kar = boyanmış grass/dirt/rock katmanını silip snow'a çevirmek değil, dinamik örtü değerinin üstten katkısı.**

- Kaynak: https://dev.epicgames.com/documentation/unreal-engine/landscape-materials-in-unreal-engine
- Kaynak: https://dev.epicgames.com/documentation/unreal-engine/creating-layered-materials-in-unreal-engine

Unreal'ın Sky Atmosphere + Volumetric Cloud sistemleri atmosfer ve günün saatiyle ilişkili gök sunumu sağlıyor. Ancak bu yaklaşımı WebGL2'ye aynen taşımak gerekmiyor: gerçek volumetric raymarch pahalı olabilir. **Önce daha ucuz parametrik gökyüzü ve bulut katmanları** hedeflenmeli.

- Kaynak: https://dev.epicgames.com/documentation/unreal-engine/sky-atmosphere-component-in-unreal-engine
- Kaynak: https://dev.epicgames.com/documentation/unreal-engine/volumetric-cloud-component-in-unreal-engine

### 3.2. Unity: terrain/vegetation ve özelleştirilmiş shader yolu

Unity Terrain dokümanı, **terrain tiles**, **paint layers**, **ağaç/çim dağıtımı**, **wind zones** ve özel terrain shader'larını ayrı araçlar olarak sunuyor. Shader Graph ile çok katmanlı arazi materyalleri üretilebiliyor. Çıkarım: mevsim sistemi tek başına bir shader değil; arazi, bitki, rüzgâr ve çevre modüllerinin eşgüdümü.

- Kaynak: https://docs.unity.com/en-us/engine/6000.5/manual/creating-environments/script-terrain
- Kaynak: https://docs.unity.com/en-us/engine/7000.0/manual/creating-environments/script-terrain/terrain-shader-graph

### 3.3. Three.js / tarayıcı: teknik olanaklar

**WebGL2 (ilk uygulama):** Three.js `WebGLRenderer` WebGL2 kullanıyor; malzemeler `onBeforeCompile()` ile özelleştirilebiliyor, `DataArrayTexture` gibi texture-array araçları bulunuyor. `InstancedMesh` aynı geometry/material'a sahip çok sayıdaki ağacın draw call maliyetini azaltır. `Sky`, `FogExp2` ve gölge araçları zamanla değişen atmosfer/aydınlatma için kullanılabilir.

- https://threejs.org/docs/pages/WebGLRenderer
- https://threejs.org/docs/pages/Material.html
- https://threejs.org/docs/pages/DataArrayTexture.html
- https://threejs.org/docs/pages/InstancedMesh
- https://threejs.org/docs/pages/Sky.html
- https://threejs.org/docs/pages/FogExp2.html

**WebGPU (ileride / deneysel):** Three.js `WebGPURenderer`, desteklenmezse WebGL2 backend'ine geri dönebilir; TSL/NodeMaterial ile daha esnek shader yazımı sağlıyor. Ancak mevcut **WebGLRenderer + `onBeforeCompile` shader kodu doğrudan taşınamıyor** ve renderer hâlâ uyumluluk/perf doğrulaması gerektiriyor. MDN WebGPU'yu tüm yaygın tarayıcılarda temel destek seviyesine ulaşmamış (not Baseline) olarak tanımlıyor. **WES'in v1 şartı WebGPU olmamalı**; renderer'dan bağımsız simülasyon verisi ve değiştirilebilir shader adaptörü tasarlanmalı.

- https://threejs.org/manual/pages/webgpurenderer
- https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API

**Asset varyantları:** Khronos'un `KHR_materials_variants` glTF uzantısı ortak geometri üzerinde hazır materyal varyantları tanımlar; Three.js GLTFLoader için ayrıca kayıtlı plugin desteği vardır. Bu, bir ağacın **aynı geometri / farklı yaprak dokusu** türünde işe yarar. **Kışın yaprakları dökülmüş farklı silüet** için yeterli değildir: ayrı mesh/LOD veya özel geometri gizleme gerekir.

- https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_variants/README.md
- https://threejs.org/docs/pages/GLTFLoader.html

**Varlık aktarımı:** KTX2/BasisU ile sıkıştırılmış dokular mevsim varyantlarının download/VRAM maliyetini azaltabilir; kalite ve format cihazlarda test edilmeli.

- https://threejs.org/docs/pages/KTX2Loader.html

**Sonuç:** Web için `zaman + hava + çevre görünümü` yapılabilir; ancak kaliteli **bölgesel birikim, birden çok orman varyantı, fizik etkileşimi, büyük dünya** paketinin hedef cihazlarda performansı ancak prototiple doğrulanabilir. Piyasada tek bir hazır Three.js komponentinin Forge'a bu uçtan uca sistemi sorunsuz entegre edeceği varsayılmamalı.

---

## 4. Önerilen sistem sınırları ve veri akışı

```text
[WORLD BUILDER / authored world]
  Biyom + rakım + eğim + terrain paint + su + roads + asset catalog
                           │
                           ▼
[CLIMATE PROFILE]    [WORLD CLOCK]    [WEATHER DIRECTOR]
  sıcaklık bantları     tarih/saat        açık/yağmur/kar/sis
  yüksekliğe bağlı      gün uzunluğu      yoğunluk/rüzgâr
  iklim kuralları       mevsim fazı       geçişler/seed
            └──────────────┼──────────────┘
                           ▼
                 [ENVIRONMENT STATE]
          tarih • sıcaklık • güneş • yağış • rüzgâr
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
 [SURFACE STATE]   [ASSET PHENOLOGY]   [ATMOSPHERE]
  snow depth       tür/ağaç varyantı    sky/sun/moon
  wetness          ot yoğunluğu         clouds/fog
  ice optional     foliage tint         precip particles
           │               │               │
     ┌─────┴────┐          ▼               ▼
     ▼          ▼    [ASSET ADAPTER]   [RENDER ADAPTER]
 [RENDER]    [SURFACE PHYSICS PROVIDER]
  snow blend    grip/sink/resistance [ayrı test ve kabul]
     │          │
     └─────┬────┘
           ▼
       [GAMEPLAY]
      Offroad, diğer oyunlar (opsiyonel)
```

**Sahiplik kuralı:** WES **hava ve yüzey durumunun** otoritesidir. World Builder authored arazi/biome otoritesidir. Araç sistemi wheel-contact fiziğinin otoritesidir. Shader yalnız görünüm üretir, gameplay zemin durumu üretmez.

### 4.1. Servisler, sahiplik ve aşama hedefleri

| Servis | Sorumluluk | İlk teslim noktası |
|---|---|---|
| `WorldClock` | Clock/time scale/pause; editor scrub ve Play zamanı | **K1** |
| `EnvironmentDefinition` | Level varsayılanları, açık schema, presetler | **K0–K1** |
| `ManualWeatherController` | Açık/bulutlu/yağmurlu/karlı/sisli seçim ve yoğunluk | **K1** |
| `AtmosphereAdapter` | Güneş, mevcut sky/fog/light kontrolü; geometriyi bilmez | **K1** |
| `SeasonalMaterialAdapter` | Terrain authored paint üzerinde kar/ıslaklık görünümü | **K2** |
| `SeasonalAssetResolver` | Hibrit materyal / mesh varyantı / eksik fallback | **K2** |
| `PrecipitationRenderer` | Manuel hava presetinin yakın kamera yağış VFX'i | **K3** |
| `SurfaceConditionSystem` | Görsel kar/ıslaklık birikim ve erime değerleri | **K3** |
| `EnvironmentPersistence` | Level default ve Play snapshot sözleşmeleri | **K2** (level), **K4** (runtime state) |
| `WorldBuilderEnvironmentAdapter` | World Recipe, biome masks, staged preview/rebuild | **K4** |
| `AutomaticWeatherDirector` | Kurallı/rastlantısal hava ve takvim etkileri | **K5** (ayrı genişletme) |
| `SurfacePhysicsProvider` | Kar/nem durumunun sürüş fiziğine bağlanması | **K6** (ayrı kabul) |
| `EnvironmentEditorPanel` | Preset, saat, hava yoğunluğu, kar örtüsü, Apply/Revert/debug | **K1–K3** |

`K0–K6` bu dokümana ait uygulama kapılarıdır. Önceki `P0/P1/P2` mimari önem sınıfıyla birebir eşlenmez. Kod adları ve dosya yolları **öneridir**, bugün Forge'da bulunduğu iddia edilmez.

**Veri yönü:** `EnvironmentDefinition` (level / authored default) → `EnvironmentRuntimeState` (clock + manual selection) → render consumers. K3'te buna `SurfaceConditionState` eklenir. Physics consumer K6'ya dek yalnız okuma amaçlı sözleşme alır veya hiç bağlanmaz; mevsim materyal adapter'ından araç fiziğine gizli side effect oluşmaz.

---

## 5. Mevsim sistemi: biyom ve canlı varlıkların dönüşümü

### 5.1. `season` tek bir sabit enum olmamalı

Editörde `spring / summer / autumn / winter` **hızlı preview seçimi** bulunabilir. Runtime'da ise `seasonPhase` (0..1 yıllık ilerleme), sıcaklık, gün uzunluğu, rakım, biyom ve tür fenolojisi gibi değerler daha doğal sonuç verir. Örneğin vadide sonbahar rengi varken yüksek rakımda ilk kar başlayabilir. Bu özellik ilk prototipte zorunlu değildir; **veri şeması buna engel olmamalı**.

Ayrım:
- **Season calendar:** takvim üzerinde dönem; UI'de “Kış” seçmek.
- **Climate:** aynı mevsimde dağ/kıyı/çölün farklı olması.
- **Phenology:** türün yapraklanma, renk değiştirme, dökülme davranışı.
- **Weather:** bugün kar yağıyor mu? Mevsimden bağımsız, fakat iklimce sınırlandırılabilir.
- **Surface condition:** dün yağan karın bugün yerde kalıp kalmadığı.

### 5.2. Ağaç ve bitki türleri — varlık ailesi

Her `TreeFamily` semantik kimliğini, yerleşimini, ölçeğini ve gameplay/collision kimliğini korur; görünümü koşullara göre seçilir:

| Varlık | İlkbahar | Yaz | Sonbahar | Kış | Uygulama tercihi |
|---|---|---|---|---|---|
| Yaprak döken ağaç | Tomurcuk/açık yeşil | Yapraklı | Sarı/turuncu/kızıl | Çıplak dallar | Yaz/sonbahar materyali + gerekirse bahar/kış mesh varyantı |
| İğne yapraklı | Yeşil | Yeşil | Yeşil | Yeşil + kar | Aynı mesh, kar shader/örtü maskesi |
| Çalı | Yeni yaprak | Yoğun | Renk/dökülme | Seyrek | LOD/küçük mesh varyantı |
| Çim | Taze ton | Yoğun yeşil | Sararmış/seyrek | Solmuş, kar altında gizlenebilir | Seasonal tint + density/height parametresi |
| Kaya | Aynı taş | Aynı taş | Islaklık | Kar, buz | Aynı mesh, material overlay |
| Yapı/çatı | Normal | Normal | Islaklık | Yukarı bakan yüzeyde kar | Materyal maskesi + roof profile |

**Kesin teknik ayrım:** Yalnız materyal renk değişimi **yaprak kaybolması** veya **dal silüeti** oluşturmaz. Eğer kışın yapraksız görünüm önemliyse uygun kış mesh'i veya yaprak mesh görünürlüğü/geometry variant gerekir.

Önerilen metadata:

```json
{
  "assetFamilyId": "tree_deciduous_01",
  "biomes": ["temperate_forest", "alpine_foothill"],
  "phenology": "deciduous",
  "variantStrategy": "hybrid",
  "baseMesh": "tree_deciduous_summer.glb",
  "materialVariants": { "spring": "fresh_leaves", "autumn": "golden_leaves" },
  "meshVariants": { "winter": "tree_deciduous_bare.glb" },
  "snowProfile": { "accept": true, "retention": 0.7 },
  "windProfile": "tree_medium",
  "collisionPolicy": "stable_trunk",
  "lodFamily": "deciduous_01_lod"
}
```

Bu **yeni şema önerisidir**; Forge manifest biçimi değildir. Materyal varyantlarının anahtar/değer yapısı gerçek asset katalog şemasına göre belirlenecektir. Onaylı tercihe göre her ağaç için 4 ayrı GLB zorunlu değildir: family bazında `material-only`, `mesh-swap`, `hide-leaf-submesh`, `none` seçenekleri gereklidir.

### 5.3. Instancing ile mevsim değişimi

- Aynı model/material/LOD'a ait instancelar bucket halinde çizilir.
- Sonbahar renk tonu basit `instanceColor` ile yapılabilir; tür bazlı varyasyon için per-instance parametre de eklenebilir.
- Kış geometri varyantı gerekiyorsa **eski bucket'tan yeni geometry bucket'ına** üyelik aktarılır, konum/stable ID değişmez.
- Uzak foliage için fade/dither veya mesafeye göre toplu değiştirme kullanılır; aynı anda tüm dünya için her ağacın mesh'i yeniden oluşturulmaz.
- Shader uniform/parametreyle değişebilen malzemeler için bütün instanceların transform matrislerini her frame güncellemek gerekmez.
- Season change sırasında asset manifest/preload, GPU bellek ve LOD uyumu test edilir.
- Kış varyantı tanımsızsa güvenli fallback + editor validation uyarısı: “seasonal asset missing”, sessizce başka tür ağaç koyma.

---

## 6. Kar yağışı ve çevresel birikim: en kritik teknik tasarım

### 6.1. Kar yağışı ≠ kar örtüsü ≠ karlı zemin fiziği

1. **Precipitation VFX:** Kamera çevresinde görülen düşen kar taneleri.
2. **Snow cover:** Terrain ve 3D nesnelerin uygun yüzeylerine ne kadar karın oturduğu.
3. **Snow depth:** Bir bölgede biriken karın kalınlık/yoğunluk gibi simülasyon değeri.
4. **Surface physics:** Lastik tutuşu, yuvarlanma direnci, batma, iz ve erime etkisi.

K2–K3 görsel dilimlerinde VFX ve kar örtüsü yapılabilir; gerçek zeminde batma daha sonra bağımsız teste alınabilir. Birinin varlığı diğerini **kanıtlamaz**.

### 6.2. Terrain materyaline kar geçişi: silme değil shader blend

**Önerilen katman modeli:**

```text
Authored terrain weights (grass/dirt/rock/mud...)   [KALICI]
                     +
Climate/season suitability mask                     [DÜNYA TANIMI]
                     +
SnowCoverage/SnowDepth field                        [DİNAMİK]
                     +
Slope/normal/altitude/wind shadow/no-snow mask       [UZAMSAL]
                     =
Final visible snow blend                             [RENDER]
```

Örnek (tasarım formülü, fiziksel doğruluk iddiası değildir):

`visibleSnow = saturate(coverage * upwardFacing * altitudeFactor * materialAcceptance * exclusionMask)`

Burada `upwardFacing = smoothstep(thresholdLow, thresholdHigh, dot(worldNormal, worldUp))` bir yaklaşım olabilir. `coverage` ise yağış/erime sonrası kar durumundan gelir. Böylece dik kaya yüzeyleri daha az, plato/çatı üstleri daha çok kar alır.

**Materyal geçişi yalnız albedo/renk karışımı değildir.** Uygun normal, roughness, detay doku, mikro-gölge ve sahne aydınlatması da düşünülmelidir. Uzaktan geniş kar yüzeyi ile yakındaki tekerlek temas alanı aynı detay çözünürlüğünü kullanmak zorunda değildir.

**Boyama politikası:** `snow` kullanıcının kalıcı olarak fırçayla boyayabildiği authored materyal de olabilir; ayrıca mevsim/yağışla gelen **dynamic snow overlay** ayrı tutulmalıdır. Editörde eskiden boyanmış `snow` layer'ını dinamik sistemin çarpışan otoritesi yapma. `BasePaint` ve `WeatherCover` ayrı kalır.

### 6.3. Ağaç, kaya, çatı ve araçlara kar

- Kar kabul edebilen mesh materyaline dünya-space normal ve global snowCoverage parametresi uygulanabilir.
- Tür/nesne bazında `snowProfile`: `accept`, `retention`, `steepness`, `exposed`, `excludeParts`, `meltRateFactor`.
- Çatı/kaya üst yüzeyleri için world-normal maskesi makul v1 çözümüdür; gerçek gölgelenme/saçak altı kar birikimi için gelişmiş occlusion maskesi sonraya bırakılabilir.
- Ağaç dallarında uniform shader bazı bölgeleri yanlış beyazlatabilir. Mümkünse **artist-authored snow mask** veya kış asset'i kullanılır.
- Hareketli araçların üstüne kar birikimi statik çevreden farklıdır; ilk sürümde yalnız basit sahne efekti veya kapalı özellik olabilir.
- Kar yığınlarının fiziksel hacim oluşturması, mesh displacement ve collider yeniden üretimi **ilk sürüm kapsamı değildir**.

### 6.4. Bölgesel karın zamanla birikmesi ve erimesi

Önerilen durum alanları:
- `snowWaterEquivalentMm` **veya** daha sade `snowDepthCm` (hangi birimin otorite olacağı açık karar).
- `wetness01` (0..1);
- `temperatureC`, `precipitationMmPerHour`, `precipitationType`;
- `lastSimulatedAt`, `regionSeed`, `surfaceProfile`.

**Örnek yaklaşım (parametreler kalibrasyon gerektirir):**

```
newSnow = snowfallRate * dt * retentionFactor
melt = max(0, temperatureC - meltThreshold) * meltCoeff * dt
snowDepth = clamp(snowDepth + newSnow - melt, 0, maxDepth)
wetness = clamp(wetness + rainContribution + meltwater - evaporation, 0, 1)
```

Bu formül gerçek hidroloji modeli değil; oynanış odaklı ve deterministik bir ilk modeldir. Saat çok hızlandırılırsa `dt` artışını alt dilimlere bölmek veya analitik/kapalı-form güncellemek gerekir; **60 FPS'e bağlı simülasyon olmamalı**.

### 6.5. Bölgesel / streamed dünya veri yaklaşımı

- Tüm dünya için per-frame kar texture güncellemesi **yapılmasın**.
- `climate` ve `weather` global veya coarse region düzeyinde tutulabilir; küçük ölçekli `surface condition` **terrain tile/region** bazında okunur.
- Uzak tile için son hesaplanma zamanı + dünya hava geçmişi/sade istatistiklerle birikim **lazy catch-up** yapılır. Aşırı hava geçmişi saklamanın maliyeti belirlenecek.
- Tile etkinleştiğinde soğuk/kar durumuna göre son görünüm hesaplanır; oyuncu geldiğinde “bir anda boyanan kare kar” görülmemesi için spatial edge blend yapılır.
- Render overlay maskeleri ve fiziksel durum kaynakları aynı `tileId` ile eşleşir; kaynak çözünürlükleri farklı olabilir.
- Bir region'daki değişiklik diğer tile'ın authored paint verisini değiştirmez.

**Basit bellek büyüklüğü örneği:** 256×256 tek kanallı `R8` alan = 65.536 byte ≈ 64 KiB (mipmap/driver/metadata hariç). Aynı boyutta `R16` = 128 KiB. 100 aktif tile için yalnız birer R8 maske ≈ 6,25 MiB olur; bu **GPU upload, mipmap, diğer haritalar ve tüm oyun belleği hesabı değildir.** Dünya ölçeğinde toplam aktif tile sayısı profille belirlenmelidir.

---

## 7. Yağmur, ıslaklık, sis, bulut, rüzgâr ve fırtına

### 7.1. Yağmur

**MVP:** kamera odaklı yağmur görselleştirmesi + yağış sesi + bulut/ışık/sis + yüzeyde ıslaklık parametresi. Albedo hafif karartma, roughness azaltma, uygun normal/puddle katkısı materyal profillerine göre yapılır; tüm materyallere aynı katsayı körlemesine uygulanmaz. Şeffaf partiküllerde overdraw ölçülür; düşük kalite profilinde yoğunluk ve yarıçap azaltılır.

**P1/P2:** local yağış zonları, akış/drenaj maskeleri, yağmur sonrası birikintiler, nehir seviyesi gibi özellikler World Builder'ın T13/T17 hydrology sonuçlarıyla bağlanabilir. Gerçek akışkan simülasyonu gerekmez.

### 7.2. Sis ve bulut

- **İlk basamak:** parametrik sky + bulut kaplama/katman + `Fog`/`FogExp2`; sis renk ve yoğunluğu hava/ışıkla senkron.
- **İleri kalite:** ground fog volumes, altitude fog, seçili sahnelerde cloud shadow cookie/projection. Volumetric cloud raymarch başlangıç performans hedefi için zorunlu olmasın.
- Büyük dünyada düz `FogExp2` tüm topoğrafyayı aynı biçimde gizler; yerel vadi sisi için hacim veya world-space yoğunluk fonksiyonu gerekebilir.

### 7.3. Rüzgâr

Tek bir `windVector` (yön/hız/gust) çıktısını foliage animation, precipitation tilt, partikül, ses ve gerekirse gameplay tüketir. Farklı sistemlerin bağımsız rastgele rüzgâr üretmesi önlenir. Fiziksel araca rüzgâr kuvveti ilk etapta zorunlu değildir.

### 7.4. Fırtına

İleri basamakta yağmur yoğunluğu, şimşek görseli, gecikmeli gök gürültüsü ve rüzgâr darbeleri. Şimşeğin tüm objelere gerçek dinamik ışık ve gölge oluşturması pahalı olabilir; quality-dependent uygulanmalı. Rastgele tehlike/mekanik etkileri sadece oyun kurallarında etkinleştirilsin.

---

## 8. Gün–gece döngüsü, güneş, ay ve aydınlatma

### 8.1. Zamanın otoritesi

`WorldClock` simülasyonun saat/tarih/yılını tutar. Editor içinde `hour` slider'ı ile “06:00/12:00/18:00/23:00” önizlemesi yapılır. Runtime'da zaman akışı isteğe bağlı hızlandırılabilir veya sabit kalabilir. Tam coğrafi astronomi v1 şartı değildir.

Öneri: iki mod:

- `artDirected`: kullanıcı sunrise/sunset, gece uzunluğu, güneş yörüngesi sınırlarını kontrol eder.
- `astronomical` (P2): enlem/gün/tarih tabanlı güneş konumu; gerçekçiliğe ihtiyaç duyulursa.

**Önemli:** Mevsimsel gün uzunluğu ve güneş açısı desteklenebilir, fakat “Kış = her yerde aynı kısa gün” diye global sabit konmamalı.

### 8.2. Render etkileri

1. Sun directional light vektörünü saat/güneş elevasyonuna göre güncelle.
2. Sky renk/turbidity atmosfer parametrelerini ve ambient/fill'i güncelle.
3. Fog rengini ortamla senkron tut; gece göz alıcı parlak beyaz sis olmasın.
4. Shadow update cadence: güneş yavaş değiştiği için bütün gölgeleri her küçük değişimde en pahalı yoluyla zorla yeniden derleme.
5. Emissive/yerleşim sokak ışıkları oyun dünyası kurallarıyla gece açılır; asset metadata `nightLightingProfile` ile kontrol edilebilir.
6. Bulut/rüzgâr/yağış ve exposure/tone mapping tek koordinatör tarafından uyumlu güncellenir.
7. Kamera değiştikçe yakın/uzak gölge kalitesi; varsa CSM çözümü ayrı spike'ta değerlendirilir. Mevcut Forge'da CSM varmış gibi davranma.

### 8.3. Editör ve runtime ayrımı

Editörde `Preview Weather / Preview Time / Preview Season` değişiklikleri **geçici** olabilir; kullanıcı “Apply to level” yapınca varsayılan environment profile güncellenir. Play modunda zaman ve hava akarken editörün authored verisi istemeden kaydedilmez.

---

## 9. Görsel zemin ve gerçek zemin davranışı: Offroad entegrasyonu

Mevcut örnek risk: Kışın bir yolun beyaz görünmesi, lastik sürtünmesinin kendiliğinden değiştiği anlamına gelmez. Tersine kuru bir doku üzerinde görünmeyen buz olabilir.

**Önerilen iki kanallı sorgu:**

```ts
// PSEUDOTYPE — mevcut API değildir.
interface SurfaceQueryResult {
  baseSurface: 'rock' | 'dirt' | 'mud' | 'grass' | 'road' | string;
  snowDepthCm: number;
  wetness01: number;
  ice01: number;
  temperatureC: number;
  deformation?: { rutDepthCm: number; compaction01: number };
}

// Fizik bağı: query(worldPosition, wheelFootprint) -> gameplay surface response
// Render bağı: aynı state'i materyal maskesi + shading ile yorumlar.
```

Önerilen zemin sınıfları başlangıçta **kuru sert / ıslak sert / kuru toprak / çamur / taze kar / sıkışmış kar / buz** olarak kıyaslanabilir. Ama katsayılar kullanıcı oynanış hedefleri ve testlerle seçilir; literatürden oyun içine gelişigüzel sürtünme sayısı kopyalanmaz.

**Öncelik kuralı:** Görsel overlay, fizik katmanının girdisi olmasın. Fizik ve render aynı `SurfaceConditionState`'i okusun. Sürülen lastik izi/deformasyon alt sistemi ayrı varlığını korur. Kar üstüne lastik izi, kar sıkışması ve altından çamur çıkması ileri aşama entegre testi olmalıdır.

### 9.1. Offroad için değerli deney senaryosu [ÖNERİ]

Aynı dağ teslimat yolu:
- yaz, kuru zemin;
- sonbahar, yağmurdan sonraki ıslak/çamurlu zemin;
- kış, yeni kar;
- kış, eski/sıkışmış kar.

**İlk kabul:** 4 sahnenin görsel durumu anlaşılır, geçişte authored yolu/köyü silmez ve save/reload tutarlıdır. **İkinci kabul:** lastik etkileri ayrı testler ile farklı ve tutarlı sonuç verir. İlkinden ikinciyi otomatik geçmiş sayma.

---

## 10. World Builder entegrasyonu ve veri sözleşmesi

### 10.1. 13 aşamalı plana yerleştirme

World Builder v0.1'deki **Stage 02 — Scene & Environment Setup** WES'in iklim/saat/hava taslak verilerini açar; **Stage 07 — Terrain Detail & Surface Paint** biome/kar tutma/ıslaklık maskesi kaynaklarını üretir; **Stage 09 — Foliage & Rock Distribution** mevsimsel asset family seçimini yapar; **Stage 12 — Final Lighting, Validation & Optimization** çevre preview ve kabul testlerini tamamlar. Bunların hepsi yeni stage yaratmak zorunda değildir.

| World Builder aşaması | WES girdisi/çıktısı | Değişiklik yetkisi |
|---|---|---|
| **02** | `EnvironmentDefinition` taslağı, preset, başlangıç saati ve manuel seçilen mevsim | WES authored defaults |
| **07** | Yükseklik/eğim/biyom/yol exclusion gibi birikim uygunluk maskeleri | World Builder'ın semantik kaynak maskeleri; WES yalnız okur |
| **09** | `assetFamilyId`, phenology, mesh/material varyantları | World Builder yerleşimi; WES görünüm çözümleme |
| **12** | Kış/yaz/gece/yağmur sahne doğrulaması ve performans | WES preview; World Builder commit/validation |

`WorldBuilder.rebuildAffected(...)` maskeyi/asset family metadata'yı yeniden oluşturduğunda WES yalnız etkilenen bounds/instances üzerinde görünümü yeniden hesaplar. Dünya jeneratörünün manuel overrides verisi WES tarafından silinmez. WES render state'i World Builder terrain kaynak verisine geri yazılmaz.

### 10.2. Önerilen katman ve otorite sırası

```text
[Authored: base heightfield + authored paint + road/water masks + foliage IDs]
                               |
                  [World Builder / read-only outputs]
                               |
           [Environment definition + manual clock/weather/season]
                               |
                 [Surface condition overlay state]
                               |
       [Terrain/foliage/asset/sky material and lighting adapters]
                               |
                        [Rendered scene]

[Physics consumer — K6; visual shader outputs cannot be ground truth]
```

Mevcut authored `snow` paint layer'ı varsa *kalıcı dünyaya ait* bir katmandır. Dinamik `snowCoverage` ise *mevsimsel üst örtüdür*. Normalleştirilmiş authored weights'i değiştirerek kar üretmek, geri dönüş ve manuel edit güvenliği açısından önerilmez. Referans yöntem: Epic Landscape Materials'da weight/alpha/height blend yaklaşımları. Kaynak: https://dev.epicgames.com/documentation/en-us/unreal-engine/landscape-materials-in-unreal-engine

### 10.3. Önerilen asgari veri sözleşmesi — kod değildir

```ts
type Season = 'spring' | 'summer' | 'autumn' | 'winter';
type Weather = 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog';

type EnvironmentDefinition = {
  schemaVersion: 1;
  enabled: boolean;
  climateProfileId?: string; // optional; no automatic climate needed in first slice
  clock: { hourLocal: number; timeScale: number; paused: boolean };
  season: { mode: 'manual'; selected: Season };
  weather: { mode: 'manual'; selected: Weather; intensity01: number };
  visual: { snowCoverage01: number; wetness01: number };
};

type EnvironmentRuntimeState = {
  clockHourLocal: number;
  selectedSeason: Season;
  selectedWeather: Weather;
  weatherIntensity01: number;
  // K3+ (NOT required to be simulated at K1):
  conditionRevision?: number;
};

type SurfaceConditionSample = {
  snowCoverage01: number; // render coverage, not true snow depth
  wetness01: number;
  // snowDepthCm?: number; // K3/K6 choice, deferred
};
```

**Önemli:** Bu tanım Forge'un bugünkü dosya biçimine dayanarak doğrulanmış schema değildir. Nihai property adları, `timeScale` birimi, `hourLocal` zaman dilimi/astronomi anlamı ve sidecar ilişkisi güncel kod incelemesiyle uyarlanacaktır. İlk görsel teslim için fiziki kar derinliği varsayılıp kaydedilmez; örtü oranı ile birikmiş fiziksel derinlik aynı alan yapılmaz.

**Yazma / preview sınırı:** Editörde `Draft Environment` ve `Applied Environment` farklı durumdur. Kontrol değiştirmek yalnız önizleme state'ini etkiler; `Apply` level'ın Environment Definition alanını veya sidecar'ını değiştirir. `Revert` draft'ı geri alır. `Save` sırasında henüz Apply edilmemiş preview level'a sızmaz. Play açılınca applied defaults ile başlar; runtime snapshot restore ayrı bir giriş yoludur.

### 10.4. Sidecar ve kayıt seçenekleri — henüz kesinleşmedi

İlk öneri: level kimliğine bağlı ayrı bir `*.environment.json` sidecar veya mevcut level JSON'da namespaced `environment` alanı. **Hangisinin daha güvenli olduğu için güncel validator, manifest, save coordinator, migration ve editör/Play round-trip incelemesi zorunlu.** JSON örneği dosya yaratma talimatı değildir.

Geçersiz preset, eksik family variant veya başarısız load durumunda varsayılan sahneyi kırmadan warning + no-environment/fallback davranışı gerekir. Değişiklikler schema version ve unknown-field testleriyle doğrulanır; mevcut level'ların tamamına zorunlu migration getirilmez.

### 10.5. AI / Codex komut yüzeyi — taslak

```text
environment.inspectCapabilities()
environment.previewPreset({ season, weather, hour, intensity, snowCoverage })
environment.validateDefinition()
environment.validateAssetFamilies()
environment.diffPreview()
environment.applyPreview()
environment.revertPreview()
environment.saveDefinition()
```

Bu çağrılar henüz mevcut API değildir. AI'nin otomatik commit yetkisi varsayılmamalı. World Builder stage-runner tarafı aynı `preview → diff → validate → apply` disiplinini korur. Otomatik `tick`, weather transitions ve persistent surface-grid güncelleme komutları K3–K5 sonrasına aittir.

---

## 11. Editör arayüzü önerisi

**K1–K2 için minimum panel:** `Environment` sekmesi, dört mevsim seçimi, `Time of Day` (00:00–24:00) slider, Play/Pause + `timeScale`, hava preset butonu ve `intensity`, `Snow Coverage` ile `Wetness` sliderları (iki değer **preview görsel parametresidir**), `Apply`, `Revert`, `Reset to Applied`, eksik asset/unsupported material warnings, `Preview vs Applied` ayrımı. Kullanıcı yalnız Kış seçip günün saati ve örtü miktarını değiştirerek farkı hemen gözlemleyebilmeli.

**K3 ile:** yağış görselini başlat/durdur, birikim geçişini gözle, iklim etkisi ile manuel coverage override'ın kaynağını `manual/simulation` olarak göster. `Weather = Snow` ile `Snow Coverage = 1` birbirini zorunlu eşitlemez; görünümün niçin karlandığı anlaşılır olmalı.


**World Environment** adlı üst seviye panel:

1. **Time & Sun:** saat slider'ı, pause/play, 24h preview, güneş yüksekliği, sky/exposure.
2. **Season:** Spring / Summer / Autumn / Winter hızlı manuel presetleri; otomatik `seasonPhase` slider'ı **K5 sonrasının** ileri kontrolüdür.
3. **Weather:** Clear / Cloudy / Rain / Snow / Fog manuel presetleri; intensity ve `Live preview` (K1–K3). **Storm** ve gelişmiş rüzgâr K5+ adayıdır.
4. **Surface:** K2'de `snowCoverage01` ve `wetness01` görsel slider; K3'te melt/dry, K6'da gerekiyorsa gerçek snow depth; debug overlay toggle.
5. **Climate & Biomes (K5+):** rakım/sıcaklık profilleri, biyomlar, local overrides; ilk teslim kapsamında değildir.
6. **Asset Seasons:** family karşılaştırması, eksik varyant listesi, fallback görünümü.
7. **Validation / Budget:** fog/sky/foliage/precipitation draw/memory, seam, missing shader mask ve unsupported asset raporu.
8. **Apply/Reset:** Preview only / Apply default / Save profile; geri alma ve sahne kaydetmeyle açık ilişki.

**UX ilkesi:** K3 tamamlandığında kullanıcı birkaç manuel kontrolle `Winter + Snowing + Sunset` önizlemesini görür; ileri kullanıcı sıcaklık, rakım ve snow mask'i düzenleyebilir. Oyun çalışma zamanındaki geçici hava, editör authored sahnesini kendiliğinden yeniden yazmaz.

---

## 12. Performans, platform sınırları ve kalite seviyeleri

### 12.1. Teknik riskler (öncelik sırasız)

| Risk | Neden önemli? | Önerilen kontrol |
|---|---|---|
| Çok fazla ağaç/season mesh swap | Mesh/material bucket bölünmesi ve draw call artışı | Family grouping, LOD, instancing, visible chunk update |
| Snow shader karmaşıklığı | Terrain + foliage + prop üzerinde çok texture sample | İki katmanlı baseline, feature flags, shader variants |
| Yüksek çözünürlüklü snow field | GPU/CPU RAM, upload, tile seam | Coarse tile state + near-detail overlay, lazy update |
| Eşzamanlı VFX + gölge + volumetric | GPU fill-rate ve overdraw | Simple sky/cloud, camera-local precipitation, quality tiers |
| Dünya streaming geçişi | Komşu tile'larda farklı snow state pop | Border sampling, region-wide climate state, blended activation |
| Zaman hızlandırma | Çok sayıda yağış adımı/frame hitch | Fixed environmental tick veya kapalı-form catch-up |
| Gece görünürlüğü | Sky/sun/fog/tonemapping uyumsuzluğu | Görsel kabul sahneleri, minimum okunurluk |
| Kaydetme boyutu | Her tile için her frame full snow map saklama | Değişen tile/region delta ve recomputable baseline |
| WebGPU'ya erken bağımlılık | Uyumluluk ve shader migration | WebGL2 baseline, renderer abstraction, isolated WebGPU spike |

### 12.2. Önerilen kalite profilleri (sayısal hedef değil)

| Özellik | Low | Medium | High |
|---|---|---|---|
| Sky | Gradient/parametric | Parametric sky | Gelişmiş atmosfer seçeneği |
| Clouds | Basit 2D sky layer | Katman + animasyon | Hava gölgesi opsiyonel |
| Rain/snow | Düşük yoğunluk, yakın bölge | Orta radius | Büyük yakın VFX, yüksek yoğunluk |
| Snow cover | Coarse global/local mask | Tile mask + normals | Daha detaylı mask + local effects |
| Foliage | Basit material variant | LOD mesh swap | İnce geçiş + gust/overlay |
| Surface physics | Temel klasman | Same deterministic sampled state | Gelişmiş near-wheel detay (oyuna özel) |

**Ölçüm yapılmadan sayısal FPS/RAM/VRAM garantisi verilmiyor.** Nihai hedef cihaz, minimum FPS ve memory budget, güncel Forge ile örnek sahnede profillenecek.

### 12.3. Ölçüm protokolü

`device / GPU / browser / viewport / DPR / quality / gitCommit / activeTiles / treeInstances / precipDensity / shadowSetting / timeOfDay / profile / fps p50-p95-p99 / GPU ms / draw calls / triangles / JS heap / GPU resources / transition stutters` raporlanmalı. Aynı kamerayla **kuru yaz öğlesi → kar fırtınası öğlesi → kar kaplı gün batımı → gece** karşılaştırılmalı. 10–15 dk oturumda bellek plato testi; runtime save/reload ayrı.

---

## 13. Uygulama fazları, görev kırılımı ve kabul kapıları — kararlarla güncellendi

Aşağıdaki sıralama **bağlayıcı kapsam, önerilen teknik yürütme sırası** ayrımı taşır. Takvim/süre, kesin FPS veya hardware sınırı verilmez; bunlar repo incelemesi ve ilk profiller sonrası alınacak mühendislik kararlarıdır. **K0–K3 birlikte ilk kullanıcı hedefini gerçekleştirir; K4–K6 bağımsız genişletmelerdir.** Her kapıda TypeScript/type-check + ilgili engine testleri + editor/Play/browser smoke + save/reload yapılır (gerçek repo komutları K0'da belirlenir).

### K0 — Mevcut Forge'un teknik haritası (kod değiştirmeden)

**İşler:**

1. `AGENTS.md`, Git branch/HEAD/status ve kullanıcı değişikliklerinin korunmasını kontrol et.
2. Mevcut `sky/light/fog/cloud`, clock/time update, Three.js material hooks, render pipeline, terrain authored paint, foliage batching/LOD, asset manifest/glTF loader, level save/load/validator, game save, editor/runtime capability katmanlarının gerçek dosya/sınıf/testlerini çıkar.
3. World Builder 02/07/09/12 aşamalarının WES erişim API'sine dönüşeceği noktaları ve migration risklerini belirle.
4. En küçük **test valley** sahnesini seç veya izole fixture oluştur: grass/dirt/rock + yol, kaya, çatı, bir deciduous ve bir evergreen family. Kullanıcıya ait level değiştirme.
5. Kabiliyet matrisi ve tercih edilen schema saklama yolunu raporla; ilk commit'ten önce mini mimari ve regresyon riskini gözden geçir.

**Çıktı:** `WES_K0_KAPASITE_VE_ENTEGRASYON_RAPORU.md` (önerilen ad), modül bazlı **MEVCUT/KISMİ/YENİ**, kanıtlı dosya yolları, test komutları, editor ve Play call graph, riskler.

**Çıkış:** Olası reuse/patch/new listesi, mevcut sahne formatı ve renderer sınırı kanıtlanmadan kodlama K1'e geçmesin. Bu bir *analiz kapısıdır*, 'geliştirme tamam' kabulü değildir.

### K1 — WorldClock + manuel season/weather state + temel atmosfer/Editor

**Görevler:**

- Genel amaçlı `EnvironmentDefinition` ve optional capability/feature gate oluştur; varsayılan kapalı veya legacy-safe.
- `WorldClock` ile saat slider, pause, day/night ve timeScale; kaynak güncellemesi render FPS'inden ayrılır (clock zamanı monoton/testlenebilir, deterministik girişlerle).
- Mevsim seçimi ilk etapta `spring/summer/autumn/winter` manuel; otomatik annual progression **yok**. Seçilen mevsim/clock, `EnvironmentRuntimeState` tüketicilerine dağıtılır.
- Manuel `clear/cloudy/rain/snow/fog` preset state'i ve intensities; K1'de her preset için tam VFX zorunlu değil, sky/ışık/sis farklılığı doğrulanır.
- Mevcut light/sky/cloud sistemini tamamen değiştirme; adapter kullan ve kullanıcı yapımı/elle kilitlenmiş environment ayarlarına açık öncelik politikası tanımla.
- Editor panel: preview → apply/revert, Play default readback, sürüm doğrulama ve invalid enum fallback.

**Kabul:** ENV-06 ve ENV-15; gün 24 saat çevrimde saat/eşya kimliği tutarlıdır, editör preview kayıt sızması yoktur, WES kapalı eski level aynı kalır. Hava presetleri state olarak kaydedilir. **K1 tek başına 'kış görünümü tamamlandı' anlamına gelmez.**

### K2 — Kışın görünür dönüşümü: terrain overlay + hibrit seasonal asset families

**Görevler:**

- `SeasonalMaterialAdapter` ile authored paint üstüne non-destructive `snowCoverage` + `wetness` görsel örtüsü uygula. Albedo, normal ve roughness tutarlılığı kontrol edilsin; dik yüzeyde kar eğim maskesi + material acceptance kullanılsın.
- `snowCoverage01` slider ve kış presetinde yapılandırılabilir varsayılan; **kar yağışı başlatmayı şart koşmadan** karlı dünyayı görebil.
- `SeasonalAssetResolver`: per-family `tint/material-only`, `mesh-swap`, `hide-leaf-submesh`, `none`; family stability ve fallback. Kış yapraksız deciduous / aynı mesh üzerinde karlı evergreen örneği.
- Mevsim değişiminde `stableId`, transform, authored placement ve collider kimliği korunsun; instanced foliage bucket reassignment ve material compile cache ölçülsün. Aynı family için dört GLB istenmesin.
- Terrain + kaya/çatı + foliage görünüm adapterlarının multi-material / unsupported shader durumları için uyarı ve güvenli fallback'i olsun.
- Level default save/load ve editor Apply/Revert smoke testleri.

**Kabul:** ENV-01/02/03/10/13/15; **Kış presetine basmak tek bir test sahnesinde gökyüzünü, authored grass/rock zemininin görünen karını, yaprak döken ağacı ve uygun çatı/kayayı bir arada değiştirir**; yaz presetine dönmek asıl authored boya/foliage yerleşimini eksiksiz geri gösterir. Bu kapı, kullanıcının ilk talebinin görsel çekirdeğidir.

### K3 — Manuel hava olaylarının gerçek görselliği + görsel birikim

**Görevler:**

- Manuel snow/rain seçildiğinde yağış VFX, ses varsa mevcut sound interface, bulut/sis/ışık yoğunluğu, ilk wind value routing. Parçacıklar kamera çevresinde, maliyet/overdraw kontrollü.
- Görsel `SurfaceConditionState` içinde `snowCoverage01` ve `wetness01` için zamanla artma/erime/kuruma; weather off olduktan sonra örtü sürekliliği. K3'te gerçek `snowDepthCm`, sıkışma, fizik collider veya araç grip zorunlu değil.
- Zaman hızlandırma/sıfır pause'da güncelleme ve sabit sonuç testleri; `manual override` ile `derived from precipitation` durumlarının panelde açıkça ayırt edilmesi.
- Terrain shading ve foliage/asset snow acceptance aynı surface-condition girdisini okur. Kar/ıslaklık görsel state'inin araç fiziğini doğrudan etkilemediği testle sabitlensin.

**Kabul:** ENV-04/05/08/12/14; yağış başlayınca birikim görünür, durunca birden sıfırlanmaz, sıcaklık/clear preset ile kontrollü azalır; authored base layer sağlamdır. **K0–K3 kapanınca seçilen ilk kapsam işlevsel olarak mevcut sayılabilir** (performans, save ve editor/Play test sonuçları eklenmek kaydıyla).

### K4 — World Builder stage bağı ve multi-tile/runtime kalıcılık

**Görevler:**

- Stage 02/07/09/12 çıktılarıyla contract; mask/asset family/biome metadata read-only, `dirtyBounds`/`stableId` diff.
- Tile/region border testleri, lazy residency veya mevcut streaming ile uygun çözüm; environment condition atlas yükleme/boşaltma. Tam dünya yeniden shader/upload/gönderme yapma.
- `GameSaveState` entegrasyonu **oyun/level tercihi gerektiriyorsa** ayrı runtime snapshot şeklinde; authoring default kaydı ve gameplay save birbirinden ayrı. Restore sonrası scene, clock ve kar görünümü tutarlı.
- World Builder `rebuildAffected` ile manuel paint/foliage korunumu; preview/rollback ve editör veri migration testleri.

**Kabul:** ENV-07/09/10/13; desteklenen streamed dünya testlerinde seam/pop sınırı ve save/load raporu; `World Builder` stage tekrarında manuel override korunur. Güncel terrain streaming tamamlanma durumu K0'da doğrulanır; yoksa bu aşama başka planın bağımlılığı olarak tutulur.

### K5 — Otomatik takvim/mevsim ve kural tabanlı hava [SONRAKİ ÜRÜN FAZI]

**Görevler:**

- `seasonPhase`/day-of-year, iklim presetleri, biome/rakım farkı, `WeatherDirector` seed ve geçiş olasılıkları; manual override her zaman mümkün.
- Gece/gündüz ile güneş yüksekliği ve ışık tonu, dört mevsim fenoloji geçişine genişletilir. Görsel yoğunluk/asset swap streaming sınırları korunur.
- `EnvironmentHistory` / lazy catch-up maliyetini ölç, büyük sıçramada son durum deterministik hesaplama sözleşmesi seç.

**Kabul:** Manuel modu bozmadan otomatik döngü çalışır; belirlenen seed/timeline tekrarında aynı sonuç görülür; stop/restore/yükleme sorunsuz. **İlk kullanılabilir sürümün kapısı değildir.**

### K6 — Forge Offroad/oyunlar için surface physics [AYRI KABUL]

**Görevler:**

- `SurfaceConditionQuery(worldX, worldZ)` sonucunu `TerrainSurfaceProfile`/wheel ground contact arayüzüne açık biçimde bağla; görsel cover değil fiziksel zemin tepkisinin hesap kaynağını belirle.
- İlk testte dry/wet/snow karşılaştırması; kayma/sürtünme/direnç parametreleri ve deformasyon katmanını birbirinden ayır.
- Aynı rota/araç/yük ve fixed physics tick ile tekrar üretilebilir hız/tutuş/frenleme testi. Offroad oyun mantığı bu kararlara ayrıca onay vermeli.

**Kabul:** ENV-12 ile fizik-görsel ayrım korunurken, fizik provider açık olduğunda fark *ölçülür*; kapalı olduğunda WES yalnız görseldir. Bu faz kendiliğinden SnowRunner seviyesinde batma/kar izi simülasyonu iddiası değildir.

### 13.1. Sprint/görev dağılımı (bağımlılık odaklı; süre taahhüdü değil)

| Sıra | Geliştirme bileti | Bağımlılık | Çıktı/kanıt |
|---|---|---|---|
| 00 | `WES-001` Repo + renderer + terrain/foliage + serialization inventory | yok | K0 raporu + test fixture |
| 01 | `WES-002` Environment schema/defaults + clock + legacy-safe gate | 001 | unit tests, no-regression |
| 02 | `WES-003` Editor manual season/weather/time preview + apply/revert | 002 | editor smoke + save/reload |
| 03 | `WES-004` Sun/sky/fog/light adapter | 002 | day/night browser captures + perf |
| 04 | `WES-005` Terrain snow/ wetness overlay | 001–003 | paint byte comparison + material snapshots |
| 05 | `WES-006` Seasonal asset family + two tree examples | 001–003 | stableId/collision + instance counts |
| 06 | `WES-007` Winter acceptance scene + K2 regression | 004–006 | ENV-01/02/03/15 |
| 07 | `WES-008` Manual snow/rain VFX + event routing | 003/004 | manual precipitation playback |
| 08 | `WES-009` Visual coverage/wetness accumulation and melt/dry | 005/008 | deterministic fixed-tick tests |
| 09 | `WES-010` Editor/Play acceptance and desktop perf sweep | 001–009 | K3 acceptance report |
| 10 | `WES-011` World Builder/multi-tile/persistence integration | K3 + terrain capability | K4 smoke |
| Later | `WES-012` Automatic climate/calendar | K4 or proven subset | K5 separate feature tests |
| Later | `WES-013` Physics query + Offroad integration | K3/K4 + vehicle ground contact | K6 vehicle A/B tests |

### 13.2. Kanıt standardı ve durdurma koşulları

- Her bilet: commit SHA, changed modules, öncesi/sonrası test komutları, gözlem, regresyon, risk, önceki sahnelerle uyumluluk.
- **Kritik durdurma:** authored paint weight byte farkı; manual asset / stable ID kaybı; preview otomatik commit; sessiondan çıkışta GPU buffer/texture leak; kış shader'ıyla alakasız materyal kırılması; oynanış fiziğine izinsiz müdahale.
- `Masaüstü WebGL2` bir cihaz sınıfı kararıdır; **minimum ekran kartı, FPS eşiği, bellek limiti, harita büyüklüğü henüz [AÇIK]**. İlk benchmark'tan önce sayı uydurulmaz.
- K1–K3'te küçük kabul level'ı; K4'te büyük harita. Böylece World Builder'ın kilometrelik dünya riski WES'in ilk görsel doğrulamasına yüklenmez.

---

## 14. Kabul testleri — faz eşlemesi; henüz çalıştırılmadı

| ID | Faz | Senaryo ve geçme koşulu |
|---|---|---|
| **ENV-00** | K1 | WES bulunmayan mevcut level'ın render/save/Play davranışı değişmez; feature gate fallback çalışır |
| **ENV-01** | K2 | Winter preview: sky, terrain, deciduous family, evergreen/roof/rock seçili örtüyle görünür dönüşür; summer'da authored görünüm geri gelir |
| **ENV-02** | K2 | Hibrit family: aynı stable ID/transform/collider ile material variant ve winter mesh variant; eksik variant uyarılı fallback |
| **ENV-03** | K2 | Terrain/rock/roof snow shader: normal/eğim/acceptance maskesi doğru; paint/height byte'ları mevsim yüzünden değişmez |
| **ENV-04** | K3 | Snow başlat/durdur: parçacık yağarken örtü artar, bitince birden sıfırlanmaz; kontrol edilen erimeyle azalır |
| **ENV-05** | K3 | Rain başlat/durdur: wetness artar, yağış bitince kurur; authored texture korunur |
| **ENV-06** | K1 | Clock pause, scrub, timeScale, 24h wrap; sun/sky/ambient gündüz ve gece görünürlüğü; editör/Play ayrımı |
| **ENV-07** | K4 | İki terrain tile sınırında kar ve material maskesi, foliage family seam/pop göstermiyor; kamera hareketiyle tekrar yükleniyor |
| **ENV-08** | K3/K5 | Aynı manual weather event/tick/seed ile cover ve wetness sonuçları eşit veya tanımlanmış toleransta |
| **ENV-09** | K4 | `EnvironmentDefinition` round-trip ve gerekiyorsa runtime clock/condition snapshot restore; authored state'e save sızmıyor |
| **ENV-10** | K2/K4 | World Builder tekrarlı stage ve manual overrides: kimlikler, paint ve seçili ekosistem yerleşimleri korunur |
| **ENV-11** | K1–K4 | Yaz-gündüz / kış-kar / gece-yağmur sahne sweep; FPS/frame p50/p95/p99, shader compile, draw calls, RAM/GPU kayıtlı |
| **ENV-12** | K3/K6 | Shader-only snow araç physics state'ini değiştirmez; K6 provider açıkken ayrı tekrarlanabilir fizik farkı |
| **ENV-13** | K2/K4 | Material/mesh family swap, cache, residency, unload/dispose sonrası GPU kaynak büyümesi sınırlı; loglanan sayılar |
| **ENV-14** | K3 | 30/60/144Hz dış update ile aynı sanal zaman altında coverage/wetness sonuçları tutarlı; pause state büyümez |
| **ENV-15** | K1/K2 | `Preview`, `Apply`, `Revert`, `Save`, `Reload`, `Play`: yalnız apply edilmiş değer kalıcı; gizli auto-save yok |

**Gerekli test cihazı notu:** Masaüstü WebGL2 ilk hedef. Kullanıcının gerçek donanımı, tarayıcı build'i, çözünürlük ve kullanılan benchmark sahnesi test raporuna aynen yazılmalı. Süre ve sayısal performans hedefleri **başlangıçta verilmemiştir**; regresyon baz çizgisi ölçümden sonra ortak kararla belirlenecek.

---

## 15. Karar defteri — onaylar ve açık mühendislik kararları

**26 Ekim 2026 kullanıcı kararı:** İlk kapsam kademeli; ağaç hibrit; kar fiziği görsel sonrası ortak veri; masaüstü WebGL2 önce. Bunlar artık `[AÇIK]` değil, `[ONAYLANDI]` statüsündedir. Önceki v0.1 önerileri otomatik topluca onaylanmış sayılmaz.

| ID | Konu | Karar / öneri | Durum |
|---|---|---|---|
| **E-001** | Forge ürün konumu | Motor/editörün genel WES yeteneği; World Builder kullanıcısı; Offroad tüketici | **[ONAYLANDI — ilk kullanıcı talebi]** |
| **E-002** | İlk kapsam | Manuel mevsim/hava + canlı clock, kademeli geliştirme | **[ONAYLANDI]** |
| **E-003** | Mevsim UI | İlk sürümde dört manuel preset; otomatik seasonPhase K5'te | **[ONAYLI KAPSAMDAN TÜRETİLDİ]**; otomatik döngü ayrıntıları [AÇIK] |
| **E-004** | Asset family | Materyal + gerekirse mesh varyantı, dört zorunlu model yok | **[ONAYLANDI]** |
| **E-005** | Authored paint/kar örtüsü | Non-destructive render overlay, kalıcı paint ayrı | **[MİMARİ İLKE]**; K0'da teknik yöntem doğrulanacak |
| **E-006** | Kar–fizik sınırı | Önce görsel; SurfaceCondition arayüzü fiziğe daha sonra bağlanır | **[ONAYLANDI]** |
| **E-007** | Astronomik doğruluk | Önce art-directed sun/day-night; gerçek enlem/mevsim uzunluğu ayrı | **[ÖNERİ]** |
| **E-008** | Hedef platform | İlk kabul masaüstü WebGL2; mobil ayrı | **[ONAYLANDI]** |
| **E-009** | Hava bölgeleri | İlk manuel preset tek dünya/scene state; zonal weather sonraya | **[ÖNERİ]** |
| **E-010** | Kar fiziksel miktar birimi | İlk görsel dilimde `snowCoverage01`; fiziksel derinlik/SWE ve kalıcılık K3–K6 tasarımında | **[AÇIK / TEST]** |
| **E-011** | Demo sahnesi | Vadi/çim/toprak/kaya, deciduous+evergreen, yol/çatı/araç | **[ÖNERİ]** |
| **E-012** | Offroad oyun etkisi | K6'ya kadar oynanış etkisi yok, oyun görevi/risk ayrı onay | **[ONAYLI SINIRDAN TÜRETİLDİ]**; gameplay kuralları [AÇIK] |
| **E-013** | Dosya yeri/schema | Level JSON namespaced alan mı sidecar mı? | **[AÇIK — K0 repo incelemesi]** |
| **E-014** | Shader entegrasyonu | Mevcut terrain material patch mi özel adapter mı? | **[AÇIK — K0/K2 spike]** |
| **E-015** | Minimum GPU/FPS/bellek | Masaüstü WebGL2 baz çizgisi ve hedef cihaz profili henüz yok | **[AÇIK — benchmark sonrası]** |
| **E-016** | Kış preset snow değeri | Kışın konfigüre edilebilir default + ayrı coverage slider | **[ÖNERİ — K2 UX testi]** |
| **E-017** | Runtime oyun kaydı | Sadece authored level mı; oyun saati ve birikim de mi saklanacak? | **[AÇIK — K4/game requirement]** |

**Şimdiki darboğaz karar değil, repo doğrulamasıdır:** Kullanıcıdan yeniden aynı dört tercihi isteme. K0'dan sonra yalnız **somut teknik kanıtla çözülemeyen** kararları getir: environment sidecar/JSON yerleşimi, renderer shader entegrasyonu, görsel birikimin çözünürlüğü ve donanım/perf eşiği. Alternatifleri benchmark/migration riskiyle karşılaştırmadan kesinleştirme.

---

## 16. Codex / Claude için ilk görev — kopyalanabilir uygulama brifi

**Görev kodu: WES-001 / K0 — Forge Environment Capability Integration Audit**

> Forge'un mevcut ortak motor/editör deposunda **yalnız analiz ve raporlama** yap; bu görevde üretim kodunu değiştirme. Önce `AGENTS.md`, Git branch/HEAD, `git status`, worktree'leri ve kullanıcı değişikliklerini kontrol et. World Builder planı v0.1 ve World Environment v0.2 kararlarını oku. **Onaylı ürün hedefleri:** (1) İlk kullanılabilir sürüm manuel mevsim/hava + çalışan gün–gece + kışın terrain/asset dönüşümü; (2) hibrit materyal/mesh tree families; (3) kar/ıslaklık önce görsel, fizik daha sonra; (4) masaüstü WebGL2.
>
> `renderer/scene/time/day/night/sky/fog/light`, terrain paint shader/weights, foliage instancing/LOD, GLTF asset family/manifest, project/level save validator/editor coordinator/Play runtime, surface/vehicle physics contact, debug profiler modüllerini güncel dosya/sınıf/test komutlarıyla envanterle. 23 Ekim raporunu güncel repo yerine kabul etme. Her parça için `MEVCUT VE TESTLİ / KISMİ / YENİ / BELİRSİZ` ve yeniden kullanma yöntemini yaz.
>
> Önerilen `EnvironmentDefinition`, `WorldClock`, `EnvironmentRuntimeState`, `SeasonalMaterialAdapter`, `SeasonalAssetResolver` arayüzleri için **en küçük** entegrasyon planını, schema saklama seçeneklerini ve sahne uyumluluğunu karşılaştır. Varsayılan kapalı WES feature gate, preview/apply/revert, manuel override korunumu, kar örtüsünün authored paint byte'larını değiştirmemesi ve test-vadi fixture konusunu işle. K1–K3 biletlerini güncel dosya yollarına ve test komutlarına bağla; K1'e geçişte hangi risklerin kapatılacağını belirt.
>
> Çıktı: **(a)** güncel repo kanıt tablosu, **(b)** dosya bazında önerilen K1–K3 değişiklik planı, **(c)** Environment schema karar önerisi ve backward compatibility, **(d)** ENV-00/01/02/03/06/15 için test planı, **(e)** ilk WebGL2 baseline ölçüm sahnesi, **(f)** açık teknik kararlar ve uygulanmaması gereken büyük refactor listesi. **Büyük renderer değişimi, otomatik iklim sistemi, zorunlu mobil destek, oyuna kar fiziği ekleme, kullanıcı level migration ve depo yeniden düzenleme yapma.**

**K0 raporuyla ikinci görev (WES-002) başlatılabilir:** Yalnız onaylı minimum schema + clock + disabled-safe adapter oluştur, test ve editor/Play smoke ekle. Bu belgenin faz sırası K0 bulgularına göre revize edilir; kullanıcı onaylı dört ürün kararı aynen korunur.

---

## 17. Kaynakça ve araştırma sınırları

### Proje içi

1. World Builder planı v0.1 (25 Ekim 2026): https://drive.google.com/file/d/1V1Tdqo6UwTk0mtyYGGku_AzojAGrOwsH/view?usp=drivesdk
2. Forge teknik envanteri (23 Ekim 2026): `FORGE_OFFROAD_FORGE_TEKNIK_DURUM_RAPORU_2026-10-23.md`.
3. Forge Offroad GDD v0.3: `FORGE_OFFROAD_GDD_PROJE_CERCEVESI_v0.3.md`.
4. Forge Offroad M0 v0.5: `FORGE_OFFROAD_M0_UYGULAMA_VE_KABUL_RAPORU_v0.5.md`, ortak motor kaynak yaklaşımı; bu rapor template durumunda, kod uygulaması kanıtı değildir.

### Dış teknik kaynaklar (26 Ekim 2026 erişim)

5. Epic — Landscape Materials: https://dev.epicgames.com/documentation/unreal-engine/landscape-materials-in-unreal-engine
6. Epic — Layered Materials: https://dev.epicgames.com/documentation/unreal-engine/creating-layered-materials-in-unreal-engine
7. Epic — Sky Atmosphere: https://dev.epicgames.com/documentation/unreal-engine/sky-atmosphere-component-in-unreal-engine
8. Epic — Volumetric Cloud: https://dev.epicgames.com/documentation/unreal-engine/volumetric-cloud-component-in-unreal-engine
9. Unity — Terrain features: https://docs.unity.com/en-us/engine/6000.5/manual/creating-environments/script-terrain
10. Unity — Terrain Shader Graph: https://docs.unity.com/en-us/engine/7000.0/manual/creating-environments/script-terrain/terrain-shader-graph
11. Three.js — WebGLRenderer: https://threejs.org/docs/pages/WebGLRenderer
12. Three.js — Material (onBeforeCompile): https://threejs.org/docs/pages/Material.html
13. Three.js — InstancedMesh: https://threejs.org/docs/pages/InstancedMesh
14. Three.js — DataArrayTexture: https://threejs.org/docs/pages/DataArrayTexture.html
15. Three.js — Sky: https://threejs.org/docs/pages/Sky.html
16. Three.js — FogExp2: https://threejs.org/docs/pages/FogExp2.html
17. Three.js — WebGPURenderer: https://threejs.org/manual/pages/webgpurenderer
18. MDN — WebGPU API: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
19. Khronos — `KHR_materials_variants`: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_variants/README.md
20. Three.js — GLTFLoader: https://threejs.org/docs/pages/GLTFLoader.html
21. Three.js — KTX2Loader: https://threejs.org/docs/pages/KTX2Loader.html

**Yöntem / kısıt:** Dış kaynaklar genel teknik yöntemlerin mümkün olduğunu gösterir, Forge'un güncel repo entegrasyonunu veya tarayıcı performansını kanıtlamaz. Bu çalışma kaynak kodu açmamış, benchmark çalıştırmamış ve `.md` dışında bir proje dosyası değiştirmemiştir. Ürün tercihi, teknik hipotez ve uygulanmış sistem aynı etiket altında gösterilmez.

---

## 18. Sürüm geçmişi

| Sürüm | Tarih | Değişiklik |
|---|---|---|
| **0.2** | **2026-10-26** | E-002/E-004/E-006/E-008 ve WES'in genel motor/editör konumu onaylandı; dört manuel mevsim/weather/clock kapsamı kilitlendi; K0–K6 uygulama aşamaları, WES-001–013 iş kırılımı, veri/preview sözleşmesi, kabul matrisi ve açık kararlar güncellendi. v0.1 özgün araştırması korundu. |
| 0.1 | 2026-10-26 | World Builder'a dayalı araştırma, Unreal/Unity/Three.js/glTF değerlendirmesi, WES mimarisi, mevsim/kar/ıslaklık/clock, asset family, web performans riskleri, test/faz/karar defteri. Tüm ürün kararları açık bırakıldı. |
