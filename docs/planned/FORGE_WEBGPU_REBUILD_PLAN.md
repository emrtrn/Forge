# Forge WebGPU — Yeniden İnşa Planı

**Sürüm:** v0.2 · 2026-11-10
**Durum:** Taslak. §8'deki kararlar onay bekliyor; hiçbir faz başlamadı.
**Yerini aldığı belge:** `FORGE_WEBGPU_EDITION_MASTER_PLAN.md` (v0.1). v0.1 aynı
depoda ikinci bir editör öneriyordu; 2026-11-10 kararıyla hedef değişti. v0.1'in
geçerli ilkeleri §2 ve §9'a taşındı.
**Ölçüm tabanı:** Forge `main` @ `0396ad79`, `three@0.187.0` (npm'deki en son
sürüm, 2026-10-30).

> **Hedef:** Açık dünya oyunlarında daha iyi görsel kalite. Forge (WebGL) bakım
> moduna geçer ve basit projeler için kullanılmaya devam eder. Forge WebGPU,
> Forge'un mimarisini referans alan ayrı bir depoda kurulur. World Builder, araç
> hasarı ve terrain deformasyonu oraya taşınır. three.js'in WebGPU örnekleri ve
> addon'ları (SSR, SSGI, TRAA, LightProbeGrid, LightMapper, ClusteredLighting,
> MeshletDrawingPipeline…) uyarlama gerekmeden kullanılabilir hâle gelir.

---

## 1. "Yeniden inşa" neyi kapsıyor — ölçülmüş tablo

Forge'un mimari sınırları (`verify:imports`) işe yaramış: `engine/` altında
`render-three` dışındaki 23 dizinin hiçbiri three.js import etmiyor (tek istisna
bir fizik dosyası). Bu yüzden yeniden inşa her şeyi sıfırdan yazmak değil; üç
ayrı işlem:

- **Taşı:** olduğu gibi kopyala, testleriyle doğrula.
- **Uyarla:** three çekirdek sınıfları (`Mesh`, `Object3D`, `BufferGeometry`…)
  WebGPU tarafında aynı; yalnız renderer'a dokunan yerler değişir.
- **Yeniden yaz / kur:** GLSL, `onBeforeCompile`, `EffectComposer`, WebGL render
  target'ları ve büyük orkestratör sınıfları.

