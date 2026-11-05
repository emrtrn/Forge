# FORGE — Vehicle Component & Damage Contract

**Dosya:** `FORGE_VEHICLE_COMPONENT_AND_DAMAGE_CONTRACT.md`  
**Sürüm:** v1.11 — tasarım sözleşmesi; motor hattı VM-1…3, kararlı aktör kimliği ve parça arayüzü uygulandı, Doruk K-180 greybox'ı ve hasar parçaları (VC-1…3, VC-5) tamam, cam `R-11` bekler  
**Tarih:** 2026-11-05 (Europe/Istanbul)  
**Kapsam:** Forge genel motor/editör varlık–araç–hasar entegrasyonu; ilk motor denemesi `Gaz-52`; ilk özgün araç `RB-V-001 — Doruk K-180` (`VCD-D15`, 2026-11-05)  
**Durum:** **[MOTOR HATTI TAMAM]**. Kullanıcı §12'deki kapalı kararları ve §11'deki sırayı 2026-11-04'te onayladı. `parts`, `detach` ve `logical` kayıt koddadır (§5, §9); `RB-V-001` hattında VC-1 ve VC-2 kabul edildi, VC-3 ve VC-5 kod tamam, görsel kabul bekliyor.  
**Yetki ayrımı:** Forge genel model, deformasyon, kırılma, kopma, kayıt ve editör altyapısını sağlar. Ridgebound hangi parçanın nasıl hasarlanacağını, eşikleri, onarım/ekonomi/oynanış sonuçlarını belirler. 

**Girdi kaynakları:**
- `DEFORMABLE_FRACTURABLE_WORK_PLAN.md` — 4 Kasım 2026; özellikle §1, §3–§5 Faz 1–5/7/8, §6–§8. Bu belgeye bağlı tarihlendirilmiş uygulama durumu esas alınmıştır.
- `FORGE_OFFROAD_FORGE_TEKNIK_DURUM_RAPORU_2026-10-23.md` — eski referans; GLTF/vehicle/physics altyapısına giriş, 4 Kasım güncelliği olduğu iddia edilmez.
- `RIDGEBOUND_ARAC_KONSEPT_LISTESI_VE_GORSEL_URETIM_PLANI.md` v0.1 — 10 araçlık aday konsept kuyruk; `RB-V` araç ID, `VEH` sanat üretim işi ID.
- `RIDGEBOUND_CONCEPT_DESIGN_INVENTORY.md` — `VEH-01/02/03`; modelleme, parça ayrımı, yük profili.
- `00_RIDGEBOUND_PROJE_YONETIM_KURALLARI.md` §12; `FORGE_WORLD_BUILDER_TASARIM_VE_TEKNIK_PLAN.md` §0.3 — ortak Drive devir ve tasarım/test ayrımı.
- Canlı Forge kodu, `main` @ `731ae7ae` (2026-11-04) — §1 durumları bu commit'e göre yazıldı; kod tarandı, bu sürüm için test çalıştırılmadı. Gaz-52 ölçümleri aynı gün `Terrain` sahnesinde alındı.
- `C:\Users\emret\Downloads\Ridgebound\ConceptDesign\Vehicle` — tek konsept referans klasörü; `RB-V-001` görseli `1-Doruk K-180 Dağ Kamyonu Konsept Panosu.png`.

---

## 0. Yönetici kararı / tek cümlelik sözleşme

**Araç parçası, ana GLB içindeki bağımsız ve kimlikli bir alt düğüm olabilir. Parçanın deformasyonu yalnız ona ait kopyalanmış geometriye uygulanır; kopma gerçekleştiğinde mümkünse _aynı deforme olmuş mesh_ yerel bağından çıkarılır ve kopma anındaki dünya pozu ve kinematik koşullarıyla bağımsız fizik gövdesine bağlanır.**

Bir dosyanın tek GLB olması otomatik olarak ayrı fizik gövdeleri anlamına gelmez. Ayrı mesh/düğüm, bağımsız kırılma/deformasyon, ayrı collider ve kalıcılık **farklı aşamalardır**. Kapsam içinde olan her ayrı davranış veriyle açıkça işaretlenmelidir.

**Kesin ayrım:**
- **Modelleme sözleşmesi:** tek Blender master, ayrıştırılmış mesh/düğümler, kararlı ID ve pivotlar; bir ana araç GLB; gerekirse aynı kaynaktan dışa aktarılan hasar parçaları.
- **Runtime sözleşmesi:** hareketli bütün araç = `vehicle` physics gövdesi; bağlı parçalar kural olarak onun görsel alt düğümleri; kopan parçalar yeni bağımsız dynamic body olur.
- **Hasar sürekliliği:** mevcut göçük, katmanlı hasar, malzeme ve görünür form kopma öncesinden sonrasına taşınır; temiz yedek parça ile anlık değiştirme varsayılan değildir.
- **Kalıcılık sözleşmesi:** hasar/kopma mantıksal durumu ve göçük reçetesi korunur. Kopmuş parçanın uzaydaki fiziksel konumunu kaydetmek ayrıca açık profil gerektirir.

**v0.2 kararları (kullanıcı, 2026-11-04):**
- İlk özgün araç Doruk K-180 (§12 `VCD-D15`, 2026-11-05); "form kalır" kararı (`VCD-D11`) bu araç için geçerlidir.
- Model Forge'da kalabilir; Ridgebound'a taşımak ayrı karardır.
- Temel dokuda kalıcı vuruk olmaz; göçükleri runtime sistemi üretir (§3.1).
- `detach` önce Forge Faz 8 işi olarak **Gaz-52** üzerinde yapılır; özgün araç modellemesi bu işi beklemez ve bu iş de modellemeyi beklemez (§11).

## 1. Uygulanmış ve önerilmiş özelliklerin mevcut durumu

Aşağıdaki durum `main` @ `731ae7ae` koduna göredir. Kod tarandı; "ölçüldü" yazmayan satırlar bu sürümde çalıştırılarak denenmedi.

| Konu | Koddaki durum | Sözleşmeye etkisi |
|---|---|---|
| Rapier impact yüzeyi; `setImpactEventThreshold`, `impacts()`, actor `On Impact` | **Tamam.** Eşik sahip bazlı (`bce53640`) | Çarpışma şiddeti/noktası/normali tüketilebilir; `Deformable` ve `Fracturable` birlikte eşik tutabilir. |
| Voronoi kırılma hazırlığı; statik placement/actor kırılma; dinamik parçalar; support | **Faz 2–4c tamam** | Genel fracture boru hattı var; araç alt düğümünü koparan sistem değil. |
| Kırılma VFX/ses, debris bütçeleri ve hasar durumunun save/load'u | **Faz 4b/5 tamam** | Referans davranış; araç parçası save sözleşmesi yine ayrı gerekir. |
| Metal panel/araç gövdesinde kalıcı vertex göçüğü, `Deformable` | **Faz 7 kod tamam** (`04b1bed8`…`731ae7ae`); görsel kabul kullanıcıda. r187 kapısı kapandı (`48ca7f23`, `6e490998`). **Gaz-52'de ölçüldü** | Göçük ürün kabiliyeti. VM-1 ile sidecar `parts` tanımlayan model parça bazlı göçer (§5, §6.2). Aktörün ayrıca `Deformable` bileşeni taşıması gerekir. |
| `source: imported`, Blender'dan fracture geometrisi | **Faz 8 açık** | Tek GLB'de cam düğümü bulunması camın ayrı kırılmasını garanti etmez. |
| `detach` (kapı/ayna/tampon vb. alt düğümün body olması) | **Var (VM-2, VM-3), Gaz-52'de ölçüldü** | Kapı ve ayna göçüğüyle kopar; kayıp kaydedilir, gevşek parça kaydedilmez (§9). |
| `joint-break` / `swap-mesh` | **Faz 8 açık** | Opsiyonel ileri aşamalar. |
| Tekerlek yön/rotasyon/süspansiyon görsel bağları, raycast vehicle | **Tamam.** `visualNode` → `VehicleWheels`; dent sistemi tekerlekleri dışlar. **Gaz-52'de ölçüldü** | Dört tekerlek ayrı wheel rigid body değildir; tekerlek kopması ayrı tasarımdır. |
| Copy-on-write göçük geometrisi | **Tamam** (`DentTarget`) | Paylaşılan GLB değişmez; mesh ilk göçükte kendi kopyasını alır. |
| Kütle güncelleme yapı taşları | `setAdditionalMassProperties`, `recomputeMassPropertiesFromColliders` var; araçta denenmedi | `VCD-D04` için başlangıç noktası. |
| Göçüğe göre collider güncellemesi | Faz 7 v1 kapsam **dışı**, `visual_only` | Görsel ezilme fizik collider'ı sürekli yeniden şekillendirmez. |

**Kritik kaynak sınırları:** `fractureSourceFromObject(root)` verilen kökün altındaki mesh'leri *birleştirir* ve mevcut çağrılar model kökünü verir. Tek araç GLB'sine tek genel fracture sidecar ekleyerek sadece ön camı hedeflemek **güvenilir değildir**. Faz 7, kırılma sonrasında göçükleri parçalara aktarmaz. Araçta **deformed mesh → detach** sürekliliği bu belgeyle istenen, ayrıca geliştirilecek davranıştır.

**Gaz-52 ölçüm referansı (2026-11-04):** 2500 kg, yaklaşık 22 km/h, kırılan duvara önden çarpma. Eski ayarlarla (`maxDepth 0.12`, `fullImpulse 3000`) 4 cm çökme ve 46 vertex; `maxDepth 0.35`, `fullImpulse 1500`, `radius 0.8` ile 14 cm çökme ve 292 vertex. Göçük iki far mesh'ine de yaklaşık 0,65 cm taştı.

## 2. Terimler, varlık kimliği ve statü

| Terim | Anlam |
|---|---|
| `VehicleAsset` | Oyundaki tek taşıtın görsel ana asset'i ve onu kullanacak vehicle tanımı. |
| `Part` | Kararlı `partId`'si olan, mesh düğüm kümesi ve yerel pivotu tanımlı alt bileşen. |
| `Attachment` | Parçanın araçla ilişkisi: parent, soket/pivot, montaj ve isteğe bağlı dayanıklılık. |
| `Attached` | Parça araç rigid body ile birlikte hareket eder; kendi dynamic body'si yoktur. |
| `Deformed` | Parçanın örneğe özgü görsel vertex geometrisi orijinalden farklıdır. |
| `Detached` | Parça araç hiyerarşisinden ayrılmıştır; kendi dünya pozu ve bağımsız fizik durumu vardır. |
| `Fractured` | Parça tek mesh olarak kalmaz; bir veya çok kırık parça / silinmiş orijinal kaynak vardır. |
| `Part instance` | Örneğe özgü hasar, geometri, bağlılık ve fizik state sahibi; cache'teki paylaşılmış source asset değildir. |
| `Deformation recipe` | Başlangıç mesh'i + sürüm/sabit kaynak kimliği üstüne tekrarlanabilir dent kayıtları. |
| `Collision proxy` | Fizik gövdesi için basit collider/hull; görseldeki her göçüğü izlemek zorunda değil. |

