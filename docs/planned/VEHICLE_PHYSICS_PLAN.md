# Araç Fiziği Planı (Vehicle Physics)

> Durum: **Faz 0 sürüyor.** Hedef: Forge'a Unreal Chaos Vehicles benzeri,
> veri odaklı (data-driven) tekerlekli araç desteği — runtime + editör.

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

## Faz 1 — Çekirdek araç (hard-code, kanıt dilimi)

Amaç: Tek bir test seviyesinde, kodda tanımlı bir araç sürülebilsin.

- [ ] `engine/physics/vehicle/vehicleTypes.ts`: `VehicleDefinition`
      (şasi kütlesi, ağırlık merkezi ofseti, tekerlek listesi) ve
      `VehicleWheelDefinition` (bağlantı noktası, yarıçap, süspansiyon rest
      length / stiffness / damping / max travel, `frictionSlip`,
      `sideFrictionStiffness`, `steer` / `drive` / `brake` / `handbrake`
      bayrakları).
- [ ] `PhysicsSubsystem` içinde araç kaydı: `createVehicle(entityId, def)` →
      şasi body'sine `createVehicleController`, tekerlekler `addWheel`.
      `removeEntity` / `rebuildRapierWorld` araçları da temizler.
- [ ] Alt-adım kancası: her `world.step()` öncesi `controller.updateVehicle(step)`
      (Faz 0 döngüsünün içinde). Tekerlek ışınları şasinin kendi
      collider'ını hariç tutar (filter predicate / collision grupları).
- [ ] Girdi → `VehicleInput { throttle, brake, steer, handbrake }` (−1..1),
      `engine/input` action map'ine `Vehicle*` action'ları.
- [ ] Basit sürüş: throttle → sabit `engineForce`, brake → `setWheelBrake`,
      steer → `setWheelSteering` (yumuşatılmış).
- [ ] Görsel: tekerlek mesh'leri `wheelChassisConnectionPoint` +
      `wheelSuspensionLength` + `wheelRotation` + `wheelSteering`'den konumlanır
      (Faz 0 interpolasyonu şasiye uygulanır; tekerlekler şasiye bağlı).
- [ ] `?debug` wire: süspansiyon ışınları, temas noktaları, kuvvet çizgileri.
- [ ] Testler (node, Rapier): araç düz zeminde dinlenir (süspansiyon
      denge yüksekliği), throttle ile ileri gider, steer ile döner, brake ile
      durur, rampada geri kaymaz (el freni).

## Faz 2 — Veri: `*.vehicle.json` asset + layout bağlantısı

- [ ] Manifest `assetType: "vehicle"` (`engine/assets/manifest.ts`).
- [ ] `normalizeVehicleDefinition` (runtime normalizer, tek doğruluk kaynağı —
      effect asset'indeki `normalizeEffectDefinition` deseni).
- [ ] `/__save-vehicle` + `validateSaveVehiclePayload` →
      `tools/saveValidator.ts` (**4. allowlist yüzeyi**; CLAUDE.md'ye eklenir).
- [ ] Placement alanı `vehicleAssetId` (+ gerekirse `wheelMeshAssetId`) →
      `applyTransformFields` allowlist'i; `droppedFields` /
      `serializationDrift` testleri kapsar.
- [ ] `actorInstanceToEntity` / runtime entity: `Vehicle` bileşeni; şasi
      collider'ı mevcut collision preset sisteminden.
- [ ] `RuntimeParity` level'ına bir araç → `game-starter` smoke'u kapsar.

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

- [ ] `src/scene/capabilities/vehicleModule.ts` capability modülü; tick slotu
      `pre-physics` (girdi → araç komutu) + fizik alt-adım kancası.
- [ ] Pawn: araç possess edilebilir; karakter **araca bin / in** (enter/exit
      noktası, karakter gizlenir/bağlanır). Save-game: araç pozu + hız.
- [ ] Kamera: araç takip kamerası (spring arm, hıza bağlı FOV / mesafe).
- [ ] Ses kancası: RPM → motor ses cue pitch'i (audio modülü üzerinden).
- [ ] AI: basit spline / nav takip eden araç sürücüsü (opsiyonel, ayrı dilim).

## Faz 5 — Editör yüzeyi

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
