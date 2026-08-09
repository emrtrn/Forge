# Forge Runtime Parity — Faz 0 Denetim Raporu (AUDIT)

> Tarih: 2026-08-09
> Kapsam: **Yalnızca haritalama.** Kod değiştirilmedi.
> Kaynak plan: [`docs/planned/FORGE_RUNTIME_EDITOR_PARITY_PLAN.md`](../planned/FORGE_RUNTIME_EDITOR_PARITY_PLAN.md) (§5, Faz 0)
> Yöntem: `src/main.ts`, `src/scene/*`, `src/editor/*`, `engine/scene/*`,
> `tools/saveValidator.ts` üzerinde statik okuma + grep. Satır referansları bu
> commit'e göredir; yeniden düzenlemede kayabilir.

---

## 0. Yönetici Özeti (önce bunu oku)

Sınır Krallıkları (RTS) sırasında yaşanan "Editor'da var, oyunda yok" sorununun
kök nedeni, planın varsaydığı **"Editor Play ile Game Play iki ayrı sahne"**
durumu **değildir**. Forge'da durum daha incedir:

1. **Play zaten tektir.** Editör "Play" butonu in-viewport bir PIE modu değil;
   layout'u kaydedip runtime rotasını (`/`) yeni sekmede açar
   ([`EditorUi.ts:1264-1283`](../../src/editor/EditorUi.ts#L1264)). Runtime rotası
   = `RuntimeSceneApp`. Yani **Editor Play ve standalone Game Play aynı
   `RuntimeSceneApp` kodunu çalıştırır** — bu eksende ayrışma yoktur.

2. **Asıl ayrışma iki yerdedir:**
   - **(A) Editör viewport ↔ Runtime.** Editörde gördüğün canlı sahneyi
     `SceneApp` (12.771 satır) kurar; oyunun çalıştırdığı sahneyi
     `RuntimeSceneApp` (5.651 satır) kurar. İkisi **ayrı orkestrasyon** yürütür,
     yalnızca yardımcı fonksiyonları (`SceneRuntimeCore.ts`, 1.042 satır)
     paylaşır. Aynı capability iki dosyada iki ayrı metotla kurulur
     (`applySkyAtmosphere` ↔ `applyRuntimeSky`, `buildLandscapes` ↔
     `buildRuntimeLandscapes`…). Bu "iki loader zamanla ayrışır" durumunun ta
     kendisidir (planın §13.3'te yasakladığı desen zaten kısmen mevcut).
   - **(B) Fork'un kendi app'i ↔ Forge runtime.** Forge deposunda `RtsApp`/
     `GameApp` **yoktur** — RTS'i fork'unda kendi uygulama kabuğunla kurmuşsun.
     Forge'un genişletme modeli `RuntimeSceneApp`'i **miras alıp `src/game`
     üzerinden** özelleştirmektir; `RuntimeSceneApp`'i baypas eden ayrı bir app
     yazıldığında `buildScene` içindeki bütün capability kablolaması
     (landscape/material/light/vfx…) kaybolur ve her biri elle yeniden bağlanmak
     zorunda kalır. Yaşadığın "iki kat iş" büyük olasılıkla buradan geldi.

3. **`RuntimeSceneApp.buildScene` aslında eksiksize yakındır.** Landscape,
   material override, ışık, sky/fog/cloud, reflection (planar/probe/surface),
   post-process, blocking volume, spline, foliage, collision, AI, dialogue,
   audio, particle, UI hepsini kurar ([`RuntimeSceneApp.ts:2176-2319`](../../src/scene/RuntimeSceneApp.ts#L2176)).
   Yani platformun runtime'ı zaten güçlü; **sorun kapsam değil, yeniden
   kullanılabilirlik ve tek-kaynak (single source) eksikliğidir.**

**Sonuç:** Planın hedefi doğru ama vurgu kayması gerekiyor. Kritik iş
Faz 2/3 (tek canonical loader + registry) ve Faz 5 (Game Extension API) —
"editör viewport ve runtime aynı orkestrasyonu paylaşsın" + "fork gameplay'i
`RuntimeSceneApp`'i kopyalamadan üstüne eklesin". Faz 6 parite alanlarının
çoğu Forge çekirdeğinde **zaten çalışıyor** (aşağıdaki tabloya bak); asıl
regresyon riski ikilenmiş orkestrasyonun sessizce ayrışmasıdır.

---

## 1. Sistem Haritası

### 1.1 Giriş noktaları — `src/main.ts`

| Rota | Sınıf | Not |
|---|---|---|
| `/` (varsayılan) | `RuntimeSceneApp` | Oyun runtime'ı. Play de buraya gelir. |
| `/?editor` (yalnız DEV) | `SceneApp` + `EditorUi` | Editör; dinamik import, prod bundle'a girmez. |
| `?debug` | (her iki modda) | Perf overlay. |

Editör kompozisyon kökü `main.ts:30-55`: `setGameEditorCatalog(GAME_EDITOR_CATALOG)`
ile oyun katalogları editöre **enjekte edilir** (editör `@/game` import etmez —
`verify:imports` bunu zorlar). Bu IoC deseni sağlıklı; genişletme için model bu.

### 1.2 Üç sahne dosyası

| Dosya | Satır | Rol |
|---|---:|---|
| [`src/scene/SceneApp.ts`](../../src/scene/SceneApp.ts) | 12.771 | **Editör kabuğu.** Authoring + canlı viewport + kendi sahne kurulumu. |
| [`src/scene/RuntimeSceneApp.ts`](../../src/scene/RuntimeSceneApp.ts) | 5.651 | **Oyun kabuğu.** Play/game sahne kurulumu + gameplay subsystem'leri. |
| [`src/scene/SceneRuntimeCore.ts`](../../src/scene/SceneRuntimeCore.ts) | 1.042 | **Paylaşılan yardımcılar.** Tek bir orkestratör DEĞİL; saf fonksiyon topluluğu. |

`SceneRuntimeCore` şunları paylaştırır: renderer/scene/camera kurulumu,
`resolveSceneWorldSettings`, `ensureDefaultSceneLights`,
`applySceneBackgroundAndAmbient`, `buildSceneInstancedModel`,
`buildSceneCharacterObject`, `buildSceneLightObject`, `computeModelLocalBounds`,
`registerSceneShapeModels`, `buildSceneEntities`, `startSceneRuntime`, spline/
landscape mesh deform yardımcıları. Yorumlarda tekrarlanan
*"the exact order both shells use"* / *"mirrors the editor's material-override
path"* ifadeleri paritenin **elle** korunduğunu itiraf eder — sözleşmeyle değil.

### 1.3 Level yükleme & serialization zinciri

```
public/<scene>.level.json
        │  loadRoomLayout()  (src/scene/roomLayout.ts:37)
        ▼
   RoomLayout  (in-memory authoring modeli)
        │  roomLayoutToSceneDocument()  (engine/scene/legacyRoomLayoutAdapter.ts:204)
        ▼
   SceneDocument { entities[] }  → physics + behavior + ai subsystem'leri
```

Kaydetme yolu: `/__save-layout` → `tools/saveValidator.ts` (4.169 satır)
allowlist doğrulaması → diske yazım. **Allowlist'te olmayan alan sessizce
düşer** (CLAUDE.md'de üç ayrı allowlist yüzeyi uyarısı var). Bu, planın §7'de
işaret ettiği "sessiz veri kaybı" riskinin somut mekanizmasıdır.

---

## 2. İki Orkestrasyon Yan Yana (asıl bulgu)

Aynı Level'ı iki dosya bağımsız kurar. Aşağıda editörün
`SceneApp.loadActiveProjectScene` ([3106](../../src/scene/SceneApp.ts#L3106)) ile
runtime'ın `RuntimeSceneApp.buildScene` ([2176](../../src/scene/RuntimeSceneApp.ts#L2176))
adım karşılaştırması:

| Adım | Editör (`SceneApp`) | Runtime (`RuntimeSceneApp`) | Durum |
|---|---|---|---|
| Layout yükle | `loadRoomLayout` | `loadRoomLayout` | ✅ paylaşılan fn |
| MeshPaint | `loadMeshPaintData` | `loadMeshPaintData` | ✅ |
| World settings / gravity | `resolveSceneWorldSettings` | `resolveSceneWorldSettings` (+killZ) | ✅ |
| Varsayılan ışık | `ensureDefaultLights` | `ensureDefaultLights` | ✅ |
| Actor sınıfları | `loadActorInstances` | `resolveActorClasses` + `loadActorMeshModels` | ⚠️ ayrı impl |
| Model yükleme | `loadGroups`+`loadMissingSceneModels` | aynı + `collectExpectedModelIds` (loading bar) | ⚠️ runtime fazla |
| Shape modelleri | `registerShapeModelsFromLayout` | `registerSceneShapeModels` | ⚠️ ayrı isim |
| UVW / material | `refreshAssetUvwMapping` + `refreshAssetMaterialSlots` | `applyAssetUvwMappings` + `loadSceneMaterials` | ❗ **ayrı impl, aynı amaç** |
| Instances/char/light | `buildSceneEntities(...)` | `buildSceneEntities(...)` (marker'ları atlar) | ⚠️ handler farkı |
| Sun shadow / arka plan | `fitSunShadowToScene` / `applyBackgroundAndAmbient` | aynı | ✅ |
| Sky / Fog / Cloud | `applySkyAtmosphere`/`applyHeightFog`/`applyCloudLayer` | `applyRuntimeSky`/`applyRuntimeFog`/`applyRuntimeClouds` | ❗ **paralel ikiz metot** |
| Reflection (env) | `applyReflection` | `applyRuntimeReflection` | ❗ ikiz |
| Post-process | `applyPostProcess` | `applyRuntimePostProcess` | ❗ ikiz |
| Reflection planes/surfaces/captures | `buildReflectionPlanes`/`buildReflectiveSurfaces`/`buildReflectionCaptures` | `buildRuntimeReflectionPlanes`/`…Surfaces`/`…Captures` | ❗ ikiz |
| Blocking volumes | `buildBlockingVolumes` | `buildRuntimeBlockingVolumes` | ❗ ikiz |
| Splines | `buildSplines` | `buildRuntimeSplines` | ❗ ikiz |
| Landscape | `buildLandscapes` | `buildRuntimeLandscapes` (+ `buildRuntimeLandscapeSplineMeshes`) | ❗ ikiz |
| Foliage | `buildFoliage` | `buildRuntimeFoliage` | ❗ ikiz |
| **Sıralama** | sky→post→fog→cloud→reflection→captures | sky→reflection→post→fog→clouds→captures | ❗ **sıra farklı** (reflection capture bake'i sıraya duyarlı) |

Editöre özel (viewport authoring): `buildAiNavigationVolumes`, `buildTargetPoints`,
`buildWorldWidgetMarkers`, `emit*Changed` event'leri, tüm `refresh*` canlı-düzenleme
metotları.

Runtime'a özel (gameplay): `loadCollisionDefs`, `roomLayoutToSceneDocument` →
physics/behavior/ai `startSceneRuntime`, `playAutoPlayAudio`,
`playAutoPlayParticles`, `loadCharacterSkeletons`, `startGameMode`,
`setupRuntimeUi`, `setupDialogue`, `applyQualitySettings`, `warmRuntimeShaders`.

> **Kritik risk:** Yeni bir genel sahne özelliği eklendiğinde geliştirici
> **iki dosyada iki ikiz metot** yazmayı ve **sıralamayı** doğru tutmayı
> hatırlamak zorunda. Biri unutulursa "editörde görünür, Play'de yok" (ya da
> tersi) hatası doğar. Otomatik bir kapı yok.

---

## 3. Capability Parite Tablosu

Sütunlar: **Authoring** (editörde oluşturulabilir/düzenlenebilir mi) ·
**Saved** (validator allowlist'inde, diske yazılıyor mu) ·
**Editör Viewport** (canlı viewport'ta görünür mü) ·
**Runtime/Play** (`RuntimeSceneApp` kuruyor mu) ·
**Tek-kaynak** (editör+runtime aynı orkestrasyonu mu kullanıyor).

| Capability | Authoring | Saved | Editör Viewport | Runtime/Play | Tek-kaynak |
|---|:---:|:---:|:---:|:---:|:---:|
| Static Mesh / Instance | ✓ | ✓ | ✓ | ✓ | ⚠️ ikiz orkestrasyon |
| Shape (procedural) | ✓ | ✓ | ✓ | ✓ | ⚠️ |
| Material override / slots | ✓ | ✓ | ✓ | ✓ | ❗ ayrı impl (`refreshAssetMaterialSlots` ↔ `loadSceneMaterials`) |
| UVW mapping | ✓ | ✓ | ✓ | ✓ | ❗ ayrı impl |
| Character (skeletal) | ✓ | ✓ | ✓ (mixer preview) | ✓ | ⚠️ |
| Light actor | ✓ | ✓ | ✓ | ✓ | ✅ (`buildSceneLightObject`) |
| Background / Ambient | ✓ | ✓ | ✓ | ✓ | ✅ (`applySceneBackgroundAndAmbient`) |
| Sky Atmosphere | ✓ | ✓ | ✓ | ✓ | ❗ ikiz |
| Height Fog | ✓ | ✓ | ✓ | ✓ | ❗ ikiz |
| Cloud Layer | ✓ | ✓ | ✓ | ✓ | ❗ ikiz |
| Reflection (Sky Light env) | ✓ | ✓ | ✓ | ✓ | ❗ ikiz |
| Reflection Plane (planar) | ✓ | ✓ | ✓ | ✓ | ❗ ikiz |
| Reflective Surface | ✓ | ✓ | ✓ | ✓ | ❗ ikiz |
| Sphere Reflection Capture | ✓ | ✓ | ✓ | ✓ | ❗ ikiz (+ sıra farkı) |
| Post-Process | ✓ | ✓ | ✓ | ✓ | ❗ ikiz |
| Landscape (terrain) | ✓ | ✓ | ✓ | ✓ | ❗ ikiz |
| Landscape spline mesh (yol) | ✓ | ✓ | ✓ | ✓ | ❗ ikiz |
| Foliage | ✓ | ✓ | ✓ | ✓ | ❗ ikiz |
| Spline actor + generatörler | ✓ | ✓ | ✓ | ✓ | ❗ ikiz |
| Blocking Volume | ✓ | ✓ | ✓ | ✓ | ❗ ikiz |
| Collision (preset/override) | ✓ | ✓ | ⚠️ debug wire | ✓ (physics) | ⚠️ runtime-only fizik |
| Actor Script (component) | ✓ | ✓ | ⚠️ mesh preview | ✓ (behavior/gameMode) | ⚠️ |
| Animation (locomotion/montage) | ✓ | ✓ | ⚠️ tek klip preview | ✓ (tam sistem) | ⚠️ runtime zengin |
| VFX / Particle | ✓ (ayrı editör) | ✓ (emitter+asset) | ❌ **viewport'ta oynamaz** | ✓ (`playAutoPlayParticles`) | ❗ editör preview yok |
| Ambient Sound | ✓ (gizmo) | ✓ | ❌ (yalnız ikon) | ✓ (`playAutoPlayAudio`) | ❗ |
| Sound Cue | ✓ (ayrı editör) | ✓ | ❌ | ✓ | ❗ |
| Dialogue / Conversation | ✓ (ayrı editör) | ✓ | ❌ | ✓ (`setupDialogue`) | ❗ |
| AI Navigation Volume | ✓ | ✓ | ✓ (debug) | ✓ (nav mesh) | ⚠️ |
| Target Points | ✓ | ✓ | ✓ | ✓ (aiSubsystem) | ⚠️ |
| MeshPaint | ✓ | ✓ (sidecar) | ✓ | ✓ | ⚠️ |
| World Widgets (3D UI) | ✓ (marker) | ✓ | ⚠️ marker | ✓ (runtime UI) | ⚠️ |
| Game Mode / Rules | ✓ (data) | ✓ | ❌ | ✓ (`startGameMode`) | — (yalnız runtime, doğru) |

Efsane: ✅ ortak kaynak · ⚠️ paylaşılıyor ama farkla · ❗ ikiz kod / preview boşluğu · ❌ yok.

> **Not:** "❌ Editör Viewport" çoğu satırda **beklenen ve doğru** davranıştır
> (VFX/ses/diyalog gameplay olayıdır; ayrı asset editörlerinde düzenlenir).
> Sorun bunların viewport'ta olmayışı değil, **runtime kurulumunun ayrı bir
> kod yolunda olması** — bir fork kendi app'ini yazınca bunları kaybeder.

---

## 4. Serialization & Save-Validator Yüzeyi

- **Ana level yolu:** `/__save-layout` → `saveValidator.ts` içindeki
  `validatePlacement`/`applyTransformFields`/`validateLightActor`/
  `validateReflectionPlane`/`validateReflectiveSurface`/`validateLandscape`/
  `validateBlockingVolume`/`validateSpline`/`validateSkyAtmosphere`/
  `validateHeightFog`/`validateCloudLayer`/`validateReflection`/
  `validatePostProcess`/`validateWorldSettings`/`validateGameRules` …
- **İki ek sidecar yüzeyi:** `*.skeleton.json` (`validateAssetSkeletonDef`) ve
  `*.effect.json` (`validateEffectAsset` → runtime normalizer'ı yeniden kullanır).
- **Risk:** Yeni alan üç yerde de senkron tutulmalı — aksi halde **kaydederken
  sessizce düşer** (CLAUDE.md bunu üç kez uyarıyor). Bu, planın §7
  "unsupported field → açık uyarı" hedefinin henüz karşılanmadığını gösterir:
  şu an davranış *sessiz düşürme*.
- **İyi haber:** `*.effect.json` doğrulaması runtime normalizer'ı
  (`normalizeEffectDefinition`) tek kaynak olarak kullanıyor — planın §11'de
  istediği "tek şekil kaynağı" deseninin **doğru örneği**. Aynı desen diğer
  validate* fonksiyonlarına yayılabilir.

---

## 5. Bulgular (öncelik sırasıyla)

1. **[Yüksek] İkilenmiş sahne orkestrasyonu.** ~15 capability editör + runtime'da
   ayrı ikiz metotlarla kuruluyor (§2 tablosu). Sözleşme yok, otomatik kapı yok;
   parite elle korunuyor. → Planın **Faz 2 + Faz 3**'ünün gerçek hedefi.

2. **[Yüksek] Fork yeniden kullanım modeli zayıf.** `RuntimeSceneApp` bir monolit;
   TPS karakter, dialogue, save-game, UI, AI baked. RTS gibi farklı bir tür için
   temiz bir "üstüne gameplay ekle" API'si yok (`ForgeGameModule` yok). Fork,
   ya monoliti düzenlemek ya da baypas edip her şeyi yeniden bağlamak zorunda. →
   Planın **Faz 5** (Game Extension API) + **Faz 4** (SceneApp/Runtime rol
   sınırı).

3. **[Orta] Sıralamaya duyarlı ikizler.** Sky/reflection/post/fog/cloud +
   reflection-capture bake sırası iki dosyada farklı. Görsel parite kırılganlığı.

4. **[Orta] Sessiz veri kaybı mekanizması aktif.** Save-validator allowlist'i
   dışı alanlar uyarısız düşüyor. Runtime da desteklemediği alan için uyarı
   üretmiyor. → Planın **Faz/§7** hedefi henüz yok.

5. **[Düşük/Doğrulanmış OK] Play birleşik.** Editor Play → `/` → `RuntimeSceneApp`.
   Bu eksende ek iş gerekmez; plan metni (§4 "Editor Play ile Game Play")
   güncellenmeli.

6. **[Düşük] Tek-kaynak deseni zaten var (effect).** `*.effect.json`
   doğrulaması runtime normalizer'ını yeniden kullanıyor — yaygınlaştırılacak
   referans desen.

---

## 6. Öneriler → Plan Fazlarına Eşleme

| Plan Fazı | Bu denetimin gösterdiği gerçek iş |
|---|---|
| **Faz 1 — Contract** | Invariant'ı testle: "editör viewport ve runtime **aynı** build listesini üretir." Kod eklemeden, önce `SceneApp` ve `RuntimeSceneApp` build adım listelerini tek bir sıralı manifest'e çıkar. |
| **Faz 2 — Canonical loader** | Yeni bir `LevelRuntime` çıkar: §2'deki ikiz `build*`/`apply*` metotlarını **tek sıralı pipeline**'a taşı. Editör ve runtime bu pipeline'ı çağırır; farkları "mode: editor \| runtime" bayrağı + handler'larla ver (SceneRuntimeCore zaten bu deseni `buildSplineInstanceGeneratorGroup(mode)` ile başlatmış). |
| **Faz 3 — Registry/Factory** | Her capability için `register("landscape", …)` tarzı tek kayıt. Yeni özellik = 1 authoring + 1 serialize + 1 factory; ikiz metot yasak. |
| **Faz 4 — SceneApp rolü** | `SceneApp`'ten sahne-kurulum mantığını `LevelRuntime`'a boşalt; `SceneApp` yalnız authoring/gizmo/seçim kabuğu kalsın. |
| **Faz 5 — Game Extension API** | `ForgeGameModule` (register/onLevelLoaded/start/update/dispose). `RuntimeSceneApp`'in gameplay kısımlarını (TPS, dialogue, save) modüllere ayır; fork monoliti düzenlemeden `runtime.use(new MyGameModule())` yapabilsin. **RTS deneyiminin asıl ilacı budur.** |
| **§7 — Serialization güvenliği** | `effect` desenini yaygınlaştır: validator'lar runtime normalizer'ını tek kaynak alsın; bilinmeyen alan → sessiz düşürme yerine uyarı. |
| **Faz 8-9 — Parity test** | `RuntimeParity.level.json` + "editör build manifesti == runtime build manifesti" testi (ikiz drift'i CI'da yakalar). |
| **Faz 10 — game-starter** | Faz 5 bitince minimal `templates/game-starter/` gerçekten küçük olur. |

---

## 7. Sıradaki Adım

Faz 0 tamamlandı. Önerilen ilerleyiş:
- **Faz 1**'e geç: iki kabuğun build adım listelerini tek bir "build manifest"
  olarak çıkar ve invariant'ı doküman + test taslağı olarak sabitle. (Hâlâ
  düşük riskli, çoğu okuma.)
- Paralel olarak, en yüksek getirili yatırım **Faz 5 (Game Extension API)**
  tasarımı — çünkü fork yeniden-kullanım boşluğu, RTS'te iki kat işe yol açan
  asıl nedendi.

> Bu rapor kod değiştirmedi. Kod değişikliği Faz 2+ ile başlar ve her adımda
> `npx tsc --noEmit` + `npm run test:engine` + gerektiğinde `npm run build:verify`
> yeşil kalmalı; büyük tek-seferlik rewrite yapılmamalı (plan §15).
