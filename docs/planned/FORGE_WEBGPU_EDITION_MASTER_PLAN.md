# FORGE WEBGPU — GEÇİŞ VE YENİDEN KURULUM PLANI

**Sürüm:** v0.2 — 9 Kasım 2026. v0.1'in ("tek depoda iki editör") yerine geçer.
v0.1 metni: `C:\Users\emret\Documents\Forge-Archive\FORGE_WEBGPU_EDITION_MASTER_PLAN_v0.1.md`;
değişen kararlar §11'de.
**Durum:** [ÖNERİ / ONAY BEKLİYOR] — §1 kararları onay bekliyor, hiçbir faz başlamadı.
**Referans depo:** Forge WebGL = `C:\Users\emret\Desktop\Forge`, `main` @ `0396ad79`.
**three:** `0.187.0`; `three/webgpu` ve `three/tsl` girişleri ile tipleri (`@types/three` 0.187) kurulu.

> **Hedef:** Açık dünya oyunlarında daha iyi görüntü için Forge'un devamını WebGPU + TSL
> üzerine kurmak. Bugünkü Forge, **Forge WebGL** adıyla bakım moduna geçer ve basit
> projelere hizmet etmeyi sürdürür; yeni özellikler **Forge WebGPU**'da yapılır.

Etiketler: **[AÇIK]** kullanıcı kararı gerekiyor · **[ÖNERİ]** önerilen yol · **[TEST]**
gerçek GPU'da sınanmadan kabul edilmeyecek varsayım.

---

## 0. Gerekçe ve ana ilke

**Neden WebGPU.** three.js'in yeni geliştirmesi TSL/WebGPU öncelikli. r187 addon'larında
WebGPU/TSL için hazır gelenler: SSR, SSGI, TRAA, Denoise, LightProbeGrid, LightMapper,
ClusteredLighting, MeshletDrawingPipeline, VXGI, `CSMShadowNode`, `SkyMesh` ve post-process
node'larının tamamı. WebGL'de kalmak, threejs.org örneklerinin her birini elle GLSL'e
uyarlamak demek. Açık dünya için ek kazançlar: compute (okyanus FFT, partikül, culling,
terrain deformasyonu), GPU güdümlü çizim ve tek GPU cihazından birden çok canvas'a çizim
(`renderer.setCanvasTarget`).

**Ana ilke: yeniden yazılan yalnız render katmanı.** §2'deki ölçüm, motorun ~%75'inin
three.js'i hiç import etmediğini gösteriyor. World Builder, araç hasarı ve terrain
deformasyonunun çekirdekleri bu kısımda: bunlar yeniden inşa edilmez; taşınır ve yeni render
katmanına yeniden bağlanır. Yeniden yazılan üç şey var: `engine/render-three`'nin WebGL'e
özgü kısmı, render'a bağlanan orkestrasyon (`SceneApp`, `RuntimeSceneApp`) ve editör
viewport'ları. Forge 3DGameDev'den çıkarken konan kural burada da geçerli: sıfırdan yazma,
çalışan davranışı koru, küçük ve derlenen adımlarla taşı.

## 1. Karar defteri