**Kimlik kuralları (önerilen invariant):**
1. Araç kimliği `vehicleInstanceId`, statik/actor kimliğiyle çakışmaz.
2. Parça kimliği asset içinde tekil ve **model revizyonlarında kararlı** olmalı: ör. `front_bumper`, `hood`, `windshield`.
3. Aynı kimliği yeniden üretim scripti deterministik verir; görünen Blender nesne adı değişebilecekse mapping dosyası otorite olur.
4. Runtime parça anahtarı `(vehicleInstanceId, partId)`; kopma sonrası da bu kimlik korunur. Debris geçici fizik ID'si ayrı olabilir.
5. `VEH-01` (konsept üretim işi) ile `RB-V-001` (araç modeli kimliği) birbirine karıştırılmaz.
6. `sourceAssetHash`/`topologyVersion` değişince eski deformasyon kayıtlarını körlemesine yeni vertex indekslerine uygulamak yasaktır; uyarlama veya görünür fallback gereklidir.

## 3. Blender → GLB üretim sözleşmesi

### 3.1. Ana ilkeler

- **Tek düzenlenebilir Blender master:** `art/vehicles/doruk-k180/Doruk-K180_Master.blend`. Otorite aynı klasördeki `doruk-k180_model.py` script'idir; `.blend` onun çıktısıdır ve elle düzenleme sonraki üretimde silinir. Prosedürel parçalar Claude/Codex `bpy` ile üretilebilir; script ve araç sürümü tutulur (Blender 5.2 LTS sürümüne kilitli).
- **İlk Forge teslimi tek ana araç GLB:** bir kök ve alt düğüm hiyerarşisi; her hasar alacak bileşen bağımsız node/mesh. Malzeme, dönüş, pivot korunur.
- **Ayrı model çıktıları isteğe bağlı:** Blender master kaynak korunarak, parçaya özel fracture bake veya mevcut entegrasyonun gerektirdiği fallback için `.glb` dışa aktarılabilir. **İkinci elde çizilmiş temiz yedek** olarak tasarlanmaz.
- **Hasar için net parça sınırları:** tampon, kaput, cam ve kapılar mümkünse komşu mesh'lerle kaynak vertex paylaşmayan ayrık mesh olmalı; kopma anında görünmeyen arka yüz ve açık bağlantı noktaları oyun estetiğine göre ele alınmalı.
- **Deformasyona uygun topology:** gerçek göçük istenen metal panellerde yeterli, dengeli yüzey tessellation; ince camda fracture farklı bir mekanik. Aşırı sık poligon veya her parçada yüksek tessellation otomatik şart değildir.
- **Transform otoritesi:** Forge model kuralı kilitli: birim metre, **+Y yukarı, +Z ileri, aracın sağı −X** (`engine/physics/vehicle/vehicleTypes.ts`). Gaz-52'de düğüm dönüşümleri uygulanmış GLB ölçüleri metreye ve `vehicle.json` değerlerine uyuyor. `RB-V-001` için `unitScale=1` ilk import smoke'unda yine teyit edilir; merkez/pivot ve Blender dönüşümü ilk teslimde kilitlenir.
- **Wheel special case:** `definition.wheels[].visualNode` ve oluşan `VehicleWheels` grubu hasar/deform taramasında özel muamele görür; araç gövde deformasyon sistemi bunların döndürme/steer animasyonunu bozmaz. Arka ikiz lastikler taraf başına **tek** `visualNode` altında durur (iç + dış lastik).
- **Hasar dokuda boyanmaz:** temel dokuda kalıcı vuruk, ezik veya normal-map göçüğü olmaz; aksi halde runtime göçüğüyle üst üste biner. Pas, boya aşınması ve kir malzemede kalabilir. Görseldeki sol kapı vuruğu modele veya dokuya aktarılmaz.
- **Açığa çıkacak yüzeyler:** tampon, kapı veya cam gidince görünecek bölgeler modellenir: tampon arkası, şasi uçları, ızgara altı, kapı boşluğu ve kabin içi. Görselde çeki kancaları şasiye bağlı okunur; tampon kopunca yerinde kalır.

### 3.2. Örnek hiyerarşi (öneri, Forge şeması değil)

```text
RB_V001_ROOT
├── CHASSIS
│   ├── Chassis_Frame
│   └── Cabin_Shell
├── PART_FRONT_BUMPER (pivot: bağlantı geometrisi)
│   └── Mesh_Front_Bumper
├── PART_HOOD
│   └── Mesh_Hood
├── PART_WINDSHIELD
│   └── Mesh_Windshield
├── PART_DOOR_L
│   └── Mesh_Door_L
├── PART_DOOR_R
│   └── Mesh_Door_R
├── PART_CARGO_BED
│   ├── Bed_Base
│   ├── Tailgate
│   └── Wood_Side_Panels
├── VEHICLE_WHEELS
│   ├── Wheel_FL
│   ├── Wheel_FR
│   ├── Wheel_RL
│   └── Wheel_RR
└── SOCKETS
    ├── CargoAnchor
    ├── DriverSeat
    └── CameraAnchor
```

Bu isimler **zorunlu Forge API** olarak anlaşılmamalı. Node mapping'in gerçek formatı ilgili repo `vehicleTypes`, `vehicleModule`, `GLTF loader` ve asset validator incelenerek belirlenir.

### 3.3. Parça asset kabul (Blender çıkışı)

- [ ] Her oynar/kopar parça **tek ve kararlı `partId`** taşır; aynı parça iki ayrı mekanizmada kimliksiz tekrar etmez.
- [ ] Tüm export nesneleri 3B sahnede aynı araç ölçeği/ekseniyle oturur; dışa aktarılan pozlar başka parçaların local origin'ine bağlı yanlış aktarılmaz.
- [ ] Pivot ve ana bağlantı soketleri teknik paftadaki yerlerle uyumludur.
- [ ] Gereken durumlarda parça kapalı manifold veya özel fracture kaynak kurallarına uygundur; cam kırığı için yalnız ince, çift yüzlü görsel mesh'in Voronoi v1'e uygun olduğu varsayılmaz.
- [ ] Mesh normal/UV/PBR malzeme ve node hiyerarşisi GLB'de korunur; malzeme texture export'u görsel smoke ile doğrulanır.
- [ ] LOD, mesh triangle, doku ve GLB boyut bütçeleri hedef donanım testinden sonra sayısal olarak kilitlenir.
- [ ] Orijinal konsept görseli teknik ortografik ölçüm değildir; ölçüler ayrı `dimensions` sözleşmesinden gelir. K-180 ölçüleri `art/vehicles/doruk-k180/DIMENSIONS.md` dosyasındadır (aks aralığı / tekerlek çapı 3,75; Gaz-52: 3,82).
- [ ] Temel dokuda kalıcı hasar yoktur; açığa çıkacak yüzeyler ve kabin içi modellenmiştir (§3.1).
- [ ] Göçük alacak geniş saclar (kaput, çamurluk, kapı) yeterli vertex yoğunluğuna sahiptir; `missed` sayacı Play'de kontrol edilir.

## 4. Parça davranış sınıfları ve hasar matrisi

**Önerilen teknik `behavior` bileşimi:**
- `rigid_visual`: yalnız görünüm; hasar yok.
- `dent`: attached iken örneğe özel kalıcı göçük (Faz 7 temelinden ileride).
- `detach`: eşik/hasarda bütün parça ayrılıp yeni dynamic body olur (Faz 8).
- `fracture`: parça birden çok kırık parçaya dönüşür; önceden hazırlanmış veya mevcut destekli geometriye bağlı.
- `joint_motion`: menteşeli/yatay açılma; kopma eşiği ayrıca olabilir, v1 dışı.
- `wheel_visual`: mevcut vehicle tekerlek kontrolünün sahip olduğu özel sınıf.

| Doruk K-180 parçası | Varsayılan bağlı davranış | İleri hasar | Kopma/kırılma | İlk prototip |
|---|---|---|---|---|
| `front_bumper` | Araca bağlı rigid görsel | `dent`, birikimli görsel göçük | `detach` | **P0 demonstratör** |
| `hood` | Bağlı panel | `dent` | `detach`, menteşe sonra | P1 |
| `door_left`, `door_right` | Bağlı panel | `dent` | `detach`, menteşe sonra | P1 |
| `front_fender_left/right` | Bağlı panel | `dent` | gerekirse `detach` | P1 |
| `windshield` | Bağlı kırılabilir panel | çatlak VFX/maske (ayrı) | `fracture` veya swap; cam özel kalite/bütçe | P1 |
| `side_glass_left/right` | Bağlı cam | çatlak | `fracture` | P2 |
| `cargo_tailgate` | Bağlı kasa parçası | ahşap/metal hasarı | `detach`/yerel `fracture` | P2 |
| `wood_side_panel_*` | Bağlı panel | parça hasarı | splinter-fracture (uygun kaynak) | P2 |
| `mirror_left/right` | Bağlı rigid görsel | yok | `detach` (ince kol, ucuz aday) | P1 |
| `front_grille_panel` | Bağlı panel | `dent` | gerekirse `detach` | P2 |
| `headlight_*`, `turn_signal_*`, `tail_lamp_*` | Bağlı rigid görsel | çatlak VFX/maske (ayrı) | `fracture` veya görsel kayıp | P2 |
| `rear_window` | Bağlı cam | çatlak | `fracture` | P2 |
| `fuel_tank` | Bağlı rigid görsel | `dent` | yok; oynanış sonucu Ridgebound'un | P2 |
| `cab_step`, `mudflap_*`, `wiper_*` | `rigid_visual` | yok | `detach` sonra | P3 |
| `cargo_stake_*`, `cargo_latch_*` | Bağlı kasa parçası | yok | `detach` sonra | P3 |
| `tow_hook_*` | Şasiye bağlı `rigid_visual` | yok | yok; tampon kopunca yerinde kalır | P0 modellemesi |
| `wheel_*` | `wheel_visual`; motor kontrolü sahibi | ileride lastik/aks hasarı | kopma **ayrı vehicle physics tasarımı** | **mevcut kontrol korunur** |
| `chassis_main` | Rigid physics otoritesi | ayrı gövde göçüğü araştırması | genel parçalanma MVP dışı | **mevcut vehicle korunur** |

**Oyun için P0 kapsam:** bütün tablo değil; yalnız **ön tampon** üzerinden gerçek “dent → detach” teknoloji dilimi. Daha sonra diğer araçlarda aynı genel mekanizma farklı veri profilleriyle tekrar kullanılır.

