# FORGE — WORLD ENVIRONMENT SYSTEM (WES)
## Mevsimler, hava, gün–gece döngüsü, kar/ıslaklık örtüsü ve mevsimsel varlık dönüşümü

**Belge:** `FORGE_WORLD_ENVIRONMENT_MEVSIM_HAVA_ZAMAN_TEKNIK_TASARIM_VE_UYGULAMA_PLANI_v0.3.md`
**Sürüm:** 0.3 — repo doğrulamalı teknik plan
**Tarih:** 27 Ekim 2026
**Doğrulanan kod:** `main` @ `f9aa05f` (three `0.184.0`, `WebGLRenderer`)
**Durum:** K0 (repo incelemesi) bu belgeyle **kapandı**. K1 uygulamaya hazır.
**Henüz WES kodu yazılmadı.**
**İlgili:** [World Builder v0.3](FORGE_WORLD_BUILDER_TASARIM_VE_TEKNIK_PLAN_v0.3.md) · [K1 görev talimatı](FORGE_WES_K1_GOREV_TALIMATI_v0.2.md) · [OPEN_WORLD_PLAN](../OPEN_WORLD_PLAN.md) · [TERRAIN_DEFORMATION_PLAN](../TERRAIN_DEFORMATION_PLAN.md)

> **Etiketler**
> - `[ONAYLANDI]`: kullanıcı kararı. Yeniden açılmaz.
> - `[KOD]`: repoda doğrulanmış olgu. Yanında dosya yolu verilir.
> - `[KARAR v0.3]`: bu sürümde kod kanıtıyla alınmış mühendislik kararı. Gerekçesi yazılıdır ve kullanıcı itiraz ederse değişir.
> - `[ÖNERİ]`: uygulama önerisi.
> - `[AÇIK]`: kod incelemesiyle çözülemeyen; ölçüm, içerik ya da ürün kararı bekleyen konu.
>
> Bu belgede "Forge'da var" denen her şeyin yanında dosya yolu vardır. Dosya yolu olmayan her şey **önerinin kendisidir**.

---

## 0. v0.3'te ne değişti

v0.2, repo açılmadan ve 23 Ekim tarihli eski bir teknik rapora dayanılarak yazılmıştı. v0.3 güncel `main` üzerinde doğrulandı.

1. **K0 kapandı.** v0.2'nin K0'da cevaplanmasını istediği beş soru §3 ve §5'te kod kanıtıyla cevaplandı. Ayrı bir "yalnız analiz" turuna gerek kalmadı.
2. **Yanlış/eskimiş varsayımlar düzeltildi** (§3.2):
   - Lastik tutuşu zaten terrain paint katmanının physical material'ına bağlı.
   - Kar/çamur izleri ve ıslak iz mevcut.
   - Kaskadlı güneş gölgesi mevcut.
   - Güneşin ayrı bir state'i yok; kaynak, Sun ışığının rotasyonu.
   - Ağaçların instance başına kimliği yok; kimlik grup ve Foliage Type düzeyinde.
3. **Açık kararların çoğu kapandı:**
   - Kayıt yeri: level içinde singleton environment actor (E-013).
   - Shader entegrasyonu: mevcut terrain/materyal yamalarının içinde (E-014).
   - Preview/Apply modeli mevcut undo hattıyla birleşti (E-018).
4. **Mimari repo modüllerine oturtuldu:**
   - `engine/environment/` (saf mantık)
   - `AuthoredEnvironment` (iki kabuğun ortak render bağı)
   - `src/scene/capabilities/worldEnvironmentModule.ts` (Play)
   - `environmentDetails.ts` (editör)
5. **Planda hiç geçmeyen bağlayıcı kısıtlar eklendi** (§3.3): save-validator allowlist'i, texture-unit bütçesi, `onBeforeCompile` zincirleme, IBL yeniden yakalama maliyeti, `TimeControl`.
6. **Biletler gerçek dosya yollarına ve test dosyalarına bağlandı** (§16, §17).
7. **Kabul sahnesi somutlaştı:** `LandscapeTest` asset'lerinden kurulan yeni bir `WesValley` level'ı. İçerik boşlukları açıkça listelendi.

---

## 1. Onaylı ürün kararları

| ID | Karar | Bağlayıcı etkisi | Durum |
|---|---|---|---|
| **DEC-WES-01 / E-002** | Kademeli geliştirme: önce manuel mevsim/hava ve çalışan gün–gece | İlk dilimin girdileri manuel; otomatik meteoroloji yok | `[ONAYLANDI]` |
| **DEC-WES-02 / E-004** | Ağaçlarda hibrit: materyal, gerekirse mesh varyantı | Dört GLB zorunlu değil; varyant yoksa taban görünüm | `[ONAYLANDI]` |
| **DEC-WES-03 / E-006** | Kar fiziği kademeli: önce görünüm | Görsel örtü araç tutuşunu değiştirmez | `[ONAYLANDI]` |
| **DEC-WES-04 / E-008** | Önce masaüstü WebGL2 | Mevcut `WebGLRenderer` hattı; mobil ve WebGPU ayrı | `[ONAYLANDI]` |
| **E-001** | WES genel Engine/Editor yeteneğidir | World Builder'a ya da yalnız Offroad'a gömülmez | `[ONAYLANDI]` |

---

## 2. Kapsam ve sınırlar

### 2.1. WES v1 = K1 + K2 + K3

**İlk kullanılabilir teslim**, tek bir level ve masaüstü WebGL2 için şunları içerir:

- **K1:**
  - Level'a eklenen bir **World Environment** actor'ü.
  - 24 saatlik saat; editörde scrub, Play'de isteğe bağlı akış.
  - Saatle dönen güneş, ay ışığı, gökyüzü, sis, bulut ve ortam ışığı.
  - Beş manuel hava preset'i (görsel atmosfer).
  - Dört manuel mevsim seçimi (K1'de state; görsel tüketicileri K2'de).
- **K2:**
  - Authored paint'e dokunmayan terrain kar/ıslaklık örtüsü.
  - Kar kabul eden mesh materyalleri (kaya, çatı).
  - Mevsimsel Foliage Type varyantları (yaprak döken ağaç kışın çıplak, iğne yapraklı karlı).
  - `WesValley` kabul sahnesi.
- **K3:**
  - Kamera çevresinde yağmur/kar görseli ve sesi.
  - Global görsel birikim, erime ve kuruma.

### 2.2. Kapsam dışı ve ait olduğu yer

| Konu | Neden v1 dışında | Ait olduğu yer |
|---|---|---|
| Otomatik takvim, kural tabanlı hava | DEC-WES-01 | K5 |
| Kar/ıslaklığın lastik fiziğine bağlanması | DEC-WES-03 | K6 (mevcut surface provider hattı, §11) |
| Bölgesel/zonal hava, tile bazlı birikim haritası | Tek global state v1 için yeterli | K4 |
| World Builder stage bağı | World Builder henüz yok | K4 |
| Runtime save-game'de saat/hava saklama | Oyuna özgü gereksinim; E-017 | K4 |
| WebGPU, mobil eşdeğerlik | DEC-WES-04 | Ayrı plan |
| Volumetrik bulut, şimşek, fırtına, gerçek ay/yıldız diski | Maliyet/kalite; v1 kabulü için gereksiz | K5+ |
| Kar mesh displacement, kar yığını collider'ı | Görsel v1 overlay'dir | K6+ (deformasyon planıyla) |
| Hareketli araç üstünde kar birikimi | Statik çevreden farklı problem | Kapsam dışı |
| Yağmurun çatı altında kesilmesi (yağış occlusion) | Ek derinlik geçişi gerekir | K5+ |
| Su yüzeyinde yağmur halkaları, göl/nehir seviyesi | Water System'in işi | Water planı |

### 2.3. Değişmeyen koruma koşulları — her biri bir teste bağlı

| # | Koşul | Test |
|---|---|---|
| a | Hava/mevsim önizlemesi authored terrain paint ağırlıklarını ve yükseklikleri değiştirmez | ENV-03 |
| b | Mevsim değişimi foliage instance dizilerini (konum/rotasyon/ölçek/seed) ve placement `id`'lerini değiştirmez | ENV-02 |
| c | Editör önizlemesi kayda sızmaz; yalnız açıkça "level varsayılanı" yapılan değer kaydedilir | ENV-15 |
| d | World Environment actor'ü olmayan level byte-byte aynı render/save/Play davranışını korur | ENV-00 |
| e | WES, authored environment actor'lerine (Sun, Sky, Fog, Cloud) **yazmaz**; yalnız render zamanında üstüne uygular | ENV-15, ENV-16 |
| f | Görsel örtü physics surface sample'ını değiştirmez | ENV-12 |

---

## 3. Repo doğrulaması — K0 sonucu

### 3.1. Yetenek matrisi