| ID | Konu | Öneri | Gerekçe | Durum |
|---|---|---|---|---|
| D-1 | Yeni depo nasıl başlar | Forge'un **klonu** olarak (ortak git geçmişi); WebGL'e özgü render katmanı içeride modül modül değiştirilir | Render-dışı ~70k satır ve 176 motor testi ilk günden çalışır; geçiş boyunca Forge WebGL'deki düzeltmeler `git cherry-pick` ile gelir. Alternatif (boş depo + seçerek kopyalama) aynı kodu yine kopyalatır ama geçmişi ve cherry-pick'i kaybettirir | [AÇIK] |
| D-2 | Ad ve yer | GitHub `emrtrn/ForgeWebGPU`, yerel `C:\Users\emret\Desktop\ForgeWebGPU`; `emrtrn/Forge` Forge WebGL olarak kalır | Model 1 oyunlarının `upstream` adresi değişmez. GitHub kendi deposunu aynı hesaba fork'latmadığı için boş depo açılır, klon push edilir | [AÇIK] |
| D-3 | Veri formatları | Aynen korunur (level, terrain/tile, foliage, hücre ve sidecar şemaları); değişiklik yalnız sürümlü migration ile | Ridgebound level'ları açılır; Forge WebGL aynı level'ı açtığı için her faz A/B karşılaştırılabilir | [AÇIK] |
| D-4 | WebGPU olmayan cihaz | Editör gerçek WebGPU ister. Oyun runtime'ı `WebGPURenderer`'ın WebGL2 backend'iyle **uyumluluk modu** etiketiyle açılır; compute isteyen özellikler orada kapalı | Oyuncu kitlesi. "WebGPU çalışıyor" yalnız gerçek backend'de söylenir (v0.1 ADR-005 korunur) | [AÇIK] |
| D-5 | Forge WebGL'de render işi | Bugünden itibaren yeni render özelliği yok; yarım adımlar bitirilir; hata düzeltme serbest. Resmî arşiv Faz 9'da | GLSL'e harcanan her yeni saat Forge WebGPU'da yeniden yazılır | [AÇIK] |
| D-6 | Geçiş dönemi akışı | Ridgebound Faz 9'a kadar Forge WebGL'de yaşar. Render-dışı motor işi orada yapılır ve aynı gün Forge WebGPU'ya cherry-pick edilir; Faz 7 kabulünden sonra yön tersine döner | Oyun geliştirmesi kesilmez, iki depo ayrışmaz | [AÇIK] |
| D-7 | Çalışma kuralı | Forge WebGPU'da da doğrudan `main`, her adımda kapılar yeşil; uzun yaşayan dal yok | 25 Ekim 2026 kararıyla aynı | [ÖNERİ] |
| D-8 | Model 1 oyunları | minigolf, miniracer, platformer, freshcounter Forge WebGL'de kalır | Basit projeler; WebGL yeterli | [ÖNERİ] |

## 2. Envanter (9 Kasım 2026 ölçümü)

### 2.1 Katmanlar

| Katman | Boyut | Render bağımlılığı | Forge WebGPU'da |
|---|---|---|---|
| `engine/` içinde `render-three` dışındaki 23 klasör | 310 dosya, ~70k satır | three import'u yok (physics'te 1 dosya hariç); yalnız `engine/scene`'deki 9 dosya render-three'ye bağlanıyor | Klonla gelir; 9 bağlantı dosyası yeni render katmanına çevrilir |
| `tools/`, `builder/` | 65 dosya, ~44k satır | Save validator'lar, World Builder betikleri, doğrulayıcılar: yok. Test koşucusu (`tools/engine-tests.ts`) render-three'nin GLSL yamalarını da sınıyor | Taşınır; render testleri modülleriyle birlikte değişir |
| `tests/engine` | 176 dosya | Yok | Faz 1'den itibaren hep yeşil |
| `tests/smoke` | 111 spec | Tarayıcı + render | Faz faz uyarlanır |
| `engine/render-three` | 112 dosya, 23.2k satır | 41 dosya WebGL'e özgü; 24'ünde özel GLSL veya `onBeforeCompile` (~7.9k satır) | `engine/render-gpu/` olarak yeniden yazılır; eski klasör modül modül silinir |
| `src/scene` | 83 dosya, 40.7k satır (`SceneApp` 16.4k, `RuntimeSceneApp` 7.2k) | 8 dosya WebGL'e özgü | Render bağlantıları ayrı dosyalara çıkarılarak yeniden yapılandırılır |
| `src/editor` | 88 dosya, 38.8k satır | 6 ikincil viewport kendi renderer'ını kuruyor | Paneller taşınır; viewport'lar tek GPU cihazına bağlanır |

### 2.2 Üç değerli sistem