**Motor denemesi kapsamı (Gaz-52):** aynı mekanizma önce mevcut GLB'deki ayrı düğümlerle kanıtlanır. Ölçüler düğüm dönüşümleri uygulanmış araç uzayındadır.

| Gaz-52 parçası | GLB düğümü | Vertex | Konum | Rol |
|---|---|---|---|---|
| `door_left/right` | `Door_L`, `Door_R` | 546 | x ±0,77–0,98, y 0,93–2,46, z −0,57…0,44 | **Ana gösterim:** `dent → detach` |
| `mirror_left/right` | `Mirror_L`, `Mirror_R` | 184 | x ±0,84–1,22, y 1,67–2,44, z 0,45–0,71 | İkinci durum: küçük parça |
| gövde | `Gaz-52_Gaz-52_0` | 3027 | x ±1,19, y 0,46–2,6, z −4,64…2,26 | Parça dışı darbelerin yedeği |

Gaz-52'de ayrı tampon düğümü bulunamadı. `Front_rail` tampon değildir: ön aks hizasındadır (z 1,0–1,39), aracın burnu ise z = 2,26'dadır. Tamponun gövde mesh'inde olduğu varsayılır; bu yüzden Gaz-52 denemesi önden değil **yandan** darbe kullanır.

## 5. Hasar veri modeli — öneri, mevcut Forge JSON şeması değildir

Sözleşme üç katmanı ayırır:
1. **Forge genel runtime component / asset davranışı:** parçanın hangi node'a, hangi collider/rigid body kalıbına ve hangi event'e bağlı olduğu.
2. **Ridgebound data profile:** hasar eşikleri, malzeme tepkileri, oynanış/onarım sonuçları; değerler testle ayarlanır.
3. **Save state:** araç örneğinin anlık birikmiş hasarı, göçük kayıtları, attachment durumu ve gerekli detached dünya pozu.

**Örnek kavramsal mapping (ŞEMA ÖNERİSİ; yeni dosya alanları/endpoint adları onaylanmadı):**

```json
{
  "contractVersion": 1,
  "vehicleAssetId": "RB-V-001",
  "modelAsset": "RB-V-001.glb",
  "sourceAssetHash": "<build-hash>",
  "parts": [
    {
      "partId": "front_bumper",
      "visualNode": "PART_FRONT_BUMPER",
      "attachmentNode": "SOCKET_FRONT_BUMPER",
      "behaviors": ["dent", "detach"],
      "collisionProxy": "hull_or_box_ref",
      "damageProfileId": "ridgebound_bumper_steel_v1",
      "onDetached": "spawn_dynamic_from_live_mesh"
    },
    {
      "partId": "windshield",
      "visualNode": "PART_WINDSHIELD",
      "behaviors": ["fracture"],
      "damageProfileId": "ridgebound_safety_glass_v1"
    }
  ]
}
```

- `damageProfileId` yalnız Ridgebound içerik referansıdır. Forge genel modülü Ridgebound’a özel sayı/oyun cezası taşımamalıdır.
- `massKg` ve kütle dağılımı artık iki kez sayılmamalı: bağlı parça araç gövdesinin toplam inertial özelliklerine dahil edilmişse kopma anında *tek* kütle otoritesi korunur. Basit v1 için bağlı araç collider ve toplam kütle değişimi yoksa açık fizik yaklaşımı/deliberate approximation kaydı gerekir.
- Mevcut `<Model>.fracture.json`, `<Model>.deformable.json` ve araç `*.vehicle.json` sözleşmeleriyle çakışmadan yeniden kullanılmalı. **VM-1 kararı (`VCD-D02`):** parça listesi modele ait olduğu için `<Model>.deformable.json` içindedir ve `normalizeAssetDeformable` allowlist'inden geçer: `parts[]`, her parça `{ id, nodes[], zone: { min, max } }`. **VM-2:** parçaya isteğe bağlı `detach: { impulse, massKg, kick }` eklendi; `impulse` zorunlu, yoksa parça kopmaz. **Editör:** Static Mesh Editor'ın Deformable bölümündeki `Parts` listesi parçayı düğüm listesinden veya modele tıklayarak ekler, bölgeyi kurar (`Fit Zone`), `Detach` ayarlarını yazar, bölgeleri viewport'ta tel kutu gösterir; Test Hit vurduğu parçayı ve oyunda kopup kopmayacağını söyler. Yukarıdaki kavramsal JSON'un diğer alanları mevcut tip sayılmaz.
- Fracture bileşeninin `sourceHash` ve otomatik bake davranışı, araç parçaları için node-seçilmiş kaynakta yeniden doğrulanmalı. Bir bütün kamyonun tek fracture kaynağına dönüştürülmesi yasak.

## 6. Hasar–kopma durum makinesi

**Parça bağlanma durumu (otorite):** `attached | detached | destroyed`.  
**Görsel hasar durumu (ortogonal):** `undamaged | deformed | fractured` ve `dentRecords`.  
**Fracture yapısal durumu:** planın mevcut `intact | damaged | fractured` mantığından kopya değil, uygun sistem entegrasyonu ile eşlenir.

> Kopmuş bir tampon `detached + deformed` olabilir. Tek `broken` boolean bu durumu doğru temsil etmez.

```text
ATTACHED / UNDAMAGED
       │ impact
       ▼
ATTACHED / DEFORMED ─────── impact ─────► ATTACHED / DEFORMED (birikimli)
       │ detach threshold
       ▼
DETACHING (atomik geçiş; tekrar işlenmez)
       │
       ▼
DETACHED / DEFORMED  ──────► physics / collisions / optional further dents
       │
       └──► optional cleanup/recovery ─► DESTROYED or RECOVERED (ayrı kural)
```

**İdempotency:** Tek fizik adımındaki tekrar impact/damage olayları aynı tampon için birden fazla detached body doğuramaz. `detach` sistemi olay başına bir kez uygular ve deterministic state transition üretir.

**Ayrılma sırası (önerilen transaction):**
1. Rapier impact `point/normal/impulse` olayını ve araç **önceki/geçerli** rigid-body hızlarını örnekle; uygun `partId` için çarpma eşlemesi yap (aşağıdaki §7).
2. Kopma öncesinde birikmiş `dentRecords`, canlı `BufferGeometry`/material, local-to-world transform, orijinal bağlantı ve collision bilgilerini immutable snapshot olarak sabitle.
3. Yeni detached instance kimliğini `(vehicleInstanceId, partId)` ile türet. Dünya pozu/parça pivotu korunarak yeni dynamic body oluştur; gövdenin atılacağı yerde ve gövdeyle çakışmayacak şekilde ilk collider pozunu hesapla.
4. **Tercih edilen yöntem A:** paylaşımdan ayrılmış **aynı deformed mesh** için parenting değişimi yap; `worldPosition/worldQuaternion/worldScale` korunur. Parçaya ait geometry, materyal, normal, shading, bounding bounds bakımından kaynak referansları doğru yönetilir.
5. **Fallback yöntem B:** aynı Blender masterdan export edilen eşleşen bağımsız part mesh'i örnekle; orijinalde saklanan `dentRecords` ile **aynı hasar geometrisini** yeniden kur, sonra attached örneği gizle. Eşleşmeyen topology ile temiz parça takası kabul dışı.
6. Parça kaynak node'u araçta ikinci kez görünür kalmaz; ownership tekilleştirilir. Çift collider ve çift kütle engellenir; collision filtreleri yeni body'nin araçla temasını kontrollü yönetir.
7. Yeni dynamic body için kopma anındaki doğrusal/açısal hız, kütle, inertia ve gerekirse impact yönlü impulse atanır; fizik iterasyonu başladıktan sonra render pozu rigid body tarafından sürülür.
8. `Part.Detached` gibi genel olay (yeni mesaj adı **öneri**) bir kez yayımlanır. Ridgebound bu olayı ses, VFX, görev/onarım kuralları için dinler.
9. State, gerektiği profile göre save'e girer; level/cell unload, performans budget ve cleanup yaşam döngüsü açık olur.

**VM-2'de uygulanan sıra:** darbe önce göçüğünü bırakır, sonra aynı darbe eşiği geçtiyse parça kopar. Parçanın canlı düğümleri (`Door_L` gibi) yeni bir gruba `attach` ile taşınır; göçük, malzeme ve dünya pozu olduğu gibi kalır, temiz parça takası yoktur (yöntem A). Gövde, parçanın kutu merkezinde doğar; collider, parçanın kök eksenlerindeki kutusudur. Geçiş tek seferliktir: parça bir kez ayrılınca sonraki darbeler gövdeye düşer. Tek olay `Deformable.PartDetached` mesajıdır, debug satırı `detached N` gösterir.

### 6.1. Hız aktarımı (fizik kuralı)

Araç gövdesi doğrusal hız `v`, açısal hız `ω` ile hareket ederken tamponun dünya merkez noktası `p`, aracın referans merkezi `c` ise:

`v_part = v_chassis + ω_chassis × (p − c)`

VM-2 bunu Rapier'in `velocityAtPoint` değeriyle uygular ve kaynak gövdenin açısal hızını kopyalar. Fracture yolundan farkı budur: chunk'lara yalnız doğrusal hız kopyalanır. Darbeden sonraki hız kullanıldığı için çarpma iki kez sayılmaz; `kick` buna ayrı eklenir.

