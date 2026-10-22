# Açık Dünya Planı (World Partition + Terrain LOD)

> Durum: **Başladı** (2026-10-22, dal `feat/open-world`). Faz 1'in saf
> çekirdeği hazır: veri tipleri, ikili tile kodeki, yükseklik sorgusu +
> raycast, legacy dönüşüm, heightfield şekli, World Partition hücre
> matematiği (`tests/engine/terrain.test.ts`). Henüz hiçbir runtime/editör
> yoluna bağlı değil; Faz 0 spike'ları açık.
> Hedef: Forge'da **kilometrelerce genişlikte** oynanabilir açık dünyalar:
> parçalı (tile) arazi, uzaklığa göre detay (LOD), oyuncunun etrafında
> içerik akışı (streaming) ve bunları üreten editör araçları. Unreal'ın
> World Partition + Landscape (Component/Streaming Proxy) + HLOD modelinin
> web/three.js karşılığı.
>
> İlk hedef ölçek: **4 km × 4 km** (16 km²), 1 m arazi çözünürlüğü, orta
> seviye masaüstünde 60 Hz. Şema 8 km × 8 km'ye kadar izin verir. Daha büyüğü
> (floating origin) Faz 10'da isteğe bağlı.
>
> Bağlı planlar: [TERRAIN_DEFORMATION_PLAN.md](TERRAIN_DEFORMATION_PLAN.md)
> (bu planın Faz 1–3'ünden sonra başlamalı, bkz. "Bağımlılıklar"),
> [VEHICLE_PHYSICS_PLAN.md](VEHICLE_PHYSICS_PLAN.md),
> [SAVE_GAME_CONTRACT.md](../architecture/SAVE_GAME_CONTRACT.md),
> [CONTENT_LOADING_CONTRACT.md](../architecture/CONTENT_LOADING_CONTRACT.md),
> adaptif kalite (`engine/perf/qualityProfiles.ts`).

---

## Mevcut durum (2026-10-22, kaynaktan doğrulandı)

| Alan | Şu an | Açık dünyayı nasıl engelliyor |
|---|---|---|
| Arazi boyutu | Tek grid, en fazla 257×257 vertex (`LANDSCAPE_MAX_VERTICES`, `tools/saveValidator.ts:1269`); `spacing` 0.01–100 | 1 m çözünürlükte en fazla 256 m |
| Arazi sayısı | Editör level başına 1 Landscape'e izin veriyor (`SceneApp.addLandscape`) | Parçalı dünya kurulamıyor. Runtime `layout.landscapes[]` üzerinde zaten döngü kuruyor |
| Kayıt | `*.landscape.json` içinde JSON sayı dizileri (257² ≈ 4.4 MB); `/__save-landscape` 32 MB sınırı | 1025² JSON ≈ 68 MB. Ayrıştırma ve bellek maliyeti yüksek |
| Render | CPU'da kurulan 32-quad chunk mesh'leri; LOD yok, yalnız frustum culling; dokular tüm araziye yayılan UV ile | Vertex/üçgen sayısı alanla doğrusal büyüyor. Uzakta gereksiz detay |
| Boya | Vertex başına 4 ağırlık (`landscapeWeight` attribute) | Boya çözünürlüğü = vertex çözünürlüğü; 4 katman sınırı |
| Çarpışma | Tüm arazi tek `trimesh` primitive (`createLandscapeColliderPrimitive`) | 1024² ≈ 2.1 M üçgen. Akışta eklenip çıkarılamıyor |
| Karakter zemini | `PhysicsSubsystem.staticSurfaceTriangles()` tüm statik trimesh üçgenlerinin **CPU listesi** + 4 m spatial index; her statik `addEntity`/`removeEntity` tüm cache'i siler | Akışla her tile yüklendiğinde tüm dünyanın üçgen listesi yeniden kurulur |
| Fizik sahnesi | `startSceneRuntime` sahne başında tek seferlik entity listesi; `addEntity`/`removeEntity` var (SpawnActor/DestroyActor için) | Artımlı ekleme var ama toplu ekleme ve cache'ler buna göre tasarlanmamış |
| Navigasyon | Tek nav grid, `MAX_GRID_CELLS = 20000` (`engine/navigation/gridNavigation.ts`) | 0.5 m hücreyle yaklaşık 70 m × 70 m |
| Foliage | Layout başına tek sidecar, 16 m chunk'lar (`FOLIAGE_CHUNK_SIZE`); Landscape foliage kuralları tüm arazi için bir kez üretiliyor, kural başına 20k sınırı | Çim yoğunluğu büyük alana yayılamıyor |
| Asset yükleme | Boot'ta `layout.loadGroups` içindeki tüm GLTF'ler yükleniyor | Dünya büyüdükçe boot süresi ve GPU belleği şişer |
| Kamera / gölge | Kamera far 300 m (`engine/render-three/camera.ts`), spring arm `farClip` 100 m; güneş gölgesi tüm sahne sınırına sığdırılıyor (`fitDirectionalShadowToBounds`) | Uzak görüş yok. Gölge çözünürlüğü dünyaya yayılıp bulanıklaşır |
| Kalite kancaları | `QualityExtensions.viewDistanceMultiplier`, `lodBias`, `physicsActiveDistance`, AI/animasyon uzak güncelleme Hz'i var | **Kullanılabilir temel**: akış mesafeleri buraya bağlanacak |
| Dinamik fizik | `setDynamicActiveArea` (odak noktasından uzak dinamik cisimleri askıya alır) | **Kullanılabilir temel** |
| Worker | Projede hiç Web Worker yok | Tile çözme ve çim üretimi ana thread'i bloklar |
| Level formatı | `UNREAL_BASICS_LESSONS.md`: "Level Streaming/Sublevels ertelendi; format ileride sublevel referansı alabilsin" | Bu plan o maddeyi kapatıyor |

---

## Kararlar

### K1 — Tek arazi sistemi: "World Terrain" (tile grid)

Eski `Landscape` actor'ü **ayrı bir sistem olarak yaşamaz**. Yeni model bir
grid'dir; eski tek parça Landscape yüklenirken **1×1 tile'lık bir terrain'e**
dönüştürülür. Böylece renderer, fizik, editör araçları ve testler tek yoldan
geçer. `RuntimeParity.level.json` ve game-starter smoke'u bu dönüşümle aynı
görüntüyü vermek zorunda.

- **Tile** = Unreal'daki Landscape Streaming Proxy. Varsayılan **256 quad ×
  1 m = 256 m**. Kenar vertex'leri komşu tile ile **paylaşılmaz, kopyalanır**
  (tile 257×257 vertex). Editör kenarları iki tarafa birden yazar. Bu sayede
  her tile tek başına yüklenir, render edilir ve çarpışır.
- **Yükseklik kodlaması:** diskte `Uint16`, dünya başına `heightMin`/`heightMax`
  aralığıyla (Unreal ile aynı yaklaşım). Varsayılan −256..+1792 m → ~3 cm adım.
  Editör çalışma kopyası `Float32`.
- **Boya:** tile başına ağırlık haritası dokusu, `RGBA8` başına 4 katman, en
  fazla 2 doku (**8 katman**). Çözünürlük varsayılan olarak vertex grid'i
  ile aynı, ileride 2× seçeneği.
- **Dosyalar:** `levels/<World>/terrain/terrain.json` (grid tanımı, katmanlar,
  tile listesi + tile başına min/max yükseklik ve bayt boyu) ve tile başına
  bir ikili dosya `tiles/x_z.tile.bin` (başlık + height + weight blokları).
  JSON değil, çünkü 4 km'lik dünya = 256 tile × ~400 KB ≈ 100 MB ham veri.
  Statik host'un gzip/brotli sıkıştırması ikili veride de çalışır.

### K2 — Render: GPU'da yükseklik + CDLOD quadtree

Arazi geometrisi CPU'da kurulmaz. **Tek bir patch mesh** (ör. 32×32 quad)
her quadtree düğümü için ölçeklenip konumlanır. Yükseklik vertex shader'da
tile'ın yükseklik dokusundan okunur. CDLOD (Strugar 2009): düğüm seçimi
kameraya uzaklıkla yapılır, LOD geçişlerinde vertex'ler kaba grid'e doğru
**morph** edilir; bu yüzden ne çatlak ne de pop olur, skirt gerekmez.

- **Doku havuzu (residency pool):** yüklü tile'ların yükseklik ve ağırlık
  haritaları sabit boyutlu `DataArrayTexture` katmanlarında tutulur (ör. 64
  slot). Tile yüklenmesi = bir slota `addLayerUpdate` ile yükleme; boşaltma =
  slotu serbest bırakma. Bütün arazi **tek instanced draw call** ile çizilir.
  Instance attribute'ları: düğüm offset/ölçek, morph aralığı, slot indeksi.
- **Uzak arazi:** tüm dünya için her zaman yüklü, düşük çözünürlüklü bir
  **global yükseklik haritası** (ör. 16 m/texel → 4 km için 257²). Tile
  boyundan büyük quadtree düğümleri ve yüklü olmayan bölgeler bunu örnekler.
  Ufuk hiçbir zaman boş kalmaz (Unreal'ın landscape HLOD'unun karşılığı).
- **Normaller:** fragment shader'da yükseklik dokusundan merkezi farkla
  hesaplanır; uzak LOD'larda da piksel başına doğru ışık verir.
- **Malzeme:** mevcut splat mantığı `onBeforeCompile` ile korunur ama UV
  **dünya uzayında** hesaplanır (dokular tile sınırında kesilmez). Hassasiyet
  için UV tile-yerel offset'ten türetilir (4 km'de float32 `fract` hatası
  olmasın). Katman dokuları `sampler2DArray`, uzak mesafede tekrar kırma
  (ikinci ölçek karışımı) ve dik eğimlerde isteğe bağlı triplanar.
  Editörün `height` / `slope` / `layer` görünüm modları shader define'ı olur.