| Katman | Boyut | three bağımlılığı | İşlem |
|---|---|---|---|
| `engine/*` (render-three hariç: ai, physics, terrain, world, worldbuilder, scene, persistence, environment, perf…) | ~70.000 satır | yok | **Taşı** |
| `tools/` (save validator'ları, World Builder betikleri, doğrulayıcılar) + `builder/` | ~44.700 satır | 3 dosya | **Taşı** |
| `tests/engine` | 176 dosya, ~42.000 satır | — | Modülüyle birlikte **taşı** |
| `vite.config.ts` dev endpoint'leri | 2.632 satır | — | **Taşı**, modüllere bölerek |
| `engine/render-three` | 113 dosya, ~23.300 satır | 101 dosya; 42'si WebGL'e özgü | 42 dosya **yeniden yaz** (TSL); kalanı **uyarla** |
| `src/scene` (`SceneApp` 16.375, `RuntimeSceneApp` 7.182 satır) | 83 dosya, ~40.800 satır | 34 dosya | **Yeniden kur** — referans alınır, büyük sınıflar bölünür |
| ↳ `src/scene/capabilities` (runtime modülleri) | 30 dosya, ~7.500 satır | 11 dosya | **Uyarla** |
| `src/editor` (DOM panelleri) | 88 dosya, ~38.800 satır | 14 dosya; 6'sı WebGL'e özgü | **Uyarla** — `SceneApp` bağımlılığı (26 dosya) yeni servislere |

Kodun yaklaşık yarısı olduğu gibi taşınır. Asıl yeni iş: render katmanı,
uygulama kabuğu (editör + runtime orkestrasyonu) ve editör viewport'u.

### 1.1 Değerli sistemler bu ayrımda nereye düşüyor

| Sistem | Three'siz çekirdek (taşınır) | Yeniden yazılacak / uyarlanacak render parçası |
|---|---|---|
| World Builder | `engine/worldbuilder` (47 dosya, ~12.600 satır), `tools/world` (~2.900 satır, CLI dahil) | Render parçası yok; editör penceresi (`panels/world`, ~1.600 satır DOM) uyarlanır |
| Terrain deformasyonu | `deformationField`, `deformationStateCodec`, `terrainHeightQuery`, `terrainDeformationModule` | `terrain/terrainDeformation.ts` (556 satır, GLSL) → TSL/compute |
| Araç hasarı | `physics/deformable`, `physics/fracture` (~2.000 satır, Voronoi bake dahil) | `dentWear.ts` (101 satır, GLSL) → TSL; `deformableMeshSync`, `fractureGeometry`, `deformablePartNodes` uyarlanır |
| Araç fiziği | `engine/physics` (Rapier, ~8.500 satır) | Tekerlek görseli uyarlanır |

Bu üç sistemin değeri neredeyse tamamen three'siz çekirdekte. Cut-over'da (Faz 2)
ilk gün taşınırlar; görsel parçaları ilgili fazda bağlanır.

---

## 2. Mimari ilkeler (Forge'dan alınan dersler)

1. **Aynı katman sınırları, ilk günden zorunlu.** `engine/` three'siz kalır;
   `engine/render-gpu/` `three/webgpu` ve `three/tsl` import eden tek katmandır;
   editör dinamik import arkasındadır ve oyun bundle'ına girmez; oyuna özel
   kurallar `src/game`'de kalır. `verify:imports` ve `verify:dist --strict` ilk
   commit'te kurulur.
2. **Tanrı nesnesi yok.** `SceneApp` ve `RuntimeSceneApp` yeniden üretilmez.
   Editör küçük servislere bölünür: viewport host, seçim, transform aracı,
   kayıt, içerik. Runtime, `FORGE_LAYERED_RUNTIME_PLAN`'daki LevelRuntime +
   capability modülü düzenine kurulur. Editör ve oyun sahneyi aynı kurucuyla
   inşa eder; "editörde başka, oyunda başka" görüntü olmaz.
3. **Materyal sözleşmesi.** Işık alan her yüzey `MeshStandardNodeMaterial` /
   `MeshPhysicalNodeMaterial` slotları (`colorNode`, `normalNode`,
   `positionNode`, `roughnessNode`…) üzerine kurulur. `fragmentNode` yalnız
   ışıksız yardımcı pass'lerde kullanılır: r187'de `fragmentNode` MRT
   çıktılarını atlıyor (`NodeMaterial.js` setup), TRAA/SSR/SSGI ise bunlara
   dayanıyor.
4. **Tek render pipeline, kalite profilleri.** Tek `RenderPipeline`: MRT'li
   sahne pass'i → GTAO / SSR / SSGI → TRAA → bloom / DoF → tonemap. Her efekt bir
   profil anahtarıdır (Compatibility / Balanced / Cinematic). three addon'ları
   kendi ince sarmalayıcı modüllerimizin arkasında kullanılır; deneysel API
   değiştiğinde tek yer düzelir.
5. **Ölçek için GPU tarafı.** Açık dünyada WebGPU'nun asıl kazancı: instancing /
   `BatchedMesh`, foliage ve prop'lar için compute culling + indirect draw;
   okyanus FFT'si, partiküller ve terrain deformasyonu için compute.
6. **Gerçek WebGPU doğrulaması** (v0.1 ADR-005). `renderer.backend.isWebGPUBackend`
   kontrol edilir; WebGL2 backend'ine sessiz düşüş "WebGPU çalışıyor" sayılmaz
   ve ekranda gösterilir.
7. **Veri formatları başlangıçta aynı.** Level, terrain + tile, manifest ve bütün
   sidecar'lar (`*.vehicle.json`, `*.fracture.json`, `*.deformable.json`,
   `*.effect.json`, `*.skeleton.json`, world/foliage hücreleri) aynı şemayla
   başlar. Böylece mevcut level'lar ve Ridgebound içeriği ilk günden açılır;
   geçiş döneminde Forge WebGL editörü yazma aracı olarak kullanılabilir.
   Şema değişikliği sürüm numarasıyla yapılır. Save validator allowlist'i ve
   `droppedFields` güvenlik ağı aynen taşınır.
