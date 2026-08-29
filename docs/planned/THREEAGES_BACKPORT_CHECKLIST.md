# ThreeAges → Forge Geri Taşıma (Backport) Kontrol Listesi

> Tarih: 2026-08-28
> Durum: **TAMAMLANDI.** Katman 0, 1, 2 ve 3 bitti.
> Kaynak depo: `C:\Users\emret\Desktop\Games\ThreeAges` (Forge fork'u, `origin`
> ThreeAges / `upstream` Forge).
> Ortak ata: `11bb20e9` (2026-07-15). O noktadan beri ThreeAges 414, Forge 25
> commit ilerledi ve fork hiç upstream sync almadı.

---

## 0. Neden bu liste var

ThreeAges geliştirilirken editörde bulunan eksikler fork içinde kapatıldı ve
hiçbiri şablona dönmedi. Bu liste, o gelişmelerden **jenerik olanları** Forge'a
taşımanın sırasını ve her dilimin bitiş şartını tutar.

Taşıma kararının tek ölçütü şu: **özellik bir oyun kuralı içeriyor mu?**
İçermiyorsa Forge'a gider. İçeriyorsa fork'ta kalır — CLAUDE.md'nin "editör
çekirdeği jenerik kalır" kuralı bu listenin üzerindedir.

## 1. Yöntem

Cherry-pick **kullanılmıyor.** Ölçüldü: River Water 10, Data Table Editor 14
commit'e yayılmış ve çoğu aynı commit'te `src/game/rts` dosyalarına da
dokunuyor. Cherry-pick oyun kodunu sürükler ve `SceneApp.ts` / `EditorUi.ts`
üzerinde çakışır.

Bunun yerine: **özellik başına bir branch, ThreeAges ağacı referans olarak
okunup Forge'a elle port.** Her dilim tek başına `npm run build:verify` yeşil
bitip commit'lenir.

Zemin uygun: Forge'un 25 commit'i editör tarafını neredeyse hiç değiştirmedi
(`SceneApp.ts` +88/−50). Büyük refactor `RuntimeSceneApp.ts`'te oldu. Tek
gerçek çakışma alanı Katman 3'teki `authoredWorld` / `authoredEnvironment`.

### Her dilimin sabit kontrol listesi

1. Yeni `Layout*` alanı varsa `tools/saveValidator.ts` allowlist'i güncellendi mi?
   (CLAUDE.md'nin en çok uyardığı tuzak; allowlist'e girmeyen alan sessizce düşer.)
2. `npm run test:engine` — Forge'un dropped-fields ağı (`tools/droppedFields.ts`,
   `serializationDrift.test.ts`) yeni alanı görüyor mu? ThreeAges'in alanlarının
   hiçbiri bu ağı görmedi; port sırasında bu testler bizim lehimize çalışır.
3. `npm run verify:imports` — editör `@/game` import etmiyor. Data Table
   diliminde kritik.
4. `npm run build:verify` yeşil.
5. Tarayıcı doğrulaması gerekiyorsa smoke **port 5273** (`npm run dev:smoke`),
   asla 5173.
6. Dev sunucusu layout dosyalarını kirletir — commit öncesi `git status`.

### Bitiş şartı

Forge'a taşınan her dilim ThreeAges'ten **silinir** ve fork upstream'den sync
alır. Yoksa aynı kod iki yerde yaşar ve bir sonraki sync bugünkünden acı olur.

---

## Katman 0 — Küçük, bağımsız maddeler

Tek branch: `feat/threeages-backport-layer0`.

- [x] **0.1 Editör kamera pozu kalıcılığı.** Viewport pozu level başına
  `localStorage`'da tutulur, reload'da geri yüklenir. Layout dosyasına
  yazılmaz — reload level'ı kirletmemeli. `editorEnabled` arkasında kalır.
  → `editor/input/editorCameraPose.ts` (yeni), `src/scene/SceneApp.ts`
