# Terrain Deformasyonu Planı (Kar / Çamur İzleri)

> Durum: **Faz 1a tamamlandı; Faz 1b, OPEN_WORLD Faz 3'ü bekliyor** (2026-10-23).
> Hedef: Araç (ve ileride karakter) Landscape üzerinde giderken kar, çamur ve
> kum gibi yumuşak zeminlerde **iz bırakması, gömülmesi ve zorlanması**.
> Referans his: SnowRunner / Expeditions. Hedef, o hissin web'de ulaşılabilir
> %70–80'i; tam çamur simülasyonu hedeflenmiyor.
>
> Bağlı planlar: [VEHICLE_PHYSICS_PLAN.md](VEHICLE_PHYSICS_PLAN.md) (Rapier
> raycast vehicle, Faz 0–5 tamam), [SAVE_GAME_CONTRACT.md](../architecture/SAVE_GAME_CONTRACT.md)
> (Faz 5), adaptif kalite profilleri (`engine/perf/qualityProfiles.ts`).
>
> **Sıra notu (2026-10-23 güncel):** [OPEN_WORLD_PLAN.md](OPEN_WORLD_PLAN.md)
> Landscape trimesh'ini tile başına Rapier heightfield'a ve tek Landscape'i
> tile grid'ine çeviriyor. O planın Faz 1'i tamam: `WorldTerrainDef`
> (`engine/terrain/terrainTypes.ts`), ortak normalizer `normalizeWorldTerrain`
> (`engine/terrain/terrainDefinition.ts`, 5. allowlist yüzeyi) ve
> `terrainHeightAt` / `terrainLayerWeightsAt`
> (`engine/terrain/terrainHeightQuery.ts`) mevcut. Bu yüzden Faz 1 ikiye
> bölündü: **1a** (arazi dışı: physical material blokları, `surfaceResponse`,
> surface provider) şimdi yapılabilir; **1b** (terrain katmanı → physical
> material bağlantısı, zemin tanıma) açık dünya Faz 3'ten sonra. Faz 0'ın
> araç/render spike'ları da araziden bağımsızdır. Faz 2 shader'ı ve Faz 3
> patch mesh'i açık dünya Faz 2'nin CDLOD `terrainMaterial`'ına yazılır,
> eski iki landscape materyaline değil.
>
> **Ortak not (2026-10-22):** iz alanı ve gömülme, zemin yüksekliğinin
> collider ile birebir aynı örneklenmesine dayanıyor. Bilinear örnekleme
> collider üçgenlerinden hücre başına en fazla `burulma / 4` kadar sapar.
> Karar ve doğrulama sonucu OPEN_WORLD_PLAN.md **K3a**'da: `heightAt`
> üçgen-birebir olacak. Rapier heightfield'ın köşegeni bugünkü mesh ile aynı
> yönde; köşegen için çevirme gerekmiyor. Bu plandaki tüm yükseklik
> örneklemeleri (iz basma, Faz 3 gömülme ve mesh) birebir sürümü kullanır,
> asla `heightAtSmooth`'u kullanmaz.

## Karar: Yüzey profili + CPU-otoriter iz alanı + yerel yoğun mesh

Deformasyon dört katmana ayrılıyor. Her katman bir öncekinin üstüne kuruluyor
ve tek başına oynanabilir bir ara sonuç bırakıyor:

| Katman | Ne verir | Faz |
|---|---|---|
| Yüzey profili | Çamurda tutuş düşer, araç zorlanır; karda kayar | 1 |
| İz alanı + shader | Görünür lastik izleri, ezilmiş kar, ıslak/koyu çamur | 2 |
| Gömülme | Tekerlek izin içine oturur, araç derin karda/çamurda batar | 3 |
| Efekt + kalıcılık | Sıçrayan çamur/kar, izler save-game'de kalır | 4–5 |

