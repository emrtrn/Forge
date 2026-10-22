# Forge Offroad — Forge Teknik Yetenek ve Mevcut Durum Raporu

**Sürüm:** 0.1 — doldurulmuş teknik envanter  
**İlgili proje:** Forge Offroad  
**Ana oyun deneyimi:** Lojistik ve taşımacılık  
**Dünya:** İzole dağ yerleşimleri  
**Rapor tarihi:** 23 Ekim 2026, Europe/Istanbul  
**İncelenen repo:** `C:\Users\emret\Desktop\Forge`  
**Branch / commit:** `feat/open-world` / `84ff7cf877cf2338a54598afb9936cf291656c11`  
**Şablon:** [FORGE_OFFROAD_FORGE_TEKNIK_DURUM_RAPORU_SABLONU_v0.1.md](../planned/FORGE_OFFROAD_FORGE_TEKNIK_DURUM_RAPORU_SABLONU_v0.1.md)

> **Temel sonuç:** Forge, düzenlenebilir arazi üzerinde sürülebilen raycast araçlar, otomatik vites, kamera, araç AI rotası ve araç durumunu kaydetme/yükleme için uygulanmış bir temel sunuyor. Yük taşıma oyunu, yükün fiziksel etkisi, çamur/kar yüzey tepkisi ve kalıcı sürüş izleri hazır değil. Kilometrelik açık dünya için veri altyapısı ve ayrı ölçüm prototipleri var; mevcut uygulama renderer'ı hâlâ tek tile adaptöründe.

## 0. Kullanım ve doğrulama sınırı

Bu rapor kaynak kod, fixture, test ve repo belgelerinin incelemesine dayanır. Kod, bağımlılık, proje ayarı ve kullanıcı sahneleri değiştirilmedi. Rapor ve üç kanıt ekran görüntüsü üretildi; testlerin geçici dosyaları ve çıktıları ayrıca oluştu. Başlangıç Git durumunda yalnız kullanıcı tarafından eklenmiş, izlenmeyen rapor şablonu vardı.

Durum sözlüğü: **Çalışıyor ve test edildi / Uygulandı fakat doğrulanmadı / Kısmen çalışıyor / Planlandı / Yok / Belirsiz**. “Yok”, belirtilen entegrasyonun incelenen kaynaklarda bulunamadığını anlatır; alttaki kütüphanenin teorik olarak yapamayacağı anlamına gelmez. “Çalışıyor ve test edildi” yalnız karşısındaki senaryonun kapsamındadır.

### Bu incelemede yapılan doğrulamalar

| Kontrol | Sonuç | Kapsam / sınır |
|---|---|---|
| `npx.cmd tsc --noEmit` | **Geçti**, çıkış 0 | Ana uygulama TypeScript denetimi; `spikes/` bunun dışında |
| `npm.cmd run test:engine:slow` | **1.291 kontrol geçti**, çıkış 0 | Filtresiz motor testleri ve slow kontroller; Node/Rapier/saf matematik, DOM/render nesnesi testleri |
| Hedefli Playwright | **17/17 geçti**, çıkış 0; **8.8 dakika** | Araç ve terrain için 6 dosyadaki mevcut Chromium senaryoları; kaynak `public/` yerine izole kopya, port 5284. Tam browser suite değildir |
| `build:verify`, release/production smoke | Bu incelemede çalıştırılmadı | Önceki belgelerdeki başarılar bu commit için yeni çalıştırılmış sayılmadı |
| T01–T05 gerçek Offroad kabul testleri | Tamamlanmadı | Bölüm 6'da her senaryonun eksik ve mevcut kanıtı ayrı |

Test yürütücüsü: `tools/run-engine-tests.mjs`; kontrol kaydı: `tools/engine-tests.ts` ve onun çağırdığı `tests/engine/*.test.ts`. İlk motor testi sandbox dosya erişimi nedeniyle başlayamadı; aynı komut uygun yürütme izniyle başarıyla tamamlandı. İlk tarayıcı başlatmada 5273 portu doluydu; mevcut sunucuya müdahale edilmeden desteklenen `FORGE_SMOKE_PORT=5284` override'ı kullanıldı.

Kod/test yolları repo köküne göredir. Belge kaynaklı eski ölçümler Bölüm 5'te açıkça etiketlidir; bu oturumda tekrar ölçülmüş kabul edilmez. Güvenlik sırları, kullanıcı verileri ve büyük ikili assetler rapora alınmadı.

AGENTS.md doğrultusunda ek inceleme önerisi: yeni terrain kayıt uçları ve ikili veri kabulü için `vite.config.ts`, `tools/terrainSaveValidator.ts`, `engine/terrain/{terrainDefinition,terrainTileCodec,terrainLoader}.ts` kapsamlı bir Codex Security `security-scan`. Bu incelemede security taraması çalıştırılmadı.

## 1. Genel motor ve editör mimarisi

| Başlık | Mevcut teknoloji / açıklama | Durum | Kod / test kanıtı |
|---|---|---|---|
| Dil ve framework | TypeScript + Vite; DOM tabanlı editör/UI, özel motor ve runtime katmanları. Kurulu sürümler: TypeScript **5.9.3**, Vite **7.3.5**; bunlar `package.json` aralıklarından ayrı olarak kurulu paketlerden okundu. | Çalışıyor ve test edildi | `package.json`; `src/main.ts::main`; bu incelemenin `tsc` sonucu |
| Renderer ve API | Three.js **0.184.0**, `WebGLRenderer`; WebGL2 zorunlu kontrolü. Ana renderer'da WebGPU backend yok. | Çalışıyor ve test edildi | `engine/render-three/renderer.ts::createSceneRenderer`; tarayıcı kapsamı yukarıda |
| Fizik altyapısı | Kurulu `@dimforge/rapier3d-compat` **0.19.3**; WASM dinamik yüklenir. Collider yoksa placeholder yolu kullanılabilir. Sabit fizik adımı varsayılan **1/60 s**, kare başına en fazla **4** alt adım; render pozu interpolasyonu var. 60 Hz değeri ölçülmüş fizik maliyeti değildir. | Çalışıyor ve test edildi | `engine/physics/physicsSubsystem.ts::init/update`; `engine/physics/fixedStep.ts::FixedStepClock`; `tools/engine-tests.ts` — `fixed step clock takes the same slice count at 30, 60 and 144 Hz`, `rapier fixed step simulates the same fall at 30 Hz and 144 Hz` |
| Editör-runtime ayrımı | `?editor` ve `import.meta.env.DEV` ile editör dinamik yüklenir. Runtime `createForgeRuntime`, capability listesi ve oyunun `createGameModule` bileşimini kullanır. Üretimde editörün elenmesi için build/import kapıları mevcut. | Çalışıyor ve test edildi | `src/main.ts::main`; `src/scene/ForgeRuntime.ts`; `tests/engine/capabilityRegistry.test.ts`, `capabilityCoverage.test.ts`, `forgeGameModule.test.ts`; bu oturumda dist paketi yeniden doğrulanmadı |
| Actor / component | `Entity.components` veri haritası; `*.actor.json` prefab/sınıfları, component şablonları, parent class, event→TypeScript behavior bağları. Capability modülleri generic; oyun kuralları `src/game` katmanında. | Çalışıyor ve test edildi | `engine/scene/entity.ts::Entity`; `engine/scene/actorScript.ts::normalizeActorScriptDef`; `actorInstance.ts`; `src/scene/capabilities/defaultRuntimeModules.ts`; actor, capability ve serialization kontrolleri |
| Sahne ve asset kayıt biçimi | Level JSON + asset manifest; actor, vehicle, material, collision, UI, audio/VFX gibi tipli sidecar'lar. Terrain için yeni `.terrain.json` + `.tiles/x_z.tile.bin` biçimi ve eski `.landscape.json` okuma yolu birlikte mevcut. | Çalışıyor ve test edildi | `engine/scene/layout.ts`, `sceneSerialization.ts`; `engine/assets/manifest.ts`; `tools/saveValidator.ts`; `tools/terrainSaveValidator.ts`; `tests/engine/serializationDrift.test.ts`, `droppedFields.test.ts`, `terrainDocument.test.ts` |
| Asset loading ve streaming | Manifest/load-group bazlı GLTF yükleme, model cache'i, progress/hata bildirimi; fizik kodu lazy yüklenir. Terrain loader listedeki tile'ları açılışta sırayla **tamamını** okur. Oyuncuya göre dünya/asset residency streaming yok. | Kısmen çalışıyor | `src/scene/assetLoader.ts::AssetLoader.loadGroups/loadModels`; `engine/render-three/gltfModelLoader.ts`; `engine/terrain/terrainLoader.ts::loadWorldTerrain`; `tests/engine/contentLoading.test.ts`; `terrain loader: eagerly reads listed tiles, keeps holes and rejects missing/mismatched binaries` |
| Performans ve debug | `?debug`: FPS/frame timing, subsystem bölgeleri, GPU timer/capture/sweep, render sayaçları, GPU kaynak adetleri, uygun tarayıcıda JS heap; kalite profilleri ve adaptif kalite. Araç hızı/RPM/vites, AI ve süspansiyon wire'ı mevcut. | Çalışıyor ve test edildi | `engine/core/subsystemProfiler.ts`; `engine/perf/{frameRegions,gpuTimer,frameCapture,qualityProfiles,adaptiveQuality}.ts`; `src/scene/{debugStats,runtimeDebugSnapshot}.ts`; `tests/engine/{frameRegions,frameCapture,gpuSweep,perfReadout}.test.ts`; `vehicleRuntime.test.ts` |