- [x] **0.2 Foliage uniform scale.** Scale Min/Max tek alana iner. Dosya şekli
  `Vec3` kalır (geriye uyum), normalizer X bileşenini üç eksene yayar.
  `rollFoliageInstance` eksen başına PRNG çekişini korur, böylece mevcut
  deterministik fırçaların yaw/offset/seed rulosu bozulmaz.
  → `engine/scene/foliage.ts`, `engine/scene/foliagePaint.ts`,
  `src/editor/panels/foliage/foliagePanel.ts`
- [x] **0.3 Foliage Paint aracında Shift+drag ile silme.** Ayrı Erase aracına
  geçmeden fırçanın altındaki her tipi siler.
  → `foliagePanel.ts`, `src/scene/SceneApp.ts`
- [x] **0.4 Content Browser kart tooltip'i.** ~118 px kartta kırpılan tam ad ve
  amber "sorun" noktasının sebebi, 9 px'lik noktayı vurmadan okunur.
  → `src/editor/panels/content/contentPanel.ts`
- [x] **0.5 Content Browser'da layout yan dosyalarını gizleme.**
  `.landscape.json`, `.foliage.json`, `.meshpaint.json` listeden düşer;
  `.foliagetype.json` gerçek manifest asset'i olduğu için kalır.
  → `src/editor/EditorUi.ts`
- [x] **0.6 `/__save-actor` manifest'e otomatik kayıt.** Content Browser "New"
  akışı dışında kaydedilen Actor sınıfı başıboş dosya olarak kalmaz; amber
  uyarı noktası kalkar ve asset picker'larda görünür. `registerImportedAsset`
  bilinen yolda no-op olduğu için idempotent.
  → `vite.config.ts`
- [x] **0.7 Landscape "High (257 × 257)" resample preset'i.** Motorda
  `LANDSCAPE_SIZE_PRESETS.large` zaten var; eksik olan yalnız editör UI'ı ve
  `resampleSelectedLandscape` imzası (`"small" | "medium"` → `+ "large"`).
  → `src/editor/panels/details/specialActorDetails.ts`, `src/scene/SceneApp.ts`

### Katman 0'dan çıkarılanlar

- **Actor Script "Spin this pivot as a wheel".** Runtime tarafı tamamen
  `src/game/rts/content/*` içinde. Sadece UI taşınırsa Forge'da arkasında
  davranışı olmayan bir kontrol kalır. Fork'ta kalır.

---

## Katman 1 — Başkalarının bağımlılığı

- [x] **1.1 Materyal `flipY`.** Motor üretimi UV'ler (landscape katmanları, UVW
  projeksiyon, primitifler) çevrilmiş varsayılanı ister, glTF UV'leri istemez.
  Materyal bazlı bayrak + Material Editor'de tooltip'li onay kutusu.
  → `engine/assets/material.ts`, `engine/render-three/textureConfig.ts`,
  `engine/render-three/materials.ts`, `src/editor/MaterialEditor.ts`,
  `tools/saveValidator.ts`
- [x] **1.2 Materyal normal motion.** `ForgeMaterialNormalMotion` — aynı normal
  haritasını iki bağımsız UV hareketiyle örnekleme. **River Water bunu
  kullanıyor**, o yüzden Katman 2'den önce gelir.
  → aynı dosyalar + `advanceForgeMaterialAnimations` kare kancası
- [x] **1.3 Landscape spline performansı.** `SplineCorridorIndex` (uniform grid),
  `clip`'li apply, `landscapeGridBoundsForLocalBox`. Apply pass ağ boyutunda
  kareselleşiyordu.
  → `engine/scene/landscape.ts`, `engine/scene/landscapeSplineAdapter.ts`
- [x] **1.4 `LandscapeRectPaint` + `blendLandscapeLayerWeight`.** Çizgi yerine
  alan boyama (bina ayak izi, açıklık), yumuşak köşeli pad.
