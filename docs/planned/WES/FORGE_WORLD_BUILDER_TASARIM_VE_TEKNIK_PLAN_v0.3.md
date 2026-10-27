# FORGE WORLD BUILDER
## AI destekli, prosedürel ve düzenlenebilir açık dünya / level üretim sistemi

**Belge:** `FORGE_WORLD_BUILDER_TASARIM_VE_TEKNIK_PLAN_v0.3.md`
**Sürüm:** 0.3 — repo doğrulamalı yetenek envanteri ve yeniden sıralanmış yol haritası
**Tarih:** 27 Ekim 2026
**Doğrulanan kod:** `main` @ `f9aa05f`
**İlk kullanım senaryosu:** Forge Offroad (lojistik ve taşımacılık; izole dağ yerleşimleri)
**Uzun vadeli kapsam:** Farklı oyun türlerinde yeniden kullanılabilir world/level üretimi
**Durum:**
- Tasarım önerisidir; World Builder'a özgü kod (recipe, stage runner, generator) **yoktur**.
- Bu sürümde üzerine kurulacağı editör araçlarının gerçek durumu kodla işaretlendi.

**İlgili:** [WES v0.3](FORGE_WORLD_ENVIRONMENT_MEVSIM_HAVA_ZAMAN_TEKNIK_TASARIM_VE_UYGULAMA_PLANI_v0.3.md) · [OPEN_WORLD_PLAN](../OPEN_WORLD_PLAN.md) · [WORLD_TERRAIN_WATER_BODY_PLAN](../WORLD_TERRAIN_WATER_BODY_PLAN.md) · [TERRAIN_DEFORMATION_PLAN](../TERRAIN_DEFORMATION_PLAN.md) · [Forge Water System](../Forge_Water_System/README.md)

> **Etiketler**
> - `[KOD]`: repoda doğrulandı (dosya yolu verilir).
> - `[PLAN]`: başka bir repo planında kayıtlı durum.
> - `[KARAR v0.3]`: bu sürümde gerekçeli alınan mühendislik kararı.
> - `[ÖNERİ]`: uygulama önerisi.
> - `[AÇIK]`: karar bekleyen konu.
>
> Bir aracın bu belgede önerilmesi, Forge'da olmadığı anlamına gelmez. §4'teki **Durum** sütunu neyin var olduğunu söyler.

---

## 0. v0.3'te ne değişti