## 2. Landscape / arazi sistemleri

### 2.1 Veri modeli, çözünürlük ve gerçek çalışan yol

**Mevcut mesh/brush yolu — Çalışıyor ve test edildi:** `ForgeLandscapeData` yüksekliği JavaScript `number[]` olarak tutar. Preset'ler 65×65, 129×129, 257×257 vertex; varsayılan spacing 1 m, heightScale 1. Renderer **32×32 quad** chunk'lar üretir. Büyük preset 1 m spacing ile **256×256 m**, **131.072 arazi üçgeni**, **64 render chunk'ı** eder; bunlar grid hesabıdır, ölçülmüş draw call/FPS değildir. Spacing artınca alan büyür, örnekler arası mesafe de artar. Kaynak: `engine/scene/landscape.ts::{LandscapeSize,landscapeSizeForPreset,LANDSCAPE_QUADS_PER_CHUNK}`; `engine/render-three/landscape.ts::buildLandscapeChunkMeshes`.

**Yeni World Terrain veri temeli — Çalışıyor ve test edildi; renderer entegrasyonu kısmi:** `WorldTerrainDef` kare tile grid'i, origin, height aralığı, katmanlar ve tile özetleri içerir. `tileQuads` 32–512 arası ikinin kuvveti, varsayılan 256; eksen başına en fazla 32 tile; spacing 0.01–100. Bellekte yükseklik **Float32Array**, ağırlıklar **Uint8Array/RGBA8**, en fazla **8 katman**. Disk kodeği 32 bayt FTIL v1 başlık, **Uint16 veya Float32 height** destekler. Codec varsayılanı u16 iken mevcut editör snapshot kaydı geometriyi korumak için açıkça **f32** seçer. Kaynak: `engine/terrain/{terrainTypes,terrainDefinition,terrainTileCodec}.ts`; `terrainLandscapeBridge.ts::captureTerrainSnapshot`; testler: `terrain: tile quads must be a power of two in 32..512`, `terrain codec: u16 round-trip is within one quantization step`, `terrain codec: f32 heights round-trip exactly and decode from an offset view`.

Uygulamadaki varsayılan height aralığı **−256..+256 m**. Planın K1 girişindeki daha eski −256..+1792 m örneği mevcut varsayılan değildir. “8 km dünya” da şemanın mutlak fiziksel sınırı değildir: 32×256×1 m varsayılan konfigürasyon hesabıdır; validator ayrı spacing/tileQuads değerlerini kabul eder. Bu, o boyutlarda çalışan runtime kanıtı sağlamaz.

**Asıl sınır:** `terrainDocumentToLandscape` yalnız **1×1, tek mevcut tile** kabul eder; multi-tile/hole durumunda açık hata verir. Renderer `ensureLandscapeLayers` üzerinden hâlâ grass/dirt/rock/snow dört katmanına döner; yeni formatın sekiz katmanı uygulama render/brush desteği sayılmamalı. Editörde `SceneApp.addLandscape` seviye başına bir Landscape ile sınırlı. Kaynak: `engine/terrain/terrainLandscapeBridge.ts::terrainDocumentToLandscape`; `engine/scene/landscape.ts::ensureLandscapeLayers`; `src/scene/SceneApp.ts::addLandscape`.

**Gerçek proje verisi:** `public/project.3dgame.json` varsayılanı `assets/starter-content/Levels/Terrain.level.json`. Bu level'ın `dataRef`'i `Terrain.landscapes/landscape-1.terrain.json`; tanımı 1×1 tile, tileQuads 256, spacing 1, origin ve height aralığı tanımda. Ayrı `public/landscapes/landscape-1.terrain.json` spacing **0.5** kullanır; aynı dosya veya aynı saha ölçüsü sanılmamalı.

### 2.2 Üretim ve editör araçları

