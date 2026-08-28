# ThreeAges → Forge Geri Taşıma (Backport) Kontrol Listesi

> Tarih: 2026-08-28
> Durum: **Uygulanıyor.** Katman 0 ve Katman 1 tamamlandı; sırada Katman 2.
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

- [ ] **2.1 River Water.** `LayoutRiverWater` + `LayoutRiverWaterFoamStamp` +
  `LayoutRiverWaterSegmentProfile` + `RoomLayout.riverWaters[]`; Details'te
  Surface / Flow & Waves / Foam / Reflection blokları; viewport'ta gizmo ile
  taşınan Radial Foam noktaları; paylaşılan planar yansıma; Landscape
  taşınınca su şeridinin bağlı kalması. Bağımlılık: 1.2, 1.3, 1.5.
  → `engine/scene/riverWater.ts`, `engine/render-three/riverWater.ts`,
  `engine/render-three/planarReflectionSource.ts`, `engine/scene/layout.ts`,
  `panels/details/specialActorDetails.ts`, `src/scene/SceneApp.ts`,
  `tools/saveValidator.ts` (`validateRiverWater`),
  `tests/smoke/river-water-details.spec.ts` (hazır, taşınabilir)
- [ ] **2.2 Mesh Particle Renderer (effect şeması 3).** `ParticleMeshRendererBlock`,
  InstancedMesh, editörde model slot listesi (maks. 8), `burst` emisyonu,
  `maxParticles`, opacity ramp, vfxSubsystem canlı efekt bütçesi, Content
  Browser kartında renderer özeti.
- [ ] **2.3 Data Table Editor.** Editör + `/__save-gamedata` +
  `/__gamedata-defaults` (git HEAD'den tek kaydı geri alma) +
  `gameEditorRegistry` genişlemesi. Doğrulayıcı **yapısal** kalır: yol
  `game-data/**.json` ile çitlenir, denge kuralı oyun validatöründen enjekte
  edilir. `verify:imports` bu dilimde kritik.
  → `tests/smoke/data-table-editor.spec.ts` (hazır, taşınabilir)
- [ ] **2.4 Actor Script `variableOverrides`.** Level bazlı değişken ezme +
  `resolveActorInstanceVariables` tip kontrolü + Details bölümü.
- [ ] **2.5 Skeletal Mesh Editor paketi.** `driveMotion` root motion modu, Up
  Axis seçici, Measured Travel / Travel Speed okuması, materyal slot
  override'ı, ölçek telafili socket mount, montage bölümleri (`playRange`),
  `bodyMask` glTF isim sanitizasyonu.
  → `tests/smoke/skeletal-mesh-editor.spec.ts` (hazır, taşınabilir)
- [ ] **2.6 Blocking Volume `navigationRole` + nav string-pulling.** Yatay kutuyu
  yürünebilir güverteye çeviren alan (köprü altı) + `gridNavigation.flatFloor`
  ile düz zeminde yol düzleştirme. `NavigationRole` tipi Forge'da zaten var,
  eksik olan blocking volume alanı. `saveValidator` allowlist'i gerektirir.

---

## Katman 3 — Sona bırakılanlar

- [ ] **3.1 `authoredEnvironment` / `authoredWorld` uzlaştırması.** Forge'un
  `LevelRuntime` / `SceneShell` işiyle **aynı alan**. Burada port değil,
  iki tasarımın uzlaştırılması gerekiyor. Diğer her şeyden sonra.
- [ ] **3.2 Veri güdümlü ses olayı tablosu + music director.** Oyun kodu dosya
  değil olay adlandırır; ses/seviye/cooldown/eşzamanlılık tavanı/mesafe
  culling veri dosyasında.
- [ ] **3.3 Ses bus'ları genişlemesi.** `voice` + `notifications` ayrı bus,
  uzun kliplerde media-element streaming, `setAudioBusVolumes` toplu yazma.
- [ ] **3.4 GPU zamanlayıcı** (`EXT_disjoint_timer_query_webgl2`).
- [ ] **3.5 GTAO derinlik tuzağı düzeltmesi** (`writesSceneDepth`).
- [ ] **3.6 `worldMaskPatch`** — dünya-uzayı maskesiyle fragment bazlı gizleme.
- [ ] **3.7 `layeredClipAnimator`** — iki kanallı klip animatörü.
- [ ] **3.8 Perf/araç zinciri:** `browser-perf-report`, `worker-perf-report`,
  `optimize-building-glb`, `strip-embedded-textures`, `probe-audio-codecs`,
  `audit-audio-loudness`, `sync-audio-manifest`.
- [ ] **3.9 `tools/engine-tests.ts` bölme planı.** ThreeAges'te dosya +58 000
  satır büyüdü ve bölme planı yazıldı; Forge'a taşınırken o plan da gelmeli.

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
