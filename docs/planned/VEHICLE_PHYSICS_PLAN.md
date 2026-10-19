# Araç Fiziği Planı (Vehicle Physics)

> Durum: **Faz 0–3 temel kod kapsamı tamam**; Faz 4'te **araca bin/in (4a)**,
> **save-game araç durumu (4b)**, **takip kamerası çarpışma + fareyle bakma
> (4c)**, **RPM → motor sesi (4d)** ve **spline takip eden AI sürücü (4e)**
> tamam; Faz 4 kapandı. Sıradaki büyük adım Faz 5 (editör yüzeyi).
> Faz 0'ın gerçek 60/144 Hz ekran kullanıcı smoke'u hâlâ açık.
> Hedef: Forge'a Unreal Chaos Vehicles benzeri, veri odaklı
> (data-driven) tekerlekli araç desteği — runtime + editör.
>
> Denemek için: editörde Content Browser → `Levels/VehicleTest` → Open Level →
> Play. Seviye `5f4ce2d`'den beri yaya modla (`Script_GameMode`, proje TPS
> modu) geliyor: karakter arabanın sürücü kapısı yanındaki Player Start'ta
> doğar. E ile bin, sür, E ile dur ve in.
> Doğrudan araçla: World Settings → Game Mode → `forge.vehicle`. W/S gaz–fren/geri,
> A/D direksiyon, Space el freni, E aracı tekerleklerine geri oturtur.
> Testler seviyenin authored modundan bağımsız: smoke her testte modu route ile
> seçer, engine testi iki modu da kabul eder.
> AI sürücü: `Levels/VehicleTrack` — oval asfalt spline'da kendi kendine tur
> atan bir AI arabası, ortada oyuncunun arabası ve Player Start (yaya mod).

## Karar: Rapier raycast vehicle + ince "aktarma organları" katmanı

Forge zaten Rapier kullanıyor (`@dimforge/rapier3d-compat`, `engine/physics/`).
Rapier `world.createVehicleController(chassis)` ile bir
`DynamicRayCastVehicleController` veriyor. Bu, PhysX Vehicles ve Chaos Vehicles
ile aynı temel model:

- Şasi tek bir dinamik rigid body; tekerlekler ayrı cisim **değil**.
- Her tekerlekten aşağı bir ışın atılır; süspansiyon yayı/sönümü ve lastik
  sürtünmesi şasiye kuvvet olarak uygulanır.
- Denetleyici: tekerlek başına `engineForce`, `brake`, `steering`,
  süspansiyon (rest length, stiffness, compression/relaxation, max travel,
  max force), `frictionSlip`, `sideFrictionStiffness`.

Rapier'de **olmayan** ve bizim yazacağımız katman (Chaos'un "drivetrain"i):
tork eğrisi (RPM → tork), vites kutusu (oranlar, otomatik vites), diferansiyel
/ çekiş tipi (FWD/RWD/AWD), hıza bağlı direksiyon azaltma, el freni.

Değerlendirilip reddedilenler:

| Seçenek | Neden değil |
|---|---|
| Jolt Physics (WASM) | En sim-zengin seçenek (Chaos'a en yakın) ama ikinci bir fizik dünyası = çift collision verisi, ~1 MB+ ek WASM, iki motor arası etkileşim yok. Ancak "tam simülasyon yarış" bir fork ihtiyacı doğarsa yeniden bakılır. |
| cannon-es `RaycastVehicle` | Saf JS, yavaş, bakımı zayıf; ikinci motor maliyeti yine var. |
| Ammo.js `btRaycastVehicle` | Aynı model, eski API, büyük build. |
| Sıfırdan raycast süspansiyon | Rapier zaten veriyor; tekerlek-zemin sorgusu, collision grupları dahil. |

## İlkeler

1. **Engine generic kalır.** Araç = veri (`*.vehicle.json`) + motor modülü.
   Belirli bir oyunun kuralı (yarış turu, nitro, hasar) `src/game` / fork'ta.
2. **Tek fizik dünyası.** Araç şasisi mevcut Rapier dünyasında, mevcut
   collision preset / kanal sistemiyle yaşar; tekerlek ışınları aynı
   collision filtresini kullanır.
3. **Sabit adım.** Raycast süspansiyon dt değişimine hassastır; araç fiziği
   ancak sabit adımlı dünyada güvenilir (Faz 0).
4. **Editör `?editor` arkasında.** Araç yüzeyleri (`src/editor/`) oyun
   build'ine girmez; `verify:dist --strict` ve `verify:imports` yeşil kalır.
5. **Allowlist disiplini.** Her yeni layout / asset alanı `tools/saveValidator.ts`
   allowlist'ine eklenir (CLAUDE.md "save-validator" kuralları).

---

## Faz 0 — Sabit fizik adımı + render interpolasyonu

**Sorun:** `PhysicsSubsystem.update()` her karede
`rapierWorld.timestep = deltaSeconds` (üst sınır 1/20) ile **tek bir değişken
adım** atıyor. Kare hızı oynadıkça simülasyon farklı davranıyor; süspansiyon
zıplar, yığınlar titrer, sonuçlar makineye göre değişir.

**Çözüm:** Klasik accumulator (Glenn Fiedler, "Fix Your Timestep"):

- [x] `PhysicsSubsystemOptions.fixedTimestep` (varsayılan `1/60`) ve
      `maxSubstepsPerFrame` (varsayılan `4`, "spiral of death" koruması —
      fazlası düşülür, simülasyon yavaşlar ama donmaz).
- [x] `update()` biriken zamanı tüketir: `while (acc >= step) world.step()`.
      Vsync jitter'ı (59.9 Hz, 0.016 s kareler) adım sayısını 0/2 arasında
      zıplatmasın diye küçük bir **snap toleransı** (adımın %5'i) var; artan
      küçük açık bir sonraki karede kapanır.
- [x] **Render interpolasyonu:** her adımdan önce dinamik gövdelerin pozu
      saklanır; transform sink'e `alpha = acc / step` ile önceki↔güncel poz
      arasında lerp (konum) + nlerp (rotasyon) gönderilir. Sink yalnızca render'a
      yazar (`RuntimeSceneApp.applyEntityTransformToRender`), dolayısıyla
      interpolasyon fizik durumuna geri sızmaz. `body.transform` (AABB sensör
      sorguları) gerçek simülasyon pozunu tutar.
- [x] Teleport (`setEntityTransform` → `setTranslation`) ve dünya yeniden
      kurulumu interpolasyon geçmişini sıfırlar — ışınlanan gövde "kaymaz".
- [x] Adım atılmayan karelerde (144 Hz ekran) sink yine çağrılır, alpha
      ilerler → görüntü akıcı.
- [x] Teşhis: `lastFrameStepCount()` ve `interpolationAlpha()` getter'ları.
- [x] Testler: farklı kare hızlarında (30/60/144 Hz) aynı sürede aynı sayıda
      adım; maxSubsteps sınırı; interpolasyon ara pozu; teleport sıfırlaması;
      mevcut rapier testleri yeşil.
- [ ] Kullanıcı smoke: `?debug` ile bir dinamik kutu yığını 60 Hz ve 144 Hz
      ekranda akıcı, titremesiz.

Bilinen sınırlamalar (Faz 0'da bilerek bırakılanlar):

- Kontaklar (`contactsForEntity`) karedeki **son** adımdan okunur; bir kare
  içinde başlayıp biten çok kısa bir temas kaçabilir (önceki davranışla aynı).
- Ragdoll örneklemesi (`sampleRagdoll`) interpolasyonsuz — 60 Hz'de
  güncellenir. Gerekirse sonra aynı geçmiş mekanizmasıyla interpolasyon eklenir.
- Kinematik hedef (`setNextKinematicTranslation`) ilk alt-adımda tüketilir;
  çok adımlı karede karakterin dinamik cisimlere verdiği itme bir adımda
  yoğunlaşır. Karakter hareketi Rapier dışı çözüldüğü için şimdilik sorun değil.

## Faz 1 — Çekirdek araç (kanıt dilimi) ✅

Amaç: Tek bir test seviyesinde bir araç sürülebilsin. Plandan sapma: araç
kodda değil, ilk günden **actor sınıfındaki `Vehicle` component'iyle** tanımlı
(Unreal'ın `ChaosVehicleMovementComponent` deseni) — Faz 2'nin yarısı erkenden
geldi.

### 1a — motor (`3781ed6`)

- [x] `engine/physics/vehicle/vehicleTypes.ts`: SI birimli `VehicleDefinition`
      / `VehicleWheelDefinition`, `resolveVehicleDefinition` (varsayılan +
      sınırlama), referans arka itişli araba, girdi/durum tipleri. Eksen
      kuralı: +Y yukarı, +Z ileri, aracın sağı −X.
- [x] `vehicleDrive.ts` (saf): gaz, fren→durunca geri, el freni, yuvarlanma
      direnci, yumuşatılmış direksiyon.
- [x] `PhysicsSubsystem`: `createVehicle` / `removeVehicle` /
      `setVehicleInput` / `vehicleState` / `resetVehicle`; tanımdan kütle +
      ağırlık merkezi + kutu ataleti; her sabit adım öncesi `updateVehicle`;
      fren kuvveti adım başı impulse'a çevrilir; girdi değişimi uyuyan şasiyi
      uyandırır; dünya yeniden kurulunca araç yeniden bağlanır.

### 1b — runtime

- [x] `Vehicle` component (`VEHICLE_COMPONENT`, `ACTOR_COMPONENT_KINDS`):
      props bir `VehicleDefinition` alt kümesi (boş = referans araba);
      fizik alt sistemi component'li entity'yi kendiliğinden araç yapar.
- [x] Girdi: yeni action yerine mevcut sözlük — `move-forward/back` pedal,
      `move-left/right` direksiyon, `jump` el freni, `interact` (E) reset.
- [x] `forge.vehicle` Game Mode (`src/game/gameModes/vehicleGameMode.ts`):
      ilk `Vehicle` aktörünü possess eder (fizik geç gelirse geç possess),
      UI modunda nötr girdi, takip kamerası (yön takibi + hıza bağlı FOV),
      E ile dik reset. Sözleşme: `GameModeContext.vehicles`, pawn türü
      `vehicle`, possess `first-vehicle`.
- [x] `vehicle` capability modülü: süspansiyon ışını başına tekerlek mesh'i
      (yay boyu, direksiyon, dönüş); aktörün ölçeğini telafi eder; modül
      kapalıyken araç yine sürülür (I3).
- [x] Shell: `vehicleHostService`; `transformForEntity` simüle edilen
      aktörlerde fizik pozunu okur (kalite odağı / save state artık spawn
      noktasında takılmaz).
- [x] İçerik: `Gameplay/Script_ReferenceCar.actor.json` (pivotu altta olan
      `shape-cube` gövde, collider `center` ile hizalı, tekerlekler component'te)
      + `Levels/VehicleTest.level.json` (zemin, rampa + plato, bordür, sütunlar).
- [x] Testler: 8 Rapier (dinlenme, sürüş, dönüş, fren/geri, rampada el freni,
      rebuild) + component/actor dosyası entegrasyonu + 8 runtime (saf
      yardımcılar, oturum, tekerlek modülü) + tarayıcı smoke'u
      `tests/smoke/vehicle.spec.ts` (possess, W ile >20 km/h, S ile geri).
- [ ] `?debug` wire: süspansiyon ışınları, temas noktaları → Faz 5'e taşındı.

## Faz 2 — Veri: `*.vehicle.json` asset ✅

- [x] Manifest `assetType: "vehicle"` (`engine/assets/manifest.ts`), uzantıdan
      tür çıkarımı ve import kaydı. Referans araba asset'i manifest'te kayıtlı.
- [x] `normalizeVehicleDefinition` (runtime normalizer, tek doğruluk kaynağı —
      effect asset'indeki `normalizeEffectDefinition` deseni);
      `vehicleDefinitionFromComponent` bunun üstüne oturur.
- [x] `Vehicle` component'ine `asset` prop'u (`*.vehicle.json` yolu); inline
      props asset'in üstüne override olarak uygulanır.
- [x] `/__save-vehicle` + `validateSaveVehiclePayload` →
      `tools/saveValidator.ts` (**4. allowlist yüzeyi**; CLAUDE.md'ye eklenir).
- [x] `/__save-actor` yolunun `Vehicle` component props'unu düşürmediğini
      doğrulayan test (actor sınıfı editörde kaydedilince tekerlekler kalmalı).
- [ ] Opsiyonel araç hızını save-game'e yazma **Faz 4'e bırakıldı**; bu dilim
      araç tanımı/yükleme/kaydetme içindir. Save-game şimdilik yalnız pozu tutar.

Uygulama sözleşmesi:

- Asset gövdesi `{ "schema": 1, "type": "vehicle", ...VehicleDefinition }`.
  Eksik alanlar referans araba varsayılanlarından tamamlanır; bilinmeyen alanlar
  kayıtta `dropped[]` ile raporlanır. Geçersiz sürüm/tür kaydedilmez.
- `src/scene/vehicleAssetLoader.ts` statik dosyayı okur, aynı asset'e paralel
  okumaları tek istekte toplar. Runtime actor sınıfı çözümlemesinde çalışır;
  yerleştirilen/default pawn/spawn edilen actor yolları aynı çözümlemeyi kullanır.
- Inline sayısal ayarlar asset'i ezer; geçerli inline `wheels` listesi tüm
  tekerlek listesini değiştirir. Boş/geçersiz liste taban tekerlekleri korur.
  Eksik/bozuk asset uyarı verir ve inline/referans araba ayarlarına düşer.
- Actor dosyası genişletilmez: çözülmüş ayarlar yalnız runtime kopyasına yazılır.
  `Script_ReferenceCar.actor.json` artık `Gameplay/ReferenceCar.vehicle.json`
  asset'ini kullanır. Component props örneği:

```json
{
  "asset": "assets/starter-content/Gameplay/ReferenceCar.vehicle.json",
  "massKg": 950
}
```

Doğrulama (2026-10-18): TypeScript kontrolü; tam engine paketi **1168 kontrol**;
araç Playwright smoke'u **3 test** (asset'ten sürüş/fren/geri, endpoint ile gerçek
kayıt/tekrar okuma/geçersiz kayıt reddi, asset motor kuvveti + inline önceliği).
`build:verify` geçti: import sınırları, TypeScript + üretim build'i, slow engine
paketi (1168 kontrol), `verify:dist --strict` (editör kodu runtime paketine sızmıyor).
`check:assets`: 0 hata, 873 uyarı (thumbnail ve kayıt dışı dosyalar).
Codex Security taraması çalıştırılmadı; yeni endpoint için dar kapsamlı diff
incelemesi önerildi.

## Faz 3 — Aktarma organları (drivetrain) ✅

- [x] Motor: tork eğrisi (RPM → Nm, birkaç nokta + lineer interpolasyon),
      idle / max RPM, motor freni.
- [x] Vites kutusu: ileri oranlar, geri, final drive, otomatik vites
      (yukarı/aşağı RPM eşikleri), vites geçiş süresi.
- [x] Diferansiyel: FWD / RWD / AWD (ön/arka tork paylaşımı).
- [x] Tekerlek torku → `engineForce` (tork / yarıçap), sürüş tekerlekleri
      arası paylaşım.
- [x] Hıza bağlı direksiyon açısı eğrisi, el freninde arka yanal sürtünme
      düşüşü (drift).
- [x] Aerodinamik sürükleme + downforce (basit `F = k·v²`).
- [ ] Opsiyonel anti-roll bar: bu dilimde uygulanmadı; ayrı sürüş ayarı dilimine bırakıldı.
- [x] Saf fonksiyon testleri (tork eğrisi, vites seçimi) + Rapier entegrasyon
      testi (0–100 süresi tanımlı aralıkta).

Uygulama sözleşmesi:

- `engine/physics/vehicle/vehicleDrivetrain.ts`: saf tork örnekleme, otomatik
  vites/histerezis, vites geçişinde güç kesilmesi, aks bazında tork paylaşımı ve
  aerodinamik kuvvetler. `PhysicsSubsystem` sabit adım başına uygular; reset,
  RPM/vitesi de başlangıç durumuna alır.
- Asset'te isteğe bağlı `drivetrain.engine` (`idleRpm`, `maxRpm`, `torqueCurve`,
  `engineBrakeTorqueNm`), `drivetrain.transmission` (`forwardRatios`,
  `reverseRatio`, `finalDriveRatio`, `efficiency`, `upshiftRpm`, `downshiftRpm`,
  `shiftDurationSeconds`) ve `drivetrain.differential` (`driveType`,
  `frontTorqueShare`) blokları vardır. Referans araba bunları kullanır.
- `drivetrain` eksik/null ise eski sabit kuvvet modeli korunur. Tork modunda
  `maxEngineForce` / `maxReverseForce` toplam tekerlek kuvvetinin üst sınırıdır.
  Inline iç bloklar alan bazında asset'i ezer; eğriler/oran listeleri değiştirilir.
  Runtime ve save aynı normalizer'ı kullanır; yeni alanlar kayıtta korunur.
- Tekerlek `axle` alanı `front`/`rear`; yoksa yerel Z'den çıkarılır. Diferansiyel
  torku bu akslara dağıtır; eski `drive` bayrağı yalnız sabit kuvvet modunda
  kullanılır. AWD'de ön pay `frontTorqueShare`, arka pay `1 - frontTorqueShare`.
  Her tekerlekte kuvvet = payına düşen tork / kendi yarıçapı.
- `steeringSpeedCurve`: `{ speedMps, scale }` noktaları; hızın mutlak değerine
  göre maksimum direksiyon açısını azaltır. `handbrakeSideFrictionMultiplier`
  el freni tekerleklerinin yanal sertliğini ölçekler; bırakınca eski tutuş döner.
- `aerodynamics.dragCoefficient` hız vektörüne ters sürükleme;
  `downforceCoefficient` yatay hızın karesiyle dünya -Y yönünde basma üretir.
  Katsayılar kg/m, kuvvet newton; sabit adımda tek seferlik impulse uygulanır.
- `VehicleState.drivetrain` RPM, vites ve kalan geçiş süresini verir.
  `?debug` satırına `gear`, `rpm`, `shift` eklendi. RPM modeli boyuna şasi hızı /
  tekerlek yarıçapı ile bağlıdır; kalkışta idle sınırı basit debriyaj kaymasını
  temsil eder. Bağımsız boşta devir, debriyaj ataleti ve lastik kayması modeli yoktur.
- Araç smoke'u bağımsız çalıştırılabilir:
  `npm.cmd run smoke:browser -- --config playwright.vehicle.config.ts`.
  Bu config ortak suite'in seviye/landscape dosyalarını değiştiren fixture'larını
  kullanmaz; araç testleri seviyeyi istek üzerinde seçer.

Doğrulama (2026-10-18): `npx.cmd tsc --noEmit`, `npm.cmd run test:engine`
(**1181 kontrol**) ve `npm.cmd run build:verify` (import sınırları, üretim build'i,
slow engine paketi, strict dist) geçti. Araç Chromium smoke'u **4/4** geçti:
sürüş/fren/geri, yeni alanlarla gerçek kayıt/okuma, inline önceliği ve
RPM/ikinci vites/geri vites/reset. Referans araba düz zeminde 30/60/144 FPS'de
0–100 km/sa için yaklaşık **13,3 s** verdi (test kabul aralığı 6–14 s,
FPS'ler arasında <0,05 s). Rapier testleri sürüklemenin hızı azaltmasını ve
downforce'un süspansiyonu sıkıştırmasını da doğruluyor.
`check:assets`: **0 hata, 873 uyarı**. Codex Security diff incelemesi önerildi;
tarama çalıştırılmadı. Opsiyonel anti-roll ve insan tarafından sürüş hissi
ayarı bu doğrulamanın dışında.

### Referans araç görseli — Kenney Sedan Sports (2026-10-18)

- Kutunun yerini `kenney-sedan-sports` manifest asset'i aldı:
  `assets/kenney-car-kit/sedan-sports.glb`; model, harici `Textures/colormap.png`,
  thumbnail ve paketin CC0 `License.txt` dosyası projeye kopyalandı.
- Mesh ölçeği 1,6; gövde collider'ı `[2.08, 1.52, 4.08]`, merkez
  `[0, 1, -0.04]`. Tekerlek yarıçapı 0,48 m, aks merkezleri X = ±0,68,
  Z = ±1,056; süspansiyon üst noktası Y = 0,83. Ağırlık merkezi Y = 0,45.
  Final drive, yeni yarıçapla aynı tork/hız oranını korumak için 4,690285714.
- `VehicleWheelDefinition.visualNode` / wheel state'teki eş alan, GLB'deki
  `wheel-front-left/right` ve `wheel-back-left/right` düğümlerini bağlar.
  `vehicleModule` gerçek model parçalarını merkezlenmiş fizik pivotlarına taşır;
  direksiyon/dönüş/süspansiyonu uygular ve unload'da özgün hiyerarşiyi geri kurar.
  Geometri/materyalleri dispose etmez; bunlar model yükleyicisine aittir.
  `visualNode` olmayan araçlar önceki prosedürel tekerlekleri kullanır.
- Alan runtime/save ortak normalizer'ında korunur. Tarayıcı testi canlı sahnede
  6 mesh (gövde, spoiler, dört özgün tekerlek), yüklenmiş doku, ön aks direksiyonu
  ve tekerlek dönüşünü doğrular; ek prosedürel lastik üretilmez.
- 0–100 testi artık referans actor'ün gerçek collider'ını kullanır; önceki genel
  kutu fixture'ıyla yapılan ölçümle doğrudan karşılaştırılmaz. Güncel sonuçlar
  30/60/144 FPS'de **7,033 / 7,017 / 7,021 s**, mevcut 6–14 s aralığında.
- Doğrulama: TypeScript, tam engine **1182 kontrol**, `build:verify`, araç
  Chromium smoke'u **5 test** geçti. Asset sağlık kontrolü **0 hata, 873 uyarı**.
  Yeni kayıt alanı ve görsel kontrolü ayrıca hedefli çalıştırıldı.
- Görsel sınır: mevcut `VehicleTest` atmosfer/ışığında sahnenin geneli çok koyu
  göründü. Renk/doku ayrıca test sırasında düz aydınlatma ve üç çeyrek kamera
  görünümünde kontrol edildi; bu kontrol authored seviye dosyasını değiştirmez.
  Kanıt: `test-results/vehicle-Kenney-sedan-uses--1cf4b--four-animated-model-wheels-chromium/`
  altındaki `kenney-sedan-parked.png`, `kenney-sedan-driving.png`,
  `kenney-sedan-lit-preview.png`. Codex Security diff incelemesi önerildi;
  tarama çalıştırılmadı.

## Faz 4 — Oynanış entegrasyonu

- [x] `vehicleModule.ts` capability modülü ve possess edilebilir araç pawn'ı
      (Faz 1b'de geldi).
- [x] **4a — Karakter araca bin / in** (enter/exit noktası, karakter gizlenir,
      TPS ↔ araç possess geçişi).
- [x] **4b — Save-game:** seviyedeki tüm araçların pozu/hızı/el freni/vitesi ve
      "araçta mı" durumu; yüklemede oyuncu sürdüğü araca geri oturur.
- [x] **4c — Kamera:** spring arm çarpışması (kamera duvar arkasına girmesin),
      fareyle etrafına bakma.
- [x] **4d — Ses kancası:** RPM → motor ses cue pitch'i (audio modülü üzerinden).
- [x] **4e — AI:** basit spline takip eden araç sürücüsü (nav/Target Point takibi
      kapsam dışı bırakıldı).

### 4a — araca bin / in ✅

- `VehicleDriver` (`src/game/gameModes/vehicleDriver.ts`): pedal eşlemesi, takip
  kamerası, dik reset ve `?debug` satırı tek yerde. `forge.vehicle` ve TPS aynı
  sürücüyü kullanır; kamera artık `PlayerCameraManager` üzerinden gider, böylece
  yaya ↔ araç geçişinde görüş hedefi 0,25 s harmanlanır.
- Saf kurallar `vehicleEntry.ts`: erişim yarıçapı (yatay 3,5 m, en yakın araç),
  iniş noktaları sırası sürücü kapısı (yerel +X) → yolcu kapısı (−X) → arka;
  yalnız aracın yaw'ı izlenir (yan yatmış araçtan da yere inilir). Statik
  engel AABB'leriyle dolu nokta atlanır; hepsi doluysa sürücü kapısı.
  Yer yüksekliği en alçak teker temasından, temas yoksa şasi kökünden.
- `TpsCharacterSession` (dolayısıyla proje Game Mode'ları da): yayayken E,
  erişimdeki araca biner — karakter gizlenir, çarpışması kapanır, controller
  aracı possess eder. Araçtayken E: araç `maxExitSpeed`'in (2 m/s) üstündeyse
  önce gidiş yönüne karşı fren + el freni, yavaşlayınca iner. Araç el freninde
  park eder; karakter kapı noktasına ışınlanır, aracın baktığı yöne döner,
  kamera arkasına geçer. Araç yok olursa karakter bindiği yerde görünür olur.
  Ragdoll istekleri sürüş sırasında bekletilir. `vehicleEntry: null` ile kapanır.
- `GameModeContext` isteğe bağlı köprüleri: `setEntityHidden`,
  `setEntityCollisionEnabled`, `teleportCharacter` (shell'de çözücü + davranış
  katmanından ışınlama; save-game yüklemesi de aynı yolu kullanır). Çarpışması
  kapalı karakter diğer karakterlerin hareket engeli listesinden düşer.
- `VehicleTest` seviyesine sürücü kapısı yanında bir Player Start eklendi
  (`forge.vehicle` modunu etkilemez).
- Testler: `tests/engine/vehicleEntry.test.ts` (8 kontrol: erişim, kapı sırası,
  engel/zemin, zemin yüksekliği, durdurma pedalı, bin–sür–fren–in döngüsü, araç
  kaybolması + dispose, UI modu / kapatma). Tarayıcı smoke'u: proje Game Mode'u
  ile E → `vehicle-chase` → W ile >15 km/sa → E → yaya possess → W ile yürüme.
- Bilinen sınırlar: binme/inme animasyonu yok (anında); kapı tanımı asset'te
  değil sabit ofset; ters dönmüş araç TPS'te düzeltilemez (yalnız `forge.vehicle`
  modunda E reset); `reverseSpeedThreshold` 2 m/s'den büyük bir araçta durdurma
  pedalı fren yerine geri vitese düşebilir.

### 4b — save-game araç durumu ✅

- Payload (`engine/persistence/saveGameState.ts`, şema 1'de **eklemeli** alanlar):
  `vehicles[]` — seviyedeki **her** canlı araç için `entityId`, `position`,
  `rotation` (Euler derece, `TransformComponent` kuralı), `linearVelocity`
  (m/s), `angularVelocity` (rad/s), `handbrake`, `drivetrain` (`gear`,
  `engineRpm` ya da null) — ve `drivingVehicleId` (yayadan binilmiş araç; yayada
  ve aracın kendisi pawn olan `forge.vehicle`'da null). Yalnız sürülen değil tüm
  araçlar yazılır: seviyenin öbür ucuna park edilmiş araba yüklemede orada kalır.
- `player` alanı değişmedi: araçtayken pawn araç olduğundan arabanın pozu. Bu,
  araç yüklemede yoksa karakterin ayağa kalktığı nokta.
- Doğrulama yüklemede: bozuk araç girdisi yalnız o aracın pozunu kaybettirir,
  yüklemeyi değil; aynı id'de ilk geçerli girdi kazanır; vites `-1` ya da `≥1`
  tam sayı olmalı. 4b öncesi kayıtlar `vehicles: []`, `drivingVehicleId: null`
  ile yaya yüklenir.
- `PhysicsSubsystem.vehicleMotion(id)` (hız, el freni, vites/RPM okuma) ve
  `restoreVehicle(id, transform, motion)`: `resetVehicle` + hızlar + el freni
  girdisi + vites. Tanımda olmayan vites (ya da drivetrain'siz araç) sıfır
  vites kutusuna düşer; RPM motor aralığına kırpılır; vites geçişi sıfırlanır.
- Shell sırası: kalıcı state → araçlar (mevcut ölçek korunur) → oyuncu pozu →
  araca oturma. Pawn'ı araç olan modda oyuncu pozu atlanır (araç listesinden
  geldi); araç listesi olmayan eski kayıtta o araç kayıtlı noktaya durağan konur.
- `GameModeSession` isteğe bağlı `drivingVehicleId` ve `boardVehicle(id)`:
  `TpsCharacterSession` erişim kontrolü / E basışı olmadan biner. Oturamazsa
  (araç yok, binme kapalı) uyarı verilir ve karakter `player` pozunda yaya kalır.
- Testler: payload round-trip + bozuk girdi/eski kayıt (engine); Rapier'de
  hızlanan araç anlık görüntüsü yeni dünyaya hız/vites/poz ile geri yüklenir ve
  yuvarlanmaya devam eder, geçersiz vites/RPM kırpma, el freni; TPS
  `boardVehicle`. Tarayıcı smoke'u: TPS'te bin → >25 km/sa → pause menü quick
  save → quick load → `actor:0` possess, hâlâ >5 km/sa, E ile kaydedilen yerin
  yanında in.
- Bilinen sınırlar: araç dışındaki dinamik gövdeler (kutular) hâlâ kayda
  girmez; direksiyon açısı ve süspansiyon sıkışması kaydedilmez (ilk adımda
  oturur); runtime'da spawn edilen araçların id'si yeni oturumda eşleşmezse
  atlanır (uyarı).
- Doğrulama (2026-10-19): `tsc`, tam engine **1193 kontrol**, `build:verify`
  geçti; araç Chromium smoke'u **7/7**.

### 4c — takip kamerası: çarpışma + fareyle bakma ✅

- Takip kamerası artık bir spring arm: kol, bakış hedefinden (araç kökü +
  `lookHeight`) kamera noktasına uzanır. Saf matematik `vehicleCameraControl.ts`:
  `chaseCameraOrbitPosition` (ortalanmışken eski `chaseCameraPosition` ile
  birebir aynı), `clampChaseOrbit`, `recenterChaseOrbit`, `stepChaseArmFraction`.
- **Fareyle bakma:** fare / `look-x`/`look-y` eksenleri aracın arkasına göre bir
  yörünge açısı (yaw + pitch) çevirir; yükseklik −5°..60° bandında, yaw
  (−π, π]'ye sarılır (birkaç tur dönen bakış kısa yoldan geri döner). Girdi
  `RuntimePlayerController.consumeLookInput` / `applyLook` ile okunur; hassasiyet
  ve Y ters çevirme controller tanımından gelir. `forge.vehicle` sağ tuşla
  sürükleyerek, TPS içindeki sürücü pointer-lock fareyle bakar. TPS'te
  araçtayken fare girdisi yaya control rotation'ını çevirmez; inişte bakış yine
  aracın baktığı yöne döner.
- **Geri dönme:** fare `lookRecenterDelay` (1,5 s) boyunca bırakılırsa ve araç
  `lookRecenterMinSpeed`'in (1 m/s) üstündeyse yörünge `lookRecenterRate` (2,5/s)
  ile arkaya döner. Park hâlindeki araçta oyuncunun seçtiği bakış kalır.
- **Çarpışma:** `GameModeContext.traceCamera(from, to)` → `PhysicsSubsystem.traceCamera`:
  Rapier ışını yalnız **sabit (fixed)** collider'lara; dinamik/kinematik
  gövdeler (aracın kendi şasisi, kutular, karakterler, hareketli platformlar),
  sensörler, `setEntityCollisionEnabled` ile kapatılanlar ve profili `camera`
  trace kanalını **ignore** eden collider'lar geçirilir (Unreal Camera channel).
  Bu kanal yanıtı yeni türetilmiş `ColliderComponent.ignoreCameraTrace` alanıyla
  layout placement / blocking volume profilinden taşınır (authored alan değil;
  allowlist değişmedi). Rapier yoksa `null`: AABB engelleri döndürülmüş rampada
  kamerayı sürekli içeri çekerdi.
- Kol bir engelde **aynı karede** içeri girer (duvarla arasında
  `collisionPadding` 0,3 m), görüş açılınca `collisionRecoverRate` (4/s) ile
  yumuşakça uzar. Çarpışma yumuşatılmış kamera noktasına çıkışta uygulanır;
  takip yumuşatmasına geri beslenmez.
- `?debug` `camera:` satırına ` arm:<0..1> look:<derece>` eklendi (mevcut
  `pawn:`/`speed:`/`gear:` okuyucuları etkilenmez).
- Testler: saf yörünge/sınır/sarma, geri dönme koşulları, kol adımı; oturumda
  sürükle → yan görüş, sürüşte arkaya dönüş, duvarda anında içeri + yumuşak
  dışarı; TPS'te fare yaya bakışını çevirmez; Rapier `traceCamera` (duvar
  mesafesi, ignore cam, dinamik kutu, sensör, sıfır boy, çalışma anında kapatma,
  Rapier'siz null); layout `responses.camera: "ignore"` → `ignoreCameraTrace`.
  Tarayıcı smoke'u: arabanın arkasına route ile duvar → `arm < 0,7`; sağ tuşla
  sürükle → `look > 30°`, kol duvardan kurtulup `> 0,95`.
- Bilinen sınırlar: ışın ince (küre süpürme yok) — sıyırarak geçen açılarda
  kamera duvara 0,3 m'den yakın görünebilir; çok dar yerde kol aracın gövdesi
  içine kadar kısalabilir (pivot gövde içinde); hareketli platformlar kamerayı
  durdurmaz; geri giderken kamera öne dönmez.
- Doğrulama (2026-10-19): `tsc`, tam engine **1199 kontrol**, `build:verify`
  geçti; araç Chromium smoke'u **8/8**.

### 4d — motor sesi ✅

- Veri: araç asset'inde / `Vehicle` component'inde isteğe bağlı `engineSound`
  bloğu — `sound` (manifest `sound` ya da `soundCue` id'si), `idlePitch` /
  `maxPitch` (0,1..4), `idleVolume` / `loadVolume` (0..1), `speedForMaxPitch`
  (drivetrain'siz araçta RPM yerine hız, m/s), `refDistance` / `maxDistance`.
  Runtime ve `/__save-vehicle` aynı `normalizeVehicleDefinition`'ı kullanır;
  inline alanlar asset'i tek tek ezer, `engineSound: null` sesi kapatır,
  kullanılabilir `sound` id'si yoksa (ve miras alınacak yoksa) ses yoktur.
- Referans araba: `starter-snd-engine-loop`
  (`Sounds/S_Engine_Loop.wav`, 2 s, 22,05 kHz mono, ~88 KB). **Sentezlenmiş yer
  tutucu**: 4 silindir / 900 RPM ≈ 30 Hz ateşleme darbeleri dairesel toplanır,
  dikişsiz döngü. Kenney Sci-Fi Sounds'daki `engineCircular_*` sabit döngü
  değil (seviyesi dalgalanan süpürmeler, dikişte sıçrama), `spaceEngineLarge`
  ise 27 Hz'lik uğultu — o yüzden kullanılmadı. Fork gerçek kaydını koyar.
- Fizik: `VehicleState.engineLoad` (0..1) = o adımda arabayı **süren** pedal
  (ileri gaz ya da geri vitesteki fren); frenleyen pedal, boşta kayma ve vites
  geçişinin güç kesimi 0. Kuvvet/üst sınır oranı yerine pedal: yüksek viteste
  tork düştüğü için oran tam gazda bile sesi kısardı.
- `vehicleEngineSound.ts` (saf): pitch = idle→max, devir oranıyla
  (`(rpm - idle) / (max - idle)`, drivetrain'siz `|hız| / speedForMaxPitch`);
  ses = idle→load, `max(yük, devir × 0,5)` ağırlığıyla (gazsız yüksek devir —
  motor freni — yine duyulur). Aralık dışı RPM kırpılır.
- Audio: `AudioPlaybackHandle.setPosition` (spatial çalmanın panner'ını taşır;
  spatial olmayan çalmada no-op) ve `AudioCommands.playLoop(sourceId, options)`:
  hemen kullanılabilen yönlendirilebilir döngü. Ham ses anında bağlanır; cue
  yüklenince ilk play olayını döngüye alır (cue'nun volume/pitch'i çarpan, bus'ı
  cue'nunki) ve o ana kadar ayarlanan son değerleri uygular. Çalamayan kaynak
  "stopped" okunur.
- `vehicle` capability modülü: **sürülen** (`VehicleHost.isDriven` — şimdilik
  oyuncunun possess ettiği pawn) ve `engineSound`'u olan araç için tek bir
  spatial, döngülü ses (`sfx` bus); her kare pitch, 0,08 s rampalı volume ve
  aracın konumu. Sürücü inince 0,5 s'de söner; level kapanınca susar. Ses
  katmanının reddettiği ses (voice bütçesi, eksik kaynak) her kare yeniden
  istenmez; araca yeniden binince taze başlar. Audio modülü kapalıysa araç
  sessizdir, sürüş etkilenmez.
- Testler: normalizer (kayıt round-trip, inline override, null, kırpma, referans
  asset + manifest kaydı), saf ses seviyeleri, pedal yükü (fren/geri/vites
  kesimi), Rapier tam gazda `engineLoad = 1`, `playLoop` (ham ses, yüklenmeden
  yönlendirilen cue, bozuk cue, yüklenmeden durdurma), araç modülü ses yaşam
  döngüsü. Tarayıcı smoke'u gerçek Web Audio düğümünü izler: park hâlinde ses
  yok → E ile binince 2 s'lik döngü rölantide (rate ≈ 1) → W ile rate > 1,3 →
  E ile inince `stop`; tüm sürüş boyunca tek ses.
- Bilinen sınırlar: tek katmanlı motor sesi (Unreal'daki RPM'e göre çapraz
  geçişli çok katmanlı ses yok); park hâlindeki ya da AI'nın sürdüğü araçlar
  sessiz (AI sürücü gelince `isDriven` genişler); kulakla ayar yapılmadı —
  yer tutucu sesin ve eğrinin dinlenip ayarlanması kullanıcı smoke'u.
- Doğrulama (2026-10-19): `tsc`, tam engine **1204 kontrol**, `build:verify`
  geçti; araç Chromium smoke'u **9/9**; `check:assets` 0 hata.

### 4e — spline takip eden AI sürücü ✅

- `VehicleAiDriver` component (`ACTOR_COMPONENT_KINDS`): `splineId`, `entry`
  (`nearest`/`start`), `wrapMode` (`loop`/`clamp`; yoksa kapalı spline tur atar,
  açık spline sonunda durur), `targetSpeed` (m/s, 0..100, varsayılan 12),
  `lookAheadDistance` (m, 1..50, varsayılan 5), `enabled`. Props düz JSON olarak
  actor'den entity'ye akar; ek allowlist yüzeyi yok.
- Spline id seviyeye ait: yeniden kullanılan sınıf (`Script_AiReferenceCar`)
  `splineId` bırakmaz; yerleştirmenin mevcut `patrolRoute` alanı (spline
  kaynağı) bu araca `splineId`, `entry`, `wrapMode` (`pingPong` hariç — karakter
  devriye modu) ve `speed` → `targetSpeed` olarak birleşir
  (`actorInstanceToEntity`). Alan zaten layout'ta kayıtlı/allowlist'te.
- Saf sürücü `engine/physics/vehicle/vehicleRouteDriver.ts`:
  - **Direksiyon:** pure pursuit — `lookAhead + hız × 0,5 s` ilerideki noktaya
    bisiklet modeli açısı, araç dingil mesafesiyle, hıza bağlı direksiyon
    eğrisinin kilidine bölünür.
  - **Hız:** hedef hız; önündeki virajın keskinliğine göre (`90°` virajda %35'e
    kadar) düşer; açık rotada `√(2·a·kalan)` ile sonda durur ve el freninde park
    eder. Pedal: hız açığına orantılı gaz (+küçük ileri besleme); limitin
    üstündeyken fren — yalnız araç belirgin ileri giderken (fren düşük hızda
    geri vites olur).
  - **İlerleme:** son bilinen mesafenin çevresinde kısa bir pencerede (−3 m ..
    max(8 m, hız × 1,5 s)) en yakın nokta; rota kendine yaklaşsa da yanlış
    parçaya atlamaz. Katılış bir kez `getClosestDistanceToPoint` ile.
  - Rapier testi (referans araba, gerçek collider): R=30 dairede 40 s'de
    **1,88 tur**, şeritten en fazla **0,29 m** sapma, hedef hızı aşmıyor; 80 m
    açık düz rotada 12 m/s'ye çıkıp **z ≈ 79,2**'de durup el frenine geçiyor,
    hiç geri gitmiyor.
- `vehicle-ai` capability modülü (`vehicleAiModule.ts`, varsayılan modüllerde):
  `decision` slotunda (karakter AI'ı ile aynı) sürücü başına adım; girdi
  `VehicleHost.setVehicleInput` ile fiziğe — araç asla elle taşınmaz. Oyuncu
  önceliklidir: possess edilen araca dokunulmaz ve oyuncu bir kez sürdü mü AI
  onu bir daha sürmez (Unreal'da possess AI controller'ı bırakır). Spline
  yoksa bekler; modül kapalıysa AI arabaları park eder. Kapsam raporu
  (`capabilityCoverage`) modül kapalıyken authored sürücüleri söyler.
- `VehicleHost` ek alanları: `possessedEntityId`, `setVehicleInput`; `isDriven`
  artık possess **veya** AI sürüyorsa doğru — AI arabasının motor sesi (4d)
  de çalar. `vehicleAiService` (`isDriving`, `drivers()`); `?debug`'da
  `vehicle ai (n)` bloğu: `entity: spline durum d:<m> limit:<m/s>` (durum
  `driving` / `parked` / `released` / `missing-route` / `idle`).
- İçerik: `Gameplay/Script_AiReferenceCar.actor.json` (referans araba +
  `VehicleAiDriver`, hedef 14 m/s) ve `Levels/VehicleTrack.level.json`
  (VehicleTest'in zemin/ışık/ortamı; merkez (0, 15), yarıçaplar 28 × 40 m,
  8 noktalı kapalı `curveAuto` spline `vehicle-track-loop` + `sm-road-asphalt`
  deformMesh yolu, ~215 m tur; oyuncu arabası ortada, AI arabası rotada).
  Manifest'e iki kayıt. Görsel kontrol: GPU'lu headless üstten görünümde yol
  ovali ve rotadaki AI arabası doğru çiziliyor.
- Testler: component okuyucu, `patrolRoute` birleşmesi ve commit'li seviyenin
  kapalı spline'a bağlanması; modül (pedallar, pure pursuit yönü, limit üstünde
  fren, eksik spline, devre dışı sürücü, oyuncu devralınca bırakma, level
  kapanışı); Rapier daire turu + açık rotada durma; varsayılan modül tick
  sırası. Tarayıcı smoke'u: `VehicleTrack`'te AI `driving`, ilerleme 70 m'yi
  geçip tur sonunda başa sarar.
- Bilinen sınırlar: yalnız spline (nav grid / Target Point takibi yok); çarpışma
  kaçınma ve sollama yok (öndeki araca çarpar); takılma kurtarma yok (duvara
  sıkışırsa geri manevra yapmaz); geri giderek sürmez; runtime'da spawn edilen
  AI araçları sürülmez (entity sink yalnız level kurulumunda dolar); sürücü
  durumu ve "oyuncu devraldı" bilgisi save-game'e girmez — yüklemede AI araç
  kaydedilen pozdan en yakın rota noktasına yeniden katılır.
- Doğrulama (2026-10-19): `tsc`, tam engine **1210 kontrol**, `build:verify`
  geçti; araç Chromium smoke'u **10/10**; `check:assets` 0 hata. Ortak smoke
  paketi 41/45: kırılan 4 test (`ai-patrol`, `ai-navigation-clearance` —
  `controllers: 0`; `landscape-spline-chain` — 28 segment / beklenen 3;
  `runtime-checkpoint` — debug paneli Load butonunu örtüyor) bu dilimden
  bağımsız: iki AI testi 4e değişiklikleri stash'liyken de aynı şekilde kırıldı.

## Faz 5 — Editör yüzeyi

- [ ] `?debug` wire: süspansiyon ışınları, temas noktaları (Faz 1'den).
- [ ] Actor Script editöründe `Vehicle` component'i için form (şu an
      component eklenebiliyor ama props'u yalnız JSON'dan düzenleniyor).
- [ ] Add-Actor menüsünde "Vehicle".
- [ ] Details: araç asset seçimi + hızlı ayarlar.
- [ ] Vehicle asset editörü (form tabanlı, VFX Lite deseni): tekerlek listesi,
      süspansiyon, tork eğrisi grafiği, vites tablosu.
- [ ] Viewport: tekerlek bağlantı noktaları gizmo ile sürüklenebilir,
      süspansiyon menzili ve tekerlek yarıçapı wire olarak çizilir.
- [ ] Browser smoke (`npm run smoke:browser`, port 5273): araç yerleştir →
      kaydet → Play → sür.

## Kapsam dışı (şimdilik)

- Motosiklet / iki tekerlek dengesi, palet (tank), uçak/tekne.
- Pacejka gibi gelişmiş lastik modeli, yüzey tipine göre sürtünme (physical
  material entegrasyonu sonra ele alınabilir).
- Ağ senkronizasyonu / deterministik replay.
- Hasar / deformasyon.