| Yetenek | Durum | Veri akışı / kanıt / sınır |
|---|---|---|
| Sculpt | Çalışıyor ve test edildi | Raise/lower/smooth/flatten; brush çevresinde dirty bounds, undo/redo, geometri güncellemesi ve save. `SceneApp::{applyLandscapeSculptDab,editLandscapeHeights,nextLandscapeHeight}`; `tests/smoke/landscape-sculpt.spec.ts` — `editor Landscape sculpt smoke: add, sculpt, edit during save, retry, reload` |
| Paint | Çalışıyor ve test edildi | Vertex ağırlıkları normalize edilir; görsel material/texture atanır. `SceneApp::editLandscapeWeights`; `landscape.ts::normalizeLandscapeLayerWeights`; `tests/smoke/landscape-paint.spec.ts` — `editor Landscape paint smoke: paint layer, save, reload` |
| Spline ile arazi şekillendirme ve yol | Çalışıyor ve test edildi | Spline corridor flatten/deform/paint, eğri mesh zinciri, dallanma/closed loop. Bu deformasyon **authoring** işlemidir. `landscape.ts::{applyLandscapeSplineDeform,applyLandscapeSplinePaint,resolveLandscapeSplineMeshChains}`; `engine/render-three/splineDeformMesh.ts`; motor kontrolleri `applyLandscapeSplineDeform flattens terrain toward the spline corridor`, `landscape splines support shared-point branches and closed loops`; `tests/smoke/landscape-spline-chain.spec.ts` |
| Heightmap import/export | Çalışıyor ve test edildi | RGBA görüntüden luminance/bilinear resample; seçili grid'e import, normalize grayscale `Uint8ClampedArray` PNG-ready export. 16-bit RAW/world-scale import uygulanmış sayılmaz. `SceneApp::{importSelectedLandscapeHeightmap,exportSelectedLandscapeHeightmap}`; `landscape.ts::{resampleLandscapeHeightmap,landscapeHeightsToGrayscale}`; motor kontrolü `landscape heightmaps bilinearly resample and export normalized grayscale` |
| Düz terrain üretimi | Çalışıyor ve test edildi | `createFlatLandscapeData`, `createFlatTerrainTile`; yeni Landscape oluşturma yolu |
| Noise/erosion ile genel dağ dünyası üretme aracı | Yok | Uygulama terrain editöründe bulunmadı. `spikes/terrain-cdlod/worldGen.ts` ölçüm sahnesi üretir; üretim editörüne bağlı değildir. World import/üretim genişlemeleri `docs/planned/OPEN_WORLD_PLAN.md` Faz 2/8'de planlı |

### 2.3 Collision, yüzey fiziği ve kalıcılık

**Terrain collision — Çalışıyor ve test edildi, statik:** Uygulama runtime'ı `RuntimeSceneApp::landscapeColliderEntity` → `createLandscapeColliderPrimitive` ile tüm terrain'den **tek statik trimesh** üretir. Render 32-quad chunk'lara ayrılsa da fizik aynı şekilde parçalanmış değildir. Geometri Save/Play/yeni scene build yolunda yeniden kurulur; sculpt darbelerinde canlı fizik güncelleme yolu yok. Kaynak: `src/scene/RuntimeSceneApp.ts::buildRuntimeLandscapes/landscapeColliderEntity`; `engine/scene/landscape.ts::createLandscapeColliderPrimitive`.

**Tile heightfield temeli — Çalışıyor ve test edildi, uygulamaya bağlı değil:** `engine/physics/terrainCollider.ts::terrainTileHeightfieldShape` sütun öncelikli heightfield shape verisi üretir. `tests/engine/terrain.test.ts` içindeki `terrain rapier: heightfield collider surface equals terrainHeightAt (K3a)` testi gerçek Rapier world'e 2×2 tile ekleyerek 400 rastgele nokta ve dikiş/köşelerde 1e−3 toleransıyla kontrol eder. Bu test, ana `PhysicsSubsystem`'in terrain collider'ını heightfield'a çevirdiği anlamına gelmez; o bağlantı `OPEN_WORLD_PLAN.md` Faz 3'te açık.

**Güncelleme maliyeti:** Bu incelemede uygulama collider rebuild süresi ölçülmedi. Güncel sculpt render yolu `updateLandscapeObjectGeometry` ile dirty bounds'a değen chunk geometrilerini dispose edip yeniden kurar; `editLandscapeHeights` ayrıca tüm height dizisini kaynak kopyası olarak alır. Dolayısıyla küçük brush alanı olması toplam CPU maliyetinin yalnız yerel olduğu anlamına gelmez. Kaynak: `engine/render-three/landscape.ts::updateLandscapeObjectGeometry`; `src/scene/SceneApp.ts::editLandscapeHeights`.

**Yüzey katmanı ile fiziksel materyal ayrımı — Kısmen çalışıyor:** Grass/dirt/rock/snow katmanları görseldir. `LandscapeLayerWeights` ve `WorldTerrainLayerDef` içinde lastik yüzey profili bağlantısı yok. Genel collider physical material sistemi yalnız `friction/restitution` tanımlar; default, slippery, rubber, metal, wood, stone presetleri vardır. `PhysicsSubsystem::attachVehicleController` lastik grip değerlerini araç tanımından alır; `updateVehicles` terrain layer örnekleyip değiştirmez. Çamur/snow/sand lastik profili, sink resistance ve provider callback'i yalnız `TERRAIN_DEFORMATION_PLAN.md` içinde planlıdır. Kaynak: `engine/scene/collision.ts::{PhysicalMaterialDef,PHYSICAL_MATERIALS}`; `vehicleTypes.ts::VehicleWheelDefinition`; `physicsSubsystem.ts::attachVehicleController/updateVehicles`.

**Editör kaydı — Çalışıyor ve test edildi:** `captureTerrainSnapshot` → tile kaydı → tanım kaydı → level referansı; level'a özel `.landscapes/` yolları kullanılır. Eski sidecar migrasyonda korunur. Hata/retry ve kayıt sırasında yeni edit'in korunması için testler var. Bu dosyalar arası tam disk transaction değildir. Kaynak: `src/editor/terrainStore.ts`; `src/editor/editorSaveCoordinator.ts`; `tools/terrainSaveValidator.ts`; `tests/engine/{terrainDocument,editorSaveCoordinator}.test.ts`; `tests/smoke/{terrain-migration,terrain-isolation}.spec.ts`.

**Araç geçişiyle deformasyon — Planlandı:** Tekerlek→terrain yazma hattı yok. Arazi verisinin kaydedilmesi, sürüş izinin kaydedilmesi değildir. `GameSaveState` içinde terrain deformation alanı bulunmaz. Planlanan 64 m pencere, 12.5 cm hücre, CPU iz alanı, shader, sink ve save-game önerileri henüz uygulama değildir. Üstelik mevcut plan bile collider'ı her izde yeniden kurmayı hedeflemez; gömülmeyi süspansiyon/kuvvet ile taklit etmeyi önerir. Kaynak: `docs/planned/TERRAIN_DEFORMATION_PLAN.md` — durum “Planlandı, başlanmadı”; `engine/persistence/saveGameState.ts::GameSaveState`; `src/scene/capabilities/defaultRuntimeModules.ts` listesinde deformation capability yok.

### Kritik teknik ayrım

| Deformasyon düzeyi | Durum | Kanıt / açıklama |
|---|---|---|
| Tekerlek izi / görsel decal | Planlandı | Çalışan vehicle modülü wheel visual, engine sound ve debug wire üretir; iz basma/decal katmanı yok. `src/scene/capabilities/vehicleModule.ts`; deformation planı Faz 2 |
| Shader tabanlı yer değiştirme | Planlandı | Sürüş izi displacement'ı yok. Ayrı `spikes/terrain-cdlod/terrainMaterial.ts` height displacement prototipi, uygulamaya entegre değil; iz simülasyonu da değil |
| Runtime render geometry değişimi | Planlandı | **Araç kaynaklı terrain değişimi için.** Editörde dirty chunk rebuild ve yol mesh deformasyonu var; oyun sırasında tekerleklerin terrain mesh'ini değiştirmesi yok |
| Runtime collision geometry değişimi | Yok | Sürüşle güncellenen terrain collider yok. Scene/Play rebuild başka bir yaşam döngüsü; heightfield shape yardımcı fonksiyonu canlı deformasyon sistemi değil |
| Zeminin batma / çekiş direnci hesabı | Planlandı | Araç başına sabit rolling resistance var; çamur/kar derinliği, katman ve tekerlek yükünden türetilmiş direnç yok. `vehicleDrive.ts`; deformation planı Faz 1/3 |
| Deformasyonun kaydedilmesi | Planlandı | `GameSaveState` araç hareketini saklar, iz alanını saklamaz; deformation planı Faz 5 |