8. **Eşzamanlı kayıt koruması ilk günden.** Forge WebGL'de layout kaydında sürüm
   kontrolü yok (mevcut 409'lar yalnız içerik oluştururken var olan dosyayı
   korur). Yeni dev server her yazmada temel sürümü kontrol eder.
9. **Görünüm ayarı kullanıcıda.** Claude sistemleri kurar ve parametreleri
   editöre açar; ışık / renk / efekt ayarını ve görsel kabulü kullanıcı yapar.
10. **Ölçüm disiplini** (v0.1 §7.2). Her performans ölçümü şunlarla kaydedilir:
    commit, three sürümü, backend kanıtı, tarayıcı, GPU + sürücü, sahne + kamera
    pozu, çözünürlük + DPR, profil, medyan / p95 kare süresi, GPU süresi, draw
    call. Ölçülmeyen şey "ölçülmedi" yazılır; CPU süresi GPU süresi diye sunulmaz.
11. **Önce taşı, sonra iyileştir.** Taşınan modülün tasarımı taşıma sırasında
    değiştirilmez; eşdeğerliği testler kanıtlar. İyileştirme ayrı bir adımdır.

---

## 3. Forge WebGL'in geleceği

- **"Arşiv" = bakım modu**, GitHub'ın salt okunur arşivi değil. Model 1 oyunları
  (minigolf, miniracer, platformer, freshcounter) upstream'den hata düzeltmesi
  çekmeye devam eder; WebGPU'ya geçişleri oyun başına ayrı karardır. Ridgebound
  (Model 2) göç edene kadar Forge WebGL'de kalır.
- Cut-over'da (Faz 2) `forge-webgl-final` etiketi atılır; `CLAUDE.md` ve
  README'ye bakım modu notu eklenir. Sonrasında yalnız hata düzeltmesi.
- **Hemen geçerli olması önerilen kural (K6):** `engine/render-three`'ye yeni
  özellik yatırımı durur, yalnız hata düzeltmesi yapılır; bu katman yeniden
  yazılacak. Three'siz sistemler (World Builder, fizik, terrain verisi,
  save-game) cut-over'a kadar Forge WebGL'de gelişmeye devam edebilir;
  cut-over'da olduğu gibi taşınırlar.

### 3.1 Devam eden işler için öneri

| İş | Öneri |
|---|---|
| World Builder ada + okyanus (çalışma ağacında, commit'lenmemiş) | Generator tarafı (`engine/worldbuilder`, `tools/world`) bitirilip commit'lenir; okyanus shader'ına yeni yatırım yapılmaz (WebGPU'da compute ile yeniden yazılacak) |
| Terrain deformasyonu Faz 5 (kalıcılık) | Three'siz; Forge WebGL'de bitebilir, taşınır |
| Terrain deformasyonu Faz 6 (editör yüzeyi) | Forge WebGPU Faz 8'e devredilir |
| Araç hasarı / Doruk K-180 form ve içerik işi | Motordan bağımsız; sürer |
| WebGL görsel kabulleri (RDR2 su, deformable Faz 7, WES) | Kapatılır; kabul WebGPU'da verilir |
| Adaptif kalite planı | WebGPU kalite profillerine (§2.4) devredilir |
| Editör UI redesign planı | K7'ye bağlı |

---

## 4. Faz planı

Büyüklükler görelidir (S < M < L < XL); süre tahmini değildir.

