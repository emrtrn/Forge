# FORGE WORLD BUILDER
## AI destekli, prosedürel ve düzenlenebilir açık dünya / level üretim sistemi

**Belge:** `FORGE_WORLD_BUILDER_TASARIM_VE_TEKNIK_PLAN_v0.4.md`
**Sürüm:** 0.4 — yerleşim, yol ağı, bölge profili ve referans görselinden başlama
**Tarih:** 28 Ekim 2026
**Doğrulanan kod:** `main` @ `f9aa05f` (v0.3); v0.4 eklemeleri `main` @ `385c7169` üzerinde kontrol edildi
**İlk kullanım senaryosu:** Forge Offroad (lojistik ve taşımacılık; izole dağ yerleşimleri)
**Uzun vadeli kapsam:** Farklı oyun türlerinde yeniden kullanılabilir world/level üretimi
**Durum:**
- Tasarım önerisidir; World Builder'a özgü kod (recipe, stage runner, generator) **yoktur**.
- Bu sürümde üzerine kurulacağı editör araçlarının gerçek durumu kodla işaretlendi.

**İlgili:** [WES v0.3](FORGE_WORLD_ENVIRONMENT_MEVSIM_HAVA_ZAMAN_TEKNIK_TASARIM_VE_UYGULAMA_PLANI_v0.3.md) · [OPEN_WORLD_PLAN](../OPEN_WORLD_PLAN.md) · [WORLD_TERRAIN_WATER_BODY_PLAN](../WORLD_TERRAIN_WATER_BODY_PLAN.md) · [TERRAIN_DEFORMATION_PLAN](../TERRAIN_DEFORMATION_PLAN.md) · [Forge Water System](../Forge_Water_System/README.md)

> **Etiketler**
> - `[ONAYLANDI]`: kullanıcı kararı. Yeniden açılmaz.
> - `[KOD]`: repoda doğrulandı (dosya yolu verilir).
> - `[PLAN]`: başka bir repo planında kayıtlı durum.
> - `[KARAR v0.3]`: bu sürümde gerekçeli alınan mühendislik kararı.
> - `[ÖNERİ]`: uygulama önerisi.
> - `[AÇIK]`: karar bekleyen konu.
>
> Bir aracın bu belgede önerilmesi, Forge'da olmadığı anlamına gelmez. §4'teki **Durum** sütunu neyin var olduğunu söyler.

---

## 0. Ne değişti

### v0.4 (28 Ekim 2026)

1. **Yerleşim ve yol ağı tasarlandı (§13).** v0.3'te bu konu üç satırlık bir iskeletti (§5.5, T18 "YENİ"). Şimdi:
   - L0–L7 bilgi katmanları: bölge profili → yerleşim programı → yer seçimi → yol ağı → ada/parsel → arazi kullanımı → yapı placeholder'ı → sokak donatısı.
   - Veri sözleşmeleri ve algoritmalar.
   - Placeholder'dan modele geçiş ve "gereken model listesi" dışa aktarımı.
2. **Kullanıcı kararları işlendi (§10, karar 11–13):**
   - İlk hedef köy/kasaba; şehir ölçeği sonra.
   - İlk girdi AI ile üretilmiş açık dünya görseli; OpenStreetMap ikinci kaynak, ölçek değiştirilerek.
   - Plan girişi hibrit: AI/OSM taslak üretir, kullanıcı editörde düzeltir, üreticiler doldurur.
3. **Kod bulgusu: placement'ların kalıcı kimliği yok** (§0.1, §13.4). `LayoutPlacement`'ta `id` alanı yok; v0.3'teki "placement `id` korunur" varsayımı (§5.5, T07, §6.3 örneği) yanlıştı.
4. **Yeni araçlar T34–T41 (§4.5)** ve yeni testler WB-13–WB-19 (§7.2).
5. **Fazlar yeniden sıralandı (§9):** referanstan plan (F1b) öne alındı; F3 yol ağı, yerleşim, model listesi ve OSM olarak bölündü.
6. **Hazır asset beklenmez.** Seviye semantik rollerle ve renkli placeholder'larla kurulur; bölgeye özgü modeller sonra üretilir (§13.7).

### v0.3 (27 Ekim 2026)

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
| World Recipe şeması | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 2) | `engine/worldbuilder/recipe.ts` (`normalizeWorldRecipe`, `worldRecipePath`, `createWorldRecipe`): plan (bölge/su/işaret/yerleşim/yol grafı, kaynak + güven), üretilen parseller, sahiplik kaydı, korunan bölgeler; `/__save-worldrecipe` (açık level, sıkı doğrulama); `tests/engine/worldRecipe.test.ts` |
| Bölge profili şeması | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 3) | `engine/worldbuilder/regionProfile.ts` (`normalizeRegionProfile`, `landUseCompatibility`): yol, trafik, sokak deseni, parsel, imar, hane, program, roller (`storeys [0,0]` = yapısız açık alan), sokak donatısı. Ortak sözlük `vocabulary.ts`, ortak normalizer yardımcıları `normalize.ts`. Nötr test profili `tests/engine/fixtures/neutral.regionprofile.json`; `tests/engine/regionProfile.test.ts`. Kayıt yüzeyi yok (editör yalnız okur) |
| Stage Runner çekirdeği | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 5a; spline çıktısı adım 6a) | `engine/worldbuilder/stage.ts`: `planStage` (dry-run: eklenen/güncellenen/silinen/değişmeyen, elle düzenlenmiş/silinmiş/korunan → bırakılır, manuel/başka aşama/korunan/kilitli arazi → engellenir, sınır kutusu, hata listesi) + `applyPlacementGroupChanges` (grup başına önce/sonra, undo grup sırasını korur). Placement ve World Terrain spline'ı aynı kuralla uzlaştırılır (`reconcile`); sahiplik `ownership.placements` / `ownership.splines` (`edge` ile). Spline değişikliği arazi başına bütün liste olarak önce/sonra taşınır. Elle düzenleme tespiti sahiplik `outputHash`'i ile; üretilen dönüşüm kayıtla aynı yuvarlanır, üretilen spline `normalizeTerrainSplines`'tan geçer. İlk aşama `stages/planBlockout.ts` (plan öğelerine işaret küpü). `tests/engine/worldStage.test.ts` (WB-01/02/08) |
| Stage Runner editör bağı | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 5b; spline adım 6b) | `src/editor/worldBuilderSession.ts` (level açılınca recipe + profil yüklenir; Dry Run, Apply = level + arazi spline'ları + recipe tek undo adımı; Reload From Disk kaydedilmemiş değişiklikte reddedilir). Spline'ları `SceneApp.applyWorldBuilderSplineChanges` yazar (seçim/araç değişmez; tanım kirli işaretlenir, spline mesh/overlay/nehir yeniden kurulur). Save Layout sırası: recipe → World Terrain tanımları → level (`editorSaveCoordinator.ts`). Outliner'da **World Builder** sekmesi (`src/editor/panels/world/worldBuilderPanel.ts`: recipe durumu, profil, aşamalar, son plan raporu). `tests/engine/worldBuilderSession.test.ts`, `tests/smoke/world-builder.spec.ts` |
| Yol aşaması | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 6) | `engine/worldbuilder/stages/roads.ts`: her `plan.roadGraph` kenarı başlangıç düğümünün altındaki World Terrain'de bir dünya koordinatlı spline olur (`wb-road-<kenar>`). Rota: guide noktaları, yoksa düz çizgi; en çok 10 m'de bir nokta, yükseklik araziden. Genişlik profilden (şerit + 2 × banket), segmentlerde profilin `meshAsset`'i (mesh + çarpışma), `surfaceLayer` boyası ve deform ayarı. **Karar 19: yalnız spline verisi;** aşama araziyi kazmaz/boyamaz, Deform/Paint bugünkü elle düğmeler. Eğim/A* rota çözücü YOK (T14, ayrı adım). `tests/engine/worldRoads.test.ts` |
| Preview diff (viewport'ta), yerleşim/rota üreticileri | YOK | Bu belgenin konusu |
| Placement kimliği | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 1): `LayoutPlacement.id?` + `role?`, `engine/scene/placementIdentity.ts`, `validatePlacement` (layout içinde tekil), çoğaltma yeni `id` alır, `tests/engine/placementIdentity.test.ts`. v0.4 bulgusu, öncesi: | `LayoutPlacement` (`engine/scene/layout.ts`) `id` taşımaz; placement'lar `LayoutModelInstances { assetId, placements[] }` altında asset'e göre gruplanır. Yalnız ebeveyn olunca `nodeId` alır. Editör seçim kimlikleri indeks tabanlıdır (`editor/core/sceneObjects.ts`). Light, Blocking Volume, Landscape gibi actor'lerde `id` var. → Placeholder → model değişimi placement'ı başka bir asset grubuna taşır; kimlik için yeni alan gerekir (§13.4) |
| Primitive şekiller | `[KOD]` MEVCUT | `engine/scene/shapes.ts`: `shape:cube/sphere/cylinder/cone/plane` sentetik asset id'li sıradan placement. → Yapı placeholder'ının doğal biçimi (§13.4) |
| Blockout fırçası | `[KOD]` MEVCUT | `LayoutBlockingVolume`: box/cylinder/cone/sphere, `color`, `renderInGame`, `id`. → Elle blockout için uygun; üretilen yapı için değil (§13.4) |
| Referans görseli altlığı, OSM içe aktarma | YOK | Kodda `underlay`/`referenceImage`/OSM yok. → T36, T37 (§4.5) |

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
| **Region Profile** (v0.4) | Bir bölgenin yerleşim kültürü: yol ölçüleri, sokak deseni, parsel, imar tarzı, donatı programı, roller | YENİ: `*.regionprofile.json` fork verisi (§13.4) |
| **Settlement Plan** (v0.4) | Yerleşimin merkezi, sınırı, tipi, nüfusu, ekonomisi, kaynağı | YENİ: recipe `settlements[]` (§13.4) |
| **Road Graph** (v0.4) | Yol topolojisi: düğüm, kenar, sınıf. Geometri (spline) bundan üretilir | YENİ: recipe `roadGraph` (§13.4) |
| **Semantic Role** (v0.4) | Nesnenin ne olduğu (`building.residential.detached`); görünümü bölge profili çözer | YENİ: placement `role` (§13.4) |