| Alan | Durum | Kanıt | WES için anlamı |
|---|---|---|---|
| Renderer | `[KOD]` MEVCUT | three `0.184.0`, `engine/render-three/renderer.ts` | WebGL2 hattı aynen kullanılır |
| Ortak environment bağı | `[KOD]` MEVCUT | `engine/render-three/authoredEnvironment.ts`: editör ve runtime aynı sınıfla sky/fog/cloud/IBL kurar | WES render bağının **tek doğal yeri**. İki kabukta ayrı kod yazılmaz |
| Sky Atmosphere | `[KOD]` MEVCUT | `engine/render-three/skyAtmosphere.ts` (three `Sky`; rayleigh/turbidity/mie/exposure) | Saat ve hava bu uniform'ları değiştirir |
| Güneş | `[KOD]` MEVCUT | Sun = `type: "directional"` light, id `"sun"` (`src/scene/SceneRuntimeCore.ts:90`). Gök, ışığın rotasyonundan yön alır (`sunDirectionFromLightRotation`) | Saat **ışığın three nesnesini** döndürür, `LayoutLightActor`'ü değil (§4.4) |
| Height Fog | `[KOD]` MEVCUT (mesafe tabanlı) | `engine/render-three/heightFog.ts`: `FogExp2`/`Fog`; yüksekliğe bağlı sis "Faz 2" | Hava preset'i yoğunluk ve rengi değiştirir. Vadi sisi v1 dışı |
| Cloud Layer | `[KOD]` MEVCUT | `engine/render-three/cloudLayer.ts`: fBm kubbe; coverage/density/softness/speed | Bulutlu/yağışlı preset'i coverage'ı yükseltir |
| Post Process | `[KOD]` MEVCUT | `engine/render-three/postProcess.ts`: exposure, tone mapping, temperature/tint | Gece exposure ve renk sıcaklığı uyarlaması |
| Sky Light (IBL) | `[KOD]` MEVCUT | `AuthoredEnvironment.applyReflection(layout, recapture)`: gökyüzünü PMREM'e yakalar; su ve probe'lar bu ortama bağlı | Güneş her hareket ettiğinde yeniden yakalama **pahalı**. Kadans politikası şart (§6.4) |
| Kaskadlı güneş gölgesi | `[KOD]` MEVCUT | `engine/render-three/sunCascadeShadow.ts`, `engine/world/sunCascades.ts`; güneş yön/renk/şiddeti her kare okunur | Saat değişimi ek iş istemez. v0.2'deki "CSM yok" uyarısı geçersiz |
| Takip eden gölge | `[KOD]` MEVCUT | `engine/render-three/sunFollowShadow.ts` | Aynı |
| Simülasyon zamanı | `[KOD]` MEVCUT | `engine/core/timeControl.ts`: pause holder'ları + time scale (0.05–16). Capability'ler ölçeklenmiş delta alır (`RuntimeSceneApp.ts`, `capabilities.update(simulationMs/1000)`) | Oyun saati bu deltayla akar; pause ve diagnostic hold'lar saati de durdurur |
| Terrain renderer | `[KOD]` MEVCUT | GPU CDLOD, `engine/render-three/terrain/terrainMaterial.ts` (`onBeforeCompile` ile `MeshStandardMaterial`); legacy Landscape de aynı renderer'dan geçer (`engine/render-three/landscape.ts`) | Kar/ıslaklık örtüsü **tek dosyada** iki terrain türünü kapsar |
| Paint katmanları | `[KOD]` MEVCUT, sınırlı | `TERRAIN_MAX_LAYERS = 8` (`engine/terrain/terrainTypes.ts:31`); albedo tek `sampler2DArray` (`terrainLayerArray.ts`) | Kar **paint katmanı olamaz**, uniform tabanlı overlay olmalı (§9.1) |
| Paint → fizik | `[KOD]` MEVCUT | Katman `physicalMaterial` (`terrainTypes.ts:52`) → `engine/terrain/terrainSurface.ts` → `engine/physics/surface/surfaceResponse.ts`; preset'ler: `slippery, rubber, metal, wood, stone, snow, mud, sand` (`engine/scene/collision.ts`) | Elle boyanmış `snow` katmanı **bugün fiziksel olarak kar**. K6 buraya bağlanır (§11) |
| İz / gömülme / ıslak iz | `[KOD]` MEVCUT | `engine/render-three/terrain/terrainDeformation.ts`, `terrainWaterState.ts`, `src/scene/capabilities/terrainDeformationModule.ts`, `engine/physics/surface/wheel*.ts` | WES görsel ıslaklığı bu sistemin katman `wetness` konvansiyonunu izler, onu değiştirmez |
| Mesh materyalleri | `[KOD]` MEVCUT | `engine/assets/material.ts` (`ForgeMaterialDef`) + `engine/render-three/materials.ts`; `layerBlend` sürücüleri `constant, slope, worldHeight, maskTexture, vertexColor`; world-normal varying'i var | Kaya ve çatı karı = mevcut **`slope` sürücülü layer blend** + global örtü çarpanı (§9.2) |
| Foliage | `[KOD]` MEVCUT | `engine/scene/foliage.ts`, `engine/render-three/foliage.ts`: grup = `foliageTypeId` + instance dizisi → chunk başına `InstancedMesh`. Instance: position/rotation/scale/normal/seed (**id yok**). Foliage Type `*.foliagetype.json`, `/__save-foliage-type` → `normalizeFoliageType` | Mevsim varyantı **Foliage Type** düzeyinde. Instance dizisine dokunulmaz (§8.1) |
| Foliage akışı / fade / prosedürel | `[KOD]` MEVCUT | `engine/world/foliageCells.ts`, `src/scene/foliageCellStreaming.ts`, `engine/render-three/foliageFade.ts`, `engine/scene/landscapeFoliage.ts`, `engine/scene/proceduralFoliage.ts` | Yeni yüklenen hücre o anki mevsimle kurulmalı |
| Foliage çarpışması | `[KOD]` alan var, tüketici bulunamadı | `ForgeFoliageTypeDef.collision` normalize ediliyor; fizik tarafında tüketen kod grep'le bulunamadı | Mesh varyantı bugün collider etkilemez. İleride collider taban mesh'e bağlı kalır (§8.1) |
| HLOD | `[KOD]` MEVCUT | `engine/world/hlod.ts` | Proxy'ler taban görünümle üretilir. Mevsim uyumsuzluğu riski (E-024) |
| Partikül VFX | `[KOD]` MEVCUT, sınırlı | `engine/vfx/*`, `engine/render-three/particleEffect.ts`: CPU sim, `THREE.Points` ("VFX Lite") | Kamera çevresi yağış için uygun değil; ayrı GPU-animasyonlu renderer (§10) |
| Capability modülleri | `[KOD]` MEVCUT | `src/scene/capabilities/CapabilityModule.ts`; editör bu registry'yi çalıştırmaz | Play saati capability; editör önizlemesi editör kabuğunda |
| Save-game | `[KOD]` MEVCUT | `engine/persistence/saveGameState.ts`, `docs/architecture/SAVE_GAME_CONTRACT.md` | K4'te opsiyonel `environment` bloğu |
| Undo/redo | `[KOD]` MEVCUT | `editor/core/history.ts` (`EditorHistory`) | "Level varsayılanı yap" = tek undo adımı (§12) |
| Environment editör UI | `[KOD]` MEVCUT | `src/editor/panels/details/environmentDetails.ts` (sky/fog/cloud/post detayları), `EditorUi.ts` `singleton(...)` kaydı | Yeni actor aynı kalıpla eklenir |
| Perf araçları | `[KOD]` MEVCUT | `engine/perf/*` (gpuTimer, gpuSweep, frameCapture, qualityProfiles), `npm run perf:browser`, `perf:quality`, `?debug` | Ölçüm protokolü yeni araç gerektirmez (§15) |
| Kabul içeriği | `[KOD]` KISMİ | `public/assets/LandscapeTest/`: `LT_Snow_BC.png`, `LT_Snow_Roughness.webp`, `lt-snow/rock/meadow/earth/wet-mud` materyalleri, `LT_Valley_Tree.glb`, `LT_Alpine_Pine.glb`, `LT_Boulder_A/B.glb`, `LT_Meadow_Tuft.glb` | Kış çıplak ağaç mesh'i ve çatı/ev modeli **yok** (E-023) |
| WES / saat / mevsim / hava | YENİ | `engine/` ve `src/` altında `season`, `weather`, `timeOfDay` ya da `WorldClock` kodu yok | Bu planın konusu |

### 3.2. v0.2'de düzeltilen varsayımlar

| v0.2 varsayımı | Gerçek durum | Sonuç |
|---|---|---|
| "Lastik tutuşu görsel paint katmanına bağlı değil" | Paint katmanı `physicalMaterial` taşıyor ve araç yüzey tepkisi buradan geliyor | K6 yeni sistem değil, mevcut provider'a ek. Authored `snow` katmanı zaten fiziksel kar |
| "Lastik izi / deformasyon ileri aşama" | Deformasyon planının Faz 1–4A'sı uygulandı | WES iz sistemini tüketmez ve değiştirmez; ıslaklık konvansiyonu paylaşılır |
| "Mevcut Forge'da CSM varmış gibi davranma" | Kaskadlı güneş gölgesi var (özel uygulama, three `CSM` addon değil) | Saat güneşi döndürdüğünde gölgeler kendiliğinden izler |
| "Sun/sky ayrı ayarlanır" | Gökyüzünde güneş verisi yok; Sun ışığının rotasyonu tek kaynak | `AtmosphereAdapter`, ışığın three nesnesine runtime override uygular |
| "Ağaçların stableId'si korunmalı" | Foliage instance'ında id yok; kimlik grup ve tip düzeyinde | Varyant tip düzeyinde çözülür, koşul kendiliğinden sağlanır |
| "Instance'lar bucket'tan bucket'a taşınır" | Grup bir tipe bağlı tek `InstancedMesh` setidir | Mesh/materyal değişimi grubun meshlerini yeniden kurar, instance matrisleri aynen kopyalanır |
| "Sidecar mı level alanı mı belirsiz" | Sky/Fog/Cloud/Reflection/PostProcess level içinde singleton; allowlist + drift testleri hazır | Aynı kalıp (§5.3) |
| "Shader: material patch mi adapter mı" | Terrain ve mesh materyalleri zaten `onBeforeCompile` yamalı; zincirleme kalıbı var | Mevcut yamalara uniform eklenir, ayrı adapter katmanı yok |
| "Draft/Applied ayrı state" | Editörde undo/redo + açık Save Layout var | Önizleme geçici görünüm state'i; varsayılanlar normal undo komutu (§12) |

### 3.3. Bağlayıcı teknik kısıtlar (v0.2'de yoktu)

1. **Save-validator allowlist'i.**
   - `LayoutWorldEnvironment` ve Foliage Type/materyal/light'a eklenen her alan ilgili normalizer ve validator'a eklenmezse kayıtta **sessizce düşer**.
   - İlgili yerler: `tools/saveValidator.ts`, `normalizeFoliageType`, materyal normalizer'ı.
   - `tests/engine/droppedFields.test.ts` ve `serializationDrift.test.ts` her yeni alan için genişletilir.