| Faz | Amaç | Büyüklük | Bağımlılık | Kapı |
|---|---|---|---|---|
| 0 | Kararlar + referans görüntüler | S | — | §8 kararları kayıtlı; WebGL baseline alındı |
| 1 | Doğrulama spike'ı (Forge `spikes/webgpu/`) | M | 0 | **GO / NO-GO** kullanıcı kararı |
| 2 | Cut-over: yeni depo + three'siz çekirdeğin taşınması | M | 1 (GO) | Taşınan testler ve CI yeşil |
| 3 | Render çekirdeği + level görüntüleyici | L | 2 | Referans sahnelerde ilk görsel kabul |
| 4 | Editör çekirdeği | L | 3 | Editör smoke'u (yerleştir / taşı / undo / kaydet / yeniden aç) |
| 5 | Açık dünya: terrain, streaming, foliage, World Builder penceresi | XL | 3, 4 | Açık dünya sahnelerinde görsel + performans kabulü |
| 6 | Oyun runtime'ı + araçlar | L | 3 (5 ile paralel yürüyebilir) | Runtime smoke'u; araç terrain üstünde sürülüyor |
| 7 | Su ve yansımalar | L | 5 | Su görsel kabulü |
| 8 | Terrain deformasyonu + araç hasarı | L | 5, 6 | Ridgebound kopya sahnesinde senaryolar |
| 9 | İleri aydınlatma (her teknik ölçümle) | M–L | 5 | Teknik başına ölçüm + kullanıcı kararı |
| 10 | Ridgebound göçü + sürüm | M | 8 | Ridgebound Forge WebGPU'da tam akışla çalışıyor |

Sıranın mantığı: en büyük bilinmeyen (WebGPU açık dünyada istenen kaliteyi kabul
edilebilir maliyetle veriyor mu?) en başta, ucuz bir spike'la cevaplanır. Görsel
kalite (Faz 3) editörden önce gelir, çünkü projenin amacı o. Editör (Faz 4) açık
dünya araçlarından önce gelir, çünkü sculpt / paint / foliage / World Builder ve
görünüm ayarı onun üstünde çalışır.

### Faz 0 — Kararlar ve referans görüntüler

- [ ] §8'deki K1–K9 kararları.
- [ ] Referans sahneler seçilir: çok tile'lı bir terrain level'ı, Island, bir
      World Builder rastgele dünyası, Ridgebound'un **kopya** bir sahnesi.
- [ ] Her sahnede sabit kamera pozlarından Forge WebGL ekran görüntüleri ve
      `?debug` ölçümleri (kare süresi, GPU süresi, draw call); kullanıcının
      GPU'sunda, §2.10 formatında.
- [ ] K6 kabul edilirse render-three yatırım durdurma kuralı yürürlüğe girer.

### Faz 1 — Doğrulama spike'ı (GO / NO-GO)

Yer: Forge `spikes/webgpu/`. Mevcut spike düzeni geçerli: uygulama build'ine,
kök `tsc`'ye ve `verify:imports`'a girmez; tip kontrolü `npx tsc -p spikes`.
Forge'un three'siz terrain / level yükleyicilerini olduğu gibi kullanır. Kod
atılabilir; sonuçlar bu plana yazılır.

- [ ] **S1 Boot:** `WebGPURenderer` + `await renderer.init()`, gerçek backend
      kanıtı, GPU timestamp (`trackTimestamp`), adaptör / cihaz bilgisi.
- [ ] **S2 Terrain:** referans terrain'in tile'ları TSL CDLOD malzemesiyle:
      `positionNode` ile displacement, `sampler2DArray` boya katmanları, normal;
      `CSMShadowNode` gölgesi; `SkyMesh` + sis. Görsel yükseklik Rapier
      heightfield ile aynı mı?
- [ ] **S3 Pipeline:** MRT + TRAA + GTAO + SSR + SSGI + bloom; her efektin GPU
      maliyeti ayrı ölçülür (1080p ve 1440p).
- [ ] **S4 Açık dünya stresi:** referans level'ın gerçek yerleşim ve foliage
      sayılarıyla draw call ve CPU kare süresi; WebGL baseline'ıyla
      karşılaştırma. WebGPURenderer'ın nesne başına CPU maliyeti burada ölçülür.
- [ ] **S5 (isteğe bağlı):** `LightProbeGrid` bake süresi ve görsel etkisi;
      `ClusteredLighting` ile N nokta ışık.
- [ ] Sonuç tablosu + yan yana ekran görüntüleri bu plana yazılır.