### 2.4 Büyük dünya, su ve yollar

- **Chunk streaming ve terrain LOD — Planlandı.** `loadWorldTerrain` eager; mevcut renderer CPU mesh + frustum culling kullanır, terrain LOD seçimi yapmaz. `engine/world/worldGrid.ts` hücre matematiği mevcut ve testlidir; streaming lifecycle/residency değildir. CDLOD, texture pool, worker, activation budget ayrı spike/plan aşamasında. `spikes/README.md` bu sayfaların uygulama build'inin dışında olduğunu açıklar.
- **Mevcut optimizasyonlar — Çalışıyor ve test edildi.** Foliage instancing, 16 m chunk ve distance/frustum culling; kural başına 20.000 üretim sınırı; seçili mesh alternatifleri için Three.js LOD yardımcıları; kalite/adaptif kalite, uzak AI/animasyon cadence ve dinamik physics active area. Kaynak: `engine/{scene/foliage,scene/landscapeFoliage,render-three/foliage,render-three/distanceLod,perf/qualityProfiles}.ts`; `physicsSubsystem.ts::setDynamicActiveArea`; motor kontrolleri `LOD templates preserve authored distances while quality bias retunes them`, `rapier active area suspends distant dynamics and resumes them near focus`. Bunlar terrain/asset streaming'in yerine geçmez.
- **Bellek yönetimi — Kısmen çalışıyor.** Sahne teardown ve terrain/foliage geometri dispose yolları mevcut; tile residency eviction ve dünya ölçeğinde referans sayımlı asset yaşam döngüsü henüz bağlı değil. `disposeLandscapeObject`, `Foliage` render yaşam döngüsü, `AssetLoader`/`GltfModelLoader`; `OPEN_WORLD_PLAN.md` K5 ve sonraki fazlar.
- **Su / nehir görselleştirmesi — Çalışıyor ve test edildi.** Landscape spline referanslı ribbon, flow/normal/foam, depth/renk, opsiyonel planar reflection. `engine/scene/riverWater.ts::resolveRiverWater`; `engine/render-three/riverWater.ts::{buildRiverWaterRibbon,RiverWaterObject}`; motor kontrolü `River Water Body resolves defaults and only saves presentation fields`; `tests/smoke/terrain-migration.spec.ts` nehir referanslarıyla save/reload/Play kontrolü içerir. Araç yüzdürme, akıntı kuvveti, su derinliğinden motor boğulması bulunmadı.
- **Bataklık — Yok.** Görsel malzeme/su ile sahnelenebilir; bataklık hacmi, tekerlek batması ve kurtarma mekaniği bulunmadı.
- **Yollar — Çalışıyor ve test edildi.** Spline terrain şekillendirme/boyama + mesh zinciri, yol collider'ları; ayrıca araç AI'sının izlediği Generic Spline sistemi. Görsel yolun asfalta özgü lastik profili olduğu varsayılmamalı. `SceneRuntimeCore.ts::landscapeSplineMeshColliderPrimitive`; `RuntimeSceneApp.ts::landscapeSplineColliderEntity`; `src/scene/capabilities/vehicleAiModule.ts`; `tests/engine/vehicleAi.test.ts`.

## 3. Araç simülasyonu

| Sistem | Var mı? Durum | Nasıl çalışıyor? | Kod / test kanıtı |
|---|---|---|---|
| Sürülebilir araç, giriş kontrolleri | Çalışıyor ve test edildi | Vehicle component + dinamik chassis; `forge.vehicle` veya TPS araca bin/in. WASD/oklar, Space el freni; gamepad stick/trigger analog girdileri; E bağlama göre bin/in/reset. | `src/game/gameModes/{vehicleGameMode,vehicleDriver,vehicleCameraControl,vehicleEntry}.ts`; `tests/engine/vehicleRuntime.test.ts` — `vehicle mode maps WASD + Space onto pedals, steering and handbrake`, `vehicle mode steers directly with a stick and treats the triggers as analog pedals`; `vehicleEntry.test.ts` |
| Rigid-body kütle ve ağırlık merkezi | Çalışıyor ve test edildi | `massKg`, `centerOfMassOffset`; collider density sıfırlanır, authored toplam kütle ve kutu yaklaşımı inertia uygulanır. | `vehicleTypes.ts::VehicleDefinition`; `physicsSubsystem.ts::attachVehicleController`; araç settle/sürüş/aerodynamics Rapier testleri. Yükten dinamik hesap değildir |
| Tekerlek collider / raycast | Çalışıyor ve test edildi | Rapier `DynamicRayCastVehicleController`; chassis collider'ına ek olarak tekerlek süspansiyon ray'leri. Görsel tekerlek bağımsız rigid-body collider değildir. | `physicsSubsystem.ts::attachVehicleController/vehicleState`; `rapier vehicle settles on its suspension with every wheel grounded`; `vehicleRuntime.test.ts` wheel visual bağlama kontrolleri |
| Süspansiyon yay-sönümleme | Çalışıyor ve test edildi | Rest length, max travel, stiffness, compression/relaxation damping, max suspension force; temas ve süspansiyon uzunluğu readback'i. | `VehicleWheelDefinition`; `controller.setWheel*`; aynı Rapier settle testi, `vehicle module hangs a wheel per suspension ray and follows the live readback` |
| Motor torku, vites, şanzıman | Çalışıyor ve test edildi | RPM→tork eğrisi, idle/rev limit, ileri/geri oran, final drive, efficiency, otomatik vites hysteresis ve shift kesintisi, motor freni. Drivetrain null ise eski düz kuvvet yolu. RPM longitudinal chassis speed'den türetilir; gerçek wheel-slip/free-rev/clutch simülasyonu değil. | `vehicleDrivetrain.ts::{computeDrivetrainDrive,sampleTorqueCurve,selectAutomaticGear}`; `vehicleDrive.ts`; `tests/engine/vehicleDrivetrain.test.ts`; `tools/engine-tests.ts` 0–100 testi |
| AWD/4WD ve diferansiyel kilidi | Kısmen çalışıyor | FWD/RWD/AWD ön/arka tork dağılımı var. Seçilen aksın tekerleklerine eşit pay verilir. Kullanılabilir differential lock, low range/transfer case, tekerlek hızına göre açık/kilitli diferansiyel çözümü bulunmadı. | `VehicleDrivetrainDefinition.differential`; `vehicleDrivetrain.ts::torqueShares`; `vehicle drivetrain FWD RWD and AWD split torque by axle independently of legacy drive flags` |
| Yüzeye göre tutuş / kayma | Planlandı | Sabit wheel `frictionSlip`, `sideFrictionStiffness` ve el freni grip çarpanı var; paint katmanına göre lastik profili yok. | `physicsSubsystem.ts::attachVehicleController/updateVehicles`; `vehicle drivetrain speed steering curve reduces both forward and reverse lock and handbrake grip restores`; `TERRAIN_DEFORMATION_PLAN.md` Faz 1 |
| Eğim / devrilme / çekiş limitleri | Kısmen çalışıyor | Yerçekimi, rigid-body, COM ve süspansiyon ile fiziksel davranış; hıza bağlı direksiyon, basit drag/downforce. 8° rampada el freni testi mevcut. Taşlı yamaç, azami tırmanma ve yüklü devrilme kabulü yapılmadı; anti-roll bar planında açık. | `tools/engine-tests.ts` — `rapier vehicle handbrake holds on a slope and releasing it rolls downhill`; `computeVehicleAerodynamics`; `VEHICLE_PHYSICS_PLAN.md` Faz 3 |
| Yük kütlesi ve ağırlık merkezi etkisi | Yok | Chassis kütle/COM ayarlanabilir; pickup edilen yükten toplam mass/COM/inertia türeten, yükü bağlayan veya kaydıran sistem bulunmadı. Görsel child attachment kütle birleşimi kanıtı değildir. | `VehicleDefinition`; `attachVehicleController` yalnız definition.massKg/centerOfMassOffset okur; gameplay/capability taraması; T01 yok |
| Römork / bağlantı sistemi | Yok | Hitch, attach/detach, römork fren/aks/elektrik akışı yok. Rapier joint kapasitesi bulunması ürün entegrasyonu değildir. | Vehicle tipleri/modülleri; `physicsSubsystem.ts` mevcut spherical joint kullanımı ragdoll içindir |
| Vinç / halat / fizik kısıtları | Yok | Vinç, ankraj, kablo uzunluğu/gerilim/çekme ve kurtarma akışı yok. | `engine/physics/ragdoll.ts` ve `physicsSubsystem.ts` ragdoll joint'leri; vehicle/game katmanında vinç sistemi bulunmadı |
| Araç hasarı / yakıt | Yok | Genel `Damage.Apply` ve health behavior altyapısı var; araç motor/lastik/süspansiyon hasarı, tüketim/depo/yakıt ikmali yok. | `src/game/behaviors.ts` damage/health behavior'ları; `VehicleDefinition`, `SavedVehicleState`; motor damage convention kontrolleri araç hasarı kabulü değildir |

