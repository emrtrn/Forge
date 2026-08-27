# Forge Katmanlı Runtime Planı
## LevelRuntime · Capability Modülleri · Game Modülü

> Tarih: 2026-08-09
> Durum: **Uygulanıyor.** Faz A–D tamamlandı (browser kabulleri dahil).
> **Faz E tamamlandı** (E/1 bağlanma mekanizması + moving-platform +
> spline-follower, E/2 dialogue, E/3 save-game, E/4 runtime-UI, E/5 skeletal,
> E/6 character-movement, E/7 AI, E/8 audio, E/9 vfx).
> **Faz F tamamlandı** (F/1 ForgeGameModule + createForgeRuntime, F/2 Katman 3
> katalogları oyun modülüne, F/3 oyun kuralları oyun modülüne, F/4 AI karakter
> animasyonu capability'si + iskelet iliştirmesi modüle).
> **Faz G tamamlandı** (sessiz-kayıp dedektörü + kaydetme raporu, desteklenmeyen
> capability uyarısı, serialization drift testleri).
> **Faz H tamamlandı** (RuntimeParity level + A/B/C testleri + browser smoke +
> `templates/game-starter`; Definition of Done tarayıcıda kanıtlandı).
> Sıradaki faz I (isteğe bağlı RTS doğrulama vakası).
> Dayanak: [`docs/runtime-parity/AUDIT.md`](../runtime-parity/AUDIT.md) (Faz 0 denetimi).
> Bu doküman eski [`FORGE_RUNTIME_EDITOR_PARITY_PLAN.md`](FORGE_RUNTIME_EDITOR_PARITY_PLAN.md)'in
> yerine geçer; onun yerini denetim bulgularıyla güncellenmiş somut bir uygulama
> planı alır. Eski doküman referans/tarihçe olarak kalabilir.

---

## 0. Neden bu plan var

Sınır Krallıkları (RTS) geliştirilirken Forge Editör'ü verimli kullanamadık.
Kök neden (denetimle doğrulandı):

- **`RtsApp` yazmak yanlıştı.** Ayrı bir uygulama kabuğu yazınca
  `RuntimeSceneApp.buildScene`'deki tüm sahne-kablolaması (landscape, material,
  ışık, VFX, reflection, foliage, collision…) kayboldu; her birini elle geri
  eklemek işi ikiye katladı.
- **`RuntimeSceneApp` bir monolit.** CharacterMovement, dialogue, save-game,
  runtime-UI, skeleton yükleme constructor'da **koşulsuz** kuruluyor. Karaktersiz,
  tepeden bakışlı bir RTS bunlarla dövüştü.
- **Editör viewport ile runtime ayrı orkestrasyon.** Aynı capability iki dosyada
  ikiz metotlarla kuruluyor (`applySkyAtmosphere`↔`applyRuntimeSky`,
  `buildLandscapes`↔`buildRuntimeLandscapes`…), sıralama bile farklı. "Editörde
  görünür, Play'de yok" hatası bu ayrışmadan doğuyor.

Zaten iyi olan (silmeyeceğimiz):

- **Play birleşik:** Editör Play → `/` → `RuntimeSceneApp`. Tek Play runtime'ı var.
- **Game Mode zaten pluggable:** `src/game/gameModes/registry.ts` içinde
  `defaultCameraGameMode` (karaktersiz) ve `tpsCharacterGameMode` var. TPS/kamera
  gömülü değil — mode seçimiyle değişir.
- **IoC deseni kurulu:** `main.ts` oyun kataloglarını editöre enjekte ediyor
  (`setGameEditorCatalog`). Runtime'a da aynı ters-bağımlılık uygulanacak.
- **Tek-kaynak doğrulama örneği var:** `*.effect.json` validator'ı runtime
  normalizer'ını (`normalizeEffectDefinition`) yeniden kullanıyor.

---

## 1. Hedef Mimari — Üç Katman

```
┌──────────────────────────────────────────────────────────────┐
│ 3. GAME MODÜLÜ  (fork'a ait — src/game)                        │
│    RTS kuralları, custom Game Mode (tepeden kamera), HUD.      │
│    ForgeGameModule olarak takılır. Forge çekirdeğine girmez.   │
├──────────────────────────────────────────────────────────────┤
│ 2. CAPABILITY MODÜLLERİ  (engine'e ait, OPT-IN)                │
│    dialogue · save-game · character-movement · runtime-UI ·    │
│    AI · moving-platform · spline-follower …                    │
│    Silinmez → modüle çevrilir. Fork istediğini açar/kapatır.   │
│    Forge şablonu varsayılan seti kaydeder (demo bozulmaz).     │
├──────────────────────────────────────────────────────────────┤
│ 1. LEVELRUNTIME  (platform, DOKUNULMAZ, HER ZAMAN çalışır)     │
│    Level dosyasından gelen SAHNE İÇERİĞİ:                      │
│    mesh · shape · material · UVW · character-mesh · light ·    │
│    background/ambient · sky · fog · cloud · reflection         │
│    (env/plane/surface/capture) · post-process · landscape ·    │
│    foliage · spline · blocking-volume · collision · physics.   │
│    "Play'e bastığımda sahnede ne varsa görürüm" garantisi.     │
├──────────────────────────────────────────────────────────────┤
│ 0. SceneShell  (renderer/scene/camera/loop kabuğu)            │
│    Editör ve runtime ortak kullanır. Sahne mantığı içermez.   │
└──────────────────────────────────────────────────────────────┘
```

Akış:

```
Level JSON ──loadRoomLayout──▶ RoomLayout ──▶ LevelRuntime.build()
   (editör ve runtime AYNI pipeline'ı çağırır; fark = mode bayrağı + handler'lar)
        │
        ├─▶ SahneShell'e sahne içeriğini basar  ── HER ZAMAN
        │
        ├─▶ kayıtlı Capability modüllerini onLevelLoaded ile besler ── OPT-IN
        │
        └─▶ Game modülüne kontrolü verir (game mode possess, HUD) ── FORK
```

---

## 2. Temel İlkeler (invariant'lar)

1. **I1 — Level = sahnenin kaynağı.** Level'da olan genel içerik, hiçbir oyun
   koduna dokunmadan Play'de görünür. Görünmüyorsa bu bir hatadır, feature değil.
2. **I2 — Tek build pipeline.** Editör viewport ve runtime **aynı** sıralı
   LevelRuntime build listesini çağırır. İkiz `build*`/`apply*` metotları yasak.
   Fark yalnız `mode: "editor" | "runtime"` bayrağı ve enjekte edilen handler'larla
   ifade edilir (desen zaten var: `buildSplineInstanceGeneratorGroup(mode)`).
3. **I3 — Capability opt-in, silme yok.** Genel yetenekler modüle çevrilir;
   şablon varsayılan seti kaydeder. Fork bir modülü kapatınca **yalnız o davranış**
   gider, sahne içeriği (Katman 1) hep kalır.
4. **I4 — Fork monoliti düzenlemez.** Yeni oyun `createForgeRuntime({modules})` +
   `runtime.use(gameModule)` ile kurulur. `RuntimeSceneApp`/`LevelRuntime` fork
   tarafından edit edilmez.
5. **I5 — Sessiz veri kaybı yasak.** Save-validator ve runtime, bilinmeyen alan
   için sessizce düşürmek yerine tek-kaynak şema kullanır ve uyarı üretir.
6. **I6 — Forge her adımda çalışan şablon.** Varsayılan `/` demosu (TPS karakter)
   her fazın sonunda bootlar. Büyük tek-seferlik rewrite yok.
7. **I7 — Boundary gate'leri yeşil.** `verify:imports` + `verify:dist` her fazda
   geçer; editör hâlâ `@/game` import etmez; editor-only semboller prod'a sızmaz.

---

## 3. Mevcut → Hedef Eşlemesi

| Bugün (`RuntimeSceneApp` içinde) | Katman | Hedef |
|---|---|---|
| `buildScene` sahne içeriği: instances, char-mesh, light, sky, fog, cloud, reflection*, post, landscape, foliage, spline, blocking-volume, material, UVW, shape, collider derivation | **1** | `LevelRuntime` içinde tek pipeline; editör + runtime çağırır |
| `applySkyAtmosphere` ↔ `applyRuntimeSky` (ve tüm ikizler, AUDIT §2) | **1** | Tek metot, `mode` bayrağı |
| `physicsSubsystem` (Rapier), collider box'lar | **1** | LevelRuntime (fizik sahne içeriğinin parçası) |
| ~~`characterMovementSubsystem`~~ | **2** | ✅ `characterMovementModule` (E/6); solver `src/game` → `engine/movement/` taşındı |
| `movingPlatformSubsystem`, `splinePathFollowerSubsystem` | **2** | modüller (opt-in) |
| ~~`aiSubsystem` + `loadAiAssets` + nav~~ | **2** | ✅ `aiModule` (E/7); AI karakter animatörleri + attack köprüsü Faz F'ye kadar kabukta |
| `setupDialogue` + `loadDialogueAssets` | **2** | `dialogueModule` (opt-in) |
| ~~`saveCoordinator` (`RuntimeSaveCoordinator`)~~ | **2** | ✅ `saveGameModule` (E/3) |
| ~~`setupRuntimeUi` + widget/theme yükleme~~ | **2** | ✅ `runtimeUiModule` (E/4); locale kabukta (dialogue ile paylaşımlı), kurallar Katman 3 |
| ~~`loadCharacterSkeletons`~~ | **2** | ✅ `skeletalAnimationModule` (E/5); sidecar kütüphanesi modülde, ref'e iliştirme Faz F'ye kadar kabukta |
| ~~`playAutoPlayAudio` / `playAutoPlayParticles`~~ | **2** | ✅ `audioModule` (E/8, ses + soundCue + dialogue audio) · ✅ `vfxModule` (E/9, partikül) |
| ~~`startGameMode` + `gameModes/registry`~~ | **3** | ✅ Katalog `gameModule`'da (F/2); kabuk yalnız oturum yaşam döngüsünü sürer, `game-mode-provider` ile çözer |
| ~~`behaviorSubsystem` + `createSceneBehaviorRegistry`~~ | **2/3** | ✅ Çekirdek kabukta, katalog `behavior-registry-factory` ile oyun modülünde (F/2); host sözleşmesi `engine/behavior/behaviorHost.ts` |
| Editör-özel: gizmo, seçim, `refresh*`, `emit*Changed`, authoring overlay | editör | `SceneApp`'te kalır (Katman 0 + authoring) |

> Not: **TPS karakter + 3. şahıs kamera taşınmaz** — zaten Katman 3 (Game Mode).
> RTS için yapılacak: `src/game/gameModes/`'a `rtsGameMode` eklemek, karaktere
> bağlı capability modüllerini (character-movement, skeletal) kapatmak.