**GO ölçütleri** (sayılar Faz 0 baseline'ından sonra kullanıcıyla konur): görsel
fark kullanıcıya göre anlamlı; referans sahnede kare süresi kabul edilebilir
aralıkta; S4'teki CPU maliyeti instancing / indirect draw ile çözülebilir
görünüyor; terrain görseli collider ile eşleşiyor.

**NO-GO:** Forge WebGL'de devam edilir. O durumda WebGL tarafındaki kalite
seçenekleri (`SSRPass`, `TAARenderPass`, `LightProbeGridWebGL`) değerlendirilir.

### Faz 2 — Cut-over: yeni depo ve çekirdek

- [ ] Depo oluşturulur (K1): Vite + TypeScript strict, `three@0.187.0` sabit
      sürüm (K5), Rapier.
- [ ] Forge WebGL'e `forge-webgl-final` etiketi ve bakım modu notu (§3).
- [ ] **Toplu taşıma:** `engine/*` (render-three hariç), `tools/`, `builder/`
      ve ilgili `tests/engine`: kopyala → derle → testler yeşil. Render'a veya
      `src/scene`'e bağlı testler, modülleri geldiğinde açılır.
- [ ] Dev server: `vite.config.ts`'deki endpoint'ler `tools/devServer/` altında
      modüllere bölünür. Save validator'ları, `droppedFields`,
      `FORGE_PROJECT_ROOT` ve local-only middleware aynen taşınır; kayıt sürüm
      kontrolü (§2.8) eklenir.
- [ ] Kapılar: `tsc --noEmit`, `test:engine`, `verify:imports` (yeni sınırlarla),
      `verify:dist --strict`, `verify:world-data`; CI.
- [ ] `public/` starter content ve referans level'lar kopyalanır;
      `npm run world:random` CLI çalışır (World Builder dünyaları ilk günden
      üretilebilir).
- [ ] `CLAUDE.md`, `AGENTS.md`, `docs/architecture/ARCHITECTURE.md` yeni depoya
      uyarlanır; bu plan yeni depoya taşınır.
- [ ] `docs/PORT_LOG.md` başlatılır (§7).

### Faz 3 — Render çekirdeği ve level görüntüleyici

- [ ] Renderer host: init, resize, DPR, cihaz kaybı, gerçek backend rozeti;
      `?debug` overlay (`engine/perf` zaten three'siz) + GPU timestamp.
- [ ] Materyal sistemi: `ForgeMaterialDef` → node material (§2.3);
      katman / anizotropi / ORM; GLB + KTX2.
- [ ] Işık ve gölge: `CSMShadowNode`, reversed-Z (`reversedDepthBuffer` yapıcı
      seçeneği; WebGL'deki `EXT_clip_control` hilesi gerekmez), view distance.
- [ ] Çevre: sky atmosphere, height fog, cloud layer, WES bağlantısı
      (`engine/environment` three'siz), sky light / IBL (PMREM), reflection
      capture.
- [ ] `RenderPipeline` + kalite profilleri (§2.4).
- [ ] Level görüntüleyici: level.json → statik mesh'ler, instancing, HLOD;
      runtime route'unda salt görüntüleme.
- [ ] Kapı: referans sahnelerin statik içeriği ve çevresi, Faz 0 görüntüleriyle
      yan yana; kullanıcının ilk görsel kabulü.

### Faz 4 — Editör çekirdeği

- [ ] Editör kabuğu ve servisleri (§2.2): viewport host, kamera, seçim (CPU
      raycast picking), `TransformControls` gizmo, pivot, grup / hiyerarşi,
      undo / redo.
- [ ] DOM panelleri uyarlanarak taşınır: Outliner, Details (şema tabanlı),
      Content Browser, World Settings, ortam ve post-process ayrıntıları
      (görünüm ayarı burada yapılır), Add Actor menüsü. Parametre UI kuralları
      (kaydırıcı + kutu, TR ipucu / EN ad) aynen geçerli.
- [ ] Kaydet / aç, Open Level, Play (runtime'ı yeni sekmede açar).
- [ ] Kapı: Forge'daki `editor-authoring` smoke'unun karşılığı yeşil.

### Faz 5 — Açık dünya

- [ ] Terrain: spike'taki TSL CDLOD üretim kalitesine çıkar: morph, tile seam,
      8 boya katmanı, su birikintisi, kıyı ıslaklığı, kostik; tile akışı (editör
      + runtime), global harita.
- [ ] World Partition hücre akışı, HLOD, view distance, küçük nesne culling.
- [ ] Foliage: instancing + compute culling + indirect draw; impostor /
      billboard, rüzgâr, fade; foliage hücreleri.
- [ ] Editör araçları: sculpt, paint, foliage paint, landscape spline.
- [ ] World Builder penceresi + `/__world-random` endpoint'i + önizleme worker'ı.
- [ ] Kapı: referans açık dünya sahnelerinde görsel + performans kabulü;
      terrain collider ile eşleşiyor.

### Faz 6 — Oyun runtime'ı ve araçlar

- [ ] LevelRuntime + capability modülleri, gameplay framework, actor
      script'leri, input, karakter + kamera, Rapier fizik, ses, UI, save-game,
      AI + Recast/Detour nav, diyalog.
- [ ] VFX: partikül efektleri TSL'de. WebGPU'da nokta boyutu yok; büyük
      noktalar `Sprite` + instancing ile `PointsNodeMaterial`'a çevrilir.
      Mümkünse compute partikül.
- [ ] Araçlar: Vehicle component, tekerlek görsel node'ları, motor sesi, yüzey
      tepkisi.
- [ ] `templates/game-starter` karşılığı.
- [ ] Kapı: runtime smoke'ları (boot, playflow, checkpoint); araç terrain
      üstünde sürülüyor.

### Faz 7 — Su ve yansımalar

- [ ] Okyanus: FFT compute shader'a (bugün `RawShaderMaterial` ping-pong'u);
      yüzey, köpük, ada girintileri (inlet), kostik, kıyı.
- [ ] Göl ve nehir (TSL), sualtı, su–terrain bağlantıları.
- [ ] Yansımalar: önce SSR; gereken yerlerde `reflector()` ile planar yansıma;
      reflection capture / probe.
- [ ] Kapı: su görsel kabulü ve ölçüm.

### Faz 8 — Terrain deformasyonu ve araç hasarı

- [ ] Terrain deformasyonu: GPU yükseklik güncellemesi (texture veya compute),
      collider senkronu, ıslak iz, save-game kalıcılığı, editör yüzeyi.
- [ ] Araç hasarı: impact deform + mesh senkronu, `dentWear` TSL'de, parça
      kopma, kırılma (Voronoi bake) + debris / VFX / ses.
- [ ] Kapı: Ridgebound kopya sahnesinde hasar ve iz senaryoları.

### Faz 9 — İleri aydınlatma (her teknik ayrı karar)

Her teknik için: hipotez, küçük deneme, §2.10 ölçümü, geri alma yolu, kullanıcı
kararı.

- [ ] `LightProbeGrid` — açık dünya GI. Gün saati olay bazlı değiştiği için
      (sürekli hareketli güneş yok), geçişten sonra yeniden bake ya da iki durum
      arasında karışım mümkün; bu, bake'li GI için önemli bir avantaj.
- [ ] `ClusteredLighting` — gece sahneleri, farlar, sokak lambaları.
- [ ] SSGI profil ayarı; VXGI denemesi.
- [ ] `LightMapper` — yalnız statik yapılar için.
- [ ] `MeshletDrawingPipeline` — yalnız ölçümde yoğun mesh darboğaz çıkarsa.

### Faz 10 — Ridgebound göçü ve sürüm

- [ ] Ridgebound'un proje kökü Forge WebGPU'ya bağlanır (önce kopya, sonra
      gerçek veri).
- [ ] Oyun kuralları ve UI; tam Edit → Play → Save akışı.
- [ ] Üretim build'i (editörsüz, `verify:dist --strict`).
- [ ] Kapı: kullanıcı kabulü; Ridgebound'un Forge WebGL bağı kesilir.

---

## 5. Paralel yürütme

- Faz 5 ve Faz 6 ayrı oturumlarda paralel yürüyebilir (ortak dosyaları az).
- İş bölümü mevcut düzende kalır: toplu taşımadaki derleme / test düzeltmeleri
  ve iyi tanımlı saf fonksiyonlar + testleri Codex'e uygun; TSL / render
  tasarımı, Rapier ve inceleme Claude'da.
- Paralel oturumlar aynı index'i paylaşır: commit'ler yol sınırlı
  (`git commit -- <yollar>`).

## 6. Riskler

| Risk | Önlem |
|---|---|
| WebGPURenderer'ın nesne başına CPU maliyeti açık dünyada yüksek çıkar | Faz 1 S4'te ölçülür; instancing, `BatchedMesh`, indirect draw |
| Deneysel addon API'leri sürümle değişir | three sabit sürüm; addon'lar kendi sarmalayıcılarımızın arkasında; yükseltme ayrı, planlı adım |
| Akışla gelen yeni materyallerde shader derleme takılması | `compileAsync` ile ön ısıtma; materyal varyant sayısını sınırlama |
| Geçiş döneminde iki motorun bakımı | Cut-over sonrası Forge WebGL'de yeni özellik yok; taşınmış modüllere sonradan gelen hata düzeltmeleri port günlüğünde izlenir |
| Kapsam şişmesi ("her şeyi yeniden tasarlayalım") | §2.11: önce taşı, sonra iyileştir |
| CI'da GPU yok | CI: tsc, build, engine testleri, dist doğrulaması. Render testleri yerelde, başlıklı (headed) tarayıcıda; headless'ta canvas görüntüsü siyah gelebiliyor |
| Görsel kabul darboğazı | Kabuller faz sonlarında toplu istenir |
| WebGPU'suz cihazlar | K4 |

## 7. Taşıma günlüğü

Yeni depoda `docs/PORT_LOG.md`. Her satır: modül, kaynak yol, Forge SHA, işlem
(taşındı / uyarlandı / yeniden yazıldı), testler, durum. Aynı tablo, Faz 3–8
boyunca hangi Forge özelliğinin WebGPU'da hazır olduğunu gösteren kapsama
matrisi olarak da kullanılır. Cut-over'dan sonra Forge WebGL'de taşınmış bir
modüle hata düzeltmesi yapılırsa buraya "port bekliyor" diye işlenir.

## 8. Kararlar

| ID | Konu | Öneri | Durum |
|---|---|---|---|
| K1 | Yeni deponun adı ve yeri | `Forge-WebGPU` — yerel `C:\Users\emret\Desktop\Forge-WebGPU`, GitHub `emrtrn/Forge-WebGPU` | Açık |
| K2 | Forge WebGL'in durumu | Bakım modu; GitHub arşivi değil; `Forge` deposu ve adı kalır | Açık |
| K3 | Veri formatları | Başlangıçta aynı şema; değişiklik sürüm numarasıyla | Açık |
| K4 | WebGPU olmayan cihaz | Editör: WebGPU zorunlu. Oyun: başlangıçta zorunlu + açık mesaj; WebGL2 backend fallback'i Faz 6'da ölçümle karara bağlanır | Açık |
| K5 | three sürümü | 0.187.0 sabit (npm'deki en son); yükseltme ayrı adım | Açık |
| K6 | Render-three yatırım durdurma | Hemen yürürlüğe girsin (§3) | Açık |
| K7 | Editör UI | Mevcut paneller önce uyarlanarak taşınsın; redesign Faz 4 sonrası ayrı karar | Açık |
| K8 | Ridgebound göç zamanı | Faz 8 kabulünden sonra (Faz 10) | Açık |
| K9 | Referans donanım | Kullanıcının GPU'su; performans hedefleri Faz 0 baseline'ından sonra konur | Açık |

## 9. v0.1'den korunanlar

- Gerçek WebGPU doğrulaması; sessiz fallback yok (§2.6).
- Ölçüm kayıt formatı ve "ölçülmedi" dürüstlüğü (§2.10).
- Görünür özellik kapsama matrisi (§7).
- Kayıt güvenliği: validator allowlist, `droppedFields`, proje kökü sınırı
  (§2.7, §2.8).
- Ridgebound verisine Faz 10'a kadar yalnız kopya üzerinden dokunulması.

v0.1 dosyası (`FORGE_WEBGPU_EDITION_MASTER_PLAN.md`) bu belgeyle geçersizdir;
silinebilir.

## 10. İlk adımlar

1. §8 kararları.
2. Faz 0: referans sahneler, WebGL ekran görüntüleri ve ölçümleri.
3. Faz 1: spike S1 → S4, ardından GO / NO-GO.