- **Gölge:** arazi gölge alır. Kendi üstüne gölge (dağ gölgesi) aynı
  displacement'lı `customDepthMaterial` ile, kalite profiline bağlı.
- **Seçim / raycast:** GPU'da şekillenen mesh three.js raycast'iyle
  vurulamaz. Bunun yerine bellekteki tile verisi üzerinde **CPU heightfield
  raycast** (grid DDA + tile min/max ile erken çıkış). Editör seçimi, brush
  hover'ı, foliage boyama ve runtime line trace'leri bunu kullanır.
- **Sculpt/paint:** editör Float32 kopyayı değiştirip yalnız kirli
  dikdörtgeni dokuya yükler. Bugünkü "chunk geometrisini yeniden kur"
  yolundan çok daha hızlı.

Reddedilenler:

| Seçenek | Neden değil |
|---|---|
| CPU'da LOD'lu chunk mesh + skirt (geomipmapping) | Daha az risk ama her LOD için CPU geometri kurulumu ve bellek gerekir, akışta kurulum ana thread'i yer, sculpt yine geometri yeniden kurar. Faz 0 spike'ı GPU yolunu doğrulayamazsa **yedek plan** budur. |
| Geometry clipmap (kameraya bağlı halkalar) | Çok büyük tek heightmap için ideal ama tile tabanlı akış ve tile başına slot havuzuyla CDLOD kadar doğal eşleşmiyor; düzensiz yüklenmiş tile'larda karmaşık. |
| Voxel / marching cubes arazi | Mağara/overhang verir ama render, fizik, editör maliyeti çok yüksek. Mağara gerekirse "Açık sorular"daki delik maskesi + mesh yolu. |
| WebGPU'ya geçmek | Forge WebGL2 `WebGLRenderer` üzerinde; bu plan renderer değiştirmez. |

### K3 — Fizik: tile başına Rapier heightfield + analitik zemin sorgusu

- Her aktif tile bir **Rapier heightfield collider**'ı ile çarpışır
  (`ColliderDesc.heightfield`, sütun-öncelikli `Float32Array`). Trimesh'e göre
  bellek ve kurulum maliyeti çok küçüktür. Fizik yalnız **fizik menzili**
  (varsayılan 384 m) içindeki tile'lar için kurulur; render menzili çok daha
  geniştir.