| Sistem | Renderer'dan bağımsız çekirdek | Render ucu | Forge WebGPU işi |
|---|---|---|---|
| World Builder | `engine/worldbuilder` (47 dosya, 12.6k), `tools/world` (17 dosya, 2.8k), önizleme worker'ı | Yok; çıktısı level verisi | Taşınır; görüntüsü terrain, foliage ve su portlarıyla tamamlanır |
| Araç hasarı | `engine/physics/deformable`, `fracture`, `vehicle` (~3.2k) | `deformableMeshSync.ts` (`BufferAttribute`, WebGPU'da aynen çalışır), `dentWear.ts` (101 satır `onBeforeCompile`) | `dentWear` TSL'e; gerisi taşınır |
| Terrain deformasyonu | `engine/terrain` (50 dosya, 7k) | `terrainDeformation.ts` (`DataTexture`, aynen çalışır) | Terrain materyalinin deformasyon dokusunu okuyan kısmı TSL'e |

### 2.3 r187'de hazır gelenler, sıfırdan yazılacaklar, tuzaklar

**Hazır (eşleme işi):** post-process zinciri (`GTAONode`, `BloomNode`, `DepthOfFieldNode`,
`SMAANode`, `FilmNode`, `RGBShiftNode`, `OutlineNode`); `Sky` → `SkyMesh`; CSM →
`CSMShadowNode`; `Reflector` → `reflector()`; reversed-Z → `WebGPURenderer` yapıcısındaki
`reversedDepthBuffer` seçeneği (bugünkü `EXT_clip_control` + `camera._reversedDepth` hack'i
yerine). `TransformControls`, `GLTFLoader` ve `KTX2Loader` WebGPU'da çalışır.

**Sıfırdan TSL:** terrain CDLOD materyali (birikinti, kostik ve kıyı ıslaklığı dahil), göl,
nehir ve okyanus (FFT bugün `RawShaderMaterial` ping-pong'u, compute'a döner), reflection
capture, foliage impostor/rüzgâr/fade, partiküller, height fog, bulut katmanı,
`worldMaskPatch`, `aoSurfaceMaterials`, `materials.ts` katmanlaması, `dentWear`.

**WebGPU'ya özgü tuzaklar:**
- WebGPU'da nokta boyutu yok: `Points` (`particleEffect.ts`, `lakeUnderwaterPass.ts`) →
  `PointsNodeMaterial` + `Sprite` + instancing.
- `fragmentNode` kullanan materyal MRT birleşimini atlar (`NodeMaterial.js:525`); TRAA, SSR
  ve SSGI'ye girecek her materyal slot tabanlı olmalı (§3.3).
- `VelocityNode` önceki kare için `positionPrevious` kullanıyor; `positionNode` ile zamanla
  değişen yer değiştirmede (rüzgâr, CDLOD morph) TRAA izi riski var. [TEST]
- `MeshletDrawingPipeline` yalnız opak/alpha-test ve geometriyi değiştirmeyen materyallerle
  çalışır: terrain'e ve rüzgârlı foliage'a uymaz, statik prop'lar içindir.
- Okumalar asenkron: `readRenderTargetPixelsAsync`, `resolveTimestampsAsync`.
- `PostProcessing` r183'ten beri `RenderPipeline`'ın eski adı; yeni kod `RenderPipeline` kullanır.

## 3. Hedef mimari

1. **Tek renderer:** `WebGPURenderer` (uyumluluk modunda WebGL2 backend'i). Yeni kodda
   `WebGLRenderer`, `ShaderMaterial`, `onBeforeCompile` ve `EffectComposer` yasak;
   `verify:imports` bunu denetler.
2. **Tek GPU cihazı:** ana viewport, ikincil editör viewport'ları (Material, Static Mesh,
   Skeletal, Particle önizleme, Actor Script) ve thumbnail'ler aynı renderer'ı
   `setCanvasTarget` ile paylaşır. Bugün 7 ayrı renderer yaratma noktası var ve her biri
   dokuların kendi kopyasını tutuyor.
3. **Materyal = slot kompozisyonu:** `MeshStandardNodeMaterial` / `MeshPhysicalNodeMaterial`
   slotları (`colorNode`, `normalNode`, `positionNode`, `roughnessNode`, `metalnessNode`,
   `emissiveNode`, `opacityNode`). String yaması yerine birleştirilebilir TSL özellikleri:
   rüzgâr, foliage fade, world mask, ıslaklık, dent wear. `fragmentNode` yalnız ekran-uzayı
   ve yardımcı pass'lerde.
4. **Tek `RenderPipeline`:** sahne pass'i MRT ile (`output`, `normal`, `velocity`; SSR'nin
   stochastic modu için `specularColorBlended`, `specularF90`). Post zinciri layout'taki
   `LayoutPostProcess` verisinden kurulur; veri modeli değişmez.
5. **Veri otoritesi değişmez:** yükseklik, collision ve gameplay ortak motorda; GPU yalnız
   görüntü üretir. Picking CPU heightfield raycast'i olarak kalır.