---

## 4. Fazlar

Her faz: **giriş → iş → dokunulan dosyalar → kabul kriteri → gate.**
Gate = `npx tsc --noEmit` + `npm run test:engine` (+ yapısal fazlarda
`npm run build:verify`) yeşil, ve I6/I7 korunur.

### Faz A — Build Manifest & Invariant (ölçüm, düşük risk)
- **İş:** `SceneApp.loadActiveProjectScene` ve `RuntimeSceneApp.buildScene`'in
  build adımlarını tek bir sıralı **manifest** olarak çıkar (veri olarak: adım
  adı + kategori). İki listenin farkını raporla. I1/I2'yi test taslağıyla sabitle.
- **Dosyalar (yeni):** `src/scene/buildManifest.ts` (yalnız veri/enum),
  `tests/engine/buildManifestParity.test.ts`.
- **Kabul:** Test, "sahne-içeriği adımları iki kabukta da aynı kümede" der;
  farklar (editör-only / runtime-only) açıkça listelenir ve beklenen sayıdadır.
- **Neden önce:** Sonraki refactor'ların drift yaratmadığını bu test yakalar.

> **Uygulama kaydı (2026-08-09):** Faz A tamamlandı. `src/scene/buildManifest.ts`,
> editor ve runtime kabuklarındaki mevcut semantik adımları, kategori ve sıra ile
> kayda alır. `tests/engine/buildManifestParity.test.ts`, ortak level-content
> kümesinin aynı olduğunu, kabuğa özel adımların açıkça listelendiğini ve mevcut
> environment/reflection sıra farkının görünür kaldığını doğrular. `tsc`,
> `verify:imports`, production build ve strict dist doğrulaması yeşil. Engine
> testi yeni kontrollerden sonra, depoda bulunmayan
> `public/assets/starter-content/Dialogue/DV_Narrator.dialoguevoice.json`
> fixture'ı nedeniyle mevcut bir dialogue testinde duruyor; bu Faz A değişikliğinin
> dışında kalan açık bir test altyapısı sorunudur.