2. **Texture-unit bütçesi.**
   - Güneş kaskadları, terrain'in fragment sampler sayısına göre azaltılıyor (`affordableSunCascades`, `terrainLitFragmentSamplers`).
   - 16 unit'lik GPU'larda (ANGLE/D3D11) her yeni terrain sampler'ı bir gölge kaskadına mal olabilir.
   - **K2a sıfır yeni sampler** ile yapılır. Yeni sampler eklenirse sayaç da güncellenir (ENV-17).
3. **`onBeforeCompile` zincirleme.**
   - Terrain, foliage-fade, world-mask, reflection-capture ve kaskad gölgesi aynı materyallere yama zinciri kuruyor.
   - Yeni yama önceki `onBeforeCompile` ve `customProgramCacheKey`'i korumalıdır. Referans kalıp: `worldMaskPatch.ts`.
   - three'nin `CSM` addon'u bu yüzden kullanılmıyor. WES de zinciri kıramaz (ENV-16).
4. **Program önbelleği.**
   - Mevsim/hava değişimi shader **yeniden derlemesi** tetiklememeli. Örtü uniform'larla taşınır; define'lar sabit kalır.
   - Yalnız mesh varyantı değişimi yeni program/geometri getirebilir.
5. **IBL yeniden yakalama.**
   - `applyReflection(layout, true)` gökyüzünü PMREM'e yeniden render eder. Su ve probe sınır karışımı bu ortama bağlı.
   - Her kare yakalama kabul edilemez (§6.4).
6. **İki kabuk, bir bağ.**
   - Editör (`src/scene/SceneApp.ts`, ~15.6k satır) ve runtime (`src/scene/RuntimeSceneApp.ts`, ~6.8k satır) environment'ı `AuthoredEnvironment` üzerinden uygular.
   - WES mantığı kabuklara **yazılmaz**. Kabuklar yalnız birkaç satırlık bağlantı yapar.
7. **Katman sınırları.**
   - `npm run verify:imports`: `engine/**` editör/oyun/`src` import edemez. Capability modülleri editör/oyun import edemez.
   - WES saf mantığı `engine/environment/` altında three'siz durur. Render bağı `engine/render-three/` altındadır.
8. **Editör `?editor` arkasında kalır.** WES editör paneli game bundle'a girmez (`verify:dist --strict`).

---

## 4. Mimari

### 4.1. Modül yerleşimi `[KARAR v0.3]`

```text
engine/environment/                    (YENİ — three'siz, saf, node testli)
  worldEnvironment.ts                  LayoutWorldEnvironment tipi, varsayılanlar, normalizeWorldEnvironment
  worldClock.ts                        saat ilerletme (kapalı form), 24h wrap
  sunPath.ts                           saat + yol parametreleri → güneş/ay yönü, ışık rengi/şiddeti eğrileri
  weatherPresets.ts                    preset → authored değerlere göreli çarpanlar
  environmentResolve.ts                (authored actor'ler + runtime state) → ResolvedEnvironment
  recapturePolicy.ts                   IBL yeniden yakalama kararı
  surfaceCondition.ts                  (K3) görsel birikim/erime/kuruma adımı

engine/render-three/
  authoredEnvironment.ts               (DEĞİŞİR) applyEnvironment(resolved): sun override, sky/fog/cloud çarpanları
  environmentUniforms.ts               (YENİ) paylaşılan uniform nesneleri: snowCoverage, wetness, snow parametreleri
  terrain/terrainMaterial.ts           (DEĞİŞİR, K2) kar/ıslaklık blend'i
  materials.ts                         (DEĞİŞİR, K2) layerBlend environment sürücüsü
  foliage.ts                           (DEĞİŞİR, K2) Foliage Type mevsim varyantı
  precipitation.ts                     (YENİ, K3) kamera çevresi yağış

engine/scene/layout.ts                 (DEĞİŞİR) RoomLayout.worldEnvironment?: LayoutWorldEnvironment
tools/saveValidator.ts                 (DEĞİŞİR) validateWorldEnvironment (normalizer'ı yeniden kullanır)

src/scene/capabilities/worldEnvironmentModule.ts   (YENİ) Play: saati ilerletir, servis yayınlar
src/scene/capabilities/runtimeServiceKeys.ts       (DEĞİŞİR) worldEnvironment servis anahtarı
src/scene/SceneApp.ts, RuntimeSceneApp.ts          (DEĞİŞİR, küçük) sun three nesnesine override, update çağrısı
src/editor/EditorUi.ts                             (DEĞİŞİR) singleton("worldEnvironment", ...)
src/editor/panels/details/environmentDetails.ts    (DEĞİŞİR) renderWorldEnvironmentDetails + önizleme kontrolleri
```

### 4.2. Veri akışı

```text
 [Authored level]                                     [Runtime / önizleme]
  layout.worldEnvironment (varsayılanlar)  ─┐          editör: önizleme state'i (kaydedilmez)
  lights[sun], skyAtmosphere, heightFog,    │          Play:   worldEnvironmentModule (TimeControl deltası)
  cloudLayer, postProcess, worldSettings    │                     │
                                            ▼                     ▼
                         environmentResolve(authored, state) → ResolvedEnvironment
                                   (saf, deterministik, node testli)
                                            │
            ┌───────────────────────────────┼────────────────────────────────┐
            ▼                               ▼                                ▼
  AuthoredEnvironment.applyEnvironment   environmentUniforms            foliage/material resolver
  sun three nesnesi, sky/fog/cloud,       snowCoverage, wetness,         Foliage Type mevsim varyantı,
  post exposure, IBL kadansı              kar parametreleri              materyal kar sürücüsü
            │                               │                                │
            └───────────────── render (WebGL2) ──────────────────────────────┘

  physics: surfaceResponse ← paint physicalMaterial   (WES K6'ya kadar bağlanmaz)
```

### 4.3. Sahiplik

