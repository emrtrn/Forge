# Three.js r184 → r187 Yükseltme Planı

> Durum: **uygulanıyor** (başlangıç 2026-11-04; planlama 2026-11-03).
> Forge bugün `three@0.184.0` + `@types/three@^0.184.0` kullanıyor
> (`package.json`). Hedef `three@0.187.0`; `@types/three@0.187.0` npm'de var.
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

- [ ] Bump `three` / `@types/three` → 0.185.0.
- [ ] Shader adlarındaki geçiş: Forge'un kendi GLSL'inde
  `inverseTransformDirection` → `transformDirectionByInverseViewMatrix`
  (yön) / `transformNormalByInverseViewMatrix` (normal):
  `terrainCaustics.ts`, `terrainDeformation.ts`, `reflectionCapture.ts`.
- [ ] `reflectionCapture.ts` yansıma satırı hedefi r185 chunk'ına göre
  güncellenir (bu sürümde örnekleme hâlâ `textureCubeUV` olmalı; kaynakta
  doğrula).
- [ ] K4'ün davranışı bu sürümde devreye girer: Faz 0-1 yapılmışsa yalnız
  doğrulama.
- [ ] Kapı + smoke.

### Faz 2 — 0.186

- [ ] Bump → 0.186.0.
- [ ] `super.dispose?.()` → `super.dispose()`.
- [ ] Değişen chunk'lara tutunan yamalar (`shaderChunkAnchors` testi ne
  derse).
