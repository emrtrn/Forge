# Three.js r184 → r187 Yükseltme Planı

> Durum: **kod tamam, kullanıcı görsel kabulü ve bir maliyet kararı bekliyor**
> (uygulama 2026-11-04). Forge `three@0.187.0` + `@types/three@^0.187.0` kullanıyor.
>
> Kaynaklar: three.js wiki *Migration Guide* (184→185, 185→186, 186→187
> bölümleri) ve r185 / r186 / r187 sürüm notları. Aşağıdaki "doğrulandı"
> etiketli maddeler `three@0.187.0` paketinin kaynağıyla (npm tarball)
> karşılaştırıldı; diğerleri yalnız notlara dayanıyor, uygulama sırasında
> kaynakta kontrol edilmeli.
>
> Kapsam kuralı: bu plan yalnız sürüm yükseltmesinin getirdiği kırılmaları
> giderir. Yeni r185–r187 özelliklerini (SunLight, retroreflectivity, EON
> diffuse, `getProgramVariant`, WebGPU) kullanmaya başlamak ayrı iştir.

---

## 1. Etki özeti

Forge yalnız `WebGLRenderer` kullanıyor; `three/webgpu`, `three/tsl` ve
`WebGPURenderer` import'u yok. Bu yüzden notlardaki maddelerin çoğu (TSL
yeniden adlandırmaları, node'lar, `SSAAPassNode`, `TiledLighting`, WebGPU
compute) Forge'u etkilemiyor. Etkileyenler:

| # | Değişiklik | Sürüm | Forge'daki yer | Etki |
|---|---|---|---|---|
| K1 | PMREM küp render target'a geçti; `CubeUVReflectionMapping` ve `cube_uv_reflection_fragment` silindi (doğrulandı) | r187 | `engine/render-three/waterEnvironment.ts`, `lakeWater.ts`, `riverWater.ts`, `reflectionCapture.ts`, `reflection.ts`, `tests/engine/terrainRiverWater.test.ts` | **Derleme hatası + açılışta çökme** (`ShaderChunk.cube_uv_reflection_fragment` modül seviyesinde `undefined.replace`) |
| K2 | `envmap_physical_pars_fragment` içeriği değişti: `inverseTransformDirection` → `transformDirectionByInverseViewMatrix` / `transformNormalByInverseViewMatrix`, `textureCubeUV(...)` → `textureLod(envMap, ..., roughnessToMip(...))`, `ENVMAP_TYPE_CUBE_UV` → `ENVMAP_TYPE_PMREM` (doğrulandı, r187) | r185 (ad) + r187 (örnekleme) | `reflectionCapture.ts` (`CAPTURE_REFLECT_LINE`, `CAPTURE_ENVCOLOR_LINE`, `CAPTURE_IRRADIANCE_LINE`) | **Sessiz bozulma:** koruma kontrolü `return` ediyor, Sphere Reflection Capture hiçbir materyali etkilemiyor, uyarı yok |
| K3 | Reversed depth'te gölge bias işaretini three kendisi çeviriyor (`shadowmap_pars_fragment`, `#ifdef USE_REVERSED_DEPTH_BUFFER`; doğrulandı) | r187 (#34892) | `engine/render-three/depthMode.ts` `shadowDepthBias()` | Çift çevirme → reversed-Z'de S5 gölge lekeleri geri gelir |
| K4 | `Object3D.updateWorldMatrix()` artık `matrixWorldNeedsUpdate`'e uyuyor (doğrulandı) | r185 (#33746) | `src/scene/RuntimeSceneApp.ts` ~5625, `src/scene/SceneApp.ts` ~4628 / ~4689 ve diğer elle matris yazma yerleri (18 adet) | İlk render'dan önce `Box3.setFromObject` / `getWorldPosition` çağrılırsa world matrix birim kalır → bounds, collider, picking orijinde |
| K5 | `Object3D.dispose()` eklendi (yalnız `dispose` event'i yayınlar; doğrulandı) | r186 | `LakeWaterObject`, `RiverWaterObject`, `ReflectiveSurface`, `terrainPuddleSurface` | `super.dispose()` çağrılmıyor; event dinleyen yoksa zararsız |
| K6 | 23 shader chunk değişti, 1 silindi (`common`, `lights_*`, `shadowmap_*`, `normal_*`, `uv_*`, `envmap_*`, `transmission_fragment`…) | r185–r187 | 12 dosyada `onBeforeCompile` yaması | Çoğu `#include <x>` satırına tutunuyor (güvenli); chunk içi metne tutunan yamalar kırılabilir |
| K7 | `depthFunc` eşlemesi düzeltildi (#35264), reversed depth + polygon offset düzeltmesi (#34606) | r187 | `depthMode.ts` (`_reversedDepth` private alanına yazıyor) | Davranış değişebilir; smoke gerekli |
| K8 | Görsel değişiklikler: PMREM spiral blur, GGX multiscatter yeniden yazıldı, renk dönüşüm matrisi sırası, EON/enerji korunumu, watertight `Ray.intersectTriangle` | r186–r187 | Tüm aydınlatma | Ekran görüntüleri ve görsel kabul biraz farklı |

Etkilemeyenler (kontrol edildi): `DRACOLoader`, `SimplifyModifier`,
`toTrianglesDrawMode`, `LightProbeGrid`, `Matrix4.determinant3x3`,
`iridescenceThicknessRange`, `Source` → `TextureSource` (Forge import
etmiyor), `Sky` `up` uniform'u (Forge set etmiyor), `PCFSoftShadowMap`
(r184 zaten `PCFShadowMap`'e çeviriyor), KTX2 göreli URL varsayılanı
(transcoder yolu açıkça veriliyor). `sunCascadeShadow.ts`'in
`DIR_SHADOW_LINE` hedefi r187'de aynen duruyor.

---

## 2. Çalışma kuralları

- `main` üzerinde, her adım kendi yeşil commit'i: `npx tsc --noEmit`,
  `npm run test:engine`, `npm run build:verify`. Ara sürümlerde de kapı
  yeşil olmadan bir sonraki sürüme geçilmez.
- Sürümler tek tek: 0.185 → 0.186 → 0.187. Her sürümde önce bump, sonra o
  sürümün kırdıkları; böylece bir regresyonun hangi sürümden geldiği belli olur.
- Chunk metnine tutunan her yama, hedefi bulamazsa **sessizce dönmez**:
  dev'de uyarı basar ve bir engine testi hedefin var olduğunu doğrular
  (bugünkü `sunCascadeShadow` yaklaşımı gibi).
- Fork etkisi: minigolf ve sonraki fork'lar upstream sync'te bu değişikliği
  alacak. Fork'a özel shader yaması varsa (`src/game`) sürüm notunda belirtilir.

---

## 3. Fazlar

### Faz 0 — r184'teyken hazırlık (sürüm değişmeden)

Bugün de doğru olan, yükseltmeyi küçülten değişiklikler.

- [x] **0-1 (K4):** Yalnız `matrixAutoUpdate = false` olan nesneler etkileniyor
  (`updateMatrix()` bayrağı zaten kaldırıyor). Gerçek yer sayısı 8, 18 değil:
  kalan eşleşmeler Object3D değil, özel `Matrix4` alanları
  (`meshParticleEffect`, `riverPlanarReflection`, `riverWheelSurface`). Sekizi
  tek yardımcıda toplandı: `setFixedMatrix` (`engine/render-three/transforms.ts`).
- [ ] **0-2 (K5):** İptal, Faz 2'ye taşındı: `super.dispose?.()` r184 tiplerinde
  derlenmiyor (metot yok); cast yazmak yerine r186'da doğrudan `super.dispose()`.
- [x] **0-3 (K2, K6):** `reflectionCapture.ts` hedef bulamazsa bir kez uyarır.
  `tests/engine/shaderChunkAnchors.test.ts` yamaların `#include` ve metin
  hedeflerini `ShaderLib` / `ShaderChunk`'ta arar; yükseltmede ilk kırılan bu
  test olur. Ek: `tests/smoke/reflection-capture.spec.ts` probe yamasını gerçekten
  render edip pikselden doğrular (blend, yalnız-specular, parallax).
- [ ] **0-4:** Görsel referans: yükseltme öncesi smoke ekran görüntüleri
  (su, göl, nehir, reflection capture, reversed-Z gölge, terrain) bir kez
  alınıp karşılaştırma için saklanır (repo dışında).

### Faz 1 — 0.185

- [x] Bump `three` / `@types/three` → 0.185.0.
- [x] Shader adlarındaki geçiş: Forge'un kendi GLSL'inde
  `inverseTransformDirection` → `transformDirectionByInverseViewMatrix`
  (yön) / `transformNormalByInverseViewMatrix` (normal):
  `terrainCaustics.ts`, `terrainDeformation.ts`, `reflectionCapture.ts`.
  Eski ad r187'de hâlâ `#define`; yalnız `reflectionCapture` metin hedefi kırıyordu.
- [x] `reflectionCapture.ts` yansıma satırı hedefi güncellendi (`textureCubeUV` duruyor).
- [x] `models.ts`: `Matrix4.isMatrix4` tiplerden çıktı, `instanceof Matrix4`.
- [x] Standart kapı yeşil. K4 smoke'ları (editor-authoring, hlod, detail-culling,
  world-partition-statics, fracture-runtime, runtime-parity) yeşil.
- **r185 hatası, Forge'da düzeltilmez:** r185 ve r185.1 `WebGLRenderLists.sort()`
  içinde reversed depth'te listeleri koşulsuz `reverse()` ediyor, `renderOrder` da
  ters dönüyor. `depthTest: false` + `renderOrder = -1` olan Sky son çizilip sahneyi
  eziyor (`terrain-water-runtime`). r186 bunu geri aldı. Bu yüzden r185 commit'i tek
  başına push edilmedi; r186 ile birlikte gitti.

### Faz 2 — 0.186

- [x] Bump → 0.186.0.
- [x] Dört Mesh alt sınıfına `override dispose()` + `super.dispose()`.
- [x] Değişen chunk'lara tutunan yama yok (`shaderChunkAnchors` yeşil).
- [ ] `toJSON()` artık varsayılan değerleri kontrol etmiyor (#34178): Forge
  three'nin `toJSON`'unu kayıt yolunda kullanmıyor (kontrol edildi), yine de
  kayıt round-trip testleri yeşil kalmalı.
- [x] Kapı + r184 referans setinin tamamı: `terrain-water-runtime` r186'da düzeldi.
  r184'te de kırık olan üç smoke aynen kırık, three'den bağımsız:
  `river-water-optics:301` (kaynak sayısı 5, beklenen 4),
  `sun-cascaded-shadows:92` (kaskad 3, beklenen 4), `world-environment:24`
  (`moonShadowStrength` 0.5, test 0.45 bekliyor). Görsel karşılaştırma Faz 4'te.

### Faz 3 — 0.187: PMREM küp geçişi (asıl iş)

Bump → 0.187.0 sonrası derleme kırılır; bu faz tek dilimde kapanır.

- [x] **3-1 Su ortam örneklemesi:** Atlas kopyası silindi; `waterEnvironment` /
  `waterProbe` `samplerCube`, örnekleme `textureLod`. `roughnessToMip` tek bir
  `ENVMAP_MAX_LOD` okuduğu için su `waterMip(roughness, maxLod)` kullanıyor ve her
  haritanın kendi `waterEnvironmentMaxLod` / `waterProbeMaxLod` uniform'u var. Formül
  kopya olduğundan `shaderChunkAnchors` three'nin satırını izliyor.
- [x] **3-2 `bindMap`:** `texture.isPMREMTexture === true`; LOD = `mipmaps.length - 1`.
- [x] **3-3 `lakeWater.ts` / `riverWater.ts`:** değişiklik gerekmedi, GLSL ortak.
- [x] **3-4 `reflectionCapture.ts`:** Bake hedefi `WebGLCubeRenderTarget`; hedef
  satırlar r187'ye göre. Gök `roughnessToMip(r) / ENVMAP_MAX_LOD * captureGlobalEnvMaxLod`
  ile örnekleniyor, r184'ten kalan boyut uyumsuzluğu hatası kapandı (smoke 512 px
  probe + 256 px gök ile doğruluyor). Parallax bloğuna dokunulmadı, smoke yeşil.
- [x] **3-5 `reflection.ts`:** dönüş tipi `WebGLCubeRenderTarget`; `scene.environment` aynı.
- [x] **3-6 (K3):** `SHADOW_DEPTH_BIAS` tek işaret (negatif), `shadowDepthBias()` silindi.
  Üç yer (lights, sunCascadeShadow, sunFollowShadow) sabiti kullanıyor. `far-view`
  güncellendi; `shaderChunkAnchors` three'nin çevirme satırını izliyor.
- [x] **3-7 (K7):** `_reversedDepth` yazımı kalıyor: r187 de kamerayı yalnız `true` yapıyor.
- [x] **3-8 Testler:** `terrainRiverWater`, `engine-tests` capture testi güncellendi.
- [x] **3-9 Maliyet:** r187 PMREM boyutu **en az 256** (`MIN_SIZE`). Küçük capture yok.
  Süre, yazılım GPU'su (Chromium headless), kare başına ortalama (r184 → r187):
  gök 256 1475 → 1100 ms, gök 128 542 → 1034 ms, probe 256 1380 → 927 ms,
  probe 64 239 → 920 ms. Bellek hesabı: 256 için atlas 6,2 MB → küp 5,2 MB; 64 px
  probe 0,6 MB → 5,2 MB. Gerçek GPU'da ölçülmedi.
  **Açık karar:** `DYNAMIC_CAPTURE_SIZE = 128` artık etkisiz; hareketli güneşte her
  capture 256 kadar pahalı. Dinamik saat kullanan sahnelerde gerçek GPU'da ölçülmeli;
  gerekirse capture sıklığı düşürülür (`?debug`, bütçe).
- [x] Kapı yeşil. Smoke: r184'te de kırık dört test dışında yeşil (Faz 4).

### Faz 4 — Doğrulama ve kabul

- [x] Smoke r187 (89 test): 86 yeşil. Kırık üçü r184'te de aynı şekilde kırık, ayrı iş:
  `river-water-optics:301`, `sun-cascaded-shadows:92`, `world-environment:24`.
  `vehicle:602` bu turda koşmadı; r184 worktree'si, r185 ve r186'da aynı şekilde kırık
  (readout boş). `world-partition-statics`, `fracture-runtime` ve `vehicle.spec`'in
  kalanı r185'te yeşildi, r187'de tekrar koşmadı.
  Reflective surface'ı render eden smoke yok; capture için `reflection-capture` eklendi.
- [x] Referans karşılaştırması (`Forge-Archive/three-r187-baseline`, 123 görüntü,
  `r184-vs-r187.json`): hiçbirinde piksellerin %1'i 24/255'ten fazla değişmedi; 69'u
  birebir aynı. Birebir aynı olanlar düz renk ortam girdili sabit sahneler, gerçek göğü
  sınamıyor. Gerçek gök altında en büyük fark GAZ-52 sahnesi, ortalama 5,5/255 (K8).
- [ ] Kullanıcı görsel kabulü (su, gökyüzü yansıması, probe'lar, gölgeler).
- [x] Mimari not: reversed-Z S5 ve su örneklemesi kod açıklamalarında güncel;
  `CLAUDE.md`'de bu konuda madde yoktu.
- [ ] Görsel kabulden sonra plan `Forge-Archive`'e taşınır.
- Smoke'larda three: `page.evaluate` içinde `/tests/smoke/pages/engineThree.ts` import
  edilir. `/node_modules/.vite/deps/three.js` smoke sunucusunun değil, eski bir dev
  oturumunun bundle'ıdır; farklı three sürümü yükleyebilir.

---

## 4. Açık sorular (uygulamada kapanacak)

1. **Kapandı.** r185 ve r186'da `envmap_physical_pars_fragment` yalnız yön
   fonksiyonlarının adını değiştiriyor (`transformDirectionByInverseViewMatrix`,
   `transformNormalByInverseViewMatrix`); `textureCubeUV` ve `ENVMAP_TYPE_CUBE_UV`
   r187'ye kadar duruyor. r186 ayrıca retroreflective blok ekliyor.
2. **Kapandı.** Uniform: mip sayısı boyuta göre değişiyor, bkz. 3-1.
3. **Kapandı.** r187 PMREM çıktısı `texture.isPMREMTexture === true` taşıyor
   (`PMREMGenerator._allocateTarget`); three'nin kendisi de buna bakıyor. 3-2 bunu
   kullanır. `envMapMaxLod` = mip sayısı − 1, program parametresi olarak geliyor.
4. **Kapandı.** `tsc` yalnız `Matrix4.isMatrix4` ve `override` uyarılarını gösterdi.