Araç içerik örnekleri: `public/assets/starter-content/Gameplay/ReferenceCar.vehicle.json`, `public/assets/vehicles/{gaz52/Gaz52,mercedes-sls/MercedesSLS}.vehicle.json`. Gaz52 tanımında 2.500 kg ve dört tekerlek var; bu dosyanın bulunması yük kapasitesi veya gerçek kamyon/offroad sürüşü testi değildir. Actor/asset normalizasyonu ve kaydetme allowlist'i `normalizeVehicleDefinition/normalizeVehicleAsset` üzerinden ortak; override ve loader cache testleri `tests/engine/vehicleAssets.test.ts` içinde.

## 4. Gameplay temel altyapısı

| Alan | Durum | Mevcut sistem ve teknik sınır / kanıt |
|---|---|---|
| Görev sistemi | Kısmen çalışıyor | `src/game/gameRules.ts::GameStateStore`: named değişken, collect/reach-N objective, timer, win/lose/restart. `gameRulesRuntime.ts::createGameRulesRuntime` script `game-event` mesajlarını HUD/kurallara bağlar. Motor kontrolleri `normalizeGameRules clamps objectives and dedupes ids`, `GameStateStore wins when all required objectives complete`. Teslimat sözleşmesi, görev zinciri, depo/ekonomi sistemi bulunmadı |
| Hedef işaretçisi | Kısmen çalışıyor | World-space anchor/actor'a bağlı ekran UI altyapısı var; hazır teslimat hedef seçimi/mesafe oku yok. `engine/ui/uiWorldWidget.ts`; `src/ui/WorldUiSubsystem.ts`; motor kontrolleri `normalizeWorldWidget reads an entity anchor + world offset`, `resolveWorldWidgetVisibility fades + scales by distance`. `engine/scene/targetPoint.ts` AI hedef noktasıdır, otomatik oyuncu görev işaretçisi değildir |
| Yük alma / bağlama / bırakma / teslimat | Yok | Genel overlap/interact, mesaj, spawn/destroy, actor component ve script state kullanılabilir; cargo kimliği, slot, bağ, teslim koşulu, ödül/başarısızlık akışı yok. `src/game/behaviors.ts`; `engine/behavior/behaviorSubsystem.ts`; `runtimeActorSpawnCoordinator.ts` |
| Harita / mini harita / waypoint / nav | Kısmen çalışıyor | Generic Spline, Target Point, grid navigation ve vehicle spline AI var. Oyuncu haritası, mini harita, yol ağı üstünde rota hesaplayan GPS yok. `engine/navigation/gridNavigation.ts::buildNavGrid` 20.000 hücreyi aşınca null verir; `vehicleAiModule.ts` spline takip eder. Açık dünya minimap'i `OPEN_WORLD_PLAN.md` Faz 8'de **editör** aracı olarak planlı |
| Save / load | Çalışıyor ve test edildi | Slot/checkpoint/localStorage; level, player, opt-in persistent script state, tüm mevcut araçların position/rotation/linear-angular velocity/handbrake/gear-RPM ve binilmiş araç kimliği. `engine/persistence/{saveGameState,saveGameStore}.ts`; `saveGameModule.ts`; `tests/engine/{saveGameModule,vehicleEntry}.test.ts`; Rapier testi `rapier vehicle motion survives a save: speed, gear and handbrake restore into a fresh world`. Cargo, economy ve terrain izleri bu sözleşmede yok; her oyun değişkeni otomatik saklanmıyor |
| Klavye / fare | Çalışıyor ve test edildi | ActionMap, keyboard, pointer/look; araç mapping ve kamera engine testleri + hedefli vehicle browser smoke. `engine/input/{actionMap,defaultInputBindings,inputSubsystem}.ts`; `src/input/{keyboardInputSource,pointerLookSource}.ts` |
| Gamepad | Kısmen çalışıyor | Gamepad API, stick/deadzone/trigger kodları ve araç analog mapping'i testli; bu incelemede fiziksel gamepad ile kabul testi yok. `src/input/{gamepadInput,gamepadInputSource}.ts`; motor kontrolleri `readGamepadCodes exposes the sticks and triggers as analog axes`; `vehicleRuntime.test.ts` |
| Dokunmatik | Uygulandı fakat doğrulanmadı | Sol sanal hareket, sağ bakış, Jump/Use/Menu düğmeleri var; araç default action sözlüğünü kullanıyor. Bu incelemede gerçek mobil cihaz/araç sürüşü denenmedi. `src/input/{touchInputSource,virtualJoystick}.ts`; saf girdi testleri cihaz kabulü sayılmaz |
| Kamera | Kısmen çalışıyor | Araç chase camera: spring-arm trace, sağ sürükleme orbit, otomatik recenter, hızla FOV; TPS/RTS/default serbest kamera modları. Hazır cockpit/araç içi kamera modu bulunmadı. `vehicleCameraControl.ts`, `vehicleDriver.ts`, `springArmCamera.ts`; `vehicleRuntime.test.ts` — `vehicle chase camera orbits with the mouse, swings back once driving, and pulls in at walls`; `tests/smoke/vehicle.spec.ts` duvar/orbit senaryosu |
| Araç debug HUD | Kısmen çalışıyor | Hız km/h, gear/RPM/shift, süspansiyon wire/contact noktaları, AI route debug mevcut. Tekerlek kuvveti, temas zemininin physical profile tipi ve uygulanan torku birlikte veren kapsamlı Offroad telemetrisi yok. `vehicleDriver.ts::debugSource`; `physicsSubsystem.ts::vehicleState` force/groundEntityId döndürmez. Physics subsystem timing var; tek Rapier fixed-step maliyeti ile aynı metrik sayılmamalı |
| Ses | Çalışıyor ve test edildi | Sound cue/spatial voice, bus, engine RPM→pitch/load→volume, bin/in yaşam döngüsü. `engine/audio/*`; `vehicleEngineSound.ts`; `vehicleModule.ts`; `tests/engine/{audioModule,vehicleRuntime}.test.ts`; bu incelemede hoparlörden öznel ses kalitesi kabulü yok |
| VFX ve UI | Çalışıyor ve test edildi | Particle/mesh particle altyapısı, capability, JSON widget/theme/localization/ViewModel, HUD/menu ve world UI altyapısı. `engine/vfx/*`, `engine/ui/*`, `src/scene/capabilities/{vfxModule,runtimeUiModule}.ts`; `tests/engine/{vfxModule,uiFramework,runtimeUiModule}.test.ts`. Hazır çamur sıçratma, lojistik ekranı veya vinç UI'sı değildir |

