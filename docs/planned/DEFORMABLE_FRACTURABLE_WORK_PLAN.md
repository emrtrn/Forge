# Deformable & Fracturable Çalışma Planı

> Durum: **Faz 0 tamam** (2026-11-02): spike'lar ve açık kararlar kapandı.
> **Faz 1 kod tarafı tamam** (2026-11-03): saf `impactEvents.ts`, Rapier
> bağlantısı (`setImpactEventThreshold` / `impacts()`) ve actor "On Impact"
> olayı. **Faz 6 kod tarafı ve GPU ölçümü tamam** (2026-11-03), görsel
> kabul bekliyor. Etkileşim alanı ve static mesh sway Faz 6b'ye ayrıldı.
> **Faz 2 tamam** (2026-11-03): Voronoi bake çekirdeği. **Faz 3 tamam**
> (2026-11-03): fracture sidecar'ı + Static Mesh Editor bölümü. **Faz 4
> çekirdeği tamam** (2026-11-03): static placement'lar oyunda kırılıyor;
> actor component / override / VFX-ses alanları açık.
>
> **Kırılma sırası (kullanıcı kararı, 2026-11-03)** — yarım kalırsa buradan
> devam: (1) ~~Faz 4b-3 kırılma VFX/ses + debris ayarları~~ (tamam) → (2) **Faz 4c destek
> grafiği** (anchor/sabit parçalar, World Support, kısmi kırılma, ada çöküşü)
> → (3) Faz 5 kalıcılık (4c yüzünden parça bit maskesiyle) → (4) Faz 4d
> Extended Structures (ihtiyaç olunca). 4b-1, 4b-2 ve ahşap kıymık deseni
> tamam. APEX Destruction değerlendirmesi Faz 4c başlığının altında.
>
> Bu belge iki ön çalışmanın Forge açısından değerlendirilmiş, tek çalışma
> planına indirgenmiş hâlidir:
>
> - `DEFORMABLE_FRACTURE_PLAN.md` (Forge taslağı, 2026-11-02): Voronoi bake,
>   XPBD, sidecar veri modeli, editör bölümleri. İçeriği bu plana geçti,
>   dosya silindi.
> - `RIDGEBOUND_FORGE_DEFORMABLE_FRACTURABLE_TEKNIK_DEGERLENDIRME_v0.1.md`
>   (Ridgebound değerlendirmesi): kırılma modları, kademeli hasar, kalıcılık,
>   test sahnesi, kabul ve negatif testler. Oyun tasarımı içerdiği için
>   Ridgebound deposuna taşındı (`Games/Ridgebound/docs/design/`).
>
> Kapsam kuralı: mekanizma (fizik olayı, parçalama, deformasyon, yaşam döngüsü,
> kayıt altyapısı, editör) Forge'da olur. Hangi nesnenin kırıldığı, eşikler,
> hasarın oyundaki anlamı (teslimat cezası, rota kapanması) fork'un verisi ve
> oyun kodudur. Bu plana belirli bir oyunun kuralı girmez.

---

## 1. Kaynak belgelerin değerlendirmesi

### 1.1 Ortak ve doğru bulunanlar (plana alındı)

- Deformable ve Fracturable iki ayrı capability modülü olur. Terrain
  deformasyonu (`TERRAIN_DEFORMATION_PLAN.md`) ayrı hatta kalır.
- İlk kırılma yolu **önceden hesaplanmış parçalar + Rapier convex hull**.
  Oyun sırasında herhangi bir mesh'i keyfî kesen genel fracture kapsam dışı.
- Görsel şekil değişimi ile collider değişimi varsayılan olarak ayrı tutulur
  (`visual_only`). Collider'ı her göçükte yeniden kurmak yok.
- Kırılma idempotent olur: aynı olay iki kez parça seti üretmez.
- Kalıcılıkta parçaların her karedeki pozu değil, **nesne durumu** saklanır.
- Her yeni mod kendi test sahnesini, perf ölçümünü ve save/load kapısını
  geçmeden kapanmaz.

### 1.2 Eski ya da yanlış bulunanlar (düzeltildi)

Ridgebound belgesi 23 Ekim'deki `feat/open-world` görüntüsüne dayanıyor. O
tarihten sonra değişenler:

| İddia | Bugünkü durum (2026-11-02, kaynakta doğrulandı) |
|---|---|
| Runtime tekerlek izi/batma "planlı, uygulanmamış" | Terrain deformasyon Faz 0–3 ve Faz 4 efekt/patinaj tamam (`createTerrainDeformationModule`, `deformationField`/`deformationPersistence` testleri). |
| Terrain collision "statik trimesh" | Tile başına Rapier heightfield (açık dünya Faz 3). |
| "Rapier'dan çarpma bilgisi alınır" (örtük varsayım) | **Alınmıyor.** `updateRapierContacts()` yalnız `contactPairsWith` / `intersectionPairsWith` ile çift topluyor. `PhysicsContact` = `{a, b, isSensor}`. Impulse, nokta, normal ve `CONTACT_FORCE_EVENTS` hiçbir yerde yok. |
| Ragdoll: 0.19 spherical joint cone/twist sunmuyor | `applyRagdollJointLimits` raw joint set üzerinden limit uyguluyor. Halat ve zincir alternatifi için engel değil, yeniden doğrulanmalı. |
| Navmesh güncellemesi ilk fazlarda yok | Statik body değişimi `navigationDirty` bölgesi işaretliyor. Kırılan statik nesnenin navmesh'i serbest kalıp kalmadığı test edilecek. Büyük ihtimalle bedava geliyor. |

### 1.3 Forge'a alınmayanlar

- Ridgebound kullanım tabloları, S-01…S-05 senaryoları, ödül/teslimat
  sonuçları, öncelik matrisindeki "oyun değeri" sütunu. Bunlar oyun tasarımı
  ve GameDesign / Ridgebound deposunda yaşar (Forge yalnız platform).
- `FLEXING` durumu: geçici esneme görsel bir moddur, kalıcı durum makinesine
  girmez.
- Hacimli soft body (jöle, yastık, çuval): somut bir tüketici çıkana kadar
  backlog'da.

### 1.4 Planın çözdüğü çelişki: başlangıç sırası

Forge taslağı Voronoi bake ile (F0→F2), Ridgebound belgesi bitki shader'ı ve
göçük ile başlamayı öneriyordu. Kaynak taraması ikisinin de önünde aynı eksik
olduğunu gösterdi: **çarpma şiddeti, noktası ve normali veren bir olay
yüzeyi.** Kırılma eşiği, göçük ve hasar birikimi hep buna dayanıyor. Bu yüzden
sıra şöyle:

**Faz 0 doğrulama → Faz 1 impact olayı → Faz 2 bake çekirdeği ile Faz 6
rüzgâr shader'ı paralel → Faz 3–5 kırılma → Faz 7 göçük → Faz 8–9 genişleme.**

---

## 2. Mevcut temel ve entegrasyon noktaları (2026-11-02)

| Konu | Durum | Kaynak |
|---|---|---|
| Fizik | Rapier `@dimforge/rapier3d-compat ^0.19.3`, yalnız rigid body; sabit adım | `engine/physics/physicsSubsystem.ts`, `fixedStep.ts` |
| Kontaklar | Her fizik karesinden sonra çift listesi, `reportableContacts` filtresi (`simulationGeneratesHitEvents`) | `physicsSubsystem.ts` (`updateRapierContacts`) |
| Actor olayları | Kontaklar `"hit"` / `"overlap"` actor olayına dönüşüyor (şiddet yok) | `engine/behavior/behaviorSubsystem.ts` |
| Hasar mesajı | `Damage.Apply` mesaj standardı (A6): `{ amount, instigator?, damageType? }` | `src/scene/capabilities/aiModule.ts`, `src/game/behaviors.ts` |
| Impulse uygulama | `applyImpulse(entityId, impulse)` | `physicsSubsystem.ts` |
| Convex collider | `ColliderDesc.convexHull`; `*.collision.json` içinde `convex` primitive baked `points` | `engine/scene/collision.ts` |
| Hull üretimi | **Yalnız editörde**: `StaticMeshEditor.computeConvexHullPoints()` (three `ConvexGeometry`) | `src/editor/StaticMeshEditor.ts` |
| Model örnekleme | `gltf.scene.clone(true)`: **geometri ve materyal paylaşılıyor** | `RuntimeSceneApp.ts`, `SceneApp.ts` |
| Statik instancing | Uygun statik placement'lar `InstancedMesh` slotunda. Yok edilen slot noktaya çökertiliyor (`collapseInstance`) | `RuntimeSceneApp.ts` (`instanceSlots`) |
| Foliage shader | Fade `onBeforeCompile` ile hem renk hem gölge/derinlik materyaline enjekte. **Rüzgâr yok**, WES'te rüzgâr parametresi yok | `engine/render-three/foliage.ts`, `foliageFade.ts` |
| Placement kimliği | Layout içinde benzersiz `id` + semantik `role` | `engine/scene/placementIdentity.ts` |
| Save-game | `GameSaveState` = seviye + oyuncu + `flags` (script persistent state) + `vehicles`. **Dünya nesnesi durumu yok** | `engine/persistence/saveGameState.ts` |
| Streaming | Actor Script aktörleri hücreyle akar, EndPlay `"unloaded"`; dinamik aktif alan uzak body'leri askıya alıyor | `worldPartitionModule`, `DynamicPhysicsActiveAreaSettings` |
| Perf | Subsystem profiler, kalite profilleri, perf budget | `engine/core/subsystemProfiler.ts`, `engine/perf/*` |
| Runtime modülleri | `createDefaultRuntimeModules()`, tick slotları | `src/scene/capabilities/defaultRuntimeModules.ts` |

