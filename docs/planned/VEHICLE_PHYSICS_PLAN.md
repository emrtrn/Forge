# Araç Fiziği Planı (Vehicle Physics)

> Durum: **Faz 0, Faz 1 ve Faz 2 kodu tamam**; sırada Faz 3.
> Faz 0'ın gerçek 60/144 Hz ekran kullanıcı smoke'u hâlâ açık.
> Hedef: Forge'a Unreal Chaos Vehicles benzeri, veri odaklı
> (data-driven) tekerlekli araç desteği — runtime + editör.
>
> Denemek için: editörde Content Browser → `Levels/VehicleTest` → Open Level →
> Play. W/S gaz–fren/geri, A/D direksiyon, Space el freni, E aracı tekerleklerine
> geri oturtur.

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

## Faz 3 — Aktarma organları (drivetrain)

- [ ] Motor: tork eğrisi (RPM → Nm, birkaç nokta + lineer interpolasyon),
      idle / max RPM, motor freni.
- [ ] Vites kutusu: ileri oranlar, geri, final drive, otomatik vites
      (yukarı/aşağı RPM eşikleri), vites geçiş süresi.
- [ ] Diferansiyel: FWD / RWD / AWD (ön/arka tork paylaşımı).
- [ ] Tekerlek torku → `engineForce` (tork / yarıçap), sürüş tekerlekleri
      arası paylaşım.
- [ ] Hıza bağlı direksiyon açısı eğrisi, el freninde arka yanal sürtünme
      düşüşü (drift).
- [ ] Aerodinamik sürükleme + downforce (basit `F = k·v²`).
- [ ] Opsiyonel: anti-roll bar (aks başına süspansiyon farkından kuvvet).
- [ ] Saf fonksiyon testleri (tork eğrisi, vites seçimi) + Rapier entegrasyon
      testi (0–100 süresi tanımlı aralıkta).

## Faz 4 — Oynanış entegrasyonu

- [x] `vehicleModule.ts` capability modülü ve possess edilebilir araç pawn'ı
      (Faz 1b'de geldi).
- [ ] Karakter **araca bin / in** (enter/exit noktası, karakter
      gizlenir/bağlanır, TPS ↔ araç possess geçişi). Save-game: araç hızı.
- [ ] Kamera: spring arm çarpışması (kamera duvar arkasına girmesin), fareyle
      etrafına bakma.
- [ ] Ses kancası: RPM → motor ses cue pitch'i (audio modülü üzerinden).
- [ ] AI: basit spline / nav takip eden araç sürücüsü (opsiyonel, ayrı dilim).

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