- **`TerrainHeightQuery`** servisi: `heightAt(x, z)`, `normalAt(x, z)`,
  `raycast(...)`, `layerWeightsAt(x, z)`. Yüklü tile verisini doğrudan okur.
  AI nav yüzey tohumlama ve foliage yerleştirme bu servisi kullanır.
- **Karakter hareket kodu değişmez.** `CharacterMovementSubsystem` zemini
  zaten konuma göre soruyor (`staticSurfaceTrianglesNear(x, z)`) ve
  `findGroundAt` üçgenlerle çalışıyor. Değişiklik `PhysicsSubsystem`'in
  içinde: `staticSurfaceTrianglesNear` arazi için kalıcı bir üçgen listesi
  tutmak yerine, sorgulanan noktanın altındaki birkaç grid hücresinin
  üçgenlerini heightfield verisinden **anında üretir** ve trimesh actor'lerin
  üçgenleriyle birleştirir. Merdiven/rampa davranışı ve testleri aynen kalır.
- `staticSurfaceTriangles` artımlı hale gelir: gövde başına üçgen kaydı +
  hücre index'ine artımlı ekleme/çıkarma; `addEntities`/`removeEntities`
  toplu API'si tek invalidation yapar. Arazi bu listeye hiç girmez.
- **Duvar listesi de konuma göre sorulur.** Hareket her karede
  `staticBlockerAabbs()` ile **tüm** statik AABB'leri tarıyor; açık dünyada
  binlerce nesneyle karakter başına O(n). Yeni `staticBlockerAabbsNear(x, z,
  radius)` (aynı hücre index'i) eklenir; karakter hareketindeki 3 çağrı ve
  `hasGroundProbe` (tüm üçgen listesini kurduruyor) buna geçer. Karakter
  tarafındaki tek değişiklik bu. TPS kamera ve AI çağrıları da aynı API'ye
  taşınır.
- Rapier `KinematicCharacterController`'a geçiş **bu planın kapsamı dışında**:
  mevcut ayarlı davranışı (step up/down, eğim, platform taşıma, merdiven
  düzeltmeleri) yeniden üretmek gerekir ve açık dünya için gerekli değil.
- Fizik menzili dışına çıkan dinamik cisimler mevcut `setDynamicActiveArea`
  ile askıya alınır. Ayrıca altındaki tile'ın çarpışması yoksa **asla
  simüle edilmez** (zeminden düşme önlenir).

### K3a — Yükseklik sorgusu collider ile birebir aynı olmalı (not, 2026-10-22)

> Bu not [TERRAIN_DEFORMATION_PLAN.md](TERRAIN_DEFORMATION_PLAN.md) ile birlikte
> değerlendirilirken çıktı. İki planı da etkiliyor; Faz 1'de `heightAt`
> yazılırken uygulanmalı.

**Sorun.** Faz 1'de `heightAt` **bilinear** olarak tanımlı. Rapier heightfield
ve render mesh ise her hücreyi **iki düz üçgen** olarak işler. Bilinear yüzey
bu üçgenlerden sapar. En büyük sapma hücre ortasındadır ve
`|h00 + h11 − h10 − h01| / 4` kadardır. Örnek: 1 m'lik bir hücrede köşeler
arasında 40 cm burulma varsa sapma 10 cm olur.

Bugün bu fark görünmüyor, çünkü karakter zemini statik üçgen listesinden
(`staticSurfaceTriangles`) geliyor. K3 karakter probunu `TerrainHeightQuery`'ye
taşıdığında **yeni bir regresyon** ortaya çıkar:

- Karakterin ayağı yerden kalkar ya da zemine gömülür.
- Foliage ve çim havada kalır ya da zemine gömülür.
- CPU heightfield raycast (seçim, brush hover) görünen yüzeyden farklı bir
  noktaya vurur.
- Deformasyon planında tekerleğin temas noktası ile iz alanı hizasız kalır.

**Doğrulanan** (2026-10-22, `@dimforge/rapier3d-compat` 0.19.3, 1×1 hücrelik
heightfield'a aşağı doğru ışın atılarak):

- Ardışık yükseklik indeksleri Z boyunca ilerler (sütun-öncelikli):
  0 = (−X,−Z), 1 = (−X,+Z), 2 = (+X,−Z), 3 = (+X,+Z).
- Hücre köşegeni (−X,+Z)–(+X,−Z) yönünde. Bu, bugünkü landscape render
  mesh'i ve trimesh collider'ı (`a,c,b / b,c,d` indeksleri; köşegen
  `(x+1,z)–(x,z+1)`) ile **aynı yön**. Köşegen için çevirme gerekmiyor;
  sorun yalnız bilinear örneklemede.
- 1×1 hücrede satır ve sütun eksenleri ayırt edilemiyor. Bu yüzden S4'te
  X ≠ Z boyutlu bir tile ile tekrar doğrulanmalı.

**Karar.**

- `heightAt` **üçgen-birebir** hesaplanır. Hücre içindeki kesirli konum
  `tx, tz` ile:
  - `tx + tz ≤ 1` ise `h = h00 + (h10 − h00)·tx + (h01 − h00)·tz`
  - aksi halde `h = h11 + (h01 − h11)·(1 − tx) + (h10 − h11)·(1 − tz)`
- Fizik ve hareket için `normalAt`, o üçgenin yüzey normalini döndürür.
  Render'daki yumuşak normal ayrı kalabilir, çünkü yalnız görseldir.
- CDLOD'un en ince seviyesinde (patch quad'ı = 1 texel) patch mesh'i aynı
  köşegenle üçgenlenir. Morph'lu kaba seviyelerdeki fark yalnız görseldir ve
  fiziği etkilemez.
- Yumuşak yüzey isteyen görsel kullanımlar için ayrı ve açıkça adlandırılmış
  bir `heightAtSmooth` (bilinear) tutulur.
- Bugünkü bilinear `landscapeHeightAtLocal` (`engine/scene/landscape.ts:1461`)
  yalnız görsel yerlerde kullanılıyor: spline normali
  (`src/scene/SceneRuntimeCore.ts:799`) ve River Water derinliği
  (`engine/render-three/riverWater.ts:183`). Taşıma sırasında bunların
  `heightAtSmooth`'a mı yoksa birebir sürüme mi bağlanacağı tek tek seçilir.
- **Test:** rastgele noktalarda `heightAt` sonucu, Rapier heightfield'a atılan
  ışınla aynı çıkmalı (tolerans 1e-4). Test kapsamında X ≠ Z boyutlu tile,
  tile kenarı ve tile köşesi bulunur.

### K4 — Akış: World Partition tarzı otomatik grid

Unreal World Partition'daki gibi yazar sublevel yönetmez. Editör actor'leri
**konumlarına göre** hücre dosyalarına otomatik dağıtır.

- **Persistent level** (`<World>.level.json`): ortam singleton'ları (sky,
  fog, post process, sky light), Game Mode, Player Start, directional light,
  World Settings, `spatiallyLoaded: false` işaretli actor'ler.