Kopma impulse'u uygulanacaksa bu hıza **ayrı** eklenir. Dünya dönüşü, pivot yerleşimi ve açısal hız korunur. Sadece araç merkez hızını kopyalamak, dönüşte kopan tamponun doğal hareketini bozabilir. **Geçiş anında çift darbe impulse'u uygulanmamalı** (kaynak contact solver'ın zaten işlediği etki ile detach force aynı sanılmamalı); fizik alt-adım sırası testle belirlenir.

### 6.2. Deforme geometri aktarımının olmazsa olmazları

- İlk dent'te **copy-on-write**: glTF cache'teki paylaşılmış geometri asla tüm araçlara ortak mutasyona uğramaz.
- Detach anında **temiz yedekle swap yapılmaz**; A'da canlı klon mesh korunur, B'de aynı rest geometry + dent recipe ile özdeş şekil restore edilir.
- `deformable` planının `position/normal Float32Array` açma, quantization/interleaving, kaynaklı normal güncelleme, UV seam ve skinned mesh kuralları Faz 7'de uygulandı (`DentTarget`, `impactDeform.ts`).
- Deformasyon maskesi/parça kaynağı yalnız `partId` ile işaretli **seçili mesh(ler)** üzerinde çalışmalı; araç tekerleklerine veya başka araç örneklerine göçük bulaşmamalı. **VM-1 ile sağlandı:** bir parçanın göçüğü yalnız o parçanın mesh'lerine yazılır, gövde göçüğü parça mesh'lerine geçmez. Komşu mesh'ler arasında hafif bir ek yeri açılır; bu kabul edilen davranıştır. `parts` tanımlamayan asset eskisi gibi tek yüzey olarak göçer.
- `visual_only`: göçüğe göre collider her darbede yeniden oluşturulmaz. Kopmuş tamponun basitleştirilmiş detached convex hull/box proxy'si yine de gerçekçi düşme/yuvarlanmayı sağlayabilir; görsel mesh ile fark raporlanır.
- Detach sonrası ilk sürümde **daha fazla göçük** opsiyoneldir; kullanıcının istediği zorunlu hedef kopma anındaki bütün deformasyonun korunmasıdır. Sonraki darbelerde dent üretimi ayrıca Faz 7 altyapısıyla test edilir.
- Kopan parça fiziksel olarak araç üzerinde eksilmeli, ama ana araç hala güvenilir biçimde sürülebilir kalmalı; collider/mass/inertia değişimi kapsamı ayrıca teknik karardır.

## 7. Çarpışmanın araca ait hangi parçaya uygulandığı

Faz 1 `PhysicsImpact` olayı fiziksel chassis collider'ından gelebilir; **motorun o anda hangi görsel node'un vurulduğunu zaten bildiği varsayılmaz.** Bu nedenle part resolver gerekir.

**Önerilen kısa yol — P0:**
- Çarpışma noktasını araç yerel uzayına dönüştür.
- Kaynak kamyonun ön tamponuna uygun authored `damageZone` (kutu/kapsül veya basit hull) ile eşleştir.
- Tek darbede varsa en uygun/öncelikli part seç; değilse gövde/none fallback.
- Normal ve impulse bileşeniyle malzeme/bağlantı eşiğini değerlendir.
- Bölge tanımları görsel mesh node'a referans verir, ama aracın mevcut tek chassis collider'ını gereksiz yere parçalara ayırmaz.
- **Bölge ham temas noktasına değil, yüzey noktasına bakar (VM-1).** Temas noktası collider'dadır ve gövde o kareye kadar hareket etmiş olabilir: Gaz-52'de nokta kapı hizasında ama yüzeyden 0,24 m dışarıda ölçüldü (x = 1,43; kutu yüzeyi x = 1,19). Bu yüzden darbe önce darbe doğrultusu boyunca modelin yüzeyine oturtulur, bölge o noktayla sorgulanır. Böylece önden gelen bir darbe, doğrultusu üzerinde ileride duran bir kapıya yazılmaz.
- Bölge, parçanın hizasındaki **en dış yüzeyi** kapsamalıdır; bu yüzey parçanın kendisi olmayabilir. Gaz-52'de kapı x = 0,98'de, o hizadaki dış yüzey x = 1,17'dedir; bölge x 0,7–1,3 aralığındadır. `Fit Zone` bu kuralı otomatik uygular: parçanın en ince ekseninde, modelin merkezinden uzak tarafta bölgeyi modelin sınırına kadar uzatır (`fitPartZone`).
- Bölgede yüzey bulunamazsa göçük gövdeye düşer; kopma yine bölgeye göre değerlendirilir. Parça düğümü modelde yoksa ilk darbede tek bir `[deformable]` uyarısı çıkar.
- Uygulamadaki alan adı `zone`dur; Forge'daki ilgisiz `damage-zone` davranışıyla karışmaz.

**Genişleme — P1:** parça bazlı sensor/proxy ve temas noktası yakınlığı, soket ekseni, çoklu parça etkisi, darbe yönüne bağlı hasar. Yanlış parça seçimini engellemek için overlap/öncelik kuralları gerekir.

**Özel durum:** Ön camın kırılabilir panel davranışı, mevcut bütün GLB'yi birleştiren fracture bake'e bağlanamaz; cam **kendi kaynak mesh'ine** sahip olmalı ve fracture/baked chunk yalnız o mesh'ten veya uyumlu ayrı cam GLB'sinden hazırlanmalıdır. Cam çatlak görünümü, gerçek parçaların fiziksel doğumu ve camın tamamen kaybolması üç ayrı kalite düzeyidir.

**Doruk K-180 ölçümleri (VC-2, 2026-11-05):** iki kural yeni parça bağlarken geçerlidir.

- **Darbe alacak parça, çarpıştırıcıda kendi yerini almalı.** Tek kutulu şasiyle duvar darbesinin teması kutu yüzünün ortasına düşer: tampon hiç göçmedi, şasi, motor, kaput, ızgara ve far göçtü. `Script_DorukK180.actor.json` üç kutulu bileşik çarpıştırıcı kullanır (kabin+kasa, kaput, tampon); burunda ilk değen kutu tampon olduğu için temas tampon hizasına iner ve yalnız `Front_Bumper` göçer. Araç kütlesi `vehicle.json`'dan geldiği için `primitives` kütleyi değiştirmez.
- **`dentImpulse`, motorun duvar itişinin üstünde olmalı.** Rapier eşiği 1/60 s'lik parça başına filtreler, sonra kare içinde toplar. K-180 1. viteste 27,5 kN iter, yani parça başına yaklaşık 460 N·s; `dentImpulse` bunun altında kalırsa gazda duran araç duvarı kazır. 600 ile gaz tam açık 13,5 s itişte göçük hiç değişmedi; aynı değer 10 fps'te de geçerli çünkü filtre kare hızına bağlı değil. Darbeden hemen sonraki sekme gerçek bir ikinci temastır ve göçüğü artırabilir (ölçüldü: 0,123 → 0,150 m).
- **Kopma eşiği ölçülen darbeden seçilir.** 4.500 kg kamyon, duvara dik, 10 fps: 22 km/sa 37.100 N·s, 36 km/sa 49.800 N·s, 50 km/sa 63.300 N·s (ölçüm için sidecar uçuşta `fullImpulse: 200000`, `plasticity: 1`, `maxDepth: 2` yapıldı, böylece göçük doğrudan darbeyi okur). `front_bumper.detach.impulse = 45000`, 22 km/sa darbe göçertir, yaklaşık 30 km/sa üstü koparır. Aynı ölçümde `fullImpulse: 20000` yaklaşık 12 km/sa'e denk düşer.
- **Bilinçli sınır:** `VCD-D05` gereği tampon kopsa da çarpıştırıcıdaki tampon kutusu kalır; kamyon duvara görünmez 22 cm kala durur.
- **Kare hızı (`R-08`, 2026-11-05).** Aynı çarpmalar gerçek GPU'da ~150 fps ve 10 fps, N·s: kamyon 22 km/sa duvar 33.100 / 37.100; 36 km/sa 49.800 / 49.800; 50 km/sa 63.300 / 63.300; otomobil 36 km/sa kapı 10.800 / 11.900; 64 km/sa 23.100 / 22.000; 82 km/sa 28.900 / 27.200. Fark en çok %10 ve hiçbir eşik yanlış tarafa geçmedi. Kirişin kaput kutusuyla örtüşmesi 15 cm olunca burun 50 km/sa'te altına dalıyor ve darbe kabine gidiyor; testler 23 cm örtüşme kullanır.
- **Ölçüm tuzağı.** Darbeyi göçük derinliğinden okumak yalnız dent merkezine yakın vertex varsa doğrudur. Kaputun ortasında vertex yok, en yakını 30 cm uzakta ve derinliğin yaklaşık %41'ini gösterir: 14.300 N·s okunan darbe gerçekte yaklaşık 35.000'dir. Tampon ve kapı ölçümleri bu hatayı taşımaz (vertex aralığı 7–10 cm). Seyrek parçada eşik gerçek `detach` ile sınanmalı.
- **Lambalar ve `alsoDents`.** Bir darbe tek parçaya iner; `alsoDents` aynı noktada listelenen parçaları da göçertir, her biri kendi dent kaydını tutar, bir adım gider. `headlight_*` ve `turn_signal_*` ayrı parçadır, birbirini ve `front_grille`'i göçertir, `front_grille` de lambaları. Lamba düşünce ızgaranın göçüğü kendi kaydıyla kalır, kayıtta korunur. Far yuvası modelde gerçek bir boşluktur (`SOCKET_RADIUS`). Far `detach` 12.000 N·s, 2 kg; sinyal 8.000 N·s, 0,5 kg. Temas merkezi tek nokta olduğu için geniş kütük ızgaranın ortasına iner, lambalara yalnız dar engel ulaşır.
- **Arka parçalar ve etkin kütle.** Eşik yalnız hıza bağlı değildir: kütle merkezinden uzak vuruş kamyonu döndürür, arkadan vuruşta kamyon yuvarlanır, ikisinde de aktarılan darbe düşer. 82 km/sa 1,2 t otomobil kapıda 28.900 N·s verirken kasa yanında ve arka tamponda 20.000'in altında kalır. `bed_side_*` 15.000 N·s, 80 kg, dört direğiyle kopar; `rear_bumper` 18.000 N·s, 40 kg, `alsoDents` lambalar; `tail_lamp_*` 8.000 N·s, 1 kg, `alsoDents` tampon; `tailgate` 12.000 N·s, 50 kg, kilitleriyle kopar, geri vites üst hızı yaklaşık 12 km/sa olduğu için eşik buna göredir; `fuel_tank` yalnız göçer, kasa yanı bölgesinin içinde olduğu için önce gelir, üst sınırı 1,25 (otomobil teması kasa altına yakın). `Bed_Base` da `rigid_core`'dadır. Yan darbe kasa altında `missed` sayacını 11–13'e çıkarır; kamyondan mı otomobilden mi geldiği ayrılmadı, göçük üretmez.
- **Bölge sırası ve tabanı.** Ayna kolu kapı bölgesinin içinde olduğu için ayna bölgeleri listede kapılardan öncedir. Kapı bölgesi `y = 0,46`'ya iner: otomobil yüksekliğindeki darbede ilk yüzey `Cab_Step` olabilir, bölge dar kalırsa darbe gövdeye düşer.
- **Yüzey araması çizgi boyunca ±2 m bakar.** `locateDent` çarpana en yakın yüzeyi alır, temas noktasının önündekiler dahil. Kabin önündeki dar engel `y ≈ 2,1`'de kalırsa 1,7 m öndeki ızgara köşesi yarıçap içine girer ve darbe aynaya değil gövdeye düşer. Ayna önden yalnız tavan hizasında (`y ≈ 2,35`) yakalanır; yandan her yükseklikte aynanın kendisi en yakın yüzeydir.
- **Hiç göçmeyecek mesh'ler için `rigid_core`.** Bir parçanın mesh'leri gövde aramasına girmez. `Cabin_Interior`, `Engine_Block`, `Chassis_Frame`, `Windshield` ve `Rear_Window`, bölgesi modelin dışında bir nokta olan tek parçada toplanır (`min = max = [0, -100, 0]`, `detach` yok); darbe bu mesh'lere hiç inmez. Motor değişmez, kural veridir. Cam, `R-11` gelene kadar buradadır: §4'e göre camın davranışı göçük değil kırılmadır. Yalnız parça olmayan kabuk, kasa ve arka mesh'ler gövde kalır; bu `R-18`'i kapatır.
- **Ön parçalar ve bölgeler.** Sıra ayna, kapı, tampon, kaput, çamurluk, ızgara, `rigid_core`. `front_grille` (`Grille_Panel`, farlar, sinyaller) yalnız göçer: ızgara hizasındaki darbe radyatöre inmez. Kaput bölgesi `y ≥ 1,69`, altı ızgaranındır. Kaput `detach` 45.000 N·s, 35 kg; çamurluk 22.000 N·s, 25 kg. Kiriş testinde 25 km/sa kaputu göçertir, 50 km/sa koparır; 35 km/sa otomobil çamurluğu göçertir, 82 km/sa koparır, lastik yerinde kalır. 1,2 t ağırlık 8 m'den düşünce kaput göçer, eşik altında kalır.
- **Yan darbe ölçümü, 1.200 kg otomobil, 10 fps:** 35 km/sa 11.900 N·s, 64 km/sa 22.000 N·s, 82 km/sa 27.200 N·s. Kapı `detach` 18.000 N·s: 35 km/sa göçertir, 82 km/sa koparır. Ayna `detach` 1.500 N·s. `SideGlass_*` kapının çocuğu olduğu için kapıyla gider. `maxDepth: 0,25` tüm parçalar için ortak olduğu için sınırdaki kapı göçüğü hesapla koltuğa değer (kapı x 1,025 → 0,775, koltuk x 0,92); ölçülmedi, görsel kabulde bakılmalı.

## 8. Fizik sahipliği ve collision sözleşmesi

1. **Bağlı faz:** araç `vehicle` rigid body toplam hareketi yönetir. Bağlı parçalar öncelikle görsel child; raycast tekerlekler mevcut kontrolü izler. `partCollider` yalnız hasar seçimi için görsel zone ise Rapier'e yeni rigid body eklenmez.
2. **Kopma anı:** (a) part root world pose; (b) source body's spatial velocity; (c) ayrı mass/inertia; (d) collider ref; (e) contact filtreleri; (f) tek physics ownership atomik kurulur.
3. **Kopmuş faz:** parça kendi Rapier dynamic body'si ve basitleştirilmiş collision proxy ile yönetilir; render bu pozdan türetilir. `three.Object3D.attach` gibi hiyerarşi geçişi yalnız görsel kısmıdır; physics body/Collider'ı otomatik doğurmaz.
4. **Ana chassis:** tampon kopunca görsel boşluk kalır. Chassis collider'ındaki tampon çıkıntısı varsa bunu **kalıcı collider proxy kararına** göre ya küçük sade gövde farkı olarak kabul et ya da ayrı detachable collider yaklaşımı geliştir. Her dent'te bütün chassis collision rebuild yapılmaz.
5. **Kütle ve inertia:** detach v1 için kütlenin nasıl transfer edileceği teknik tasarımda açık seçilecek; bağlı parçanın ağırlığı hem chassis'te hem yeni body'de iki kez kalamaz. Dinamik kütle güncellemesi yapılmıyorsa bu fiziki yaklaşım `approximation` olarak beyan edilir ve testte etkisi ölçülür.
6. **Filtre ve stabilizasyon:** parça aracın collider'ının içinde doğar. VM-2'de yalnız bu çift Rapier `filterContactPair` kancasıyla birbirinden geçer ve 5 cm ayrılınca yeniden çarpışır (`passThroughUntilApart`); parça diğer her şeyle çarpışır. İki Rapier kuralı: kanca yalnız olay kuyruklu adımda okunur, ve kanca bayraklı collider kancasız adıma girerse dünya kalıcı olarak kilitlenir (`null.bind`). Bu yüzden bayrak ayrılınca kapatılır.
7. **Darbe eşiği kare hızına bağlıdır:** impulse kare başına toplanır. Yandan çarpmada ilk vuruş 11.121 N·s ölçüldü; ardından sürekli itme 10 fps'te kare başına 7.750–9.000 verdi, 60 fps'te yaklaşık altıda biri beklenir. `detach.impulse` ilk vuruşa göre seçilmeli ve 60 fps'te denenmelidir.
8. **World Partition:** detached parçanın yaşam döngüsü kaynak araç/cell ile ilişkilendirilir; taşıt hareketli olduğundan static placement cell cleanup'ı doğrudan kopyalanmaz.

## 9. Kayıt / yükleme, restore ve geri dönüş

**VM-3'te uygulanan (`logical` profil):** nesnenin kaybettiği parçalar göçüklerle aynı statedir: `SavedDeformableState.detachedParts`. Nesne yeniden kurulsa da, aktör hücreden çıkıp dönse de, kayıt yüklense de parça yerine dönmez. Gevşek parça kaydedilmez. Yükleme canlı sahnede kalır: kazadan önceki kayıt yüklenince gevşek parça silinir, aynı düğüm eski yerine takılır ve göçüğü kalkar. Kopan parçanın göçükleri parçayla gider, nesnenin listesinde kalmaz. Kayıt `assetId` de taşır: hâlâ sıra numarasıyla yazılmış kayıtlarda başka asset'e düşen giriş uyarıyla yok sayılır.

**Bütçe:** seviyede en çok 16 gevşek parça tutulur, en eskisi önce gider. Sahibi olan aktör hücreyle boşalınca parçaları da gider, kayıp bilgisi kalır. Sayı ölçümle seçilmedi; `VCD-12` benchmark'ı henüz yapılmadı.

**Zorunlu minimal düzey:** kopmuş ön tampon aynı aracın üzerinde yeniden görünmemeli; hasarlı attached tamponun dent şekli save/load'da korunmalı. Aynı olay tekrar tekrar tetiklenmemeli.

**Kademeli iki persistence profili:**

| Profil | Kaydedilir | Ne zaman kullanılır |
|---|---|---|
| **Logical (P0)** | `vehicleInstanceId`, `partId`, `attachmentState`, `damageAmount`, `dentRecords`, source/topology rev, kırılma state | Genel araç parçaları; dışarıdaki geçici debris'in hassas yeri kaydedilmeyebilir. |
| **World-persistent detached (P1/opsiyonel)** | Yukarıdakilere ek `worldPose`, `linearVelocity`, `angularVelocity` ve bağımsız body instance kimliği | Oynanış/onarım açısından yerdeki parçanın geri bulunması gerekiyorsa. |

**Önerilen örnek kayıt (yeni API değil):**

```json
{
  "vehicleInstanceId": "truck-player-01",
  "assetId": "RB-V-001",
  "parts": [
    {
      "partId": "front_bumper",
      "attachmentState": "detached",
      "damage": 0.73,
      "sourceAssetHash": "<hash>",
      "dentRecords": [
        {"pointLocal": [0.1, 0.0, 0.0], "directionLocal": [0.0, 0.0, -1.0], "depth": 0.05}
      ],
      "detachedWorldState": null
    }
  ]
}
```

- Faz 7-6 kaydı kök uzayında `{ entityId, dents[] }` tutar; VM-1 her göçüğe isteğe bağlı `part` ekledi, eski kayıtlar gövdeye düşer. Parçası sidecar'dan silinmiş göçük de gövdede kalır. `sourceAssetHash` veya topoloji sürümü hâlâ yoktur; model değişirse eski göçükler yeni vertex'lere yine konur, bu açık bir risk. Bu sözleşme **part-local vs vehicle-local** dönüşümlerinin tutarlı bir kaydını şart koşar. Öneri: `part-local` rest geometry üzerinden dent recipe; eski `deformables` kayıtları kök uzayında okunmaya devam eder, kayıt dönüştürücüsü vehicle actor ile test edilir.
- **Kararlı aktör kimliği (`VCD-D12`):** `vehicleInstanceId`in karşılığı `LayoutActorInstance.id`dir. Runtime kimliği `actor:<index>` kalır; çeviri yalnız kayıt sınırında yapılır (`engine/persistence/saveEntityKeys.ts`): kayıt aktörü `actor-id:<id>` diye yazar, yüklerken o seviyedeki yeni sırasına çevrilir. Araç, kırılma, göçük, kalıcı script state ve binilen araç aynı yoldan geçer. Sıra sorunu küçük değildi: World Partition seviyesinde bir hücreye aktör eklemek sonraki hücrelerin numaralarını kaydırır.
- Kimliği editör üretir: yüklemede ve her kayıtta eksik olana verir, çakışanın ikincisine yenisini verir, kopya kimliksiz başlar. Mevcut seviyeler sonraki editör Save'inde kimlik kazanır; o zamana kadar ve eski kayıtlar için `actor:<index>` çalışmaya devam eder. Seviyeden çıkmış aktörün kaydı başka aktöre düşmez, uyarıyla atlanır.
- **Sınır:** placement'lar hâlâ `instance:<asset>:<index>` ile kaydedilir. Kırılan veya göçen statik nesnelerin kaydı, aynı asset grubunda sıra değişirse kayar. Binlerce placement'a kimlik yazmak büyük dosya farkı demek; ayrı karar gerektirir.
- Fracture Faz 5'te enkaz pozlarının kaydedilmemesi kullanıcı kararıdır; bu belge **genel fracture kuralını değiştirmez**. Araçta ayrı `World-persistent detached` profilinin açılması kullanıcı/oyun ihtiyacına bağlıdır.
- Yeni kayıtta olmayan alanlar eski save ile uyumlu olmalı, bilinmeyen ID/mesh hash/topology değişince güvenli fallback ve uyarı üretmelidir. Dünya dışına çıkmış geçici debris restore edilmek zorunda değildir.
- Hasarlı parça, fizik sistemini yeniden yükledikten sonra **aynı kaynak mesh'e** dent recipe uygulanarak yeniden üretilebilir; runtime transient vertex buffer'larının her baytını save etmek zorunlu değildir.

## 10. Ortak üretim sorumlulukları

| Rol | Sorumluluk | Somut teslim |
|---|---|---|
| **Kullanıcı + GPT** | Konsept tasarım, görsel onay, hasar davranışı önceliği, kararlı parça sınırları | Onaylı sanat referansı + `VEH-02` breakdown + karar kaydı |
| **Claude + Blender** | Tek ana `.blend`; parametrik parça geometrisi; pivot/kimlik, normal/UV/PBR; GLB export | `RB-V-001.glb`, Blender master, parça raporu, ortografik screenshot |
| **Forge motor oturumu (Claude veya Codex)** | Gerçek schema adaptörü; part resolver; detach + kütle/collider/save/test; önce Gaz-52 | Commit, validator, engine/smoke test ve benchmark |
| **Ortak sınır** | İki oturum aynı üretim dosyasını eşzamanlı düzenlemez; kaynak Blender master modelleme oturumunda, engine mapping motor oturumunda kalır; onaylı değişiklik sözleşme revizyonuyla paylaşılır. | Tekil kaynak otoritesi, test ve kabul ayrımı |

## 11. Aşamalı uygulama planı — kapsamı büyütmeden

İş iki bağımsız hatta yürür. **Motor hattı** Forge Faz 8'dir ve Gaz-52 üzerinde kanıtlanır. **Araç hattı** `RB-V-001` modelidir, ayrı yürür ve motor hattını beklemez.

**Motor hattı — Forge Faz 8, Gaz-52:**

| Aşama | Yapılacak iş | Çıkış kapısı / doğrulama | Durum |
|---|---|---|---|
| **VC-0** | Canlı Forge `vehicle.json`, GLTF wheel visual, component, impact, fracture, save, r187 durumu incelemesi | §1 fark tablosu | **[TAMAM — 2026-11-04]** |
| **VM-1** | Parça tanımı, darbe→parça çözücüsü, parça filtreli göçük | Yan darbe kapıyı göçertir; radius içindeki direksiyon, pedal ve karşı kapı değişmez; `parts` tanımsız asset aynı davranır (`deformable-parts` smoke) | **[TAMAM — 2026-11-04]** |
| **VM-2** | `detach`: aynı deforme mesh'in yeni dynamic body'ye geçişi, `v + ω × r`, tek seferlik geçiş, collision filtreleri | Kapı tek kez kopar; ilk kare form aynı; temiz swap yok; araç sürülebilir (`deformable-parts` smoke) | **[TAMAM — 2026-11-04]** |
| **VM-3** | Kayıt (`logical` profil), hücre boşalması, temizlik/bütçe, kayıtta `assetId` koruması | Save/load ve aktör yeniden kurulumu sonrası kopan parça araca geri takılmaz; kazadan önceki kayıt kapıyı geri getirir; sahipsiz debris birikmez | **[TAMAM — 2026-11-04]** |

**Araç hattı — seçilecek özgün araç (tablodaki `RB-V-001` ve ön tampon örnektir), motor hattından bağımsız:**

| Aşama | Yapılacak iş | Çıkış kapısı / doğrulama | Durum |
|---|---|---|---|
| **VC-1** | Blender'da `RB-V-001` greybox parça sınırları ve pivot/eksen paketi | Tek GLB import, 4 wheel node, statik bumper bağı ve smoke (`doruk-k180` smoke) | **[TAMAM — 2026-11-05, model görünümü kullanıcıca kabul edildi]** |
| **VC-2** | `front_bumper` için `dent` (VM-1 hazırsa veriyle bağlanır) | 2 art arda darbe aynı tamponu büker; başka araç değişmez; save/reload shape aynı (`doruk-k180` smoke) | **[TAMAM — 2026-11-05, kullanıcı kabul etti]** |
| **VC-3** | `front_bumper` için `detach` | Önceki göçük aynı mesh üstünde; part tek doğar; araca bağlı görünmez (`doruk-k180` smoke) | **[KOD TAMAM — 2026-11-05, görsel kabul kullanıcıda]** |
| **VC-4** | `RB-V-001` için save/restore ve bütçe doğrulaması | Tekrarlı save/load, parçanın geri takılmaması, bellek stabilliği | **[KAYIT TAMAM — 2026-11-05; bellek ve hücre çıkışı K-180'de ölçülmedi, `R-07`]** |
| **VC-5** | Kaput, kapı, cam gibi diğer part profilleri | Her malzeme için ayrı test; tek genel “hasar” efekti yok | **[KOD TAMAM — 2026-11-05: kapı, ayna, kaput, çamurluk, ızgara, lambalar, arka tampon, arka kapak, kasa yanları, yakıt deposu; cam `R-11` bekler; görsel kabul kullanıcıda]** |

**Geliştirme sırası notu:** Faz 7 kodu ve r187 kapısı kapandı; açık olan Faz 7 görsel kabulü motor hattını bekletmez. Yeni commit'ler bu belgeden daha güncel kanıt getirebilir; fark tarih ve commit ile kaydedilir.

### 11.1. P0 demonstratör senaryoları ve negatif testler

Aşağıdaki testler `RB-V-001` ön tamponu için yazılmıştır. Motor hattında aynı testler Gaz-52'de **tampon yerine `door_left`** ile, yan darbeyle çalıştırılır; `VCD-01` için tekerlek ve kapı düğümleri kontrol edilir.

| Test ID | Senaryo | Beklenen kabul |
|---|---|---|
| `VCD-01` | GLB import + node mapping | Tampon ve dört wheel görseli doğru eksen/ölçekte, hiçbir parça kayıp değil. |
| `VCD-02` | İlk eşik üstü ön darbe | Yalnız ön tamponun örnek geometrisi deforme olur; cache'teki kaynak değişmez. |
| `VCD-03` | İkinci darbe | Birinci göçük korunur; maksimum derinlik/hasar sınırı aşılmaz. |
| `VCD-04` | Kopma darbesi | Tampon tek ve yalnız bir kez detached dynamic body olur; kaput/tekerler unaffected; araç sürülebilir. |
| `VCD-05` | Geometri sürekliliği | Kopma öncesi **deforme edilmiş tampon** ile kopma sonrası ilk kare mesh aynı formu taşır (geometrik sapma sadece fizik pozundan kaynaklanır); temiz swap olmaz. |
| `VCD-06` | Dünya pozu ve hız | Başlangıç dünya pozu korunur; `v + ω×r` doğrulanır; açısal hız aynı; tekrarlı impulse yok. |
| `VCD-07` | Kırık save/load | Kayıt geri dönünce tampon araca takılı değildir; logical damage korunur; world pose yalnız seçilen persistence profilinde korunur. |
| `VCD-08` | İki araç instance | Yalnız çarpılan aracın tamponu göçer/kopar; diğer araç ve source GLB görseli değişmez. |
| `VCD-09` | Düşük impulse ve parça dışı darbe | Eşik altı hasar yok; yanlışlıkla cam/tekerleğe işlem gitmez. |
| `VCD-10` | Dünya/hücre çıkışı + tekrar giriş | Sahipsiz debris birikmez; detached mantıksal durum korunur; restore/cell cleanup çakışmaz. |
| `VCD-11` | Tampon collider/geometri farkı | Görsel göçük fizik proxy tutarlılığıyla test edilir; beklenen sapma ve sınır yazılır. |
| `VCD-12` | Performans ve video gözlemi | Spawn hitch, dynamic body sayısı, collider sayısı, frame p50/p95 ve bellek delta raporlanır; bütçeler ölçümle kararlaştırılır. |

**Doğrulama komutları:** commit kaydıyla `npx tsc --noEmit`; ilgili motor testleri; `npm run build:verify`; izole editör/Play smoke (`npm run dev:smoke`, port 5273, asla 5173). **Hiçbiri bu belgeyi yazarken çalıştırılmadı.** Smoke, `Terrain` sahnesi yerine küçük ve hızlı bir fixture kullanmalıdır: headless 10 fps'te `Terrain` yüklemesi dakikalar sürüyor.

**Kullanıcı onayı:** Otomatik testin geçmesi, sürüş hissi/hasar görünümü/kopma görsel kalitesinin kabul edildiği anlamına gelmez. Konsept formu kullanıcı tarafından **olduğu gibi korunmuştur**; ortografik ve 3B modelleme ayrı kabul kapısıdır.

### 11.2. Kalan işler (2026-11-04)

Motor hattı kapandı. Aşağıdaki liste açık işlerin tek yeridir; biten madde buradan silinir.

**Sıradaki:**

| ID | İş | Not |
|---|---|---|
| `R-02` | Doruk K-180 görsel kabulü | 21 parça bağlı, liste `art/vehicles/doruk-k180/PARTS.md` içinde. Bağlı olmayanlar (`Cab_Guard`, `Bed_Front_Panel`, silecek, basamak, çamur önleyici, kanca) gövde kalır, istenirse sonra eklenir. |
| `R-19` | Gövdenin zemine vurması (kullanıcı 2026-11-05'te erteledi) | Sert durmada `Bed_Base`, `Rear_Bumper`, `Tail_Lamp_R` göçtü; sebep kuyruğun yere vurması olarak görünüyor, görüntüyle doğrulanmadı. `dentImpulse: 600`, 4.500 kg için yaklaşık 0,13 m/s'lik temas demek. Arazide taban vurma ve sert iniş gövdeyi göçertebilir. Arazi ölçümü ve zemin eşiği kararı sonraya. |
| `R-21` | Far ve sinyal camının parçalanması | Bugün lamba göçer ve bütün olarak düşer. Kırılıp kısa sürede yok olan cam parçaları ayrı iş (kullanıcı, 2026-11-05). |
| `R-03` | Ridgebound'daki Gaz-52 kopyası | `public/assets/vehicles/gaz52` orada eski: `Deformable` bileşeni ve `gaz-52_base.deformable.json` yok. Yalnız araç Ridgebound'a taşınacaksa gerekir. |

**Yayımdan önce çözülmeli:**

| ID | İş | Not |
|---|---|---|
| `R-04` | Placement kayıt kimliği | `instance:<asset>:<index>` hâlâ sıraya bağlı; kırılan veya göçen statik nesnenin kaydı grup sırası değişirse kayar. Kimliği yalnız kırılabilir ve göçebilir nesnelere vermek dosya farkını küçük tutar. |
| `R-05` | Model sürümü kontrolü (`VCD-D03`) | Kayıtta `sourceAssetHash` yok; model değişirse eski göçükler yeni vertex'lere uygulanır. |
| `R-06` | Mevcut seviyelerde aktör kimliği | Kimlik editör Save'inde yazılır. Yayımlanacak her seviye bir kez kaydedilmeli; toplu yazım yapılmadı. |

**Ölçüm ve kabul:**

| ID | İş | Not |
|---|---|---|
| `R-07` | `VCD-12` performans ölçümü | Spawn takılması, gövde ve collider sayısı, kare süresi, bellek. 16 gevşek parça bütçesi ölçümle seçilmedi. |
| `R-08` | Gaz-52 kopma eşikleri 60 fps'te | Doruk K-180 için kapandı (§7). Gaz-52'nin kapı 5.000, ayna 1.500 N·s değerleri gerçek kare hızında sınanmadı. |
| `R-09` | Kapının yere düşüşü görsel kabulü | Yandan çarpmada araba kapıyı kamyonun altına süpürüyor. Fiziksel olarak tutarlı, görsel karar kullanıcıda. |
| `R-10` | Kütle ve collider yaklaşımı | `VCD-D04/05`: kopunca şasi kütlesi ve kutusu değişmez. Sürüşe etkisi ölçülmedi. |

**İhtiyaç olunca:**

| ID | İş | Not |
|---|---|---|
| `R-11` | Cam kırılması (`VCD-D07`, Faz 8 `source: imported`) | Düğüm seçimli fracture veya ayrık cam kaynağı gerekir. |
| `R-12` | Menteşe ve tekerlek kopması (`VCD-D08/09`) | Kapı açılması ayrı joint işi; tekerlek kopması ayrı araç fiziği tasarımı. |
| `R-13` | Kopan parçaya yeni göçük | Parça koptuktan sonra göçmüyor, sözleşme bunu opsiyonel tutuyor (§6.2). |
| `R-14` | Zone'u viewport'ta sürükleme | Bugün sayısal alanlar ve `Fit Zone` var. |
| `R-15` | Faz 8 kalanları | `swap-mesh`, `joint-break`, dışbükey olmayan mesh için CSG; tüketici gelince. |

**Belge ve depo:**

| ID | İş | Not |
|---|---|---|
| `R-16` | Drive kopyası | Bu belge Drive'da eski sürümde; Google Drive bağlantısı yetkilendirilmeden güncellenemez. |

## 12. Teknik açık kararlar (kanon/kod kararı değil)

| ID | Açık konu | Önerilen varsayılan | Kararı kim netleştirir? |
|---|---|---|---|
| `VCD-D03` | Part-local/vehicle-local dent koordinat kaydı | `part-local` rest uzayı; source hash/version ile; eski kök uzayı kayıtları okunur | Motor oturumu / test |
| `VCD-D07` | Cam parçalama mimarisi | Node-seçimli fracture veya Blender'dan ayrık cam asset; camı bütün araç kaynağına bake etme | Motor oturumu + sanat |
| `VCD-D08` | Kapı/kaput menteşe hareketi | Kopma/hasar ayrı; dinamik joint sonrası | Kullanıcı / öncelik |
| `VCD-D09` | Kopmuş tekerlek ve aktarma bozulması | İlk dilim dışında; wheel visual + raycast mapping korunur | Kullanıcı / fizik |

**Kapanan kararlar:**

| ID | Karar | Tarih / kaynak |
|---|---|---|
| `VCD-D01` | Yöntem A: canlı düğüm taşınır; fallback B gerekmedi | VM-2, 2026-11-04 |
| `VCD-D02` | Parça listesi `<Model>.deformable.json` içindedir, `normalizeAssetDeformable` allowlist'inden geçer | VM-1, 2026-11-04 |
| `VCD-D04` | **Bilinçli yaklaşım:** şasi kütlesi değişmez; kopan parçanın `massKg` değeri ayrıca sayılır. Gaz-52 kapısı 40 / 2500 kg = %1,6; sürüşte fark ölçülmedi | VM-2, 2026-11-04 |
| `VCD-D05` | **Bilinçli yaklaşım:** şasi collider'ı değişmez; kapı kopsa da kutu aynı kalır | VM-2, 2026-11-04 |
| `VCD-D06` | `logical` profil yeterli: kayıp kaydedilir, gevşek parçanın pozu kaydedilmez | VM-3, 2026-11-04 |
| `VCD-D10` | `Deformable` ve `Fracturable` eşikleri sahip bazlı tutulur; çözüldü | `bce53640` |
| `VCD-D11` | Mavi kamyon formu özgünleştirilmez; Doruk K-180 seçildiği için geçerlidir (`VCD-D15`) | Kullanıcı, 2026-11-04 |
| `VCD-D15` | İlk özgün araç Doruk K-180; referans `Downloads\Ridgebound\ConceptDesign\Vehicle`, kaynak `art/vehicles/doruk-k180/` | Kullanıcı, 2026-11-05 |
| `VCD-D13` | Temel dokuda kalıcı vuruk olmaz; göçükleri runtime üretir | Kullanıcı, 2026-11-04 |
| `VCD-D12` | Aktöre kalıcı `id`; runtime `actor:<index>` kalır, kayıt sınırında çevrilir | 2026-11-04 |
| `VCD-D14` | `detach` önce Gaz-52'de, `RB-V-001` modellemesinden bağımsız yapılır | Kullanıcı, 2026-11-04 |

## 13. Motor ve modelleme oturumlarına devredilecek işler

### 13.1. Motor hattı tamamlandı

VM-1…3, kararlı aktör kimliği ve parça arayüzü kapandı. Kalan işler §11.2'dedir.

### 13.2. İlk özgün araç modelleme oturumu başlangıç istemi

Sonraki araçlar için `[ARAÇ ADI]` ve `[GÖRSEL YOLU]` alanlarını doldurup yeni oturuma yapıştır. Blender ile arayüzsüz script yeterlidir, MCP gerekmez. Master, script ve render'lar `art/vehicles/<araç>/` altında durur; örnek `art/vehicles/doruk-k180/`.

> İlk özgün aracımız için Blender'da greybox modelleme yapıyoruz. Bu oturumun kapsamı yalnız metrik greybox, parça sınırları ve Forge'a import. Detaylı model, doku ve hasar ayarı kapsam dışı.
>
> Araç: [ARAÇ ADI]
> Konsept görseli: [GÖRSEL YOLU]
> Yukarıdaki iki alan boşsa modellemeye başlama, önce bana sor.
>
> Çalışma deposu: `C:/Users/emret/Desktop/Forge`. Model Forge'da kalacak; Ridgebound'a taşımak ayrı bir karardır.
>
> Önce oku:
> 1. Forge `CLAUDE.md`.
> 2. Forge `docs/planned/vehicle/FORGE_VEHICLE_COMPONENT_AND_DAMAGE_CONTRACT.md`: §0, §3, §4, §11 (`11.2` dahil), §12. Sözleşme kanoniktir; §4'teki parça tablosu bir kamyon örneğidir, seçilen araca uyarla.
> 3. Konsept görselini aç ve incele. Parça sınırlarını, açığa çıkacak yüzeyleri ve §4 tablosuna göre eksik veya fazla parçaları raporla.
> 4. Referans araç: `public/assets/vehicles/gaz52/` içindeki `Gaz52.vehicle.json`, `Script_Gaz52.actor.json`, `gaz-52_base.deformable.json`.
>
> Kesin kararlar, tekrar tartışma:
> - Temel dokuda kalıcı vuruk olmaz; göçükleri runtime üretir.
> - Tek master `.blend`, tek ana GLB, modeli üreten deterministik `bpy` script'i.
>
> Forge'da doğrulanmış teknik kurallar:
> - Birim metre. Forge +Y yukarı, +Z ileri, aracın sağı −X. glTF +Y Up dışa aktarımıyla Blender'da aracın önü −Y'ye, solu +X'e, yukarısı +Z'ye bakar.
> - Blender 5.2 LTS: `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`; `--background --python` ile çalıştır. PATH'te değil.
> - Nesne adları glTF düğüm adı olur; yalnız ASCII harf, rakam, `_`, `-` kullan. Her parça kendi düğümü olsun.
> - Tekerlekler: her tekerlek kendi düğümünde; ikiz lastik varsa taraf başına tek düğümde. `*.vehicle.json` içindeki `wheels[].visualNode` bunlara bağlanır. Dönme ekseni aks olmalı.
> - Hasar alacak parçalar komşularıyla vertex paylaşmaz. Parça kopunca görünecek yüzeyler modellenir: tampon arkası, kapı boşluğu, kabin içi gibi.
> - Geniş saclarda göçük için yeterli vertex olsun. Referans ölçüm: Gaz-52 gövdesi 3027 vertex, 0,8 m yarıçaplı göçükte 292 vertex oynuyor. Greybox'ta yoğunluğu kilitleme, yalnız parça sınırını doğru kur.
>
> Yapılacaklar, bu sırayla:
> 1. **Ölçüler:** bu araç için bir ölçü belgesi yok ve görselden ölçü alınmaz. Boy, en, yükseklik, aks aralığı, iz genişliği, tekerlek yarıçapı ve aracın ana ölçüleri için öneri tablosu çıkar, Gaz-52 ile karşılaştır ve **onayımı al**. Onaysız modellemeye geçme.
> 2. **Parça listesi:** düğüm listesi ve hiyerarşi çıkar, hangi parçanın hemen göçüp kopacağını yaz.
> 3. **Script:** `bpy` ile greybox üret; basit kutu ve silindir yeterli, oranlar doğru olsun. Aynı girdi aynı çıktıyı versin.
> 4. **Görsel kontrol:** ön, yan, arka, üst ortografik ve bir ¾ render al, görselle yan yana incele. Render'ları kendin aç ve bak; "render alındı" yetmez.
> 5. **Import:** GLB'yi `public/assets/vehicles/<araç>/` altına koy, manifest kaydını, `*.vehicle.json` ve `*.actor.json` dosyalarını Gaz-52 örneğiyle kur. Asset sözleşmesini kodla doğrula.
> 6. **Doğrulama:** `npx tsc --noEmit`, `npm run check:assets`; editörde model doğru ölçek ve eksende; tekerlekler `[vehicle] Wheel node` uyarısı olmadan bağlı; araç sürülüyor ve ileri +Z'ye gidiyor; Static Mesh Editor `Parts` listesi tüm parça düğümlerini gösteriyor.
>
> Kurallar:
> - Başlamadan `git status` bak; `public/` altındaki açık authoring dosyalarıma dokunma, yalnız kendi yollarını commit'le.
> - Master `.blend` ve script'in yeri için önce öneri getir: `public/` dışında olmalı, oyunla paketlenmemeli.
> - Otomatik test ile benim görsel kabulümü ayrı raporla.
> - Bu oturumda hasar parametresi ayarlama, doku yapma, `dent`/`detach` bağlamaya geçme.
>
> Bitişte ver: ölçü tablosu, parça düğüm listesi, render'lar, değişen dosyalar, çalıştırılan doğrulamalar ve bir sonraki adım için önerin.

## 14. Öncelik, kapsam ve bağlantılar

- Ridgebound ana tasarım çerçevesi **lojistik / izole dağ yerleşimleri**dir. Araçların hasarı oyunun ilerideki mekanikleri için önemlidir ama **M0 → M1 → M2 ilk oynanabilir tek araç / yük / rota kapsamı sessizce genişletilmez**.
- İlk araç `RB-V-001 Doruk K-180` için sanat takip işleri `VEH-01` (genel form), `VEH-02` (parça breakdown) ve `VEH-03` (yük görünümleri) olarak ayrı durur.
- Konsept kaydı: `RIDGEBOUND_ARAC_KONSEPT_LISTESI_VE_GORSEL_URETIM_PLANI.md` — [Drive](https://drive.google.com/file/d/1r9zYRTiXE4Sxca22UHrxtUkRsRYaO-0p/view).
- Yönetim kuralları: `00_RIDGEBOUND_PROJE_YONETIM_KURALLARI.md` — [Drive](https://drive.google.com/file/d/1KujcbRwP0DP7krTwsZshgObeMUSzjv6I/view).
- Ortak teknik devir: `FORGE_WORLD_BUILDER_TASARIM_VE_TEKNIK_PLAN.md` §0.3 — [Drive](https://drive.google.com/file/d/1Z8rkqGMz5b46ONP1IW5Dosz5Ftajy87n/view).
- Kaynak teknik planın mevcut örneği: bu oturuma eklenen `DEFORMABLE_FRACTURABLE_WORK_PLAN.md` (2026-11-04). Kanıtlar kaynak belgenin kendi commit ve test kayıtlarıdır; bu sözleşme yeni kanıt üretmez.

## 15. Sürüm ve karar günlüğü

| Tarih | Sürüm / ID | Kayıt | Statü |
|---|---|---|---|
| 2026-11-04 | `VCD-001` / v0.1 | Modüler GLB / Blender → Forge, iki eksenli parça durumu, `dent → detach` canlı mesh sürekliliği, collider/mass, save ve acceptance test sözleşmesi taslağı | **[ÖNERİ — ONAY BEKLİYOR]** |
| 2026-11-04 | `VCD-002` / v0.2 | §1 canlı kodla güncellendi (Faz 7 ve r187 kapandı); kullanıcı kararları işlendi; motor hattı `VM-1…3` Gaz-52 için açıldı; görselden parça matrisi genişletildi; parça filtresi, collider yüzeyi, `ω × r`, kayıt uzayı ve aktör kimliği riskleri eklendi | **[YÖN ONAYLANDI]** |
| 2026-11-04 | `VCD-003` / v0.3 | VM-1 tamam: sidecar `parts`, yüzey noktasıyla parça çözümü, parça filtreli göçük, kayıtta `part`, Gaz-52 kapı ve ayna verisi; `VCD-D02` kapandı; §7 bölge kuralı ölçümle düzeltildi | **[VM-1 TAMAM]** |
| 2026-11-04 | `VCD-004` / v0.4 | VM-2 tamam: `detach` verisi, canlı düğüm taşıma, `v + ω × r`, çift bazlı geçiş, `Deformable.PartDetached`; `VCD-D01/04/05` kapandı; kare hızı riski eklendi. Görsel not: yandan çarpmada araba kapıyı kamyonun altına süpürüyor | **[VM-2 TAMAM]** |
| 2026-11-04 | `VCD-005` / v0.5 | VM-3 tamam: `detachedParts`, nesne yeniden kurulumu, kayıttan geri takma, 16 parça bütçesi, sahibin hücresiyle temizlik, `assetId` koruması; `VCD-D06` kapandı; `VCD-D12` kullanıcı önceliğine bırakıldı. Kullanıcı kopmayı oyunda doğruladı | **[MOTOR HATTI TAMAM]** |
| 2026-11-04 | `VCD-006` / v0.6 | `VCD-D12` kapandı: `LayoutActorInstance.id`, kayıt sınırında çeviri, editörde üretim. Placement sınırı yazıldı | **[TAMAM]** |
| 2026-11-04 | `VCD-007` / v0.7 | Static Mesh Editor `Parts` listesi, `Fit Zone`, viewport tel kutuları, Test Hit parça bilgisi | **[TAMAM]** |
| 2026-11-04 | `VCD-008` / v0.8 | Kalan işler §11.2'de toplandı; `RB-V-001` modelleme istemi §13.2'ye yazıldı | **[SIRADA: R-01]** |
| 2026-11-04 | `VCD-009` / v0.9 | Kullanıcı: araç henüz seçilmedi, yeni konseptler üretiliyor; model Forge'da kalabilir. `R-00` ve `VCD-D15` eklendi, §13.2 aracı seçilebilir hale geldi | **[SIRADA: R-00]** |
| 2026-11-05 | `VCD-021` / v1.11 | Kullanıcı işaretlemesiyle form düzeltmeleri: ızgara tamponun arkasına iniyor (0,90), kaput yanı çamurluğun üstünde burun boyunca aşağı kavisleniyor ve ızgara üst kenarı kaputu izliyor; iç davlumbaz kemer içini kapatıyor (kapalı duvar, x 0,60); ön çamur lastiği çamurluk kuyruğunun arkasından torpido duvarına çıkıyor; pencere deliği ışınsal eşlemeyle (`radial_pair`) cam kauçuğunu izliyor; ızgara şeridi yalnız ızgara açıklığının çevresinde; ayna iki ayağıyla kapıda ve `Door_L/R` düğümünün çocuğu. Motor: başka parçanın düğümü altındaki parça onunla birlikte kopar, tek başına da kopabilir (`DentTarget.ridersOf`). Ölçüler değişmedi | **[SIRADA: form onayı, ardından prosedürel doku]** |
| 2026-11-05 | `VCD-020` / v1.10 | Kullanıcı çizimiyle akış geçişi: düz kaporta bloğu kalktı, kaput kesitinden ön cam tabanına akan tek yüzey (`cowl_point`) geldi; ön cam plan görünümünde kavisli (13 cm sarma), kabin yanı fıçı kesitli, kaput arkası kabin genişliğine açılıyor, tavan önü cam kavsini izliyor. Ölçüler değişmedi | **[SIRADA: form onayı, ardından prosedürel doku]** |
| 2026-11-05 | `VCD-019` / v1.9 | Kullanıcı çizimiyle oran geçişi: kaput üstü 1,75'ten 1,92'ye, kuşak 1,72'den 1,90'a, çamurluk kemeri 0,72'den 0,80'e, kaput burnu ızgaranın üstüne biniyor, tavan dolgunlaştı. Tavan 2,65 korundu. Çarpıştırıcı, kaput, çamurluk ve ayna bölgeleri buna uyarlandı | **[SIRADA: form onayı, ardından prosedürel doku]** |
| 2026-11-05 | `VCD-018` / v1.8 | Form geçişi: kaputta orta kırım ve omuz, tek döküm ızgara, 13,5 cm far, kapı pres çizgileri, ince fitil, iç davlumbaz (`Inner_Fender_*`, `rigid_core`), çamurluk yan lambası (`Fender_F*_Marker`), kapanan kaporta yanı. `R-20` kapandı. İlk göçük maliyeti ızgarada yaklaşık 8 ms'e çıktı, `R-07` ile bakılır | **[SIRADA: form onayı, ardından prosedürel doku]** |
| 2026-11-05 | `VCD-017` / v1.7 | Detay modelleme ilk geçiş: greybox script'i `doruk-k180_model.py` oldu; kabin, kaput, çamurluk, ızgara, tampon, tekerlek, şasi, motor, kasa kavisli geometriye geçti. Ölçü, düğüm adı ve hasar eşikleri korundu; `Cabin_Trim` ve `Door_*_Trim` düğümleri eklendi. 62 mesh, yaklaşık 82 bin vertex, 2,45 MB. Doku ve UV sonraki adım | **[SIRADA: görsel kabul, doku]** |
| 2026-11-05 | `VCD-016` / v1.6 | VC-5 kasa dilimi: `fuel_tank`, `tail_lamp_*`, `rear_bumper`, `tailgate`, `bed_side_*`; `Bed_Base` `rigid_core`'a girdi. Toplam 21 parça, 25 smoke testi gerçek ~56 fps'te ve headless geçti | **[VC-5 KOD TAMAM, SIRADA: görsel kabul]** |
| 2026-11-05 | `VCD-015` / v1.5 | `R-08` Doruk K-180 için kapandı: gerçek GPU ölçümü, eşikler korundu. Motor: parça alanı `alsoDents`. Far ve sinyaller ayrı parça, far yuvası greybox'ta boşluk oldu, göçer ve düşer, yuva göçüğü kalır. `R-21` eklendi | **[SIRADA: kasa parçaları]** |
| 2026-11-05 | `VCD-014` / v1.4 | VC-5 ön dilim: `hood`, `fender_left/right`, yalnız göçen `front_grille`, hiç göçmeyen `rigid_core`. Motor, şasi, kabin içi ve cam hiçbir senaryoda göçmüyor, `R-18` kapandı. Kullanıcı `R-19`'u erteledi; `R-20` eklendi | **[VC-5 ÖN DİLİM KOD TAMAM, SIRADA: görsel kabul, kasa parçaları]** |
| 2026-11-05 | `VCD-013` / v1.3 | VC-5 ilk dilim: `door_left/right`, `mirror_left/right`. 35 km/sa otomobil kapıyı göçertir, kabin içi, motor ve karşı kapı değişmez; 82 km/sa kapıyı camıyla koparır, kayıt geri takmaz; tavan hizasındaki dal aynayı tek başına koparır. `R-18` daraldı, `R-19` eklendi. `missed 1` kamyonda değil, Reference Car'da ölçüldü | **[VC-5 İLK DİLİM KOD TAMAM, SIRADA: görsel kabul, kaput ve çamurluk]** |
| 2026-11-05 | `VCD-012` / v1.2 | VC-3: `front_bumper.detach` (45.000 N·s, 70 kg, kick 0,5). 50 km/sa duvar darbesinde tek parça, göçüğüyle kopar; kancalar şasiye bağlı kalır; kamyon sürülür; ikinci temas parça üretmez. Kazadan önceki kayıt tamponu geri getirir, kazadan sonraki kayıt iki yüklemede de geri getirmez. Editörde kopma kaydırıcısı 100.000'e çıktı. Kullanıcı VC-2 göçüğünü kabul etti | **[VC-3 KOD TAMAM, SIRADA: görsel kabul, VC-5]** |
| 2026-11-05 | `VCD-011` / v1.1 | VC-2: `front_bumper` sidecar'ı, `Deformable` bileşeni, üç kutulu çarpıştırıcı. Duvar darbesi yalnız tamponu göçertiyor (144/432 vertex, 0,246 m, `maxDepth` 0,25); ikinci kamyon ve paylaşılan model değişmiyor; kayıt sonrası biçim aynı. §7 ölçüm kuralları, `R-18` eklendi; kullanıcı VC-1 görünümünü kabul etti, `R-01` kapandı | **[VC-2 KOD TAMAM, SIRADA: görsel kabul, VC-3]** |
| 2026-11-05 | `VCD-010` / v1.0 | Kullanıcı: ilk araç Doruk K-180 (`VCD-D15` kapandı), Blender 5.2 LTS, mavi kamyon PNG'si referans dışı. VC-1: deterministik `bpy` greybox, tek GLB, manifest, `vehicle.json`, `actor.json`, `doruk-k180` smoke | **[VC-1 KOD TAMAM, SIRADA: görsel kabul, R-02]** |

**Devam protokolü:** motor hattı kapandı, sıradaki iş VC-3 ve VC-5 görsel kabulü (`R-02`). Her aşama sonunda belge sürümü yükseltilir; Drive kopyası varsa **aynı dosya ID'sinde** güncellenir. Uygulama başka bir oturumda gerçekleştirilirse commit/fixture, test sonucunu ve açık riskleri bu belgenin yeni sürüm kaydına ekle.