- [x] **1.5 Landscape spline `smoothness`.** Köşe tanjantı; 0 = düz parçaları
  izleyen spline. Yokluğu tarihsel 0.5'i korur.

---

## Katman 2 — Büyük dikey dilimler

Her biri kendi branch'i.

- [x] **2.1 River Water.** `LayoutRiverWater` + `LayoutRiverWaterFoamStamp` +
  `LayoutRiverWaterSegmentProfile` + `RoomLayout.riverWaters[]`; Details'te
  Surface / Flow & Waves / Foam / Reflection blokları; viewport'ta gizmo ile
  taşınan Radial Foam noktaları; paylaşılan planar yansıma; Landscape
  taşınınca su şeridinin bağlı kalması. Bağımlılık: 1.2, 1.3, 1.5.
  → `engine/scene/riverWater.ts`, `engine/render-three/riverWater.ts`,
  `engine/render-three/planarReflectionSource.ts`, `engine/scene/layout.ts`,
  `panels/details/specialActorDetails.ts`, `src/scene/SceneApp.ts`,
  `tools/saveValidator.ts` (`validateRiverWater`),
  `tests/smoke/river-water-details.spec.ts` (hazır, taşınabilir)
- [x] **2.2 Mesh Particle Renderer (effect şeması 3).** `ParticleMeshRendererBlock`,
  InstancedMesh, editörde model slot listesi (maks. 8), `burst` emisyonu,
  `maxParticles`, opacity ramp, vfxSubsystem canlı efekt bütçesi, Content
  Browser kartında renderer özeti.
- [x] **2.3 Data Table Editor.** Editör + `/__save-gamedata` +
  `/__gamedata-defaults` (git HEAD'den tek kaydı geri alma) +
  `gameEditorRegistry` genişlemesi. Doğrulayıcı **yapısal** kalır: yol
  `game-data/**.json` ile çitlenir, denge kuralı oyun validatöründen enjekte
  edilir. `verify:imports` bu dilimde kritik.
  → `tests/smoke/data-table-editor.spec.ts` (hazır, taşınabilir)
- [x] **2.4 Actor Script `variableOverrides`.** Level bazlı değişken ezme +
  `resolveActorInstanceVariables` tip kontrolü + Details bölümü.
- [x] **2.5 Skeletal Mesh Editor paketi.** `driveMotion` root motion modu, Up
  Axis seçici, Measured Travel / Travel Speed okuması, materyal slot
  override'ı, ölçek telafili socket mount, montage bölümleri (`playRange`),
  `bodyMask` glTF isim sanitizasyonu.
  → `tests/smoke/skeletal-mesh-editor.spec.ts` (hazır, taşınabilir)
  **Taşınmayan:** ThreeAges'in `ANIMATION_SET_ROLES` genişlemesi (work*/carry*/
  attack* rolleri) ve `layerAttackWhenMoving` — ikisi de RTS sunum sözlüğü,
  fork'ta kalır.
- [x] **2.6 Blocking Volume `navigationRole` + nav string-pulling.** Yatay kutuyu
  yürünebilir güverteye çeviren alan (köprü altı) + `gridNavigation.flatFloor`
  ile düz zeminde yol düzleştirme. `NavigationRole` tipi Forge'da zaten var,
  eksik olan blocking volume alanı. `saveValidator` allowlist'i gerektirir.

---

## Katman 3 — Sona bırakılanlar

- [x] **3.1 `authoredEnvironment` / `authoredWorld` uzlaştırması.** Port değil,
  karar: iki tasarım rakip değil tamamlayıcı çıktı. `LevelRuntime` **sırayı**,
  yeni `engine/render-three/authoredEnvironment.ts` o gruplardan birinin
  **uygulamasını** sahiplenir; iki kabuk da ona delege eder. `authoredWorld.ts`
  taşınmadı (gerekçe: I4 — fork üçüncü bir kabuk yazmaz).
  → `docs/runtime-parity/AUDIT.md` §8