- **Hücre dosyaları** (`levels/<World>/cells/x_z.cell.json`): layout dizilerinin
  hücreye düşen alt kümesi (`instances`, `actors`, `characters`, `lights`,
  `blockingVolumes`, `reflectionCaptures`, `targetPoints`, `worldWidgets`, ...).
  Şekil layout ile aynı olduğu için **mevcut save validator fonksiyonları
  yeniden kullanılır**.
- **Runtime grid'leri** (her biri ayrı hücre boyu ve menzil):

  | Grid | Hücre | Varsayılan yükleme menzili | İçerik |
  |---|---|---|---|
  | `terrain` | 256 m (= tile) | 1536 m render, 384 m fizik | Tile verisi |
  | `main` | 128 m | 384 m | Actor'ler, mesh yerleşimleri, ışıklar |
  | `foliage` | 64 m | 256 m | Boyanmış foliage chunk'ları |
  | `grass` | 32 m | 96 m | Prosedürel çim (dosya yok, üretilir) |
  | `hlod` | 512 m | dünya sonuna kadar | Uzak hücrelerin birleşik proxy mesh'i (Faz 7) |

  Menziller `QualityExtensions.viewDistanceMultiplier` ile ölçeklenir.
- **Hücre yaşam döngüsü:** `Unloaded → Fetching → Loaded (veri bellekte) →
  Activated (sahnede + fizikte) → Deactivating`. Unreal'daki Loaded/Activated
  ayrımı korunur: yakın bölgedeki hücreler önceden **yüklenir** ama yalnız
  menzile girince **aktive edilir**.
- **Histerezis:** boşaltma menzili = yükleme menzili × 1.25. Sınırda gidip
  gelen oyuncu hücreleri titretmez.
- **Öncelik:** uzaklık + hareket yönü (hız vektörünün önündeki hücreler önce).
- **Bütçe:** kare başına aktivasyon zaman dilimi (varsayılan 4 ms), eşzamanlı
  fetch sınırı (6), LRU ile "yüklü ama aktif değil" önbelleği bellek bütçesi.
- **Akış kaynakları:** varsayılan olarak sahiplenilen pawn ve kamera. Script API'si
  ile ek kaynak (ör. ışınlanma hedefi, sinematik kamera).
- **Bloklayan yükleme:** boot, travel, save-game yükleme ve ışınlanmada,
  oyuncunun etrafındaki fizik menzili aktif olana kadar loading ekranı kalır.
  Oyuncu akıştan hızlı giderse (araç) pawn, zemini olmayan tile'a girmeden
  yerinde tutulur ve `?debug` uyarısı verilir (Unreal "block on slow streaming").
- **Worker:** tile ikilisini çözme, Float32'ye açma, min/max ve global harita
  güncellemesi, çim örnekleme bir **Web Worker**'da. Ana thread yalnız doku
  yüklemesi, collider oluşturma ve sahne ekleme yapar.

Reddedilenler:

| Seçenek | Neden değil |
|---|---|
| Elle sublevel'lar (Unreal Level Streaming) | Yazar yükü büyük; açık dünyada hata kaynağı. İleride "always loaded" alt seviye ihtiyacı Data Layer ile çözülür. |
| Actor başına dosya (Unreal OFPA) | Web'de binlerce HTTP isteği. Hücre başına dosya doğru granülerlik. Git diff'i hücre başına kalır. |
| Tüm dünyayı tek dosyada tutup yalnız render'ı akıtmak | Boot süresi, bellek ve fizik dünyası boyutu çözülmez. |

### K5 — Asset sahipliği (residency)

Boot'ta `loadGroups` yalnız persistent level için yüklenir. Hücreler
aktive olurken ihtiyaç duydukları asset'leri **ref-count**lu bir
`AssetResidency` üzerinden ister. Son referans düşünce belli bir gecikmeyle
GPU kaynağı boşaltılır. Editördeki tekil asset yükleme yolu
(`SceneApp`'teki on-demand placement) bunun çekirdeği olur.

### K6 — Koordinat hassasiyeti

İlk hedefte dünya merkezi orijinde, en uzak nokta orijinden ~4 km. Burada
float32 hassasiyeti ~0.5 mm (fizik ve render için yeterli). three.js
modelView'u CPU'da float64 hesaplar. Riskli olanlar dünya uzayı kullanan
shader'lar (dünya UV'si, fog, çim rüzgârı); bunlar tile-yerel veya
kamera-göreli koordinatla yazılır. 8 km'yi aşan dünyalar için **floating
origin** Faz 10'da isteğe bağlı.

### K7 — Derinlik hassasiyeti

Far 4–6 km, near 0.1 m ile z-fighting üretir. Faz 0'da `reversedDepthBuffer`
(EXT_clip_control) desteği ölçülür. Yoksa `logarithmicDepthBuffer` (maliyetli)
veya hıza/yüksekliğe göre dinamik near (0.1 → 0.5 m). Karar Faz 0 sonunda
buraya yazılır.

---

## İlkeler

1. **Engine generic kalır.** Dünya boyutu, menziller, hücre boyu, katman
   sayısı veridir (`terrain.json`, World Settings). Hiçbir oyun kuralı motora
   girmez. Fork'lar yalnız değer değiştirir.
2. **Tek arazi yolu.** Eski Landscape, yeni sistemde 1×1 tile'dır. İki
   renderer, iki çarpışma yolu yaşamaz.
