# Deformable & Fracturable Çalışma Planı

> Durum: **Faz 0 tamam** (2026-11-02): spike'lar ve açık kararlar kapandı.
> **Faz 1 sürüyor** (2026-11-03): saf `impactEvents.ts` ve Rapier bağlantısı
> (`setImpactEventThreshold` / `impacts()`) tamam; actor `"hit"` yükü açık.
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
- [ ] Actor script `"hit"` olayına isteğe bağlı `impulse`/`point`/`normal`
      yükü. Geriye uyumlu.
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

- [ ] Seed'li tohum üretimi (sınır kutusu içinde, isteğe bağlı yoğunlaştırma
      noktası).
- [ ] Hücre başına orta düzlemlerle **dışbükey kapalı mesh** kırpma (kutu,
      duvar, panel, sandık).
- [ ] Parça geometrisi: dış yüzler kaynak UV/normal ile, kesik yüzler ayrı
      material grubu ve kutu projeksiyonu UV ile.
- [ ] Hull noktaları = hücre köşeleri (ayrıca `ConvexGeometry` gerekmez).
      Kütle hacimle orantılı, parça merkezi = pivot.
- [ ] Determinizm: aynı mesh + seed → bayt bayt aynı çıktı.
- [ ] Testler: hacim korunumu (toleransla), örtüşme yok, her hull geçerli,
      dejenere hücre (çok küçük/ince) birleştirilir veya atılır.

Kabul: `--filter fracture` yeşil; 16 hücreli kutu bake'i < 50 ms (ölçülür,
hedef değil).

### Faz 3 — Fracture asset ve editör yüzeyi

- [ ] `AssetFractureDef` + `normalizeAssetFracture` (`fractureTypes.ts`).
- [ ] Yükleyici: `<Model>.fracture.json`, `assetCollisionLoader` desenini
      izler.
- [ ] `/__save-fracture` endpoint'i + `validateSaveFracturePayload`
      (normalizer'ı yeniden kullanır; 7. allowlist yüzeyi). `CLAUDE.md` kaydı.
- [ ] Parça geometrisinin saklanması (K-02): önerilen v1, geometriyi
      kaydetmeyip yüklemede `seed + kaynak mesh`'ten deterministik yeniden
      bake etmek ve `sourceHash` ile bayatlığı yakalamak.
- [ ] Static Mesh Editor'da "Fracture" bölümü: etkin, hücre sayısı, seed, iç
      yüz slotu, eşik, ömür, en fazla aktif parça. Parametre UI kurallarına
      uyar (kaydırıcı + kutu, TR ipucu / EN ad).
- [ ] "Bake" düğmesi, patlatılmış önizleme kaydırıcısı, parça hull wire'ı
      (`collisionView` genişletmesi).
- [ ] Doğrulama uyarıları: bayat bake, dışbükey olmayan mesh (v1'de
      desteklenmez), aşırı parça sayısı.
- [ ] droppedFields / serializationDrift testleri, maksimal sidecar
      round-trip.

Kabul: kaydet → yeniden aç round-trip, `dropped[]` boş, editör smoke'u
(5273) bake + önizleme.

### Faz 4 — Fracture runtime (`fractureModule`)

- [ ] Modül `createDefaultRuntimeModules()`'e kapalı güvenli eklenir.
- [ ] Tetikleyiciler: impact eşiği (Faz 1), `Damage.Apply` birikimi
      (`damageToBreak`), script/editör çağrısı (`Fracture.Break`).
- [ ] İdempotent durum geçişi: `intact → fractured` bir kez olur. Aynı
      karedeki çoklu olaylar tek parça seti üretir.
- [ ] Kaynağı devreden çıkar: body'yi kaldır, instancing slotunu
      `collapseInstance` ile çökert ya da klonu gizle.
- [ ] Parçalar: kaynağın dünya pozu ve hızıyla doğar, hull collider alır,
      çarpma noktasından dışa impulse görür.
- [ ] Bütçe: asset başına `maxActiveChunks` ve kalite profiline bağlı global
      sınır. Eskiler önce uyutulur/silinir, küçük parçalar erken temizlenir.
- [ ] Ömür sonunda geometri/materyal/collider dispose edilir. Hücre unload ve
      level değişiminde de temizlik yapılır.
- [ ] Actor olayı `Fracture.Broken` (instigator, impulse) + VFX/ses kancası
      (veri ile bağlanır, kod sabit değil).
- [ ] Perf sayaçları: aktif parça, spawn hitch (ms), fizik adımı payı.
- [ ] Generic test level'ı `public/layouts/PhysicsInteractionTest.level.json`:
      kutu, duvar, panel, ot alanı, sürülebilir araç.
- [ ] Engine testleri: eşik altı kırılmaz, çift tetik tek set üretir, bütçe
      aşılmaz, dispose sonrası kaynak sızıntısı yok.
- [ ] Browser smoke: Play'de araçla kutuya çarp → kırılır, parça sayısı
      sınırda.
- [ ] Actor Script aktörleri için `Fracturable` component (aynı sidecar'ı
      referanslar).

Kabul: `build:verify` yeşil, smoke yeşil; kullanıcı görsel/oynanış kabulü
ayrı raporlanır.

### Faz 5 — Hasar durumu ve kalıcılık

- [ ] Asgari durum modeli: `intact | damaged | fractured` + birikmiş hasar
      (0..1). Ara durumların oyundaki anlamı fork'a aittir.
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

- [ ] Global rüzgâr kaynağı: yön + güç + gust, WES/World Settings verisi
      olarak normalizer'dan geçer (`normalizeWorldEnvironment`).
- [ ] `windSway.ts`: vertex rengi veya yükseklik maskeli salınım. **Renk ve
      gölge/derinlik materyallerine birlikte** enjekte edilir (foliageFade
      deseni), instancing ile uyumlu.
- [ ] Foliage type ve static mesh materyalinde opt-in (`sway` parametreleri);
      materyal editörü alanları.
- [ ] Etkileşim alanı: yakındaki araç/pawn konumları (küçük sabit dizi
      uniform) → yönlü eğilme ve kademeli geri dönüş.
- [ ] Kalite profili: uzak mesafede salınımı kapat.
- [ ] Test: shader enjeksiyonu derlenir, kapalıyken çıktı değişmez; GPU
      ölçümü (`gpuSweep`).

Kabul: görsel kabul (kullanıcı) + yoğun foliage sahnesinde GPU ölçümü.

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