---

## 3. Mimari

```
engine/physics/
  impactEvents.ts            // Faz 1: PhysicsImpact tipi, toplama/eşik, saf yardımcılar
  fracture/
    voronoiFracture.ts       // Faz 2: seed, hücre düzlemleri, dışbükey kırpma
    fractureBake.ts          // Faz 2: hücre → parça geometrisi, iç yüz grubu, hull, kütle
    fractureTypes.ts         // Faz 3: AssetFractureDef + normalizeAssetFracture
  deformable/
    deformableTypes.ts       // Faz 7: AssetDeformableDef + normalizer
    impactDeform.ts          // Faz 7: kalıcı vertex göçüğü (saf)
    xpbdSolver.ts            // Faz 9 (kapılı)
engine/render-three/
  windSway.ts                // Faz 6: vertex rüzgâr/etkileşim enjeksiyonu (renk + gölge)
  deformableMeshSync.ts      // Faz 7/9: konum → BufferGeometry, normal/bounds
src/scene/capabilities/
  fractureModule.ts          // Faz 4
  deformableModule.ts        // Faz 7
src/editor/
  StaticMeshEditor.ts        // Fracture / Deformable bölümleri (Faz 3, 7)
```

Sorumluluk akışı:

```
Rapier step ──► impactEvents (Faz 1) ──┬─► fractureModule ──► hasar/durum ──► save (Faz 5)
                                       ├─► deformableModule (göçük)
Damage.Apply / script ─────────────────┘        └─► VFX / ses / actor olayları
```

İlkeler:

- **Kapalı güvenli.** Modül yoksa veya sidecar yoksa nesne bugünkü
  rigid/statik davranışını aynen korur (vehicle ve terrain deformation deseni).
- **Editör ayrımı.** Bake ve geometri kodu `engine/` altında, saf ve test
  edilebilir. Editör yalnız UI. Runtime editöre bağımlı olmaz.
- **Authored dataya yazma yok.** Runtime kırılma ve göçük durumu level
  dosyasına değil save-game'e gider.
- **Birimler açık.** Eşikler N·s (impulse) olarak tanımlanır.
  Contact-force tabanlı ölçüm seçilirse `kuvvet × adım` ile impulse'a çevrilir
  ve bu dönüşüm testte sabitlenir.

---

## 4. Veri modeli (taslak, Faz 3'te kesinleşir)

```jsonc
// <Model>.fracture.json — asset sidecar, *.collision.json deseni
{
  "version": 1,
  "source": "voronoi",            // "voronoi" | "imported" (Faz 8)
  "seed": 1234,
  "cellCount": 16,
  "interiorMaterialSlot": "Interior",
  "breakImpulse": 400,            // N·s; ölçülmüş değer değil
  "damageToBreak": null,          // Damage.Apply birikimi; null = yalnız impact
  "chunkLifetime": 8,             // s; 0 = kalıcı
  "maxActiveChunks": 16,
  "chunks": [ { "id": "c0", "hull": [[0,0,0]], "mass": 1.2 } ],
  "sourceHash": "…"               // kaynak GLB değişince bake bayatlar → editör uyarısı
}
```

- Placement override'ları `fracture: { enabled?, breakImpulse? }` alanındadır.
  `validatePlacement` / `applyTransformFields` allowlist'ine girer.
- Kalıcı kimlik için mevcut placement `id` (actor için entity id) kullanılır.
  Yeni bir `persistentId` alanı açılmaz.
- `<Model>.deformable.json` (Faz 7): `mode: "impact"` (Faz 9'da `"cloth"`),
  `radius`, `maxDepth`, `plasticity`, `collisionPolicy: "visual_only"`,
  `maxDents`. Bir modun kullanmadığı alanlar editörde görünmez.
- Her yeni sidecar **yeni bir allowlist yüzeyidir**: kayıt endpoint'i,
  `tools/saveValidator.ts` içinde normalizer'ı yeniden kullanan validator,
  droppedFields/serializationDrift kapsamı ve `CLAUDE.md` kaydı gerekir.

---

## 5. Fazlar

Durum: `[ ]` açık · `[~]` sürüyor · `[x]` tamam · `[-]` bilinçli olarak kapsam dışı

### Faz 0 — Doğrulama spike'ları ve kararlar

Amaç: kod yazmadan önce API ve maliyet belirsizliklerini kapatmak.

- [x] Rapier 0.19 impact verisi spike'ı. `EventQueue` +
      `ActiveEvents.CONTACT_FORCE_EVENTS` + `contactForceEventThreshold`
      ile `world.contactPair(…)` manifold okuması karşılaştırıldı
      (bulgular aşağıda).
- [x] Ölçüm: 200 dinamik body'li sahnede iki yolun fizik adımı maliyeti.
- [x] Paylaşımlı geometri doğrulaması ve copy-on-write stratejisi.
- [x] Kırılan statik body kaldırılınca `navigationDirty` → Recast tile
      yeniden kurulumu.
- [x] §6'daki açık kararlar kullanıcıyla kapatıldı (2026-11-02).

Kabul: spike notları bu belgeye işlenir; seçilen impact yolu ve geometri
sahipliği stratejisi yazılıdır.

#### Faz 0 bulguları (2026-11-02)

Spike'lar doğrudan Rapier 0.19.3 üzerinde, Forge'un collider ayarlarıyla
(sürtünme 0.8, restitution 0, CCD, damping 0.12/0.45, adım 1/60) Node'da
çalıştırıldı. Betikler depoya girmedi. Faz 1 testleri aynı senaryoları
`tests/engine/` altında yeniden kurar.

**Impact verisi.** İki yol aynı sayıyı veriyor
(`|totalForce| × dt` = Σ`contactImpulse`, 6 hane). Çarpma impulse'unun
neredeyse tamamı **tek bir 60 Hz adımda** toplanıyor:

| Senaryo | Beklenen m·v (N·s) | Ölçülen tepe (N·s) | Sonraki adımlar |
|---|---|---|---|
| 10 kg, 0.5 m düşüş | 31.3 | 34.2 | 1.3, 2.0 |
| 10 kg, 2 m | 62.6 | 64.4 | 0.4, 1.7 |
| 10 kg, 5 m | 99.0 | 99.7 | 0.1, 0.8 |
| 100 kg, 2 m | 626 | 644 | 3.5, 16.7 |
| 1000 kg, 10 m/s yatay → statik duvar | 10 000 | 8 545 | 102 (6 adım sonra) |

- Aynı koşu iki kez bayt bayt aynı sonucu verdi (deterministik).
- Duran yük adım başına ≈ m·g·dt üretiyor (10 kg → 1.6–2.0 N·s). Uyuyan
  body olay üretmiyor. Eşik bundan büyük olmalı: validator, asset kütlesine
  göre `breakImpulse < 4·m·g·dt` olduğunda uyarır (kendi ağırlığıyla kırılma).
- Olay bayrağı yalnız hedefte (ör. statik duvar) olsa da yetiyor. Eşik altı
  temaslar WASM içinde eleniyor ve JS'e hiç gelmiyor.
- Kinematik gövde ile sabit gövde arasında olay **oluşmuyor**. Kinematik
  karakter ya da platform statik bir nesneyi çarpmayla kıramaz; bu yol
  `Damage.Apply` / script ile kapatılır. Araçlar dinamik olduğu için
  etkilenmiyor.
- Olaylar temas **noktası** vermiyor (yalnız toplam kuvvet ve en güçlü
  yön). Nokta ve normal manifold'dan okunur (`solverContactPoint`,
  `normal()`; `flipped` hesaba katılır).