1. **"Kullanıcı bildirimi" olan durum tablosu kodla doğrulandı (§0.1).**
   - Açık dünya, sculpt/erosion, World Terrain yol/nehir aktarımı (8A0–8A5) ve Lake (W1) tamamlanmış.
   - Paint katmanından foliage üretimi (T19'un bir kısmı), World Partition ve HLOD mevcut.
2. **33 aracın her birine durum ve kanıt eklendi (§4).**
   - Toplam 4 araç MEVCUT, 18 araç KISMİ, 11 araç YENİ.
   - P0'ın gerçekten yeni olan çekirdeği küçüldü: recipe + stage runner + kimlik/sahiplik + preview/diff.
3. **Mimari sınır çizildi (§1.2):** World Builder ikinci bir terrain/foliage/spline formatı **kurmaz**. Mevcut editör işlemlerini ve veri biçimlerini çağıran bir orkestrasyon katmanıdır.
4. **On açık karardan beşi kapandı ya da karara bağlandı (§10):**
   - Katman modeli: tam edit-layer yığını yerine "recipe + bake + korunan bölge".
   - Recipe'nin yeri: `<Level>.worldrecipe.json` önerisi.
   - Fiziksel zemin eşlemesi: zaten var.
5. **İlk prototip ve fazlar mevcut sahne ve araçlara bağlandı (§8, §9).**
6. **WES entegrasyonu WES v0.3'e göre güncellendi (§12).**

---

## 0.1. Repo durumu — 27 Ekim 2026 (v0.2'deki "kullanıcı bildirimi" tablosunun yerine)

| Bilgi | Durum | Kanıt |
|---|---|---|
| Açık dünya arazi (çok tile, CDLOD, streaming) | `[KOD]` MEVCUT | `engine/terrain/*`, `engine/render-three/terrain/*`, `engine/world/worldPartition*.ts`; OPEN_WORLD_PLAN Faz 1–7 |
| New Open World sihirbazı, 16-bit PNG/RAW heightmap'ten başlatma | `[KOD]` MEVCUT | `engine/world/openWorldSetup.ts`, `engine/terrain/heightmapPng.ts`, `terrainImport.ts`; son commit'ler |
| Sculpt araçları | `[KOD]` MEVCUT | `raise/lower/flatten/smooth` (`engine/scene/landscapeBrush.ts`), `noise/ramp/terrace/erosion` (`engine/terrain/terrainSculpt.ts`) |
| Erozyon | `[KOD]` MEVCUT (fırça) | `engine/terrain/terrainErosion.ts`: termal + hidrolik, sınırlı ve atomik patch |
| Paint (8 katman) + physical material | `[KOD]` MEVCUT | `TERRAIN_MAX_LAYERS = 8`, katman `physicalMaterial` (`engine/terrain/terrainTypes.ts`) |
| World Terrain üzerinde yol spline'ı (çok tile deform/boya, mesh, çarpışma) | `[KOD]`+`[PLAN]` MEVCUT | WORLD_TERRAIN_WATER_BODY_PLAN 8A0–8A4 `[x]`; `engine/terrain/terrainSplines.ts`, `terrainSplineMeshes.ts` |
| Nehir (dünya koordinatlı yatak/yüzey, akış) | `[KOD]`+`[PLAN]` MEVCUT | 8A5 `[x]`; `engine/terrain/terrainRiverWater.ts`, `engine/render-three/riverWater.ts` |
| Göl (mevcut çukuru doldurma) | `[KOD]`+`[PLAN]` MEVCUT | W1 `[x]`; `engine/terrain/terrainLakeWater.ts`, `engine/scene/waterBody.ts` |
| Göl yatağı oyma, puddle, ocean | YOK | W2 kaldırıldı (kullanıcı kararı 26 Ekim); W3/W4 `[ ]` |
| Generic spline: mesh bükme, modüler tekrarlama, yol süsleri | `[KOD]` MEVCUT | `engine/scene/splineGenerator.ts`, `splineRoadDecorations.ts`, `splineDiagnostics.ts` |
| Dinamik deformasyon (lastik izi, gömülme, ıslak iz) | `[KOD]` MEVCUT | `engine/render-three/terrain/terrainDeformation.ts`, `engine/physics/surface/*`; TERRAIN_DEFORMATION_PLAN Faz 1–4A |
| Foliage boyama + paint katmanından kuralla üretim | `[KOD]` MEVCUT | `engine/scene/foliage.ts` (`LandscapeFoliageRule`), `landscapeFoliage.ts`, `proceduralFoliage.ts`; hücre akışı `engine/world/foliageCells.ts` |
| HLOD, uzak görünüm, kaskad gölge | `[KOD]` MEVCUT | `engine/world/hlod.ts`, `viewDistance.ts`, `sunCascades.ts` |
| World Partition paneli + minimap | `[KOD]` MEVCUT (plan checklist'i henüz kapatmamış) | `src/editor/panels/world/worldPartitionPanel.ts`, `engine/world/worldMapView.ts`, `tests/smoke/world-partition-panel.spec.ts` |
| Navigasyon | `[KOD]` KISMİ | Tek grid, `MAX_GRID_CELLS = 20000` (`engine/navigation/gridNavigation.ts`); AI nav volume; tile'lı nav OPEN_WORLD Faz 9 `[ ]` |
| Asset katalog metadata | `[KOD]` KISMİ | Manifest `category`, `tags`, `placement` kuralları (`engine/assets/manifest.ts`); biyom/boyut/LOD semantiği yok |
| Undo/redo, kirli kayıt, dünya verisi doğrulaması | `[KOD]` MEVCUT | `editor/core/history.ts`, `src/editor/editorSaveCoordinator.ts`, `npm run verify:world-data` |
| World Recipe, Stage Runner, generatedBy/stableId sahipliği, preview diff, yerleşim/rota üreticileri | YOK | Bu belgenin konusu |

> **Deformasyon terimleri** (v0.2 uyarısı korunur, durumla):
> - (1) Editörde yükseklik değiştirme: MEVCUT.
> - (2) Spline'ın zemini kazması/düzleştirmesi: MEVCUT (8A1).
> - (3) Oyunda lastik iziyle dinamik deformasyon: MEVCUT (deformasyon planı).

### 0.2. Proje bağlamı

Forge Offroad'ın kesinleşmiş deneyimi **lojistik ve taşımacılık**, dünyası **izole dağ yerleşimleri**dir. World Builder'ın ilk kabul senaryosu bu çerçeveyi kullanır; mimari Offroad'a özgü değildir.

---

## 1. Vizyon ve ilkeler

**Vizyon:** "Bir referans görseli, kısa bir tasarım açıklaması ve birkaç oyun kısıtı ver. Forge yerleşimleri, yolları, araziyi, suyu, doğayı ve sahne öğelerini kontrollü aşamalarla oluştursun. Dünya oyunda çalışsın ve gerektiğinde yalnız etkilenen kısımlar yeniden üretilsin."

1. **Önce plan, sonra geometri.**
2. **Referansa benzerlik + oynanabilirlik:** eğim, yol genişliği, araç geçişi ve performans görsel hedefle birlikte değerlendirilir.
3. **Bağımlılık grafı:** nehir, yol, köprü, yerleşim ve foliage birbirini etkiler; gerektiğinde ilgili aşamalar yeniden çalışır.
4. **Non-destructive authoring:** manuel işler korunur; onaysız silme yoktur.
5. **Deterministik üretim:** aynı recipe, seed ve sürümler aynı çıktıyı verir.
6. **Editör verisi ≠ runtime verisi:** üretim editörde yapılır; oyun yalnız sonucu yükler.
7. **Ölçülebilir kalite kapıları.**
8. **Motor bağımsız tasarım bilgisi:** World Plan ve Recipe tek bir panele bağlı değildir.

### 1.1. Kapsam dışı varsayımlar

- Tek perspektif referanstan eksiksiz, fiziksel olarak doğru 3B dünya çıkarıldığı iddia edilmez.
- Referans görseli harita ölçeğini, gizli topografyayı ve zemin fiziğini tek başına sağlamaz.
- AI'ın doğru asset seçmesi garanti değildir; uygun asset yoksa placeholder ve uyarı kullanılır.
- Görsel su, yüzdürme veya araç-su fiziği demek değildir.
- Ölçüm yapılmadan dünya ölçeği ve performans garantisi verilmez.

### 1.2. Mimari sınır `[KARAR v0.3]`

**World Builder bir orkestrasyon katmanıdır; ikinci bir veri modeli değildir.**

- **Çıktı mevcut biçimlerdir:**
  - Level JSON (`layout`), World Terrain tanımı ve tile'lar.
  - Foliage sidecar ve hücreleri.
  - Dünya spline'ları, Water Body'ler, placement ve actor'ler.
  - Hepsi mevcut validator'lardan geçer (`tools/saveValidator.ts`, `verify:world-data`).
- **İşlem mevcut fonksiyonlardır.** Sculpt/erosion (`terrainSculpt.ts`, `terrainErosion.ts`), spline deform/boya (`terrainSplines.ts`), foliage kuralları (`landscapeFoliage.ts`) saf fonksiyon olarak çağrılır. World Builder bunların ikinci bir kopyasını yazmaz.
- **Editör içinde her stage çıktısı tek bir undo işlemidir** (`EditorHistory`). Rollback = undo. Ayrı bir transaction sistemi v1'de kurulmaz.
- **Kendine ait tek yeni veri** recipe ve sahiplik kaydıdır (§6.3): hangi nesneyi/bölgeyi hangi stage'in ürettiği.
- **Katman sınırları korunur:**
  - Üretici mantık `engine/` altında kalır ve editör/oyun import etmez (`verify:imports`).
  - Panel `src/editor/` altında `?editor` arkasında kalır (`verify:dist --strict`).
  - Oyuna özgü kurallar (Offroad rota profilleri) `src/game` ya da proje verisinde yaşar.

---

## 2. Ana kavramlar ve veri otoritesi

| Kavram | Açıklama | Forge karşılığı |
|---|---|---|
| **Reference Pack** | Görsel(ler), açıklama, stil, ölçek varsayımı, oynanış kısıtları | YENİ (`public/` altında asset) |
| **Semantic World Plan** | Dünya sınırı, bölgeler, su ağı, POI, yol bağlantıları, yerleşimler | YENİ |
| **World Recipe** | Parametreler, generator sürümleri, seed, asset katalogları, stage bağımlılıkları | YENİ: `<Level>.worldrecipe.json` (§6.3) |
| **World Generator** | Recipe'yi Forge verisine çeviren yürütücü | YENİ; mevcut saf fonksiyonları çağırır |
| **Spatial Mask** | Yükseklik, eğim, kıvrım, suya/yola mesafe, biyom, exclusion | KISMİ: yükseklik/normal sorgusu (`terrainHeightQuery.ts`), paint ağırlıkları, foliage eğim/yükseklik filtreleri |
| **World Layer** | Base terrain, hidroloji, yol, temel, paint, manuel override | KISMİ: yol/nehir deform patch'leri ayrı veri; base height tek tile verisi |
| **Generated Object** | Kaynak stage + kalıcı kimlik | KISMİ: placement/actor `id` var; `generatedBy` yok |
| **World Validation** | Geometri, bağlantı, çakışma, fizik, görsel, performans | KISMİ: `verify:world-data`, `splineDiagnostics`, içerik doğrulaması |
| **Bake / Commit** | Önizlemeyi onayla kalıcı level verisine çevirme | KISMİ: undo + Save Layout; önizleme diff'i yok |

### 2.1. Veri akışı

```text
REFERANS GÖRSELİ + METİN + OYUN KISITLARI
            │
     [Reference Interpreter]  (AI; editör dışında da çalışabilir)
            ▼
     [Semantic World Plan]  ── kullanıcı kontrolü
            ▼
     [World Recipe]  <Level>.worldrecipe.json
            ▼
 [Stage Runner]  dry-run → preview → apply (tek undo) → validate
            │        mevcut saf işlemler: sculpt/erosion, spline deform/boya,
            │        water body, foliage kuralı, placement
            ▼
   standart level verisi + sahiplik kaydı
            ▼
   Save (mevcut save coordinator) → Play / sürüş testi
```

### 2.2. Katman sahipliği

| Katman | Sahip | Forge'da bugün |
|---|---|---|
| Base heightfield | Macro Terrain stage | Tile yükseklikleri (tek veri, undo patch'li) |
| Terrain detail / erosion | Detail stage | Aynı tile verisine fırçayla yazılır |
| Hidroloji deform | River/Lake stage | Nehir yatağı spline verisinden türetilir; göl mevcut çukuru doldurur |
| Yol deform | Road stage | Dünya spline'ı deform/boya patch'i (8A1) |
| Yerleşim/temel | Settlement stage | YOK (flatten fırçası var) |
| Surface/biome paint | Paint stage | 8 katman ağırlığı |
| Üretilen foliage/props | Scatter stage | `LandscapeFoliageRule` ile türetilen foliage (kayıtlı değil, kuraldan yeniden kurulur) |
| **Manuel override** | Kullanıcı | Elle boyanmış foliage grupları, placement'lar, fırça işleri |

**Gerçek:** Forge'da Unreal "Landscape Edit Layers" gibi tam bir non-destructive yükseklik yığını **yok**. Base height, fırçalar ve erozyon aynı tile verisine yazılır. Yol ve nehir ise kendi verisinden yeniden üretilebilen deform patch'leridir. §10 karar 2 bunu ele alır.

---

## 3. Referanstan level'a 13 aşamalı iş akışı

Sıra çalışma akışıdır; katı tek geçiş değildir.

| ID | Aşama | Üretilen | Forge'daki mevcut araç | Geçiş koşulu |
|---|---|---|---|---|
| **00** | Reference Analysis | Semantik öğeler, kamera/stil tahmini, belirsizlik notları | — (AI) | Hedefler listelenmiş |
| **01** | World Layout & Blockout | Sınır, zonlar, su koridoru, POI, rota alternatifleri | — (YENİ) | Bağlantılar anlamlı, ölçek kabul edilmiş |
| **02** | Scene & Environment Setup | Level, World Terrain grid'i, partition, görüş mesafesi, Sun/Sky/Fog/Cloud, **World Environment** | New Open World sihirbazı (`openWorldSetup.ts`), environment singleton'ları; WES (K1) | Level açılır ve kaydedilir |
| **03** | Macro Terrain | Ana heightfield, sırt/vadi/plato | Heightmap import, noise/terrace/ramp fırçaları | Ölçüler/dikişler geçerli, POI'ler erişilebilir |
| **04** | Hydrology Draft & Carving | Havza, nehir koridoru, göl kotu, yatak | Nehir (8A5), Lake (W1), erozyon | Su kotları/akış tutarlı |
| **05** | Road Network & Conform | Yol grafı, spline'lar, profil, kesme/dolgu, geçit adayları | Dünya spline yolu (8A1–8A4), spline mesh/decoration | Hedefler bağlı; eğim/dönüş araç profiline uygun |
| **06** | Settlement Layout | Köy sınırı, sokaklar, parseller, pedler | Flatten fırçası (manuel) | Yol erişimi, çakışma yok |
| **07** | Terrain Detail & Surface Paint | Erozyon detayı, kaya/çamur/toprak/çim/kar maskeleri | Erozyon fırçası, 8 katman paint + physicalMaterial | Kritik yüzeyler korunuyor |
| **08** | Structure Placeholder | Bina hacimleri, giriş yönleri | Placement + shape actor'leri | Parsel/giriş geçerli |
| **09** | Foliage & Rock Distribution | Ağaç, çalı, ot, kaya kümeleri | Foliage boyama, `LandscapeFoliageRule`, Foliage Type eğim/yükseklik filtreleri | Exclusion alanları boş; bütçe içinde |
| **10** | Props & Dressing | Çit, direk, tabela, yük | Spline modüler tekrar, yol süsleri | Oynanış alanları kapanmamış |
| **11** | AI & Navigation | Rotalar, spawn, nav bölgeleri | AI nav volume, grid nav (sınırlı), spline path follower | Ulaşılabilir spawn, temel AI testi |
| **12** | Final Lighting, Validation & Optimization | Son ışık, görsel kontrol, sürüş testi, perf kaydı | HLOD, view distance, `perf:browser`, `verify:world-data`; WES senaryoları | Kritik testler geçiyor |

### 3.1. Sıra gerekçesi

- Yerleşimin yeri erken seçilir; ev ve sokak yerleşimi sonra kesinleşir.
- Nehir vadiyi ve yolu etkilediği için yolun tamamlanmasını beklemez.
- Yol ve yapı araziyi yerel olarak değiştirir; detay sculpt ve paint onlardan sonra temizlenir.
- Su birikintisi 04'te potansiyel çukur olarak planlanır. Puddle aracı (W3) gelene kadar 07'de ıslaklık boyası ve WES ıslaklığıyla temsil edilir.
- Büyük kayalar 03/07'yi etkiler; küçük ve orta kaya 09'dadır.
- Atmosfer 02'de başlar, son ışık 12'dedir.

### 3.2. Bağımlılık ve kısmi yeniden üretim

- **Nehir yatağı değişirse:** hidroloji deform yeniden üretilir. Ardından etkilenen köprü/yol parçaları, kıyı boyası, kıyı foliage'ı ve props güncellenir. Uzak köyler ve kilitli nesneler silinmez.
- **Köy taşınırsa:** parseller, yol bağlantısı, placeholder'lar ve yeni etki alanındaki foliage güncellenir.

Gerekli mekanizmalar:
- `dependencyGraph`, `dirtyBounds`, `generatedBy`, `preserveManual`, `previewDiff`: YENİ.
- `stableId`: KISMİ (placement/actor `id`).
- `transactionId`: v1'de undo adımı.

Terrain tarafında kirli bölge ve undo patch altyapısı mevcuttur (`engine/terrain/terrainEdit.ts`). `dirtyBounds` bunun üstüne kurulur.

---

## 4. Araç yol haritası — durum işaretli

**Durum:** MEVCUT (kullanılabilir, World Builder yalnız çağırır) · KISMİ (temel var, World Builder için genişletme gerekir) · YENİ.

### 4.1. P0 — World Builder'ın çalışması için gerekli

| ID | Araç | Durum | Kanıt / not | World Builder işi |
|---|---|---|---|---|
| **T01** | World Recipe + Schema Validator | YENİ | — | JSON şeması, sürüm, seed, referans doğrulama; mevcut normalizer kalıbıyla |
| **T02** | Stage Runner / Job Graph | YENİ | — | `plan → dryRun → preview → apply (tek undo) → validate` |
| **T03** | Non-Destructive Terrain Layers | KISMİ | Yol/nehir deform verisi ayrı ve yeniden üretilebilir; base height tek veri | v1: §10-2'deki "recipe + bake + korunan bölge" modeli; tam layer yığını ertelenir |
| **T04** | Spatial Query & Mask Toolkit | KISMİ | `terrainHeightQuery.ts` (yükseklik/normal/katman ağırlığı), foliage eğim/yükseklik filtreleri | Mesafe alanları (yola/suya), kıvrım, exclusion maskeleri; worker'da |
| **T05** | Spline Road – büyük terrain | **MEVCUT** | 8A0–8A4 `[x]` | Yalnız programatik API: recipe'den spline oluşturma |
| **T06** | River / Lake / Pond – büyük terrain | KISMİ | River 8A5 `[x]`, Lake W1 `[x]`; puddle/ocean yok | API + W3 Puddle (Water planı) |
| **T07** | Stable IDs + Generated Ownership | KISMİ | Placement/actor `id` (`editor/core/ids.ts`); foliage grubu `id`; instance'ta id yok | `generatedBy {recipeId, stageId}` sahiplik kaydı (§6.3); foliage için grup düzeyi |
| **T08** | World Validation & Diagnostics | KISMİ | `verify:world-data`, `splineDiagnostics.ts`, içerik doğrulaması | Yol eğimi/dönüş, su-kıyı, çakışma, erişilebilirlik kontrolleri |
| **T09** | Asset Catalog Metadata | KISMİ | Manifest `category`, `tags`, `placement` | Biyom, boyut sınıfı, semantik rol, Foliage Type bağlantısı, WES mevsim varyantı |
| **T10** | Preview / Diff / Bake / Rollback UI | KISMİ | Undo/redo + Save; görsel diff yok | Stage önizleme katmanı, değişiklik özeti, kabul/geri al |

### 4.2. P1 — İlk kullanışlı sürüm

| ID | Araç | Durum | Kanıt / not |
|---|---|---|---|
| **T11** | Procedural Macro Terrain | KISMİ | Heightmap import + `noise/terrace/ramp` fırçaları. Recipe'den bölge maskeli makro üretim YENİ |
| **T12** | Erosion / Sediment | **MEVCUT** (fırça) | `terrainErosion.ts` termal + hidrolik. Bölge/recipe çağrısı küçük iş |
| **T13** | Flow / Drainage Analyzer | YENİ | Akış yönü/birikimi, havza, çukur tespiti. Global map üzerinden worker |
| **T14** | Road Cost Map & Route Solver | YENİ | Araç profili Offroad verisinden (`src/game`/proje) okunur |
| **T15** | Junction & Cross-Section | KISMİ | Spline mesh bükme + yol süsleri var; gerçek kavşak yok |
| **T16** | Bridge / Culvert / Ford | YENİ | Placeholder ilk adım |
| **T17** | Shoreline & Wetness | KISMİ | Göl kıyısı (W1), ıslak çamur katmanı (deformasyon planı), WES ıslaklığı (görsel) |
| **T18** | Settlement & Parcel | YENİ | — |
| **T19** | Biome Rules + PCG Scatter | KISMİ | `LandscapeFoliageRule` (paint katmanı → Foliage Type, yoğunluk), `proceduralFoliage.ts`, eğim/yükseklik filtreleri. Çok maskeli biyom kuralı ve exclusion YENİ |
| **T20** | Exclusion / Clearance Volumes | YENİ | Foliage ve placement için ortak hacim/maske |
| **T21** | Road & Building Conform | KISMİ | Spline deform (yol) MEVCUT; bina pedi için flatten/terrace fırçası manuel |
| **T22** | Actor/Navigation Authoring | KISMİ | AI nav volume, grid nav (`MAX_GRID_CELLS = 20000`), spline path follower; tile'lı nav OPEN_WORLD Faz 9 |
| **T23** | World Overview / Debug Map | KISMİ | World Partition paneli + minimap (`worldMapView.ts`). Semantik katmanlar (POI, yol grafı, hata) YENİ |

### 4.3. P2 — Görsel kalite, ölçek, otomasyon

| ID | Araç | Durum | Kanıt / not |
|---|---|---|---|
| **T24** | Advanced Biome Blending | KISMİ | 8 katman paint. Mevsimsel görünüm WES'in işi (WES v0.3 §8–9) |
| **T25** | Procedural Props / Rule Grammars | KISMİ | Spline modüler tekrar + yol süsleri |
| **T26** | Cliff / Overhang Mesh | YENİ | Delik maskesi OPEN_WORLD Faz 10 `[ ]` |
| **T27** | Terrain Material & Physical Surface Map | **MEVCUT** | Paint katmanı `physicalMaterial` → `terrainSurface.ts` → tekerlek tepkisi; yumuşak zemin profilleri |
| **T28** | Water Gameplay Profiles | YENİ | Görsel sudan ayrı (Water planı "ilk sürüm dışı") |
| **T29** | Streaming / LOD / HLOD Diagnostics | **MEVCUT** | World Partition, HLOD, view distance, `?debug` perf araçları |
| **T30** | Reference Camera Matching | YENİ | — |
| **T31** | Automatic Review Agent | YENİ | Playwright ekran görüntüsü altyapısı (`tests/smoke`) temel olabilir |
| **T32** | World Templates & Presets | KISMİ | `templates/game-starter`, starter level'lar; reçete şablonu yok |
| **T33** | World Generation Profiler | KISMİ | `engine/perf/*`, `perf:browser`; stage başına ölçüm YENİ |

Özet: 4 MEVCUT (T05, T12, T27, T29), 18 KISMİ, 11 YENİ (T01, T02, T13, T14, T16, T18, T20, T26, T28, T30, T31). KISMİ araçların çoğu için temel işlem zaten var; eksik olan, recipe'den çağrılabilen API ve sahiplik kaydıdır.

### 4.4. Yeniden sıralanmış ilk teknik sıra `[KARAR v0.3]`

1. **F1 çekirdeği:** Recipe (T01) + Stage Runner (T02) + sahiplik kaydı (T07) + stage önizlemesi (T10). Bunlar olmadan diğer her araç tek seferlik bir makrodur.
2. **Mevcut araçları stage'e bağlama:** T05 yol, T06 nehir/göl, T12 erozyon, T19 paint→foliage kuralı. Yeni geometri yazılmaz; programatik çağrı ve sahiplik eklenir.
3. **Maskeler ve doğrulama:** T04 + T08 + T20. Diğer üreticilerin ortak girdisi ve güvenlik ağıdır.
4. **Makro arazi ve akış:** T11 + T13.
5. **Rota çözücü ve geçitler:** T14 + T15 + T16. Offroad'ın asıl değeri burada.
6. **Yerleşim:** T18 + T21.
7. **AI planlayıcı ve otomatik inceleme:** T30–T31.

P0/P1/P2 takvim değildir. Sıra, F1 prototipinden sonra yeniden değerlendirilir.

---

## 5. Alt sistem gereksinimleri

### 5.1. Landscape ve terrain

- Dünya metresi ↔ tile koordinatı dönüşümü ortak serviste olmalı. Mevcut: `engine/terrain/terrainTypes.ts`, `terrainHeightQuery.ts`.
- Yükseklik, normal, eğim ve katman sorgusu collider ile aynı son yüzeyi okur. OPEN_WORLD K3a ilkesi; mevcut.
- Üretim yalnız kirli bölgeyi yeniden hesaplar (`terrainEdit.ts` patch'leri).
- Büyük şekiller coarse-to-fine üretilir.
- Heightfield dik ve altı boş geometriyi temsil edemez (T26).
- Yükseklik özeti tutarlılığı korunmalı: tile yeniden yazımı `minHeight/maxHeight`'ı bozarsa editör level'ı reddeder; `npm run terrain:repair`. Stage Runner tile ve tanımı aynı save sırasında yazar.

### 5.2. Yol sistemi

- Bağlantı grafı (YENİ) ve spline/mesh geometrisi (MEVCUT) ayrı tutulur.
- Segment profili şu alanları içerir: `roadClass`, `width`, `shoulder`, `surfaceType` (→ paint katmanı + physicalMaterial), `maxSlope`, `minTurnRadius`, `allowedVehicleClasses`.
- Kavşaklar ayrı işlem görür; iki spline'ın kesişmesi kavşak sayılmaz.
- Sürüş testi geometri testinden ayrıdır. Ağır yük aracı Offroad verisinden gelir.

### 5.3. Su

- **Nehir:** MEVCUT (yatak, yüzey, akış).
- **Göl:** mevcut çukuru doldurur. Yatak oyma kullanıcı kararıyla kaldırıldı. World Builder gölü **önce çukuru sculpt/erozyonla hazırlayıp** sonra Lake aracını çağırarak üretir.
- **Su birikintisi:** W3 bekleniyor; geçici çözüm ıslak paint + WES ıslaklığı.
- **Ayrım:** su görseli, hidroloji planı ve su fiziği üç ayrı sorumluluktur.

### 5.4. Foliage, kaya ve props

- Scatter girdileri: paint katmanı ağırlığı (MEVCUT kural), yükseklik ve eğim (Foliage Type filtreleri, MEVCUT), yola/suya mesafe ve exclusion (YENİ).
- Kural üretimli foliage kayıtlı değildir; kuraldan yeniden kurulur. Bu, World Builder için **doğal non-destructive** bir yoldur. Elle boyanan gruplar manuel override sayılır.
- Seed ile tekrarlanabilirlik: instance'ta `seed` alanı var.
- Mevsim varyantları Foliage Type'ta yaşar (WES v0.3 §8.1). World Builder mevsim başına scatter yapmaz.

### 5.5. Yerleşim ve yapılar

- **Makro:** köy merkezi, sınır, ana yol bağlantısı, taşkın/yükseklik uygunluğu.
- **Mezo:** sokak, parsel, depo, servis alanı.
- **Mikro:** placeholder, giriş, temel (flatten), kapı önü boşluğu.
- Model yoksa semantik placeholder kullanılır. Model sonra değiştirilince placement `id` ve giriş yönü korunur.

---

## 6. AI ile çalışma sözleşmesi

### 6.1. AI'ın görevi

1. Referansı analiz etmek; **gözlenen** ve **tahmin edilen** unsurları ayırmak.
2. Ölçek, coğrafya ve kısıtlardan World Plan önermek.
3. Mevcut araç ve asset kataloğunu sorgulamak; olmayan API veya asset uydurmamak.
4. Sürüm doğrulanmış Recipe üretmek ve stage'leri sırayla çalıştırmak.
5. Hata/uyarı raporunu incelemek; kritik kusurda kullanıcı onayı istemek.
6. Değişiklikleri ve test sonuçlarını raporlamak.

**Yapmaması gerekenler:**
- Var olmayan motor özelliğini çalışıyor saymak.
- Kullanıcı editlerini silmek.
- Test edilmemiş su/zemin fiziğine dayalı oynanış sonucu bildirmek.

### 6.2. Komut yüzeyi — taslak, mevcut API değildir

```text
world.inspectCapabilities()          // §0.1 tablosunu runtime'da üretir
world.inspectAssets(filters)
world.analyzeReference(referencePack)
world.createPlan(constraints)
world.validatePlan(plan)
world.createRecipe(plan, generatorVersions, seed)
world.previewStage(stageId, region?)
world.executeStage(stageId, region?, dryRun?)   // editörde tek undo adımı
world.validate(stageId | "all")
world.diff(stageId)
world.rebuildAffected(changedIds)
world.save(levelId)                  // mevcut save coordinator
```

`world.commit/rollback` v1'de undo/redo ve Save Layout ile karşılanır.

**Erişim yolu `[ÖNERİ]`:**
- İlk sürümde AI (Claude/Codex) komutları **editör dışında** recipe dosyası yazarak verir.
- Editörün World Builder paneli recipe'yi okur, stage'leri kullanıcı onayıyla çalıştırır.
- Dev sunucusunda yazan yeni endpoint'ler (`/__save-worldrecipe`) mevcut privileged/local-only middleware ve validator kuralına tabidir.

### 6.3. Recipe ve sahiplik kaydı `[ÖNERİ]`

**Yer:** `<Level>.worldrecipe.json` sidecar. Gerekçe:
- Recipe level'dan büyük olabilir ve ayrı bir yaşam döngüsü vardır (AI yeniden üretir).
- Level JSON'unu şişirmemelidir.

Bu, yeni bir allowlist yüzeyi ve endpoint'tir. Normalizer tek kaynak olur; `droppedFields`/`serializationDrift` kapsamına girer.

```json
{
  "schemaVersion": 1,
  "recipeId": "mountain_delivery_demo",
  "seed": 42017,
  "generators": { "macroTerrain": 1, "roads": 1, "scatter": 1 },
  "reference": { "assetId": "ref_mountain_valley_01", "cameraMatch": "approximate" },
  "world": { "units": "meters", "size": { "x": 512, "z": 512 }, "terrainPreset": "mountain_valley" },
  "landmarks": [
    { "id": "depot_01", "kind": "logistics", "zone": "valley_low" },
    { "id": "village_01", "kind": "settlement", "zone": "hillside" }
  ],
  "water": [{ "id": "river_01", "kind": "river", "followValley": true }],
  "routes": [
    { "id": "route_safe", "from": "depot_01", "to": "village_01", "profile": "safe" },
    { "id": "route_short", "from": "depot_01", "to": "village_01", "profile": "challenging" }
  ],
  "environment": { "season": "summer", "hour": 10 },
  "generation": {
    "preserveManualOverrides": true,
    "previewBeforeCommit": true,
    "stages": ["terrain", "hydrology", "roads", "settlement", "surface", "scatter", "props", "validation"]
  },
  "ownership": {
    "placements": { "plc-123": { "stage": "props", "inputHash": "…" } },
    "splines":    { "road-route_safe": { "stage": "roads", "inputHash": "…" } },
    "foliageRules": { "rule-meadow": { "stage": "scatter" } },
    "protectedRegions": [{ "kind": "manual", "bounds": [[0,0],[64,64]] }]
  }
}
```

- `ownership` kaydında olmayan her nesne **manuel** sayılır; World Builder onu silmez ve taşımaz.
- `512 × 512 m` yalnız örnektir.
- `environment` bloğu WES'in `worldEnvironment` actor'üne öneri olarak uygulanır (WES v0.3 §14).

### 6.4. İlk geliştirme görevi — örnek iş tanımı

> Forge reposunda `CLAUDE.md`/`AGENTS.md` kurallarına uy ve `main` üzerinde çalış.
>
> **F1 kapsamı (yalnız bunlar):**
> 1. `engine/worldbuilder/` altında three'siz recipe normalizer'ı ve sahiplik kaydı.
> 2. Tek stage'li bir Stage Runner. Önce `roads` stage'i: recipe'deki iki noktayı mevcut dünya spline yolu API'siyle bağlar ve tek undo adımı üretir.
> 3. `dryRun` raporu.
> 4. `world.inspectCapabilities()`.
>
> **Doğrulama:** mevcut sahneler ve kayıt biçimleri değişmez. Yeni sidecar allowlist'e ve drift testlerine girer. `WbTestValley` adlı yeni bir fixture level kullanılır.
>
> **Kapı:** `npx tsc --noEmit`, `npm run test:engine`, `npm run build:verify`, yeni smoke spec.

---

## 7. Doğrulama ve kabul

### 7.1. Stage raporu

```text
Stage ID | Recipe hash | Generator sürümü | Seed
Üretilen/değişen nesne sayısı | Etkilenen tile/hücre sınırları
Uyarılar | Hatalar | Süre | Bellek gözlemi
Doğrulama sonucu | Manuel override korundu mu (sayı)
Önizleme ekran görüntüsü | Undo sonrası durum
```

### 7.2. Test matrisi

| Test | Beklenen kanıt | Altyapı |
|---|---|---|
| **WB-01 Determinism** | Aynı recipe/seed/sürüm → aynı terrain byte'ları ve aynı kimlikler | engine testi (tile hash) |
| **WB-02 Idempotency** | Stage ikinci kez çalışınca mükerrer nesne yok | engine testi (sahiplik kaydı) |
| **WB-03 Road Conform** | Yol ile heightfield/collider kopuk değil | mevcut 8A4 testleri genişletilir |
| **WB-04 Water Terrain Fit** | Nehir/göl kotu ve kıyı tutarlı | mevcut lake/river testleri |
| **WB-05 Cross-Tile** | Spline, su, paint, foliage tile sınırında kopmuyor | `terrain-multitile.spec.ts` kalıbı |
| **WB-06 Settlement Access** | Her parsel yola ve POI'ye bağlı | YENİ graf testi |
| **WB-07 Scatter Exclusion** | Yol/giriş/su alanında büyük foliage yok | YENİ maske testi |
| **WB-08 Manual Preservation** | `ownership` dışı nesneler ve korunan bölgeler değişmemiş | engine testi (önce/sonra diff) |
| **WB-09 Partial Rebuild** | Tek nehir/POI değişikliği yalnız bağımlı bölgeleri değiştiriyor | `dirtyBounds` testi |
| **WB-10 Save/Reload** | Editor → save → reload → Play; referanslar korunuyor; `verify:world-data` yeşil | smoke |
| **WB-11 Runtime Drive Test** | Offroad aracı en az bir üretilmiş rotayı geçiyor | `vehicle*.spec.ts` kalıbı |
| **WB-12 Performance** | FPS/frame, heap, collider, yükleme ölçülmüş | `perf:browser`, OPEN_WORLD bütçe tablosu |

### 7.3. Kalite boyutları

- **Yapısal:** yol, su, POI ve yerleşim bağıntıları doğru.
- **Mekânsal:** çakışma, diklik, su seviyesi, erişim ve sınır dikişi doğru.
- **Görsel:** referansa makul benzerlik var.
- **Oynanış:** rotalar araç profiline göre anlamlı seçenekler sunuyor.
- **Teknik:** runtime stabil, kayıt geçerli, bütçeler ölçülmüş.

---

## 8. İlk prototip: Mountain Delivery

**Amaç:** mevcut açık dünya, spline yol ve su araçları üzerinde tek bir referanstan aşamalı ve düzenlenebilir küçük bir nakliye bölgesi üretmek.

**İçerik:**
- Coğrafya: vadi, iki yükselti bandı, nehir.
- Yerleşim: köy placeholder alanı, lojistik depo.
- Yollar: iki rota profili, bir köprü veya sığ geçit placeholder'ı.
- Doğa: orman ve kaya dağılımı.
- Test: bir sürüş kontrol rotası.

**Fixture `[KARAR v0.3]`:**
- Yeni bir `WbTestValley` level'ı kullanılır. `LandscapeTest` ve `OffroadTest` level'larına **dokunulmaz**; asset'leri yeniden kullanılır (`public/assets/LandscapeTest/*`, araç asset'leri).
- 2×2 tile World Terrain, partition kapalı: streaming riski F6'ya kalır.

**Üretim sırası:**
1. Plan ve 2–3 kontrol noktasıyla kullanıcı değerlendirmesi.
2. Recipe ve 02 setup (sihirbaz fonksiyonları).
3. 03 makro arazi (heightmap ya da noise) ve 04 nehir.
4. 05 iki rota (mevcut dünya spline yolu).
5. 06/08 depo ve köy pedi (flatten) ile placeholder'lar.
6. 07 paint ve 09 kural foliage'ı.
7. Save/reload ve sürüş testi.

**İlk başarı tanımı:**
- Aynı referansla tutarlı bir level oluşuyor.
- Yol veya köy taşınınca yalnız etkili bölge güncelleniyor.
- Manuel override korunuyor.
- Sahne kaydedilip sürülebiliyor.

### 8.1. Büyük dünya aşaması

Çok tile, partition açık ve uzun rota. Streaming, collider aktivasyonu, foliage yoğunluğu, tile sınırında spline/su bağlantıları ve uzun sürüş bellek testi yapılır. Altyapı OPEN_WORLD_PLAN ile mevcuttur. World Builder'a özgü risk, stage'lerin yüklü olmayan tile'larla çalışmasıdır (`TerrainEditorStreaming`: düzenlenen tile'lar oturum boyunca yüklü kalır).

---

## 9. Uygulama fazları

| Faz | Teslim | Çıkış kapısı | Durum |
|---|---|---|---|
| **F0 — Envanter** | Mevcut araçların gerçek kapasitesi | §0.1 ve §4 | **Bu belgeyle büyük ölçüde kapandı.** Kalan: T04/T07/T09 API ayrıntıları F1 başında |
| **F1 — Recipe çekirdeği** | Şema, sahiplik kaydı, tek stage'li runner (`roads`), dry-run, tek undo, `inspectCapabilities` | Aynı recipe güvenle tekrar çalışıyor (WB-01/02/08) | Sıradaki |
| **F2 — Terrain + Roads + Water** | 03/04/05/07 stage'leri mevcut araçlarla | Test level'ı tekrar üretilebilir; dikişler geçerli (WB-03/04/05) | — |
| **F3 — Spatial + Settlement** | Maske/mesafe alanı, akış, rota çözücü, kavşak/geçit, parsel/ped | Yol ve köy bağlantıları doğrulanıyor (WB-06/09) | — |
| **F4 — PCG Nature & Props** | Biyom kuralları, exclusion, props, asset metadata | Dağıtım tekrarlanabilir, çakışma kontrolü geçiyor (WB-07) | — |
| **F5 — AI Director** | Görselden plan/recipe, ekran görüntüsü karşılaştırma | Referans → test level uçtan uca | — |
| **F6 — Scale** | Büyük dünya, streaming altında stage'ler, profiler | Hedef cihazda uzun sürüş ve bütçeler ölçülmüş (WB-12) | — |

Fazlar bağımlılığa göre paralel ilerleyebilir; takvim taahhüt edilmez. **WES (K1–K3) World Builder'ı beklemez.** World Builder–WES bağı WES K4'tür.

---

## 10. Açık tasarım kararları — v0.3 durumu

| # | Soru | v0.3 durumu |
|---|---|---|
| 1 | Recipe nerede saklanacak? | `[ÖNERİ]` `<Level>.worldrecipe.json` sidecar + sahiplik kaydı (§6.3). F1'de onay |
| 2 | Katman modeli: tam non-destructive mi, hibrit mi? | `[KARAR v0.3 — öneri olarak]` **Hibrit:** base height ve detay tile'a bake edilir. Yol/nehir kendi verisinden yeniden üretilen patch olarak kalır (MEVCUT). Manuel fırça işleri `protectedRegions` ile korunur. Tam edit-layer yığını, F2 sonunda ihtiyaç kanıtlanırsa ayrı plan olur |
| 3 | Su oyma ile yol deformunun sırası ve çatışması | KISMİ: ikisi de MEVCUT ve ayrı veri. Sıra kuralı (önce su, sonra yol, köprüde yol kazanır) F2'de testle sabitlenir |
| 4 | Üretim birimi ve undo sınırı | `[KARAR v0.3]` Stage başına tek undo adımı; birim etkilenen tile seti |
| 5 | AI girdisi: görsel mi, semantik harita mı, metin+şablon mu? | `[AÇIK]` Öneri: F1–F4 metin + şablon; görsel F5 |
| 6 | Belirsiz bilgilerin kullanıcıya sunumu | `[AÇIK]` Öneri: World Builder panelinde "varsayım" listesi + minimap üstünde işaretler (T23) |
| 7 | Fiziksel zemin ↔ görsel paint eşlemesi | **Kapandı:** paint katmanı `physicalMaterial` taşır (T27 MEVCUT) |
| 8 | Hedef cihaz, dünya boyutu, bütçeler | KISMİ: OPEN_WORLD_PLAN bütçe tablosu (orta masaüstü, 60 Hz, 4 km) baz alınır; World Builder'a özgü üretim süresi `[AÇIK]` |
| 9 | Foliage/props: instance mı actor mı? | `[KARAR v0.3]` Doğa = Foliage Type + kural (kayıtsız, yeniden kurulur) ya da boyanmış grup. Etkileşimli/gameplay nesnesi = placement/actor |
| 10 | AI'ın yazma/commit yetkisi | `[KARAR v0.3]` AI yalnız recipe yazar. Uygulama editörde kullanıcı onayıyla, stage başına tek undo adımıyla yapılır. Otomatik Save yoktur |

---

## 11. Kaynaklar

**Repo içi:** §0.1 ve §4'teki dosya yolları;
[OPEN_WORLD_PLAN.md](../OPEN_WORLD_PLAN.md);
[WORLD_TERRAIN_WATER_BODY_PLAN.md](../WORLD_TERRAIN_WATER_BODY_PLAN.md);
[TERRAIN_DEFORMATION_PLAN.md](../TERRAIN_DEFORMATION_PLAN.md);
[Forge_Water_System](../Forge_Water_System/README.md);
`docs/architecture/ARCHITECTURE.md`; `CLAUDE.md`.

**Repo dışı (tarihli bağlam):** Forge Offroad GDD v0.3; `01_GAME_VISION_AND_PILLARS_v0.2.md`; Forge Offroad teknik durum raporu 2026-10-23 (commit `84ff7cf`, güncel kodun yerine geçmez); 25 Ekim 2026 proje görüşmesi.

**Dış yöntem referansları (Forge'da hazır özellik kanıtı değildir):**
1. SideFX — [Realistic terrain with heightfields](https://www.sidefx.com/docs/houdini/model/terrain_workflow.html)
2. SideFX — [Building terrain with height fields](https://www.sidefx.com/docs/houdini/model/heightfields.html)
3. Epic — [Landscape Edit Layers](https://dev.epicgames.com/documentation/en-us/unreal-engine/landscape-edit-layers-in-unreal-engine)
4. Epic — [PCG Framework](https://dev.epicgames.com/documentation/en-us/unreal-engine/procedural-content-generation-framework-in-unreal-engine)
5. Epic — [PCG Data Types](https://dev.epicgames.com/documentation/unreal-engine/procedural-content-generation-framework-data-types-reference-in-unreal-engine)
6. Epic — [Water System](https://dev.epicgames.com/documentation/unreal-engine/water-system-in-unreal-engine)
7. Epic — [World Partition](https://dev.epicgames.com/documentation/unreal-engine/world-partition-in-unreal-engine)

---

## 12. World Environment System (WES) entegrasyonu

Ayrıntı: [WES v0.3](FORGE_WORLD_ENVIRONMENT_MEVSIM_HAVA_ZAMAN_TEKNIK_TASARIM_VE_UYGULAMA_PLANI_v0.3.md).

### 12.1. Onaylı WES kararları (özet)

1. Kademeli: manuel mevsim/hava + gün–gece; otomatik hava sonra.
2. Hibrit varlık: materyal, gerekirse mesh; dört GLB zorunlu değil.
3. Kar önce görsel; fizik sonra.
4. Önce masaüstü WebGL2.
5. WES genel Engine/Editor yeteneğidir.

### 12.2. Sorumluluklar

| Alan | World Builder | WES |
|---|---|---|
| Arazi | Yükseklik, paint, physicalMaterial | Base veriye dokunmayan kar/ıslaklık görünümü (uniform overlay) |
| Doğa varlıkları | Foliage Type seçimi, kural/boyama, exclusion | Foliage Type'taki mevsim varyantını çözer; scatter'a dokunmaz |
| Çevre | Stage 02'de `worldEnvironment` önerisi | Saat, güneş, gök, sis, bulut, hava, örtü |
| Fizik | Paint `physicalMaterial` (MEVCUT) | K6'ya kadar yok; sonra surface provider eki |
| Kayıt | Recipe sidecar + standart level verisi | Level içi `worldEnvironment` singleton'ı |

### 12.3. Stage bağlantıları

| Stage | WES bağı |
|---|---|
| 02 | `worldEnvironment` actor'ü önerisi (recipe `environment` bloğu); WES'in undo/önizleme kuralları |
| 07 | Kar kabul/yükseklik parametreleri; K4'te bölgesel örtü maskesi kaynakları |
| 09 | Foliage Type seçimi; mevsim varyantları tipte yaşar |
| 12 | Yaz-öğle / kış-kar / gece senaryolarında ekran görüntüsü ve perf kaydı |

Yeni stage gerekmez. Mevsim değiştirmek stage'leri yeniden çalıştırmaz. WES World Builder'ın verisine yazmaz. Bağ WES K4 ve World Builder F2+ ile kurulur.

---

## 13. Değişiklik kaydı

| Sürüm | Tarih | Not |
|---|---|---|
| **0.3** | 27.10.2026 | `main@f9aa05f` repo doğrulaması: durum tablosu kodla değiştirildi; T01–T33'e durum/kanıt eklendi (4 MEVCUT, 18 KISMİ, 11 YENİ); "orkestrasyon katmanı" sınırı; 13 aşamaya mevcut araç sütunu; hibrit katman modeli, recipe/sahiplik sidecar önerisi, stage başına tek undo; açık kararlardan 5'i kapandı ya da karara bağlandı; `WbTestValley` fixture; WES v0.3 bağı. |
| 0.2 | 26.10.2026 | WES entegrasyon eki, onaylı dört WES kararı, stage bağlantıları. |
| 0.1 | 25.10.2026 | Vizyon, 13 aşama, 33 araç, mimari, fazlar ve kabul testleri. |

**Belge bakım ilkesi:** yeni kararlar ve repo doğrulamaları `[KOD] / [PLAN] / [KARAR] / [ÖNERİ] / [AÇIK]` etiketleriyle kaydedilir. Kod uygulanmadan bir araç "MEVCUT" yapılmaz.