## 5. Performans ve platform sınırları

### 5.1 Mevcut uygulama / Offroad sahnesi

| Ölçüm | Sahne / koşullar | Donanım / tarayıcı | Sonuç |
|---|---|---|---|
| FPS ortalama / düşüş | Gerçek Offroad rota ve yük konfigürasyonu yok | Bu oturumda performans cihaz profili alınmadı | **Ölçülmedi** |
| Physics step süresi | Ana uygulama, yüklü araç ve offroad collision seti | — | **Ölçülmedi**; 1/60 s timestep işlem maliyeti değildir |
| Terrain deformasyon güncelleme süresi | Sürüş kaynaklı deformasyon uygulanmamış | — | **Ölçülmedi**; sistem yokken 0 ms performans sonucu yazılamaz |
| Draw call / triangle sayısı | Temsili tamamlanmış Offroad sahnesi | — | **Ölçülmedi**; grid üçgen hesabı render ölçümü yerine geçmez |
| RAM / VRAM tahmini | Temsili oyun sahnesi + 10–15 dk sürüş | — | **Ölçülmedi**; geometry/texture adetleri VRAM baytı değildir |
| Büyük haritada sahne yükleme süresi | Uygulamada multi-tile dünya bağlı değil | — | **Ölçülmedi** |

`renderer.info` sayaçları ve post-process pass'leri nedeniyle draw-call verisinin hangi pass'leri kapsadığı belirtilmeli. `OPEN_WORLD_PLAN.md` S1 notu r184'te shadow sayımının reset sırasıyla eksik kalabildiğini kaydeder; `tests/smoke/landscape-spline-chain.spec.ts` de final fullscreen pass sayaçlarının sahne mesh adedi yerine kullanılmamasını açıklar. Kaynak: `engine/render-three/renderer.ts::readRenderStats`; `runtimeDebugSnapshot.ts::buildPerfMemorySnapshot`.

İşlevsel headless smoke ekran görüntülerinde debug overlay'in tek anlık okuması editörde **10 FPS**, spline runtime görüntüsünde **11 FPS** gösterdi. Bu gözlem saklanmıştır; cihaz/GPU profili, sabit kalite ve zaman serisi alınmadığı için temsili Offroad ortalama/düşük FPS ölçümü olarak tabloya taşınmadı. Kısa işlevsel testlerin geçmesi performans kabulü anlamına gelmez.

### 5.2 Önceden belgelenmiş prototip ölçümleri — güncel oyun benchmark'ı değildir

Kaynak [OPEN_WORLD_PLAN.md](../planned/OPEN_WORLD_PLAN.md), K2/S1, K3/S4 ve Faz 0 S3/S6; tarih **22 Ekim 2026**. Kod sayfaları `spikes/terrain-cdlod`, `spikes/terrain-physics`, `spikes/terrain-worker`. Bu incelemede yeniden çalıştırılmadı; ham ölçüm dökümünün yerine planın kaydettiği sonuçlar kullanıldı.

| Deney | Belgedeki koşul | Belgede kaydedilmiş sonuç | Geçerli sınır |
|---|---|---|---|
| GPU CDLOD render | RTX 3060/D3D11, kullanıcının Chrome 155'i, 1920×1080, DPR 1; 4×4 km sentetik dünya, 80 slot, 32 quad patch; düşük uçuş/yüksek yörünge/yer koşusu | Arazi GPU ort. **0.68–0.90 ms**, p95 en fazla **1.08 ms**; node seçimi CPU **0.14–0.19 ms**; renk+gölge **2 draw**; en çok **0.84 M üçgen** | Sentetik spike; tam oyun FPS'i, yük/AI/nav ve terrain deformasyon maliyeti değil |
| GPU bellek hesabı | Aynı CDLOD ayarı | Arazi yaklaşık **35 MB**, shadow map **16 MB** | Prototip kaynak boyutlarından tahmin; toplam uygulama/driver VRAM ölçümü değil |
| Texture upload | Headless Chromium/RTX 3060; 8 katmanlı yaklaşık 0.6 MB tile | Tile başına ort. **0.34 ms**, p95 ≤ **0.6 ms**, en kötü **1.1 ms** | Ana thread upload deneyi; runtime streaming henüz bağlı değil |
| Collider kurma/silme | 257² tile, Rapier heightfield, masaüstü/headless Chromium; CPU modeli belgede açık değil | Shape **0.25 ms** + body/collider **0.22 ms**; silme **0.01 ms**; karşılaştırma trimesh **74 ms** | Kurulum maliyeti; fizik frame/step veya iz güncellemesi değil |
| Worker decode | Headless Chromium, belgede 12 çekirdek; CPU modeli belirtilmemiş; 64×yaklaşık 0.63 MB tile, 8 katman | Ana thread **0.39–0.43 ms/tile**; 4 worker throughput **0.73 ms/tile**, 64 tile **46 ms** | İzole decode deneyi; fetch/activation/render toplam load süresi değil |

Laptop/mobil ölçümü ilgili planda açık. Bu sonuçlardan “Forge Offroad 4 km dünyada 60 FPS hazır” sonucu çıkarılamaz.

### 5.3 Hedef platformlar

- **Mevcut paketleme hedefi:** web tarayıcısı, WebGL2, Vite web build/static host; `package.json`, `src/main.ts`, `engine/render-three/renderer.ts`, `builder/web/*` ile doğrulanıyor.
- **Mobil web:** touch/responsive/kalite araçları mevcut; Offroad için desteklenen cihaz listesi, bellek bütçesi veya performans kabulü bulunmadı. **Hedef kabulü belirsiz.**
- **Paketlenmiş masaüstü:** mevcut bağımlılık/build scripts içinde Electron/Tauri paketi yok. **Bu repo için uygulanmış hedef yok.**
- **Forge Offroad'un ürün hedefi/minimum donanımı:** şablonda tanımlanmamış. Açık dünya planındaki masaüstü 60 Hz bir geliştirme hedefidir; ürün kabul ölçümü değildir.

## 6. Gerçek test senaryoları — mevcut kanıt ve eksikler