| Veri | Otorite | WES'in yetkisi |
|---|---|---|
| Sun/Sky/Fog/Cloud/PostProcess authored değerleri | Level (editör) | Yalnız okur; render zamanında override uygular |
| `worldEnvironment` varsayılanları | Level (editör) | Okur; editörde "varsayılan yap" ile undo komutu üzerinden yazılır |
| Saat/hava/mevsim anlık değeri | Editörde önizleme state'i, Play'de capability | Tek otorite |
| Terrain yükseklik, paint, physicalMaterial | Terrain verisi | Asla yazmaz |
| Foliage instance'ları, placement'lar | Level/sidecar | Asla yazmaz |
| Foliage Type mevsim varyant tanımı | Foliage Type asset'i | Okur |
| Fiziksel yüzey tepkisi | `surfaceResponse` + vehicle | K6'ya kadar dokunmaz |
| Hava değişim kararı (oyun içi) | Oyun modülü (Layer 3) servis üzerinden | Motor otomatik hava üretmez (K5'e kadar) |

### 4.4. Override ilkesi `[KARAR v0.3]`

WES authored veriye **asla yazmaz**. Bunun en kritik yeri güneş:

- `LayoutLightActor.rotation` level'da kayıtlı veridir. Saat bu alana yazsaydı her scrub'da layout kirlenir, undo yığını dolar ve önizleme kayda sızardı.
- Bu yüzden saat **sun ışığının three `DirectionalLight` nesnesine** runtime override uygular: yön, renk, şiddet. `AuthoredEnvironment` gök diski ve IBL için aynı override'ı kullanır. Bugünkü `resolveSunActor()` yolunun yanına `resolveSunDirection()` eklenir.
- World Environment actor'ü yoksa ya da `hidden` ise override yoktur ve bugünkü davranış aynen sürer (ENV-00).
- Editörde gizmo ile Sun'ı döndürmek WES açıkken güneş yolunun **azimutunu** değiştirmez. Details panelinde "Güneş yolu WES tarafından yönetiliyor" uyarısı gösterilir. Yol parametreleri World Environment Details'inde düzenlenir.

---

## 5. Veri sözleşmesi

### 5.1. `LayoutWorldEnvironment` `[KARAR v0.3]`

Mevcut singleton'ların kalıbını izler: tüm alanlar opsiyoneldir ve yokluk varsayılan değeri okur. Varsayılanlar `engine/environment/worldEnvironment.ts` içindedir.

```ts
type Season = "spring" | "summer" | "autumn" | "winter";
type WeatherPreset = "clear" | "cloudy" | "rain" | "snow" | "fog";

/** Singleton environment actor: World Environment (WES). RoomLayout.worldEnvironment. */
interface LayoutWorldEnvironment {
  name?: string;                 // Outliner adı; yok = "World Environment"
  hidden?: boolean;              // true = WES kapalı; authored sky/fog/sun aynen
  time?: {
    hour?: number;               // 0 ≤ h < 24; varsayılan 12
    dayLengthMinutes?: number;   // Play'de 24 oyun saati = kaç gerçek dakika; 0 = saat durur (varsayılan 0)
  };
  sunPath?: {
    azimuthDeg?: number;         // öğle güneşinin pusula yönü (0 = +Z); varsayılan 180
    noonElevationDeg?: number;   // öğle yüksekliği 5..90; varsayılan 60
    sunriseHour?: number;        // varsayılan 6
    sunsetHour?: number;         // varsayılan 18
  };
  night?: {
    moonIntensity?: number;      // gece aynı directional ışığın şiddeti (lux benzeri çarpan); varsayılan 0.08
    moonColor?: string;          // varsayılan "#9fb4ff"
    ambientFloor?: number;       // gece ortam ışığının authored ambient'e oranı alt sınırı; varsayılan 0.15
  };
  season?: Season;               // varsayılan "summer" (= authored görünüm)
  weather?: {
    preset?: WeatherPreset;      // varsayılan "clear" (= authored atmosfer)
    intensity?: number;          // 0..1; varsayılan 1
  };
  surface?: {                    // K2 görsel örtü; fizik değildir
    snowCoverage?: number;       // 0..1; varsayılan 0
    wetness?: number;            // 0..1; varsayılan 0
    winterSnowCoverage?: number; // "Winter" hızlı preset'inin uyguladığı örtü; varsayılan 0.6
    snowColor?: string;          // K2a düz kar albedo'su; varsayılan "#f2f5fa"
    snowSlopeStartDeg?: number;  // bu eğime kadar tam kar; varsayılan 30
    snowSlopeEndDeg?: number;    // bu eğimden sonra kar yok; varsayılan 55
    snowMinAltitude?: number | null;  // dünya Y; null = yükseklik sınırı yok (varsayılan)
    snowAltitudeBlend?: number;  // metre; varsayılan 20
  };
}
```

**Birim kararları:**

- `dayLengthMinutes`, v0.2'deki birimsiz `timeScale` yerine geçer. "1 oyun günü = N gerçek dakika" tasarımcı için okunur. Genel simülasyon hızı zaten `TimeControl.timeScale` ile ayrıca çarpılır.
- `snowCoverage` görsel örtü oranıdır, **kar derinliği değildir** (E-010). Fiziksel derinlik K6'da ayrı alandır.

**Kimlik (identity) kuralı:** `season: "summer"`, `weather.preset: "clear"` ve `surface` sıfırken WES'in tek görünür etkisi saattir.

- Varsayılan değerlerle eklenen bir actor yalnız güneşi saate göre yerleştirir. Diğer her şey authored görünümdür.
- Editör actor eklenirken saati ve `sunPath`'i **mevcut Sun rotasyonundan türetir**. Böylece eklemek görüntüyü sıçratmaz (`sunPath.ts` ters dönüşümü; ENV-00b).

### 5.2. Doğrulama ve bozuk veri

`normalizeWorldEnvironment` hem loader'da hem `validateWorldEnvironment` (save) içinde kullanılır; tek kaynak budur. Kurallar:

- Bilinmeyen enum (`season`, `preset`) varsayılana düşer ve uyarı üretir. Level yüklenmeye devam eder.
- Sayılar clamp'lenir.
- Bilinmeyen alanlar save'de `dropped[]` olarak raporlanır (mevcut `droppedFields` ağı).

### 5.3. Kayıt yeri — E-013 kapandı `[KARAR v0.3]`

| Seçenek | Artı | Eksi |
|---|---|---|
| **Level içinde singleton (`layout.worldEnvironment`)** | Mevcut 5 environment singleton'ıyla aynı kalıp. Allowlist, drift testi, Outliner/Details, undo ve World Partition persistent level'ı hazır. Level'la atomik kayıt | Level JSON'u büyür (~1 KB, önemsiz) |
| `*.environment.json` sidecar | Level'dan bağımsız paylaşılabilir profil | Altıncı allowlist yüzeyi, yeni `/__save-*` endpoint'i, yeni save sırası/rollback, yeni orphan temizliği. Faydası v1'de kullanılmıyor |

**Karar:** level içi singleton. Paylaşılabilir "environment profile" asset'i (`*.environmentprofile.json`) gerekirse K5'te eklenir. O zaman actor bir `profile` referansı alır; inline alanlar profilin üstüne yazar (vehicle asset kalıbı).

### 5.4. Foliage Type mevsim alanları (K2)

```ts
interface ForgeFoliageTypeDef {
  // ...mevcut alanlar
  seasons?: Partial<Record<Season, {
    meshAssetId?: string;   // bu mevsimde başka mesh (ör. çıplak ağaç); yoksa taban mesh
    tint?: string;          // taban/varyant materyaline çarpılan renk (sonbahar yaprağı)
    hidden?: boolean;       // bu mevsimde çizilmez (ör. kışın çim tutamı)
  }>>;
  snow?: { accept?: boolean };  // kar örtüsü bu tipin yukarı bakan yüzeylerine uygulanır mı (iğne yaprak: true)
}
```

- Kayıt `/__save-foliage-type` → `normalizeFoliageType` (`engine/scene/foliage.ts`) üzerinden gider; alanlar normalizer'a eklenir.
- Mevsimi tanımsız tip, taban görünümle çizilir. Bu bir hata değildir; Details'te bilgi olarak gösterilir.
- `meshAssetId` manifest'te yoksa uyarı verilir ve taban mesh kullanılır. Hiçbir zaman başka bir tip seçilmez.

### 5.5. Materyal environment sürücüsü (K2)

```ts
interface ForgeMaterialLayerBlend {
  // ...mevcut alanlar
  environment?: "snowCoverage" | "wetness" | null;  // null/yok = bugünkü davranış
}
```

- Son karışım: `amount × environmentValue`. Örneğin `slope` sürücülü bir kar layer'ı, kar örtüsü 0 iken hiç görünmez, 1 iken authored görünümüne ulaşır.
- Kayıt `/__save-material` → `engine/assets/material.ts` normalizer'ından geçer; alan oraya eklenir. Material Editor'da bir açılır liste olur.

### 5.6. Runtime state ve servis

```ts
interface WorldEnvironmentState {
  hour: number;
  season: Season;
  weather: { preset: WeatherPreset; intensity: number };
  surface: { snowCoverage: number; wetness: number };
  /** K3: örtü değerinin kaynağı; panelde gösterilir. */
  surfaceSource: "authored" | "manual" | "simulated";
}

interface WorldEnvironmentService {         // runtimeServiceKeys.worldEnvironment
  getState(): Readonly<WorldEnvironmentState>;
  setHour(hour: number): void;
  setSeason(season: Season): void;
  setWeather(preset: WeatherPreset, intensity?: number, transitionSeconds?: number): void;
  setSurface(partial: Partial<WorldEnvironmentState["surface"]>): void;
  onChanged(listener: (state: Readonly<WorldEnvironmentState>) => void): () => void;
}
```

Oyun modülü (Layer 3) havayı bu servisle değiştirir; Offroad'un "kışın yol kapanır" gibi kuralları orada yaşar. Motor K5'e kadar kendiliğinden hava değiştirmez.

---

## 6. Zaman, güneş ve ışık

### 6.1. Saat `[KARAR v0.3]`

- **Play:** `worldEnvironmentModule.update(simDelta)`.
  - `simDelta` zaten `TimeControl` ile ölçeklenmiş ve pause'a uymuş deltadır. Menü veya diagnostic hold saati de durdurur.
  - Saat `hour = (h0 + 24·T / (60·dayLengthMinutes)) mod 24` ile **birikmiş simülasyon süresinden** (`T`) kapalı formda hesaplanır. Kare kare saat toplanmaz.
  - Böylece 30/60/144 Hz aynı sonucu verir ve float kayması oluşmaz (ENV-14).
- **Editör:** saat yalnız önizleme kontrolüyle değişir (scrub slider, Play/Pause, hız).
  - Editörün `TimeControl`'ü yoktur; önizleme oynatma duvar saatine bağlı kendi hızını kullanır.
  - Önizleme kaydedilmez (§12).
- **Level Travel:** saat level'a aittir. Yeni level kendi varsayılanından başlar; K4 save-game isterse taşır.

### 6.2. Art-directed güneş yolu `[KARAR v0.3, E-007]`

Astronomik model (enlem/tarih) v1'de yoktur. `sunPath.ts`:

- **Gündüz** (`sunrise ≤ h ≤ sunset`): `t = (h − sunrise)/(sunset − sunrise)`.
  - Yükseklik: `noonElevation · sin(π·t)`.
  - Azimut: `azimuthDeg − 90° + 180°·t` (doğudan batıya).
- **Gece:** aynı directional ışık **ay** olur.
  - Yön, güneş yolunun karşı tarafı ve sabit alçak bir yükseklik.
  - Renk `moonColor`, şiddet `moonIntensity`. Gölgeler aynı kaskadlarla çalışır.
  - Ekstra ışık veya gölge haritası yoktur.
- **Geçiş:** alacakaranlıkta (güneş yüksekliği ±6°) güneş ve ay ışığı yumuşak geçer. Gün doğumu ve batımında ışık rengi turuncuya kayar; renk ve şiddet eğrileri `sunPath.ts` içinde veri tablosudur.
- **Mevsim:** v1'de gün uzunluğunu değiştirmez (v0.2 §8.1 "kış her yerde kısa gün olmasın" ilkesi). Mevsimsel `sunrise/sunset` farkı K5'teki takvimle gelir.

### 6.3. Gök, sis, ortam ve exposure

| Tüketici | Saatle değişen | Kaynak |
|---|---|---|
| Sky | Güneş yönü (gök diski, ufuk parlaması); gece three `Sky` kendiliğinden kararır | `applySkySunDirection` |
| Ortam ışığı | `worldSettings.ambientIntensity × max(ambientFloor, gündüz faktörü)` | Kabuk ambient'i; authored değer çarpılır, yazılmaz |
| Sis rengi | Authored renk, gece koyulaşır, alacakaranlıkta ısınır | `applySceneFog` override'ı |
| Bulut rengi | Authored renk × ışık rengi/şiddeti | `applyCloudUniforms` override'ı |
| Exposure | Gece hafif açılır (göz uyumu), K1'de sabit eğri | `applySkyPostProcessExposure` yolu |

### 6.4. IBL yeniden yakalama politikası `[KARAR v0.3]`

`recapturePolicy.ts` saf ve testlidir. Yeniden yakalama şu durumlarda yapılır:

- Güneş yönü son yakalamadan beri **≥ 3°** döndüyse ya da hava/mevsim preset'i değiştiyse, ve
- son yakalamadan beri en az **2 gerçek saniye** geçtiyse.

Ek kurallar:

- Editörde scrub sürerken yakalama yapılmaz; bırakınca bir kez yapılır.
- Eşikler başlangıç değeridir. K1 ölçümünde (`gpuTimer`) yakalamanın maliyeti kayda geçer ve gerekirse ayarlanır (ENV-18).
- Su (`waterEnvironment.ts`) ve probe sınır karışımı, mevcut `onEnvironmentChanged` geri çağrısıyla otomatik güncellenir.

### 6.5. Gölgeler

Kaskadlar ve takip eden gölge güneşi her kare okuduğu için ek iş yoktur. Tek risk alçak güneşte gölge kalitesidir: uzun gölgeler ve shadow acne. K1 görsel kabulünde 06:30 ve 18:30 kareleri ayrıca incelenir. Gerekirse `sunPath.ts` minimum gölge yüksekliği (ör. 4°) uygular ve gölge ufukta söner.

### 6.6. Gece ışıkları (K2, opsiyonel bilet)

`LayoutLightActor.activation?: "always" | "night"` (varsayılan `"always"`). `"night"` ışıkları güneş yüksekliği 0°'nin altına inince yumuşakça açılır. Yeni light alanı olduğu için `validateLightActor` allowlist'ine eklenir. Emissive materyallerin gece açılması K5+.

---

## 7. Hava preset'leri

### 7.1. Göreli çarpan ilkesi `[KARAR v0.3]`

Preset'ler mutlak değer değil, **authored değerlere göreli** çarpan ve hedeflerdir:

- `clear` = authored atmosfer (kimlik).
- `intensity` 0'dan 1'e `clear`'dan preset'e lineer karışım sağlar.
- Böylece aynı preset farklı sanat yönlü level'larda tutarlı davranır.

| Preset | Bulut coverage | Sis yoğunluğu | Sis rengi | Güneş şiddeti | Sky turbidity | K3 yağış | K3 örtü hedefi |
|---|---|---|---|---|---|---|---|
| `clear` | authored | ×1 | authored | ×1 | +0 | yok | — |
| `cloudy` | ≥ 0.70 | ×1.5 | griye %30 | ×0.6 | +4 | yok | — |
| `rain` | ≥ 0.90 | ×2.5 | griye %50 | ×0.35 | +8 | yağmur | wetness → 1 |
| `snow` | ≥ 0.90 | ×3 | soğuk beyaza %40 | ×0.45 | +6 | kar | snowCoverage ↑ |
| `fog` | authored | ×6 (üst sınır) | authored | ×0.7 | +3 | yok | — |

Sayılar `weatherPresets.ts`'deki **başlangıç değerleridir** ve K1 görsel kabulünde ayarlanır. Fork'a özgü preset ihtiyacı doğarsa K5'te veri dosyasına taşınır (E-021).

### 7.2. Eksik environment actor'ü `[KARAR v0.3, E-020]`

WES sahneye gizli kubbe veya sis **üretmez**. Level'da Cloud Layer yoksa `cloudy` bulut göstermez.

- Details paneli "Bu preset Cloud Layer / Height Fog / Sky Atmosphere ister" uyarısı gösterir.
- Yanında tek undo adımlı "Eksik environment actor'lerini ekle" düğmesi bulunur.
- Böylece authored sahnenin içeriği her zaman Outliner'da görünür kalır.

---

## 8. Mevsim ve varlık dönüşümü

### 8.1. Foliage Type varyantları (K2)

`engine/render-three/foliage.ts` grubu `foliageTypeId` başına chunk'lara bölüp her chunk için `InstancedMesh` kurar. Mevsim değişince:

1. Her grup için tipin `seasons[season]` kaydı çözülür: mesh, tint, hidden.
2. Mesh değişmiyorsa yalnız tint uniform'u değişir. Yeniden derleme olmaz.
3. Mesh değişiyorsa grubun chunk meshleri varyant modelden yeniden kurulur. **Instance matrisleri ve fade verisi aynen kopyalanır**. Foliage-fade ve world-mask yamaları yeni materyallere de zincirlenir.
4. `hidden` grubu çizmez ama silmez. Seçim, istatistik ve kayıt etkilenmez.
5. Hücre akışında (`foliageCellStreaming.ts`) yeni yüklenen hücre ve prosedürel landscape foliage kuralları **o anki** mevsimle kurulur.

**Ön yükleme:** level'da World Environment actor'ü varsa, Foliage Type'ların bütün mevsim mesh'leri level yüklenirken asset residency'ye (`engine/world/assetResidency.ts`) eklenir. Böylece mevsim değişimi ağdan yükleme beklemez. Varyant henüz yüklenmemişse taban görünüm kalır ve yükleme bitince değişir; takılma olmaz.

**Kimlik:** instance dizisi değişmediği için konum/rotasyon/ölçek/seed sabit kalır (ENV-02). Foliage collider'ı ileride eklenirse taban mesh'e bağlı kalır; mevsim collider değiştirmez.

**İğne yapraklı:** mesh değişmez; `snow.accept: true` ile yukarı bakan yüzeylere kar örtüsü uygulanır (§9.2, foliage materyal yaması).

### 8.2. Yerleştirilmiş meshler (kaya, çatı, yapı)

K2'de yerleştirilmiş meshler için **mesh değişimi yoktur**; yalnız materyal düzeyinde kar ve ıslaklık uygulanır (§5.5, §9.2). Kaya ve çatı karı, authored materyale `slope` sürücülü bir kar layer'ı ve `environment: "snowCoverage"` eklenerek yapılır. Placement başına materyal değişimi zaten var (`LayoutPlacement.materialSlot`, `engine/scene/layout.ts`). Böylece aynı mesh'in karlı ve karsız örnekleri aynı sahnede kullanılabilir.

### 8.3. Actor olarak yerleştirilmiş ağaçlar — sınır `[KARAR v0.3]`

Bir ağaç foliage değil placement olarak yerleştirildiyse K2'de yalnız materyal (tint/kar) desteği vardır. Asset düzeyinde mevsim mesh'i (manifest `seasonalVariants`) ihtiyaç kanıtlanırsa K4'te World Builder'ın asset family metadata'sıyla birlikte tasarlanır. Gerekçe: Forge'da doğa varlıkları ağırlıkla foliage olarak boyanıyor ya da kuralla üretiliyor.

### 8.4. Terrain çim rengi (K2, opsiyonel)

Paint katmanına `seasonTint?: Partial<Record<Season, string>>`, örneğin sonbaharda sararmış çayır. Bu alan terrain tanımı (beşinci allowlist yüzeyi, `normalizeWorldTerrain`) ve 1×1 köprü (`LandscapeLayerWeights`) üzerinden taşınmalıdır. Kapsamı WES-008b olarak ayrı tutulur.

---

## 9. Kar ve ıslaklık örtüsü

### 9.1. Terrain (K2a) `[KARAR v0.3, E-005/E-014]`

`terrainMaterial.ts`'nin lit fragment'ında splat rengi ve roughness hesaplandıktan sonra şu blok eklenir:

Aşağıdaki GLSL taslaktır; değişken adları temsilidir ve gerçek adlar `terrainMaterial.ts`'deki chunk'lara göre seçilir.

```glsl
// uniform'lar environmentUniforms.ts'deki paylaşılan nesnelerdir (tüm terrain materyalleri tek güncelleme)
float wesUp    = smoothstep(cos(radians(uWesSnowSlopeEnd)), cos(radians(uWesSnowSlopeStart)), terrainNormal.y);
float wesAlt   = uWesSnowMinAltitudeEnabled > 0.5
               ? smoothstep(uWesSnowMinAltitude - uWesSnowAltitudeBlend, uWesSnowMinAltitude, worldY) : 1.0;
float wesSnow  = clamp(uWesSnowCoverage * wesUp * wesAlt, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb * mix(1.0, 0.62, uWesWetness), uWesSnowColor, wesSnow);
roughnessFactor  = mix(mix(roughnessFactor, 0.18, uWesWetness), uWesSnowRoughness, wesSnow);
```

Bu bloğun özellikleri:

- **Sıfır yeni sampler.** Kaskad bütçesi değişmez (ENV-17).
- **Define yok.** Mevsim değişimi yeniden derleme tetiklemez.
- **Örtü 0 iken kimlik.** `mix(x, y, 0) = x`, dolayısıyla eski görünüm aynen kalır (ENV-00).
- **Authored veriye dokunmaz.** Paint ağırlıkları, yükseklik ve physicalMaterial okunmaz bile (ENV-03).
- **Tek değişiklik iki terrain türünü kapsar:** legacy Landscape aynı CDLOD materyalinden geçer.
- Normal ve depth pass materyalleri değişmez.

**K2b (dokulu kar):** `LT_Snow_BC.png` ve `LT_Snow_Roughness.webp` gibi bir kar dokusu, mevcut `sampler2DArray`'e ek bir dilim olarak eklenir; yine yeni sampler yoktur. Dizinin 8 boya katmanının üstüne dilim kabul edip etmediği K2b spike'ıdır (E-025).

**Islaklık konvansiyonu:** deformasyon sistemi iz ıslaklığını katman `wetness` profiliyle roughness'ı düşürerek çiziyor (`terrainDeformation.ts`). WES ıslaklığı aynı yönde ve çarpımsaldır, iz sistemini ezmez. İkisi birlikte "ıslak zemindeki iz" verir.

### 9.2. Mesh materyalleri ve foliage (K2)

- **Mesh:** `materials.ts`'deki layer blend yaması `forgeLayerAmount`'u `environment` sürücüsü varsa paylaşılan `wesSnowCoverage`/`wesWetness` uniform'uyla çarpar. Mevcut `slope` sürücüsü ve world-normal varying'i "yukarı bakan yüzey" maskesini zaten sağlar. Yeni sampler yok; sürücü seçimi program cache key'ine girer.
- **Foliage (iğne yaprak):** `snow.accept` tipleri için foliage materyaline küçük bir world-normal kar yaması zincirlenir. Aynı uniform'lar kullanılır; foliage-fade ve world-mask zinciri korunur (ENV-16).
- **Yanlış beyazlama riski:** dal altı ve gövde de beyazlayabilir. Çözüm sanatçı tarafında olur: `maskTexture` sürücülü kar layer'ı ya da `vertexColor` maskesi. Bunlar mevcut sürücülerdir.

### 9.3. Görsel birikim modeli (K3) `[KARAR v0.3]`

`surfaceCondition.ts` saf, deterministik ve **global**dir (tek değer çifti). Sabit 0.25 s simülasyon adımıyla çalışır; adım içi kapalı formdur.

```text
snowfall  = (preset == snow) ? intensity · accumulationRate : 0     // örtü/saat (oyun saati)
melt      = (preset != snow) ? meltRate · sunFactor(hour)   : 0
coverage  = clamp(coverage + (snowfall − melt) · dtHours, 0, 1)
wetTarget = (preset == rain) ? intensity : 0
wetness  += (wetTarget − wetness) · (1 − exp(−dtHours / (wetTarget > wetness ? wetUpHours : dryHours)))
```

- Oranlar actor'de opsiyonel K3 alanlarıdır (`surface.accumulationRate`, `meltRate`, `wetUpHours`, `dryHours`). Varsayılanlar K3 görsel kabulünde seçilir.
- Kullanıcı slider'la örtüyü elle ayarlarsa `surfaceSource = "manual"` olur ve simülasyon o değerden devam eder. Panel kaynağı gösterir.
- Durum oyun saatiyle (`dtHours`) ilerler. Pause'da büyümez; hız ve kare hızı bağımsızdır (ENV-08, ENV-14).

### 9.4. Bölgesel örtü (K4)

Tile/hücre başına R8 örtü maskesi, lazy catch-up, sınır karışımı ve kayıt K4'tedir (v0.2 §6.5 ilkeleri geçerli). v1'in global değeri o zaman "bölge yoksa varsayılan" olarak kalır.

---

## 10. Yağış görselleri (K3)

**Karar `[KARAR v0.3]`:** VFX Lite (`particleEffect.ts`, CPU sim + `THREE.Points`) kullanılmaz. Yeni `engine/render-three/precipitation.ts` şöyle çalışır:

- Kamerayı izleyen bir hacim, örneğin 40×20×40 m.
- **Tek draw call**, `InstancedBufferGeometry`.
- Damla/kar tanesi konumu vertex shader'da `(seed, zaman, rüzgâr)` fonksiyonuyla hesaplanır ve hacim içinde wrap edilir. CPU'da per-particle iş yoktur.
- Yağmur hareket yönünde uzatılmış quad'dır; kar dönen küçük sprite'tır.
- Yoğunluk `intensity × kalite profili` (`engine/perf/qualityProfiles.ts`) ile ölçeklenir.
- Overdraw ölçülür; düşük kalitede yarıçap ve sayı azalır.
- Ses mevcut `soundCue`/audio modülüyle çalan bir döngüdür. Ses asset'i içerik işidir (E-023).
- Rüzgâr: v1'de preset başına sabit eğim vektörü. Foliage rüzgârı ve global `windVector` K5'tedir.
- Kapsam dışı: çatı altında kesilme, su halkaları, ekranda damla.

---

## 11. Fizik sınırı ve K6 yolu

**Bugün:** tekerlek yüzey tepkisi paint katmanının `physicalMaterial`'ından gelir (`terrainSurface.ts` → `resolveSurfaceSample` → `computeWheelSurfaceResponse`). Yumuşak zemin, gömülme ve iz bu hattadır.

**v1 (K1–K3):** WES bu hatta **hiç bağlanmaz**. ENV-12, örtü 0 ve 1 iken aynı tekerlek sorgusunun aynı `SurfaceSample`'ı verdiğini kanıtlar.

> Sonuç: kışın "beyaz görünen ama çim gibi tutan" zemin K2–K3'ün **beklenen** davranışıdır (DEC-WES-03). Offroad bunu bilerek kullanır. Kalıcı karlı rota gerekiyorsa bugün de mümkündür: terrain'e `snow` physical material'lı bir paint katmanı boyanır.

**K6 önerisi:**

- `createPhysicalMaterialSurfaceProvider` sarmalanır. Örtü/derinlik değeri, `snow` (ve ıslakken `mud`) preset'inin ağırlığını mevcut katman karışımına ekler; karışım `WeightedSurfaceMaterial` ile yapılır.
- Tek kaynak `SurfaceConditionState`'tir (K4 bölgesel). Shader çıktısı asla fiziğe girdi olmaz.
- Kabul: aynı rota/araç/yük, sabit fizik adımı, A/B ölçümü (v0.2 §9.1 senaryosu korunur).

---

## 12. Editör UX — önizleme ve level varsayılanı `[KARAR v0.3, E-018]`

v0.2'deki Draft/Applied/Revert ayrı bir veri modeliydi. v0.3 aynı güvenceyi mevcut mekanizmalarla verir.

| Kavram | v0.3 karşılığı | Kaydedilir mi |
|---|---|---|
| **Level varsayılanı** | `layout.worldEnvironment` alanları. Details'te normal alan; her değişiklik bir `EditorHistory` komutu | Evet (Save Layout ile) |
| **Önizleme** | Editör kabuğunda geçici `WorldEnvironmentState`: saat scrub'ı, oynat/durdur, mevsim/hava/örtü önizleme seçimleri | **Hayır**; level yeniden açılınca varsayılana döner |
| **Apply** | "Önizlemeyi level varsayılanı yap" düğmesi = **tek undo adımı** | Evet |
| **Revert** | "Önizlemeyi sıfırla" = önizleme state'ini varsayılana eşitler. Undo yığınına girmez (veri değişmez) | — |
| **Play** | Her zaman **level varsayılanından** başlar; önizleme Play'e taşınmaz | — |

**Panel (World Environment Details):**

1. **Önizleme şeridi** (üstte, "Preview" etiketli; değişiklikler kaydedilmez):
   - Saat slider'ı (00:00–24:00), oynat/durdur, önizleme hızı.
   - Mevsim düğmeleri: Spring/Summer/Autumn/Winter. "Winter" örtüyü `winterSnowCoverage`'a getirir.
   - Hava düğmeleri ve intensity.
   - Kar örtüsü ve ıslaklık slider'ları.
   - "Varsayılan yap" ve "Sıfırla" düğmeleri.
2. **Level varsayılanları:** §5.1 alanları gruplu olarak (Time, Sun Path, Night, Season, Weather, Surface).
3. **Doğrulama listesi:**
   - Eksik environment actor'leri (§7.2).
   - Mevsim varyantı tanımsız Foliage Type'lar (bilgi).
   - Manifest'te bulunmayan varyant mesh'i (uyarı).
   - `environment` sürücüsü olmayan ama kar beklenen materyaller (bilgi).

**Kirlilik:** önizleme değişiklikleri layout'u kirli işaretlemez. Toolbar'daki kaydedilmemiş değişiklik göstergesi yalnız varsayılan değişince yanar (ENV-15).

**Sun gizmo'su:** WES açıkken Sun'ın rotasyon alanları Details'te "WES tarafından yönetiliyor" uyarısıyla salt okunur gösterilir. Bu bir UI kısıtıdır; veri modeli değişmez.

---

## 13. Play, runtime ve save-game

- `worldEnvironmentModule` (capability, `createDefaultRuntimeModules()` listesinde). Fork onu kendi modül listesinden çıkarabilir; o zaman Play authored görünümle çalışır.
  - `onLevelLoaded`: actor'ü okur, state'i varsayılandan kurar.
  - `update(simDelta)`: saati ilerletir, K3 birikimi adımlar.
  - `onLevelUnloaded`: state'i bırakır.
  - Servisi `runtimeServiceKeys.worldEnvironment` ile yayınlar.
- Render uygulaması `RuntimeSceneApp`'in kare döngüsünde `AuthoredEnvironment.applyEnvironment(resolve(...))` çağrısıyla yapılır. Değişmeyen karelerde iş yapılmaz (state revision sayacı).
- **Game starter:** `templates/game-starter/` sahne kodu yazmadan çalışmaya devam eder. Fixture level'ına World Environment eklenmesi K1 kabulünün parçasıdır (`tests/smoke/game-starter.spec.ts`).
- **Save-game (K4, E-017):** gerekirse `SaveGamePayload.environment?: { hour, season, weather, surface }` eklenir; `SAVE_GAME_CONTRACT.md` güncellenir. Authored varsayılan ile oyun kaydı ayrı kalır.

---

## 14. World Builder bağı (K4)

| World Builder aşaması | WES bağı |
|---|---|
| 02 — Scene & Environment Setup | World Environment actor'ünü ve varsayılanlarını önerir; aynı undo/preview kuralları |
| 07 — Terrain Detail & Surface Paint | Kar kabul/yükseklik parametreleri ve (K4) bölgesel örtü maskesi kaynakları; paint WES'e ait değildir |
| 09 — Foliage & Rock Distribution | Foliage Type seçimi; mevsim varyantları tipte yaşadığı için scatter mevsimden bağımsız |
| 12 — Final Lighting & Validation | Yaz-öğle / kış-kar / gece senaryolarında ekran görüntüsü ve perf kaydı |

**İlke:** mevsim değiştirmek World Builder stage'lerini yeniden çalıştırmaz. WES World Builder'ın verisine geri yazmaz. WES, World Builder'ı **beklemeden** K1–K3'ü tamamlar.

---

## 15. Performans ve ölçüm

**Araçlar `[KOD]`:**
- `?debug` perf overlay
- `engine/perf/gpuTimer.ts`, `gpuSweep.ts`, `frameCapture.ts`
- `npm run perf:browser`, `npm run perf:quality`
- Kalite profilleri `engine/perf/qualityProfiles.ts`

**Baz çizgisi:** OPEN_WORLD_PLAN'daki bütçe tablosu (orta seviye masaüstü, 60 Hz; arazi GPU < 3 ms) WES'in üstüne bindiği bütçedir.

**Protokol:**
- Aynı kamera ve aynı `WesValley` sahnesi; WES kapalı → açık (yaz-öğle) → kış-kar → gece-yağmur.
- Her senaryoda kaydedilir:
  - Kayıt bilgileri: `commit / tarayıcı / GPU / çözünürlük / DPR / kalite profili`
  - Kare süreleri: `p50/p95/p99 frame ms`, `GPU ms`
  - Sahne yükü: `draw calls / üçgen / JS heap / renderer.info (geometri, doku, program sayısı)`
- Ek ölçümler:
  - IBL yakalama süresi.
  - Mevsim geçişinde en uzun kare.
- K3 için 10 dakikalık bellek plato testi.

**Kurallar:**
- **Ölçülmeyen değer başarı gibi raporlanmaz.**
- WES'e özel eşikler K1 baz ölçümünden sonra kullanıcıyla belirlenir (E-015).
- Her kapı WES açık/kapalı **farkını** raporlar.

---

## 16. Fazlar ve biletler

Her bilet aynı kapıdan geçer:

- `npx tsc --noEmit`
- `npm run test:engine` (çalışırken `--filter`, kapanışta tam suite)
- `npm run build:verify` (engine işleri için)
- İlgili Playwright smoke'u
- Değişen alanlar için `droppedFields` ve `serializationDrift` kapsamı

Her bilet `main`'e doğrudan gider (CLAUDE.md iş kuralı).

### K1 — Saat, güneş, atmosfer, editör önizlemesi

| Bilet | İş | Dosyalar | Kanıt |
|---|---|---|---|
| **WES-002** | Veri sözleşmesi ve kayıt | `engine/environment/worldEnvironment.ts`, `engine/scene/layout.ts`, `tools/saveValidator.ts` (`validateWorldEnvironment`), `EditorUi.ts` singleton kaydı, `environmentDetails.ts` (alanlar) | `tests/engine/worldEnvironment.test.ts` (normalize/clamp/enum fallback), `droppedFields` + `serializationDrift` genişletmesi; ENV-00, ENV-09 |
| **WES-003** | Saat + güneş yolu (saf) | `engine/environment/worldClock.ts`, `sunPath.ts` (+ Sun rotasyonundan ters türetme), `weatherPresets.ts`, `environmentResolve.ts`, `recapturePolicy.ts` | Aynı test dosyası: 24h wrap, 06/12/18 yön vektörleri, 30/60/144 Hz eşitliği, preset kimliği (`clear` = authored), yakalama eşikleri; ENV-06, ENV-14, ENV-18 |
| **WES-004** | Atmosfer bağı | `authoredEnvironment.ts` (`applyEnvironment`, `resolveSunDirection`), `SceneApp.ts` + `RuntimeSceneApp.ts` (sun three nesnesi override'ı, ambient çarpanı) | `tests/engine/authoredEnvironment.test.ts` (headless three: override authored actor'ü değiştirmez); `runtime-parity.spec.ts` yeşil; ENV-00, ENV-16 |
| **WES-005** | Editör önizlemesi + Play modülü | `environmentDetails.ts` (önizleme şeridi, varsayılan yap/sıfırla), `src/scene/capabilities/worldEnvironmentModule.ts`, `runtimeServiceKeys.ts`, `defaultRuntimeModules.ts` | `tests/engine/worldEnvironmentModule.test.ts` (TimeControl pause/scale), `tests/smoke/world-environment.spec.ts`: actor ekle → scrub → layout kirli değil → varsayılan yap → kaydet → yeniden aç → Play varsayılandan başlar; ENV-06, ENV-15 |

**K1 kabulü:**
- ENV-00, 06, 09, 14, 15, 16, 18.
- Yaz-öğle / gün batımı / gece / bulutlu / sisli ekran görüntüleri.
- WES açık/kapalı perf farkı.
- **K1 "kış görünümü" demek değildir.**

### K2 — Kışın görünür dönüşümü

| Bilet | İş | Dosyalar | Kanıt |
|---|---|---|---|
| **WES-006** | Terrain kar/ıslaklık (K2a) | `engine/render-three/environmentUniforms.ts`, `terrain/terrainMaterial.ts` | `terrainRender.test.ts` genişletmesi (sampler sayısı değişmedi, cache key sabit); tile/weight byte karşılaştırması; ENV-03, ENV-17 |
| **WES-007** | Materyal kar/ıslaklık sürücüsü | `engine/assets/material.ts` (normalizer), `engine/render-three/materials.ts`, Material Editor alanı | Materyal round-trip testi; `slope` + `snowCoverage` ile kaya/çatı ekran görüntüsü; ENV-01 |
| **WES-008** | Mevsimsel Foliage Type | `engine/scene/foliage.ts` (`seasons`, `snow`), `engine/render-three/foliage.ts`, `src/scene/foliageCellStreaming.ts`, ön yükleme; Foliage Type editörü alanları | Foliage Type round-trip; varyant değişiminde instance matrisleri ve sayıları eşit; dispose sonrası `renderer.info` sabit; ENV-02, ENV-13 |
| WES-008b (ops.) | Terrain katmanı `seasonTint` | `engine/terrain/terrainDefinition.ts`, terrain layer köprüsü, `terrainMaterial.ts` | Terrain serialization-drift testi |
| **WES-009** | `WesValley` kabul sahnesi | `public/assets/starter-content/Levels/WesValley.level.json` + 1×1 terrain + foliage sidecar + Foliage Type'lar (LandscapeTest asset'lerinden) | `tests/smoke/world-environment.spec.ts`: yaz ↔ kış ekran görüntüleri; ENV-01 |
| WES-010 (ops.) | Gece ışıkları | `LayoutLightActor.activation`, `validateLightActor`, ışık bağı | Allowlist testi; gece ekran görüntüsü |