- [x] **3.2 Veri güdümlü ses olayı tablosu + music director.**
  → `engine/audio/audioEventTable.ts`, `engine/audio/musicDirector.ts`
- [x] **3.3 Ses bus'ları genişlemesi.** `voice` + `notifications` ayrı bus,
  `BusDuckMix` + `mergeDucks`, media-element streaming (`stream: true`),
  `canPlayAudioFormat`, `setAudioBusVolumes` toplu yazma.
- [x] **3.4 GPU zamanlayıcı** (`EXT_disjoint_timer_query_webgl2`).
  → `engine/perf/gpuTimer.ts` + `?debug` overlay'de `gpu` satırı
- [x] **3.5 GTAO derinlik tuzağı düzeltmesi** (`writesSceneDepth`).
- [x] **3.6 `worldMaskPatch`** — dünya-uzayı maskesiyle fragment bazlı gizleme.
- [x] **3.7 `layeredClipAnimator`** — iki kanallı klip animatörü.
- [x] **3.8 Perf/araç zinciri:** `perf:browser` + `tools/perf/browserPerfHarness.mjs`,
  `optimize:glb` (`optimize-mesh-glb.mjs`), `strip-embedded-textures`,
  `audio:codecs`, `audio:loudness`, `audio:manifest`.
  **Taşınmadı:** `worker-perf-report.mjs` (birim-sayısı matrisi, oyuna özgü;
  jenerik yarısı harness olarak geldi).
- [x] **3.9 `tools/engine-tests.ts` bölme planı** + ölçüm aracı (`--filter`,
  `--timing`, `--slow` / `checkSlow`, ayrı bundle/koşum süresi).
  → `docs/planned/ENGINE_TESTS_SPLIT_PLAN.md`

---

## Taşınmayanlar (fork'ta kalır)

- `src/game/rts/**` (~200 dosya) — birimler, savaş, ekonomi, yol ağı, sis, AI
  krallık direktörü, seçim/komut, tutorial, maç akışı.
- Actor Script wheel spin (yukarıda gerekçesi).

### Jenerikleştirme adayları — ayrı karar gerektirir

Bunlar bugün `src/game` altında ama oyuna özgü değil. Backport değil,
**yeniden tasarım** işi; bu listenin dışında ayrı planlanmalı.

- `src/game/localization/**` — loader, formatter, locale registry, pseudo-locale
  debug + 8 dil smoke'u. Forge'da yerelleştirme katmanı hiç yok.
