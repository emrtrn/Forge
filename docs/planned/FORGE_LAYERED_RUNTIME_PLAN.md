# Forge Katmanlı Runtime Planı
## LevelRuntime · Capability Modülleri · Game Modülü

> Tarih: 2026-08-09
> Durum: **Uygulanıyor.** Faz A–D kodu tamamlandı. Faz B/C runtime warm-up browser kabulü açık; sıradaki uygulama fazı E (baked subsystem'leri modüle taşıma).
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
| `characterMovementSubsystem` | **2** | `characterMovementModule` (opt-in) |
| `movingPlatformSubsystem`, `splinePathFollowerSubsystem` | **2** | modüller (opt-in) |
| `aiSubsystem` + `loadAiAssets` + nav | **2** | `aiModule` (opt-in) |
| `setupDialogue` + `loadDialogueAssets` | **2** | `dialogueModule` (opt-in) |
| `saveCoordinator` (`RuntimeSaveCoordinator`) | **2** | `saveGameModule` (opt-in) |
| `setupRuntimeUi` + widget/locale/theme yükleme | **2** | `runtimeUiModule` (opt-in) |
| `loadCharacterSkeletons` | **2** | `skeletalAnimationModule` (opt-in) |
| `playAutoPlayAudio` / `playAutoPlayParticles` | **2** | `audioModule` / `vfxModule` (opt-in; auto-play hook) |
| `startGameMode` + `gameModes/registry` | **3** | Game modülü zaten burada; genişletilir |
| `behaviorSubsystem` + `createSceneBehaviorRegistry` | **2/3** | Behavior çekirdeği modül; kurallar fork'ta |
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
2. Bir fork, `createForgeRuntime({modules})` + `runtime.use(gameModule)` ile
   kurulur; `LevelRuntime`/`RuntimeSceneApp` fork tarafından **düzenlenmez** (I4).
3. Capability'ler opt-in; bir modül kapatılınca yalnız o davranış gider, sahne
   içeriği hep görünür (I3).
4. Sıfır-gameplay `game-starter`, RuntimeParity level'ını ek sahne kodu olmadan
   çalıştırır (Faz H).
5. Karaktersiz RTS senaryosu ek entegrasyon olmadan sahneyi tam kurar (Faz I).
6. Bilinmeyen alan sessizce düşmez; uyarı üretir (I5, Faz G).
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