**K2 kabulü:**
- ENV-01, 02, 03, 13, 17.
- `WesValley`'de "Winter" tek tıkla şunları birlikte değiştirir: gök, terrain karı (dik kayada az, düzlükte çok), çıplak yaprak döken ağaç, karlı çam, karlı kaya/çatı.
- "Summer" authored görünümü **piksel-kimlik toleransında** geri getirir.

### K3 — Yağış ve görsel birikim

| Bilet | İş | Dosyalar | Kanıt |
|---|---|---|---|
| **WES-011** | Yağış renderer'ı + ses | `engine/render-three/precipitation.ts`, `authoredEnvironment.ts` bağı, kalite profili | Overdraw/GPU ms ölçümü; düşük/orta/yüksek kalite ekran görüntüsü |
| **WES-012** | Global birikim/erime/kuruma | `engine/environment/surfaceCondition.ts`, modül adımı, panelde kaynak gösterimi | Deterministik adım testleri; ENV-04, 05, 08, 14 |
| **WES-013** | K3 kabul ve perf taraması | Smoke + `perf:browser` raporu | ENV-11, ENV-12; `docs/reports/` altında kabul raporu |

**K3 kabulü:** K0–K3 kapanınca onaylı ilk kapsam tamamdır. Perf, save/reload ve editör/Play sonuçları rapora eklenir.