### 2.1. Veri akışı

```text
 AI ÜRETİMİ DÜNYA GÖRSELİ      OPENSTREETMAP ÇIKTISI       EDİTÖRDE ELLE ÇİZİM
 (birincil, v0.4)              (ölçeklenmiş, ikincil)      (her aşamada)
            │                          │                          │
 [Reference Interpreter]       [OSM Import & Scale]               │
 (AI; editör dışında)          (tools/, dev-time)                 │
            └──────────────┬───────────┘                          │
                           ▼                                      │
     [Semantic World Plan + Settlement Plan + Road Graph] ◄───────┘
     + METİN + BÖLGE PROFİLİ + OYUN KISITLARI
            │       kullanıcı kontrolü: Reference Underlay üstünde düzeltme (hibrit, §13.2)
            ▼
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
| Yol deform | Road stage | Dünya spline'ı deform/boya patch'i (8A1). **2026-10-28 kod düzeltmesi:** deform/boya açık bir komutla tile'a yazılır (`createTerrainSplinePatches` → `executeTerrainPatchCommand`, undo'lu bake); spline'dan kendiliğinden yeniden üretilmez |
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
| **00** | Reference Analysis | Semantik öğeler, kamera/stil tahmini, belirsizlik notları; v0.4: AI görselinden ya da OSM'den Semantic World Plan taslağı (§13.2) | — (AI, T35; OSM, T37) | Hedefler listelenmiş, her öğe "gözlenen/tahmin" ve güven değeri taşıyor |
| **01** | World Layout & Blockout | Sınır, zonlar, su koridoru, POI, rota alternatifleri; v0.4: yerleşim merkezleri, tip/nüfus, bölge profili seçimi | — (YENİ); Reference Underlay (T36) üstünde hibrit düzeltme | Bağlantılar anlamlı, ölçek kabul edilmiş |
| **02** | Scene & Environment Setup | Level, World Terrain grid'i, partition, görüş mesafesi, Sun/Sky/Fog/Cloud, **World Environment** | New Open World sihirbazı (`openWorldSetup.ts`), environment singleton'ları; WES (K1) | Level açılır ve kaydedilir |
| **03** | Macro Terrain | Ana heightfield, sırt/vadi/plato | Heightmap import, noise/terrace/ramp fırçaları | Ölçüler/dikişler geçerli, POI'ler erişilebilir |
| **04** | Hydrology Draft & Carving | Havza, nehir koridoru, göl kotu, yatak | Nehir (8A5), Lake (W1), erozyon | Su kotları/akış tutarlı |
| **05** | Road Network & Conform | Yol grafı, spline'lar, profil, kesme/dolgu, geçit adayları | Dünya spline yolu (8A1–8A4), spline mesh/decoration | Hedefler bağlı; eğim/dönüş araç profiline uygun |
| **06** | Settlement Layout | Köy sınırı, sokaklar, ada/parsel, arazi kullanımı, pedler (L2–L5, §13.3) | Flatten fırçası (manuel) | Yol erişimi, çakışma yok, imar uyumu (WB-06/15/16) |
| **07** | Terrain Detail & Surface Paint | Erozyon detayı, kaya/çamur/toprak/çim/kar maskeleri | Erozyon fırçası, 8 katman paint + physicalMaterial | Kritik yüzeyler korunuyor |
| **08** | Structure Placeholder | Rol renkli bina hacimleri, giriş yönleri (L6, §13.3); gereken model listesi (§13.7) | Placement + `shape:cube` | Parsel/giriş geçerli (WB-17) |
| **09** | Foliage & Rock Distribution | Ağaç, çalı, ot, kaya kümeleri | Foliage boyama, `LandscapeFoliageRule`, Foliage Type eğim/yükseklik filtreleri | Exclusion alanları boş; bütçe içinde |
| **10** | Props & Dressing | Çit, direk, tabela, yük; v0.4: bölge profilinin donatı rolleri (L7) | Spline modüler tekrar, yol süsleri | Oynanış alanları kapanmamış |
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
| **T07** | Stable IDs + Generated Ownership | KISMİ | Actor/light/volume `id` var; `uniqueEditorId` (`editor/core/ids.ts`); foliage grubu `id`; foliage instance'ında ve **`LayoutPlacement`'ta `id` yok** (v0.4 düzeltmesi) | `LayoutPlacement.id?` alanı (§13.4; **yapıldı** 2026-10-28) + `generatedBy {recipeId, stageId}` sahiplik kaydı (§6.3); foliage için grup düzeyi |
| **T08** | World Validation & Diagnostics | KISMİ | `verify:world-data`, `splineDiagnostics.ts`, içerik doğrulaması | Yol eğimi/dönüş, su-kıyı, çakışma, erişilebilirlik kontrolleri |
| **T09** | Asset Catalog Metadata | KISMİ | Manifest `category`, `tags`, `placement` | Biyom, boyut sınıfı, semantik rol, Foliage Type bağlantısı, WES mevsim varyantı. v0.4: rol → asset eşlemesi bölge profilinde yaşar, manifest'e kültürel bilgi girmez (§13.4) |
| **T10** | Preview / Diff / Bake / Rollback UI | KISMİ | Undo/redo + Save; görsel diff yok | Stage önizleme katmanı, değişiklik özeti, kabul/geri al |

### 4.2. P1 — İlk kullanışlı sürüm

| ID | Araç | Durum | Kanıt / not |
|---|---|---|---|
| **T11** | Procedural Macro Terrain | KISMİ | Heightmap import + `noise/terrace/ramp` fırçaları. Recipe'den bölge maskeli makro üretim YENİ |
| **T12** | Erosion / Sediment | **MEVCUT** (fırça) | `terrainErosion.ts` termal + hidrolik. Bölge/recipe çağrısı küçük iş |
| **T13** | Flow / Drainage Analyzer | YENİ | Akış yönü/birikimi, havza, çukur tespiti. Global map üzerinden worker |
| **T14** | Road Cost Map & Route Solver | YENİ | Araç profili Offroad verisinden (`src/game`/proje) okunur. Ayrıntı §13.5 |
| **T15** | Junction & Cross-Section | KISMİ | Spline mesh bükme + yol süsleri var; gerçek kavşak yok. Köy ölçeği için T/Y kavşak yeterli (§13.5) |
| **T16** | Bridge / Culvert / Ford | YENİ | Placeholder ilk adım |
| **T17** | Shoreline & Wetness | KISMİ | Göl kıyısı (W1), ıslak çamur katmanı (deformasyon planı), WES ıslaklığı (görsel) |
| **T18** | Settlement & Parcel | YENİ | Yer seçimi, program, ada/parsel (§13.3 L2–L4, §13.5) |
| **T19** | Biome Rules + PCG Scatter | KISMİ | `LandscapeFoliageRule` (paint katmanı → Foliage Type, yoğunluk), `proceduralFoliage.ts`, eğim/yükseklik filtreleri. Çok maskeli biyom kuralı ve exclusion YENİ |
| **T20** | Exclusion / Clearance Volumes | YENİ | Foliage ve placement için ortak hacim/maske |
| **T21** | Road & Building Conform | KISMİ | Spline deform (yol) MEVCUT; bina pedi için flatten/terrace fırçası manuel. Ped modeli `[AÇIK]` (§13.10) |
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

Özet (T01–T33): 4 MEVCUT (T05, T12, T27, T29), 18 KISMİ, 11 YENİ (T01, T02, T13, T14, T16, T18, T20, T26, T28, T30, T31). KISMİ araçların çoğu için temel işlem zaten var; eksik olan, recipe'den çağrılabilen API ve sahiplik kaydıdır. v0.4'te eklenen sekiz aracın (T34–T41) hepsi YENİ'dir (§4.5).

### 4.4. Yeniden sıralanmış ilk teknik sıra `[KARAR v0.4]`

v0.3 sırası, kullanıcının "önce AI görselinden başla" ve "önce köy/kasaba" kararlarıyla güncellendi:

1. **F1 çekirdeği:** Recipe (T01) + Stage Runner (T02) + sahiplik kaydı (T07, placement `id` dahil) + stage önizlemesi (T10). Bunlar olmadan diğer her araç tek seferlik bir makrodur.
2. **Referanstan plan (F1b):** Semantic World Plan şeması + görsel yorumlayıcı (T35) + Reference Underlay (T36). Bu adım geometri üretmez; AI'ın görseli doğru okuyup okumadığı erkenden görülür.
3. **Mevcut araçları stage'e bağlama:** T05 yol, T06 nehir/göl, T12 erozyon, T19 paint→foliage kuralı. Yeni geometri yazılmaz; programatik çağrı ve sahiplik eklenir.
4. **Maskeler ve doğrulama:** T04 + T08 + T20. Diğer üreticilerin ortak girdisi ve güvenlik ağıdır.
5. **Makro arazi ve akış:** T11 + T13.
6. **Yol ağı:** T38 (graf) + T14 (rota çözücü) + T15 (köy ölçeği kavşak) + T16 (geçit placeholder'ı).
7. **Yerleşim:** T34 (bölge profili) + T18 (yer, program, parsel) + T39 (arazi kullanımı) + T40 (rol placeholder'ı) + T21 (ped).
8. **Model listesi ve OSM:** T41 (gereken model listesi) ve T37 (OSM). Birbirinden bağımsızdır.
9. **AI kapalı döngü ve otomatik inceleme:** T30–T31.

P0/P1/P2 takvim değildir. Sıra, F1 prototipinden sonra yeniden değerlendirilir.

### 4.5. v0.4 eklenen araçlar

| ID | Araç | Durum | Not |
|---|---|---|---|
| **T34** | Region Profile | YENİ | `*.regionprofile.json` şeması + normalizer; yol/parsel/imar/program/rol tabloları (§13.4). Fork verisi; motor kültürel veri taşımaz |
| **T35** | Reference Image Interpreter | YENİ | AI (Claude görsel) dünya görselinden Semantic World Plan taslağı yazar; editör dışında (§13.2) |
| **T36** | Reference Underlay | YENİ | Görseli editörde araziye tepeden yatırır, plan katmanını üstüne çizer; hibrit düzeltmenin yüzeyi (§13.2) |
| **T37** | OSM Import & Scale | YENİ | `tools/` altında dev-time; yol grafı, bina izi, arazi kullanımı, donatı; topoloji ölçeklenir, ölçüler bölge profilinden gelir (§13.6) |
| **T38** | Road Graph | YENİ | Topoloji verisi (düğüm/kenar/sınıf); spline'lar bundan üretilir (§5.2'deki "bağlantı grafı") |
| **T39** | Land-Use Allocator | YENİ | Parsellere rol dağıtımı: program + puan + uyumluluk tablosu (§13.5) |
| **T40** | Semantic Placeholder & Role Resolver | YENİ | Rol → asset çözümü; asset yoksa rol renginde `shape:cube`; placeholder → model geçişinde kimlik/giriş korunur (§13.4, §13.7) |
| **T41** | Required Models Export | YENİ | Level'dan rol başına adet/ölçü/giriş/stil listesi; Codex + Tripo hattının girdisi (§13.7) |

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

- Bağlantı grafı (YENİ, T38) ve spline/mesh geometrisi (MEVCUT) ayrı tutulur. Yol hiyerarşisi, rota çözücü ve sokak desenleri §13.5'te.
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
- Model yoksa semantik placeholder kullanılır. Model sonra değiştirilince kimlik ve giriş yönü korunur. v0.4 düzeltmesi: bunun için placement'a `id` alanı eklenmesi gerekir; bugün yok (§13.4).
- **Tam tasarım §13'tedir.**

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
world.importOsm(extract, { center, layoutScale, regionProfile })   // v0.4, T37
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
- v0.4: `"plc-123"` gibi placement anahtarları, `LayoutPlacement.id` alanı eklenene kadar mümkün değildir (§13.4). Recipe ayrıca `regionProfile`, `settlements[]` ve `roadGraph` alanlarını alır (§13.4).
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
| **WB-13 Reference Plan** (v0.4) | AI'ın görselden yazdığı plan şemadan geçiyor; koordinatlar aralıkta; her öğe `source`, `observed/inferred` ve `confidence` taşıyor; underlay üstünde doğru yere çiziliyor | engine testi (şema) + smoke (underlay ekran görüntüsü) |
| **WB-14 Program** (v0.4) | Nüfus + bölge profili → beklenen donatı sayıları; oyun eki program satırları birleşiyor | engine testi (saf) |
| **WB-15 Parcel Validity** (v0.4) | Her parselin bir sokak kenarına cephesi var; parseller çakışmıyor; eğim sınırı içinde | engine testi (geometri) |
| **WB-16 Land Use** (v0.4) | Uyumsuz komşuluk eşiği aşılmıyor; aynı seed aynı dağılımı veriyor | engine testi |
| **WB-17 Placeholder Swap** (v0.4) | Placeholder → model geçişinde `id`, `role`, konum, yön ve giriş korunuyor; ayak izi toleransı aşılırsa uyarı | engine testi + save round-trip (`droppedFields`) |
| **WB-18 OSM Scale** (v0.4) | Ölçekleme sonrası yol grafı topolojisi aynı (düğüm/kenar eşleşmesi); yol genişliği ve bina izi bölge profilinden, ölçekten bağımsız | engine testi (saf) |
| **WB-19 Required Models** (v0.4) | Dışa aktarılan listede rol başına adet, level'daki placeholder sayısına eşit | engine testi |

### 7.3. Kalite boyutları

- **Yapısal:** yol, su, POI ve yerleşim bağıntıları doğru.
- **Mekânsal:** çakışma, diklik, su seviyesi, erişim ve sınır dikişi doğru.
- **Görsel:** referansa makul benzerlik var.
- **Oynanış:** rotalar araç profiline göre anlamlı seçenekler sunuyor.
- **Teknik:** runtime stabil, kayıt geçerli, bütçeler ölçülmüş.

---

## 8. İlk prototip: Mountain Delivery

**Amaç:** mevcut açık dünya, spline yol ve su araçları üzerinde tek bir referanstan aşamalı ve düzenlenebilir küçük bir nakliye bölgesi üretmek.

**Girdi (v0.4):** AI ile üretilmiş bir dünya görseli (§13.2), bir bölge profili ve kısa bir program metni. Hazır asset beklenmez; yapılar rol renkli placeholder'dır.

**İçerik:**
- Coğrafya: vadi, iki yükselti bandı, nehir.
- Yerleşim: 150–300 kişilik bir köy (program ve placeholder'larla), lojistik depo.
- Yollar: iki rota profili, bir köprü veya sığ geçit placeholder'ı.
- Doğa: orman ve kaya dağılımı.
- Test: bir sürüş kontrol rotası.

**Fixture `[KARAR v0.3]`:**
- Yeni bir `WbTestValley` level'ı kullanılır. `LandscapeTest` ve `OffroadTest` level'larına **dokunulmaz**; asset'leri yeniden kullanılır (`public/assets/LandscapeTest/*`, araç asset'leri).
- 2×2 tile World Terrain, partition kapalı: streaming riski F6'ya kalır.

**Üretim sırası:**
1. Görselden plan taslağı (T35), underlay üstünde 2–3 kontrol noktasıyla kullanıcı değerlendirmesi (T36).
2. Recipe ve 02 setup (sihirbaz fonksiyonları).
3. 03 makro arazi (heightmap ya da noise) ve 04 nehir.
4. 05 yol ağı: iki rota + köy içi ana sokak (T38, T14).
5. 06 köy: yer seçimi, ada/parsel, arazi kullanımı; 08 rol placeholder'ları ve pedler.
6. 07 paint ve 09 kural foliage'ı; 10 bölge donatısı (giriş tabelası, direkler).
7. Save/reload, sürüş testi ve gereken model listesi (T41).

**İlk başarı tanımı:**
- Aynı referansla tutarlı bir level oluşuyor.
- Yol veya köy taşınınca yalnız etkili bölge güncelleniyor.
- Manuel override korunuyor.
- Sahne kaydedilip sürülebiliyor.
- v0.4: köyde konut, kamusal ve iş alanları programla tutarlı ve okunur; çıkan model listesi Tripo hattına verilebilecek ayrıntıda.

### 8.1. Büyük dünya aşaması

Çok tile, partition açık ve uzun rota. Streaming, collider aktivasyonu, foliage yoğunluğu, tile sınırında spline/su bağlantıları ve uzun sürüş bellek testi yapılır. Altyapı OPEN_WORLD_PLAN ile mevcuttur. World Builder'a özgü risk, stage'lerin yüklü olmayan tile'larla çalışmasıdır (`TerrainEditorStreaming`: düzenlenen tile'lar oturum boyunca yüklü kalır).

---

## 9. Uygulama fazları

| Faz | Teslim | Çıkış kapısı | Durum |
|---|---|---|---|
| **F0 — Envanter** | Mevcut araçların gerçek kapasitesi | §0.1 ve §4 | **Bu belgeyle büyük ölçüde kapandı.** Kalan: T04/T07/T09 API ayrıntıları F1 başında |
| **F1 — Recipe çekirdeği** | Şema (`settlements`/`roadGraph`/`regionProfile` alanlarının yeri dahil), sahiplik kaydı, `LayoutPlacement.id`, tek stage'li runner (`roads`), dry-run, tek undo, `inspectCapabilities` | Aynı recipe güvenle tekrar çalışıyor (WB-01/02/08) | Sıradaki |
| **F1b — Referanstan plan** (v0.4) | Semantic World Plan şeması, görsel yorumlayıcı (T35), Reference Underlay + plan katmanı (T36), üç test görseli | AI planı görselin üstünde doğru yerde; kullanıcı editörde düzeltebiliyor (WB-13) | F1 ile paralel başlayabilir |
| **F2 — Terrain + Roads + Water** | 03/04/05/07 stage'leri mevcut araçlarla; makro arazi plan bölgelerinden | Test level'ı tekrar üretilebilir; dikişler geçerli (WB-03/04/05) | — |
| **F3a — Yol ağı** (v0.4) | Yol grafı (T38), maliyet haritası + rota çözücü (T14), T/Y kavşak (T15), geçit placeholder'ı (T16) | Hedefler bağlı, eğim/dönüş profile uygun (WB-03/06) | — |
| **F3b — Yerleşim** (v0.4) | Bölge profili (T34), yer seçimi + program + ada/parsel (T18), arazi kullanımı (T39), rol placeholder'ı (T40), ped (T21) | WB-06/09/14/15/16/17 | — |
| **F3c — Model listesi** (v0.4) | Gereken model listesi (T41) ve placeholder → model içe aktarma normalizasyonu | WB-19; bir Tripo modeli placeholder'ın yerine oturuyor | F3b sonrası |
| **F3d — OSM** (v0.4) | OSM içe aktarma + ölçek + profil örneklemesi (T37) | WB-18; gerçek bir köy dokusu Forge arazisine oturuyor | F3a/F3b veri sözleşmelerinden sonra, paralel |
| **F4 — PCG Nature & Props** | Biyom kuralları, exclusion, props (L7 donatı dahil), asset metadata | Dağıtım tekrarlanabilir, çakışma kontrolü geçiyor (WB-07) | — |
| **F5 — AI Director** | v0.4: kapalı döngü. Üretilen level'ın ekran görüntüsünü referansla karşılaştırma ve planı düzeltme önerisi (T30–T31). Görselden ilk plan F1b'ye taşındı | Referans → test level uçtan uca | — |
| **F6 — Scale** | Kasaba → şehir; büyük dünya, streaming altında stage'ler, profiler; kullanıcının LOD/HLOD planına bağlı (§13.8) | Hedef cihazda uzun sürüş ve bütçeler ölçülmüş (WB-12) | — |

Fazlar bağımlılığa göre paralel ilerleyebilir; takvim taahhüt edilmez. **WES (K1–K3) World Builder'ı beklemez.** World Builder–WES bağı WES K4'tür.

---

## 10. Açık tasarım kararları — v0.3 durumu

| # | Soru | v0.3 durumu |
|---|---|---|
| 1 | Recipe nerede saklanacak? | `[ÖNERİ]` `<Level>.worldrecipe.json` sidecar + sahiplik kaydı (§6.3). F1'de onay |
| 2 | Katman modeli: tam non-destructive mi, hibrit mi? | `[KARAR v0.3 — öneri olarak]` **Hibrit:** base height ve detay tile'a bake edilir. Yol/nehir kendi verisinden yeniden üretilen patch olarak kalır (v0.3 varsayımı; **2026-10-28 kodla düzeltildi:** yol deform/boyası tile'a bake edilir, karar 19'a bakın). Manuel fırça işleri `protectedRegions` ile korunur. Tam edit-layer yığını, F2 sonunda ihtiyaç kanıtlanırsa ayrı plan olur |
| 3 | Su oyma ile yol deformunun sırası ve çatışması | KISMİ: ikisi de MEVCUT ve ayrı veri. Sıra kuralı (önce su, sonra yol, köprüde yol kazanır) F2'de testle sabitlenir |
| 4 | Üretim birimi ve undo sınırı | `[KARAR v0.3]` Stage başına tek undo adımı; birim etkilenen tile seti |
| 5 | AI girdisi: görsel mi, semantik harita mı, metin+şablon mu? | **Kapandı** `[ONAYLANDI 2026-10-28]`: ilk girdi AI ile üretilmiş dünya görseli; OSM ikinci kaynak; metin + bölge profili tamamlayıcı (karar 11) |
| 6 | Belirsiz bilgilerin kullanıcıya sunumu | **Kapandı** `[ONAYLANDI 2026-10-28]`: hibrit. Reference Underlay üstünde plan katmanı + "varsayım" listesi; her öğe güven değeriyle; kullanıcı düzeltir (§13.2, karar 13) |
| 7 | Fiziksel zemin ↔ görsel paint eşlemesi | **Kapandı:** paint katmanı `physicalMaterial` taşır (T27 MEVCUT) |
| 8 | Hedef cihaz, dünya boyutu, bütçeler | KISMİ: OPEN_WORLD_PLAN bütçe tablosu (orta masaüstü, 60 Hz, 4 km) baz alınır; World Builder'a özgü üretim süresi `[AÇIK]` |
| 9 | Foliage/props: instance mı actor mı? | `[KARAR v0.3]` Doğa = Foliage Type + kural (kayıtsız, yeniden kurulur) ya da boyanmış grup. Etkileşimli/gameplay nesnesi = placement/actor |
| 10 | AI'ın yazma/commit yetkisi | `[KARAR v0.3]` AI yalnız recipe yazar. Uygulama editörde kullanıcı onayıyla, stage başına tek undo adımıyla yapılır. Otomatik Save yoktur |
| 11 | Girdi önceliği | `[ONAYLANDI 2026-10-28]` Önce AI ile üretilmiş açık dünya görseli analiz edilir. OpenStreetMap kullanılabilir; gerçek dünya bilgisi ölçek değiştirilerek kullanılır |
| 12 | Ölçek sırası | `[ONAYLANDI 2026-10-28]` Önce köy/kasaba; bu başarılınca büyük ölçek (şehir). LOD/HLOD için kullanıcının ayrı planı var, yakında uygulanacak |
| 13 | Plan girişi | `[ONAYLANDI 2026-10-28]` Hibrit: AI/OSM taslak üretir, kullanıcı editörde düzeltir, üreticiler doldurur |
| 14 | Hazır asset | `[ONAYLANDI 2026-10-28]` Hazır obje beklenmez. Seviye semantik rollerle ve renkli placeholder'larla kurulur; modelleri kullanıcı sonra üretir (Codex referans görseli + Tripo AI), ileride otomatikleşebilir (§13.7) |
| 15 | Placeholder biçimi | `[KARAR v0.4]` `shape:cube` placement + yeni `id`/`role` alanları (§13.4). Blocking Volume kullanılmaz |
| 16 | Görsel türü | `[AÇIK — kullanıcı]` Öneri: düzen için tepeden (harita gibi) bir görsel, stil için perspektif bir görsel (§13.2) |
| 17 | OSM lisansı ve verinin saklanması | `[AÇIK — fork başına]` ODbL atfı ve paylaşım şartı (§13.6) |
| 18 | İlk bölge profili | `[AÇIK — kullanıcı]` Offroad'ın izole dağ köyü için hangi bölge? (ör. Alpler, Japon kırsalı, Anadolu dağ köyü) |
| 19 | Ped ve yol deform modeli | `[AÇIK — ayrı adım]` Bake + undo mu, yeniden üretilebilir deform patch'i mi (§13.10). Yol deform'u da bugün bake (karar 2 notu); bir yol taşınınca eski kazı arazide kalır. **Kullanıcı kararı 2026-10-28:** adım 6 yol aşaması yalnız spline verisi üretir (mesh + çarpışma spline'dan gelir, araziye dokunulmaz); deform/boya bugünkü elle düğme olarak kalır; otomatik, yeniden üretilebilir deform pedlerle birlikte ayrı adımda çözülür |

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

## 13. Yerleşim, yol ağı ve bölge profili (v0.4)

### 13.1. İlke

Dağ, orman ve nehir gürültü fonksiyonu ve kuralla dağıtılabilir. **Yerleşim ise bir sebebin sonucudur.** Her yerleşim üç soruya cevap verir:

- **Neden burada?** Su, düz arazi, kavşak, geçit, maden, liman, taşkından uzaklık.
- **Neden bu büyüklükte?** Nüfus ve ekonomi.
- **Neden bu düzende?** Kültür, dönem ve topoğrafya:
  - Amerika: ızgara ve banliyö.
  - Japonya: dar sokaklı karma doku.
  - Orta Çağ Avrupa'sı: organik merkez.
  - Dağda: eşyükselti eğrisini izleyen sokak.

Bu yüzden yerleşim **yukarıdan aşağıya bilgi katmanlarıyla** üretilir (§13.3).

- Her katman bir üsttekinden türer ve kendi içinde düzenlenebilir.
- Üst katman değişince yalnız bağımlı alt katmanlar yeniden üretilir (§3.2).
- Kültüre özgü her şey **bölge profilinde** (L0) yaşar. Motor yalnız genel algoritmayı taşır; aynı algoritma farklı profille farklı ülke gibi görünür.

**Kapsam `[ONAYLANDI]`:** önce köy/kasaba (onlarca–birkaç yüz yapı). Şehir F6'dadır (§13.8).

### 13.2. Girdi kaynakları ve hibrit akış `[ONAYLANDI]`

Üç kaynak aynı **Semantic World Plan** biçimine yazar. Kullanıcı planı editörde düzeltir, üreticiler planı geometriye çevirir.

| Kaynak | Ne verir | Ne veremez | Nerede çalışır |
|---|---|---|---|
| **AI dünya görseli** (birincil) | Yerleşimlerin yeri ve kaba büyüklüğü, ana yollar ve bağlantılar, nehir/göl, orman ve dağ bölgeleri, stil ipuçları | Kesin koordinat, yükseklik, tek tek binaların yeri, ölçek | Editör dışında: Claude görseli okur, plan JSON'u yazar (T35) |
| **OpenStreetMap** (ikincil) | Gerçek sokak topolojisi, bina izleri, arazi kullanımı, donatı türleri | Forge arazisine uyum (gerçek kasaba düz arazideyse dağa oturmaz) | `tools/` dev-time betiği (T37, §13.6) |
| **Elle çizim** (her aşamada) | Merkez taşıma, sınır çizme, yol ekleme/silme, korunan bölge | — | Editör, Reference Underlay üstünde (T36) |

**Görselden plana adımlar (T35):**

1. **Girdi:**
   - Görsel.
   - Ölçek varsayımı (ör. "görselin genişliği 2 km").
   - Bölge profili ve kısa program metni (ör. "nehir kenarı dağ köyü, 200 kişi, hayvancılık + kereste").
   - Oyun kısıtları.
2. **AI çıktısı:** Semantic World Plan taslağı. Koordinatlar görselde normalize edilmiştir (`[0..1]²`) ve ölçek varsayımıyla dünya metresine çevrilir. Her öğe şunları taşır:
   - `source: "reference"`.
   - `observed | inferred`: görselde görülen mi, tahmin edilen mi.
   - `confidence: 0..1`.
3. **Editör:** Reference Underlay (T36) görseli araziye tepeden yatırır ve planı üstüne çizer: merkezler, sınırlar, yol çizgileri, su. Düşük güvenli öğeler ayrı renkte gösterilir.
4. **Kullanıcı düzeltmesi:** sürükle, sil, ekle. Her düzeltme bir undo adımıdır ve öğenin `source`'u `"manual"` olur. Yeniden analiz manuel öğelere dokunmaz.
5. **Üretim:** stage'ler planı geometriye çevirir. AI'ın çizdiği yol çizgisi kesin rota değil, **koridor ipucudur** (§13.5).

**Dürüst sınırlar:**

- Görsel modellerinin koordinat hassasiyeti düşüktür; görsel boyutunun birkaç yüzdesi kadar hata beklenir.
- Görseldeki tek tek evlerin sayısı ve konumu güvenilir okunmaz. Bu yüzden AI **yapıyı** okur: köy nerede, ne büyüklükte, hangi yolla bağlı. Evleri L4–L6 üreticileri yerleştirir.
- Görsel yükseklik vermez. Seçenekler:
  - Dağ/vadi bölgelerinden makro arazi üretmek (T11).
  - Aynı düzende bir yükseklik haritası görseli üretip mevcut 16-bit PNG içe aktarmayla (`engine/terrain/heightmapPng.ts`, New Open World sihirbazı) yüklemek. 8-bit AI görselleri basamak yapar; yumuşatma gerekir.

**Görsel türü `[AÇIK — karar 16]`.** Düzen için tepeden, harita gibi, perspektifsiz bir görsel çok daha iyi okunur. Perspektif görsel stil ve atmosfer referansıdır; ondan düzen çıkarmak kamera eşleştirmesi (T30) ister ve güveni düşüktür. Öneri: aynı dünya için ikisini birlikte üretmek.

### 13.3. Bilgi katmanları L0–L7

| Katman | Ne söyler | Kim belirler | Çıktı |
|---|---|---|---|
| **L0 Bölge profili** | Yol ölçüleri, trafik yönü, sokak deseni, parsel ölçüleri, kat sayısı, imar tarzı, donatı programı, roller | Fork verisi (§13.4) | `*.regionprofile.json` |
| **L1 Yerleşim programı** | Tip, nüfus, ekonomi, ihtiyaç listesi | AI/kullanıcı metni + profil tablosu + oyun eki | recipe `settlements[].program` |
| **L2 Yer seçimi** | Merkez ve sınırın arazideki en uygun yeri | Kural (uygunluk puanı) | merkez, sınır, rapor |
| **L3 Yol ağı** | Yerleşimler arası bağlantı, iç sokak hiyerarşisi | Rota çözücü + profil deseni | recipe `roadGraph` → dünya spline'ları |
| **L4 Ada ve parsel** | Sokakların böldüğü adalar ve parseller; her parselin sokak cephesi | Kural | parsel listesi (recipe, üretilen) |
| **L5 Arazi kullanımı** | Parsel başına rol: konut, ticaret, kamusal, iş/sanayi, tarım, açık alan | Puan + program + uyumluluk tablosu | parsel → rol |
| **L6 Yapı placeholder'ı** | Ayak izi, kat sayısı, sokağa bakan giriş, ped | Kural (rol + parsel + profil) | `shape:cube` placement'lar (§13.4) |
| **L7 Sokak donatısı** | Tabela, aydınlatma, çit, durak | Yol sınıfı + profilin donatı rolleri | placement'lar / spline süsleri |

**İhtiyaç listesi (L1).** Gerçek planlamada olduğu gibi nüfustan donatı türetilir. Profil tablosu "her N kişiye bir okul, bir ibadet yeri, bir pazar, bir sağlık noktası, bir meydan" gibi satırlar taşır; satırlar kültüre göre değişir.

**Oyun eki.** Oyun modülü programa kendi ihtiyaçlarını ekler: Offroad için depo, yakıt istasyonu, kantar. Böylece motor genel kalır, oyuna özgü kurallar fork'ta yaşar (§1.2).

### 13.4. Veri sözleşmeleri

**Bölge profili (T34) `[ÖNERİ]`.** Yer: fork'un `public/` altı (ör. `public/regions/<id>.regionprofile.json`). Forge yalnız test fixture'ı olarak nötr bir örnek profil taşır; kültürel içerik template'e girmez.

```ts
type LandUse = "residential" | "commercial" | "civic" | "industrial" | "agricultural" | "open" | "transport";
type RoadClass = "highway" | "arterial" | "collector" | "local" | "track" | "path";

interface RegionProfile {
  schemaVersion: 1;
  id: string;                       // "alpine-mountain-village"
  label: string;
  traffic: { side: "left" | "right" };
  roads: Record<RoadClass, {
    width: number; shoulder: number; sidewalk?: number;
    maxSlopeDeg: number; minTurnRadius: number;
    surfaceLayer?: string;          // paint katmanı adı ipucu → physicalMaterial (T27)
  }>;
  streetPattern: {                  // ağırlıklar; üretici karışımı seçer
    linear: number;                 // yol boyu köy (dağda en yaygın)
    grid: number; organic: number; radial: number;
    contourFollow: number;          // eğimde eşyükselti eğrisine yaslanma
    blockSize: [number, number];    // metre, min..max
  };
  parcels: Partial<Record<LandUse, {
    frontage: [number, number]; depth: [number, number];
    setback: number; coverage: number;   // yapı/parsel oranı
  }>>;
  zoning: {
    mode: "separated" | "mixed";
    compatibility: Partial<Record<LandUse, Partial<Record<LandUse, number>>>>;  // -1 (yasak) .. 1 (tercih)
  };
  household: { personsPerDwelling: number };
  program: Array<{
    role: string;                   // "building.civic.school"
    perResidents?: number;          // her N kişiye bir
    minPopulation?: number;
    siting: "center" | "mainRoad" | "edge" | "downstream" | "entrance" | "any";
  }>;
  roles: Record<string, {           // "building.residential.detached"
    landUse: LandUse;
    footprint: { width: [number, number]; depth: [number, number] };
    storeys: [number, number]; storeyHeight: number;
    entrance: "street" | "any";
    assetIds?: string[];            // varsa model; yoksa placeholder
    placeholderColor?: string;      // yoksa landUse rengi
  }>;
}
```

- **Rol kimliği** noktalı hiyerarşidir (`building.residential.detached`, `prop.sign.speedLimit`, `vegetation.tree.street`). Motor yalnız `LandUse` sınıflarını ve kimlik sözdizimini bilir; rollerin kendisi profilde tanımlanır.
- **Rol → asset eşlemesi profildedir, manifest'te değil** (T09). Aynı rol Japonya profilinde ahşap eve, Amerika profilinde çerçeve eve çözülür.
- Bu yeni bir allowlist yüzeyidir. Normalizer tek kaynaktır; save endpoint'i (`/__save-regionprofile`) editörde düzenleme gelince eklenir ve `droppedFields`/`serializationDrift` kapsamına girer. İlk sürümde profil editör dışında yazılır ve editör yalnız okur.

**Recipe eklemeleri `[ÖNERİ]`** (§6.3 sidecar'ı):

```json
{
  "regionProfile": "regions/alpine-mountain-village.regionprofile.json",
  "settlements": [{
    "id": "village_01", "source": "reference", "observed": true, "confidence": 0.7,
    "center": [312, 148], "radius": 180, "boundary": null,
    "type": "village", "population": 220, "economy": ["livestock", "timber"],
    "program": { "add": [{ "role": "building.transport.depot", "count": 1, "siting": "entrance" }] },
    "seed": 7, "protected": false
  }],
  "roadGraph": {
    "nodes": [{ "id": "n1", "pos": [40, 10], "kind": "end" }, { "id": "n2", "pos": [300, 150], "kind": "gate", "settlement": "village_01" }],
    "edges": [{ "id": "e1", "from": "n1", "to": "n2", "class": "collector", "guide": [[40, 10], [180, 90], [300, 150]], "source": "reference" }]
  }
}
```

- `guide`, AI'ın ya da kullanıcının çizdiği koridordur. Kesin geometri rota çözücünün çıktısıdır: dünya spline'ı. Sahiplik kaydı kenarı spline'a bağlar.
- Üretilen parsel listesi recipe'de saklanır. Böylece köy yeniden üretilmeden placeholder'ın hangi parsele ait olduğu bilinir.

**Placement eklemeleri `[KARAR v0.4]`:**

```ts
interface LayoutPlacement {
  // ...mevcut alanlar
  id?: string;     // kalıcı kimlik; World Builder üretiminde zorunlu, elle yerleştirmede opsiyonel
  role?: string;   // semantik rol; görünüm bölge profilinden çözülür
}
```

- İki alan da `applyTransformFields` allowlist'ine (`tools/saveValidator.ts`) ve drift testlerine girer. Alanı olmayan level byte-byte aynı kalır.
- Kimlik `uniqueEditorId` (`editor/core/ids.ts`) ile üretilir.
- **Placeholder biçimi:**
  - `assetId: "shape:cube"` (`engine/scene/shapes.ts`), ölçek = ayak izi × yükseklik.
  - Renk: rolün `placeholderColor`'ı ya da LandUse rengi. Uygulama yolu (paylaşılan placeholder materyalleri ya da render zamanı tint) F3b'de seçilir.
  - Girişin yönü, placement'ın yerel +Z ekseni olarak sabittir.
- **Neden Blocking Volume değil:** Blocking Volume ayrı bir dizide, engelleme semantiğiyle yaşar. Modele geçerken nesne dizi değiştirir ve kimliği kopar. Placement ise yalnız asset grubunu değiştirir.

**Arazi kullanımı renkleri** (placeholder, fork değiştirebilir):

| LandUse | Renk |
|---|---|
| residential | açık turuncu |
| commercial | mavi |
| civic | mor |
| industrial | gri |
| agricultural | sarı |
| open | açık yeşil |
| transport | koyu gri |

Donatı rolleri (`prop.*`) sarı, bitki rolleri (`vegetation.*`) yeşildir.

### 13.5. Algoritmalar (köy/kasaba ölçeği)

**L2 Yer seçimi.**

- Planın merkezi çekirdek kabul edilir. Üretici `radius` içinde en iyi yerel puana kayar ve kaymayı raporlar.
- Puan bileşenleri (T04 maskeleri):
  - Eğim (düz iyi).
  - Suya yakınlık, ama taşkın kotunun üstünde.
  - Yola ya da rotaya yakınlık.
  - Opsiyonel güney cephesi.
- Dışlananlar: su gövdeleri, korunan bölgeler, profilin eğim sınırını aşan alan.
- Uygun yer yoksa üretici durur ve kullanıcıya sorar. Sessizce kötü bir yere köy koymaz.

**L3 Yol ağı.**

- **Yerleşimler arası (T14):**
  - Maliyet ızgarasında A*. Eğim cezası profilin `maxSlopeDeg`'inin üstünde keskin artar.
  - Su geçişi maliyetlidir ve köprü/sığ geçit adayı üretir (T16).
  - `guide` koridoruna yakınlık maliyeti düşürür: AI/kullanıcı niyeti korunur, arazi kazanır.
  - Çıkış yumuşatılır ve `minTurnRadius` doğrulanır, sonra dünya spline'ına çevrilir (T05).
- **Yerleşim içi:**
  - Giriş yolları merkezden geçen ana sokak olur.
  - İlk desenler köy ölçeğine göre seçilir:
    - **Lineer** (yol boyu köy; dağ köylerinin en yaygın biçimi).
    - **Eşyükselti eğrisine yaslanan** sokaklar ve dik bağlantılar.
    - **Organik büyüme** (merkezden dallanan, açısı ve uzunluğu profil dağılımından).
  - Izgara kasaba ölçeğinde eklenir.
- **Kavşak (T15):** köy ölçeğinde T/Y kavşak. Spline uçlarının birleşim düğümü, kavşak alanında düzleştirme ve boya. Çok kollu kavşak ve şerit geometrisi şehir ölçeğindedir.

**L4 Ada ve parsel.**

- Ada, yol grafının düzlemsel yüzüdür. Lineer köyde ada yerine yol boyu **şerit** kullanılır: yolun iki yanında `depth` derinliğinde.
- Parselleme: ada/şerit, cephe uzunluğu profil aralığına girene kadar sokağa dik kesilerek bölünür.
- Sokağa cephesi olmayan parsel üretilmez.
- Eğimi profil sınırını aşan parsel "açık alan" olur.

**L5 Arazi kullanımı (T39).**

- Program → rol başına gereken adet. Konut sayısı `population / personsPerDwelling`'den gelir.
- Sırayla, deterministik (seed) açgözlü atama:
  1. Kamusal ve meydan: en yüksek merkezilik/erişim.
  2. Ticaret: ana sokak boyu.
  3. İş/sanayi/depo: giriş ve çıkışlar, akış aşağısı (nehir kenarı atölye), konuttan uzak.
  4. Tarım: dış kenar.
  5. Konut: kalan parseller, merkezden dışa azalan yoğunlukla.
- Her atama uyumluluk tablosuyla cezalandırılır; `-1` komşuluk yasaktır.
- `mixed` modda konut + ticaret tek yapıda (dükkân üstü konut) rol olarak verilebilir.
- Karşılanamayan program satırı rapora yazılır: "okul için uygun parsel yok".

**L6 Placeholder.**

- Ayak izi: parsel eksi `setback`, rolün aralığına sığdırılır.
- Yön: giriş sokak cephesine bakar.
- Yükseklik: kat sayısı × kat yüksekliği.
- Ped: ayak izi altında düzleştirme (T21; model `[AÇIK]`, §13.10).
- Girişin önü exclusion alanıdır (T20): foliage ve prop gelmez.

**L7 Donatı.** Profilin donatı rolleri yol sınıfına bağlanır:

- Yerleşim girişinde isim/hız tabelası.
- Ana sokakta aydınlatma aralığı.
- Uygun rollerde parsel sınırı çiti.
- Uygulama, mevcut spline modüler tekrar ve yol süsleri (`splineRoadDecorations.ts`).

### 13.6. OpenStreetMap içe aktarma (T37) `[ONAYLANDI — kaynak; ayrıntı ÖNERİ]`

**Çalışma şekli:**
- `tools/osm/` altında dev-time bir Node betiği. Runtime ve editör OSM'e bağlanmaz.
- Girdi: indirilmiş bir `.osm`/`.osm.pbf` kesiti ya da Overpass sorgusunun çıktısı. Ağ erişimi yalnız bu betikte ve geliştirici isteğiyle olur.
- **Projeksiyon:** seçilen merkez etrafında yerel teğet düzlem, metre.

**Ölçek kuralı (kullanıcının "ölçek değiştirilerek" kararı):**
- `layoutScale`, düğüm konumlarına, yani **topolojiye ve mesafelere** uygulanır.
- **Ölçüler ölçeklenmez.** Yol genişliği, parsel derinliği ve bina izi bölge profilinden gelir. Yapılar küçültülmez, parsellere yeniden yerleştirilir.
- Gerekçe: %50 küçültülmüş bir kasabada 3 m'lik sokak ve 4 m'lik ev oynanamaz. Gerçek dokunun ritmi (sokak düzeni, kavşak yapısı, kullanım dağılımı) korunur, ölçüler oyunun ölçüsüne uyar.
- `layoutScale ≈ 1` iken bina izlerini aynen kullanma seçeneği vardır.

**Kullanım:**
1. **Doğrudan plan:**
   - `highway=*` → `roadGraph` (sınıf eşlemesi).
   - `landuse=*`, `amenity=*`, `building=*` → parsel rolleri ve program.
   - `waterway=*` → su ipucu.
   - Forge arazisine oturtulurken topoloji korunur, geometri eğim sınırlarıyla yeniden çözülür. Sığmayan parçalar raporlanır.
2. **Profil örneklemesi:** bir bölgeden çok sayıda köy okunarak profilin istatistikleri çıkarılır: ada boyu dağılımı, sokak açısı dağılımı, kavşak derecesi, bina izi boyutları, nüfusa göre donatı. Gerçek veri, üreticinin "üslubunu" ayarlar.

**Lisans `[AÇIK — karar 17]`:**
- OSM verisi ODbL 1.0 lisanslıdır. Oyun "Produced Work" sayılır ve © OpenStreetMap contributors atfı ister.
- Türetilmiş veritabanı (ör. içe aktarılmış ham plan dosyası) kamuya dağıtılırsa ODbL ile paylaşılmalıdır.
- Öneri: ham kesitler repoya girmez; içe aktarılan plan dosyası atıf notu taşır; atıf fork'un künyesine eklenir.
- Bu hukuki görüş değildir; ticari dağıtımdan önce fork başına kontrol edilir.

### 13.7. Placeholder'dan modele: gereken model listesi (T41)

Forge'un sorumluluğu üç noktadadır: listeyi çıkarmak, gelen modeli normalize etmek ve rolü modele bağlamak. Görsel ve model üretimi Forge dışında kalır.

**Akış:**
1. **Dışa aktarma:**
   - `npm run worldbuilder:required-models -- <level>` (ad öneridir) → `<Level>.required-models.json`.
   - Bu bir araç çıktısıdır; runtime verisi değildir.
2. **Liste içeriği (rol başına):**
   - Bölge profili.
   - Adet ve ayak izi/yükseklik dağılımı (min/medyan/max).
   - Kat sayısı, giriş yönü kuralı.
   - Arazi kullanımı ve kısa stil notu (profil + plan metninden).
   - Referans görsel istemi taslağı.
   - Durum: `placeholder | resolved`.
3. **Üretim** (kullanıcı; ileride otomatik):
   - Codex ile referans görseli.
   - Tripo AI ile model.
   - Otomasyon gelirse bu adımda kalır. Kimlik bilgileri ve dış servis çağrısı motora girmez.
4. **İçe aktarma normalizasyonu:**
   - Mevcut `/__import-asset` hattının üstüne bir "rol için içe aktar" adımı. Tripo çıktısının ölçeği, pivotu ve ön yüzü düzensizdir.
   - Ölçü: sınırlayıcı kutu → hedef ayak izi/yükseklik.
   - Pivot: alt orta.
   - Ön eksen: rolün giriş kuralına (+Z) çevrilir.
   - Ölçüt dışı sapma uyarı verir. Model sessizce bozuk ölçekle yerleşmez.
5. **Bağlama:**
   - Asset id profilin `roles[role].assetIds` listesine eklenir.
   - Rol çözücü (T40) placeholder placement'larını yeni asset grubuna taşır; `id`, `role`, konum, yön ve giriş korunur (WB-17).
   - Birden çok asset varsa seçim seed'lidir, aynı level aynı evleri alır.

### 13.8. Ölçek yolu

| Ölçek | Yapı | Yol ağı | Ek gereksinim |
|---|---|---|---|
| **Köy** (ilk hedef) | ~20–150 | Lineer/organik, T/Y kavşak | — |
| **Kasaba** | ~150–1500 | Izgara + organik, sokak hiyerarşisi | Rol başına instancing, hücre bazlı gruplama |
| **Şehir** (F6) | binlerce | Çok kollu kavşak, şerit geometrisi, trafik | Kullanıcının LOD/HLOD planı; mevcut `engine/world/hlod.ts` ve World Partition ile birlikte |

- World Builder'ın şehir ölçeğine hazırlık olarak üstlendiği tek şey veri biçimi: üretilen yapılar asset'e göre gruplanır (instancing'e uygun) ve hücre sınırlarına göre bölünebilir.
- LOD/HLOD'un kendisi ayrı plandır. World Builder onun yerine geçmez.

### 13.9. Riskler

| Risk | Etki | Azaltma |
|---|---|---|
| AI koordinat hatası | Köy yanlış yerde, yol yanlış koridorda | Plan ipucudur; yer seçimi ve rota çözücü araziye oturtur; underlay üstünde hibrit düzeltme |
| Görsel ile arazi çelişkisi | Görselde düz köy, arazide dik yamaç | L2 raporu; üretici durur ve sorar |
| Düzenli, yapay görünüm | Tüm köyler aynı | Profil dağılımları, seed çeşitlemesi, OSM örneklemesi |
| Placeholder → model uyumsuzluğu | Model parsele sığmaz ya da ters bakar | İçe aktarma normalizasyonu + listedeki hedef ölçüler + WB-17 |
| Pedlerin base height'a bake edilmesi | Köy taşınınca eski pedler arazide kalır | §13.10 ped modeli kararı; sahiplik kaydı + undo |
| Kültürel verinin template'e sızması | Forge genelliği bozulur | Profiller fork verisi; Forge yalnız nötr test profili taşır |
| OSM lisansı | Dağıtımda yükümlülük | Karar 17; atıf ve ham veri politikası |

### 13.10. Açık konular

- **Ped modeli (karar 19).** Bugün düzleştirme fırçası tile verisine doğrudan yazar (bake). Yol ve nehir ise kendi verisinden yeniden üretilen deform patch'leridir (8A1). Pedler de patch olursa köy taşındığında eski pedler kendiliğinden kalkar. F3b başında küçük bir spike ile seçilir; öneri patch.
- **Görsel türü (karar 16)** ve **ilk bölge profili (karar 18).**
- **Parsellerin kalıcılığı.** Recipe'de mi saklanır (öneri), yoksa her seferinde graf + seed'den yeniden mi türetilir? İkincisi daha küçük ama elle düzeltilmiş parseli koruyamaz.
- **Editörde profil düzenleme.** İlk sürümde profil editör dışında yazılır. Bir "Region Profile" paneli ihtiyaç kanıtlanınca eklenir.

---

## 14. Değişiklik kaydı

| Sürüm | Tarih | Not |
|---|---|---|
| **0.4** | 28.10.2026 | Yerleşim, yol ağı ve bölge profili tasarımı (§13: L0–L7, veri sözleşmeleri, algoritmalar, OSM, model listesi, ölçek yolu). Kullanıcı kararları 11–14 (AI görseli önce, OSM ölçekli, köy/kasaba önce, hibrit giriş, hazır asset yok). Kod bulgusu: `LayoutPlacement`'ta `id` yok; T07/§5.5/§6.3 düzeltildi. T34–T41, WB-13–19, F1b ve F3a–F3d eklendi; açık kararlar 5 ve 6 kapandı; 15–19 eklendi. |
| 0.3 | 27.10.2026 | `main@f9aa05f` repo doğrulaması: durum tablosu kodla değiştirildi; T01–T33'e durum/kanıt eklendi (4 MEVCUT, 18 KISMİ, 11 YENİ); "orkestrasyon katmanı" sınırı; 13 aşamaya mevcut araç sütunu; hibrit katman modeli, recipe/sahiplik sidecar önerisi, stage başına tek undo; açık kararlardan 5'i kapandı ya da karara bağlandı; `WbTestValley` fixture; WES v0.3 bağı. |
| 0.2 | 26.10.2026 | WES entegrasyon eki, onaylı dört WES kararı, stage bağlantıları. |
| 0.1 | 25.10.2026 | Vizyon, 13 aşama, 33 araç, mimari, fazlar ve kabul testleri. |

**Belge bakım ilkesi:** yeni kararlar ve repo doğrulamaları `[KOD] / [PLAN] / [KARAR] / [ÖNERİ] / [AÇIK]` etiketleriyle kaydedilir. Kod uygulanmadan bir araç "MEVCUT" yapılmaz.