6. **Özellik kapsama tablosu (`renderFeatures`):** her render modülü "taşındı / kısmi / yok"
   durumuyla kayıtlı; editörde rozet, `?debug` overlay'inde liste. Taşınmamış özellik
   sessizce kaybolmaz.
7. **Ölçüm:** backend kimliği, GPU timestamp (`trackTimestamp`), cihaz kaybı. Ölçülemeyen
   metrik "N/A" yazılır; CPU süresi GPU süresi diye gösterilmez.
8. **Klasör:** `engine/render-gpu/` (`core`, `materials`, `terrain`, `foliage`,
   `environment`, `water`, `post`, `vfx`, `editor`, `diagnostics`). `engine/render-three/`
   her modülün karşılığı geldikçe silinir; Faz 7 sonunda yok.
9. **`SceneApp` toptan yeniden yazılmaz** (16.4k satır, ~300 metot): her modül taşınırken
   bağlantısı ayrı bir `*Host` dosyasına çıkarılır; Faz 6 sonunda `SceneApp` yalnız
   orkestrasyon yapar.

## 4. Fazlar

Göreli boyut: S < M < L < XL (iş miktarı, takvim değil). Her adımda kapılar yeşil
(`npx tsc --noEmit`, `npm run test:engine`, motor işinde `npm run build:verify`). Her faz
Faz 0 referans setine karşı A/B ölçülür ve kullanıcı görsel kabulüyle kapanır. Işık, renk ve
render ayarı kullanıcıdadır; Claude sistemi ve parametreleri kurar.

### Faz 0 — Karar, triage, referans seti (Forge WebGL'de) · S

- [ ] §1 kararları onaylanır.
- [ ] Açık planların triage'ı (§6) kesinleşir; süren okyanus/ada adımı bitirilip commit'lenir.
- [ ] Referans seti: 4–6 sabit kamera pozu (Terrain level, Island, Ridgebound kopyası, bir
      göl/nehir sahnesi, bir gece/yerel ışık sahnesi). Her poz için ekran görüntüsü ve
      `?debug` ölçümü (FPS, GPU ms, draw call, üçgen). Gerçek GPU'lu, görünür tarayıcıda
      alınır (headless'ta canvas görüntüsü siyah çıkıyor).
- [ ] Forge WebGL'de `forge-webgl-base` etiketi (Forge WebGPU'nun ayrıldığı nokta);
      Forge WebGL'in CLAUDE.md'sine D-5 notu.

**Çıkış:** kararlar ve triage yazılı, referans seti kayıtlı.

### Faz 1 — Depo ve WebGPU iskeleti · M

- [ ] Depo: Forge'u klonla, `origin`'i `webgl` olarak yeniden adlandır, yeni boş GitHub
      deposunu `origin` ekle, push. Kimlik: package adı, sayfa başlıkları, README,
      CLAUDE.md, AGENTS.md (referans depo = Forge WebGL, bu çalışma alanından salt okunur).
      CI.
- [ ] Ajan ortamı: yeni dizin, Claude için boş hafıza demek. Dil, çalışma kuralları, Codex iş
      bölümü, parametre UI kuralları ve render ayarına girmeme notları taşınır.
- [ ] Renderer host (editör ve runtime ortak): asenkron `init()`, backend doğrulaması
      (`renderer.backend.isWebGPUBackend`), cihaz kaybı, resize/DPR, `reversedDepthBuffer`,
      temel gölge, timestamp.
- [ ] Paylaşılan cihaz: ikincil viewport'lar için `setCanvasTarget` altyapısı; thumbnail'ler
      taşınır.
- [ ] `renderFeatures` tablosu ve rozetler; WebGL'e özgü modüller hiç yaratılmadan kapatılır.
- [ ] Import kuralı: çekirdek `three`, renderer ve node'lar `three/webgpu` + `three/tsl` (ikisi
      aynı `three.core.js`'i paylaşıyor, sınıflar çoğalmaz); `verify:imports` yasak listesi.
- [ ] Seçim outline'ı (`OutlineNode`) ve gizmo: editör temel olarak kullanılabilir.
- [ ] `?debug` overlay'inin WebGPU sürümü.

**Çıkış:** editör ve runtime gerçek WebGPU'da açılıyor; GLB/PBR mesh, ışık ve temel gölge
görünüyor; seçim, undo, save ve Play çalışıyor; `test:engine` tam yeşil; taşınmamış her
özellik rozetli.