### K4–K6 — Bağımsız genişletmeler

| Kapı | Bilet | Kapsam | Bağımlılık |
|---|---|---|---|
| K4 | WES-014 | Bölgesel örtü haritası (hücre/tile), save-game `environment` bloğu, World Builder 02/07/09/12 bağı, mevsim HLOD'u, actor ağaç varyantı | K3 + World Builder F1 |
| K5 | WES-015 | Takvim (`seasonPhase`), mevsimsel gün uzunluğu, kural tabanlı hava geçişleri (seed), environment profile asset'i, global rüzgâr, fırtına | K4 ya da kanıtlanmış alt küme |
| K6 | WES-016 | Örtü/derinlik → surface provider (§11), Offroad A/B testleri | K3/K4 + oyun kararı |

---

## 17. Kabul testleri

| ID | Faz | Senaryo / geçme koşulu | Nerede |
|---|---|---|---|
| **ENV-00** | K1 | Actor'süz level: render/save/Play aynı. Actor varsayılanla eklenince Sun yönü sıçramaz (ters türetme) | `worldEnvironment.test.ts`, `runtime-parity.spec.ts`, `game-starter.spec.ts` |
| **ENV-01** | K2 | WesValley kış: gök + terrain karı + çıplak ağaç + karlı çam/kaya/çatı; yaz authored görünümü geri getirir | `world-environment.spec.ts` (ekran görüntüsü) |
| **ENV-02** | K2 | Varyant değişiminde instance dizisi, sayısı ve matrisleri eşit; eksik varyantta uyarı + taban mesh | `foliage` engine testi |
| **ENV-03** | K2 | Mevsim/örtü değişimi tile yükseklik/ağırlık byte'larını ve `physicalMaterial`'ı değiştirmez | terrain engine testi |
| **ENV-04** | K3 | Kar yağarken örtü artar, durunca sıfırlanmaz, erime oranıyla azalır | `surfaceCondition` testi |
| **ENV-05** | K3 | Yağmurda ıslaklık artar, kesilince `dryHours` ile kurur | aynı |
| **ENV-06** | K1 | Pause, scrub, hız, 24h wrap; gündüz/gece okunurluğu; editör/Play ayrımı | `worldEnvironment.test.ts`, smoke |
| **ENV-07** | K4 | Bölgesel örtüde hücre sınırında dikiş/pop yok | K4 |
| **ENV-08** | K3/K5 | Aynı girdi dizisi → aynı örtü/ıslaklık (tolerans içinde) | `surfaceCondition` testi |
| **ENV-09** | K1 | `worldEnvironment` round-trip; bilinmeyen alan `dropped[]`'da | `droppedFields`, `serializationDrift` |
| **ENV-10** | K4 | World Builder tekrarlı stage'de WES ayarları ve manuel override'lar korunur | K4 |
| **ENV-11** | K1–K3 | Senaryo taraması; frame p50/p95/p99, GPU ms, draw call, heap, program sayısı kayıtlı | `perf:browser` raporu |
| **ENV-12** | K1–K3 | Örtü 0 ve 1'de aynı tekerlek sorgusu aynı `SurfaceSample` | `surfaceResponse` testi |
| **ENV-13** | K2 | Mevsim gidip gelince geometri/doku/program sayısı sınırlı (sızıntı yok) | smoke (`renderer.info`) |
| **ENV-14** | K1/K3 | 30/60/144 Hz dış güncellemede aynı oyun saati ve örtü | engine testi |
| **ENV-15** | K1 | Önizleme kaydedilmez ve layout'u kirletmez; "varsayılan yap" tek undo adımı; Play varsayılandan başlar | smoke |
| **ENV-16** `yeni` | K1/K2 | Terrain, foliage ve mesh materyallerinde önceki `onBeforeCompile`/cache key zinciri korunur (fade, world-mask, kaskad, reflection-capture) | engine testi |
| **ENV-17** `yeni` | K2 | `terrainLitFragmentSamplers` ve kaskad sayısı K2a ile değişmez | `terrainRender` testi |
| **ENV-18** `yeni` | K1 | IBL yakalama eşik/aralık kuralına uyar; scrub sırasında yakalama yok | `worldEnvironment.test.ts` |