- `src/game/core/**` — `logger`, `featureFlags`, `runtimeConfig`, `errorHandler`.
- `src/game/data/**` — Data Table editörünün oyun tarafı (editör kısmı 2.3'te).

---

## İlerleme Günlüğü

- **2026-08-28** — Liste oluşturuldu. Sapma analizi yapıldı (ortak ata
  `11bb20e9`, ThreeAges +414 / Forge +25 commit). Cherry-pick ölçülüp elendi.
  Yanlış alarmlar ayıklandı: Scene Outliner arama filtresinin `startsWith`'e
  dönüşü Forge'da `2b1f556` ile bağımsız olarak zaten yapılmış; `NavigationRole`
  tipi Forge'da zaten var; Landscape `large` preset'i motorda zaten tanımlı.
  Katman 0 branch'i açıldı.
- **2026-08-28** — **Katman 0 tamamlandı** (`feat/threeages-backport-layer0`).
  Yedi maddenin hepsi portlandı; `npm run build:verify` yeşil (1023 motor
  kontrolü, `verify:dist --strict` temiz — yani kamera pozu deposu oyun
  bundle'ına sızmıyor). Port sırasında ortaya çıkanlar:
  - `normalizeFoliageType`'ın per-eksen ölçeği koruduğunu doğrulayan motor testi
    yeni uniform kurala göre güncellendi; testin adı da kuralı anlatacak şekilde
    değişti.
  - Kullanılmayan `.foliage-scale-inputs` CSS bloğu kaldırıldı.
  - Content Browser klasör kartının tooltip'i ThreeAges'ten farklı: orada yol
    bilgisi düşüyordu, burada `contentCardTooltip(label, [], path)` ile
    korunuyor.
  - Landscape "High" preset'i yalnız UI işiydi: `saveValidator`'ın
    `LANDSCAPE_MAX_VERTICES` sınırı zaten 257.
- **2026-08-28** — **Katman 1 tamamlandı** (aynı branch). Forge bu dilimin beş
  dosyasının hiçbirine fork noktasından beri dokunmamıştı, bu yüzden materyal ve
  landscape değişiklikleri ThreeAges'ten `git apply` ile temiz indi; elle
  yapılan yalnızca allowlist, kare-döngüsü kancaları ve testler oldu.
  `npm run build:verify` yeşil (1030 motor kontrolü). Port sırasında ortaya
  çıkanlar:
  - Save validator'a `flipY`, `normalMotion` (yeni
    `validateForgeMaterialNormalMotion`) ve landscape spline `smoothness`
    eklendi — üçü de allowlist'e girmeseydi sessizce düşecekti.
  - Materyal round-trip testleri iki yeni alanı görünce kırıldı; bu tam olarak
    drift ağının işi. Beklenen nesneler güncellendi, ayrıca `flipY` ve
    `normalMotion` için pozitif kapsama yazıldı (varsayılan opt-out davranışı,
    her doku haritasına yayılma, shader yamasının uniform'u).
  - `ThumbnailMaterialPreview` `flipY` taşımak zorunda kaldı; küçük resim tek
    kare olduğu için `normalMotion` orada bilinçli `null`.
  - `advanceForgeMaterialAnimations` hem `SceneApp` hem `RuntimeSceneApp` kare
    döngüsüne bağlandı — editör ve runtime paritesi.
  - Yeni landscape yüzeyi (rect paint/deform, clip'li apply,
    `landscapeGridBoundsForLocalBox`, `smoothness`) ThreeAges'te yalnız RTS yol
    testlerinden dolaylı kapsanıyordu; jenerik karşılıkları buraya yazıldı —
    clip'li apply'ın tam pass ile birebir aynı değerleri yazdığı dahil.
  - `engine/scene/landscape.ts` içindeki iki yorum fork'un oyununu adıyla
    anıyordu; jenerikleştirildi.
- **2026-08-28** — **Katman 2 tamamlandı** (`feat/threeages-backport-layer2`,
  dilim başına bir commit). `npm run build:verify` yeşil (1046 motor kontrolü).
  Dilimler: 2.6 blocking-volume `navigationRole` + nav string-pulling, 2.4 actor
  `variableOverrides`, 2.5 Skeletal Mesh Editor paketi, 2.2 mesh particle
  renderer, 2.3 Data Table Editor, 2.1 River Water. Port sırasında ortaya
  çıkanlar:
  - `cloneActorInstance` yeni alanı kopyalamıyordu; düzeltilmeseydi panelden
    yapılan her override sessizce düşerdi (panelin düzenlemeyi reddetmesinden
    ayırt edilemez bir hata).
  - String-pulling nav testlerini kırdı: koridor-merkezi testi artık yayılan
    waypoint'lere değil pişmiş penalty tablosuna bakıyor, çünkü zaten temiz olan
    gergin çizgi tercihi çıktıda göstermiyor.
  - Burst emisyonu bilinçli davranış değişikliği (rate ile burst artık ayrık);
    ThreeAges'in gerekçeli testi de birlikte taşındı.
  - `SceneApp` için tam 3-way birleştirme River Water dışında da çok şey çekti
    (landscape PBR katmanları, yinelenen metotlar); yalnız river hunk'ları
    süzülüp uygulandı.
  - **Runtime paritesi:** ThreeAges suyu `authoredWorld` üzerinden çiziyor
    (Katman 3.1). Forge'da doğru yer `LevelRuntime`: yeni bir `river-waters`
    adımı eklendi, hem `SceneApp` hem `RuntimeSceneApp` sağlıyor. Aksi hâlde
    nehir editörde görünüp oyunda görünmezdi.
  - Data Table Editor'ün metinleri Türkçeydi; İngilizceye çevrildi.
  - Taşınmayan: `ANIMATION_SET_ROLES` genişlemesi, `layerAttackWhenMoving`,
    Actor Script wheel spin — üçü de RTS sunum sözlüğü.
- **2026-08-28** — **Katman 3 tamamlandı** (`feat/threeages-backport-layer3`,
  madde başına bir commit). `npm run build:verify` yeşil (1077 motor kontrolü).
  Sıra: 3.4 GPU zamanlayıcı, 3.5 GTAO, 3.7 layered clip animator, 3.6 world
  mask, 3.3 ses bus'ları, 3.2 ses olay tablosu + music director, 3.8 araç
  zinciri, 3.9 test bölme planı, 3.1 authored environment uzlaştırması.
  Port sırasında ortaya çıkanlar:
  - **3.1 bir port değil bir karardı ve ölçülünce üç gerçek sapma buldu.**
    `LevelRuntime` sırayı doğru paylaştırıyordu ama iki kabuk aynı adımda farklı
    şey yapıyordu: runtime, yeni level sky yazmamışsa eski gökyüzü kubbesini
    ayakta bırakıyordu (bulut kubbesi için de aynısı), ve Sky Light Capture
    değişince prob env map'lerini yeniden bağlamıyordu. Üçü de yalnız *diğer*
    kabukta görünen türden. Editörün `dispose()`'u da kubbeleri hiç serbest
    bırakmıyormuş; ortak `teardown()` onu da kapattı.
  - Prob env map yeniden bağlaması **guard'sız taşınamadı**: her instanced
    modeli yeniden kuruyor ve ilk build oraya henüz hiç prob pişmemişken
    geliyor. Editördeki `eligibleProbeBakes().length > 0` koşulu runtime'a da
    kondu.
  - **3.9'da ThreeAges'in rakamları kopyalanmadı, Forge ölçüldü** — ve ölçüm
    sonucu değiştirdi: orada suit 161 sn'ydi ve dokuz check %97,5'ini yiyordu;
    burada suit **0,8 sn** ve en yavaş check 49 ms. Yani Faz 1 (`checkSlow`
    etiketleme) bugün boş bir işlem; araç kondu, plan tetiğini yazdı.
  - `build:verify` ve CI `test:engine:slow`'a bağlandı, böylece varsayılanın
    ileride hızlanması kapıyı sessizce zayıflatamaz.
  - 3.8'de `worker-perf-report.mjs` elendi (oyuna özgü birim-sayısı matrisi);
    jenerik yarısı `tools/perf/browserPerfHarness.mjs` olarak geldi ve
    `browser-perf-report` ondan tekrar kullanıyor. Araçların proje-özgü
    sabitleri (ThreeAges asset yolları, KTX kurulum dizini, ses kategorisi)
    bayrak/env/keşif ile jenerikleştirildi; hiçbiri artık düzenleme
    gerektirmiyor.
  - **Öldürülen bir smoke koşumu layout dosyalarını kirletti** (teardown hiç
    çalışmadı) ve 5273'te bir vite sunucusu bıraktı. CLAUDE.md'nin uyardığı
    tam durum; commit öncesi `git checkout -- public/` ile temizlendi.

---

## Kalan iş

Liste kapandı. Kalan tek adım listenin kendi **bitiş şartı**: Forge'a taşınan
dilimler ThreeAges'ten **silinmeli** ve fork upstream'den sync almalı. Yoksa
aynı kod iki yerde yaşar ve bir sonraki sync bugünkünden acı olur.