### Faz 2 — Açık dünya zemini + kalite kanıtı (KAPI) · L

- [ ] Terrain CDLOD TSL'de: `positionNode` displacement, morph, tile dikişleri, global map,
      8 boya katmanı (`sampler2DArray`), editör ve runtime tile akışı, sculpt/paint
      önizlemesi, deformasyon dokusunu okuma; gerekiyorsa gölge için
      `castShadowPositionNode`.
- [ ] Gökyüzü ve ışık: `SkyMesh` + WES, `CSMShadowNode`, height fog (TSL fog), bulut katmanı.
- [ ] Render pipeline v1: MRT (output/normal/velocity), TRAA, GTAO, bloom, tone mapping ve
      exposure.
- [ ] Stres ölçümü: büyük bir level'da (Ridgebound kopyası veya `npm run world:test`
      dünyası) draw call, CPU ve GPU kare süresi; referansla A/B.
- [ ] SSGI denemesi: aynı pozda açık/kapalı görüntü ve maliyet.
- [ ] [TEST] CDLOD morph'ta velocity doğruluğu (TRAA izi).

**Kapı:** terrain görüntüsü referanstan kötü değil, kare süresi kabul edilebilir (eşik Faz 0
ölçümüne göre birlikte belirlenir), kullanıcı görsel kabulü verdi. Bu kapı "WebGPU'ya
geçilsin mi" sorusu değil; sıra ve kapsamın düzeltildiği nokta. Örneğin CPU maliyeti
yüksekse GPU güdümlü foliage öne çekilir.

### Faz 3 — Materyal sistemi ve foliage · L

- [ ] `ForgeMaterialDef` → node materyal: albedo, ORM/roughness/metalness haritaları, normal,
      alpha, emissive, UV tiling, anisotropy, katman "lerp"; slot kuralı (§3.3).
- [ ] Material Editor önizlemesi paylaşılan cihazda.
- [ ] Özellik API'si: `worldMaskPatch`, `aoSurfaceMaterials`, foliage fade, rüzgâr.
- [ ] Foliage: instancing, rüzgâr, fade, impostor ve uzak billboard, zemin tonu, hücre akışı,
      HLOD, küçük nesne culling.
- [ ] Blocking volume, spline mesh ve diğer sahne görselleri.
- [ ] [TEST] Rüzgârlı foliage'da TRAA velocity.

**Çıkış:** Ridgebound kopyasının bitki örtüsü ve yapıları tam; A/B kayıtlı.

### Faz 4 — Değerli sistemler + VFX · M

- [ ] Terrain deformasyonu: `terrainDeformation.ts` bağlantısı, berm ve iz görselleri;
      runtime'da araçla sürüş testi.
- [ ] Araç hasarı: `deformableMeshSync` (aynen), `dentWear` TSL'e, fracture parçaları,
      debris, VFX ve ses. Static Mesh Editor (parts, Fit Zone, fracture) paylaşılan cihazda.