**Alan CPU'da tutulur, GPU yalnız gösterir.** İz alanı aracın etrafında kayan
bir `Uint8`/`Uint16` grid (varsayılan 64 m pencere, 12,5 cm hücre → 512²).
Tekerlekler bu grid'e CPU'da iz basar. Fizik doğrudan bu grid'i okur, render
ise aynı veriyi `DataTexture` olarak yükler. Böylece GPU'dan veri geri okumaya
(`readPixels`, GPU'yu durdurur) gerek kalmaz, alan deterministik olur ve
engine testlerinde saf fonksiyon olarak test edilir.

**Pencere toroidal.** Hücre indeksi `worldCell mod N` olarak hesaplanır ve
shader `RepeatWrapping` ile örnekler. Araç yer değiştirdiğinde dizi
kaydırılmaz; yalnız pencereye yeni giren satır/sütunlar temizlenir.

**Fizik çarpıştırıcısı runtime'da hiç yeniden kurulmaz.** Arazi collider'ı
sabit kalır: bugün Landscape trimesh'i (`createLandscapeColliderPrimitive`),
açık dünya Faz 3'ten sonra tile başına Rapier heightfield
(`engine/physics/terrainCollider.ts`).
Gömülme hissi tekerlek süspansiyon boyu (Rapier `setWheelSuspensionRestLength`)
ve ek kuvvetlerle verilir.

Unreal karşılığı: Landscape Layer Info → Physical Material (yüzey tipi), kar
izleri için Runtime Virtual Texture + render target. Bizdeki fark: fiziğin de
okuması gerektiği için alanın CPU'da tutulması.

Değerlendirilip reddedilenler:

| Seçenek | Neden değil |
|---|---|
| Heightmap'i ezip trimesh'i yeniden kurmak | Grid 1 m ve en fazla 257² (`LANDSCAPE_MAX_VERTICES`); 30 cm'lik lastik izi çizilemez. Her kare trimesh yeniden kurmak tarayıcıda çok pahalı. |
| Rapier HeightField collider'ı değiştirmek | Yerinde değiştirilemiyor, her değişiklikte collider yeniden yaratılır; çözünürlük sorunu da aynı kalır. |
| Yalnız GPU render target | Fizik izi göremez; geri okuma GPU'yu bekletir. |
| Parçacık/akışkan tabanlı çamur simülasyonu (SnowRunner modeli) | Web'de CPU/GPU bütçesine sığmıyor; özel bir motor gerektirir. |

## İlkeler

1. **Engine generic kalır.** Motor "kar" veya "çamur" kavramını bilmez. Zemin
   davranışı **physical material** verisidir; Landscape paint katmanı bir
   physical material'a bağlanır. `snow` / `mud` / `sand` gibi hazır presetler
   `stone` / `wood` ile aynı genel kütüphane düzeyinde kalır; oyun kuralı
   (görev, araç hasarı) fork'ta yaşar.
2. **Authored data değişmez.** İz alanı runtime durumudur. Editör ve runtime
   onu asla level ya da `.landscape.json` dosyasına yazmaz. Kalıcılık yalnız
   save-game üzerinden sağlanır (Faz 5).
3. **Opt-out bugünkü davranışı birebir korur.** Physical material'ı olmayan bir
   landscape ya da kapalı `terrainDeformation` modülü, araç davranışını bugünküyle
   aynı bırakır. Mevcut vehicle testleri ve parity seviyesi değişmeden geçer (I3).
4. **Physics generic kalır.** `PhysicsSubsystem` landscape'i tanımaz; yalnız
   enjekte edilen bir `VehicleSurfaceProvider` callback'ine "bu tekerlek, bu
   zemin entity'sinde, bu noktada" diye sorar.
5. **Allowlist disiplini.** Her yeni alan ilgili save validator'a eklenir
   (aşağıda "Kayıt yüzeyleri"). `serializationDrift` / `droppedFields` testleri
   yeşil kalır.
6. **Editör `?editor` arkasında.** Yeni editör yüzeyleri `src/editor/` altında
   kalır. `verify:dist --strict` ve `verify:imports` yeşil kalır.
7. **Bütçe ölçülür.** Modül bir perf bölgesi (`frameRegions`) ve `?debug`
   satırı açar. Pahalı parçalar (yoğun patch mesh, alan çözünürlüğü) kalite
   profiline bağlanır.

## Veri modeli

### Physical material genişlemesi (`engine/scene/collision.ts`)

`PhysicalMaterialDef`'e iki isteğe bağlı blok eklenir. Bloklar yoksa bugünkü
davranış korunur:

```jsonc
// PHYSICAL_MATERIALS.mud (preset örneği)
{
  "friction": 0.6,
  "restitution": 0,
  "vehicle": {
    "frictionSlipScale": 0.55,      // wheel.frictionSlip ile çarpılır
    "sideFrictionScale": 0.7,       // sideFrictionStiffness ile çarpılır
    "rollingResistance": 0.35       // hız ve tekerlek yüküyle ölçeklenen direnç
  },
  "deformation": {
    "maxDepth": 0.22,               // m, tam yükte tek geçişte ulaşılabilen derinlik
    "compaction": 0.5,              // 0..1, her geçişin hedef derinliğe yaklaşma oranı
    "digRate": 0.08,                // m/s, tekerlek patinajında ek kazma
    "recoveryRate": 0,              // m/s, alanın kendiliğinden dolması (kar > 0)
    "sinkResistance": 0.6,          // gömülme derinliğinde artan direnç çarpanı
    "tint": [0.35, 0.27, 0.2],      // izin albedo karışım rengi
    "tintStrength": 0.6,
    "wetness": 0.5                  // izde roughness düşüşü
  }
}
```

Önerilen ilk presetler: `snow` (yüksek `recoveryRate`, düşük `compaction`,
açık tint), `mud` (sıfır recovery, yüksek `sinkResistance`, koyu ve ıslak),
`sand` (orta değerler, düşük wetness).

### Terrain katmanı → physical material

`WorldTerrainLayerDef.physicalMaterial?: string | null` (`*.terrain.json`
katman tanımı; legacy `LandscapeLayerWeights` okuma sırasında bu tanıma
dönüştürüldüğü için ayrı bir legacy alanı açılmaz). Atanmamışsa katman
deforme olmaz ve araç tepkisi değişmez. Bir noktanın yüzey tepkisi,
katman ağırlıklarına göre karıştırılmış (ağırlıklı ortalama) profildir.
Böylece kar/çim sınırında izler ve tutuş yumuşakça geçer.

### Tekerlek genişliği

`VehicleWheelDefinition.width?: number` (m). Bugün tekerlekte genişlik alanı yok.
Verilmezse varsayılan `radius * 0.7` kullanılır. İz basmanın enini belirler.

### Kayıt yüzeyleri (allowlist)

| Alan | Validator / normalizer |
|---|---|
| `WorldTerrainLayerDef.physicalMaterial` | `normalizeWorldTerrain` (`engine/terrain/terrainDefinition.ts`; `/__save-terrain` → `validateSaveTerrainPayload` bunu yeniden kullanır) + 1×1 adaptörün katmanı Landscape'e taşıması |
| `PhysicalMaterialDef.vehicle` / `.deformation` | Yerleşik preset kütüphanesi (`engine/scene/collision.ts`); kayda girmez, yalnız preset id'si (`physicalMaterialId`) kaydedilir |
| `VehicleWheelDefinition.width` | `normalizeVehicleDefinition` (`engine/physics/vehicle/vehicleTypes.ts`); `/__save-vehicle` bunu yeniden kullanır |
| Fork'a özel physical material (Faz 6, isteğe bağlı) | Yeni `*.physmat.json` asset tipi + kendi `validate*` fonksiyonu |

Her biri için `serializationDrift.test.ts` kapsamı genişletilir ve CLAUDE.md'deki
allowlist notu güncellenir.

## Modül yerleşimi

| Dosya | Sorumluluk |
|---|---|
| `engine/physics/surface/surfaceResponse.ts` | Physical material → `SurfaceSample` çözümü, katman ağırlığı karışımı, tekerlek tepkisi matematiği (saf) |
| `engine/scene/deformationField.ts` | Toroidal CPU alanı: `stamp`, `sample`, `recenter`, `decay`, kirli bölge takibi (saf) |
| `engine/terrain/terrainHeightQuery.ts` (**mevcut**) | `terrainLayerWeightsAt`, `terrainHeightAt` (collider üçgenleriyle **birebir**, Rapier testli). Yeni landscape-local örnekleyici yazılmaz |
| `engine/render-three/terrain/terrainDeformation.ts` | Shader parçası (açık dünya Faz 2'nin CDLOD `terrainMaterial`'ına), `DataTexture` yükleme, Faz 3 patch mesh'i |
| `engine/physics/physicsSubsystem.ts` | `setVehicleSurfaceProvider()`; `vehicleState()` her tekerlekte `groundEntityId` döndürür (`wheelGroundObject` + `rapierColliderToEntity`) |
| `src/scene/capabilities/terrainDeformationModule.ts` | Capability: alanın sahibi; tekerlek temaslarından iz basar, surface provider'ı sağlar, render uniform'larını günceller |
| `src/scene/capabilities/runtimeServiceKeys.ts` | `landscapeHostService` (landscape data + dünya dönüşümü + render objesi) ve `terrainDeformationCommandsService` (`stamp`, `debugSnapshot`) |

`terrainDeformationCommandsService.stamp(worldPos, radius, depth)` genel bir
giriş noktasıdır. Karakter ayak izleri ya da script'le açılan izler aynı alana
yazabilir; motorun içine araç dışında bir kural konmaz.

---

## Faz 0 — Prototip kapıları (spike)

Gerçek kod yazılmadan önce riskli varsayımlar ölçülür. Spike kodu atılabilir;
çıkan sonuçlar bu dosyaya yazılır.

- [x] **Rest length tekniği:** `VehicleTest` seviyesinde 60 Hz sabit adımda bir
      tekerleğin `suspensionRestLength` değeri her adımda 0 → +0,3 m değiştirilir.
      Ölçülecekler: zıplama, titreşim ve uyuyan gövdenin uyanması
      (`wakeUp`). Sonuç: kabul / sınır değerleri / ret.
      *Koşullu kabul (2026-10-23), bkz. bulgular.*
- [ ] **Zemin tanıma** (açık dünya Faz 3'ten sonra): `wheelGroundObject(i)` →
      `rapierColliderToEntity` → `landscape:<id>:<tile>` eşlemesinin tile
      heightfield'ında çalıştığı doğrulanır. *Mesh zeminde doğrulandı
      (2026-10-23): Faz 1a'nın `groundEntityId` Rapier testi; heightfield
      kısmı açık.*
- [x] **Doku yükleme maliyeti:** 512² R8 `DataTexture`'ın her kare tam
      yüklenmesi `gpuTimer` ile ölçülür. three 0.184'te kısmi yükleme yoksa
      tam yükleme ya da N karede bir yükleme kararı verilir.
      *Kısmi yükleme seçildi (2026-10-23), bkz. bulgular.*
- [x] **Yuvarlanma direnci yöntemi:** Ek fren (`setWheelBrake`) ile şasiye ters
      impuls karşılaştırılır. Fren yöntemi rampada park halini bozuyor mu?
      *Fren yöntemi korunuyor (2026-10-23), bkz. bulgular.*
- [x] Sonuçlar ve seçilen yöntemler bu bölüme "Faz 0 bulguları" olarak eklenir.

### Faz 0 bulguları (2026-10-23)

Ölçüm sayfası `spikes/terrain-deformation` (gerçek `PhysicsSubsystem` +
referans araç, 60 Hz sabit adım, deterministik; doku testi three r184,
headless Chromium 149, RTX 3060 / D3D11). Çalıştırma: `npm run dev:smoke` +
`node spikes/terrain-deformation/run.mjs`.

**Rest length — koşullu kabul, ama işaret ters çevrildi.**

| Değişim hızı | Ek ivme tepe (taban 2,6 m/s²) | İvme RMS (taban 0,27) | Roll hızı tepe | Temas kaybı (0 / 10 m/s) |
|---|---|---|---|---|
| anlık | 5,55 | 0,90 | 0,63 rad/s | 29 / 39 |
| 3 m/s | 5,34 | 0,85 | 0,62 rad/s | 27 / 37 |
| 1 m/s | 3,94 | 0,65 | 0,55 rad/s | 30 / 38 |
| 0,3 m/s | 2,92 | 0,30 | 0,10 rad/s | 13 / 23 |

- 0,3 m/s'de gövde tepkisi tabana çok yakın (ivme RMS +%14, roll 0,1 rad/s);
  hızlı değişim belirgin sarsıntı üretiyor. **Karar:** derinlikten gelen rest
  length farkı tekerlek başına **≤ 0,3 m/s** ile slew-limit edilir.
- Temas kayıplarının tamamı değişen tekerleğe (0) komşu iki tekerlekte (1, 2);
  çapraz çift (0–3) yükü taşıyor. Bu, düz ve sert zeminde **tek köşenin**
  0,3 m burulmasının geometrik sonucu, kararsızlık değil. Gerçek kullanımda
  dört tekerlek benzer derinliğe gömülür; yine de Faz 3 smoke'unda tek
  tekerleğin derin ize girdiği durum (temas kaybı sayısı) ayrıca izlenir.
- Uyuyan gövde setter ile **uyanmıyor**; rest length değiştiğinde açık
  `wakeUp()` gerekir.
- **İşaret düzeltmesi:** Rapier süspansiyon kuvveti `k·(rest − mevcut boy)`.
  Collider sabitken zemini `d` kadar alçalmış göstermek için mevcut boy `d`
  uzamış gibi davranılmalı, yani **`rest − d`**. Planın önceki "restLength +
  derinlik" ifadesi gövdeyi yukarı iterdi; Faz 3 maddesi buna göre
  düzeltildi. Tekerlek görseli ayrıca `d` kadar aşağı indirilir.

**Yuvarlanma direnci — fren yöntemi korunuyor.** Eşleştirilmiş kuvvette
(15 m/s'den serbest yuvarlanma) fren ve şasi impulsu birebir aynı: 42,1 m,
12,4 s'de duruş. 8° rampada el freni çekilmeden ikisi de aracı **haksız yere
tutmuyor** (10 s'de 28,2 m kayıp yuvarlanıyor; dirençsiz 68,3 m); durağan
halde titreme yok. Fren yolu Rapier'in tekerlek modelinde kaldığı için Faz
1a'daki `rollingResistance × yük × min(|v|, 1)` fren formülü korunur. Not:
`mud` profiliyle (tutuş çarpanları + direnç) araç 8° rampada 0,67 m kayıp
duruyor ve 15 m/s'den 32,8 m / 4,7 s'de duruyor; çamurda bu beklenen his,
ama Faz 6 smoke'unda rampa kalkışıyla birlikte değerlendirilmeli.

**Doku yükleme — kısmi yükleme.** 512² R8, 300 kare, her karede rastgele
kirli dikdörtgen:

| Yöntem | Render CPU ort. / p95 | GPU (yükleme + çizim) ort. / p95 |
|---|---|---|
| Tam yükleme (`needsUpdate`) | 0,25 / 0,4 ms | 0,19 / 2,23 ms |
| Kısmi `texSubImage2D` (kirli dikdörtgen) | 0,16 / 0,3 ms | 0,013 / 0,016 ms |

Tam yükleme ortalamada bütçeye (< 0,3 ms) sığıyor ama GPU p95'i 2,2 ms'ye
sıçrıyor. three r184'ün `addUpdateRange` yolu `componentStride = 4`'ü sabit
kodluyor, R8 için kullanılamaz. **Karar:** Faz 2 alanın kirli
dikdörtgenlerini (toroidal sarmada en çok 4) `renderer.state.bindTexture` +
`gl.texSubImage2D` ile kendi küçük yükleyicisiyle gönderir.

**Ret durumunda yedek yol:** Rest length kararsızsa gömülme yalnız görsel
kalır (tekerlek modeli izin içine indirilir), fizik tarafı direnç + tutuş
düşüşüyle sınırlanır. Faz 1 ve 2 bu karardan etkilenmez.

## Faz 1 — Yüzey profili (yalnız fizik)

Görsel değişiklik yok. Araç çamurda zorlanır, karda kayar.

**1a — arazi dışı (açık dünya Faz 3'ü beklemez)**

- [x] `PhysicalMaterialDef.vehicle` / `.deformation` tipleri + `snow`, `mud`,
      `sand` presetleri; `resolvePhysicalMaterial` bozulmadan genişler.
- [x] `surfaceResponse.ts`: katman karışımı → `SurfaceSample`
      (`frictionSlipScale`, `sideFrictionScale`, `rollingResistance`,
      `deformability`).
- [x] `PhysicsSubsystem.setVehicleSurfaceProvider()`. `updateVehicles()`
      `computeVehicleDrive` sonrasında tekerlek başına çarpanları uygular.
      `frictionSlip` artık yalnız attach anında değil, her adımda set edilir.
      Provider yoksa çarpanlar 1 olur ve davranış bugünküyle aynı kalır.
- [x] `VehicleWheelState.groundEntityId` eklenir.
- [x] Landscape dışı zemin: provider, zemin collider'ının `physicalMaterialId`
      değerini kullanır. Örneğin `mud` mesh üstünde araç zorlanır.
- [x] Testler: `tests/engine/surfaceResponse.test.ts` (karışım, sınır geçişi,
      provider yokken nötr), `vehicleRuntime` regresyonu (physical material yok →
      eski hız eğrisi).

**1a notu (2026-10-23):** Varsayılan mesh provider `SceneApp` ve
`RuntimeSceneApp` tarafından kurulur; doğrudan `PhysicsSubsystem` kullanımı
providersızdır, `setVehicleSurfaceProvider(null)` ile kapatılır. Collider
kimliği asset/placement adaptörü, component okuyucusu ve fizik kopyasında korunur.
Eski presetler (`slippery` dahil) `vehicle` bloğu almadı ve nötr kaldı; dropdown
ve save allowlist zaten ortak `PHYSICAL_MATERIAL_IDS` listesini kullanıyor.
`deformability`, `maxDepth > 0` profillerin toplam katılım ağırlığıdır (0..1);
derinlik/compaction hesabı sonraki fazlara aittir. Ek fren kuvveti
`rollingResistance × suspensionLoad × min(|speed| / 1 m/s, 1)` olarak seçildi,
Rapier'e `force × dt` fren impuls sınırı verilir. Temas/yük son tamamlanan
fizik adımından okunur. Faz 0'ın gerçek sahnede fren–impuls karşılaştırması
açık kalır. On iki yeni kontrol; providersız/nötr altı noktalı hız eğrisini
değişiklik öncesi değerlerle birebir, çamur ivmelenmesini, provider'ın
kapatılmasını, zemin entity eşlemesini ve preset id kayıt dönüşünü kapsar.
Faz 1b terrain katmanı bağlantıları bu değişikliğe dahil değildir.

**1b — terrain bağlantısı (açık dünya Faz 3'ten sonra)**

- [ ] `WorldTerrainLayerDef.physicalMaterial` + `normalizeWorldTerrain` +
      1×1 adaptör + drift testi. Örnekleme mevcut `terrainLayerWeightsAt`
      ile (dünya uzayı; ayrı landscape-local örnekleyici yok).
- [ ] `terrainDeformationModule` iskeleti: terrain host servisi üzerinden
      provider'ı kurar. Hiçbir katmanda physical material yoksa boşta bekler.
- [ ] Editör (minimum): terrain paint katmanı satırına Physical Material
      dropdown'u eklenir.
- [ ] Test seviyesi `public/layouts/OffroadTest.level.json`: çim/çamur/kar
      boyanmış terrain, araç ve Player Start.

## Faz 2 — İz alanı + görsel izler

Displacement yok. İzler normal map, albedo ve roughness ile görünür.

- [x] `deformationField.ts`: toroidal pencere (boyut ve hücre ayarlanabilir),
      kanal 0 = derinlik, kanal 1 = bozulma (renk/ıslaklık için).
      `stamp` (tekerlek ayak izi: genişlik × temas uzunluğu, yöne göre döndürülür),
      `sample`, `recenter`, `decay` (aktif hücre listesi ya da 0,5 s'de bir
      tarama), kirli dikdörtgen.
- [x] İz basma modeli: temas eden tekerlek başına, her fizik adımında hedef
      derinlik = `maxDepth × deformability × yük oranı`
      (`wheelSuspensionForce` / nominal yük).
      `hücre = max(hücre, lerp(hücre, hedef, compaction))`. Hızlı giden araçta
      iz boşluk bırakmasın diye iki temas noktası arası çizgi olarak basılır.

**Faz 2 çekirdek notu (2026-10-23):** Saf toroidal alan, süpürülmüş tekerlek/disk
izi, max-lerp, bilinear örnekleme, aktif hücre recovery ve en fazla dört kirli
doku dikdörtgeni tamamlandı. Derinlik 0,1 mm adımlı `Uint16` (en çok 6,5535 m),
bozulma 0..255 `Uint8`: kanal belleği 768 KiB + aktif hücre kümesi, yaklaşık
0,5 MB hedefinden yüksek. 17 engine kontrolü; 4 tekerlek × 600 adım için zaman
yerine ziyaret edilen hücre bütçesi. Shader/modül/debug/runtime recovery sonraya ait.
GPU kopyası Faz 0'da ölçülen R8 yoluna uyar: kısmi yüklemenin paketleme adımı
kirli dikdörtgeni R8'e (profilin `maxDepth`'ine göre ölçeklenmiş, 0,3 m'de
~1,2 mm adım) indirir; CPU alanı fizik için `Uint16` kalır.

- [ ] Pencere merkezi: oyuncunun aracı. Pencere içindeki AI araçları da iz basar.
- [ ] `terrainDeformation.ts` shader parçası açık dünya Faz 2'nin CDLOD
      `terrainMaterial`'ına eklenir (eski splat/vertex-color landscape
      materyalleri o fazda kalkıyor). Uniform'lar: `uDeformTex`, `uDeformOrigin`, `uDeformSize`, `uDeformTint`.
      Fragment tarafında komşu örneklerin farkından normal üretilir, tint ve
      wetness uygulanır, pencere kenarında etki sönümlenir.
      `customProgramCacheKey` deformasyon bayrağını içerir.
- [ ] Tint ve wetness, katman başına profilden gelir (`vLandscapeWeight` ile
      karıştırılır; shader dört katmanla sınırlı).
- [ ] `recoveryRate`: kar izleri zamanla dolar.
- [ ] `?debug`: aktif hücre sayısı, en derin iz, yükleme süresi ve tekerlek
      başına yüzey bilgisini gösteren tablo satırı. Pencereyi gösteren
      görselleştirme açılıp kapatılabilir.
- [ ] Testler: `tests/engine/deformationField.test.ts` (stamp/sample, toroidal
      sarma, recenter temizliği, decay, çizgi basma boşluksuzluğu).

## Faz 3 — Gömülme (fizik + yerel yoğun mesh)

- [ ] **Fizik:** tekerlek başına `restLength − alan derinliği` (Faz 0 işaret
      düzeltmesi; değişim ≤ 0,3 m/s slew-limit, değişince `wakeUp()`).
      Tekerlek ışını arazi collider'ına çarpar; kısalan rest length gövdeyi
      derinlik kadar indirir, tekerlek görseli aynı miktarda aşağı kaydırılır.
- [ ] **Patinajda kazma:** tekerlek dönüş hızı ile zemin hızı arasındaki fark
      (`wheelRotation` deltası) `digRate` ile çarpılıp derinliğe eklenir. Araç
      patinaj yaptıkça kendini gömer.
- [ ] **Gövde sürtünmesi (belly drag):** derinlik yerden yüksekliği aşınca
      şasiye hızla orantılı ters impuls uygulanır (`sinkResistance`).
- [ ] **Yerel patch mesh:** aracın çevresinde yoğun bir grid (örneğin 256²,
      20 cm aralık; boyutu kalite profiline bağlı). Vertex yüksekliği
      `terrainHeightAt` (collider üçgenleriyle birebir aynı köşegen) − alan
      derinliği. Ana terrain fragment'i
      patch'in kapladığı alanda `discard` edilir; kenarda derinlik 0 olduğu
      için patch, terrain ile dikişsiz birleşir.
- [ ] İz kenarlarında kabarma (berm): ezilen malzeme izin iki yanında hafifçe
      yükselir. Yalnız görseldir, fiziğe etki etmez.
- [ ] Kalite profili: düşük profilde patch kapanır, Faz 2 görünümüne düşülür.
- [ ] Testler: patch vertex'lerinin `terrainHeightAt` ile eşitliği (collider
      eşitliği açık dünya Faz 1'de zaten testli), patch kenarında sıfır fark, derin çamurda
      sabit gazla hızın düz zemine göre belirgin düşük kalması.

## Faz 4 — Efekt ve ses

- [x] **VFX runtime spawn API'si (2026-10-23):** `VfxCommands.spawnEffectAt`
      konum/yön/ölçekle tek seferlik efekt, `createEffectEmitter` kalıcı emitter
      oluşturur; ikisi de asset id veya public köküne göre `.effect.json` yolu
      alıp `Promise<VfxEffectHandle | null>` döndürür. Handle'ın `setTransform`,
      `setEmissionRate`, `stop(fadeOut = true)` ve `dispose` metotları vardır;
      seviye kapanınca etkisizleşir. Emisyon çarpanı kalite yoğunluğuyla birlikte
      authored rate/burst sayısına uygulanır, sabit partikül kapasitesini aşmaz.
      Burst mevcut runtime gibi yalnız ilk delay'de bir kez çıkar; 0 çarpanla
      bastırılan burst daha sonra tekrarlanmaz. `stop()` yeni emisyonu keser,
      canlı partiküllerin ömrünü tamamlamasını bekler. Araç/yüzey bağlantısı bu
      maddeden ayrıdır.
- [x] Physical material'a isteğe bağlı `wheelEffect` (effect asset id veya public-root `.effect.json` yolu) eklenir;
      emisyon hızı patinaj ve hızla ölçeklenir. Çamur sıçraması ve kar tozu
      birer `*.effect.json` örnek asset olarak gelir.
- [x] İsteğe bağlı `wheelSound` (sound / soundCue id): yüzeye göre lastik sesi döngüsü,
      `vehicleModule`'deki motor sesi deseniyle.

**Faz 4, maddeler 2–3 (2026-10-23):** `wheelEffect` / `wheelSound`, diğer
physical material blokları gibi yalnız preset verisidir; kayıtlar yalnız
`physicalMaterialId` taşır. Yerleşik presetlerde ikisi de boş bırakıldı; bu
yüzeylerde efekt veya ses çağrısı yapılmaz. Çamur sıçraması (mud-splash) ve kar
tozu (snow-dust) örnek assetleri **henüz yazılmadı**, ayrı içerik işidir.
Araç host'unun enjekte edilebilir `surfaceMaterialForWheel` sorgusu bugün
temas edilen mesh collider'ın materyalini çözer; terrain katmanları Faz 1b'ye
aittir. Sürülen/possess edilen araçlar ve mevcut dinamik fizik aktif yarıçapı
içindeki diğer araçlar tekerlek başına bir emitter ve bir mekânsal ses döngüsü
kullanır; aktif yarıçap kapalıysa tüm araçlar uygundur. Saf `wheelSurfaceFx`
eğrileri dönüş farkından hesaplanan patinaj ve hızla emisyon/ses düzeyini
ölçekler; duruşta ve havada sıfırlanır (yerinde dönen lastik patinaj sayılır).
Yüzey değişimi eski parçacıkları/sesi sönümleyerek durdurur; parçacıkları VFX
runtime kendi havuzuna geri alır. Araç/seviye/modül kapanışı mevcut handle'ları
ve geç yüklenen emitter'ları temizler. Yeni yol sabit durumda konum, girdi ve
sonuç nesnelerini tekrar kullanır. Fake servis testleri yaşam döngüsünü ve
opt-out davranışını kapsar; tarayıcı ve örnek asset kabulü sonraya aittir.

## Faz 5 — Kalıcılık

> **2026-10-23 — Saf parçalar hazır:** `deformationPersistence.ts` dünya hizalı
> 1 m / 32×32 seyrek kaba katmanı sağlar. `DeformationField` isteğe bağlı
> `onEvictCell` callback'iyle yalnız çıkan aktif hücreleri temizlenmeden önce
> aktarır; callback yokken davranış değişmez. `absorbWindow()` kayıt anında
> max-pool yapar; kaba örnekleme hücre içinde sabittir (nearest).
> `deformationStateCodec.ts` v1 JSON, 8-bit derinlik + RLE/base64, doğrulama ve
> kimlik uyuşmazlığında yoksayma sağlar. Derinlik hatası en fazla
> `maxDepth / 510 + 0,00005 m`; disturbance kayıpsızdır. Codec canlı pencereyi
> kaba katmanın kopyasına da katar; 64 KiB aşılırsa pencereyi bırakır. Kaba
> katman tek başına bütçeyi aşarsa veri silmeden `withinBudget: false` bildirir.
> Saf engine testleri, 2 km dört tekerlekli sürüş boyut kontrolü dahil hazırdır.
> **Kalan entegrasyon:** runtime/shader fallback bağlantısı,
> `GameSaveState.terrainDeformation?`, save modülü toplama/geri yükleme,
> `SAVE_GAME_CONTRACT.md` güncellemesi ve `saveGameModule.test.ts` kontrolleri.
> Aşağıdaki uçtan uca maddeler bu nedenle açık kalır.

- [ ] **Kaba kalıcı katman:** pencereden çıkan hücreler landscape
      çözünürlüğünde (1 m) bir alana max-pool ile aktarılır. Shader pencere
      dışında bu katmanı örnekler; uzaktaki eski izler kaba da olsa görünür.
- [ ] **Save-game:** `GameSaveState.terrainDeformation?` alanı (opt-in, RLE +
      quantize, base64). Pencere + kaba katman saklanır. Geri yüklerken
      `activeLevelPath` ve landscape id eşleşmesi zorunludur, eşleşmezse
      yoksayılır. `SAVE_GAME_CONTRACT.md` güncellenir.
- [ ] Boyut bütçesi: tipik bir kayıtta ≤ 64 KB. Aşılırsa kaba katmana düşülür.
- [ ] Testler: `saveGameModule.test.ts` round-trip ve bozuk/uyumsuz payload
      reddi.

## Faz 6 — Editör yüzeyi ve doğrulama

- [ ] Physical material düzenleme: preset seçimi + `vehicle` / `deformation`
      alanlarının formu. Fork'a özel `*.physmat.json` asset tipi (açık soru 1).
- [ ] Landscape viewport "Surface" görünüm modu (`LandscapeViewMode`'a
      eklenir): katman başına physical material renk haritası.
- [ ] Browser smoke `tests/smoke/terrain-deformation.spec.ts` (port 5273):
      `OffroadTest` aç → sür → `?debug` snapshot'ında aktif hücre > 0, çamurda
      hız < asfaltta hız, kayıt → yükle → izler duruyor.
- [ ] CLAUDE.md allowlist notlarının ve `UNREAL_BASICS_LESSONS.md` ilerleme
      kaydının güncellenmesi.

---

## Bütçe hedefleri (orta seviye masaüstü, 60 Hz)

| Kalem | Hedef |
|---|---|
| İz basma (4 tekerlek × 1 araç, adım başına) | < 0,05 ms |
| Decay + recenter (ortalama) | < 0,2 ms/kare |
| Doku yükleme (512² R8) | < 0,3 ms/kare; aşılırsa N karede bir yükleme |
| Patch mesh (Faz 3) | < 0,5 ms GPU; düşük profilde kapalı |
| Bellek | Alan ~0,5 MB + kaba katman ~0,25 MB |

## Riskler

| Risk | Önlem |
|---|---|
| Rest length değişimi süspansiyonu titretir | Faz 0 kapısı; değişim hızına sınır; ret durumunda görsel gömülme + direnç |
| Patch ile terrain arasında dikiş ya da z-fighting | Üçgen-birebir yükseklik örneği + kapsanan alanda `discard`; test ile sabitlenir |
| Yükseklik sorgusu bilinear kalırsa tekerlek ile iz hizasız olur | **Kapandı:** `terrainHeightAt` üçgen-birebir, Rapier ışınıyla eşitlik testi var (açık dünya Faz 1, K3a) |
| Eski landscape shader'ı yalnız ilk 4 katmanı görüyor (`vec4 landscapeWeight`) | CDLOD materyali 2 × RGBA8 ağırlık dokusuyla 8 katman taşır; fizik 8 katmanın tamamını kullanır |
| Döndürülmüş ya da birden çok landscape | Alan dünya ekseninde tutulur; örnekleme her landscape'in ters dönüşümüyle yapılır |
| Düşük donanım / mobil | Kalite profili: hücre boyutu büyür, patch kapanır, gerekirse yalnız Faz 1 kalır |
| Hızlı araçta izler kesik kesik çıkar | Adımlar arası çizgi olarak basma (Faz 2) |
| Save boyutu büyür | RLE + kaba katmana düşme + opt-in |

## Açık sorular

1. **Fork'a özel physical material:** yalnız yerleşik presetler mi kalsın, yoksa
   `*.physmat.json` asset tipi mi eklensin? Öneri: Faz 1–5 yerleşik presetlerle
   gitsin; asset tipi, bir fork ihtiyaç duyduğunda Faz 6'da eklensin (Unreal'deki
   Physical Material asset'ine denk).
2. **Karakter ayak izleri:** `stamp` API'si genel olduğu için kolay, ama
   karakter hareketinin de yüzey tepkisi (yavaşlama) alması ayrı bir iş.
   Bu planın dışında tutulur ve ayrı bir alt plan olarak değerlendirilir.
3. **Kalıcı heightmap değişikliği** (krater, kazı) bu planın kapsamı dışında.
   Runtime trimesh yeniden kurma ve authored data ilkesiyle çelişir.