Tüm yeni sonuçlar bu raporun commit'i ve kurulu Rapier 0.19.3 içindir. Aşağıdaki T01–T05'in hiçbiri eksiksiz ürün kabul testi olarak geçilmiş sayılmadı.

| Test | Sürüm / sahne / araç / ayarlar | Beklenen | Gerçekleşen / durum | Bilinen hata veya sınır / yorum |
|---|---|---|---|---|
| **T01 — Boş/yüklü araç** | `84ff7cf`; aynı rota ve araçla iki cargo mass konfigürasyonu yok | Yükle ivmelenme, fren, sag, COM/devrilme davranışının ölçülebilir değişmesi | **Çalıştırılmadı; cargo sistemi yok** | Sabit `massKg` değiştirip A/B yapmak mümkün bir sonraki deneydir; şu anki teslimat/yük kabulü değildir |
| **T02 — Çamur geçişi** | Çamur lastik profili/deformation capability ve kabul sahnesi yok | Yüzeye bağlı hız/tutuş/direnç/batma ve iz düzeyinin ayrıştırılması | **Çalıştırılmadı; planlandı** | Dirt/mud görseli zemini fiziksel çamur yapmaz. Varsa görsel su da sink modeli sayılmaz |
| **T03 — Taşlık eğim** | Headless `createVehicleTestWorld({ slopeDeg: 8 })`, reference definition; 60 Hz physics; 1 s yerleşme + 3 s el freni + 2 s bırakma | T03 için çıkış limiti, taş temasları, devrilme ve sürüş hissi | **Kısmi ilgili kanıt:** `rapier vehicle handbrake holds on a slope and releasing it rolls downhill` geçti; park kayması <0.15 m ve bırakınca yokuş aşağı >1 m | Bu test taşlı dağ rotası veya azami tırmanma testi değil; araç sürüş hissi/taş/dönüş/yük kalibrasyonu açık. Kaynak `tools/engine-tests.ts` |
| **T04 — Deformasyon kalıcılığı** | Runtime iz alanı ve save alanı yok | İkinci geçişte iz/tepki, save/reload sonrası aynı davranış | **Çalıştırılmadı; planlandı** | Sculpt/paint/migration reload testleri mevcut fakat authoring verisini test eder; araç izi kalıcılığına kanıt değildir |
| **T05 — Uzun süre stabilite** | 10–15 dakika gerçek sürüş/heap/GPU/frame kaydı yok | FPS dağılımı ve bellek plato davranışı, hitch/leak gözlemi | **Çalıştırılmadı; ölçülmedi** | Kısa smoke, 1.291 headless kontrol ve ayrı 33 s CDLOD benchmark'ı bu testi karşılamaz |

### 6.1 Bu incelemede ölçülen diğer araç kanıtları

`tools/engine-tests.ts` / `rapier vehicle drivetrain reference car reaches 100 km/h consistently across frame rates`:

```text
[vehicle] 0–100 km/h at 30/60/144 Hz: 7.033 / 7.017 / 7.021 s
[vehicle-ai] circle r=30: 1.88 laps, worst lane error 0.29 m, top 9.0 m/s
[vehicle-ai] straight 80 m: stopped at z=79.19, top 12.0 m/s
[engine-tests] 1291 checks passed
```

0–100 testinde authored `ReferenceCar.vehicle.json` ve actor collider'ı, 2.000 m test zemini, tam gaz ve 1/60 s sabit physics kullanılır; 30/60/144 Hz **dış update frekansıdır**, gerçek monitör benchmark'ı değildir. Test 1→2 vites geçişini, RPM limitlerini, 100 km/h sonunda dört tekerlek temasını ve frekanslar arası <0.05 s sapmayı doğrular. Circle/straight testleri fiziksel gaz/direksiyonla spline AI sürüşünü doğrular; taşlı dağ navigasyonu değildir.

### 6.2 Tarayıcı doğrulama kaydı

Seçilen mevcut dosyalar: `vehicle.spec.ts`, `landscape-sculpt.spec.ts`, `landscape-paint.spec.ts`, `landscape-spline-chain.spec.ts`, `terrain-migration.spec.ts`, `terrain-isolation.spec.ts`; Playwright 1.61.1, config `playwright.config.ts`, Desktop Chrome profili, Chromium, tek worker. `FORGE_SMOKE_PORT=5284`; fixture izolasyonu `tests/smoke/smokeProject.mjs` ve `tests/smoke/test.ts`.

**Sonuç: 17/17 geçti; 8.8 dakika; çıkış 0.**

| Test dosyası | Geçen senaryo | Kanıtlanan akış |
|---|---:|---|
| `tests/smoke/landscape-paint.spec.ts` | 1 | Layer paint → save → reload |
| `tests/smoke/landscape-sculpt.spec.ts` | 1 | Add/sculpt; kayıt sürerken değişiklik/undo; retry/reload |
| `tests/smoke/landscape-spline-chain.spec.ts` | 1 | Üç asfalt segmentinin editor/Play yüklenmesi, browser error kontrolü |
| `tests/smoke/terrain-isolation.spec.ts` | 1 | İkinci level edit'inin ilk level tanım/tile baytlarını değiştirmemesi |
| `tests/smoke/terrain-migration.spec.ts` | 2 | Binary/definition endpoint doğrulaması; legacy→yeni format, road/water referansları, save/reload/Play |
| `tests/smoke/vehicle.spec.ts` | 11 | Sürüş, bin/in, hareketli save/load, kamera duvar/orbit, motor sesi, AI turu, asset save/override, RPM/vites/geri/reset, textured model/wheel animasyonu, Add Actor→save→Play→sürüş |

Tekrarlama komutu (PowerShell, uygun boş portla):

```powershell
$env:FORGE_SMOKE_PORT = '5284'
npx.cmd playwright test vehicle.spec.ts landscape-sculpt.spec.ts landscape-paint.spec.ts landscape-spline-chain.spec.ts terrain-migration.spec.ts terrain-isolation.spec.ts --reporter=list
```

Validator testlerindeki `terrain.unsupported` ve `vehicle.extra` dropped-field mesajları bilerek eklenen bilinmeyen alanların reddedilme kanıtıdır; başarısız save senaryosu olarak yorumlanmadı. Testler sahne seçimini ve bazı ayarları HTTP fixture üzerinden değiştirebilir; bu nedenle varsayılan Terrain level'ında uzun süre kamyon sürüşü kabulü değildir.

Görüntülenerek kontrol edilen kanıtların kalıcı kopyaları:

- [Migrasyon sonrası editör / asfalt yol / terrain araçları](forge-offroad-2026-10-23/terrain-migrated-editor.png).
- [VehicleTest authored ayarlarıyla araç](forge-offroad-2026-10-23/vehicle-authored-lighting.png).
- [Testin ayrı aydınlatma incelemesinde araç ve dokular](forge-offroad-2026-10-23/vehicle-inspection-lighting.png).

**Görsel bulgu:** authored VehicleTest görüntüsünde araç ve zemin çok karanlık; ayrı inceleme görünümünde turuncu textured gövde ve tekerlekler görünür. Test bu görünümde sky/fog/cloud ayarlarını kaldırıp ambient/background ve kamerayı değiştirir; kaynak level kaydetmez. Böylece model/doku bağlanmasının çalıştığı gözlenir, ancak asıl sahnenin ışık/atmosfer sorununun tekil nedeni belirlenmiş olmaz. Düzeltme yapılmadı. Functional smoke başarısı, authored sahnenin görsel kabulü değildir.