**Maliyet** (200 dinamik kutu, 600 adım, adım başına ms, iki tur):

| Mod | ms/adım |
|---|---|
| Olay yok (taban) | 0.117–0.125 |
| Bugünkü gibi `contactPairsWith` taraması | 0.187–0.212 |
| Her çift için manifold okuma | 0.278–0.291 |
| Olay yalnız 10 collider'da (opt-in) | 0.112–0.125 |
| Olay herkeste, yüksek eşik | 0.108–0.115 |
| Olay herkeste, eşik 0 (40 olay/adım) | 0.132–0.158 |

Opt-in olayın maliyeti ölçüm gürültüsünün altında. Her çiftte manifold
okumak taramayı yaklaşık %40 pahalandırıyor.

**K-03 kararı (teknik): hibrit.** Fracture/deformable sidecar'ı olan
collider'lar `CONTACT_FORCE_EVENTS` ile ve eşik `minImpulse / dt` (kuvvet
birimi) olacak şekilde kurulur. Yalnız eşiği geçen çiftler için o adımda
manifold okunur ve nokta (solver noktalarının impulse ağırlıklı ortalaması)
ile normal çıkarılır. Forge bugün `rapierWorld.step()`'i kuyruksuz çağırıyor
ve bir karede en fazla 4 alt adım atıyor. Kuyruk her alt adımdan sonra
boşaltılmalı, çünkü manifold yalnız son adımı yansıtır.

**Paylaşımlı geometri.** Runtime klonları `gltf.scene.clone(true)` ile
oluşuyor, yani geometri ve materyal paylaşılıyor. Statik placement'lar
`InstancedMesh` slotlarında. **Copy-on-write emsali zaten var:** mesh paint
alan placement `asClone` kararıyla instancing'de gizleniyor, ayrı klon
olarak çiziliyor ve `child.geometry.clone()` alıyor
(`RuntimeSceneApp.ts`, `createInstancedCloneObject`). Strateji:
deformable asset'in placement'ları yükleme anında `asClone` olur, geometri
ilk göçükte klonlanır. Fracture için ek iş gerekmiyor: kaynak slot
`collapseInstance` ile çökertilir, parçalar ayrı mesh olarak doğar.

**Navmesh.** `removeEntities` ve `setEntityCollisionEnabled` statik body'nin
bölgesini `navigationDirty`'ye yazıyor. AI modülü
(`applyRecastNavigationChanges`) bu bölgelerin Recast tile'larını geçersiz
kılıyor. Kırılan statik nesne navmesh'i kendiliğinden açıyor. Dinamik
parçalar navmesh engeli olmuyor; v1 için kabul edilebilir.

### Faz 1 — Impact olay yüzeyi (engine/physics)

- [x] `PhysicsImpact { a, b, point, normal, impulse, relativeSpeed }` tipi.
      Body başına fizik karesi içinde toplanır (alt adımlar birleşir).
      `engine/physics/impactEvents.ts`: `ImpactAccumulator` çift başına
      impulse'u toplar, nokta ve normali impulse ağırlıklı alır (birbirini
      silen normallerde en güçlü adım karar verir), hızın en büyüğünü tutar.
      Çift yönelimi `PhysicsContact` ile aynı (`a < b`), normal `a`'dan `b`'ye.
      Manifold noktası olmayan çiftte `point` null; tüketici body konumuna düşer.
- [x] Opt-in: yalnız impact isteyen collider'lar (fracture/deformable sidecar'ı
      olanlar veya açık bir `generateImpactEvents`) olay üretir. Diğer
      body'lerin maliyeti değişmez.
      Authored alan açılmadı: runtime API
      `physics.setImpactEventThreshold(entityId, minImpulse | null)` (N·s).
      Faz 4/7 modülleri sidecar'ı olan nesneler için çağırır; ayar body'den
      bağımsız tutulur (rebuild/yeniden ekleme sonrası geri uygulanır),
      `clear()` siler. Kimse opt-in değilse `step()` kuyruksuz çağrılır, yani
      eski yol birebir aynı. Yeni allowlist yüzeyi yok.
- [x] Hibrit okuma (K-03): `EventQueue` her alt adımdan sonra boşaltılır;
      eşiği geçen çiftte o adımda manifold okunur (impulse ağırlıklı nokta,
      `flipped` düzeltmeli normal).
      Düzeltme: JS API'de solver noktalarının impulse'u yok. Nokta = manifold
      başına solver noktalarının ortalaması, manifold ağırlığı = o manifoldun
      Σ`contactImpulse`'u. Rapier kuralı doğrulandı: `normal()` olayın
      `collider1`'inden `collider2`'ye bakar, `totalForce` normal yönünde.
      `relativeSpeed` tahmindir: adım sonrası bağıl hız + J·(1/mₐ + 1/m_b),
      yalnız doğrusal.
- [x] Gürültü eşiği ve olay bütçesi (kare başına üst sınır).
      Eşik entity başına, WASM içinde (`contactForceEventThreshold`
      = `minImpulse / dt`); bütçe `ImpactAccumulator` varsayılanı (64/kare,
      en güçlüler kalır, `impactsOverBudget()`). Kalite profiline bağlanması
      Faz 4 bütçe işiyle birlikte.
- [x] `physicsSubsystem` API'si: `impacts()` veya listener. Rapier dışı
      (AABB) backend'de boş liste.
      `impacts()`, `impactsForEntity(id)`, `impactsOverBudget()`; her
      `update()` başında boşalır, adım atılmayan karede boş.
- [x] Actor script `"hit"` olayına isteğe bağlı `impulse`/`point`/`normal`
      yükü. Geriye uyumlu.
      Karar (kullanıcı, 2026-11-03): `"hit"`'e yük yerine **ayrı `impact`
      olayı** ("On Impact"). `hit` yalnız temas kenarında tetiklendiği için
      çarpma ondan sonraki bir adımda olabiliyordu. `impact` opt-in nesnede
      impact olan her karede `context.event.impact` ile çalışır; mevcut hit
      script'leri etkilenmez. `PhysicsQuery.impactsForEntity` isteğe bağlı.
- [x] Testler: kutu düşmesi → beklenen aralıkta impulse; eşik altı olay yok;
      30/60/144 Hz render'da aynı sabit adımda aynı olay dizisi.
      Saf: `tests/engine/impactEvents.test.ts` (11). Rapier:
      `tests/engine/physicsImpacts.test.ts` (4): 10 kg / 2 m düşüş
      64.447 N·s, 6.29 m/s, nokta zemin yüzeyinde, normal −Y (Faz 0'la aynı);
      eşik üstü/opt-out/opt-in'siz dünya sessiz; rebuild sonrası opt-in
      korunur, `clear()` siler; 30/60/144 Hz'de aynı toplam ve tepe.
- [-] Yeni collider alanı eklenirse allowlist (`applyTransformFields`,
      collision sidecar) ve `CLAUDE.md`. Gerekmedi: opt-in runtime API'si.

Kabul: `npm run test:engine -- --filter impact` yeşil, `build:verify` yeşil,
impact kapalı sahnede fizik adımı maliyeti değişmemiş.

### Faz 2 — Voronoi bake çekirdeği (saf geometri)

Faz 1'den bağımsız. Faz 6 ile paralel yürür. Saf fonksiyon + test olduğu için
Codex'e uygun.

- [x] Seed'li tohum üretimi (sınır kutusu içinde, isteğe bağlı yoğunlaştırma
      noktası). `fractureSeeds`: mulberry32, sınırlar her yandan %1 içeri;
      `focus` ilk `round(share × cellCount)` tohumu küre içinde çeker.
- [x] Hücre başına orta düzlemlerle **dışbükey kapalı mesh** kırpma (kutu,
      duvar, panel, sandık). `voronoiCellPlanes` + `clipPolyhedron`
      (Sutherland–Hodgman, konum/normal/UV enterpolasyonu, düzlem üstü
      noktalardan kapak).
- [x] Parça geometrisi: dış yüzler kaynak UV/normal ile, kesik yüzler ayrı
      material grubu ve kutu projeksiyonu UV ile. Grup 0 dış, grup 1 iç;
      iç UV kaynak-yerel konumdan (komşu parçaların kesik yüzleri hizalı),
      baskın eksen X→YZ, Y→XZ, Z→XY.
- [x] Hull noktaları = hücre köşeleri (ayrıca `ConvexGeometry` gerekmez).
      Kütle hacimle orantılı, parça merkezi = pivot.