### Faz B — SceneShell ayrımı (Katman 0)
- **İş:** renderer/scene/camera/loop yaşam döngüsünü ince bir `SceneShell`'e al
  (`SceneRuntimeCore`'daki `createSceneRuntimeCore` + resize + stats bunun çekirdeği).
  `SceneApp` ve `RuntimeSceneApp` bunu ortak kullanır. Sahne mantığı taşınmaz.
- **Dosyalar:** `src/scene/SceneShell.ts` (yeni), `SceneRuntimeCore.ts` (mevcut
  fonksiyonları buraya delege), iki kabuk import'ları.
- **Kabul:** Editör ve runtime aynı SceneShell'i kurar; demo + `?editor` bootlar;
  smoke testleri (`smoke:browser`) yeşil.

> **Uygulama kaydı (2026-08-09):** `SceneShell`, renderer/scene/camera ve
> responsive resize yaşam döngüsünün ortak sahibi olarak eklendi. `SceneApp` ve
> `RuntimeSceneApp` bu kabuğu doğrudan kullanıyor; geriye uyum için
> `SceneRuntimeCore` kurulum/resize API'leri SceneShell'e delege ediyor. TypeScript,
> import, production build ve strict dist doğrulaması yeşil. Engine test paketi,
> Faz A kontrolleri geçtikten sonra Faz A'da kaydedilen eksik dialogue fixture'ında
> duruyor. Browser smoke kabulü tamamlanamadı: 5173 portu Forge yerine kullanıcının
> ThreeAges Vite sunucusuna aitti; yanlış sunucuya karşı koşan deneme zaman aşımına
> uğradı ve geçici smoke dosyaları teardown ile geri alındı. Kullanıcı sunucusuna
> dokunulmadı.

### Faz C — LevelRuntime çekirdeği (Katman 1, tek pipeline)
- **İş:** Yeni `LevelRuntime` sınıfı: Level'dan gelen **tüm sahne içeriğini** tek
  sıralı `build(mode)` pipeline'ında kurar. Bugünkü ikiz `build*`/`apply*`
  metotları (AUDIT §2 listesi) buraya taşınır; `mode:"editor"|"runtime"` +
  handler enjeksiyonu ile fark ifade edilir. Sıralama tek yerde tanımlanır
  (reflection-capture bake sırası dahil).
- **Sıra (tek doğru kaynak):** models → shape → UVW → material → instances/char/
  light → sun-shadow → background/ambient → sky → reflection(env) → post → fog →
  cloud → reflection planes → surfaces → captures → blocking-volumes → splines →
  landscape → foliage → collider derivation → physics.
- **Dosyalar:** `src/scene/LevelRuntime.ts` (yeni), `SceneApp`/`RuntimeSceneApp`
  ikiz metotları LevelRuntime çağrısıyla değişir; `SceneRuntimeCore` yardımcıları
  korunur/çekirdeğe girer.
- **Kabul:** Faz A manifest testi hâlâ yeşil (drift yok); editör viewport ile
  Play görsel çıktısı eşleşir (RuntimeParity level ile — Faz H'de otomatikleşir);
  `build:verify` + smoke yeşil.
- **Uyarı:** En büyük faz. Alt-adımlara böl (her capability grubu ayrı commit:
  önce env/render grubu, sonra reflection grubu, sonra terrain/foliage grubu),
  her alt-adımda gate.

> **Uygulama kaydı (2026-08-09, C/1):** `LevelRuntime`, environment/render ve
> reflection-object sıralarının tek sahibi olarak eklendi. İki kabuk, kendi
> uygulama ayrıntılarını handler olarak verir; ortak sıra `sun-shadow →
> background/ambient → sky → environment reflection → post → fog → cloud →
> reflection captures → planes → reflective surfaces` artık tek yerdedir.
> Probe capture’lar planar/mirror yüzeylerden önce bake edilir; bu runtime’ın
> mevcut geri-beslemeyi önleyen sırasıdır ve editor de aynı sıraya hizalanmıştır.
> Faz A manifest testi ortak level-content için artık sıralı eşitlik denetler.
> `tsc`, production build, import ve strict dist kapıları yeşil. İlgili editor
> viewport smoke’u geçti. Runtime locomotion smoke’u ise exception olmadan
> `Warming shaders 31 / 31` aşamasında 30 saniyelik loading eşiğini aştı; bu
> mevcut runtime warm-up kabul engelidir. Engine paketinde de önce yeni testler
> geçiyor, ardından eksik dialogue fixture’ında duruyor.

> **Uygulama kaydı (2026-08-09, C/2):** Terrain/foliage dilimi de
> `LevelRuntime`a taşındı: `blocking-volumes → splines → landscapes → foliage`.
> Landscape ve foliage handler’ları `await` ile sıralı çalışır; editor-only AI
> navigation/target-point/widget hazırlıkları ortak level-content zincirinin
> dışında kalır. Birim test bu asenkron sırayı doğrular; TypeScript, production
> build, import ve strict dist kapıları yeniden yeşildir. Browser’daki landscape
> runtime kabulü C/1’de kaydedilen shader warm-up eşiği nedeniyle açık kalır.

> **Uygulama kaydı (2026-08-09, C/3 — Faz C tamamlandı):** Core content zinciri
> (`models → shape-models → UVW → material-slots → scene-entities → actors`) da
> LevelRuntime handler’larına taşındı. Her iki kabuk artık ortak sahne içeriğinin
> tamamını tek `await levelRuntime.build()` çağrısıyla kurar; Faz A manifesti bu
> ortak adımların tam sıralı eşitliğini korur. Collider/AI/gameplay başlatma
> yaşam döngüsü, capability sınırını korumak için Faz D–E’de modüllere ayrılacak.
> Tam-pipeline unit testi, TypeScript, production build, import ve strict dist
> doğrulamaları yeşildir; hedef editor viewport smoke da geçer. Engine paketinin
> geri kalanı eksik dialogue fixture’ında, runtime browser kabulü ise shader
> warm-up eşiğinde açık kalır.

### Faz D — Capability modül sistemi (Katman 2 iskeleti)
- **İş:** Opt-in `CapabilityModule` arayüzü + kayıt/lifecycle. Modül, LevelRuntime
  build'inden sonra `onLevelLoaded(ctx)` ile beslenir; `update(dt)`/`dispose()`
  alır. Henüz davranış taşınmaz — sadece iskelet + boş registry.
- **Dosyalar:** `src/scene/capabilities/CapabilityModule.ts` (arayüz),
  `capabilityRegistry.ts`, `RuntimeContext.ts` (modüllere verilen bağlam:
  scene, entities, assetLoader, engineApp erişimi — dar ve stabil tutulur).
- **Kabul:** Boş registry ile runtime aynen çalışır; tip kontrol + testler yeşil.

> **Uygulama kaydı (2026-08-15, Faz D tamamlandı):** `src/scene/capabilities/`
> altında üç dosyalık iskelet eklendi: `CapabilityModule.ts` (tüm hook'ları
> opsiyonel arayüz), `RuntimeContext.ts` (dar bağlam + `createRuntimeContext`
> tembel entity indeksi), `capabilityRegistry.ts` (`CapabilityRegistry` +
> `createCapabilityRegistry`). Yaşam döngüsü sözleşmesi: kurulum
> (`onLevelLoaded`, `update`) kayıt sırasında, teardown (`onLevelUnloaded`,
> `dispose`) ters sırada; hook fırlatan modül karantinaya alınır (seviye başına
> bir kez raporlanır, sonraki level yüklemesinde temizlenir) — böylece bir modül
> hatası boot'u düşürmez (I6). Aynı id ile ikinci kayıt hata fırlatır (sessiz
> kayıp yok, I5). `RuntimeSceneApp` yalnız dört noktadan bağlanır: opsiyonel
> `capabilities` seçeneğiyle kayıt (IoC), `buildScene` sonunda shader warm-up'tan
> hemen önce `levelLoaded`, frame döngüsünde Game Mode'dan önce `update`,
> `teardownScene`/`dispose` içinde teardown. Davranış taşınmadı; varsayılan set
> boş olduğundan demo birebir aynı. `buildManifest` yeni `capability-modules`
> runtime adımını kaydeder ve `verify:imports` artık `src/scene/capabilities/**`
> için `editor`+`game` import yasağını uygular. Yeni birim testleri
> (`tests/engine/capabilityRegistry.test.ts`, 9 kontrol) sıra, ters teardown,
> karantina, id çakışması ve context lookup'ını doğrular. `tsc`,
> `verify:imports`, production build ve strict dist yeşil; engine paketi Faz A'da
> kaydedilen eksik dialogue fixture'ında durmaya devam ediyor (aşağıdaki not).

> **Faz B/C'den beri açık olan runtime browser kabulü kapandı (2026-08-15).**
> "Warming shaders'ta 30 sn eşiğini aşıyor" olarak kaydedilen engel iki ayrı
> nedenden oluşuyordu ve ikisi de düzeltildi:
>
> 1. **Smoke yanlış sunucuya koşuyordu.** `playwright.config.ts` 5173'ü
>    `reuseExistingServer: true` ile kullanıyordu; o portta kullanıcının başka bir
>    Forge fork'unun (ThreeAges) dev sunucusu vardı. Fork bu şablonun kopyası
>    olduğu için tüm Forge route'larına cevap veriyor: editör smoke'ları *yanlış
>    çalışma kopyasına* karşı geçiyor, runtime smoke'ları o projenin ağır
>    level'ını yüklerken zaman aşımına uğruyordu. Smoke artık kendi portunu
>    (5273, `npm run dev:smoke`) kullanıyor ve `reuseExistingServer: false` ile
>    her zaman kendi sunucusunu başlatıyor — port doluysa `--strictPort` yüksek
>    sesle hata verir, sessizce yabancı repoya bağlanmaz.
> 2. **Gerçek runtime hatası: sonsuz "Warming shaders".** `compileAsync`, her
>    programın `COMPLETION_STATUS_KHR` değerini bekler; three bu sorguyu koşulsuz
>    yapar, dolayısıyla `KHR_parallel_shader_compile` yoksa sorgu hep null döner,
>    promise **hiç settle olmaz** ve yükleme ekranı sonsuza kadar asılı kalır
>    (ölçüldü: 150 sn'de bile bitmedi; headless Chromium → SwiftShader). Bu yalnız
>    testi değil, o eklentiyi desteklemeyen her tarayıcı/sürücüde gerçek oyuncuyu
>    da etkiler. `warmRuntimeShaders` artık eklenti yoksa senkron
>    `renderer.compile()` kullanıyor (aynı GPU işi, sadece hazır-olma yoklaması
>    yok) ve eklenti varsa 15 sn'lik timeout ile yarıştırıyor — yavaş warm-up
>    kare kaybettirir, boot'u düşürmez.
>
> Sonuç: `runtime-locomotion` smoke'u 23.3 sn'de geçiyor.

> **Faz A'dan beri açık olan test engeli kapandı (2026-08-15):** `test:engine`,
> `22f2351` ("Add Forge Runtime Editor Parity Plan and Audit Report") commit'inde
> starter-content'in bir bölümü silindiği için duruyordu. O temizlik bilinçliydi;
> yalnız engine testlerinin fixture olarak okuduğu **7 asset** geri alındı
> (`Dialogue/DV_Narrator` + `DL_Welcome` + `CONV_Welcome`,
> `Localization/en` + `tr`, `AI/Boss_Phase_Demo.blackboard` + `.stateTree`),
> her biri `22f2351~1`'deki manifest girdisiyle ve eski manifest sırasındaki
> yerine yeniden kaydedildi. Silinen geri kalan içerik (AI TestRange, Actors,
> Land/MeshPaint level'ları, Script, George.glb) bilerek geri alınmadı.
> `build:verify` artık uçtan uca yeşil: `tsc` + `vite build` +
> **924/924 engine check** + `verify:dist --strict`; `check:assets` PASS
> (yalnız geri gelen 7 asset için thumbnail uyarısı).

### Faz E — Baked subsystem'leri modüle taşı (Katman 2 dolumu)
- **İş:** §3 tablosundaki her baked subsystem'i bir CapabilityModule'e çıkar:
  `dialogueModule`, `saveGameModule`, `characterMovementModule`,
  `runtimeUiModule`, `skeletalAnimationModule`, `aiModule`,
  `movingPlatformModule`, `splineFollowerModule`, `audioModule`, `vfxModule`.
  **Varsayılan set** `src/game` (veya bir `defaultRuntimeModules.ts`) tarafından
  kaydedilir → demo davranışı birebir korunur (I6).
- **Dosyalar:** `src/scene/capabilities/*Module.ts`, ilgili subsystem'lerin
  `RuntimeSceneApp` constructor'ından çıkışı, `defaultRuntimeModules.ts`.
- **Kabul:** Her modül taşındıktan sonra demo + smoke birebir aynı; bir modülü
  kapatınca (test) yalnız o davranış kaybolur, sahne içeriği kalır (I3).
- **Uyarı:** Her modül = ayrı commit + gate. Sırayla: en izole olandan başla
  (moving-platform, spline-follower) → dialogue → save-game → runtime-UI →
  skeletal → character-movement → ai. Modüller arası bağımlılık (ör. character-
  movement ↔ skeletal) `RuntimeContext` üzerinden gevşek çözülür.

> **Uygulama kaydı (2026-08-15, E/1 — bağlanma mekanizması + ilk iki modül):**
> Faz D iskeleti yalnız `onLevelLoaded` veriyordu; bir subsystem'i modüle taşımak
> için iki şey daha gerekiyordu ve ikisi de bu dilimde eklendi:
>
> 1. **`onRuntimeStart(services)` hook'u** (`RuntimeServices.ts`): modül, kabuk
>    kurulurken kendi subsystem'ini yaratır, bir **tick slot**'una sıraya koyar,
>    seviye entity kümesi için sink kaydeder ve servislerini yayımlar.
> 2. **Tick slot sözleşmesi** (`RUNTIME_TICK_SLOTS`: `pre-physics → physics →
>    platform → decision → movement → post-movement → gameplay → presentation`).
>    Subsystem tick sırası gerçek davranıştır (platform binicisinden önce hareket
>    etmeli; spline rotası AI move-intent'i ezmeli). Subsystem'ler bağımsız
>    modüllere dağılınca "önce kaydolan önce tick'ler" fork için okunamaz hale
>    gelirdi; slot, sırayı işin anlamına sabitler (Unreal tick group'larının küçük
>    ölçekli hali). Kabuğun kendi subsystem'leri de artık slot üzerinden
>    kaydediliyor, dolayısıyla modül kayıt sırası simülasyonu sessizce değiştiremez.
>
> Modüller arası gevşek bağ tek bir yerde listelenen tipli servis anahtarlarıyla
> kuruldu (`runtimeServiceKeys.ts`): `moving-platform-query`,
> `spline-registry-source`, `character-transform-reset`, `spline-follower-debug`.
> `resolve()` `undefined` dönmesi normaldir = o modül kapalı (I3). Aynı id ile
> ikinci `provide` hata fırlatır (sessiz kayıp yok, I5).
>
> Taşınanlar: `movingPlatformModule` (`platform` slotu) ve `splineFollowerModule`
> (`post-movement` slotu). `RuntimeSceneApp` artık bu iki subsystem'i tanımıyor:
> karakter hareketi platformları `movingPlatformQueryService` üzerinden **çağrı
> anında** okuyor (modül kapalıysa boş liste), spline takipçisi de spline
> registry'sini ve karakter-transform reset'ini aynı şekilde tembel çözüyor —
> karaktersiz bir oyunda reset servisi hiç yayımlanmaz ve transform doğrudan
> yazılır. Varsayılan set `capabilities/defaultRuntimeModules.ts`'de; `main.ts`
> kompozisyon kökü onu enjekte ediyor (editör catalog IoC deseninin runtime
> eşleniği), böylece demo davranışı birebir korunur (I6).
>
> Kayıt defteri (`capabilityRegistry`) `runtimeStart` için ayrı bir kalıcı
> karantina tutar: `onRuntimeStart` fırlatan modül subsystem'lerini hiç
> kaydettirememiştir, dolayısıyla sonraki seviyede "yeni bir şans" verilmez
> (seviye başına karantina davranışı değişmedi).
>
> Kapılar: `tsc`, `verify:imports`, production build, **936/936 engine check**,
> `verify:dist --strict` yeşil. Browser: `runtime-locomotion` (25.7 sn) ve
> `runtime-playflow` (37.2 sn) smoke'ları geçiyor.

> **Uygulama kaydı (2026-08-15, E/2 — dialogue modülü):** Dialogue & Voice'un
> tamamı `capabilities/dialogueModule.ts`'e taşındı: `DialogueSubsystem`,
> `ConversationDirector`, iki DOM overlay (altyazı satırı + seçim paneli),
> manifest'ten `dialogueVoice`/`dialogueLine`/`conversation` kaydı ve
> `play-dialogue` / `start-conversation` script-message tetikleyicileri.
> `RuntimeSceneApp`'ten `setupDialogue`, `loadDialogueAssets`, iki overlay mount
> yardımcısı, iki abonelik alanı ve teardown/dispose satırları çıktı (~150 satır).
>
> Modülün kabuktan istediği her şey servis üzerinden ve **hepsi opsiyonel**:
> `script-message-bus` (behaviorSubsystem), `dialogue-audio` (audioSubsystem +
> soundCue; audio modülü Faz E'nin ilerisinde) ve `subtitle-localization`
> (locale registry UI ile paylaşıldığı için kabukta kaldı; `ensureLoaded()`
> HUD'suz sahnede tabloları yükler). Bus yoksa hiçbir şey tetiklenemez, audio
> yoksa altyazı metin-uzunluğu tahminiyle görünür, localization yoksa yazılan
> metin kullanılır — üçü de testle sabitlendi.
>
> Seviye kurulumu artık `onLevelLoaded` içinde olduğu için `buildManifest`'teki
> ayrı `dialogue` runtime adımı kaldırıldı; iş `capability-modules` adımının
> içinde. Yeni birim testi `tests/engine/dialogueModule.test.ts` (manifest kaydı,
> bus'tan satır çalma, bilinmeyen satırın no-op olması, seviye teardown'unda
> tetikleyicilerin bırakılması, servissiz host'ta sessiz çalışma).
>
> Kapılar: `build:verify` uçtan uca yeşil (**938/938 engine check**). Browser:
> `runtime-playflow`, `runtime-script-message`, `runtime-checkpoint` smoke'ları
> geçiyor.

> **Uygulama kaydı (2026-08-16, E/3 — save-game modülü):** Slot tabanlı
> save/load'un tamamı `capabilities/saveGameModule.ts`'e taşındı: `SaveGameStore`,
> bekleyen-restore mandalı, quick/slot yazma-yükleme-silme, checkpoint autosave,
> ayrılmış `save:*` widget mesajları ve `save.slots.*` ViewModel alanları.
> `src/scene/runtimeSaveCoordinator.ts` silindi; `RuntimeSceneApp`'ten
> `saveCoordinator` alanı, `createRuntimeSaveGameStore`, `setStore`,
> `applyPendingRestore` ve `refreshUiFields` çağrıları çıktı.
>
> **Sınır düzeltmesi:** capability modülleri `@/game` import edemez (I7 kapısı),
> ama save sözleşmesi `src/game`'deydi. İçeriği zaten jenerikti (aktif level yolu,
> pawn transformu, kalıcı behavior state'i) — bu yüzden `src/game/saveGame.ts` →
> `engine/persistence/saveGameState.ts` ve `src/game/saveGameUi.ts` →
> `engine/persistence/saveGameSlots.ts` olarak taşındı. Fork'a özel save verisi
> bu payload'ın *üstüne* eklenir, içine değil.
>
> Modülün kabuktan istediği her şey servis üzerinden ve hepsi opsiyonel:
> `project-identity` (slot ad alanı; proje asenkron yüklendiği için getter),
> `gameplay-save-state` (capture/restore — canlı game-mode/karakter/behavior
> state'i okuduğu için kabukta kaldı), `level-travel` (save yüklemek = kaydedilen
> level'a travel + build sonrası restore), `ui-view-model` ve `ui-screen-stack`.
> Kabuğun modülden istediği tek yüzey `save-game-commands`: widget mesajı,
> checkpoint, travel'ın mandalı düşürmesi ve public `requestSaveGameLoad` — dördü
> de olayın geldiği yerde çözülüyor. Modül kapalıyken `resolve` `undefined` döner:
> checkpoint hacmi hâlâ geçerli bir tetikleyicidir, sadece yazacak yeri yoktur ve
> `save:*` mesajları normal `ui-action` olarak gameplay'e düşer (I3).
>
> **Sıra değişikliği (bilinçli):** restore + slot alanlarının doldurulması artık
> `onLevelLoaded` içinde, yani `setupRuntimeUi`'dan *sonra* çalışıyor (eskiden
> hemen `startGameMode` sonrasıydı). Aradaki adımların hiçbiri kalıcı behavior
> state'ini ya da pawn transformunu okumuyor ve hepsi ilk kareden önce, yükleme
> ekranı hâlâ açıkken bitiyor; alan tazelemesi `flush()` ile bittiği için açık bir
> menü de anında güncelleniyor. `buildManifest`'teki ayrı `save-game-restore`
> runtime adımı bu yüzden kaldırıldı — iş `capability-modules` adımının içinde.
>
> Yeni birim testi `tests/engine/saveGameModule.test.ts` (4 kontrol): slot yazma +
> UI alanları + level eşleşmeli restore (yanlış level'da mandalda kalır, doğru
> level'da bir kez uygulanır), checkpoint autosave + travel'ın mandalı düşürmesi,
> host servisleri eksikken bozulmadan çalışma, ve modülsüz runtime'da komut
> yüzeyinin hiç var olmaması.
>
> Kapılar: `build:verify` uçtan uca yeşil (**942/942 engine check**),
> `verify:imports` PASS. Browser: `runtime-checkpoint` (33.3 sn),
> `runtime-playflow` (37.0 sn) ve `runtime-portal` (40.7 sn) smoke'ları geçiyor.

> **Uygulama kaydı (2026-08-16, E/4 — runtime-UI modülü):** `setupRuntimeUi`'ın
> sunum yarısı `capabilities/runtimeUiModule.ts`'e taşındı: `.ui.json` widget ve
> tema yükleme, `RuntimeUiSubsystem` (HUD + ekran yığını), `WorldUiSubsystem`
> (yansıtılan billboard'lar), duraklatma menüsü ve widget `message` yönlendirmesi.
> `RuntimeSceneApp`'ten `uiSubsystem`, `worldUiSubsystem`, `uiDefs`, `uiThemes`,
> `pauseMenuDef`/`winScreenDef`/`loseScreenDef` alanları ve `loadAllUiWidgetDefs`,
> `loadUiThemeDefs`, `updateUiInput`, `openPauseMenu`, `updateWorldUi` metotları
> çıktı.
>
> **Sınır (plan §3/§8 uyarınca): sunum Katman 2, veri ve kurallar kabukta.**
> Kabukta kalanlar ve nedenleri:
>
> - `uiStore` (ViewModel): `player.*`, `loading.*`, `graphics.*`, `save.slots.*`
>   alanlarını birçok kabuk/modül yazıyor — UI'ın verisi, UI'ın kendisi değil.
> - `localeRegistry`: aynı tablolar hem widget metnini hem dialogue altyazısını
>   besliyor. Modüle taşınsa iki modül arasında "hangisi önce yükler" sırası
>   doğardı; kabukta durunca ikisi de `localization` servisinden çözer
>   (eski `subtitle-localization` anahtarı bu yüzden `localization` oldu ve
>   `registry()` kazandı).
> - `GameStateStore` + `game:*` mesajları: kurallar Katman 3, capability modülü
>   `@/game` import edemez. Kural katmanı UI'a yalnız etki olarak konuşuyor
>   (`screenDepth()`, `showOutcomeScreen("won"|"lost")`, `clearScreens()`).
>
> Modülün yayımladıkları: `runtime-ui-presenter` (ekran derinliği, temizle,
> duraklatma menüsü, id ile widget push, sonuç ekranı, world-widget projeksiyonu)
> ve `ui-debug` (`?debug` overlay'i için host/world snapshot). Save modülü
> menüyü kapatmak için artık bu presenter'ı çözüyor — Faz E'nin söz verdiği
> "sağlayıcı modüle taşınır, tüketici değişmez" durumu. Kabuğun yayımladığı tek
> yeni yüzey `ui-host`: `menu` kenarı, ekran yığını değişince input modu,
> canvas ölçüsü, entity dünya konumu ve ayrılmış mesaj zinciri
> (`game:*` → `travel:` → `save:*` → `settings:*`, sonra gameplay'e `ui-action`).
>
> **Kare sırası korundu:** `menu` kenarı modülün `update()`'inde tüketiliyor —
> `capabilities.update` zaten motor tick'inden sonra, Game Mode'dan önce koşuyor,
> yani ekran açmak o karenin kamera/hareketini hâlâ bastırıyor. World-widget
> projeksiyonu ise bilinçli olarak modülün tick'ine konmadı: kamera bu kare
> hareket ettikten *sonra* çalışması gerekiyor, yoksa billboard'lar bir kare
> geriden gelirdi; kabuk `projectWorldWidgets()`'i eski `updateWorldUi()` yerinde
> çağırıyor.
>
> `buildManifest`'teki `runtime-ui` adımı `game-rules` olarak daraldı (kabukta
> kalan iş bu); widget mount'u `capability-modules` adımının içinde.
>
> Yeni birim testi `tests/engine/runtimeUiModule.test.ts` (3 kontrol): DOM'suz
> host'ta hiçbir şey mount etmeme + tüm presenter çağrılarının no-op olması,
> UI yazmayan level'da manifest'in hiç okunmaması ("bedava" özelliği), ve modül
> kapalıyken presenter/debug servislerinin hiç var olmaması.
>
> Kapılar: `build:verify` uçtan uca yeşil (**945/945 engine check**),
> `verify:imports` PASS. Browser: `runtime-playflow`, `runtime-checkpoint`,
> `runtime-portal`, `runtime-locomotion`, `runtime-script-message` smoke'ları
> geçiyor (5/5).

> **Uygulama kaydı (2026-08-16, E/5 — skeletal-animation modülü):**
> `capabilities/skeletalAnimationModule.ts`, `*.skeleton.json` sidecar
> kütüphanesinin (blend space, anim-set rol haritası, socket, notify, montage,
> root motion) tek sahibi: varlık başına tek fetch, level boyunca cache, level
> boşalınca sıfırlama. Kabuktaki `loadCharacterSkeletons` gitti.
>
> **Sınır (Faz F'ye kadar bilinçli yarım):** modül def'i karaktere *iliştirmiyor*.
> `RuntimeCharacterRef` bir Game Mode tipi (Katman 3, `src/game/gameModes/types.ts`)
> ve capability modülü `@/game` import edemez; üstelik metadata Game Mode pawn'ı
> sahiplenmeden **önce** hazır olmalı, bu da her capability'nin `onLevelLoaded`
> hook'undan önce gelen bir an. Bu yüzden kabuk `skeleton-library` servisini o
> noktada çağırıp tek satırlık iliştirmeyi kendi yapıyor
> (`attachCharacterSkeletons`). Game Mode'un kendisi modül olduğunda (Faz F) bu
> sıra kısıtı ortadan kalkar ve iliştirme de modüle geçebilir.
>
> Modül kapalıyken `resolve` `undefined` döner, iliştirme adımı no-op olur ve her
> karakterin `ref.skeleton`'ı yok kalır: karakter hâlâ render edilir ve yazılmış
> klibini oynatır, yalnız blend space / root motion / notify devre dışı kalır —
> iskeletsiz bir oyunun hiç ödemek istemediği maliyet (I3).
>
> Yeni kabuk servisi `asset-manifest` (`() => Promise<AssetManifest | null>`):
> level hook'undan *önce* kabuk tarafından çağrılan modüller manifest'i
> `context.assetLoader`'dan alamaz. Dar ve yeniden kullanılabilir.
>
> Yeni birim testi `tests/engine/skeletalAnimationModule.test.ts` (3 kontrol):
> yerleşim sayısından bağımsız varlık başına tek fetch + eksik sidecar'ın boş
> varsayılana düşmesi + level başına cache sıfırlanması, manifest yokken
> varsayılana düşme, ve modül kapalıyken kütüphanenin hiç var olmaması.
>
> Kapılar: `build:verify` yeşil (**948/948 engine check**), `verify:imports` PASS.
> Browser: `runtime-locomotion`, `runtime-playflow`, `ai-patrol` (iskelet
> metadatasını gerçekten kullanan üç smoke) geçiyor.

> **Uygulama kaydı (2026-08-16, E/6 — character-movement modülü, iki commit):**
>
> **Hazırlık commit'i (`7630b38`) — solver `src/game`'den çıktı.** Plan
> `CharacterMovementSubsystem`'i Katman 2 sayıyor, ama solver ve altı yardımcısı
> `src/game`'deydi; capability modülü `@/game` import edemez (E/3'teki save
> sözleşmesiyle aynı sınır). Yedisi de saf, varlıktan bağımsız karakter-hareket
> matematiği — içlerinde tek bir proje kuralı yok — bu yüzden değişmeden
> `engine/movement/` altına taşındı:
>
> - `characterMovementSystem.ts` → `characterMovementSubsystem.ts`
> - `playerMovement.ts` → `planarMovement.ts` ("player" bir oyun kavramı)
> - `collision.ts` → `characterCollision.ts` (`engine/scene/collision.ts` ile
>   karışmasın)
> - `verticalMotion`, `slopeSurface`, `uphillSlowdown`, `locomotionAnimation`
>
> ~20 import yeri yeniden yazıldı, mantık değişmedi. Yan kazanç: editör kabuğu
> `src/scene/SceneApp.ts` artık collision/slope yardımcıları için `@/game`'e
> uzanmıyor. **Fork notu:** bu dosyalar fork'un sahip olduğu `src/game`
> ağacından çıktı; upstream sync yapan bir fork onları yer değiştirmiş görecek.
>
> **Modül commit'i — `capabilities/characterMovementModule.ts`.** Kapsül
> çarpışması, zemin probu/step-up, eğim, yerçekimi ve zıplama, knockback launch,
> hareketli platform binme: hepsi `movement` slotunda tick'leyen modülde.
> `RuntimeSceneApp`'ten `characterMovementSubsystem` alanı ve 14 çağrı yeri
> çıktı; `startSceneRuntime`'daki ayrı `characterMovement` sink'i yerini modülün
> kendi `addEntitySink`'ine bıraktı.
>
> Kabuk tek bir toplu servis veriyor — `character-movement-host`: input action'ları,
> physics query'si, level yerçekimi, Game Mode'un control yaw'ı ve possess durumu,
> AI move-intent'i, locomotion rapor sink'i, dinamik blocker AABB'leri. Hepsi
> canlı kabuk/Katman 3 durumu olduğu için modüle *verilir*, modül onlara uzanmaz.
> Host yoksa modül solver'ı **hiç kaydetmez** — hareket ettirecek bir dünya yok.
> Platformlar istisna: çağrı anında `moving-platform-query`'den çözülüyor, yani
> iki modülün bağlanma sırası önemsiz.
>
> Modülün yayımladıkları: `character-movement-query` (transformOf, velocityOf,
> forEachCharacter, launch) ve `character-transform-reset` — ikincisinin
> sağlayıcısı kabuktan modüle geçti, tüketicileri (spline follower) değişmedi.
> Kabuk `resetCharacterTransform` ile ışınlıyor: solver varsa onun üzerinden
> (yoksa bir sonraki kare bayat kopyasından geri yazar), yoksa doğrudan
> render/physics'e.
>
> Modül kapalıyken karakterler pawn olarak simüle edilmez: level, mesh'leri,
> fizik gövdeleri ve script'leri aynen durur, kabuğun transform/velocity
> sorguları "çözülmüş karakter yok" der. Planın var oluş sebebi olan
> tepeden-bakışlı / pawn'sız senaryo tam olarak budur (I3).
>
> Yeni birim testi `tests/engine/characterMovementModule.test.ts` (4 kontrol):
> solver kurulumu + iki yüzeyin yayımlanması + entity beslemesi, reset servisinin
> hem solver'ı hem render'ı hizalaması ve level teardown'ında boşalması,
> platform modülü *sonra* kaydolsa bile tembel çözülmesi (slot sırası korunur),
> ve host yokken hiçbir şeyin kaydolmaması.
>
> Kapılar: `build:verify` yeşil (**952/952 engine check**), `verify:imports` PASS.
> Browser: sekiz smoke geçiyor — `runtime-locomotion`, `runtime-checkpoint`,
> `runtime-portal`, `runtime-playflow`, `runtime-script-message`, `ai-patrol`,
> `ai-navigation-clearance` (editör + runtime).

> **Uygulama kaydı (2026-08-26, E/7 — AI modülü):** Karar katmanı ve kararları
> yürüten navigasyonun tamamı `capabilities/aiModule.ts`'e taşındı: `AISubsystem`
> (`decision` slotu), `*.behaviortree/blackboard/statetree.json` varlık kütüphanesi,
> Target Point rotaları, `moveTo` arkasındaki tüm yol takibi (fırınlanmış nav
> grid + revizyon önbelleği, ajan clearance profilleri, yürünebilir zemin
> örnekleyici, waypoint ilerletme, takılma kurtarma, yerel ayrışma yönlendirmesi),
> script-mesaj → uyarıcı köprüsü ve `?debug` nav/algı overlay'i.
> `RuntimeSceneApp` bu işin **692 satırını** bıraktı (4855 satıra indi): 22 metot,
> 8 alan, tüm `AI_NAV_*` sabitleri ve dokuz `@engine/navigation` /
> `@engine/render-three/aiNavigation*` import'u çıktı.
>
> Kabuk tek bir toplu servis veriyor — `ai-host`: `?debug` bayrağı, oyunun
> Katman 3 görev kütüphanesi (`createGameAiTaskRegistry`; capability `@/game`
> import edemez, bu yüzden kabuk enjekte ediyor), fizik türevli nav dünyası
> (`ai-navigation-query`: algı engelleri, nav rolü filtreli blocker'lar +
> yürünebilir üçgenler, collider yarı-boyutu), kalite odak noktası ve boşta
> lokomosyon raporu. Host yoksa modül **hiçbir şey kaydetmez** — algılanacak ya
> da planlanacak bir dünya yok. Kardeş modüller tembel çözülüyor ve hepsi
> opsiyonel: `script-message-bus` (yoksa uyarıcı yok), `character-movement-query`
> (yoksa ajanın plan yapacağı bir konumu yok) ve `spline-registry-source`.
>
> **Spline kaydı artık proxy.** Eskiden `buildRuntimeSplines` her seviyede
> `aiSubsystem.configure({ splineRegistry })` çağırıyordu; modül seviye
> hook'undan *önce* tick'leyebileceği için bu bir yarış olurdu. Yerine çağrı
> anında `spline-registry-source`'u çözen ince bir `SplineRegistry` proxy'si
> konstrüksiyon anında veriliyor: Level Travel'da bayatlamıyor, kaynak hiç yoksa
> devriye rotası bulunamıyor, o kadar.
>
> Modülün yayımladıkları: `ai-commands` (seviye hazırlama, transform senkronu,
> kare başına move-intent, uzak-NPC tick temposu) ve `ai-debug` (controller +
> navigasyon anlık görüntüleri). Kabuk `getAiDebugSnapshot` /
> `getAiNavigationDebugSnapshot`'ı bunlardan çözüyor ve modül kapalıyken boş
> varsayılana düşüyor. `ScriptMessageBus.emit` `target` parametresi kazandı —
> AI'ın adresli mesajı bus üzerinden geçerken sessizce düşüyordu.
>
> **Sıra kısıtı (E/5 ile aynı desen):** bir controller'ın blackboard şeması
> varlıklardan okunarak kurulur, yani AI varlıkları entity kümesi beslenmeden
> *önce* hazır olmalı — bu da her capability'nin `onLevelLoaded`'ından önceki bir
> an. Bu yüzden kabuk `ai-commands.prepareLevel(layout)`'u tam eski
> `loadAiAssets()` + `setTargetPoints()` yerinde çağırıyor. Uyarıcı abonelikleri
> ise `onLevelLoaded`'da: bus'ın sahibi `behaviorSubsystem` modül başlatmadan
> *sonra* kuruluyor, dolayısıyla `onRuntimeStart`'ta abone olmak mümkün değil.
>
> **Kabukta bilinçli kalanlar:** AI karakter animatörleri
> (`aiCharacterAnimators`, `registerAiCharacterAnimator`,
> `updateAiCharacterAnimations`) ve `ai.attack.intent` animasyon köprüsü.
> İkisi de `RuntimeCharacterRef` üzerinden çalışıyor — bu bir Game Mode tipi
> (Katman 3) — ve E/5'teki iskelet iliştirmesiyle aynı sınırda duruyor; Faz F
> Game Mode'u modüle çevirdiğinde bu kısıt kalkar.
>
> Modül kapalıyken hiçbir controller koşmaz: NPC entity'leri render edilir, fizik
> gövdeleri ve script'leri aynen çalışır, sadece karar üretmezler ve hareket
> çözücüye onlar için intent verilmez (I3).
>
> Yeni birim testi `tests/engine/aiModule.test.ts` (4 kontrol): `decision`
> slotuna kurulum + entity beslemesinden controller türetme + host'un nav
> dünyasını ve layout nav hacimlerini raporlama + seviye teardown'unda boşalma,
> altı uyarıcı mesaj tipine abonelik ve teardown'da bırakılması, bus'sız ve
> manifest'siz host'ta bozulmadan çalışma, ve host yokken hiçbir şeyin
> kaydolmaması.
>
> Kapılar: `build:verify` uçtan uca yeşil (**956/956 engine check**),
> `verify:imports` PASS, `verify:dist --strict` PASS. Browser: yedi smoke geçiyor
> — `ai-patrol`, `ai-navigation-clearance` (editör + runtime),
> `ai-navigation-volume`, `runtime-locomotion`, `runtime-playflow`,
> `runtime-script-message`.

> **Uygulama kaydı (2026-08-27, E/8 — audio modülü):** Runtime'ın ses üreten
> her parçası `capabilities/audioModule.ts`'e taşındı: `AudioSubsystem`
> (`presentation` slotu, mix bus'ları, uzamsal dinleyici, klip çalma), manifest
> `sound`/`soundCue` → URL çözümü, soundCue tanım önbelleği + graf değerlendirmesi,
> seviyenin `autoPlay` Audio bileşenleri ve dialogue'un ses tarafı.
> `RuntimeSceneApp`'ten `audioSubsystem`, üç URL/def haritası, `loadSoundCue`,
> `playDialogueAudio`, `playAutoPlayAudio(+Entity)` ve `resumeAudioOnFirstGesture`
> çıktı.
>
> **`dialogue-audio` sağlayıcısı kabuktan modüle geçti** — E/2'nin söz verdiği
> durum: `dialogueModule` onu zaten çağrı anında çözüyordu, tek satırı bile
> değişmedi.
>
> Modülün yayımladığı `audio-commands`: `bus` (behavior katmanının çaldığı düz
> yüzey), `prepareLevel(manifest)`, `playAutoPlay(document)`,
> `playEntityAudio(entity)` (runtime'da spawn olan aktör için),
> `setListenerPose`, `setBusVolume`/`getBusVolume`.
>
> **Zamanlama neden servis üzerinden:** URL çözümü ve auto-play, `onLevelLoaded`
> için fazla geç — bir script `startSceneRuntime` ile seviye hook'u arasındaki
> karelerde ses çalabilir. Bu yüzden ikisi de tam eski çağrı yerlerinde kalıyor
> (`populateAssetUrls` içinde `prepareLevel`, sahne kurulumunda `playAutoPlay`),
> yalnız sahibi değişti (AI'daki `prepareLevel` deseniyle aynı).
>
> **Kabukta bilinçli kalanlar:** (1) dinleyici pozu — kamera bu kare *hareket
> ettikten sonra* örneklenmeli, yoksa panning bir kare geriden gelir; kabuk
> `updateAudioListener()`'ı eski yerinde çağırıp modüle `setListenerPose` ile
> itiyor. (2) Oyuncunun kalıcı ses tercihi `userSettingsStore`'da; modül canlı
> mix'in sahibi, kaydedilmiş tercihin değil. `applyUserAudioSettings` artık
> `capabilities.runtimeStart`'tan *sonra* çağrılıyor (canlı bus'lar o an var).
>
> Behavior katmanı `AudioBus`'ı doğrudan almıyor: kabuk çağrı anında çözen ince
> bir adaptör veriyor (`behaviorAudioBus`), `play()` modülsüz runtime'da
> `silentAudioPlayback()` ile zaten durdurulmuş bir handle döndürüyor — çağıran
> hiçbir null kontrolü yapmıyor.
>
> Modül kapalıyken runtime sessiz: script'in `playSound`'u no-op, ambient emitter
> hiç başlamaz, dialogue satırı altyazısını metin-uzunluğu tahminiyle gösterir ve
> ayarlar ekranının ses kaydırıcıları dinleyeni olmayan bir tercihi kaydeder (I3).
>
> Yeni birim testi `tests/engine/audioModule.test.ts` (4 kontrol): `presentation`
> slotuna kurulum + iki yüzeyin yayımlanması + yalnız `autoPlay` işaretli
> emitter'ların başlaması + spawn yolunun aynı kapıdan geçmesi, dialogue'un iki
> kaynak türü (ham `sound` + fetch edilip değerlendirilen `soundCue`, ikinci
> satırda yeniden fetch etmeyen önbellek), mix'in seviyeye değil oturuma ait
> olması, ve modülsüz runtime'da her iki servisin de hiç var olmaması.
> `runtimeCapabilityModules.test.ts`'teki varsayılan tick sırası beklentisi
> `audio` ile güncellendi.
>
> Kapılar: `build:verify` uçtan uca yeşil (**960/960 engine check**),
> `verify:imports` PASS, `verify:dist --strict` PASS. Browser: beş smoke geçiyor
> — `runtime-playflow`, `runtime-locomotion`, `runtime-script-message`,
> `runtime-checkpoint`, `runtime-portal`.

> **Uygulama kaydı (2026-08-27, E/8'e ek — bozuk sound cue sağlamlaştırması):**
> E/8 sırasında görülen (ve taşımadan *önce* de var olan) bir kırılganlık
> kapatıldı: bozuk bir `*.soundcue.json`, `evaluateSoundCue` içinde fırlatıp
> `void loadSoundCue(...).then(...)` zincirinde **unhandled rejection**'a
> dönüşüyordu — eksik bir ses yerine ölü bir sekme.
>
> - `engine/audio/soundCueEvaluator.ts`'e `isSoundCueAsset()` eklendi:
>   değerlendiricinin ve `validateSoundCueGraph`'ın kontrolsüz dolaştığı yapıyı
>   (`output` nesnesi, `nodes`/`connections` dizileri, her düğümde string `id` +
>   bilinen `kind`) kapıda tutan sığ bir tip koruyucu. Grafın *anlamı* hâlâ
>   `validateSoundCueGraph`'ın işi.
> - `audioModule.loadSoundCue` artık parse sonrası bu kapıdan geçiriyor: geçmezse
>   cue id'siyle **bir kez** uyarır ve `null` olarak cache'ler.
> - Değerlendirme + tetikleme tek bir `fireSoundCue`'da toplandı (try/catch), ve
>   `playSoundCue` zincirine `.catch()` yedeği kondu: yapısal kapıyı geçen ama
>   değerlendiricinin takıldığı bir graf da yalnız kendi sesine mal olur.
> - Editör tarafı da aynı kapıya alındı: `soundCueStore.loadSoundCueAsset` yalnız
>   `schema`/`type` başlığına bakıyordu, kesilmiş bir dosya editörü düşürüyordu;
>   artık `isSoundCueAsset` başarısız olursa boş cue'ya düşüyor.
>
> Testler: `isSoundCueAsset` için engine kontrolü (evaluator'ın doğrudan
> dereference ettiği her şekil + "yapısal olarak cue ama çıkışsız" ayrımı) ve
> modül kontrolü "bozuk bir cue yalnız kendi sesine mal olur" (hiç çalmaz, adıyla
> bir kez uyarır, ikinci tetikte ne yeniden fetch ne yeniden uyarı, aynı
> seviyedeki sağlam cue etkilenmez). **962/962 engine check.**

> **Uygulama kaydı (2026-08-27, E/9 — vfx modülü, Faz E'nin sonu):** Partikül
> sisteminin tamamı `capabilities/vfxModule.ts`'e taşındı: `VfxSubsystem`
> (`presentation` slotu — tanım cache'i, instance havuzu, kalıcı efekt kabı,
> kare başına ilerletme ve one-shot geri dönüşümü), manifest `effect`/`texture`
> → URL çözümü, seviyenin `autoPlay` ParticleEmitter'ları ve kalite profilinin
> partikül yoğunluğu. `RuntimeSceneApp`'ten `vfxSubsystem`, iki URL haritası,
> `playAutoPlayParticles(+Entity)` ve `playActorParticleEffect` çıktı.
>
> **Yeni host servisi `vfx-host` — tek alan, ama neden seviye verisi değil:**
> efekt kabı (`vfx.root`) bir kez parent'lanır ve *her seviyeden uzun yaşar*
> (rebuild yalnız instance'ları temizler). Yani modülün sahneye seviye
> hook'undan önce, runtime kurulurken ihtiyacı var. Host yoksa modül hiçbir şey
> kaydetmez — efekti koyacak yer yok.
>
> Modülün yayımladığı `vfx-commands`: `prepareLevel(manifest)`,
> `playAutoPlay(document)`, `playAutoPlayEntity(entity)` (runtime'da spawn olan
> aktör) ve `triggerEntityEffect(entity)` (script'in `playParticleEffect`'i —
> `autoPlay` şartı aramaz, `enabled: false` ikisini de durdurur), ayrıca
> `setGlobalDensity` ve `debugSnapshot`. Kabuk `onActorParticleEffect`'te entity
> aramasını kendi yapıp entity'yi veriyor; `actorEntityById` kabuğun.
>
> Audio ile aynı zamanlama gerekçesi: URL çözümü ve auto-play eski çağrı
> yerlerinde kaldı (`populateAssetUrls` içinde `prepareLevel`, sahne kurulumunda
> `playAutoPlay`), çünkü `onLevelLoaded` bunlar için fazla geç.
>
> Modül kapalıyken emitter aktörleri hâlâ var, seçilebilir ve script'lerini
> çalıştırır; yalnız partikül olmaz, `?debug` boş bir VFX runtime'ı raporlar ve
> havuz/cache/kare-başına ilerletme maliyeti hiç ödenmez (I3).
>
> Yeni birim testi `tests/engine/vfxModule.test.ts` (4 kontrol): kabın bir kez
> parent'lanması + yalnız `autoPlay`+`enabled` emitter'ın spawn olması + tanımın
> yerleşim sayısından bağımsız bir kez warm edilmesi + teardown'da instance'ların
> durup cache'in sıcak kalması, script tetikleyicisinin `autoPlay` yolundan
> ayrılması, kalite yoğunluğunun efekti asla durdurmaması + bilinmeyen effect
> id'sinin cache'lenmiş bir ıska olması, ve sahnesiz runtime'da hiçbir şeyin
> kaydolmaması.
>
> Kapılar: `build:verify` uçtan uca yeşil (**966/966 engine check**),
> `verify:imports` PASS, `verify:dist --strict` PASS. Browser: beş smoke geçiyor
> — `runtime-playflow`, `runtime-locomotion`, `runtime-portal`,
> `runtime-checkpoint`, `runtime-script-message`.
>
> **Faz E kapandı.** §3 tablosundaki her baked subsystem artık bir Katman 2
> modülü; `RuntimeSceneApp` 5486 → 4717 satır. Kabukta bilinçli kalan üç
> bağ Faz F'nin konusu: AI karakter animatörleri + attack köprüsü, iskelet
> def'inin karaktere iliştirilmesi, ve Game Mode'un kendisi.

### Faz F — ForgeGameModule + createForgeRuntime (Katman 3 API)
- **İş:** `ForgeGameModule` arayüzü (`register(runtime)` / `onLevelLoaded(ctx)` /
  `start()` / `update(dt)` / `dispose()`) ve `createForgeRuntime({modules})`
  fabrikası. `RuntimeSceneApp` bu fabrikanın bir tüketicisine dönüşür (ya da
  fabrika onu sarar). `main.ts`, oyun modülü + varsayılan capability setini
  IoC ile enjekte eder (mevcut `setGameEditorCatalog` deseninin runtime eşleniği).
- **Dosyalar:** `src/scene/ForgeRuntime.ts` (fabrika + `use()`),
  `ForgeGameModule.ts` (arayüz), `main.ts` kompozisyon kökü güncellemesi.
- **Kabul:** Demo `createForgeRuntime` yolundan bootlar; `build:verify`+smoke yeşil.
  Hedef minimal kullanım çalışır:
  ```ts
  const forge = await createForgeRuntime({ modules: defaultRuntimeModules });
  forge.use(new DemoGameModule());
  await forge.loadLevel(startLevel);
  forge.start();
  ```

> **Uygulama kaydı (2026-08-27, F/1 — Katman 3 API):** `src/scene/ForgeGameModule.ts`
> (arayüz + `createGameModuleHost`) ve `src/scene/ForgeRuntime.ts`
> (`createForgeRuntime` + `use()` + `loadLevel()` + `start()` + `dispose()`).
> Fabrika şimdilik `RuntimeSceneApp`'i **sarıyor** (§8'deki öneri). Kabuk artık
> seviyeyi kendi kendine yüklemiyor: yeni `autoLoadLevel` seçeneği `false`
> geçilince yükleme `loadLevel()` ile açıkça sürülür, böylece oyun modülü ilk
> build'den önce kaydolur. `main.ts` yeni kompozisyon kökü.
>
> Yaşam döngüsü Katman 2 ile aynı kuralları izliyor (kurulum kayıt sırasında,
> yıkım ters sırada, hata karantinası) — fork'un iki farklı sözleşme öğrenmesine
> gerek kalmasın diye kasten aynı. Katman sırası: `onLevelLoaded` Katman 2'den
> **sonra**, `levelUnloaded`/`dispose` Katman 2'den **önce**, tick ise engine +
> capability + Game Mode'dan sonra (yazdığı alanlar aynı karede HUD'a akıyor).
> Yeni test `tests/engine/forgeGameModule.test.ts` (8 kontrol).
>
> **Uygulama kaydı (2026-08-27, F/2 — kabuk `@/game`'den kurtuldu):** Üç Katman 3
> kataloğu artık `src/game/gameModule.ts`'in yayımladığı servisler:
> `game-mode-provider` (hangi Game Mode'lar var + authored id nasıl çözülür),
> `behavior-registry-factory` (script id → update fonksiyonu, seviye başına
> yeniden kurulur) ve `ai-task-registry`. Yanında iki saf taşıma: Game Mode
> **sözleşmesi** `src/game/gameModes/types.ts` → `src/scene/gameModeTypes.ts`
> (kabuk ile Katman 3'ün ortak dili; implementasyonlar `src/game`'de kaldı),
> Player Start çözümü `playerSpawn.ts` → `engine/gameplay/playerSpawn.ts` (marker
> Katman 1), behavior host sözleşmesi → `engine/behavior/behaviorHost.ts`,
> giriş tuş haritası → `engine/input/defaultInputBindings.ts`.
>
> **Sıra tuzağı ve çözümü:** `use()` ile sonradan kaydedilen bir oyun modülü
> Katman 2'nin *start* anına yetişemez. Bu yüzden fabrika `gameModules` seçeneği
> alıyor ve kabuk onları `capabilities.runtimeStart()`'tan **hemen önce**
> kaydediyor; `ai-task-registry` gibi start anında okunan servisler böylece
> hazır (`AiHost.taskRegistry` de yakalanan değer değil, çağrı anında çözülen bir
> fonksiyon oldu). `use()` duruyor — sonradan kaydedilen modül ilk seviye
> build'inden itibaren görünür.
>
> Provider yoksa (oyun modülü kayıtlı değilse) **oturum hiç kurulmuyor**: seviye
> içeriği tam kuruluyor ve render ediliyor, kimse possess edilmiyor, kamera
> seviyenin bıraktığı yerde kalıyor (I1/I3). Behavior fabrikası yoksa authored
> `behavior` bileşenleri hiçbir şeye çözülmüyor, sahne yine kuruluyor.
> `verify:imports` artık `runtime -> game` importunu da yasaklıyor — kabuğun
> jenerikliği kapıyla korunuyor.
>
> **Uygulama kaydı (2026-08-27, F/3 — oyun kuralları Katman 3'e):** Skor,
> objective'ler, tur sayacı, kazanma/kaybetme ekranı ve restart düğmesi
> kabuktan çıktı: `src/game/gameRulesRuntime.ts`, oyun modülünün
> `onLevelLoaded`/`update`/`onLevelUnloaded` hook'larıyla sürülüyor ve dünyaya
> yalnız servisler üzerinden dokunuyor (`script-message-bus` → `game-event`,
> `ui-view-model` → `game.*` alanları, `runtime-ui-presenter` → outcome ekranı).
> Yeni servis `game-ui-message`: ayrılmış widget mesajı zincirinde Katman 3 ilk
> sırada denenir (`game:restart` / `game:resume`), sonra kabuğun platform
> mesajları (travel, save, ayarlar), kalanı gameplay'e `ui-action` olur.
>
> **Uygulama kaydı (2026-08-27, F/4 — Faz E'den kalan iki bağ):** AI karakter
> animatörleri + attack köprüsü yeni Katman 2 modülü
> `capabilities/aiCharacterAnimationModule.ts` oldu (crossfade animatörler,
> blend-space config, one-shot attack override, `ai.attack.intent` /
> `boss.attack.intent` abonelikleri). Kabuk yalnız `character-animation-host`
> yayımlıyor (mixer sink, kamera mesafesi, locomotion raporu, possessed pawn) ve
> Game Mode'un possess etmediği AI karakterini `registerAiCharacter` ile veriyor;
> modül kapalıysa kayıt reddediliyor ve karakter authored klibinde kalıyor.
> İskelet def'inin karaktere iliştirilmesi `skeletonLibrary.attachToCharacters`
> ile modüle geçti — kabukta yalnız *ne zaman* çağrıldığı kaldı (possess'ten
> önce, capability level hook'undan erken), audio/vfx'teki aynı desen.
> Yeni test `tests/engine/aiCharacterAnimationModule.test.ts` (6 kontrol).
>
> **Faz F kapandı.** `RuntimeSceneApp` 4717 → 4590 satır ve artık **hiç `@/game`
> importu yok**. Kapılar: `build:verify` uçtan uca yeşil (**980/980 engine
> check**), `verify:imports` PASS (yeni `runtime -> game` kuralıyla),
> `verify:dist --strict` PASS. Browser: sekiz smoke geçiyor — `runtime-playflow`,
> `runtime-locomotion`, `runtime-portal`, `runtime-checkpoint`,
> `runtime-script-message`, `ai-patrol`, `ai-navigation-clearance` (×2).

### Faz G — Serialization tek-kaynak + sessiz-kayıp uyarısı (I5)
- **İş:** `*.effect.json` desenini yaygınlaştır: `saveValidator.ts` içindeki
  `validate*` fonksiyonları mümkün olduğunca runtime normalizer'larını tek şekil
  kaynağı olarak kullansın. Bilinmeyen/desteklenmeyen alan → **sessiz düşürme
  yerine uyarı** (dev'de konsol + kaydetme öncesi rapor). Runtime da desteklemediği
  capability alanı için açık uyarı bassın (`Unsupported runtime capability: …`).
- **Dosyalar:** `tools/saveValidator.ts`, ilgili `engine/**/normalize*.ts`,
  runtime LevelRuntime uyarı yolu.
- **Kabul:** Yeni bir alan validator'a eklenmeden kaydedilince **uyarı görünür**
  (test); mevcut allowlist davranışı kırılmaz.

> **Uygulama kaydı (2026-08-27, G/1 — sessiz kayıp artık görünür):** Altmış
> `validate*` fonksiyonunu yeniden yazmak yerine **karşılaştırma** eklendi:
> `tools/droppedFields.ts` gönderilen gövde ile doğrulanmış çıktıyı gezip
> *inputta olup outputta olmayan* anahtarları yol olarak raporluyor
> (`layout.instances[0].glowIntensity`). Tek yönlü ve muhafazakâr: eklenen
> varsayılanlar, tip dönüşümleri ve yeniden sıralama raporlanmıyor (normalizer'ın
> işi); uzunluğu değişen dizi ise öğe öğe değil **adet** olarak bildiriliyor —
> reddedilen bir öğe sonraki tüm indeksleri kaydırdığı için pairwise
> karşılaştırma tüm kuyruğu yanlışlıkla "düştü" sayardı.
>
> Bağlandığı üç uç: `/__save-layout`, `/__save-skeleton`, `/__save-effect`.
> Sunucu konsola `[save] …` uyarısı basıyor **ve** yanıta `dropped: string[]`
> ekliyor; `layoutSaver` bunu `LayoutSaveResult.dropped` olarak taşıyor,
> `SceneApp.saveLayout` ise temiz "Saved" yerine **warning** durumu gösteriyor
> (`Saved playground.json — 2 unsupported field(s) dropped: …`). Yani kayıp artık
> hem kaydeden kişiye hem konsola görünüyor.
>
> Şablonun kendi seviyeleri dedektörde **temiz** çıkıyor (yanlış pozitif yok);
> `tests/engine/droppedFields.test.ts` (7 kontrol) bunu canlı bir regresyon
> kapısına çeviriyor: runtime'ın okuduğu ama validator'ın kopyalamadığı bir alan
> eklenirse `playground.json` testi düşer.
>
> **Uygulama kaydı (2026-08-27, G/2 — tek-kaynak yerine drift kapısı):** Planın
> "validate* runtime normalizer'ını kullansın" maddesi iskelet sidecar'ında
> **kasten uygulanmadı**: validator bozuk veriyi reddediyor (400), normalizer ise
> sessizce düzeltiyor; ikisini birleştirmek "mevcut allowlist davranışı
> kırılmaz" kuralını çiğner ve kaydetmeyi gevşetirdi. Bunun yerine drift
> mekanik olarak kapatıldı: `tests/engine/serializationDrift.test.ts` runtime
> normalizer'ının ürettiği maksimal şekli save validator'dan geçirip
> `collectDroppedFields`'in **boş** olmasını şart koşuyor (iskelet + effect),
> ayrıca kaydedilen dosyanın aynı runtime şekline geri normalize olduğunu
> doğruluyor. Tek tarafa alan eklenirse test tam yolu adıyla düşüyor. Layout
> tarafında aynı görevi `playground.json` kontrolü görüyor.
>
> **Uygulama kaydı (2026-08-27, G/3 — desteklenmeyen capability uyarısı):**
> `src/scene/capabilityCoverage.ts`, seviye kurulduktan sonra authored içerik ile
> kayıtlı capability modüllerini karşılaştırıp eksik olan her biri için tek satır
> basıyor:
> `Unsupported runtime capability: "vfx" is not registered, so 3 authored
> ParticleEmitter component(s) in this level do nothing.` Kurallar bileşen
> (`Audio`, `ParticleEmitter`, `AIController`, `CharacterMovement`,
> `MovingPlatform`, `SplinePathFollower`), behavior script id (`checkpoint`,
> `begin-conversation`) ve seviye ayarı (World Settings widget'ları) üzerinden
> çalışıyor. Bu bir hata değil, teşhis: capability'yi bilerek kapatan fork
> desteklenen şeyi yapıyor — mesaj yalnızca verinin **neden** ölü olduğunu
> söylüyor. `tests/engine/capabilityCoverage.test.ts` (6 kontrol) şablonun
> varsayılan setinin her kuralı kapattığını da doğruluyor, böylece mesaj gürültü
> hâline gelmiyor.
>
> **Faz G kapandı.** Kapılar: `build:verify` yeşil (**998/998 engine check**),
> `verify:imports` + `verify:dist --strict` PASS; browser: `editor-authoring`
> (Save Layout yolu) + `runtime-playflow` geçti, `public/` temiz kaldı.

### Faz H — RuntimeParity level + testler + game-starter (kanıt)
- **İş:**
  - `public/layouts/RuntimeParity.level.json`: landscape + 2 static mesh + 2
    material (+1 override) + directional light + env/render + gölge + VFX +
    collision'lı actor + animasyonlu obje + kamera başlangıcı.
  - Testler: (A) serialization round-trip semantic eşitlik; (B) LevelRuntime
    instantiation sayımları; (C) **editör build manifesti == runtime build
    manifesti** (Faz A testinin RuntimeParity ile pekişmişi); (D) Playwright
    browser smoke (render loop, kritik obje varlığı, exception yok).
  - `templates/game-starter/`: sıfır-gameplay minimal `GameApp` + `main.level.json`.
- **Kabul (Definition of Done):** Boş `game-starter`, RuntimeParity level'ını
  **hiç sahne-kurulum kodu yazmadan** açıp landscape/material/light/env/VFX/actor
  görüntüler. Yalnız kendi gameplay'ini ekler.

> **Uygulama kaydı (2026-08-27, H/1 — RuntimeParity fixture):**
> `public/layouts/RuntimeParity.level.json` + kendi yükseklik sidecar'ı
> `public/landscapes/runtime-parity.landscape.json` (65×65, iki paint katmanı).
> İçerik: landscape, iki statik mesh (`floor-400x400`, `pillar-50x500`), üç
> materyal ataması — aynı mesh'in iki yerleşimi farklı materyalle (per-placement
> override), gölge veren directional güneş + point fill, sky atmosphere +
> skyLightCapture + height fog + cloud layer + post process, auto-play partikül
> emitter'ı (`starter-fx-fire-loop`), `spin` behavior'lı animasyonlu obje,
> collision'lı yerleştirilmiş Actor Script (`Script_ParityProp.actor.json`, yeni
> starter asset) ve Player Start. **Bilerek gameplay yok:** `worldSettings.gameMode`
> yazılmadı, karakter yok — DoD'nin "sıfır-gameplay" iddiası şablonun kendi
> oyunuyla maskelenmesin diye.
>
> Fixture, kaydetme yolundan geçirilerek üretildi (`validateLayout` +
> `validateLandscapeData`) ve Faz G dedektörüyle doğrulandı; bu sırada dedektör
> iki gerçek bulgu verdi (varsayılan-değer eleme + uydurma `skyLightCapture.enabled`
> alanı) ve fixture düzeltildi.
>
> **Uygulama kaydı (2026-08-27, H/2 — testler A/B/C):**
> `tests/engine/runtimeParityLevel.test.ts` (8 kontrol).
> (A) **round-trip:** kaydetme sabit nokta — `validateLayout(saved) === saved` ve
> hiçbir alan düşmüyor (sidecar için de aynısı), yani editörde Save Layout bu
> fixture'ı aşındıramaz.
> (B) **instantiation:** türetilen scene document sayımları — yerleşim başına bir
> entity + ışıklar, 4 collider, 1 ParticleEmitter, 1 Behavior; ayrıca actor
> sınıfı `normalizeActorScriptDef` → `actorInstanceToEntity` ile çözülüp
> transform + mesh + collider taşıdığı doğrulanıyor.
> (C) **parity:** fixture'ın authored ettiği her özellik (`PARITY_FEATURES`
> tablosu) build manifestinde **paylaşılan level-content adımı** olmalı — yani
> bu level'da editör viewport'ta görünen her şeyi Play de aynı adımla kuruyor.
> Tablo aynı zamanda fixture'ın içeriğini de sabitliyor: biri landscape'i ya da
> materyal override'ını silerse test adıyla düşüyor.
>
> Bu arada Faz F'den kalan manifest kayması düzeltildi: `game-rules` adımı
> `ui-view-model-seed` oldu ve Katman 3 için `game-modules` adımı eklendi
> (kurallar artık oyun modülünde).
>
> **Uygulama kaydı (2026-08-27, H/3 — browser smoke):**
> `tests/smoke/runtime-parity.spec.ts` — smoke menüsüne eklenen "Parity" travel
> düğmesiyle **commit'lenmiş level'a olduğu gibi** gidiliyor (smoke onu yeniden
> yazmıyor). Kontroller: `"layout":"RuntimeParity"` yüklendi, sıfırdan büyük draw
> call + tris, `vfx active:≥1 alive:≥1`, `mode: Default Camera` +
> `possessed: none`, hiç `Unsupported runtime capability` uyarısı ve hiç sayfa
> hatası yok.
>
> **Uygulama kaydı (2026-08-27, H/4 — game-starter + DoD kanıtı):**
> `templates/game-starter/` = `main.ts` (üç çağrı: `createForgeRuntime` →
> `loadLevel` → `start`, artı `?debug` overlay'i), `main.level.json` (parity
> fixture'ının starter adıyla kopyası), `index.html`, `README.md`. `tsconfig`
> `templates`'i de tipliyor, böylece starter çürüyemez; iki birim kontrolü
> starter'ın level'ının parity fixture'ıyla eşit kaldığını ve `main.ts`'in
> **yalnız** kompozisyon + debug importları taşıdığını (three/engine/sahne
> kurucusu yok) doğruluyor.
>
> **Faz H'de bulunan bir sessizlik daha kapatıldı:** oyun modülü olmayan bir
> runtime'da authored `Behavior` script'leri hiçbir şeye çözülmüyor (katalog
> Katman 3). Artık seviye kurulumunda uyarı basılıyor —
> `No behavior catalog registered: N authored behavior script(s) …` — yani
> starter'daki dönen küpün neden durduğu konsolda yazıyor
> (`capabilityCoverage.ts`, `hasBehaviorRegistry`).
>
> **DoD tarayıcıda kanıtlandı:** `tests/smoke/game-starter.spec.ts` starter'ın
> kendi sayfasını açıyor (`/templates/game-starter/index.html?debug`, level
> README'deki adımla `public/layouts/`'a kuruluyor) ve seviye tam olarak
> render ediliyor: draw call/tris > 0, partikül canlı, **hiç oyun modülü yok** →
> `mode: —`, `possessed: none`. Yani sıfır-gameplay bir uygulama, tek satır
> sahne-kurulum kodu yazmadan landscape/materyal/ışık/env/VFX/actor görüyor.
>
> **Faz H kapandı.** Kapılar: `build:verify` uçtan uca yeşil (**1007/1007 engine
> check**), `verify:imports` + `verify:dist --strict` PASS, `check:assets` PASS.
> Browser: **tüm paket 33/33** (`npm run smoke:browser`; iki yeni spec dahil).
> Not: paket koşarken kaynak dosyası düzenlemeyin — Vite HMR koşan spec'i yeniden
> yükletiyor ve `editor-authoring` bu yüzden bir kez zaman aşımına uğradı, temiz
> tekrar koşumda geçti.

### Faz I — RTS doğrulama vakası (isteğe bağlı ama önerilen)
- **İş:** Karaktersiz, tepeden bakışlı bir örnek: `rtsCameraGameMode` (edge-pan +
  zoom + seçim iskeleti) + character/skeletal modüllerini kapatan bir modül seti.
  Bu, planın gerçek RTS acısını çözdüğünü kanıtlar (RtsApp'e gerek kalmadan).
- **Dosyalar:** `src/game/gameModes/rtsCameraGameMode.ts` (şablon örneği) veya
  `templates/game-starter` varyantı.
- **Kabul:** Aynı LevelRuntime, karaktersiz modül setiyle sahneyi tam kurar;
  hiçbir sahne özelliği elle yeniden bağlanmaz.

---

## 5. Fazlar Arası Bağımlılık & Sıra

```
A (ölçüm) ──▶ B (shell) ──▶ C (LevelRuntime, tek pipeline) ──▶ D (modül iskelet)
                                              │
                                              ▼
                              E (baked → modül) ──▶ F (ForgeGameModule API)
                                              │
                                              ▼
                              G (serialization) ──▶ H (parity test + starter) ──▶ I (RTS vaka)
```

- A ve B düşük riskli; ilk oturumda güvenle yapılır.
- C en ağır faz; alt-adımlara bölünmeli, her adımda A testi drift'i yakalar.
- E modül modül ilerler; her modül ayrı commit.
- G, C/E'den bağımsız ilerleyebilir (paralelleştirilebilir).

---

## 6. Güvenlik Kuralları (her fazda)

- **Küçük, build-passing adımlar.** Büyük rewrite yok (I6). Her commit sonrası
  gate yeşil.
- **Demo bozulmaz.** Her faz sonunda `/` (TPS demo) + `/?editor` bootlar;
  `npm run smoke:browser` yeşil.
- **Boundary gate'leri.** `verify:imports` (editör `@/game` import etmez;
  LevelRuntime/capability katmanları `game`'i import etmez) + `verify:dist`
  (yeni editor-only semboller `FAIL_TOKENS`'a eklenir) yeşil (I7).
- **Save-validator allowlist.** Yeni layout/actor/singleton alanı eklenince
  `tools/saveValidator.ts`'e eklenmezse sessizce düşer — CLAUDE.md'deki üç yüzey
  uyarısı geçerli; Faz G bunu uyarıya çevirene dek elle dikkat.
- **Otomatik commit.** Kullanıcı yetki verdiyse her yeşil adım commit+push
  edilir (bkz. memory: auto-commit-large-refactors).

---

## 7. Definition of Done

1. Editör viewport ve Play **tek** LevelRuntime pipeline'ını kullanır; ikiz
   `build*`/`apply*` metotları kalmaz (I2, Faz A testiyle korunur).
2. ✅ Bir fork, `createForgeRuntime({modules, gameModules})` ile kurulur;
   `LevelRuntime`/`RuntimeSceneApp` fork tarafından **düzenlenmez** (I4, Faz F).
3. Capability'ler opt-in; bir modül kapatılınca yalnız o davranış gider, sahne
   içeriği hep görünür (I3).
4. ✅ Sıfır-gameplay `game-starter`, RuntimeParity level'ını ek sahne kodu
   olmadan çalıştırır (Faz H; `tests/smoke/game-starter.spec.ts` tarayıcıda
   doğruluyor).
5. Karaktersiz RTS senaryosu ek entegrasyon olmadan sahneyi tam kurar (Faz I).
6. ✅ Bilinmeyen alan sessizce düşmez; uyarı üretir (I5, Faz G).
7. Tüm gate'ler yeşil: `build:verify` (`tsc` + `vite build` + `test:engine` +
   `verify:dist --strict`) + `check:assets` + `smoke:browser`.

---

## 8. Açık Kararlar (uygulama oturumunda netleşecek)

- **`LevelRuntime` yeni sınıf mı, yoksa `SceneRuntimeCore`'un genişletilmişi mi?**
  Öneri: yeni sınıf; `SceneRuntimeCore` saf yardımcılar olarak altında kalır.
- **`RuntimeSceneApp` korunacak mı, `ForgeRuntime` fabrikası mı sarar?** Öneri:
  önce fabrika `RuntimeSceneApp`'i sarar (Faz F), sonra gerekiyorsa içi boşaltılır.
- **Capability ↔ Game modülü sınırı:** behavior/AI çekirdeği Katman 2; kurallar
  Katman 3. Kesişimler `RuntimeContext` ile gevşek bağlanır.
- **Editör authoring modülleri:** Katman 2 modülleri editör viewport'ta preview
  gerektiriyor mu (ör. dialogue tetikleyici)? Şimdilik hayır; runtime-only kalır.

---

## 9. İlk Oturum İçin Başlangıç Noktası

Yeni oturumda sırayla:
1. Bu planı ve `AUDIT.md`'yi oku.
2. **Faz A**'yı uygula (build manifest + parity test) — düşük risk, sonraki her
   şeyin güvenlik ağı.
3. **Faz B** (SceneShell) — küçük, izole.
4. **Faz C**'ye alt-adımlarla gir (env/render grubu ilk).

> Her adımda gate yeşil tut; demo + editör bootlamaya devam etsin; büyük tek
> seferlik rewrite yapma.