3. **Bölünmemiş level'lar değişmeden çalışır.** World Partition, World
   Settings'te açık seçimdir (`world.partition`). Mevcut level'lar ve fork'lar
   (minigolf vb.) migrasyon yapmadan açılır.
4. **Saf mantık test edilir.** Hücre atama, akış kararı, LOD seçimi, kodek,
   yükseklik örnekleme, raycast, tile kenar tutarlılığı three.js'siz saf
   fonksiyonlardır ve `tests/engine` altında test edilir.
5. **Ana thread bütçesi korunur.** Akış hiçbir karede bütçeyi aşmaz; aşan iş
   bir sonraki kareye kalır. Ölçüm `?debug` overlay'ine girer.
6. **Allowlist disiplini.** Yeni `terrain.json`, hücre dosyası ve tile
   ikilisi yeni bir **5. allowlist yüzeyi**dir. `tools/saveValidator.ts`,
   `droppedFields` ve `serializationDrift` testleri kapsar. CLAUDE.md'ye
   eklenir.
7. **Editör `?editor` arkasında.** World Partition paneli, minimap, import
   sihirbazı `src/editor/` altında. Oyun build'ine girmez; `verify:imports`
   ve `verify:dist --strict` yeşil kalır.
8. **SceneApp büyümez.** Yeni kod modüllerde yaşar (aşağıda). SceneApp ve
   RuntimeSceneApp yalnız bağlantı noktası olur.

---

## Modül yerleşimi

| Yol | İçerik |
|---|---|
| `engine/terrain/terrainTypes.ts` | `WorldTerrainDef`, tile anahtarı, boyutlar, katman tanımı |
| `engine/terrain/terrainTileCodec.ts` | İkili tile kodlama/çözme (başlık + Uint16 height + RGBA8 weight) |
| `engine/terrain/terrainHeightQuery.ts` | `heightAt`, `normalAt`, `layerWeightsAt`, heightfield raycast (DDA + min/max) |
| `engine/terrain/terrainLod.ts` | CDLOD quadtree düğüm seçimi, morph aralıkları (saf) |
| `engine/terrain/terrainEdit.ts` | Çok-tile'lı brush uygulama, kenar senkronu, kirli dikdörtgen |
| `engine/terrain/terrainImport.ts` | Büyük 16-bit heightmap → tile'lara bölme; legacy Landscape → 1×1 dönüşümü |
| `engine/terrain/terrainSplines.ts` | Mevcut landscape spline mantığının dünya uzayına taşınmış hali |
| `engine/world/worldGrid.ts` | Hücre matematiği, actor → hücre ataması (saf) |
| `engine/world/streamingPolicy.ts` | İstenen hücre kümesi, histerezis, öncelik (saf) |
| `engine/world/worldStreamingSubsystem.ts` | Hücre durum makinesi, bütçeler, LRU, kaynaklar; loader'lar enjekte edilir |
| `engine/world/workers/terrainWorker.ts` | Tile çözme, çim örnekleme |
| `engine/render-three/terrain/terrainRenderer.ts` | Instanced CDLOD draw, düğüm güncellemesi |
| `engine/render-three/terrain/terrainMaterial.ts` | Displacement + splat + view mode + depth material |
| `engine/render-three/terrain/terrainTexturePool.ts` | `DataArrayTexture` slot havuzu |
| `engine/physics/terrainCollider.ts` | Tile → Rapier heightfield |
| `engine/assets/assetResidency.ts` | Ref-count'lu asset yükle/boşalt |
| `src/scene/capabilities/worldStreamingModule.ts` | Runtime kablolama: kaynaklar, bloklayan yükleme, BeginPlay/EndPlay |
| `src/editor/panels/world/` | World Partition paneli, minimap, New World sihirbazı |
| `tools/world/` | `world:build` (global harita, HLOD, manifest), test dünyası üreticisi |

---

## Faz 0 — Spike'lar ve karar kapıları

Amaç: riskli varsayımları kod yazmadan önce ölçmek. Her spike tek bir
throwaway sayfada (`templates/` altında değil, `spikes/`; merge edilmez).
Sonuçlar bu dosyanın "Kararlar" bölümüne yazılır.

- [ ] **S1 GPU CDLOD:** 16×16 tile (4 km), `DataArrayTexture` havuzu, tek
      instanced draw, morph. Ölçüm: orta laptop ve masaüstünde kare süresi,
      draw call, GPU belleği. Kapı: < 3 ms GPU (arazi), çatlak/pop yok.
- [ ] **S2 Malzeme uyumu:** displacement + mevcut splat `onBeforeCompile` +
      gölge alma + `customDepthMaterial` ile kendine gölge, three r184'te.
- [ ] **S3 Doku yükleme:** 257² Uint16 + 2× RGBA8 slot güncellemesi
      (`addLayerUpdate`) süresi. Kapı: tile başına < 2 ms ana thread.
- [ ] **S4 Rapier heightfield:** 257² tile collider oluşturma/silme süresi ve
      karakter + araç davranışı (kenar geçişi, iki tile arası dikiş).
      X ≠ Z boyutlu tile'da indeks sırası ve köşegen yönü tekrar
      doğrulanır (K3a). Kapı: oluşturma < 3 ms.
      *Kısmen (2026-10-22):* 3×2 quad'lık alanda indeks
      `vx·(nrows+1) + vz` ve tek köşesi yükseltilmiş hücrelerde `b–c`
      köşegeni doğrulandı; `terrainTileHeightfieldShape` bu düzeni üretiyor.
      Süre ölçümü ve karakter/araç davranışı açık.
- [ ] **S5 Derinlik:** far 6 km'de `reversedDepthBuffer` desteği ve
      z-fighting; yedek seçeneklerin maliyeti (K7).
- [ ] **S6 Worker:** Vite'ta modül worker'ı build'e girip `verify:dist`'ten
      geçiyor mu; tile çözme süresi; `transfer` ile kopyasız aktarım.
- [ ] Kararlar kaydedildi. S1/S2 başarısızsa K2 yedek planına (CPU
      geomipmapping) geçildiği yazıldı.

## Faz 1 — Veri modeli, ikili tile'lar, migrasyon (akış yok)

Bütün tile'lar hâlâ açılışta yükleniyor. Amaç formatı oturtmak.