- [x] Determinizm: aynı mesh + seed → bayt bayt aynı çıktı.
- [x] Testler: hacim korunumu (toleransla), örtüşme yok, her hull geçerli,
      dejenere hücre (çok küçük/ince) birleştirilir veya atılır.
      "Birleştirme" = en küçük dejenere hücrenin tohumunu atıp Voronoi'yi
      yeniden hesaplamak: komşular hacmi emer, her parça dışbükey kalır
      (`mergedCells`). `tests/engine/fracture.test.ts` (13).

Uygulama (2026-11-03): `engine/physics/fracture/voronoiFracture.ts` +
`fractureBake.ts`, three'siz typed array'ler (BufferGeometry'ye çeviri
Faz 3/4'te render katmanında). Codex yazdı, Claude tasarladı ve inceledi;
inceleme sonrası `interiorUvScale` doğrulaması eklendi. Bilinen sınırlar:
tohumlar AABB içinde çekildiği için kutu olmayan dışbükey mesh'te bazı
hücreler boş kalır ve birleşir (parça sayısı `cellCount`'tan az olabilir);
`checkFractureSource` ve köşe kaynakları O(n²), düşük poligonlu kırılabilir
asset için yeterli. Faz 3 doğrulayıcısı `checkFractureSource`'u kullanacak.

Kabul: `--filter fracture` yeşil; 16 hücreli kutu bake'i < 50 ms (ölçülür,
hedef değil). **Kapandı:** filtre yeşil, medyan 2.9–3.5 ms.

### Faz 3 — Fracture asset ve editör yüzeyi

- [x] `AssetFractureDef` + `normalizeAssetFracture` (`fractureTypes.ts`).
      Sidecar yalnız parametre tutar: `version`, `source`, `enabled`, `seed`,
      `cellCount` (2–64), `density` (kg/m³; kütle = hacim × yoğunluk,
      placement ölçeği³ runtime'da), `interiorMaterialId` (§4'teki slot adı
      yerine manifest materyal id'si; null = dış materyal), `interiorUvScale`,
      `breakImpulse`, `damageToBreak`, `chunkLifetime`, `maxActiveChunks`,
      `sourceHash`. Sınırlar `FRACTURE_LIMITS` (editör kaydırıcılarının da
      kaynağı; seed 0–999 999). §4'teki `chunks` dizisi yok (K-02).
- [x] Yükleyici: `<Model>.fracture.json`, `assetCollisionLoader` desenini
      izler. `src/scene/assetFractureLoader.ts`: sidecar yok = kırılmaz
      (null, uyarısız); bozuk = bir kez uyarı + null.
- [x] `/__save-fracture` endpoint'i + `validateSaveFracturePayload`
      (normalizer'ı yeniden kullanır; 7. allowlist yüzeyi). `CLAUDE.md` kaydı.
      Yol: public-kök göreli, `..`/`\`/`:`/NUL yok, `.fracture.json` ile biter.
      Editör: `src/editor/assetFractureStore.ts`.
- [x] Parça geometrisinin saklanması (K-02): önerilen v1, geometriyi
      kaydetmeyip yüklemede `seed + kaynak mesh`'ten deterministik yeniden
      bake etmek ve `sourceHash` ile bayatlığı yakalamak.
      Three köprüsü `engine/render-three/fractureGeometry.ts`:
      `fractureSourceFromObject(gltf.scene)` modeli kök uzayında birleştirir
      (düğüm dönüşümü + normal matrisi, aynalı düğümde sarım düzeltmesi,
      materyal listesi), `fractureChunkGeometry` gruplu BufferGeometry kurar.
      `fractureSourceHash` FNV-1a; editör modeli ile runtime `clone(true)`
      aynı hash'i verir. Hash UVW eşlemesi uygulandıktan sonraki modelden
      alınır (runtime da UVW'yi `gltf.scene`'e uygular) — Faz 4 bu sırayı
      korumalı.
- [x] Static Mesh Editor'da "Fracture" bölümü: etkin, hücre sayısı, seed, iç
      yüz slotu, eşik, ömür, en fazla aktif parça. Parametre UI kurallarına
      uyar (kaydırıcı + kutu, TR ipucu / EN ad).
      `src/editor/staticMeshFracture.ts` (editöre ince bağlantı): "Add
      Fracture" sidecar'ı oluşturur; Enabled, Cell Count, Seed, Density,
      Break Impulse, Chunk Lifetime, Max Active Chunks, Interior UV Scale,
      Damage To Break (boş = yalnız çarpma), Interior Material (manifest
      materyali ya da dış materyal). Her alan normalizer'dan geçer; Save
      yalnız değişiklik varsa ve fracture eklenmişse yazar. `paramFields`
      seçicisine `.sm-row` eklendi (Static Mesh Editor'ın sınırlı alanları da
      kaydırıcı alır; mevcutlardan etkilenen yalnız Fill Alpha).
- [x] "Bake" düğmesi, patlatılmış önizleme kaydırıcısı, parça hull wire'ı
      (`collisionView` genişletmesi). Bake modeli `fractureSourceFromObject`
      ile okur, `sourceHash`'i yazar; Cell Count / Seed / UV ölçeği değişince
      kendiliğinden yeniden bake eder. "New Seed", Show Chunks (model yerine
      parçalar), Explode (merkezden dışa, yalnız önizleme), Show Hulls
      (`ConvexGeometry` kenarları; collisionView yerine bölümün kendi
      grubunda).
- [x] Doğrulama uyarıları: bayat bake, dışbükey olmayan mesh (v1'de
      desteklenmez), aşırı parça sayısı. `fractureWarnings` (sıra:
      not-baked/stale-bake, not-closed, not-convex, many-chunks >32,
      self-weight `breakImpulse < 4·m·g·dt`, multi-material) bölümün
      altında listelenir; model yüklenmeden "bayat" denmez.
- [x] droppedFields / serializationDrift testleri, maksimal sidecar
      round-trip. `tests/engine/fractureAsset.test.ts` (23): maksimal def
      kendine normalize olur, kayıttan `dropped[]` boş geçer, bilinmeyen
      alan raporlanır; hash sabitlenmiş değerle kilitli.
      `tests/engine/fractureGeometry.test.ts` (4).

Kabul: kaydet → yeniden aç round-trip, `dropped[]` boş, editör smoke'u
(5273) bake + önizleme. **Kapandı (2026-11-03):**
`tests/smoke/fracture-editor.spec.ts` Shape Cube'a fracture ekler, 12 → 6
parça yeniden bake eder, Explode + hull'ları açar, kaydeder (`sourceHash`
dahil), ikinci Save'de yazmaz, yeniden açınca değerleri okur ve bayat uyarısı
vermez. Kullanıcı görsel kabulü ayrı.

### Faz 4 — Fracture runtime (`fractureModule`)

- [x] Modül `createDefaultRuntimeModules()`'e kapalı güvenli eklenir.
      `src/scene/capabilities/fractureModule.ts`; shell `FractureHost`
      servisi (fizik alt kümesi, model, kaynak devreden çıkarma, dinamik
      render nesnesi kaydı, materyal, bütçe). Host ya da modül yoksa
      placement'lar düz statik kalır; editör modunda çalışmaz.
- [x] Tetikleyiciler: impact eşiği (Faz 1), `Damage.Apply` birikimi
      (`damageToBreak`), script/editör çağrısı (`Fracture.Break`).
      Impact: kırılabilir her entity `setImpactEventThreshold(breakImpulse)`
      ile opt-in olur, modül her karede `impacts()` okur. Script:
      `Fracture.Break` mesajı ya da `fractureCommandsService.breakEntity`.
- [x] İdempotent durum geçişi: `intact → fractured` bir kez olur. Aynı
      karedeki çoklu olaylar tek parça seti üretir. `FractureRegistry`
      (`engine/physics/fracture/fractureRuntime.ts`, Codex).
- [x] Kaynağı devreden çıkar: body'yi kaldır, instancing slotunu
      `collapseInstance` ile çökert ya da klonu gizle. Shell'in mevcut
      `destroyActorEntity` yolu.
- [x] Parçalar: kaynağın dünya pozu ve hızıyla doğar, hull collider alır,
      çarpma noktasından dışa impulse görür. `planChunkSpawns`: dünya pozu
      three XYZ quaternion'uyla (fizik/render ile aynı), ölçeklenmiş hull,
      kütle × |sx·sy·sz|, dışa tekme `0.5·min(6 m/s, J/Σm)` (script'te
      1.5 m/s). Ek: çarpana impulse'un %60'ı geri verilir — statik kaynak
      onu fizik adımında durdurmuştu, yoksa araç kırdığı sandıkta çakılı
      kalıyordu (smoke: 0 → 5 km/h).
      Bulunan motor hatası: primitive'li (convex) dinamik gövdede `massKg`
      uygulanmıyordu (Rapier yoğunluk 1 → hacim kg); artık primitive'lere
      eşit bölünür (`physics mass` testi; araçlar etkilenmez, şasileri
      yoğunluğu sıfırlayıp kütleyi ayrıca ekliyor).
- [x] Bütçe: asset başına `maxActiveChunks` ve kalite profiline bağlı global
      sınır. Eskiler önce uyutulur/silinir, küçük parçalar erken temizlenir.
      En büyük `maxActiveChunks` parça doğar; `QualitySettings.
      fractureChunkBudget` (192/128/64/32), en eski önce silinir; ömür
      `chunkLifetime × (0.5 + 0.5·min(1, hacim/ortalama))`. Uyutma Rapier'a
      bırakıldı.
- [x] Ömür sonunda geometri/materyal/collider dispose edilir. Hücre unload ve
      level değişiminde de temizlik yapılır. Collider + mesh ömürde ve level
      değişiminde kaldırılır; parça geometrisi asset başına paylaşılır ve
      level kapanınca dispose edilir. World Partition (4b-2): kırılan kaynağın
      hücresi (`FractureHost.cellOf`, akan aktörler + akan statik
      placement'lar) kırılma anında kaydedilir; `onCellUnloaded` gelince o
      hücrenin parçaları `budget.removeOwner` ile kalkar. Kaynak hücre
      dönünce bütün gelir (shell onu layout'tan yeniden kurar; placement
      hemen yeniden kaydolur, aktör yeniden doğunca). Kırık durumun hücre
      dönüşünde korunması Faz 5'tir.
- [~] Actor olayı `Fracture.Broken` (instigator, impulse) + VFX/ses kancası
      (veri ile bağlanır, kod sabit değil). `Fracture.Broken` script mesajı
      yayınlanır (`entityId`, `instigator`, `impulse`); VFX/ses sidecar
      alanları açık.
- [x] Perf sayaçları: aktif parça, spawn hitch (ms), fizik adımı payı.
      `?debug` satırı `fracture: objects … broken … chunks … breaks … spawn
      … ms`; fizik payı mevcut subsystem profilinde.
- [~] Generic test level'ı `public/layouts/PhysicsInteractionTest.level.json`:
      kutu, duvar, panel, ot alanı, sürülebilir araç. Kutu (4), duvar,
      panel (2), Reference Car (`forge.vehicle`). Yeni kırılabilir asset'ler
      `StaticMeshes/Destructible/` (küp GLB kopyası + kendi fracture,
      collision, materyal dosyaları; paylaşılan `Shape_Cube`'a dokunulmadı).
      Ot alanı Faz 6b etkileşim alanıyla eklenecek.
- [x] Engine testleri: eşik altı kırılmaz, çift tetik tek set üretir, bütçe
      aşılmaz, dispose sonrası kaynak sızıntısı yok.
      `tests/engine/fractureRuntime.test.ts` (21) + `physics mass` testi.
- [x] Browser smoke: Play'de araçla kutuya çarp → kırılır, parça sayısı
      sınırda. `tests/smoke/fracture-runtime.spec.ts`: 2 sandık / 20 parça,
      spawn ≈1.4 ms, araç kırıp geçer, parçalar ömürde temizlenir.
- [x] Placement override `fracture: { enabled?: false, breakImpulse? }` (§4,
      K-04, Faz 4b-1). Asset sidecar asıl tanım: placement yalnız kapatabilir
      (asset `enabled: false` her zaman kazanır; `true` yazılmaz) ya da eşiği
      `FRACTURE_LIMITS.breakImpulse` içinde değiştirir. Tip
      `PlacementFractureOverride` (`fractureTypes.ts`); save
      `validatePlacementFracture` (`validatePlacement`, bozuk değer kaydı
      reddeder); `clonePlacement`; modül `registry.register(…, placement.fracture)`.
      Editör: Details "Fracture" bölümü (`panels/details/fractureDetails.ts`)
      yalnız sidecar'ı açık asset'lerde görünür (sidecar seçimde okunur,
      seçim kalkınca yeniden okunur); Breakable + Break Impulse (boş = asset,
      kaydırıcı 0–5000), geri alınabilir. Testler: `fractureAsset.test.ts` (3
      yeni), drift fixture'ı; smoke'lar: editör override + undo/redo + Save
      payload, runtime opt-out (7 → 6 nesne).
- [x] Actor Script aktörleri için `Fracturable` component (4b-2): aktörün
      mesh component'inin asset'indeki sidecar'ı kullanır; props
      placement override'ıyla aynı (`enabled`, `breakImpulse`, boş = asset).
      `readFracturableComponent` (`engine/scene/components.ts`),
      `ACTOR_COMPONENT_KINDS`, capability coverage kuralı, Actor Script
      editöründe form (Breakable, Break Impulse; TR ipucu). Modül aktörleri
      level başında sahne belgesinden, sonra entity sink'ten (`addEntity` /
      `removeEntity`: spawn ve hücre akışı) izler. Kırılma pozu canlıdır:
      `FractureHost.sourcePose` aktörün render nesnesini (mesh ölçeği dahil)
      ya da simüle placement'ın gövdesini verir. Kırılan kaynağın script'leri
      EndPlay(`destroyed`) alır (`BehaviorSubsystem.retireEntity`). Asset
      bake'i level başına bir kez ve gerektiğinde (akan aktörün modeli
      yüklenmemişse bir sonraki doğuşta tekrar denenir). Test:
      `Script_BreakableCrate.actor.json` (simüle, 300 N·s) test level'ında;
      smoke 8 m'den düşen aktörün yere çarpınca yerde kırıldığını doğrular
      (parça y 0.2–0.8 m). `tests/engine/fractureModule.test.ts`: sahte host'la
      placement override, aktör takibi, canlı poz, hücre temizliği, teardown.

Kabul: `build:verify` yeşil, smoke yeşil; kullanıcı görsel/oynanış kabulü
ayrı raporlanır. **Çekirdek kapandı (2026-11-03)**; açık maddeler (actor
component, placement override, VFX/ses alanları, hücre temizliği) Faz 4b.

### Faz 4b-3 — Kırılma VFX/ses ve debris ayarları

Sidecar alanları (normalizer + maksimal test + Static Mesh Editor), hepsi
veriyle bağlanır, kod sabiti yok:

- [x] `breakEffect` (manifest `effect` id | null): kırılma noktasında
      (`impact.point`, yoksa hacim merkezi) bir kez oynar.
- [x] `breakSound` (manifest `sound` ya da `soundCue` id | null): aynı
      noktada uzamsal, tek seferlik. `AudioCommands.playOneShot(sourceId,
      options)` eklenir (bus yalnız ham sesi çalıyor; cue rastgeleliği kırılma
      sesleri için önemli).
- [x] `crumbleBelow` (kaynak hacmin payı, 0 = kapalı): bu paydan küçük parçalar
      gövde olarak doğmaz; `crumbleEffect` (effect id | null) parça yerinde
      oynar (APEX "Crumble Smallest Chunks"; fizik maliyetini de düşürür).
      Kırılma başına efekt sayısı sınırlı.
- [x] `maxSeparation` (m, 0 = kapalı): kırılma noktasından bu kadar uzaklaşan
      parça silinir (APEX "Debris Max Separation").
- [x] APEX "Debris Lifetime Min/Max" karşılığı zaten var: `chunkLifetime ×
      (0.5 + 0.5·hacim oranı)`; ayrı alan açılmaz.
- [x] Test level: sandık/direk `starter-fx-dust-hit` + `starter-snd-impact-light`.
      Smoke: kırılınca efekt ve ses isteği; crumble'da gövde sayısı düşer.

**Kapandı (2026-11-03).** Sidecar alanları `fractureTypes.ts` normalizer'ında
(`assetIdOrNull`: boş, `/`, `\`, `:` içeren ya da 200'den uzun id null olur);
`ChunkSpawnSpec.volumeFraction` (bütün bake hacmine pay). Modül:
`presentBreak` efekt/ses + kırılma başına en çok 6 crumble efekti;
`maxSeparation` her karede parça mesh konumundan. `AudioCommands.playOneShot`
(cue grafiği + bus, döngü yok). Static Mesh Editor: Break Effect, Break Sound,
Crumble Effect seçicileri; Crumble Below, Max Separation kaydırıcıları. Test
verisi: sandık + duvar `starter-fx-dust-hit` / `starter-snd-impact-light`
(sandık crumble 0.03, ayrılma 30 m; duvar 40 m). Testler: `fractureAsset`
(maksimal + id/limit), `fractureRuntime` (hacim payı), `fractureModule`
(efekt/ses çarpma noktasında, crumble, ayrılma), `audioModule` (one-shot ham
ve cue); smoke'lar kırılınca `?debug` VFX satırında efekt + editör seçicileri.
Sırada: **Faz 4c**.

### Faz 4c — Destek grafiği (APEX "support" fikri)

Amaç: kırılma "hep ya da hiç" olmasın. Duvarın vurulan bölgesi yıkılsın,
sabitlenmiş parçalar yerinde kalsın, desteği kopan parçalar düşsün.

APEX Destruction'dan alınanlar → Forge karşılığı:

| APEX | Forge |
|---|---|
| Support chunks / Support Depth | Bake'te parça komşuluk grafiği (ortak kesim düzlemi = kenar) |
| World Support | Level yüklenince statik dünyaya değen/gömülü parçalar otomatik anchor |
| Asset Defined Support | Sidecar anchor bölgeleri (model uzayı kutu / "alttan %N") + editörde boyama |
| Damage Spread / Damage Radius | Çarpma noktası çevresinde impulse'a bağlı yarıçap: yalnız oradaki parçalar serbest |
| (bağlantı kopunca çöküş) | Her kırılmadan sonra anchor'lardan BFS; desteğe yolu kalmayan ada dinamik olur |
| Accumulate Damage | Parça başına birikim (`damageToBreak` mantığı) |
| Form Extended Structures | Faz 4d: komşu placement'ların değen parçaları tek grafikte |

Bilinçli olarak alınmayanlar: hiyerarşi derinliği (Depth 0/1/2; bake ve
bellek katlanır — gerekirse tek seviyeli "büyük parçayı bir kez daha böl"),
Essential LOD Depth, Accurate Raycasts, Valid Bounds (PhysX dönemine özgü),
Chaos strain/yük hesabı (bağlantı grafiği oyun için yeterli).

Veri modeli (taslak):

```jsonc
// <Model>.fracture.json ek alanları
"support": {
  "mode": "none" | "anchored",          // none = bugünkü hep-ya-da-hiç kırılma
  "anchors": [ { "min": [x,y,z], "max": [x,y,z] } ],  // model uzayı kutular
  "worldSupport": true,                  // statik dünyaya değen parçalar anchor
  "damageRadius": 0.6,                   // m, impulse ile ölçeklenir
  "damageRadiusPerImpulse": 0.0005       // m / N·s
}
```

Anchor'lar parça id'si değil **bölge** olarak saklanır: id seed'e bağlı,
yeniden bake'te kayar; bölge kaymaz.

Dilimler:

- [ ] 4c-1 (saf, Codex'e uygun): `fractureBake` komşuluk listesi (her iç yüzün
      hangi tohum çiftinden geldiği; birleşen hücrelerde kenarlar devralınır),
      `supportIslands(adjacency, anchored, released)` BFS, `chunksInRadius`.
      Testler: kutu bake'inde komşuluk simetrik ve bağlı; anchor'sız ada
      tespiti; deterministik.
- [ ] 4c-2: sidecar `support` normalizer + maksimal test + `/__save-fracture`
      kapsamı (7. allowlist yüzeyi, yeni yüzey yok).
- [ ] 4c-3 runtime: `support.mode: "anchored"` nesne ilk darbeye kadar bugünkü
      gibi tek gövde; ilk darbede kaynak, parçalarından statik convex
      gövdelere (render: parça mesh'leri) dönüşür; yarıçap içindekiler +
      desteksiz adalar dinamik doğar. Sonraki darbeler kalan statik parçalara
      aynı kuralı uygular. World Support yükleme anında fizik sorgusuyla.
      Durum: `intact → damaged (bit maskesi) → fractured`; Faz 5'in durum
      modeliyle aynı.
- [ ] 4c-4 editör: Static Mesh Editor'da Support bölümü (mode, anchor kutuları
      + "alttan %N" kısayolu, World Support, yarıçap), önizlemede anchor
      parçaları farklı renk, grafik kenarları tel; "Simulate hit" düğmesi
      (önizlemede bir noktaya vurup hangi parçaların düşeceğini gösterir).
- [ ] 4c-5 smoke: duvara araçla çarp → yalnız çarpma bölgesi düşer, anchor'lı
      alt kısım kalır; ikinci çarpma kalan desteği kesince üst kısım çöker.

Riskler: statik parça gövde sayısı (nesne başına ≤64; yalnız vurulmuş
nesnelerde), adalar dinamikleşirken üst üste binen hull'ların itişmesi
(parçalar zaten bitişik — gerekirse kısa süre çarpışma filtresi), World
Support sorgusunun eğimli zeminde fazla anchor seçmesi (tolerans editörde).

### Faz 4d — Extended Structures (ihtiyaç olunca)

- [ ] "extended" işaretli komşu statik placement'ların değen parçaları
      yüklemede tek destek grafiğinde birleşir (APEX Form Extended
      Structures). Hareketli placement/aktör dahil değil. Kalıcılık bit
      maskesi placement başına kalır.

### Faz 5 — Hasar durumu ve kalıcılık

- [ ] Asgari durum modeli: `intact | damaged | fractured` + birikmiş hasar
      (0..1). Ara durumların oyundaki anlamı fork'a aittir. Faz 4c'den sonra
      `damaged` durumu düşen parçaların bit maskesini taşır (≤64 parça).
- [ ] `GameSaveState`'e isteğe bağlı `destructibles` bölümü: placement/actor
      id → durum. Eski save'ler (alan yok) sorunsuz yüklenir.
- [ ] Restore: kırık nesne parçasız gelir (K-05), çift kırılma olmaz.
- [ ] World Partition: hücre boşalıp tekrar yüklenince durum korunur.
- [ ] Silinmiş/yeniden adlandırılmış id içeren save'de güvenli atlama +
      uyarı.
- [ ] `SAVE_GAME_CONTRACT.md` güncellemesi.
- [ ] Testler: save → load → aynı mantıksal durum; eski sürüm save; eksik
      asset fallback.

Kabul: save/load ve hücre yeniden girişinde tutarlı durum, `build:verify`
yeşil.

### Faz 6 — Rüzgâr ve temas salınımı (fiziksiz görsel)

Faz 1–5'ten bağımsız, Faz 2 ile paralel yürür.

- [x] Global rüzgâr kaynağı: yön + güç + gust, WES/World Settings verisi
      olarak normalizer'dan geçer (`normalizeWorldEnvironment`).
      `engine/environment/wind.ts`: `LayoutWind { directionDeg, strength, gust }`
      seyrek grup; WES'te `worldEnvironment.wind` (normalizer içinde),
      WES'siz level'da `worldSettings.wind` (`validateWorldSettings` aynı
      `normalizeLayoutWind`'i katı kullanır). `resolveLevelWind`: alan alan
      WES → World Settings → varsayılan (45°, 0.3, 0.3); WES grubu yalnız WES
      aktifken sayılır (gizli = yok). Hava tablosuna `windStrengthMultiplier`
      / `windGustAdd` (sis 0.4, yağmur 1.7), mevsim çarpanı (sonbahar 1.25).
- [x] `windSway.ts`: vertex rengi veya yükseklik maskeli salınım. **Renk ve
      gölge/derinlik materyallerine birlikte** enjekte edilir (foliageFade
      deseni), instancing ile uyumlu.
      Yükseklik maskesi: instance ölçeği 1'de pivot üstü metre
      (`transformed.y × |modelMatrix[1]|`, GLTF düğüm ölçeği dahil). Rüzgâr
      yönüne eğilme + instance başına fazlı titreşim + rüzgârla ilerleyen
      gust dalgası; dünya ofseti `transpose(B)/s²` ile yerele çevrilir.
      Uniform'lar paylaşılır, program yeniden derlenmez. Vertex rengi maskesi
      ihtiyaç çıkınca.
- [x] Foliage type ve static mesh materyalinde opt-in (`sway` parametreleri);
      materyal editörü alanları. **Static mesh materyali Faz 6b'ye taşındı**
      (2026-11-03, kullanıcı onayı); bu madde foliage type için kapandı.
      Foliage type tamam: `sway?: { amplitude, height, frequency }`
      (`normalizeWindSwaySettings`, yok = salınmaz; save validator normalizer'ı
      yeniden kullanıyor). `FoliageRenderBinding` sway'li grupları paylaşılan
      GLTF materyalinin klonuna geçirir (fade ile tek program), shell'ler her
      karede `windSwayUniforms`'u yazar (runtime simülasyon saati → pause'da
      durur; editör kendi saati).
      Editör: Foliage Type Details'te "Wind Sway" anahtarı + Amplitude /
      Height / Frequency (sınırlar `WIND_SWAY_LIMITS`); World Settings ve
      World Environment Details'te "Wind" bölümü (Direction / Strength /
      Gust; WES'te boş alan World Settings değerini gösterir).
      `tests/smoke/wind-editor.spec.ts` World Settings + WES kayıt/undo'yu
      doğrular; Foliage Type anahtarı smoke'suz (mevcut `updateType` yolu).
- [-] Etkileşim alanı: yakındaki araç/pawn konumları (küçük sabit dizi
      uniform) → yönlü eğilme ve kademeli geri dönüş. **Faz 6b'ye taşındı**
      (2026-11-03, kullanıcı onayı): Faz 6 kabulü buna bağlı değil.
- [x] Kalite profili: uzak mesafede salınımı kapat.
      `QualitySettings.windSwayDistance` (ultra 150, high 100, medium 60,
      low 30 m; `0` = sınırsız): son çeyrekte söner, ötesinde shader dalı
      hesabı instance başına atlar (rüzgâr 0 iken de). Editör
      `editorQuality` değerini kullanır.
- [x] Test: shader enjeksiyonu derlenir, kapalıyken çıktı değişmez; GPU
      ölçümü (`gpuSweep`).
      `tests/engine/wind.test.ts` (5), `windSway.test.ts` (9): sway'siz type
      orijinal materyalde kalır, paylaşılan materyale dokunulmaz.
      `tests/smoke/wind-sway.spec.ts`: lit + gölge programı GPU'da derlenir,
      güç 0'da çıktı aynı, güç 1'de tepe rüzgâr yönüne kayar, taban yerinde.
      GPU ölçümü (2026-11-03): gpuSweep'e "wind sway" satırı eklendi
      (`GpuSweepSession.windSwayActive`; adım açıkken shell gücü 0 yazar, yani
      satır "salınımı kapatmanın kazancı"dır, sway'siz programla fark değil).
      Ölçüm: RTX 3060 (ANGLE D3D11), Chrome, 1600×900, Ultra, adaptif kapalı;
      40 000 `kenney-grass-large` + 1 600 `commontree`, hepsi sway'li, gölge
      açık; 16.6 M üçgen, taban 10.5–10.7 ms GPU. Dört geçerli sweep'te wind
      sway: 0.19 ms, ~0, uncertain, 0.13 ms (kare %1–2, gürültü sınırında).
      Aynı sahnede foliage'ın kendisi 10.6 ms, gölge haritası 3.7–4.7 ms.
      (Ölçüm betiği depoya girmedi; ilk sweep foliage yüklenmeden başladığı
      için sayılmadı.)

Kabul: görsel kabul (kullanıcı) + yoğun foliage sahnesinde GPU ölçümü.
GPU ölçümü tamam; **görsel kabul bekleniyor.**

### Faz 6b — Temas salınımı ve static mesh sway (Faz 6'dan ayrıldı)

Faz 6 kabulünden bağımsız; tüketici ihtiyacıyla açılır.

- [ ] Etkileşim alanı: yakındaki araç/pawn konumları → yönlü eğilme ve
      kademeli geri dönüş. Önerilen v1: gövde başına son birkaç konum + yaşı
      (küçük sabit uniform dizisi), kısa bir iz bırakır; durumsuz shader'da
      gerçek "ezilip yavaş kalkma" için bir ezilme haritası render target'ı
      gerekir (daha büyük iş, ayrı karar).
- [ ] Static mesh materyalinde `sway` opt-in + materyal editörü alanı
      (`normalizeWindSwaySettings` ve `installWindSway` hazır; instancing
      slotları ve klon yolu `asClone` emsaliyle).

### Faz 7 — Kalıcı çarpma göçüğü (`deformableModule`, mode `impact`)

- [ ] `AssetDeformableDef` + normalizer + `/__save-deformable` (8. allowlist
      yüzeyi) + `CLAUDE.md`.
- [ ] Geometri sahipliği: ilk göçükte placement geometrisi klonlanır
      (copy-on-write); deformable asset'ler instancing'den çıkarılır.
- [ ] `impactDeform.ts`: lokal koordinata dönüştürme (scale/rotation dahil),
      yarıçap + düşüş eğrisi, `maxDepth`, `plasticity`, çok kısa aralıklı
      darbelerde birikme sınırı.
- [ ] Normal, bounding sphere/box ve gölge güncellemesi. Skinned mesh v1'de
      kapsam dışı.
- [ ] Araç gövdesi: Vehicle component'li aktörün model düğümlerine
      uygulanır, tekerlek `visualNode`'ları hariç.
- [ ] Collision politikası v1'de `visual_only`. Proxy güncellemesi ancak
      ölçülmüş ihtiyaçla açılır.
- [ ] Kalıcılık: kompakt göçük listesi (nokta, normal, şiddet; `maxDents`
      ile sınırlı), Faz 5 `destructibles` yanında.
- [ ] Editör: Static Mesh Editor "Deformable" bölümü + viewport "test darbesi"
      aracı (konum, yön, şiddet).
- [ ] Testler: çakışan iki örnekten yalnız biri değişir, sınır aşılmaz,
      save/load aynı şekli üretir.

Kabul: D-01 metal panel ve araç gövdesi görsel kabulü, `build:verify` yeşil.

### Faz 8 — Kırılma modlarını genişletme

Her madde kendi tüketici ihtiyacıyla açılır.

- [ ] `source: "imported"`: dışarıda (ör. Blender Cell Fracture) üretilmiş
      parçalı GLB. Düğüm adlandırma kuralı, pivot/origin denetimi, hull'lar
      editörde üretilir.
- [ ] `detach`: alt düğümü (tampon, tabela) eşikte ayrı dinamik body yap.
- [ ] `swap-mesh`: hasarlı/kırık modele geçiş (uzak detay, ucuz kırılma).
- [ ] `joint-break`: parçalar sabit joint'le bağlı başlar, joint gerilmesi
      eşiği aşınca kopar (çit, ileride köprü). Joint gerilmesi Rapier'dan
      okunabiliyor mu, Faz 0 notuna bakılır.
- [ ] Dışbükey olmayan mesh için CSG (K-01): `three-bvh-csg` bağımlılığı ve
      geometri saklama (bu durumda yeniden bake pahalı → binary sidecar).
- [x] Ahşap kıymık deseni (2026-11-03, Faz 8'den öne alındı): sidecar
      `pattern` (`uniform` | `splinter`), `grainAxis` (x/y/z), `grainStretch`
      (1–16). Anizotropik Voronoi: lif ekseninde uzaklık `1/s²` ağırlıkla
      ölçülür; ortay yine düzlemdir (normal `w ⊙ (b − a)`), bu yüzden kırpma,
      hull, kütle ve runtime değişmedi (`voronoiCellPlanes(…, weights)`,
      `bakeFracture({ grain })`, `fractureGrain(def)`). Kesik yüz UV'sinde lif
      ekseni U'ya gider (başlangıç `T_Wood_Oak_D` damarı yatay). Static Mesh
      Editor: Pattern, Grain Axis, Grain Stretch (yalnız Splinter'da), değişince
      yeniden bake. Test level'ında sandık splinter (y, 6) + 3 ahşap direk
      (placement override 400 N·s). Ölçüm: birim küpte ortalama lif/enine oranı
      uniform 1.18 → splinter 2.81. Sınır: parçalar dışbükey prizma; girintili
      kıymık için şerit kesimi ya da import yolu.

### Faz 9 — Simüle deformasyon (gereksinim kapılı)

Somut bir tüketici (branda, bayrak, halat) ve Faz 6/7'nin yetmediği
kanıtlanmadan başlanmaz.

- [ ] XPBD çözücü: mesafe + bükülme kısıtı, substep, sabit adımla senkron.
      Ana iş parçacığında başlar, küçük parçacık bütçesi kalite profiline
      bağlanır.
- [ ] Kumaş: mesh → parçacık grafiği, pinned vertex (editörde boyama),
      Rapier sorgularıyla tek yönlü çevre çarpışması.
- [ ] Halat görseli: spline/az segment. Fiziksel çekme (vinç) **ayrı bir
      kuvvet modelidir** ve bu planın konusu değildir.
- [ ] Editör "Simulate" önizlemesi (kayda yazmadan), parçacık/kısıt
      görselleştirmesi.
- [ ] Ölçüm: substep başına maliyet, uzak mesafede uyutma.

### Kapsam dışı / backlog

- [-] Oyun sırasında genel amaçlı mesh fracture.
- [-] Hacimli soft body (shape-matching / tetra hacim).
- [-] İki yönlü soft ↔ rigid etkileşim.
- [-] WebGPU compute çözücü (renderer WebGL2).
- [-] Göçüğe göre trimesh collider yeniden kurulumu.
- [-] Oyun kuralları: teslimat hasarı, köprü kapasitesi, rota kapanması
      (fork'ta).

---

## 6. Açık kararlar

Bütün kararlar 2026-11-02'de kapandı (K-03 ve K-02 teknik, diğerleri
kullanıcı kararı).

| ID | Karar | Sonuç |
|---|---|---|
| K-01 | Dışbükey olmayan mesh: CSG bağımlılığı mı, import yolu mu? | **Kapandı:** v1 yalnız dışbükey Voronoi. İlk ihtiyaçta önce import yolu (Faz 8), CSG en son. |
| K-02 | Parça geometrisi nerede saklanır? | **Kapandı (teknik, K-01'den çıkar):** v1 kaydedilmez; yüklemede deterministik yeniden bake + `sourceHash`. Dışbükey kırpma ucuz olduğu için bu güvenli. Import/CSG gelince binary sidecar. |
| K-03 | Impact verisi: contact-force olayları mı, manifold okuma mı? | **Kapandı (Faz 0):** hibrit. Opt-in olay + eşiği geçen çiftte manifold okuma. |
| K-04 | Fracture yalnız asset seviyesinde mi, placement/actor override'ı da var mı? | **Kapandı:** üçü birden. Asset sidecar asıl tanımdır; placement override (`enabled`, `breakImpulse`); actor `Fracturable` component aynı sidecar'ı referanslar. |
| K-05 | Kalıcılık kapsamı: kırık enkazın pozu saklanır mı? | **Kapandı:** yalnız durum. Load'da nesne kırık ve parçasız gelir. Asset başına "kalıcı enkaz" seçeneği ancak somut ihtiyaçla açılır. |
| K-06 | Rüzgâr kaynağı nerede yaşar? | **Kapandı:** WES rüzgârı (yön, güç, gust; hava/mevsimle değişir). WES'siz level'da World Settings sabit değeri. |

---

## 7. Riskler

1. **Spawn hitch:** çok parçanın aynı karede body + geometri oluşturması.
   Önlem: v1'de bake'i önceden yapmak (yükleme sırasında veya ilk kırılmadan
   önce) ve parça sınırı.
2. **Paylaşımlı buffer bozulması:** göçük veya kırılma bir örneğe yazarken
   aynı asset'in diğer örnekleri de değişir. Faz 0 testi ve copy-on-write ile
   kapatılır.
3. **Olay maliyeti:** impact olayları bütün body'lere açılırsa fizik adımı
   pahalanır. Opt-in ve olay bütçesi bunu sınırlar.
4. **Streaming ile yaşam döngüsü:** parça hücre sınırını geçebilir veya hücre
   boşalabilir. Parçalar kaynağın hücresine bağlanır, unload'da temizlenir.
5. **Save sürümleme:** id kararsızlığı veya silinmiş nesne. Placement `id`
   zaten benzersiz ve kopyalamada yenileniyor; geçersiz kayıt uyarıyla
   atlanır.

---

## 8. Doğrulama kapıları

- Her TypeScript değişikliğinden sonra `npx tsc --noEmit`.
- Yineleme sırasında `npm run test:engine -- --filter impact,fracture,deformable,wind`.
  Bu çıktı yeşil build sayılmaz.
- Faz sonlarında `npm run build:verify` (CI'nın aynası).
- Editör ve Play smoke'u yalnız `npm run dev:smoke` (port 5273) üzerinde.
- Her test için fizik süresi, frame dağılımı, aktif parça sayısı ve bellek
  zaman serisi tutulur. Render FPS ile sabit fizik adımı maliyeti ayrı
  raporlanır.
- Otomatik testler ile kullanıcı görsel/oynanış kabulü ayrı raporlanır.
- Her yeni allowlist yüzeyi `CLAUDE.md`'ye işlenmeden faz kapanmaz.

---

## 9. İlerleme günlüğü

- 2026-11-02: İki ön belge değerlendirildi ve bu plan oluşturuldu. Kaynakta
  doğrulananlar: impact verisi yok, hull üretimi yalnız editörde, geometri
  `clone(true)` ile paylaşılıyor, rüzgâr yok, save'de dünya nesnesi durumu yok,
  terrain deformasyon ve heightfield collision mevcut.
- 2026-11-02: Kaynak belgeler düzenlendi: Forge taslağı silindi, Ridgebound
  değerlendirmesi `Games/Ridgebound/docs/design/` altına taşındı.
- 2026-11-02: **Faz 0 kapandı.** Rapier spike'ları (impact doğruluğu,
  determinizm, maliyet, statik hedef, kinematik), paylaşımlı geometri ve
  navmesh doğrulaması yapıldı. K-01…K-06 kapandı.
- 2026-11-03: Faz 1 ilk dilim: saf `engine/physics/impactEvents.ts` +
  `tests/engine/impactEvents.test.ts`. Sırada `physicsSubsystem` bağlantısı
  (opt-in `CONTACT_FORCE_EVENTS`, alt adım başına `EventQueue` boşaltma,
  eşiği geçen çiftte manifold okuma, `impacts()` API'si).
- 2026-11-03: Faz 1 Rapier bağlantısı: `setImpactEventThreshold` +
  `impacts()`; Rapier testleri Faz 0 ölçümünü birebir tekrarladı. Açık: actor
  `"hit"` yükü (tasarım sorusu: begin olayına mı eklenir, ayrı faz/olay mı).
- 2026-11-03: Actor "On Impact" olayı (`ACTOR_EVENT_KINDS`'e `impact`).
  Faz 1 kod tarafı kapandı; kabul maddesindeki "impact kapalı sahnede maliyet
  değişmemiş": opt-in yokken `step()` çağrısı birebir eski hâliyle.
- 2026-11-03: Faz 6 ilk üç dilim: rüzgâr verisi (cf1bcbd1), `windSway.ts` +
  foliage type opt-in + shell güncellemesi + smoke. Smoke, maske
  yüksekliğinin ham geometri biriminde olduğunu yakaladı (`shape-cube`
  0..100); maske metreye çevrildi. Not: `foliage-fade.spec.ts` aynı ölçüm
  sahnesinde küpü ekranı dolduracak ölçekte çiziyor (oran testi yine geçerli).
- 2026-11-03: Faz 6 editör alanları (8176da75), kalite mesafesi (ff9f22b5),
  gpuSweep "wind sway" satırı + GPU ölçümü (sway ≈ kare %1–2). Etkileşim alanı
  ve static mesh sway Faz 6b'ye ayrıldı; Faz 6 görsel kabul bekliyor.
- 2026-11-03: **Faz 2 kapandı.** Voronoi bake çekirdeği Codex'e yaptırıldı
  (tasarım + inceleme Claude); 16 hücreli kutu ~3 ms.
- 2026-11-03: Faz 3 veri yüzeyi (3a, Codex) + three köprüsü (3b, Claude):
  sidecar tipleri/normalizer/uyarılar/hash, `/__save-fracture` (7. allowlist
  yüzeyi), yükleyici + editör store'u, `fractureGeometry.ts`. Sırada editör
  bölümü (3c).
- 2026-11-03: Faz 4 çekirdeği: `fractureRuntime.ts` (Codex) + `fractureModule`
  + shell host + test level + smoke. Motor hatası düzeltildi: compound
  collider'da `massKg` uygulanmıyordu.
- 2026-11-03: **Faz 3 kapandı.** Static Mesh Editor "Fracture" bölümü (3c):
  bake, önizleme, Explode, hull wire'ları, uyarılar, kaydetme; editör smoke'u.
- 2026-11-03: Faz 4b-1: placement `fracture` override (allowlist,
  editör Details bölümü, runtime). Sırada 4b-2 actor `Fracturable` + hücre
  temizliği, 4b-3 kırılma VFX/ses alanları.
- 2026-11-03: Faz 4b-2: actor `Fracturable` component, canlı kırılma pozu,
  World Partition hücre temizliği, kırılan kaynağa EndPlay. Sırada 4b-3
  (kırılma VFX/ses alanları).
- 2026-11-03: Ahşap kıymık deseni (`pattern: "splinter"`, anizotropik
  Voronoi) eklendi; 4b-3 (VFX/ses) sırada.
- 2026-11-03: Kullanıcıyla APEX Destruction değerlendirildi; sıra kayda
  geçti: 4b-3 (VFX/ses + debris) → Faz 4c destek grafiği → Faz 5 (bit
  maskesi) → Faz 4d Extended Structures. Tasarım ilgili faz başlıklarında.
- 2026-11-03: **Faz 4b-3 kapandı**: kırılma efekti/sesi, crumble, max
  separation (veriyle), `AudioCommands.playOneShot`. Sırada Faz 4c.