- [ ] `toJSON()` artık varsayılan değerleri kontrol etmiyor (#34178): Forge
  three'nin `toJSON`'unu kayıt yolunda kullanmıyor (kontrol edildi), yine de
  kayıt round-trip testleri yeşil kalmalı.
- [ ] Kapı + smoke. Görsel fark (PMREM spiral blur, multiscatter) not edilir.

### Faz 3 — 0.187: PMREM küp geçişi (asıl iş)

Bump → 0.187.0 sonrası derleme kırılır; bu faz tek dilimde kapanır.

- [ ] **3-1 Su ortam örneklemesi (`waterEnvironment.ts`):** Kopyalanmış
  CubeUV atlas kodu (`cubeUV` sabiti, `atlasSize` parametreleri) silinir.
  `waterEnvironment` / `waterProbe` `samplerCube` olur; örnekleme three'nin
  kendi yoluyla aynı: `textureLod(map, dir, roughnessToMip(roughness))`
  (mip hesabı r187 `envmap_physical_pars_fragment` ve
  `envmap_common_pars_fragment`'tan alınır, kopyalanmaz; mümkünse chunk
  include edilir). `waterEnvironmentSize` / `waterProbeSize` yerine mip
  sayısı uniform'u (gerekirse).
- [ ] **3-2 `bindMap` geçerlilik kontrolü:** `mapping === CubeUVReflectionMapping`
  yerine PMREM çıktısını tanıyan bir kontrol (`isCubeTexture` + PMREM
  işareti; r187 PMREMGenerator'ın texture'a ne koyduğuna bakılır).
- [ ] **3-3 `lakeWater.ts` / `riverWater.ts`:** `WATER_ENVIRONMENT_GLSL`
  tüketicileri yeni uniform tiplerine uyar.
- [ ] **3-4 `reflectionCapture.ts`:** `SphereReflectionCaptureBake.target`
  → `WebGLCubeRenderTarget`. Patch hedefleri r187 satırlarına göre yeniden
  yazılır (`ENVMAP_TYPE_PMREM`, `textureLod(envMap, envMapRotation * reflectVec, roughnessToMip( roughness ))`,
  irradiance `ENVMAP_MAX_LOD`). Blend yolundaki `captureGlobalEnv`
  `samplerCube` olur. Parallax bloğu yön hesabına dokunduğu için aynen kalmalı;
  doğrulanır.
  **r184'ten kalan hata, burada düzeltilir:** `captureGlobalEnv` probe'un
  `CUBEUV_*` sabitleriyle okunuyor, gök capture'ı probe'dan farklı boyuttaysa
  yanlış texel gelir ve probe içindeki diffuse söner (64 px probe + 256 px gökte
  mavi kanal 0; ikisi 256 iken 0.986). r187'de `ENVMAP_MAX_LOD` de probe'un olur:
  gök kendi LOD sayısıyla örneklenmeli. `reflection-capture.spec.ts` bu düzeltmede
  uyumsuz boyutu da kapsar (bugün yalnız varsayılan 256 ile çalışıyor).
- [ ] **3-5 `reflection.ts`:** `fromScene` dönüş tipi; `scene.environment`
  bağlama ve `userData.waterSkySunDirection` korunur.
- [ ] **3-6 (K3) Reversed-Z bias:** `shadowDepthBias()` artık iki modda da
  aynı işareti döner (three çeviriyor). `depthMode` açıklaması ve S5 notu
  güncellenir. Reversed-Z smoke'unda gölge lekesi ve peter-panning kontrolü.
- [ ] **3-7 (K7):** `_reversedDepth` private alan yazımının r187'de hâlâ
  gerekli olup olmadığına bakılır; three kamerayı kendi yönetiyorsa kaldırılır.
- [ ] **3-8 Testler:** `terrainRiverWater.test.ts` CubeUV sabiti yerine
  küp hedef kullanır; reflection capture ve su ortamı testleri yeni tiplere
  göre güncellenir.
- [ ] **3-9 Bellek ve maliyet:** Küp PMREM ile atlas'ın GPU belleği ve
  bake süresi karşılaştırılır (64 px yerel capture, 256 px gökyüzü). Perf
  bütçesine (`?debug`) yansıması not edilir.
- [ ] Kapı + smoke.

### Faz 4 — Doğrulama ve kabul

- [ ] Smoke: `terrain-water`, `world-environment-moon`, `world-environment-night`,
  reflection capture / reflective surface, reversed-Z gölge, game-starter
  parity seviyesi (`tests/smoke/game-starter.spec.ts`).
- [ ] Faz 0-4 referans görüntüleriyle yan yana karşılaştırma; farklar
  K8 kaynaklıysa kabul, değilse hata.
- [ ] Kullanıcı görsel kabulü (su, gökyüzü yansıması, probe'lar, gölgeler).
- [ ] `CLAUDE.md` ve ilgili mimari notlar (reversed-Z S5, su ortam
  örneklemesi) güncellenir; plan `Forge-Archive`'e taşınır.

---

## 4. Açık sorular (uygulamada kapanacak)

1. **Kapandı.** r185 ve r186'da `envmap_physical_pars_fragment` yalnız yön
   fonksiyonlarının adını değiştiriyor (`transformDirectionByInverseViewMatrix`,
   `transformNormalByInverseViewMatrix`); `textureCubeUV` ve `ENVMAP_TYPE_CUBE_UV`
   r187'ye kadar duruyor. r186 ayrıca retroreflective blok ekliyor.
2. `roughnessToMip` ve `ENVMAP_MAX_LOD` su shader'ına include ile mi alınır,
   yoksa mip sayısı uniform'u mu gerekir? İki farklı boyuttaki (64 / 256)
   küp aynı shader'da örneklendiği için bu karar 3-1'i belirler.
3. **Kapandı.** r187 PMREM çıktısı `texture.isPMREMTexture === true` taşıyor
   (`PMREMGenerator._allocateTarget`); three'nin kendisi de buna bakıyor. 3-2 bunu
   kullanır. `envMapMaxLod` = mip sayısı − 1, program parametresi olarak geliyor.
4. "Remove code deprecated in r177" (#34517) ve diğer "Remove deprecated code"
   PR'ları maddeleştirilmemiş. Bump sonrası `tsc` ne gösterirse o.