- [x] `engine/terrain/terrainTypes.ts`: `WorldTerrainDef` (`tileQuads`,
      `spacing`, `tilesX`, `tilesZ`, `origin` (min köşe, Y = datum),
      `heightMin`/`heightMax`, `layers[]` (≤ 8, material id), `collision`),
      tile özeti `{key, minHeight, maxHeight}`. Bayt boyu özetten çıkarıldı:
      sabit, `terrainTileByteLength` ile hesaplanıyor. (2026-10-22)
- [x] `terrainTileCodec.ts`: 32 baytlık sürümlü başlık (`FTIL` v1), Uint16
      ya da f32 height, 0–2 RGBA8 weight bloğu; round-trip, aralık dışı
      clamp, bozuk/eksik dosyada `TerrainTileCodecError`. (2026-10-22)
- [x] `terrainHeightQuery.ts`: **üçgen-birebir** `terrainHeightAt` ve
      `terrainFaceNormalAt` (K3a), görsel için `terrainHeightAtSmooth` ve
      `terrainSmoothNormalAt`, `terrainLayerWeightsAt`, heightfield
      `raycastTerrain` (tile min/max atlamalı DDA, yalnız ön yüz). Kenar
      vertex'i sahibi tile yüklü değilse komşu kopyadan okunur. Rapier
      heightfield ışınıyla eşitlik testi: 400 rastgele nokta + dikiş ve
      köşe, tolerans 1e-3; aynı noktalarda bilinear > 5 cm sapıyor. (2026-10-22)
