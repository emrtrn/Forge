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
| Yol aşaması | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 6) | `engine/worldbuilder/stages/roads.ts`: her `plan.roadGraph` kenarı başlangıç düğümünün altındaki World Terrain'de bir dünya koordinatlı spline olur (`wb-road-<kenar>`). Rota (adım 8a, `engine/worldbuilder/route.ts`): guide hattı, yoksa düz çizgi, **eğim limiti içinde kalıyor ve suya/korunan alana girmiyorsa çizildiği gibi**; değilse hattın çevresindeki maliyet ızgarasında 16 komşulu A* (yön eğimi limitin altında hafif, üstünde keskin artan maliyet; su metre başına 8×, yolun yarı genişliğiyle; korunan alan ve arazi dışı duvar; guide'dan uzaklık cezası). Yol Douglas-Peucker + Chaikin ile yumuşatılır (köşe kesme korunan alana/suya sokuyorsa daha az yumuşatılır), eşit aralıkla örneklenir. Her rota raporlanır: limit üstü eğim, `minTurnRadius`'tan dar dönüş, su geçişi (köprü/sığ geçit adayı, T16), çıkışsız durumda planlanan hatta geri düşme. En çok 10 m'de bir nokta, yükseklik araziden. Genişlik profilden (şerit + 2 × banket), segmentlerde profilin `meshAsset`'i (mesh + çarpışma), `surfaceLayer` boyası ve deform ayarı. **Karar 19: yalnız spline verisi;** aşama araziyi kazmaz/boyamaz, Deform/Paint bugünkü elle düğmeler. Kavşak (adım 8b, `engine/worldbuilder/junctions.ts`): üç ya da daha fazla yolun buluştuğu düğümde en yüksek sınıflı iki yol (eşitlikte kenar id'si) düğümden geçer, diğerleri ana yolun kenarında biter (yarı genişlik / sin açı; mesh'ler üst üste binmez); 30°'den dar Y ve kırpılamayacak kadar kısa kol raporlanır. Kavşakta düzleştirme/boya yok (karar 19). Aşama sürümü 3. `tests/engine/worldRoads.test.ts`, `tests/engine/worldRoute.test.ts`, `tests/engine/worldJunctions.test.ts` |
| Yerleşim programı + yer seçimi | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 9; L1 + L2) | `engine/worldbuilder/program.ts`: konut = nüfus / hane büyüklüğü; profil satırları (`count` ya da `perResidents`, `minPopulation`), oyun satırları (`ProgramExtension`; editörde `GameEditorCatalog.settlementProgram`, Forge şablonu boş bırakır), sonra recipe `program.remove` / `add`; aynı rol sonraki kaynakla yerinde değişir (WB-14). `engine/worldbuilder/siteSelection.ts`: programın parsellerinden çekirdek yarıçapı; arama yarıçapındaki adaylar çekirdek ortalama eğimi (yerel yol limiti), suya yakınlık + taşkın kotu (suyun en düşük arazi kotu + 3 m), yola yakınlık, isteğe bağlı bakı ve küçük kayma cezasıyla puanlanır; dik/taşkın/su/korunan/arazi dışı dışlanır; plan merkezi açıkça geçilmedikçe korunur; uygun yer yoksa durur ve dışlama oranlarını yazar. `stages/settlementSites.ts` (aşama `settlementSites`): `recipe.generated.sites` (merkez, çekirdek yarıçapı, puan, konut sayısı, program) + çekirdeği gösteren yassı silindir işaret; korunan yerleşim yerini korur. Yerleşime özel bölge profili henüz yüklenmiyor (uyarı). `tests/engine/worldSettlement.test.ts` |
| Araziden büyüyen yerleşim çekirdeği | `[KOD]` **MEVCUT** (2026-10-29; L2, dağlık test bulgusu) | Kullanıcı kararı: dağlık arazide köy vadiyi izlemeli. `engine/worldbuilder/core.ts` (`growCore`): merkez hücreden başlayıp yapılabilir hücreleri (yerel yol eğim sınırı, sudan 10 m uzak, taşkın dışı, korunmamış, arazi üstünde) yürüme mesafesi sırasıyla programın alanı dolana kadar alır (en çok 3 × disk yarıçapı); çekirdek bu hücrelerin dış sınırı (`recipe.generated.sites[].core`, yeni alan; `coreRadius` artık erişim). Çekirdeği olmayan eski site'lar disk sayılır (aynı sonuç). Sokak/parsel/arazi kullanımı/donatı `inCore`/`lengthInCore`/`coreSpans` kullanır; tırtıklı sınırda yol girişleri 40 m'den kısa boşluklar birleştirilerek sayılır. `settlementSites` v2: disk işareti yok (v1 diski yeniden çalıştırmada kaldırılır). Yer seçimi merkezi en çok 40 m'lik çevresiyle puanlar; taşkın seviyesi en yakın su noktasının kotu, erişim/pay su türüne göre (`FLOOD_BY_KIND`: dere 30 m / 1 m, göl 100 m / 2 m, nehir 200 m / 3 m). WorldBuildValley testinde köy: çekirdek hedefin %78'i, 10 → 23 bina. `tests/engine/worldSettlement.test.ts` (vadi boyunca büyüme, v1 diskinin kaldırılması) |
| Sokak cepheli parseller | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 10; L4) | `engine/worldbuilder/parcels.ts`: yerleşim çekirdeğinden geçen her sokağın (gerçekleşmiş yol spline'ı ya da henüz spline'ı olmayan plan kenarı, `masks.ts` `streetLines`) iki yanına yol kenarından 0,5 m pay bırakıp bir parsel derinliğinde şerit; şerit profilin cephe aralığından tohumlu rastgele cephelere sokağa dik kesilir. Lineer köy deseni doğrudan budur; sokakların çevrelediği adada kenar şeritleri adanın sokak halkasını oluşturur, başka yola, suya (5 m), korunan alana ya da önceki parsele binen parsel düşer, böylece her parselin sokak cephesi vardır (WB-15). Eğimi yerel yol limitini aşan parsel `landUse: open`. Ölçüler profilin konut parselinden; büyük roller için birleştirme arazi kullanımı adımında (adım 11). `stages/parcels.ts` (aşama `parcels`): `recipe.generated.parcels` + parsel başına ince plaka (çarpışmasız); rapor parsel sayısını programın ihtiyacıyla karşılaştırır, çekirdekten sokak geçmiyorsa ya da yer yetmiyorsa söyler. İç sokaklar ayrı üretici: `streets` aşaması (aşağıdaki satır). `tests/engine/worldParcels.test.ts` |
| İç sokaklar | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 11'den sonra, kullanıcı kararı; L3 yerleşim içi, ilk dilim organik + eşyükselti) | `engine/worldbuilder/streets.ts` (`growInnerStreets`): çekirdekten geçen yollar ana sokaktır; cepheleri programa yetmezse yerel sokaklar büyür. Dallar mevcut bir sokağın (önce yollar, sonra burada büyüyen sokaklar, yani sokaktan sokak) kenarından `spacing` aralıkla, merkeze en yakın önce başlar; `spacing` = 2 × (ortalama konut parsel derinliği + 0,5 m pay) + yerel yol genişliği. **Organik:** dik açıdan ±20° tohumlu sapma, adım başına ±8° kıvrılma, yerel yol eğim limitini aşan adımda ±15°/±30° dönmeyi dener. **Eşyükselti:** eğimli çekirdekte kontur boyunca (adımlar neredeyse düz), ayrıldığı sokak yokuşun dik bağlantısıdır; çekirdek ortalama eğimi 3°'nin altındaysa organik büyür. Desen karışımı profilin `streetPattern` ağırlıklarından (`organic` / `contourFollow`); `grid` / `radial` henüz üretilmez (raporlanır), yalnız `linear` ise iç sokak yok. Sokak boyu profilin `blockSize` aralığından, alt sınırı bir `spacing`. 8 m'lik adımlarla büyür; çekirdek sınırında, suda (5 m + yarı genişlik), korunan alanda, aşılamayan eğimde ya da başka bir sokağa `spacing`'in %80'inden yakın paralel koşacağında durur; bir sokağa değerse onun kenarında biter (T kavşak, yollardaki gibi). Hedef cephe = program ihtiyacı × ortalama cephe × 1,4; ulaşınca durur. `stages/streets.ts` (aşama `streets`, `settlementSites` ile `parcels` arası): sokaklar `wb-street-<yerleşim>-<n>` dünya spline'ları, yerel yol kesiti/mesh/boya/deform ayarı `roads` ile ortak `engine/worldbuilder/roadSpline.ts`'ten (karar 19: yalnız spline verisi); sahiplik `ownership.splines`. Aşama kendi eski sokaklarını engel saymaz, bu yüzden tekrar çalıştırma boştur; korunan yerleşim sokaklarını korur. Parsel aşaması bunları `streetLines` ile görür (cephe `frontage` alanı plan kenarı olmadığından boş). Rapor: sokak sayısı/deseni/uzunluğu, cephe / hedef, yer kalmadıysa açık. Izgara ve radyal desen, eşyükselti sokaklar arası dik bağlantılar sonraki dilim. `tests/engine/worldStreets.test.ts` |
| Arazi kullanımı | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 11; L5, T39) | `engine/worldbuilder/landUse.ts` (`assignLandUse`): sitenin program satırları sırayla — kamusal + meydan (`center`: merkezilik), ticaret (`mainRoad`: en yüksek sınıflı sokağa cephe + merkezilik), sanayi/ulaşım (`entrance`: sokağın çekirdek sınırını kestiği nokta; `downstream`: plan suyuna yakınlık + düşük kot), tarım (`edge`: dış kenar) — sonra konutlar kalan parsellere merkezden dışa; konut sayısından fazla parsel varsa en dıştakiler boş kalır. Her seçim tohumlu açgözlü: yerleşim puanı, atanmış komşuların (2 m içindeki parseller) ortalama `landUseCompatibility`'si eksiyse tam ağırlıkla cezalandırılır, artıysa küçük bir payla tercih edilir; `-1` komşu seçimi yasaklar, yani yasak iki arazi kullanımı hiç bitişmez (WB-16). Rolün ayak izi (+ 2 × 2 m yan pay, arazi kullanımının cephe alt sınırının %75'i; derinlik ayak izi + `setback`) tek parsele sığmazsa aynı sokağın aynı yanındaki ardışık parseller (en çok 4) birleşir: ilk parsel ev sahibi (`role`), diğerleri `partOf: <ev sahibi>`; poligonlar değişmez, dış hat `mergedPolygon` ile kurulur. Rolün arazi kullanımı profilden, yoksa rol kimliğindeki arazi kullanımı sözcüğünden, yoksa yerleşim kuralından. Konut rolü profilin ilk `residential` rolü. Karşılanamayan satır nedeniyle raporlanır (parsel kalmadı / birleşerek bile sığmıyor / sığan her parsel yasak komşulukta). `stages/landUse.ts` (aşama `landUse`, `parcels`'tan sonra): `recipe.generated.parcels`'ı `landUse` / `role` / `partOf` ile yeniden yazar; her çalıştırma parsel aşamasının çıktısından başlar (`landUseBase`), bu yüzden kendi çıktısında tekrar çalıştırma boştur. Yalnız veri; yapı/küp L6 adımında. Korunan yerleşimin parselleri değişmez. `mixed` imarda dükkân üstü konut henüz yok. `tests/engine/worldLandUse.test.ts` (WB-16) |
| Bina placeholder'ı + ped | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 12a–c; L6, T40, T21) | **12a** `LayoutPlacement.color` (`#rrggbb`, materyalin taban rengini değiştirir; doku kalır): yalnız placement alanı, `validatePlacement` + `clonePlacement`; instanced çizimde örnek rengi materyal rengine bölünerek yazılır (tam o renk görünür, renksiz placement'ta tampon ayrılmaz), klon yoluna düşen placement (prob, materyal override, mesh boyası) editörde ve runtime'da renklendirilmiş materyal kopyası alır (`engine/render-three/models.ts`). Kullanıcı kararı: paylaşılan materyal yerine placement rengi. **12b** `engine/worldbuilder/buildings.ts` (`planBuilding`) + aşama `buildings` (`landUse`'tan sonra): rolü olan her ev sahibi parsele (birleşik dış hat `mergedPolygon`) bir `shape:cube` — `id` `wb-building-<parsel>`, parselin `role`'ü, rengi rolün `placeholderColor`'ı yoksa arazi kullanımı rengi (`LAND_USE_COLORS`, §13.4 tablosu); ayak izi cephe − 2 × 2 m, derinlik − `setback` − 2 m arka pay içinde rolün aralığına tohumlu sığar (sığmazsa sıkıştırılır ve raporlanır); ön kenardan `setback` geride, cephenin ortasında; giriş (+Z) sokağa bakar; yükseklik kat (tohumlu) × kat yüksekliği, açık rol (`storeys [0, 0]`) 0,2 m plaka. Ev sahibi parselin `placement` alanı yazılır. Ped: ayak izi + 1,5 m (sokak tarafında en çok `setback` kadar, ped yola taşmaz), kotu ayak izinin altındaki ortalama zemin (çeyrek noktalar: bake sonrası tam ped kotunda kalırlar; kazı/dolgu dengesi), yeni `recipe.generated.pads` (`id` = bina placement'ı, yerleşim, poligon, kot); çakışan pedler (köşe parseller) ortak ortalama kota alınır, yoksa bake çakışan alanı birine verir. Küp ped kotunun 0,5 m altından başlar (`FOUNDATION`): zeminden ölçülseydi bake sonrası aşama kendi pedlerine göre güncel kalmazdı; bake öncesi eğimde alçak tarafta boşluk görünebilir. 2 m'den fazla kazı/dolgu raporlanır. Kullanıcı kararı: ped veri + elle **Apply Pads**; aşama araziye dokunmaz. Korunan yerleşim binalarını ve pedlerini korur. **12c Apply Pads:** `engine/terrain/terrainPads.ts` (genel motor özelliği: poligon içi tam kot, dışında `falloff` boyunca smoothstep geçiş, çakışan geçişte güçlü çekim kazanır; tile dikişleri `createTerrainRegionPatches` ile) + `SceneApp.applyWorldBuilderPads` (pedleri arazilere dağıtır, tile'ları akıtır, arazi başına tek terrain undo komutu; kilitli/arazi dışı ped atlanır ve sayılır) + World Builder sekmesinde **Terrain → Apply Pads** (yalnız binası level'da duran pedler; elle silinen binanın zemini değişmez; falloff 4 m). Bake sonrası `buildings` kendi pedlerine göre güncel kalır; zemini ped yakınında okuyan aşamalar (yer, sokak, parsel, yol) yeniden çalıştırılırsa düzlenmiş zemini görür, bu yüzden Apply Pads son adımdır (karar 19'un bake sonucu). `tests/engine/placementColor.test.ts`, `tests/engine/worldBuildings.test.ts`, `tests/engine/terrainPads.test.ts`, `tests/smoke/world-builder.spec.ts` (köy zinciri → Apply Pads → kayıt → yeniden yükleme) |
| Sokak donatısı | `[KOD]` **MEVCUT** (2026-10-29, F1 adım 13a; L7, T25'in yerleşim kısmı) | Kullanıcı kararları: donatı **ayrı placement** (yol spline'ının süsü değil: `splineRoadDecorations.ts` yalnız `LayoutSplineActor` üzerinde çalışır, World Terrain spline'ında generator alanı yok ve rol/`id`/renk taşımaz); yalnız yerleşim çekirdeği içinde; parsel sınırı çiti ayrı dilim (13b, aşağıdaki satır). `engine/worldbuilder/furniture.ts` (`planFurniture`): profilin `streetFurniture` kuralları, kuralın `roadClasses`'ındaki ve **spline'ı olan** yollara bağlanır — **gate**: planın yerleşime bağlı `gate` düğümleri (yoksa yolun çekirdek sınırını kestiği her nokta), gelen şeridin trafik tarafında (`traffic.side`), yüzü gelen sürücüye; **junction**: yolun başka bir yolun kenarında bittiği T ve üç ya da daha çok yol ucunun buluştuğu düğüm, kollar arasındaki en geniş boşluğun açıortayında, yüzü kavşağa; **interval**: çekirdekteki yol boyunca `spacing` aralıkla trafik tarafında, yüzü yola. Donatı yolun yarı genişliği + 0,5 m payda durur; hiçbir yola (köşeleri 0,25 m'den yakın değil), bina ayak izine, pede, girişin önüne (3 m genişlik, cepheden en yakın yol kenarına), suya (1 m), korunan alana ve başka donatıya girmez; tıkanan yer yol boyunca birkaç metre, sonra karşı tarafı dener. Sıra: gate → junction → interval (tabela yeri kazanır). Kot yol spline'ının merkez çizgisi kotudur (`masks.ts` `StreetLine.heights`), zemin değil: Apply Pads sonrası aşama güncel kalır. Aşama `furniture` (`stages/furniture.ts`, `buildings`'ten sonra; ardından yalnız `fences`): placement `id` `wb-furniture-<yerleşim>-<rol>-<n>`, kuralın `role`'ü; kuralın `assetIds`'i varsa tohumlu biri (pivotunda durur, §13.7), yoksa `size` boyutunda `shape:cube`, rengi `placeholderColor` ya da rol ailesinin rengi (`prop.*` sarı, `vegetation.*` yeşil, §13.4); küp yol kotunun 0,3 m altından başlar (yan eğimde havada kalmaz). İç sokaklar (`streets` aşaması) `local` sayılır. Rapor kural başına: yerleştirilen / istenen yer, tıkananlar nedeniyle, hiç yer yoksa neden (çekirdeğe giren yol yok, kavşak yok, o sınıfta yol yok); spline'ı olmayan plan yolu adıyla. Korunan yerleşim donatısını korur. Recipe, profil ve placement şeması değişmedi. Bina aşaması rolün `assetIds`'ini hâlâ kullanmaz (rol çözücü T40). `tests/engine/worldFurniture.test.ts`, `tests/smoke/world-builder.spec.ts` (köy zincirinde giriş tabelaları, Apply Pads sonrası güncel) |
| Parsel çiti | `[KOD]` **MEVCUT** (2026-10-29, F1 adım 13b; L7) | Kullanıcı kararları: çit **zemini izler** ve ayrı aşamadır; profil alanı rol spesinde. Bölge profili: `roles[rol].fence = { role, height, thickness? (0,1 m), front? (varsayılan true), gap? (varsayılan 3 m), placeholderColor? }` (`normalizeRegionProfile`; bozuk çit düşer, rol kalır; nötr fixture'da `building.residential.detached` → `prop.fence.picket`). `engine/worldbuilder/fences.ts` (`planFence`): rolün lotunun (ev sahibi + `partOf`, `mergedPolygon`) sınırına ortalanmış; sokak cephesi de (`front: false` değilse), binanın girişinin ön kenara düştüğü yerde `gap` genişliğinde açık; sınır 0,25 m'de bir örneklenir, yola (kenarından 0,2 m), bina ve sokak donatısı ayak izine, suya (1 m), korunan alana ve arazi dışına düşen örnek açık kalır; önceki bir lotun çitlediği ortak kenar ikinci kez çitlenmez; serbest aralıklar en çok 4 m'lik düz parçalara, zemin parça boyunca 0,25 m'den fazla değişiyorsa (en kısa 1 m) daha kısalarına bölünür; parça uçlarındaki zemine oturur (alttan 0,2 m gömülü). Aşama `fences` (`stages/fences.ts`, `furniture`'dan sonra, son aşama): placement `id` `wb-fence-<ev sahibi parsel>-<n>`, çitin `role`'ü, `thickness` derinliğinde `shape:cube`, rengi `placeholderColor` ya da rol ailesinin rengi. **Sıra: … buildings → furniture → Apply Pads → fences.** Pedler lot sınırındaki zemini değiştirir (sınır pedin 0,5–1,5 m yakınında, 4 m'lik geçişin içinde): bake öncesi çalıştırılan çit bake sonrası güncellenecek görünür ve yeniden uygulanır; aşama raporu bunu hatırlatır. Rapor: rol başına lot, uzunluk, parça; engel yüzünden açık kalan metre; tek şerit olmayan lot. Korunan yerleşim çitlerini korur. Model yok (modüler çit modeli döşeme ayrı iş). `tests/engine/worldFurniture.test.ts` (`world fences`), `tests/engine/regionProfile.test.ts`, `tests/smoke/world-builder.spec.ts` (Apply Pads → fences → kayıt → yeniden yüklemede güncel) |
| Maske kiti | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 7; T04 + T20 çekirdeği) | `engine/worldbuilder/field.ts`: hücre merkezinde örneklenen XZ alan ızgarası (`Float32Array`, en çok 2048², `NaN` = veri yok) — yükseklik, eğim (derece), kıvrım (Laplace, 1/m), yol/nokta/poligon mesafe alanı (tam, `maxDistance` ile sınırlı damga), poligon/kutu maskesi, `bandMask` (falloff'lu aralık), VE/VEYA/çarpım/ters. `engine/worldbuilder/masks.ts`: recipe'den "boş tut" maskesi — yollar (arazideki bütün dünya spline'ları kendi genişliğinde + henüz spline'ı olmayan plan kenarları profil genişliğinde), plan suyu (nehir yarı genişlik, göl poligonu), korunan bölge ve korunan yerleşim. Saf ve deterministik; worker'a taşınabilir ama henüz worker'da değil. Level'daki Water Body/nehir actor'leri maskede yok (su aşamasıyla gelir). `tests/engine/worldMasks.test.ts` (WB-07'nin maske yarısı) |
| Stage önizlemesi (Preview diff, viewport'ta) | `[KOD]` **MEVCUT** (2026-10-29, F1 adım 14; T10) | Kullanıcı kararları: hayalet = asset sınır kutusu (gerçek mesh kopyası değil), otomatik kamera odağı yok (Focus düğmesi + satır tıklama), kabul = Apply, ret = Clear Preview, geri alma = mevcut undo. `src/editor/worldBuilderPreview.ts` (`buildStagePreview`, three'siz): `StagePlan` + level + arazi spline'larından öğe listesi — eklenen/güncellenen yeni haliyle (güncellenende eski hali de), silinen/bırakılan/engellenen level'daki haliyle; elle silinmiş bırakılan öğe yalnız listelenir. `src/scene/worldBuilderPreviewOverlay.ts`: renk başına tek birleşik çizgi grubu (eklenen yeşil, güncellenen amber + eski hal ve taşınma çizgisi soluk, silinen kırmızı, bırakılan mavi, engellenen mor), placement'ın asset sınırında kutu, World Terrain spline'ı segment çizgisi; derinliksiz, seçilemez, editör katmanı. Panel: önizleme bölümü (çizilen/toplam, değişikliğe göre gruplu liste, satır = o nesneye odak, Focus, Clear Preview). Önizleme yalnız kept/blocked içerse de gösterilir (plan `empty` olsa bile). Dry Run, Apply, level yüklemesi ve her geçmiş adımı (yürüt/undo/redo, `SceneApp.emitHistoryChanged`) önizlemeyi düşürür. Aşama çıktısı ve `planStage` değişmedi; `tests/engine/worldBuilderSession.test.ts` (önizleme level'ı/recipe'yi değiştirmez; added/updated/removed/kept/deletedByHand; spline yolu), `tests/smoke/world-builder.spec.ts` (`data-drawn` = katmanın kendi çizdiği sayı) |
| Yerleşim/rota üreticileri | `[KOD]` MEVCUT | Aşağıdaki aşama satırları (adım 6–13) |
| Placement kimliği | `[KOD]` **MEVCUT** (2026-10-28, F1 adım 1): `LayoutPlacement.id?` + `role?`, `engine/scene/placementIdentity.ts`, `validatePlacement` (layout içinde tekil), çoğaltma yeni `id` alır, `tests/engine/placementIdentity.test.ts`. v0.4 bulgusu, öncesi: | `LayoutPlacement` (`engine/scene/layout.ts`) `id` taşımaz; placement'lar `LayoutModelInstances { assetId, placements[] }` altında asset'e göre gruplanır. Yalnız ebeveyn olunca `nodeId` alır. Editör seçim kimlikleri indeks tabanlıdır (`editor/core/sceneObjects.ts`). Light, Blocking Volume, Landscape gibi actor'lerde `id` var. → Placeholder → model değişimi placement'ı başka bir asset grubuna taşır; kimlik için yeni alan gerekir (§13.4) |
| Primitive şekiller | `[KOD]` MEVCUT | `engine/scene/shapes.ts`: `shape:cube/sphere/cylinder/cone/plane` sentetik asset id'li sıradan placement. → Yapı placeholder'ının doğal biçimi (§13.4) |
| Blockout fırçası | `[KOD]` MEVCUT | `LayoutBlockingVolume`: box/cylinder/cone/sphere, `color`, `renderInGame`, `id`. → Elle blockout için uygun; üretilen yapı için değil (§13.4) |
| Referans görseli altlığı + plan katmanı (gösterim) | `[KOD]` **MEVCUT** (2026-10-29, F1 adım 15; T36 gösterimi, T23'ün semantik katmanı) | Kullanıcı kararları: altlık derinliksiz, kendi ızgara mesh'i (yaklaşık 4 m hücre, kenar başına en çok 128) ve **köşeleri arazi kotunu izler** (2026-10-29 değişikliği: ilk karar olan sırtların üstündeki düz düzlem alçak kameranın altında kalıp kayboluyor, perspektifte plan çizgilerinden kayıyordu; terrain shader'ına yine dokunulmaz; perspektif görsel yatırılmaz, durum `perspective`), düşük güven sabit `confidence < 0,5`, test görseli nötr yer tutucu PNG (`tests/smoke/fixtures/reference-underlay.png`, renkli köşeler yönü gösterir), elle düzeltme ayrı dilim (15b, aşağıdaki satır), maske gösterimi sonraya. Konvansiyon: `reference.origin` görselin sol üst köşesinin dünya noktası, görselde sağ = +X, aşağı = +Z (editörün tepeden görünümü); `engine/worldbuilder/reference.ts` (`referenceToWorld`/`worldToReference`, T35 de kullanır). `src/scene/worldBuilderRecipeOverlay.ts`: altlık + plan (yerleşim merkezi/yarıçap/sınır beyaz, yol grafı turuncu, su mavi, bölge camgöbeği, işaret pembe; düşük güven kırmızı, `observed: false` kesikli) + üretilen (çekirdek sarı, parsel arazi kullanımı renginde, ped açık gri); çizgiler zemini izler, seçilemez. Panel 'Viewport Layers': üç parça aç/kapa + altlık saydamlığı (izleyici ayarı, tarayıcı deposu; recipe'ye girmez, undo değil), referans formu (görsel yolu, sol üst, boyut, görünüm) = tek undo adımı, normalizer reddederse durum mesajı. Smoke WB-13 (`world-builder.spec.ts`: altlık `shown`, plan 8 öğe / 1 düşük güven, aç/kapa, formdan ayar + undo). OSM içe aktarma YOK → T37 |
| Elle plan düzeltme (T36 hibrit yüzeyi, §13.2 adım 4) | `[KOD]` **MEVCUT** (2026-10-29, F1 adım 15b) | Kullanıcı kararları: viewport + panel; ilk dilim nokta taşıma + ekle/sil + korunan bölge; düzeltilen öğede `source: "manual"`, `observed` ve `confidence` **silinir** (kırmızı/kesikli çizim kalkar). `src/editor/worldBuilderPlanEdit.ts` (saf işlemler) + `WorldBuilderSession.editPlan`: her düzeltme tek undo adımı, normalizer'ın önceki recipe'de olmayan bir sorun bulduğu düzeltme reddedilir (durum mesajı). Silme, öğeyi adlandıranları da düşürür: düğümün kenarları, kenarın parsel `frontage`'ı ve spline sahipliğindeki `edge`, yerleşimin üretilmiş site/parsel/ped kayıtları, düğüm/işaretlerin `settlement` bağı. Panel 'Plan Corrections': öğe listesi (satır seçer, viewport'ta yeşil vurgulanır), seçili öğenin alanları (konum, tür, nüfus, arama yarıçapı, düğüm türü, yol sınıfı, kutu köşeleri), Add (viewport'un baktığı yere) / Delete, düğümden kenar bağlama, guide noktası ekle/sil (guide en az 2 nokta; 1'e inerse kalkar). 'Edit in Viewport': her taşınabilir plan noktasına ekran boyutlu tutamaç; sürükle → araziye bırak (sürüklerken commit'lenmemiş kopya çizilir, bırakınca tek adım), Delete seçili öğeyi siler, Escape seçimi kaldırır; tutamaçlar sahne gizmosundan önce gelir (`bindings.ts` overlay kancası). Korunan bölgeler artık katmanda mor kesikli kutu. Smoke `world-builder.spec.ts` "plan corrections". AÇIK: su/bölge çizgisi noktaları (sonraki dilim), yeniden analizin manuel öğeleri koruması T35 ile gelir (veri hazır) |
| Dağlık test vadisi (WbTestValley) | `[KOD]` **MEVCUT** (2026-10-29, F1 adım 19) | `tools/world/wbTestValley.ts`: 512 m kare (4×4 tile × 64 quad × 2 m), X boyunca kıvrılan 80 m vadi tabanı, iki yanda 180 m'de ~85 m yükselen yamaç, hafif fBm; yükseklik saf fonksiyon. Recipe: tabanda 120 kişilik köy, kuzey yamaçta 25 kişilik mezra, vadi yolu (local) + mezraya track (20°). `npm run world:valley` level + terrain + recipe + nötr profili `public/layouts/` altına yazar (gitignore'lu, commit'lenmez). Engine testi `wbTestValley.test.ts` zinciri arazi dosyası olmadan çalıştırır ve sabitler: track serpantinle ≤ 20° (planlı çizgi 34,9°), köy **44 ihtiyaçtan 33 parsel** (bilinen açık), mezra yamaçta kalıyor (aşağıda). Smoke: level açılır, arazi yüklenir, roads + settlementSites çalışır. **Yamaç mezrası** (2026-10-29, kullanıcı kararı "seki + yükseklik niyeti"): ilk ölçümde mezra 35–38°'lik sekisiz yamaçtan 112 m kayıp tabana iniyordu. Vadinin kuzey yamacına ~25 m yükseklikte ~70 m genişliğinde seki eklendi (altı/üstü 35–50°); mezra, görselden okunmuş bir plan gibi sekinin 12 m üstündeki dik yamaca çizildi. `selectSite`: planlanan merkez dik diye dışlanırsa adaylar planın yüksekliğine yakınlıkla da puanlanır (ağırlık 0,35, 3–40 m); birim testinde niyet olmadan yollu tabana, niyetle sekiye gidiyor. `settlementSites` v3: yerleşime bağlı (`settlement`) yol düğümü seçilen çekirdeğin dışında kalırsa uyarır (aşama plan öğesini taşımaz; kullanıcı Plan Corrections ile taşır). Sonuç: mezra 58 m kayıp sekide, 11/11 parsel; köy **41/44** parsel (bilinen açık) |

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
| **T04** | Spatial Query & Mask Toolkit | KISMİ → çekirdek **MEVCUT** (F1 adım 7, `engine/worldbuilder/field.ts`) | `terrainHeightQuery.ts` (yükseklik/normal/katman ağırlığı), foliage eğim/yükseklik filtreleri | Mesafe alanları (yola/suya), kıvrım, exclusion maskeleri; worker'da |
| **T05** | Spline Road – büyük terrain | **MEVCUT** | 8A0–8A4 `[x]` | Yalnız programatik API: recipe'den spline oluşturma |
| **T06** | River / Lake / Pond – büyük terrain | KISMİ | River 8A5 `[x]`, Lake W1 `[x]`; puddle/ocean yok | API + W3 Puddle (Water planı) |
| **T07** | Stable IDs + Generated Ownership | KISMİ | Actor/light/volume `id` var; `uniqueEditorId` (`editor/core/ids.ts`); foliage grubu `id`; foliage instance'ında ve **`LayoutPlacement`'ta `id` yok** (v0.4 düzeltmesi) | `LayoutPlacement.id?` alanı (§13.4; **yapıldı** 2026-10-28) + `generatedBy {recipeId, stageId}` sahiplik kaydı (§6.3); foliage için grup düzeyi |
| **T08** | World Validation & Diagnostics | KISMİ | `verify:world-data`, `splineDiagnostics.ts`, içerik doğrulaması | Yol eğimi/dönüş, su-kıyı, çakışma, erişilebilirlik kontrolleri |
| **T09** | Asset Catalog Metadata | KISMİ | Manifest `category`, `tags`, `placement` | Biyom, boyut sınıfı, semantik rol, Foliage Type bağlantısı, WES mevsim varyantı. v0.4: rol → asset eşlemesi bölge profilinde yaşar, manifest'e kültürel bilgi girmez (§13.4) |
| **T10** | Preview / Diff / Bake / Rollback UI | KISMİ → **MEVCUT** (F1 adım 14: Dry Run viewport önizlemesi + panelde değişiklik listesi, Apply = kabul, Clear Preview = ret, undo = geri alma; §0.1) | Undo/redo + Save; Apply Pads elle bake (adım 12c) | Stage önizleme katmanı, değişiklik özeti, kabul/geri al |

### 4.2. P1 — İlk kullanışlı sürüm

| ID | Araç | Durum | Kanıt / not |
|---|---|---|---|
| **T11** | Procedural Macro Terrain | KISMİ | Heightmap import + `noise/terrace/ramp` fırçaları. Recipe'den bölge maskeli makro üretim YENİ |
| **T12** | Erosion / Sediment | **MEVCUT** (fırça) | `terrainErosion.ts` termal + hidrolik. Bölge/recipe çağrısı küçük iş |
| **T13** | Flow / Drainage Analyzer | YENİ | Akış yönü/birikimi, havza, çukur tespiti. Global map üzerinden worker |
| **T14** | Road Cost Map & Route Solver | YENİ → **MEVCUT** (F1 adım 8a, `engine/worldbuilder/route.ts`; araç profili Offroad verisinden henüz okunmuyor, sınırlar bölge profilinden). **Serpantin** (2026-10-29, dağlık test açığı): ilk A* hâlâ sınırdan dik çıkarsa yön bilen ikinci A* (hücre × 16 yön, dönüş açısıyla orantılı ceza, traverseler sınırın %85'ine hedeflenir, ızgara ≤ 60 000 hücre) traverse + dönemeç üretir; yumuşatma köşe koruyan yeniden örneklemeyi de dener (dönemeç kirişi yoldan diktir). 24,7° yamaçta 20° sınırlı patika 12,3°'de kalıyor; `minTurnRadius`'tan dar dönemeçler `tightBends` olarak raporlanır (dönemeç genişletme/kavşak düzleme yok). `roads` aşaması v4 | Araç profili Offroad verisinden (`src/game`/proje) okunur. Ayrıntı §13.5 |
| **T15** | Junction & Cross-Section | KISMİ → köy ölçeği T/Y **MEVCUT** (F1 adım 8b, `engine/worldbuilder/junctions.ts`; yalnız spline verisi, kavşak düzleştirme/boya yok) | Spline mesh bükme + yol süsleri var; gerçek kavşak yok. Köy ölçeği için T/Y kavşak yeterli (§13.5) |
| **T16** | Bridge / Culvert / Ford | YENİ | Placeholder ilk adım |
| **T17** | Shoreline & Wetness | KISMİ | Göl kıyısı (W1), ıslak çamur katmanı (deformasyon planı), WES ıslaklığı (görsel) |
| **T18** | Settlement & Parcel | YENİ → yer seçimi + program (F1 adım 9) ve sokak cepheli parsel (adım 10) **MEVCUT**; iç sokak üreticisinin ilk dilimi (organik + eşyükselti, aşama `streets`) **MEVCUT**; ızgara/radyal YENİ | Yer seçimi, program, ada/parsel (§13.3 L2–L4, §13.5) |
| **T19** | Biome Rules + PCG Scatter | KISMİ | `LandscapeFoliageRule` (paint katmanı → Foliage Type, yoğunluk), `proceduralFoliage.ts`, eğim/yükseklik filtreleri. Çok maskeli biyom kuralı ve exclusion YENİ |
| **T20** | Exclusion / Clearance Volumes | YENİ → maske **MEVCUT** (F1 adım 7, `engine/worldbuilder/masks.ts`); hacim/giriş önü yok | Foliage ve placement için ortak hacim/maske |
| **T21** | Road & Building Conform | KISMİ | Spline deform (yol) MEVCUT; bina pedi MEVCUT (F1 adım 12b veri `recipe.generated.pads`, 12c elle Apply Pads bake + undo, `engine/terrain/terrainPads.ts`); yeniden üretilebilir deform katmanı YOK. Ped modeli `[AÇIK]` (§13.10) |
| **T22** | Actor/Navigation Authoring | KISMİ | AI nav volume, grid nav (`MAX_GRID_CELLS = 20000`), spline path follower; tile'lı nav OPEN_WORLD Faz 9 |
| **T23** | World Overview / Debug Map | KISMİ | World Partition paneli + minimap (`worldMapView.ts`). Viewport'ta semantik katman (plan: POI, yerleşim, yol grafı, su, bölge; üretilen: çekirdek, parsel, ped) **MEVCUT** (F1 adım 15, §0.1); harita görünümünde semantik katman ve hata katmanı YENİ |

### 4.3. P2 — Görsel kalite, ölçek, otomasyon

| ID | Araç | Durum | Kanıt / not |
|---|---|---|---|
| **T24** | Advanced Biome Blending | KISMİ | 8 katman paint. Mevsimsel görünüm WES'in işi (WES v0.3 §8–9) |
| **T25** | Procedural Props / Rule Grammars | KISMİ | Spline modüler tekrar + yol süsleri; yerleşim sokak donatısı (giriş tabelası, kavşak, aralıklı aydınlatma) F1 adım 13a'da aşama `furniture` ile, parsel çiti 13b'de aşama `fences` ile **MEVCUT**; genel kural grameri YENİ |
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
| **T36** | Reference Underlay | YENİ → gösterim **MEVCUT** (F1 adım 15: düz altlık + plan katmanı + referans formu; §0.1); elle plan düzeltme (15b) **MEVCUT** (nokta taşıma, ekle/sil, korunan bölge; su/bölge çizgileri açık) | Görseli editörde araziye tepeden yatırır, plan katmanını üstüne çizer; hibrit düzeltmenin yüzeyi (§13.2) |
| **T37** | OSM Import & Scale | YENİ | `tools/` altında dev-time; yol grafı, bina izi, arazi kullanımı, donatı; topoloji ölçeklenir, ölçüler bölge profilinden gelir (§13.6) |
| **T38** | Road Graph | YENİ | Topoloji verisi (düğüm/kenar/sınıf); spline'lar bundan üretilir (§5.2'deki "bağlantı grafı") |
| **T39** | Land-Use Allocator | YENİ → **MEVCUT** (F1 adım 11: `engine/worldbuilder/landUse.ts`, aşama `landUse`; büyük rol için parsel birleştirme `partOf`) | Parsellere rol dağıtımı: program + puan + uyumluluk tablosu (§13.5) |
| **T40** | Semantic Placeholder & Role Resolver | YENİ → placeholder **MEVCUT** (F1 adım 12: aşama `buildings`, placement `color`); rol → model çözümü YENİ | Rol → asset çözümü; asset yoksa rol renginde `shape:cube`; placeholder → model geçişinde kimlik/giriş korunur (§13.4, §13.7) |
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
| **F1b — Referanstan plan** (v0.4) | Semantic World Plan şeması, görsel yorumlayıcı (T35), Reference Underlay + plan katmanı (T36), üç test görseli | AI planı görselin üstünde doğru yerde; kullanıcı editörde düzeltebiliyor (WB-13) | Şema (recipe `plan` + kaynak/güven) ve T36 gösterimi MEVCUT (adım 15); elle düzeltme (15b) MEVCUT (su/bölge çizgileri hariç); T35 ve test görselleri (karar 16) açık |
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
| **L7 Sokak donatısı** | Tabela, aydınlatma, çit, durak | Yol sınıfı + profilin donatı rolleri | placement'lar (aşama `furniture`) |

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
    fence?: { role: string; height: number; thickness?: number; front?: boolean; gap?: number; placeholderColor?: string };  // lot çiti (F1 13b)
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
- Kavşakta donatı (kollar arası en geniş boşluk).
- Uygun rollerde parsel sınırı çiti `[KOD — 13b]`: rol spesinde `fence`, aşama `fences`; çit zemini izler, bu yüzden Apply Pads'ten sonra çalışır.
- Uygulama `[KARAR 2026-10-29]`: World Builder sahipliğinde ayrı placement'lar (`id`, `role`, renk; WB-17 ve T41 doğrudan çalışır), yol spline'ının süsü değil. `splineRoadDecorations.ts` yalnız `LayoutSplineActor` üstünde ve rol/kimlik taşımadan çalışır. Donatı yalnız yerleşim çekirdeğinde üretilir; yerleşimler arası yol donatısı sonraya kalır.

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