## 7. Eksikler, riskler ve tasarım etkisi

Öncelik: **P0** çekirdek oynanışı engeller; **P1** ilk oynanabilir sürüm için önemli; **P2** sonraya bırakılabilir. Aşağıdaki öneriler yeni çalışmadır; mevcut sistem olarak sunulmamıştır.

| Risk / eksik | Kanıt | Oyun tasarımına etkisi | Önerilen öncelik |
|---|---|---|---|
| 1. Teslimat/cargo/depo/ödül döngüsü yok | `gameRules.ts` yalnız genel objective/variable çekirdeği; cargo akışı bulunmadı | Lojistik oyununun başarı/başarısızlık döngüsü henüz oynanamaz; ilk dikey dilim için iki noktalı teslimat gerekli | **P0** |
| 2. Yükün toplam kütle/COM/inertia'ya bağlanması yok | `attachVehicleController` yalnız authored araç tanımını okuyor; T01 yok | “Daha ağır yük daha zor taşıma” tasarımının fizik temeli kanıtlanmamış | **P0** |
| 3. Çamur/kar yüzey tepkisi ve runtime iz/batma yok | `PhysicalMaterialDef` yalnız friction/restitution; deformation modülü yok, plan başlanmamış | Yumuşak zeminde mücadele çekirdek vaat olacaksa önce prototip gerekir; mevcut dirt görseline bu rol verilemez | **P0**, bu deneyim çekirdek kapsamdaysa |
| 4. Multi-tile render/physics/streaming yok | `terrainDocumentToLandscape` 1×1 dışını reddeder; eager loader; statik trimesh | İzole yerleşimler arası kilometrelik yol ağı mevcut runtime ile onaylanamaz; küçük saha dilimi veya açık dünya fazlarının tamamlanması gerekir | **P1** |
| 5. Römork/vinç/kurtarma yok | Vehicle/game katmanlarında hitch/winch yok; ragdoll joint'leri başka amaçlı | Römork teslimatı ve saplanmadan çıkma tasarımı için ek platform/oyun entegrasyonu gerekiyor | **P1**, ilk kapsamda seçilirse |
| 6. Offroad handling ve aktarma kabulü eksik | Differential lock/low range/anti-roll yok; 8° park ve düz zemin testleri var | AWD desteği SnowRunner düzeyinde dört çeker kabulü değildir; tırmanma/devrilme/boş-yüklü ayarları ölçülmeli | **P1** |
| 7. Zemin örnekleme ve collision geçişi riski | Eski `landscapeHeightAtLocal` bilinear; yeni `terrainHeightAt` üçgen-birebir fakat uygulama henüz eski adaptörde. `OPEN_WORLD_PLAN.md` S4 iç kenar snag bulgusu | Yalnız yüzey sorgusu testinin geçmesi tüm araç/zemin temasını doğrulamaz; rough relief ve dikiş smoke'u gerekli | **P1** |
| 8. Lojistik durumunun kalıcı kayıt sözleşmesi yok | `GameSaveState` oyuncu/araç/opt-in script flags; cargo/task economy ve izler yok | Teslim edilen yük, aktif görev ve ekonomi yüklemede tutarsızlaşabilir; fork'a ait açık save sürümü/restore testleri gerekli | **P1** |
| 9. Temsili oyun performansı ve stabilite bilinmiyor | Bölüm 5 uygulama ölçümleri boş; T05 yapılmadı, spike sonuçları ayrı | Dünya boyutu, yoğunluk, minimum cihaz ve kalite bütçesi henüz güvenle seçilemez | **P1** |
| 10. Araç sahnesinde görsel okunurluk sorunu | Bölüm 6.2'deki authored VehicleTest ve ayrı aydınlatma ekranları; authored görünümde araç/zemin çok karanlık | Fizik/model smoke'u geçse de sürüş için okunur sahne ışığı ve atmosfer kabulü ayrıca gerekli; tekil neden belirsiz | **P1** |

## 8. Karar için kısa yönetici özeti

**Bugün güvenle tasarlayabileceğimiz mekanikler:** küçük tek terrain sahasında sürüş; raycast süspansiyon; authored kütle/COM; otomatik vites ve FWD/RWD/AWD dağılımı; chase kamera, araca bin/in; spline takip eden basit AI; genel trigger/interact/objective/HUD; araç pozu/hızı/vitesiyle save/load; editörde sculpt/paint/yol ve görsel nehir. Güven, raporda belirtilen test kapsamıyla sınırlı; henüz uçtan uca bir Offroad lojistik oyunu yok.

**Prototiple doğrulamamız gereken mekanikler:** önce boş/yüklü araç fiziği ve basit teslimat döngüsü; sonra gerçek eğimde çekiş/devrilme; yumuşak zeminde tutuş/direnç ve sink hissi. Multi-tile terrain renderer/physics/streaming entegrasyonu ayrı kapıdır. Deformasyon planındaki süspansiyonla batma yaklaşımı uygulama ve kabul gerektirir.

**Şimdilik kapsam dışı tutulması gerekenler:** gerçek zamanlı collider ezilmesiyle çamur simülasyonu; hazır kabul edilmiş kilometrelik dünya; kanıtlanmamış fiziksel cargo/römork/vinç ve yakıt/hasar; fiziksel cihaz kabulü yapılmadan mobil performans vaadi. Bu, kalıcı tasarım yasağı değil; mevcut envanterle doğrulanmış kapsamın sınırıdır.

**Bir sonraki en değerli üç teknik test — öneri, henüz çalıştırılmadı:**

1. **T01 + teslimat dikey dilimi:** aynı araç ve rotada örneğin 0/500/1.000 kg ek yük; önce toplam kütle/COM/inertia bağlantısını kurup doğrula. Aynı gaz/fren girdisinde ivmelenme, durma mesafesi, süspansiyon sag ve devrilme açısını kaydet. Pickup→bağlı yük→hedef trigger→teslim→save/load döngüsünde yük kimliği ve ödülün bir kez işlenmesini kontrol et. Kütleleri mevcut destek varmış gibi yalnız etiket değiştirmekle uygulama.
2. **T02/T03/T04 temas ve yüzey prototipi:** kontrollü kuru/çamur profili, düz alan/8°/15°/25° eğim ve taş engeller. Önce gerçek mevcut kuru zemin tabanını ölç; yüzey profili ve sink prototipi eklendikten sonra aynı girdilerle hız, temas kaybı, direnç ve batmayı karşılaştır. Görsel iz, render geometri değişimi, collision değişimi ve save kalıcılığını ayrı gözlemler olarak kaydet. Uygulanmayan aşamaya “geçti” yazma.
3. **T05 + temsilî dünya ölçeği:** önce mevcut tek-tile uygulamada, sonra multi-tile entegrasyonu tamamlanınca aynı rota boyunca 15 dk sürüş; sabit cihaz/tarayıcı/çözünürlük/kalite ile FPS/frame p50–p95–p99, physics subsystem/tek step ayrımı, load/activation hitch, draw/tri kapsamı, heap ve GPU kaynak adetlerinin zaman serisini al. Araç/yük/AI/foliage sayısını raporla; spike sonuçlarıyla tam oyun sonucunu karıştırma.