---

## 18. Karar defteri

| ID | Konu | Karar | Durum |
|---|---|---|---|
| E-001 | Ürün konumu | Genel Engine/Editor yeteneği | `[ONAYLANDI]` |
| E-002 | İlk kapsam | Manuel mevsim/hava + saat, kademeli | `[ONAYLANDI]` |
| E-003 | Mevsim UI | Dört manuel preset; `seasonPhase` K5 | Onaylı kapsamdan türetildi |
| E-004 | Asset family | Materyal + gerekirse mesh; varyant Foliage Type'ta | `[ONAYLANDI]`; yer `[KARAR v0.3]` |
| E-005 | Authored paint / kar | Uniform tabanlı overlay; paint okunmaz | **Kapandı** `[KARAR v0.3]` |
| E-006 | Kar–fizik sınırı | Önce görsel; K6'da surface provider | `[ONAYLANDI]` |
| E-007 | Astronomik doğruluk | Art-directed yol, aynı ışık gece ay olur | **Kapandı** `[KARAR v0.3]` |
| E-008 | Platform | Masaüstü WebGL2 | `[ONAYLANDI]` |
| E-009 | Hava bölgeleri | v1 tek global state; bölgesel K4 | **Kapandı** `[KARAR v0.3]` |
| E-010 | Kar birimi | K2–K3 `snowCoverage` (0..1); fiziksel derinlik K6 | **Kapandı (K2–K3)** `[KARAR v0.3]` |
| E-011 | Demo sahnesi | `WesValley`, LandscapeTest asset'leriyle; LandscapeTest'e dokunulmaz | **Kapandı** `[KARAR v0.3]` |
| E-012 | Offroad oyun etkisi | K6'ya kadar yok; kurallar oyun modülünde servisle | Onaylı sınırdan türetildi |
| E-013 | Kayıt yeri | Level içi singleton `worldEnvironment` | **Kapandı** `[KARAR v0.3]` |
| E-014 | Shader entegrasyonu | Terrain: `terrainMaterial.ts` içinde uniform blok; mesh: layer blend sürücüsü; foliage: zincirli yama | **Kapandı** `[KARAR v0.3]` |
| E-015 | GPU/FPS/bellek eşiği | K1 baz ölçümünden sonra kullanıcıyla | `[AÇIK — ölçüm]` |
| E-016 | Kış preset karı | "Winter" düğmesi örtüyü `winterSnowCoverage`'a getirir; veri bağımsız | `[KARAR v0.3]`, K2 UX testinde gözden geçirilir |
| E-017 | Runtime oyun kaydı | Gerekirse K4'te `SaveGamePayload.environment` | `[AÇIK — oyun gereksinimi]` |
| **E-018** | Preview/Apply modeli | Önizleme geçici; "varsayılan yap" tek undo komutu | `[KARAR v0.3]` |
| **E-019** | Play'de saat varsayılanı | `dayLengthMinutes = 0` (saat durur); level başına açılır | `[AÇIK — ürün]`; öneri 0 |
| **E-020** | Eksik environment actor'ü | Uyarı + tek tıkla ekleme; gizli kubbe yok | `[KARAR v0.3]` |
| **E-021** | Preset verisinin yeri | v1 motor kodunda; fork'a özgü preset K5'te veri dosyası | `[ÖNERİ]` |
| **E-022** | Ay ışığı | Aynı directional ışık, ek gölge maliyeti yok | `[KARAR v0.3]` |
| **E-023** | İçerik boşlukları | Kış çıplak ağaç mesh'i, çatı/ev modeli, yağmur/kar ses döngüsü | `[AÇIK — içerik]`; K2 başlamadan temin edilmeli |
| **E-024** | HLOD ve mevsim | Proxy'ler taban görünümle üretilir; kışta uzak orman yeşil kalabilir | `[AÇIK — K2 ölçüm]`; çözüm K4 |
| **E-025** | Dokulu kar dilimi | Kar dokusu `sampler2DArray`'e ek dilim mi | `[AÇIK — K2b spike]` |