- [ ] World Builder uçtan uca: pencere → `/__world-random` → level'ın yeniden yüklenmesi →
      görüntü (su Faz 5'e kadar rozetli).
- [ ] VFX: partiküller (`PointsNodeMaterial` + sprite), SubUV flipbook, particle editörü
      önizlemesi. Compute partikül Faz 10'da.

**Çıkış:** üç sistemin oyun davranışı Forge WebGL referansıyla aynı; görsel kabul.

### Faz 5 — Su ve yansıma · XL (alt kabullerle)

- [ ] 5a Okyanus: FFT compute'a, yüzey, kıyı girişleri, kostik.
- [ ] 5b Göl ve nehir: yüzey, köpük, akış, kıyı ıslaklığı; planar yansıma `reflector()` ile.
- [ ] 5c Puddle ve terrain su yüzeyleri, tekerlek oyukları.
- [ ] 5d Sualtı: pass ve hacim.
- [ ] 5e Reflection capture (küp + PMREM), Sky Light, reflective surface, reflection plane.

Girdi: `OCEAN_DEVELOPMENT_PLAN`, `WATER_SYSTEM_DEVELOPMENT_PLAN`, `WATER_RDR2_LOOK_PLAN`,
`LAKE_GEOMETRY_FOAM_BAKE_PLAN`, `PUDDLE_DEVELOPMENT_PLAN`.

**Çıkış:** her alt fazın ayrı A/B ölçümü ve görsel kabulü; World Builder'ın su görüntüsü tamam.

### Faz 6 — Editörün tamamlanması · L

- [ ] Kalan viewport'lar: Skeletal/Persona, Actor Script.
- [ ] Yardımcılar ve debug çizimleri (nav mesh, collision, partition ızgarası); GPU tarama
      aracı timestamp'le.
- [ ] `SceneApp` ayrıştırması tamamlanır (§3.9).

**Çıkış:** editör smoke'ları Forge WebGPU'da geçiyor; editörde render-three izi kalmadı.

### Faz 7 — Runtime, build, CI · M

- [ ] Uyumluluk modu (WebGL2 backend) etiketli; compute isteyen özellikler orada kapalı.
- [ ] game-starter şablonları, Play akışı, `smoke:critical`.
- [ ] `build:verify`, `verify:dist --strict`, `verify:world-data` yeşil; `engine/render-three`
      silindi.
- [ ] Smoke'lar yerelde gerçek GPU ile koşar. CI'da GPU yok: WebGPU'ya bağlı testler SKIP
      olarak raporlanır, fallback başarısı WebGPU testi yerine geçmez.

**Çıkış:** Ridgebound kopyasıyla Edit → Play → Save → Reload tam döngü.

### Faz 8 — Kalite paketi (asıl hedef) · L, yinelemeli

| Özellik | Ön koşul | r187 kısıtı / not | Ne zaman |
|---|---|---|---|
| TRAA | MRT `velocity` | MSAA kapalı olmalı | Faz 2 |
| GTAO, bloom, DoF, SMAA, film, vignette | `RenderPipeline` | Hazır node'lar | Faz 2–3 |
| SSGI | MRT `normal`; gürültüyü TRAA azaltır | Düşük piksel oranı öneriliyor | Deneme Faz 2, kalıcı Faz 8 |
| SSR | MRT `normal`; stochastic mod için specular ekleri | Metal olmayan yüzeyler varsayılan kapalı (`reflectNonMetals`) | Faz 5 sonrası (ıslak zemin, su, kaporta) |
| LightProbeGrid | Probe bake aracı | Bake'li ışınım; dinamik nesnelere GI verir | Faz 8 |
| LightMapper | Statik geometri | Birikim sırasında geometri ve GI sabit kalmalı; en çok 256 örnek | Faz 8 |
| ClusteredLighting | — | Varsayılan ışık sistemini değiştirir | Faz 8 (sokak lambaları, farlar) |
| MeshletDrawingPipeline | — | Yalnız opak/alpha-test, geometriyi değiştirmeyen materyal | Faz 10 (statik prop'lar) |
| VXGI | Compute | Deneysel | Faz 10 |

- Gün saati olay bazlı (sürekli dönen güneş yok). Bu yüzden bake'li GI uygulanabilir: geçiş
  bitince yeniden hesaplama ya da birkaç sabit saat için önceden bake. [TEST]
- Bake verileri (probe grid, lightmap) yeni bir sidecar türü olur:
  `tools/saveValidator.ts` allowlist kuralları ve `droppedFields` testleri aynen uygulanır.
- Kalite profilleri (Compatibility / Balanced / Cinematic) ilk sürümde yerel tercih olarak
  tutulur, ortak veriye yazılmaz (v0.1 ADR-007).
- Her özellik aynı poz ve cihazda açık/kapalı ölçülür; kullanıcı kabulüyle kalır.

### Faz 9 — Geçiş ve arşiv · M

- [ ] Ridgebound `FORGE_PROJECT_ROOT` ile Forge WebGPU'ya döner: tüm level'lar açılıyor,
      `verify:world-data` yeşil, oyun kabulü verildi.
- [ ] Forge WebGL: README ve CLAUDE.md "bakım modu"; Model 1 oyunları orada kalır.
- [ ] (Ayrı karar) "Forge" adını Forge WebGPU'nun devralması.

### Faz 10 — İleri Ar-Ge (koşullu)

MeshletDrawingPipeline (statik prop'lar), VXGI, GPU güdümlü culling ve indirect draw
(foliage), compute partikül ve foliage, terrain deformasyonunda compute. Her biri için ölçüm
hipotezi, küçük prototip ve geri alma yolu.

## 5. Geçiş dönemi kuralları

1. Faz 9'a kadar Forge WebGPU, Ridgebound'un gerçek verisine yazmaz; testler kopya
   level'larla yapılır. İki editör aynı proje köküne aynı anda yazmaz.
2. Render-dışı motor değişikliği (`render-three` dışındaki `engine/`, `tools/`) yapıldığı
   depoda commit'lenir ve aynı gün diğerine `git cherry-pick` edilir. Yollar aynı kaldığı
   sürece temiz uygulanır.
3. Forge WebGL'de yeni render özelliği yok; hata düzeltmeleri serbest (D-5).
4. three r187'de kalınır. Sürüm yükseltmesi fazlar arasında ayrı bir iş olarak yapılır;
   WebGPU API'si hâlâ değişiyor (`PostProcessing` → `RenderPipeline` gibi).
5. TSL API'si hafızadan değil, kurulu kaynaktan doğrulanır (`node_modules/three/src/nodes`,
   `node_modules/three/examples/jsm/tsl`). TSL yeni ve sürümler arasında değişiyor;
   ajanların var olmayan API üretme riski yüksek.
6. İş bölümü: render boru hattı, TSL tasarımı ve görsel doğrulama Claude ile kullanıcıda;
   iyi tanımlı saf taşımalar ve testleri Codex'te. Görsel ayar kullanıcıda.

## 6. Açık planların triage önerisi (Faz 0'da kesinleşir)

| Plan | Öneri |
|---|---|
| `OCEAN_DEVELOPMENT_PLAN` | Süren adım bitip commit'lenir; kalan iş Faz 5a |
| `WATER_SYSTEM_DEVELOPMENT_PLAN`, `WATER_RDR2_LOOK_PLAN`, `PUDDLE_DEVELOPMENT_PLAN` | GLSL'de yeni iş yok; Faz 5 girdisi |
| `LAKE_GEOMETRY_FOAM_BAKE_PLAN` | CPU geometri hesabı render-dışıysa WebGL'de sürebilir (cherry-pick); görüntüsü Faz 5b |
| `AO_SURFACE_OCCLUSION_FIX_PLAN` | Forge WebGPU'da MRT + GTAO ile yeniden ele alınır (Faz 2–3) |
| `TERRAIN_DEFORMATION_PLAN` | Render-dışı açıklar (save-game kalıcılığı, sesler) WebGL'de + cherry-pick; görüntü ve editör yüzeyi Faz 4 |
| `DEFORMABLE_FRACTURABLE_WORK_PLAN` | Görsel kabul bekleyenler WebGL'de kapatılır; 4d ihtiyaç olunca Forge WebGPU'da |
| `WORLD_TERRAIN_WATER_BODY_PLAN` | Veri ve üretici kısmı WebGL'de + cherry-pick; görüntüsü Faz 5 |
| `OPEN_WORLD_PLAN` | Açık kalanlar Forge WebGPU'ya |
| `FORGE_GAME_PROJECT_WORKFLOW` | Geçerli; Model 2 tüketicisi Faz 9'da Forge WebGPU'ya döner |
| `ARSIVLENEN_PLANLARDAN_ACIK_ISLER` | Maddeler tek tek etiketlenir |

## 7. Riskler

| Risk | Önlem |
|---|---|
| `WebGPURenderer`'ın CPU maliyeti büyük sahnelerde yüksek | Faz 2 stres ölçümü ve kapısı; gerekirse GPU güdümlü çizim öne |
| TSL portunda görsel kayma | Faz 0 referans seti, her fazda A/B |
| Displacement'lı yüzeylerde velocity → TRAA izi | Faz 2–3 testleri; gerekirse önceki karenin yer değiştirmesini hesaba katan özel velocity |
| İki depoda bakım yükü | D-5 ve D-6: render dondurma + aynı gün cherry-pick |
| İkinci sistem sendromu (her şeyi yeniden tasarlama isteği) | Ana ilke: yalnız render katmanı yeniden yazılır; render-dışı kod gerekmedikçe değişmez |
| Ajanların TSL API uydurması | Kural 5.5 |
| Uyumluluk modu bugünkü `WebGLRenderer`'dan yavaş veya eksik | Faz 7 ölçümü; compute isteyen özellikler orada kapalı |
| CI'da gerçek WebGPU yok | Görsel ve performans kabulü yerelde; CI'da SKIP raporu |
| Bake verileri yeni kayıt yüzeyi açar | save-validator allowlist + `droppedFields` testleri |

## 8. Durum panosu

| Faz | Konu | Boyut | Durum |
|---|---|---|---|
| 0 | Karar, triage, referans | S | [ ] Başlanmadı |
| 1 | Depo ve WebGPU iskeleti | M | [ ] |
| 2 | Terrain + kalite kanıtı (KAPI) | L | [ ] |
| 3 | Materyal + foliage | L | [ ] |
| 4 | Değerli sistemler + VFX | M | [ ] |
| 5 | Su ve yansıma | XL | [ ] |
| 6 | Editörün tamamlanması | L | [ ] |
| 7 | Runtime, build, CI | M | [ ] |
| 8 | Kalite paketi | L | [ ] |
| 9 | Geçiş ve arşiv | M | [ ] |
| 10 | İleri Ar-Ge | — | [ ] Koşullu |

## 9. İlerleme kaydı

- **2026-11-09** — v0.2: hedef netleşti (Forge WebGL bakım moduna, Forge WebGPU yeni depo).
  Envanter ölçüldü: motorun ~%75'i render'dan bağımsız; üç değerli sistemin render uçları
  ince. v0.1 arşive kopyalandı. Kararlar onay bekliyor.

## 10. Kaynaklar

- Forge WebGL kaynağı: `C:\Users\emret\Desktop\Forge` @ `0396ad79` (ölçümler bu commit'te).
- three r187 kaynağı: `node_modules/three/src/renderers/common/Renderer.js` (`setCanvasTarget`,
  `readRenderTargetPixelsAsync`, `resolveTimestampsAsync`),
  `src/materials/nodes/NodeMaterial.js` (MRT ve `fragmentNode`),
  `src/nodes/accessors/VelocityNode.js`, `examples/jsm/tsl/display/` (SSR, SSGI, TRAA…),
  `examples/jsm/lighting/` (LightProbeGrid, LightMapper, ClusteredLighting, vxgi),
  `examples/jsm/pipelines/MeshletDrawingPipeline.js`.
- Resmî belgeler: `https://threejs.org/manual/pages/webgpurenderer`,
  `https://threejs.org/docs/pages/TSL.html`. Çevrimiçi belge kurulu sürümden ileride olabilir;
  kurulu kaynak esastır (kural 5.5).

## 11. v0.1 → v0.2 değişen kararlar

| v0.1 | v0.2 | Neden |
|---|---|---|
| Tek depo, iki ayrı editör uygulaması (ADR-001, ADR-003, D-WG-001) | Ayrı Forge WebGPU deposu (Forge klonu); Forge WebGL bakım modunda | Kullanıcının hedefi WebGPU ile devam etmek; kalıcı çift render uygulaması her render değişikliğini iki kez yazdırırdı |
| `main` istisnası, izole dal (ADR-002, D-WG-002) | Gerek kalmadı: her depo kendi `main`'inde | Uzun yaşayan dal yok |
| Gerçek WebGPU doğrulaması (ADR-005) | Korunur; uyumluluk modu etiketli (D-4) | — |
| Tek yazar / kilit (ADR-006) | Faz 9'a kadar Forge WebGPU gerçek veriye yazmaz; genel kilit ayrı bir editör işi | Çakışma geçiş kuralıyla önlenir |
| WebGPU ayarları ortak veriye yazılmaz (ADR-007) | Korunur; bake verileri için sidecar kuralı (Faz 8) | — |
| Veri eşdeğerliği ve kapsama matrisi (ADR-008) | Korunur (`renderFeatures`) | — |
| G0–G8; editör ve kayıt (G2–G3) terrain'den önce | Faz 0–10; terrain ve kalite kanıtı Faz 2 kapısında | Önce risk |
| İlk kalite özelliği G6 sonrası (D-WG-012) | TRAA + GTAO Faz 2'de; SSR/SSGI içerik portundan sonra; bake'li GI Faz 8'de | MRT sözleşmesi baştan kurulur |
| Faz başına ayrı rapor dosyaları | Tek yaşayan belge + ilerleme kaydı | Süreç yükü |
