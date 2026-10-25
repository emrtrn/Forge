# Terrain Deformasyonu Planı (Kar / Çamur İzleri)

> Durum: **Faz 1a + 1b + Faz 2 + Faz 3 tamamlandı** (2026-10-24,
> `feat/terrain-deformation`); Faz 3'ün görsel kısmı CDLOD alt-seviyeleriyle
> (A5) yapıldı. Görsel kabul ve S-D1'in GPU / pop ölçümü kullanıcı testinde
> (LandscapeTest + Gaz52). Faz 4A + çamur/kar efekti ve düşük tutuşta patinaj
> bağlantısı uygulandı (2026-10-25); kullanıcı patinaj ve parçacıkların görünür
> olduğunu doğruladı. Yüzey sesleri, son his ayarı ve performans kabulü açık.
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

> **Araştırma kararları (2026-10-23, kullanıcı onaylı):** ayrıntı ve gerekçe
> [OFFROAD_ARAZI_DEFORMASYON_TEKNIKLERI_ARASTIRMA_v0.1.md](OFFROAD_ARAZI_DEFORMASYON_TEKNIKLERI_ARASTIRMA_v0.1.md).
> (1) **Kalıcılık kademeli:** M2 kalıcılık olmadan biter; pencere dışı izler 1 m
> kaba katmana (yalnız görsel) düşer; seyrek blok deposu ve save-game kalıcılığı
> M2 oynama testinden sonra karara bağlanır. (2) **Malzeme modeli düzeltilmiş
> preset:** `targetDepthForWheel`'in `min(yük/nominal, 1)` doygunluğu kaldırılır
> (`nominal` = boş aracın tekerlek başına statik yükü); derinlik hesabı tek bir
> `sinkage(...)` fonksiyonunda toplanır, Bekker ileride aynı arayüzün arkasına
> konabilir. Rapor ayrıca Faz 3'ün "yerel patch mesh + discard" maddesi yerine
> CDLOD alt-seviyelerini öneriyor. **Karar (2026-10-24, kullanıcı):** A5 (CDLOD
> alt-seviyeleri), ayrı spike yok; S-D1 kapıları üretim koduna testlerle
> bağlandı, GPU süresi ve pop kullanıcının makinesinde `?debug` ile ölçülür.

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
   satırı açar. Pahalı parçalar (iz penceresi alt-seviyeleri, alan çözünürlüğü) kalite
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
    "tractionCoefficient": 0.35,    // ileri çekiş kuvveti / tekerlek yükü; Rapier ayarından bağımsız
    "sideFrictionScale": 0.7,       // sideFrictionStiffness ile çarpılır
    "rollingResistance": 0.12       // hız ve tekerlek yüküyle ölçeklenen direnç
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
| `engine/render-three/terrain/terrainDeformation.ts` | Shader parçası (açık dünya Faz 2'nin CDLOD `terrainMaterial`'ına), `DataTexture` yükleme, Faz 3 vertex yer değiştirmesi + berm (alt-seviye seçimi `engine/terrain/terrainLod.ts`) |
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
- [x] **Zemin tanıma** (açık dünya Faz 3'ten sonra): `wheelGroundObject(i)` →
      `rapierColliderToEntity` → `landscape:<id>:<tile>` eşlemesinin tile
      heightfield'ında çalıştığı doğrulanır. *Mesh zeminde doğrulandı
      (2026-10-23): Faz 1a'nın `groundEntityId` Rapier testi.* *Heightfield
      (2026-10-24): açık dünya Faz 3'ün dikiş testi
      (`terrainHeightfieldPhysics.test.ts`) her tekerleğin `groundEntityId`'sini
      tile kimliğiyle zaten doğruluyor; Faz 1b'nin `terrain surface rapier`
      testleri aynı kimlikten paint katmanını çözüyor.*
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
`node spikes/terrain-deformation/run.mjs`. (`spikes/` merge öncesi silindi;
`git checkout 035a659 -- spikes` ile geri gelir.)

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

- [x] `WorldTerrainLayerDef.physicalMaterial` + `normalizeWorldTerrain` +
      1×1 adaptör + drift testi. Örnekleme mevcut `terrainLayerWeightsAt`
      ile (dünya uzayı; ayrı landscape-local örnekleyici yok).
- [x] ~~`terrainDeformationModule` iskeleti~~ → host düzeyinde yüzey çözücü
      (aşağıdaki nota bakın). Hiçbir katmanda physical material yoksa kaynak
      kurulmaz, davranış birebir aynı kalır.
- [x] Editör (minimum): terrain paint katmanı satırına Physical Material
      dropdown'u eklenir.
- [x] Test seviyesi `public/assets/starter-content/Levels/OffroadTest.level.json`
      (manifest'e kayıtlı, Content Browser'dan açılır): çim/çamur/kar/kum
      boyanmış terrain ve araç (`forge.vehicle` modu; Player Start gerekmiyor).

**Faz 1b notu (2026-10-24):** Katman alanı ortak normalizer'da sıkı
doğrulanır: `null`/yok nötr, bilinmeyen preset id'si terrain'i reddeder
(placement validator'ıyla aynı kural). 1×1 yolda `LandscapeLayerWeights`
alanı taşır (köprü, legacy dönüşüm, genişletme, yeniden örnekleme, klonlama);
legacy `.landscape.json` yazılmadığı için ayrı validator gerekmedi. Çözücü
`engine/terrain/terrainSurface.ts`: `TerrainSurfaceSource` (dünya uzayında
çok-tile, aktör çerçevesinde döndürülmüş 1×1), katman başına bir kez çözülmüş
profillerle ağırlık karışımı (`TerrainSurfaceSampler`, `resolveSurfaceSample`
ile aynı sonuç, adım başına tekrar kullanılan dizi) ve
`createTerrainSurfaceProvider` (terrain collider'ında sampler, diğer her yerde
Faz 1a'nın collider-material provider'ı). **Plandan sapma:** modül yerine
`RuntimeSceneApp` kurar; yüzey tepkisi authored veridir ve Faz 1a mesh
provider'ı gibi deformasyon modülünden bağımsız çalışmalı. Modül Faz 2'de
alanın sahibi olarak gelir. Tekerlek efekti/sesi (`surfaceMaterialForWheel`)
aynı sampler'ın en ağır katmanını kullanır. Collider kimliği
`landscapeColliderActorId` ile aktöre çözülür. Editör viewport'u araç
sürmediği için `SceneApp` mesh provider'ında kaldı. Testler:
`terrainSurface.test.ts` (karışım, kenar, döndürülmüş 1×1, kimlik eşlemesi,
Rapier: materyalsiz terrain collider provider'ıyla birebir aynı hız eğrisi,
çamur katmanı ivmeyi %20'den fazla düşürür), `offroadTestWorld.test.ts`
(commit edilen dosyalar üreteçle aynı; `npm run world:offroad`). `?debug`
overlay'ine sürülen aracın tekerlek başına `vehicle surface:` satırı eklendi
(zemin id'si, `fs`/`rr`). Browser smoke'ları: `terrain-surface.spec.ts`
(OffroadTest, katmanlar uçuşta nötr/çamur; dört tekerlek doğru zemini
raporlar, araç sürülür — headless kare hızında duvar saati hız kıyası
anlamsız olduğu için dinamik Rapier testlerinde) ve `landscape-paint.spec.ts`
(dropdown → Save → reload'da `physicalMaterial` kalıcı). Çok-tile editör
paneli aynı setter'ı kullanıyor, ayrıca browser'da denenmedi.

## Faz 2 — İz alanı + görsel izler

Displacement yok. İzler normal map, albedo ve roughness ile görünür.

- [x] `deformationField.ts`: toroidal pencere (boyut ve hücre ayarlanabilir),
      kanal 0 = derinlik, kanal 1 = bozulma (renk/ıslaklık için).
      `stamp` (tekerlek ayak izi: genişlik × temas uzunluğu, yöne göre döndürülür),
      `sample`, `recenter`, `decay` (aktif hücre listesi ya da 0,5 s'de bir
      tarama), kirli dikdörtgen.
- [x] İz basma modeli: temas eden tekerlek başına, her fizik adımında hedef
      derinlik = `sinkage(profil, deformability, {yük, nominal, genişlik})`
      (`engine/physics/surface/sinkage.ts`, K-B; aşağıdaki nota bakın).
      `hücre = max(hücre, lerp(hücre, hedef, compaction))`. Hızlı giden araçta
      iz boşluk bırakmasın diye iki temas noktası arası çizgi olarak basılır.

**K-B notu (2026-10-24):** `targetDepthForWheel`'in `min(yük/nominal, 1)`
doygunluğu kaldırıldı; tek giriş noktası `sinkage()`:
`maxDepth × deformability × (1 − 2^(−yük/nominal))`. Boş araç (`nominal` =
`nominalWheelLoad`, kütle × g / tekerlek sayısı) `maxDepth`'in yarısına basar,
her ek nominal yük kalan farkı yarıya indirir; ağır yük her zaman daha derin
ama asla `maxDepth`'i (sert taban üstündeki yumuşak katman kalınlığı, rapor
§6 #6'daki `T`) geçmez. Genişlik girdide taşınır, preset eğrisi kullanmaz;
Bekker aynı arayüzün arkasına konabilir. `VehicleWheelDefinition.width`
eklendi (normalizer + allowlist + araç editörü satırı); yoksa `radius × 0,7`
(`vehicleWheelWidth`), üretilen tekerlek görseli ve editör üstten görünüşü de
bunu kullanır (eski sabit 0,26 m kalktı).

**Faz 2 çekirdek notu (2026-10-23):** Saf toroidal alan, süpürülmüş tekerlek/disk
izi, max-lerp, bilinear örnekleme, aktif hücre recovery ve en fazla dört kirli
doku dikdörtgeni tamamlandı. Derinlik 0,1 mm adımlı `Uint16` (en çok 6,5535 m),
bozulma 0..255 `Uint8`: kanal belleği 768 KiB + aktif hücre kümesi, yaklaşık
0,5 MB hedefinden yüksek. 17 engine kontrolü; 4 tekerlek × 600 adım için zaman
yerine ziyaret edilen hücre bütçesi. Shader/modül/debug/runtime recovery sonraya ait.
GPU kopyası Faz 0'da ölçülen R8 yoluna uyar: kısmi yüklemenin paketleme adımı
kirli dikdörtgeni R8'e (profilin `maxDepth`'ine göre ölçeklenmiş, 0,3 m'de
~1,2 mm adım) indirir; CPU alanı fizik için `Uint16` kalır.

- [x] Pencere merkezi: oyuncunun aracı. Pencere içindeki AI araçları da iz basar.
- [x] `terrainDeformation.ts` shader parçası açık dünya Faz 2'nin CDLOD
      `terrainMaterial`'ına eklenir (eski splat/vertex-color landscape
      materyalleri o fazda kalkıyor). Uniform'lar: `uDeformTex`, `uDeformOrigin`, `uDeformSize`, `uDeformTint`.
      Fragment tarafında komşu örneklerin farkından normal üretilir, tint ve
      wetness uygulanır, pencere kenarında etki sönümlenir.
      `customProgramCacheKey` deformasyon bayrağını içerir.
- [x] Tint ve wetness, katman başına profilden gelir (`vLandscapeWeight` ile
      karıştırılır; shader dört katmanla sınırlı).
- [x] `recoveryRate`: kar izleri zamanla dolar.
- [x] `?debug`: aktif hücre sayısı, en derin iz, yükleme süresi ve tekerlek
      başına yüzey bilgisini gösteren tablo satırı. ~~Pencereyi gösteren
      görselleştirme~~ yapılmadı (gerekirse sonra).
- [x] Testler: `tests/engine/deformationField.test.ts` (stamp/sample, toroidal
      sarma, recenter temizliği, decay, çizgi basma boşluksuzluğu).

**Faz 2 bağlantı notu (2026-10-24):**
- *Modül* `src/scene/capabilities/terrainDeformationModule.ts` (varsayılan
  set, `presentation` slot'unda subsystem; `engine` perf bölgesinde
  `terrainDeformation` satırı). Alan ilk deforme olabilir terrain'le birlikte
  tembel kurulur; hiçbir katmanda soft profil yoksa ayrılmaz. Pencere sürülen
  aracı (yoksa ilk aracı) izler; pencere içindeki tüm araçlar iz basar.
  `terrainDeformationService`: `stamp` (genel disk girişi), `sample`, `snapshot`.
- *İz basma* `engine/physics/surface/wheelTracks.ts` (saf): tekerlek başına son
  temas noktasından süpürme (2 m'den uzun sıçrama yeni iz başlatır), şasi
  yönü + direksiyon açısı, temas uzunluğu `2√(2 r z)`, derinlik `sinkage()`
  ile `VehicleWheelState.suspensionForce` (yeni alan) yüküyle. `compaction`
  60 Hz adım başına tanımlı; kare başına `1 − (1 − c)^(dt·60)` ile kare hızından
  bağımsız (floor kuantalaması nedeniyle 30/144 fps farkı birkaç mm).
- *Toparlanma* hücre başına: `DeformationField.recovery` (mm/s, son değiştiren
  damga yazar) + `recover(dt)` 0,4 s'lik tam adımlarla, çağrı başına en çok 3
  adım. Çamur izi kalır, yanındaki kar izi dolar. Bellek 768 → 1024 KiB.
- *GPU* `engine/render-three/terrain/terrainDeformation.ts`: RG8 doku (R
  derinlik / en derin preset `maxDepth` = 0,3 m, G bozulma), `RepeatWrapping`
  ile toroidal örnekleme; değişen hücreler mevcut `TerrainTextureUpdates`
  (`copyTextureToTexture`, dikdörtgen başına tek kopya) ile materyalin
  `onBeforeRender`'ında gider. **Plandan sapma:** `customProgramCacheKey`
  bayrağı yerine blok her zaman derlenir, sayfa başına paylaşılan dokunun
  `uDeformActive` uniform'u kapatır (editör ve izsiz seviyeler yalnız bir
  dallanma öder, doku okumaz). Lit materyal: dünya X/Z varyingi, kenarda %6
  sönüm, komşu farkından view-space normal eğimi, katman ağırlıklı tint +
  derinlikle hafif kararma, ıslaklıkla roughness düşüşü. GTAO normal / depth
  pass'leri izleri görmez (displacement Faz 3'te). 1×1 Landscape de aynı CDLOD
  renderer'ı kullandığı için izler orada da görünür.
- *Testler* `wheelTracks.test.ts` (toparlanma, kare hızı, boşluksuz iz, teleport,
  yük, sampler karışımı, doku paketleme, sahte servislerle modül);
  `terrain-surface.spec.ts` çamurlu koşuda >100 hücre ve shader hatasız.
  Görsel kabul ekran görüntüsüyle yapılmadı (headless canvas siyah).

## Faz 3 — Gömülme (fizik + iz penceresinde yoğun mesh)

- [x] **Fizik:** tekerlek başına `restLength − alan derinliği` (Faz 0 işaret
      düzeltmesi; değişim ≤ 0,3 m/s slew-limit, değişince `wakeUp()`).
      Tekerlek ışını arazi collider'ına çarpar; kısalan rest length gövdeyi
      derinlik kadar indirir, tekerlek görseli aynı miktarda aşağı kaydırılır.
- [x] **Patinajda kazma:** tekerlek dönüş hızı ile zemin hızı arasındaki fark
      (`wheelRotation` deltası) `digRate` ile çarpılıp derinliğe eklenir. Araç
      patinaj yaptıkça kendini gömer. (Uygulamada fark `wheelRotation`
      yerine `tractionSlip`'ten okunuyor; aşağıdaki nota bakın.)
- [x] **Gövde sürtünmesi (belly drag):** derinlik yerden yüksekliği aşınca
      şasiye hızla orantılı ters impuls uygulanır (`sinkResistance`).
- [x] ~~**Yerel patch mesh:** aracın çevresinde yoğun bir grid (örneğin 256²,
      20 cm aralık), ana terrain'de `discard`.~~ **Yerine CDLOD alt-seviyeleri
      (A5):** iz penceresinde quadtree level 0'ın altına iner (1 m tile'da
      0,5 / 0,25 m), vertex yüksekliği `terrainHeightAt` ile aynı üçgenlerden
      − alan derinliği. Tek mesh, `discard` ve ikinci yüzey yok; pencere
      kenarında derinlik 0. Ayrıntı aşağıdaki görsel notta.
- [x] İz kenarlarında kabarma (berm): ezilen malzeme izin iki yanında hafifçe
      yükselir. Yalnız görseldir (vertex shader), fiziğe ve alana etki etmez.
- [x] **Yanal iz-tutma (araştırma C6, plana ek):** iz duvarı yuvarlanan
      tekerleği derin tarafa iter; araç var olan izleri izler, çıkmak için
      direksiyon ister. Ayrıntı aşağıdaki C6 notunda.
- [x] Kalite profili: `terrainTrackDetailLevels` (ultra/high 2, medium 1,
      low 0); düşük profilde alt-seviye yok, Faz 2 görünümüne düşülür.
- [x] Testler: tile vertex'lerinin `terrainHeightAt` ile eşitliği (collider
      eşitliği açık dünya Faz 1'de zaten testli), pencere kenarında sıfır fark, derin çamurda
      sabit gazla hızın düz zemine göre belirgin düşük kalması.

**Faz 3 fizik notu (2026-10-24):**
- *Sanal ofset.* Terrain collider hiç değişmez. `PhysicsSubsystem.setVehicleGroundSinkProvider`
  (enjekte edilen provider; `terrainDeformationModule` kurar) tekerlek başına
  son temas noktasının altındaki iz derinliğini döndürür; fizik adımı
  `rest − derinlik` ile rest length'i kısaltır, değişim ≤ 0,3 m/s
  (`slewSinkDepth`), değişince `wakeUp()`. Tekerlek görseli `sinkDepth` kadar
  aşağı iner. `VehicleWheelState` yeni `sinkDepth` ve `tractionSlip` alanlarını
  taşır; `SurfaceDeformationSample` `digRate` + `sinkResistance` taşır. Saf
  yardımcılar `engine/physics/surface/wheelSink.ts`'te.
- *Sınır + belly drag.* `wheelSinkLimit = max(0, min(açıklık − 5 cm, rest − 5 cm))`;
  açıklık = şasi collider altı − tekerleğin rest pozundaki zemin
  (`hardPointY − rest − radius`), araç kurulurken hesaplanır. İstenen derinlik
  sınırı aşınca fark (`overlap`) gövdeye sürtünür:
  `F = sinkResistance × m × g × min(overlap / 0,1 m, 1) × min(|v_yatay|, 1 m/s)`,
  yatay hıza ters impuls `min(F·dt, m·|v_yatay|)` (bir dilimde hareketi asla
  ters çevirmez, y'ye dokunmaz).
- *Ayak izi.* Derinlik tek nokta değil, aks boyunca −0,35·genişlik / 0 /
  +0,35·genişlik'teki üç örneğin ortalaması (`wheelFootprintDepth`). 12,5 cm
  hücrede 0,245 m'lik lastiğin yan örnekleri izin bilinear kenarına düşer:
  park eden araç statik `sinkage`'ın ~%85'ine oturur (referans araç 0,093 m /
  0,11 m), iz merkezinin biraz üstünde. Bu kabul edildi; titreşim yok.
- *Patinajda kazma.* `tractionSlip` Rapier'in sürtünme dairesinden hesaplanır
  (`tractionSlip()`: ileri impuls `engineForce × dt × 0,5`, son yan impulsla
  birlikte `yük × dt × frictionSlip` sınırına karşı). **Rapier bulgusu:**
  ray-cast vehicle ileri impulsu yalnız yan impuls ≠ 0 iken ölçekler; düz
  çizgide patinaj `wheelForwardImpulse`'ta hiç görünmez. İlk uygulamada bu yüzden
  düşük tutuşta da tam motor kuvveti uygulanıyordu. **2026-10-25 düzeltmesi:**
  fizik yüzey profili authored tutuşu azaltıyorsa `limitWheelEngineForce`
  motor kuvvetini adım öncesinde ileri sürtünme sınırına indirir; birleşik yan
  sürtünmeyi Rapier yönetir. `tractionSlip` kırpılmış kuvvetten değil istenen
  motor kuvvetinden hesaplanır; kazma ve efekt böylece kayıp çekişi görür.
  `WheelTrackStamper.stampVehicle` normal damgadan sonra slip > 0 ve
  `digRate` > 0 ise: `current = field.sample(temas)`,
  `cap = maxDepth × min(deformability, 1)`,
  `target = digTargetDepth(current, slip, digRate, dt, cap)`
  (= `current + digRate × slip × dt`, cap'te durur, mevcut daha derin izi asla
  sığlaştırmaz); `target > current` ise yerinde (`from = to`) compaction 1,
  bozulma 255, temas uzunluğu `wheelContactLength(radius, target)` ile basılır.
  Slip 0 ya da `digRate` 0'da alan Faz 2 ile bit-bit aynı. **Plana ek:** alanın
  0,1 mm'lik floor kuantalaması yavaş kazmayı yutuyordu (144 fps'te slip 0,1 ≈
  kare başına 0,56 kuanta → hiç kazmaz); tekerlek başına bir kuantadan küçük
  kalan "carry" sonraki kareye eklenir, temas kesilince / slip bitince sıfırlanır.
- *Uyuyan gövde.* Park edip uyuyan şasi için ray-cast controller tekerlekleri
  güncellemez; `suspensionForce` 0 okunur. İz basma o anda yeni derinlik
  eklemez (max-lerp mevcut izi korur), sink değişimi gövdeyi kendiliğinden
  uyandırmaz; bu yüzden rest length değişince `wakeUp()` şart.
- *Debug.* `?debug`'da `vehicle surface:` satırının hemen ardından
  `vehicle sink: actor:0 | 0.031 m slip 0.00 | …` (`formatVehicleSinkDebug`);
  `vehicle surface:` biçimi değişmedi.
- *Testler.* `tests/engine/wheelSink.test.ts` (slew, sınır, belly drag, slip,
  kazma hedefi, ayak izi); `surfaceResponse.test.ts` "wheel sink rapier:"
  kontrolleri (sabit izde slew'le inip çıkma, şasi sınırı + belly drag, slip
  raporu, çamurda kendi izine oturup sarsılmadan çıkma, duvara dayanmış araç
  düşük tutuşlu çamurda gazda tahrik tekerleklerini 0,096 → ~0,175 m gömer);
  `wheelTracks.test.ts` (slip'li tekerlek daha derin, cap aşılmaz, slip 0 = Faz 2
  birebir, 30/144 fps farkı < 3 mm, slip 0,1'de bile kazar);
  `terrainSurface.test.ts` (formatter); `terrain-surface.spec.ts` smoke'u neutral
  koşuda dört tekerlek 0, mud koşuda dört tekerlek ve en derin > 1 cm
  (ölçülen 0,106 / 0,105 / 0,172 / 0,171 m, arka tahrik akslar kazdığı için derin).
- *Açık kalanlar.* Yok: mesh, berm ve kalite profili aşağıdaki görsel notta,
  yanal iz-tutma (C6) C6 notunda kapandı.

**Faz 3 görsel notu (2026-10-24):**
- *Karar.* Araştırma A5: ayrı patch mesh yerine CDLOD'un kendi alt-seviyeleri
  (kullanıcı onaylı; ayrı S-D1 spike'ı yapılmadı, kapılar testlere bağlandı).
- *Seçim* (`engine/terrain/terrainLod.ts`). `TerrainLodSelector.select(camera,
  visible, detail)`: `TerrainLodDetail` dikdörtgeniyle kesişen level-0 düğüm
  en çok 3 seviye (`TERRAIN_LOD_MAX_DETAIL_LEVELS`; leaf/2, /4, /8) bölünür.
  Bölme yine kamera uzaklığıyla, aralıklar level 0'ın altında da ikiye
  bölünerek (`range0 × 2^level`; morph `terrainLodDetailMorphRange`). Alt-seviye
  düğümleri level-0 atasının yükseklik sınırını alır, iz payı (derinlik
  aralığı + en yüksek berm) kadar genişletilir ve tile slot'u ister. Dikdörtgen
  yoksa seçim bit-bit aynı; level 0'ın morph'u değişmez.
- *Pencere kenarı.* Bölme pencerede durduğu için bir alt-seviye düğüm,
  pencereye değmeyen iki seviye kaba bir level-0 komşuya dayanabilir. Bu kenar
  her zaman bir 1 m grid çizgisi üstünde (orada üçgen yüzey doğrusal) ve
  pencere dışında (iz derinliği 0). Kaba komşu tam o sırada morph ediyorsa
  kiriş küçük bir aralık bırakabilir; alt-seviye düğümler bu yüzden her zaman
  skirt asar. Testler yalnız bu adıma izin verir; pencere içinde fark ≤ 1.
- *Taban.* Tile slot düğümlerinde `forgeTerrainHeight` artık collider'ın b–c
  köşegenli üçgenleriyle (`terrainHeightAt` ile aynı); bilinear karışım testteki
  bükülmüş hücrelerde 5 cm'den fazla sapıyor (K3a: en çok burulma / 4). Global
  harita (uzak düğümler) bilinear kaldı.
- *Yer değiştirme* (`engine/render-three/terrain/terrainDeformation.ts`).
  Üç materyalin de (lit, GTAO normal, DOF depth) vertex shader'ı
  `forgeDeformDisplacement`'ı uygular: kenar sönümlü iz derinliği kadar aşağı,
  berm kadar yukarı. Dünya X/Z'nin saf fonksiyonu olduğu için ortak düğüm
  kenarları buluşur; morph uzaklığı ezilmemiş yükseklikten hesaplanır.
  `textureLod` ile 5 doku okuması/vertex; alan etkin değilken (`uDeformActive`)
  hiç okuma yok.
- *Berm.* Noktanın 0,3 m çevresindeki 4 örneğin ortalaması noktadan
  derinse farkın 0,6'sı kadar kabarma, en çok 6 cm, kenar sönümüyle çarpılır
  (pencere kenarı tam 0). Işık için lit materyal normali berm gradyanına göre
  eğer; gradyan ekran türevlerinden (`dFdx/dFdy`) gelir, üçgen başına sabit.
  Alan ve kayıt değişmedi; fizik bermi görmez.
- *Renderer.* `TerrainRenderer` paylaşılan iz dokusunun penceresini
  (`TerrainDeformationTexture.trackWindow`, değişince `revision`) terrain-local
  koordinata çevirip seçiciye verir; pencere kayınca, takılınca ya da kalkınca
  yeniden seçer. Varsayılan 2 seviye (`DEFAULT_TRACK_DETAIL_LEVELS`).
- *Kalite.* `QualitySettings.terrainTrackDetailLevels` → sayfa genelinde
  `setTerrainTrackDetailLevels` (canlı ve sonradan kurulan renderer'lar).
  Adaptif denetleyici bu ayara dokunmaz. `?debug`: `terrain deformation:`
  satırının altında `terrain detail: nodes N levels L`.
- *Ölçülen.* OffroadTest çamur smoke'unda (2 seviye) 58 alt-seviye düğüm ≈
  120 bin ek üçgen (düğüm başına 2048). Headless yazılım GL'de bu kareyi
  belirgin yavaşlatıyor; smoke bu yüzden low maliyetli custom profil + 2
  seviye kullanıyor. Gerçek GPU süresi ve pop kullanıcı testinde.
  Sabit gaz 4 s: düz zemin 15,9 m/s, çamur (kendi izinde, sink 0,09 m) 11,1 m/s.
- *Testler.* `terrainLod.test.ts` "terrain LOD detail:" (60 kamerada pencere
  içi fark ≤ 1 ve tek izinli kenar adımı, kapalı/uzak pencere = eski seçim,
  3 seviye sınırı, pay, morph); `terrainTrackDetail.test.ts` (tile yüksekliği =
  `terrainHeightAt`, yer değiştirme / berm sınırı / kenarda tam 0, renderer
  detayı açıp kapatır, kalite kancası, üç materyalin enjekte kaynakları);
  `surfaceResponse.test.ts` "on deep mud a steady-throttle car…";
  `terrain-surface.spec.ts` çamurda `terrain detail` levels 2 ve düğüm > 0,
  shader hatasız. GLSL headless çalıştırılamadığı için formüller CPU
  aynalarıyla (`terrainSlotHeight`, `terrainDeformationDisplacement`)
  sabitlendi; smoke derleme hatasını yakalıyor (bilerek bozulan GLSL ile denendi).

**Faz 3 C6 notu — yanal iz-tutma (2026-10-24):**
- *Model.* İz duvarı lastiğin temasını eğer; yükün bir kısmı tekerleği derin
  tarafa iter. Sink provider (`VehicleWheelSink.slope`) iz tabanının aks
  boyunca eğimini döndürür: ayak izinin ±0,35·genişlik'teki iki yan örneğinin
  farkı / aralık (`wheelFootprint`, + taraf `(cos h, −sin h)`). Fizik her
  dilimde temas noktasına `rutLateralImpulse` uygular:
  `RUT_LATERAL_GAIN (0,5) × yük × clamp(eğim, ±RUT_MAX_SLOPE 0,5) × dt`, aks
  boyunca. Kazanç 1 (eğik normalin tam yatay bileşeni) de denendi, davranış
  benzerdi (itişin çoğunu lastiğin yan sürtünmesi karşılıyor); hareketli
  damgaların pürüzlü kenarları eğimde gürültü ürettiği için temkinli 0,5.
- *İleriden okuma (bulgu).* Eğim tekerleğin tam altından okunduğunda her
  tekerlek kendi taze izinde sürekli yan itiş alıyordu: iz 12,5 cm hücrelere
  oturur ve iki hücreden dar bir lastik kendi izini hiçbir zaman simetrik
  görmez (merkezde −0,37 ölçüldü). Bu yüzden eğim yuvarlanan tekerleğin
  önünden okunur (`rutSlopeAhead`): kendi temas uzunluğunun yarısı +
  `RUT_LOOKAHEAD_MARGIN` 0,25 m ileride, o kare basılan iz henüz yoktur;
  orada yalnız önceden var olan iz (kendi eski geçişi, başka araç) bulunur.
  Duran / sürünen tekerlek (< 0,3 m/s, `RUT_STEERING_MIN_SPEED`) itilmez; geri
  giderken arkası okunur. Sorgu tekerlek yarıçapını ve `travel` yönünü taşır.
- *Davranış (Rapier).* İki basılmış izin (0,30 m, 0,10 m) 10 cm yanından
  başlayan araç ize çekilir (0,103 → 0,069 m; lastik izin düz tabanına
  oturunca, ~0,06–0,07 m'de, iki yan örnek de tabanı okur ve itiş biter), iz
  dışına salınmaz; 0,25 direksiyonla izden çıkar (x ≈ −0,58 m); kendi taze
  izinde düz giden aracın çizgisi C6 açık / kapalı aynı (< 5 mm); hiçbir
  tekerlek havalanmaz. Önceki kapalı döngü testleri C6 açıkken de geçiyor.
- *Testler.* `wheelSink.test.ts` (eğim işareti ve dönen aks, impuls yönü /
  sınırı / sıfır durumları), `wheelTracks.test.ts` (ileriden okuma: duran,
  ize varmadan, geri, derin izde uzayan erişim; modül provider'ı),
  `surfaceResponse.test.ts` "rut walls pull an offset car back into its ruts…".
  His ayarı (kazanç, eğim sınırı, ileriden okuma payı) kullanıcı testinde.

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
      emisyon hızı patinaj ve hızla ölçeklenir.
- [x] İsteğe bağlı `wheelSound` (sound / soundCue id): yüzeye göre lastik sesi döngüsü,
      `vehicleModule`'deki motor sesi deseniyle.
- [x] **4A (2026-10-25):** efekt/ses şiddeti fizikteki `tractionSlip`'i kullanır;
      veri yoksa eski dönüş farkı hesabı korunur. Araç yerinde kazarken de
      emisyon vardır; güçsüz duruşta ve havada sıfırdır. Çıkış noktası görünür
      gömülme kadar aşağı alınır; yön şasi dünya dönüşü + direksiyon + ileri/geri
      tekerlek hareketinden hesaplanır. Geç yüklenen emitter son konum/yönü alır.
- [x] **Çamur örneği:** `FX_Mud_Splash.effect.json`, manifest kimliği
      `starter-fx-mud-splash`, `mud.wheelEffect` bağlantısı. Rate 144/s, ömür
      0,375 s, mevcut sprite kapasitesi 58/tekerlek; kalite ve hareket/patinaj
      çarpanları emisyonu azaltır. Sprite runtime artık mevcut `gravityScale`
      alanını uygular; damlacıklar yay çizerek düşer. Yerçekimi 0/yoksa eski
      hareket korunur. Yeni dosya biçimi veya save alanı eklenmedi.
- [x] **Ek kullanıcı isteği — çamur/karda patinaj:** düşük tutuşta ileri kuvvet
      sınırlanır; tahrik tekerleklerinin görünür dönüşüne slew ile sönümlenen
      ek dönüş eklenir. Ek lastik çevre hızı `sign(kuvvet) × slip × 12 m/s`,
      tepki süresi 0,12 s, frenle sönüm 0,04 s. Bu, ayrı tekerlek rigid body'si
      veya bağımsız açısal dinamik çözümü değildir. Gaz torku tutuşu aşınca
      çalışır; her çamur/kar temasında zorunlu patinaj uygulanmaz. Fizik
      surface provider yoksa / nötrse eski hız eğrisi birebir korunur.
- [x] Kar tozu `FX_Snow_Dust.effect.json` örneği ve `snow.wheelEffect` bağlantısı
      (`starter-fx-snow-dust`). Rate 180/s, ömür 0,575 s, kapasite 108/tekerlek;
      hafif yerçekimi, büyüyen gri-mavi toz bulutu. Kar ve çamur parçacıkları
      takip kamerasından okunabilen boyutlara ayarlandı.
- [ ] Çamur/kar döngü sesleri ve `wheelSound` preset bağlantıları.
- [x] LandscapeTest + Gaz52 patinaj/parçacık görünürlüğü: kullanıcı
      "şimdi görünmeye başladı, hem patinaj hem de parçacık" diye doğruladı.
- [ ] Son his ayarı, ses dengesi ve performans ölçümü.

**Video sonrası düzeltme (2026-10-25):** İlk yüksek torklu referans testinin
geçmesi stok Gaz52'de patinajın çalıştığını kanıtlamıyordu. Kullanıcının
18,933 s Bandicam kaydında iz vardı, görünür patinaj/parçacık yoktu. `snow`
efektsizdi; Rapier'in varsayılan `frictionSlip = 2,5` ayarı ileri fiziksel
tutuş olarak kullanıldığında stok motorun aşamayacağı bir sınır çıkıyordu.
Yeni isteğe bağlı preset alanı `vehicle.tractionCoefficient` yük ile çarpılarak
ileri kuvveti sınırlar; yanal Rapier ayarı ayrı kalır. Terrain ve mesh
provider'ları aynı alanı taşır; katman sınırlarında ağırlıklı karışır
(tanımsız katmanın karışım katsayısı 1; tümü tanımsızsa eski davranış).
`mud`: çekiş 0,35 / direnç 0,12; `snow`: çekiş 0,22 / direnç 0,06.
Direnç çekişle dengelendi; araç tam gazda ilerlerken arka tekerlekleri patinaj
yapabilir. Slip talep edilen kuvvet ile gerçek ileri sınırdan hesaplanır;
kazma, görünür dönüş ve efekt aynı sinyali kullanır. Düşen rolling direncinde
vites avlanmasını önlemek için vites sonrası çekiş hesabına hava direnci de
katıldı. Yeni disk/save alanı yok; bu alan da yalnız yerleşik preset verisi.

**Faz 4, güncel bağlantı (2026-10-25):** `wheelEffect` / `wheelSound`, diğer
physical material blokları gibi yalnız preset verisidir; kayıtlar yalnız
`physicalMaterialId` taşır. `mud` ve `snow` kendi efektlerini kullanır.
Diğer presetler sunum asset'i kullanmaz. Yeni yüzey sesleri eklenmedi.
Araç host'unun enjekte edilebilir `surfaceMaterialForWheel` sorgusu terrain
temasında baskın paint katmanının materyalini, diğer collider'larda collider
materyalini çözer. Fiziğin ağırlıklı profil karışımı değişmedi.
Sürülen/possess edilen araçlar ve mevcut dinamik fizik aktif yarıçapı
içindeki diğer araçlar tekerlek başına bir emitter ve bir mekânsal ses döngüsü
kullanır; aktif yarıçap kapalıysa tüm araçlar uygundur. Saf `wheelSurfaceFx`
eğrileri fizik patinajı ve hızla emisyon/ses düzeyini
ölçekler; duruşta ve havada sıfırlanır (yerinde dönen lastik patinaj sayılır).
Yüzey değişimi eski parçacıkları/sesi sönümleyerek durdurur; parçacıkları VFX
runtime kendi havuzuna geri alır. Araç/seviye/modül kapanışı mevcut handle'ları
ve geç yüklenen emitter'ları temizler. Yeni yol sabit durumda konum, girdi ve
sonuç nesnelerini tekrar kullanır.

**Doğrulama (2026-10-25):** `npx.cmd tsc --noEmit`, `npm.cmd run test:engine`
(1.841 kontrol, tam build içindeki engine koşusu) ve `npm.cmd run build:verify`
geçti. `wheel traction rapier` artık **değiştirilmemiş Gaz52 asset'i + collider'ı**
ile iki gerçek preseti 30/60/144 Hz'de doğrular: 3 s gaz sonrası çamurda
11,13 km/h / slip 0,70 / ek lastik hızı 8,40 m/s; karda
7,84 km/h / slip 0,82 / ek lastik hızı 9,86 m/s. Bu ölçüm düz fizik testidir;
iz/kazma olan authored seviye hızı değildir. Diğer testler yüksek torkla iki
gerçek presetin ileri/geri çekişi sınırladığını,
yalnız tahrik tekerleklerinin patinaj yaptığını; düşük tutuşta duvara dayanmış
araçta sıçrama, frenle sönme, tutuşa dönüş ve reset temizliğini doğrular.
Saf spin tepkisi 30/60/144 Hz'de aynı; mevcut GAZ-52 vites avlanması testi ve nötr
zemin birebir hız eğrisi yeşil. `wheelSurfaceFx.test.ts` fizik sinyali,
gömülme/yön, geç yükleme, gerçek çamur/kar asset'leri, düşük yoğunlukta kar
parçacığı ve sprite balistik hareketini kapsar.
`terrain-surface.spec.ts` Chromium'da nötr + çamur + kar koşusuyla geçti
(tek test, 2,8 dk): nötr zeminde sürüş, iki yumuşak zeminde gerçek preset ve
manifest üzerinden slip > 0,15, aktif parçacık ve iz alanı, konsol hatasız.
OffroadTest'in başlangıçtaki derin izi aracı saplayabildiğinden yumuşak zeminde
zorunlu 5 km/sa eşiği yerine güçlü patinaj + canlı parçacık kontrol edilir;
stok aracın ilerleyebildiğini düz fizik testleri ayrıca doğrular.
`tsconfig.smoke.json` tür kontrolü de geçti. Ekran görüntüleri
`test-results/terrain-mud-splash.png` ve `test-results/terrain-snow-splash.png`;
OffroadTest sahnesi çok karanlık olduğundan bu görüntüler görsel kabul değildir. LandscapeTest +
Gaz52 üzerinde patinaj ve parçacık görünürlüğü kullanıcı tarafından
doğrulandı; son his/ses dengesi açık. Yeni yolun CPU/GPU maliyeti ölçülmedi.

### Islak çamur görsel katmanı (2026-10-25)

- [x] `LT Wet Mud` ayrı görsel materyal ve imagegen albedo dokusu. Kuru
      `LT Earth and Scree` yerinde kalır; çamur beşinci paint katmanına atanır.
- [x] Paint > Add Layer (en çok 8): World Terrain'de bütün tile kanalları
      korunarak genişletilir; undo/redo, global harita ve kayıt birlikte güncellenir.
      Bir tile'lık Landscape normalizasyonu ek katmanları korur.
- [x] CDLOD'da 5–8. katmanların dokuları ve bütün katmanların materyal roughness
      değerleri kullanılır. Önceden son dört katman yalnız düz renk çiziliyordu.
- [x] Çamur izi koyulaşır; derin/ıslak iz tabanı pürüzsüz, yatay normal ve
      bakış açısına bağlı su yansıması alır. Environment map yoksa gökyüzü
      yaklaşımı kullanılır. Su ayrı akış/hacim simülasyonu değildir.
- [x] `build:verify` (1.844 engine kontrolü), TypeScript, WebGL su açık/kapalı
      piksel kontrolü ve iki açıdan görsel inceleme; editörde beşinci katman
      ekle/undo/redo/boya/kaydet/yeniden aç ve tüm tile yüksekliklerinin korunması.
- [ ] Stok araç ve authored LandscapeTest üzerinde nihai görsel his kabulü.

Üretilen doku, prompt, kullanım ve sınırlar:
[WET_MUD_VISUAL_2026-10-25.md](../reports/WET_MUD_VISUAL_2026-10-25.md).

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
| İz penceresi alt-seviyeleri (Faz 3) | < 0,5 ms GPU; düşük profilde kapalı |
| Bellek | Alan ~0,5 MB + kaba katman ~0,25 MB |

## Riskler

| Risk | Önlem |
|---|---|
| Rest length değişimi süspansiyonu titretir | Faz 0 kapısı; değişim hızına sınır; ret durumunda görsel gömülme + direnç |
| Patch ile terrain arasında dikiş ya da z-fighting | Üçgen-birebir yükseklik örneği + kapsanan alanda `discard`; test ile sabitlenir |
| Yükseklik sorgusu bilinear kalırsa tekerlek ile iz hizasız olur | **Kapandı:** `terrainHeightAt` üçgen-birebir, Rapier ışınıyla eşitlik testi var (açık dünya Faz 1, K3a) |
| Eski landscape shader'ı yalnız ilk 4 katmanı görüyor (`vec4 landscapeWeight`) | CDLOD materyali 2 × RGBA8 ağırlık dokusuyla 8 katman taşır; fizik 8 katmanın tamamını kullanır |
| Döndürülmüş ya da birden çok landscape | Alan dünya ekseninde tutulur; örnekleme her landscape'in ters dönüşümüyle yapılır |
| Düşük donanım / mobil | Kalite profili: hücre boyutu büyür, iz alt-seviyeleri kapanır, gerekirse yalnız Faz 1 kalır |
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