---

## 19. Riskler

| Risk | Etki | Azaltma |
|---|---|---|
| Saat override'ının kabuklardan birinde unutulması | Editör ve Play farklı güneş | Tek giriş `AuthoredEnvironment.applyEnvironment`; `runtime-parity.spec.ts` |
| IBL yakalamanın kare takılması | Gün batımı akışında mikro takılma | Kadans politikası, ölçüm, gerekirse yakalama çözünürlüğünü düşürme |
| Yeni sampler'ın kaskadları azaltması | Uzak gölge kaybı | K2a sıfır sampler; ENV-17 |
| Yama zincirinin kırılması | Foliage fade veya world-mask kaybolur | `worldMaskPatch.ts` kalıbı; ENV-16 |
| Varyant mesh değişiminde takılma | Mevsim geçişinde kare düşmesi | Ön yükleme; grup başına kademeli yeniden kurma |
| Alçak güneşte gölge kalitesi | Uzun/titrek gölgeler | Minimum gölge yüksekliği; görsel kabul kareleri |
| Allowlist unutulması | Alan kayıtta düşer | `droppedFields` ağı + drift testleri her bilette |
| HLOD mevsim uyumsuzluğu | Uzak orman kışın yeşil | E-024; K2 ölçümü; K4 çözümü |
| `SceneApp.ts`'in büyüklüğü | Değişiklik riski | WES mantığı `engine/`'de; kabuk değişiklikleri birkaç satır |
| Görsel kar ile fiziksel çim farkı | Oyuncu beklentisi | DEC-WES-03; Offroad'a not; kalıcı kar için `snow` paint katmanı |

---

## 20. Kaynaklar

**Repo içi (doğrulanan):** §3.1'deki dosya yolları;
[OPEN_WORLD_PLAN.md](../OPEN_WORLD_PLAN.md) (bütçe tablosu, Faz 6–8, Faz 10 Data Layers);
[TERRAIN_DEFORMATION_PLAN.md](../TERRAIN_DEFORMATION_PLAN.md) (yüzey profili, ıslak çamur katmanı);
[WORLD_TERRAIN_WATER_BODY_PLAN.md](../WORLD_TERRAIN_WATER_BODY_PLAN.md);
`docs/architecture/SAVE_GAME_CONTRACT.md`;
`docs/architecture/FORGE_LAYERED_RUNTIME_PLAN.md`;
`CLAUDE.md` / `AGENTS.md` (allowlist ve gate kuralları).

**Repo dışı proje belgeleri (bu repoda yok; tarihli bağlam):** Forge Offroad GDD v0.3, Forge Offroad teknik durum raporu 2026-10-23 (commit `84ff7cf`; v0.3 bunun yerine güncel kodu esas alır), v0.2 Drive kopyaları.

**Dış teknik kaynaklar (26 Ekim 2026 erişim; Forge'da hazır özellik kanıtı değildir):**
- Epic — [Landscape Materials](https://dev.epicgames.com/documentation/unreal-engine/landscape-materials-in-unreal-engine), [Layered Materials](https://dev.epicgames.com/documentation/unreal-engine/creating-layered-materials-in-unreal-engine), [Sky Atmosphere](https://dev.epicgames.com/documentation/unreal-engine/sky-atmosphere-component-in-unreal-engine), [Volumetric Cloud](https://dev.epicgames.com/documentation/unreal-engine/volumetric-cloud-component-in-unreal-engine)
- Unity — [Terrain](https://docs.unity.com/en-us/engine/6000.5/manual/creating-environments/script-terrain)
- three.js — [Material.onBeforeCompile](https://threejs.org/docs/pages/Material.html), [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh), [DataArrayTexture](https://threejs.org/docs/pages/DataArrayTexture.html), [Sky](https://threejs.org/docs/pages/Sky.html), [FogExp2](https://threejs.org/docs/pages/FogExp2.html), [WebGPURenderer](https://threejs.org/manual/pages/webgpurenderer)
- Khronos — [`KHR_materials_variants`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_variants/README.md). v0.3'te kullanılmıyor: varyant Foliage Type düzeyinde ve mesh değişimini de kapsıyor. Tek GLB içinde materyal varyantı gerekirse K4'te değerlendirilir.
- MDN — [WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)

---

## 21. Sürüm geçmişi

| Sürüm | Tarih | Değişiklik |
|---|---|---|
| **0.3** | **2026-10-27** | `main@f9aa05f` üzerinde repo doğrulaması; K0 kapandı. Yetenek matrisi, düzeltilen varsayımlar, bağlayıcı kısıtlar. E-005/007/009/010/011/013/014 kapandı; E-018–E-025 eklendi. Modül yerleşimi, `LayoutWorldEnvironment` sözleşmesi, override ilkesi, IBL kadansı, terrain/materyal/foliage entegrasyonu, yağış renderer kararı, birikim modeli, editör UX'i, dosya bazlı WES-002–016 ve ENV-16–18 eklendi. |
| 0.2 | 2026-10-26 | Dört ürün kararı onaylandı; K0–K6 ve WES-001–013 kırılımı (repo açılmadan). |
| 0.1 | 2026-10-26 | İlk araştırma: Unreal/Unity/three.js/glTF değerlendirmesi, mimari taslak, test/faz/karar defteri. |