- [ ] Legacy dönüşüm: `LayoutLandscape` + `*.landscape.json` → 1×1 terrain
      (bellekte, okuma sırasında). Splines ve River Water referansları korunur.
      **Saf dönüşüm hazır** (`terrainLegacy.ts`, `runtime-parity` fixture'ında
      her collider vertex'i birebir); okuma yoluna bağlanması açık.
- [ ] Kayıt: `/__save-terrain` (`terrain.json`, JSON) ve
      `/__save-terrain-tile` (ham ikili gövde, boyut ve başlık doğrulamalı).
      `saveValidator`'a 5. yüzey; `droppedFields` kapsamı.
- [ ] Editörde legacy Landscape kaydedildiğinde yeni formatta yazılır
      (tek yönlü migrasyon, eski dosya korunur). `public/` fixture'ları
      ve `RuntimeParity` güncellenir.
- [ ] Engine testleri: kodek, örnekleme, dönüşüm, validator.
- [ ] CLAUDE.md: 5. allowlist yüzeyi notu.

## Faz 2 — Terrain renderer (CDLOD) + editör araçlarının taşınması

- [ ] `terrainLod.ts`: quadtree seçimi, LOD menzilleri, morph faktörü
      (saf, test edilir: komşu düğüm LOD farkı ≤ 1, menzil monotonluğu).
- [ ] `terrainTexturePool.ts`: slot ayırma/serbest bırakma, global düşük
      çözünürlüklü harita.
- [ ] `terrainRenderer.ts` + `terrainMaterial.ts`: instanced draw, dünya UV'li
      splat, `sampler2DArray` katmanlar, uzak tekrar kırma, view mode'lar,
      gölge alma, kalite profiline bağlı kendine gölge.
- [ ] Eski `engine/render-three/landscape.ts` chunk renderer'ı kaldırılır;
      `RuntimeSceneApp` ve `SceneApp` yeni renderer'ı kullanır.
- [ ] Seçim ve brush hover: CPU heightfield raycast (`scenePicker`,
      foliage boyama, landscape brush cursor).
- [ ] Sculpt/paint: `terrainEdit.ts` ile çok-tile'lı brush, kenar vertex
      senkronu, kirli dikdörtgen doku yüklemesi. Undo artık tüm diziyi değil,
      tile başına kirli dikdörtgenin önce/sonra yamasını saklar.
- [ ] Heightmap import/export: 16-bit PNG ve RAW, dünya boyunda; tile'lara
      bölme `terrainImport.ts`'de (büyük import worker'da, Faz 4'ten sonra).
- [ ] Mevcut smoke'lar: `landscape-sculpt`, `landscape-paint`,
      `landscape-spline-chain`, `runtime-parity`, `game-starter` yeşil.
- [ ] Ekran görüntüsü karşılaştırması: legacy landscape eski ve yeni
      renderer'da görsel olarak eşdeğer (tolerans belgelenir).

## Faz 3 — Fizik, hareket, navigasyon zemini

- [ ] `terrainCollider.ts`: tile → Rapier heightfield, `landscape:<id>:<tile>`
      entity id'leri, collision preset / physical material korunur.
      *Şekil verisi hazır* (`terrainTileHeightfieldShape`, Rapier testiyle);
      PhysicsSubsystem bağlantısı açık.
- [ ] `PhysicsSubsystem.addEntities` / `removeEntities` (toplu, tek
      invalidation); statik yüzey üçgen cache'i gövde başına artımlı.
- [ ] `staticSurfaceTrianglesNear` arazi üçgenlerini heightfield'dan anında
      üretir (karakter hareket kodu değişmez); nav yüzey tohumlama
      `TerrainHeightQuery`'yi kullanır. Merdiven/rampa düzeltmeleri
      (signedNormalY, headroom gate) korunur; ilgili testler yeşil.
- [ ] `staticBlockerAabbsNear(x, z, radius)`; karakter hareketi, `hasGroundProbe`,
      TPS kamera ve AI çağrıları buna geçer. Test: 5000 statik AABB'li
      sahnede karakter adımı süresi sabit kalıyor.
- [ ] `createLandscapeColliderPrimitive` (trimesh) kaldırılır.
- [ ] Araç: tile kenarında süspansiyon zıplaması yok (smoke: VehicleTest
      üzerinde 2×2 tile'lık arazide dikiş geçişi).
- [ ] Collision debug wire'ı heightfield'ı çizer.

## Faz 4 — Akış çekirdeği (yalnız arazi)

- [ ] `worldGrid.ts`, `streamingPolicy.ts`: saf, tablo testli (menzil,
      histerezis, öncelik, hız yönü). *`worldGrid.ts` hazır* (hücre/sınır,
      yakından uzağa sıralı menzil sorgusu, actor → hücre); `streamingPolicy`
      açık.
- [ ] `worldStreamingSubsystem.ts`: durum makinesi, fetch sınırı, kare
      bütçesi, LRU bellek bütçesi, iptal (menzilden çıkan fetch), hata
      (eksik tile → düz tile + `[world]` uyarısı, CONTENT_LOADING_CONTRACT
      sınıflandırmasıyla).
- [ ] `terrainWorker.ts`: çözme + Float32 açma + min/max, transferable.
- [ ] Render menzili ve fizik menzili ayrı; global harita menzil dışını
      kapatır.
- [ ] Bloklayan yükleme: boot, travel, save-game yükleme ve ışınlanma
      (`LevelRuntime` adımı + loading ekranı). Akıştan hızlı giden pawn'ı
      tutma kuralı.
- [ ] `QualityExtensions.viewDistanceMultiplier` menzilleri ölçekler.
- [ ] `?debug`: yüklü/aktif/kuyruk hücre sayısı, ms/kare, bellek; hücre grid
      overlay'i (renk = durum).
- [ ] **Test dünyası:** `tools/world/generate-test-world` → `Levels/OpenWorldTest`
      (4×4 km, fBm gürültülü dağ-vadi, 4 boya katmanı). Smoke: spawn → 1 km
      yürü/sür → bellek ve hücre sayısı sınırda kalıyor, zemine düşme yok.

## Faz 5 — Actor bölümleme (hücre dosyaları)

- [ ] World Settings: `world.partition { enabled, grids: {main, foliage, ...} }`
      + validator.
- [ ] Hücre dosya formatı (`worldCell`, schema 1); validator mevcut layout
      validator'larını yeniden kullanır.
- [ ] Editör kaydı: konuma göre otomatik hücre ataması; hücre sınırı geçen
      actor dosya değiştirir; `spatiallyLoaded: false` persistent'e gider;
      hücreden büyük sınırlı actor'ler v1'de persistent'e gider (uyarıyla).
      Yalnız kirli hücreler yazılır.
- [ ] Runtime: hücre aktivasyonu instances / actors / lights / volumes /
      characters'ı sahneye, fiziğe (toplu), behavior'a ekler; deaktivasyon
      tersini yapar. Actor Script'te **BeginPlay hücre aktivasyonunda, EndPlay
      boşaltmada** çağrılır (Unreal semantiği); belgelenir.
- [ ] `AssetResidency` (K5): hücre başına asset ref-count, gecikmeli boşaltma.
      Persistent level'ın `loadGroups`'u eski davranışta kalır.
- [ ] Save-game: P3.3 opt-in script state'i (destroyed/hidden işaretleri)
      hücre **aktivasyonunda** uygulanır, yalnız level başında değil.
      Hücre boşalırken taşınmış dinamik cisimler ve araçlar için bellek içi
      "hücre durum önbelleği" + save-game'e yazılması (bkz. Açık sorular).
- [ ] `SAVE_GAME_CONTRACT.md` ve `CONTENT_LOADING_CONTRACT.md` güncellenir.
- [ ] "Convert Level to World Partition" editör komutu: mevcut level →
      persistent + hücreler (geri alınabilir, yedek kopya).

## Faz 6 — Foliage ve çim akışı

- [ ] Boyanmış foliage sidecar'ı hücre başına (`foliage` grid'i); mevcut
      16 m chunk'lar InstancedMesh başına frustum culling + `cullStart`/
      `cullEnd` fade (Foliage Faz 2'nin açık maddesi burada kapanır).
- [ ] Landscape foliage kuralları → **prosedürel çim**: kamera etrafında 32 m
      hücre halkası, hücre başına deterministik seed, worker'da örnekleme,
      mesafeyle yoğunluk azalması, kural başına sınır hücre başına uygulanır.
- [ ] Yerleştirme `TerrainHeightQuery` ile (eğim, yükseklik, katman ağırlığı).
- [ ] Bütçe: çim instance sayısı kalite profiline bağlı.

## Faz 7 — Uzak görünüm: gölge, görüş mesafesi, LOD, HLOD

- [ ] Kamera far/near World Settings `viewDistance` × kalite çarpanı;
      spring arm `farClip` buna bağlanır; K7 kararı uygulanır.
- [ ] Gölge: `fitDirectionalShadowToBounds` yerine kameraya bağlı
      **cascaded shadow maps** (3–4 kaskad high/ultra, 2 low), texel'e
      hizalı kaydırma, gölge solma mesafesi. Splat ve foliage
      malzemeleriyle uyum.
- [ ] Height Fog ve Sky Atmosphere uzak mesafeyi ve akış kenarını gizleyecek
      varsayılanlar (dünya ayarına bağlı).
- [ ] Actor LOD: mevcut `distanceLod.ts` + hücre bazlı küçük-nesne culling
      mesafesi (asset bounds'a göre).
- [ ] **HLOD:** `npm run world:build` hücre başına statik mesh'leri tek bir
      sadeleştirilmiş GLB'de birleştirir (gltf-transform + meshoptimizer
      simplify). Yüklü olmayan `main` hücreleri yerine HLOD gösterilir.
      Dev'de HLOD yoksa uyarı, oyun yine çalışır.
- [ ] `perf:assets` ve `verify:dist` hücre/tile/HLOD dosyalarını kapsar.

## Faz 8 — Editör dünya araçları

- [ ] **New Open World** sihirbazı: tile sayısı, tile boyu, spacing,
      yükseklik aralığı, hücre boyları; boş ya da heightmap'ten.
- [ ] Büyük heightmap import (ör. 4097² 16-bit PNG/RAW) worker'da, ilerleme
      çubuğuyla; export aynı.
- [ ] **World Partition paneli:** heightmap'ten üretilmiş minimap, hücre
      grid'i, bölge seçip yükle/boşalt, kalıcı "pinned" bölgeler; editör
      kamerası etrafında otomatik yükleme (runtime'dan geniş menzil).
- [ ] Outliner: yalnız yüklü actor'ler + "yüklü olmayan hücrede" filtresi;
      bir actor'e gitmek hücresini yükler.
- [ ] Landscape splines ve River Water dünya uzayına taşınır (`landscapeRef`
      yerine terrain'e bağlı dünya spline'ı); deform/paint birden çok tile'a
      uygulanır.
- [ ] Brush'lar tile sınırında kesintisiz; brush birden çok yüklü olmayan
      tile'a uzanıyorsa onları yükler.
- [ ] Kirli tile/hücre göstergesi, Save yalnız kirlileri yazar.
- [ ] Editör smoke'u: yeni dünya oluştur → iki tile arasında sculpt → kaydet
      → yeniden aç → aynı yükseklik.

## Faz 9 — Yapay zekâ navigasyonu (tile'lı nav)

- [ ] Nav grid'i `main` hücreleriyle hizalı tile'lara bölünür; tile'lar
      yalnız AI ajanlarının ve oyuncunun etrafında (Unreal "Navigation
      Invoker") kurulur, `MAX_GRID_CELLS` tile başına uygulanır.
- [ ] Tile'lar arası yol: kaba tile grafiği + tile içi A*.
- [ ] Yüklü olmayan hücredeki AI'lar askıda (mevcut uzak güncelleme Hz'i ile
      uyumlu).

## Faz 10 — İsteğe bağlı genişletmeler

- [ ] Floating origin (8 km+): kamera/pawn orijinden belli mesafeyi geçince
      dünya kaydırılır; fizik, ses, VFX, AI koordinatları uyumlu.
- [ ] Data Layers: hücre içeriğini koşula göre aç/kapat (gündüz/gece,
      görev durumu).
- [ ] Delik maskesi (mağara girişleri) + ayrı mesh'lerle mağara.
- [ ] Runtime virtual texture benzeri uzak arazi albedo bake'i.

---

## Bağımlılıklar ve sıra

```
Faz 0 ──► Faz 1 ──► Faz 2 ──► Faz 3 ──► Faz 4 ──► Faz 5 ──► Faz 6
                                  │                  │
                                  │                  └──► Faz 7 ──► Faz 9
                                  └──► TERRAIN_DEFORMATION Faz 1+
Faz 8: Faz 2'den sonra parça parça (her faz kendi editör minimumunu getirir)
```

- **Terrain Deformation planı** şu an tek trimesh'e ve tek Landscape'in
  katman ağırlıklarına dayanıyor. Faz 1'i (yüzey profili) bu planın Faz 3'ünden
  sonra `TerrainHeightQuery.layerWeightsAt` üzerinden yazılmalı. Toroidal iz
  alanı dünya koordinatında olduğu için akışla uyumlu.
- Faz 1–3 tamamlandığında **görünür kazanç** var: 2×2–4×4 tile'lık
  (1 km'ye kadar) dünyalar akışsız, LOD'lu ve heightfield fizikli çalışır.
  Asıl açık dünya Faz 4–5 ile gelir.

## Bütçe hedefleri (orta seviye masaüstü, 60 Hz, 4 km dünya)

| Kalem | Hedef |
|---|---|
| Arazi GPU süresi | < 3 ms |
| Arazi draw call | 1–3 (renk, gölge derinliği) |
| Akış ana thread işi | Kare başına ≤ 4 ms, ortalama < 1 ms |
| Tile aktivasyonu (doku + collider) | < 5 ms |
| Yüklü tile (render) | ≤ 64 slot (~25 MB GPU) |
| Bellek: hücre + tile verisi | < 300 MB JS heap |
| Boot → oynanabilir | Spawn çevresi yüklemesi < 3 s (yerel ağ) |
| Koşan oyuncu | Hiçbir hızda zeminden düşme yok (100 km/s araç dahil) |

## Riskler

| Risk | Etki | Azaltma |
|---|---|---|
| GPU displacement three.js gölge/malzeme hattıyla çakışır | Faz 2 gecikir | Faz 0 S1/S2; yedek CPU geomipmapping |
| Karakter hareketi üçgen listesine sıkı bağlı | Faz 3'te regresyon (merdiven/rampa) | `TerrainHeightQuery` önce, trimesh sonra; mevcut nav/merdiven testleri kapı |
| Bilinear `heightAt` ile collider üçgenleri arasındaki sapma (hücre başına en fazla burulma/4) | Ayak, foliage, raycast ve deformasyon izi birkaç cm hizasız | K3a: üçgen-birebir örnekleme + Rapier ışınıyla eşitlik testi |
| Akış takılmaları (hitch) | Oyun hissi bozulur | Worker, kare bütçesi, önceden yükleme (Loaded/Activated), `?debug` ölçümü |
| BeginPlay/EndPlay semantiği script'leri bozar | Fork'larda sürpriz | Yalnız `world.partition` açık level'larda; belge + test |
| Hücre dosyası çakışmaları (git) | Merge zorluğu | Hücre başına dosya, deterministik sıralı JSON |
| Dev sunucusu autosave (bkz. hafıza notu) çok dosya yazar | Kirli git durumu | Yalnız kirli hücre/tile yazılır |
| Eski Landscape fixture'ları ve fork'lar | Kırılma | 1×1 dönüşümü, parity smoke'u, fork'lar için upstream notu |
| Derinlik hassasiyeti | Uzakta z-fighting | Faz 0 S5, K7 |

## Açık sorular

1. **Hücreden çıkan dinamik durum:** oyuncu arabayı bırakıp 1 km uzaklaşırsa
   araç ne olur? Öneri: taşınmış dinamik actor'lerin durumu bellek içi hücre
   önbelleğinde ve save-game'de tutulur; araçlar her zaman "persistent
   runtime" kümesine terfi eder. Faz 5 başında karar.
2. **Tile çözünürlüğü:** varsayılan 1 m mi, yoksa 4 km dünyada 2 m + detay
   normal map mi? Faz 0 S1 bütçesine göre.
3. **Katman sayısı:** 8 yeterli mi, yoksa katman başına ayrı ağırlık dokusu
   (Unreal gibi sınırsız) mı?
4. **Editör büyük dünyayı ne kadar yükler?** Varsayılan menzil ve "tüm dünyayı
   yükle" seçeneğinin bellek sınırı.
5. **HLOD üretimi** dev sunucusunda mı (Save sonrası arka plan), yoksa yalnız
   `world:build` ile mi?
