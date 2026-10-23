# Açık Dünya Planı (World Partition + Terrain LOD)

**2026-10-23 — Landscape genişletme:** Details → World Terrain → **Expand to
World Terrain…**, mevcut 65/129/257 vertex'li kare ve rotasyonsuz Landscape'i
seçilen tile konumunda koruyarak en az iki tile'a genişletir. Vertex üst sınırı
yeni World Terrain oluşturma ile aynıdır. Spline veya bağlı River Water varsa
işlem gerekçesiyle engellenir; resample yapılmaz. Yeni yükseklikler en yakın
kenar/köşeden uzatılır; yeni boya katman 0'dır, ortak sınır vertex'leri özgün
boyayı da korur. Origin eski tile'ın dünya konumunu ve Y datumunu korur;
katmanlar/materyaller taşınır, dünya koordinatlı foliage yerleşimleri değişmez.
Tek undo/redo komutu actor kimliğini korur; level'a ait terrain yolu kullanılır
ve tüm tile'lar kayıt için kirli işaretlenir. Özgün tile doğrudan mevcut
`legacyLandscapeToWorldTerrain` dönüşümünden alınır: “tam koruma”, aynı
Landscape'in 1×1 kaydındaki Float32 yükseklikleri ve RGBA8 boya baytlarıyla
birebir eşitliktir. Yeni tile'lar da Float32/RGBA8 kullanır; kayıt sonrası
dikişleri aynı tutmak için tüm tile'lar mevcut `f32` biçiminde kaydedilir.
FTIL biçimi değişmez. Dönüşüm eşitliği, kayıt/okuma, dikiş, konum ve fırça
undo davranışı engine testlerinde, editör akışı `tests/smoke/terrain-expand.spec.ts`
ile denetlenir. Bilinen yan etki: genişletip Save sonrası undo yapılırsa 1×1
tanım yeniden yazılır, eklenen tile dosyaları `.tiles/` altında sahipsiz kalır
(zararsız; budama yalnız referanssız tanımları siler).

> Durum: **Faz 1 tamam** (2026-10-22,
> dal `feat/open-world`). Ortak tanım/ikili loader, legacy okuma dönüşümü,
> kayıt uçları ve editör migrasyonu bağlı. RuntimeParity ve iki starter fixture
> yeni formatta. **Faz 0 tamam:** S1–S6 ölçüldü, GPU CDLOD onaylandı,
> K7 reversed-Z + float derinlik. Spike sayfaları merge öncesi silindi;
> son halleri `035a659` commit'inde (`git show 035a659:spikes/terrain-cdlod/terrainMaterial.ts`,
> `git checkout 035a659 -- spikes` ile geri gelir). Belgede geçen `spikes/…`
> yolları o commit'e aittir. **Faz 2 renderer'ının ilk dilimi (2026-10-23, dal
> `feat/terrain-renderer`):** 1×1 Landscape'ler GPU CDLOD renderer'ıyla çiziliyor;
> görsel karşılaştırma kullanıcı tarafından onaylandı ve eski chunk mesh
> renderer'ı kaldırıldı. **Çok-tile renderer çekirdeği tamam (2026-10-23):**
> slot havuzu + kameraya göre yerleşim + global harita + delikler; 3×2 tile'lık
> GPU smoke'unda dikiş çatlağı 0. **Editör/runtime çok-tile yüklemesi tamam
> (2026-10-23):** çok-tile World Terrain'e başvuran bir Landscape actor'ü iki
> uygulamada da çiziliyor, editörde seçiliyor/odaklanıyor (görünüm-yalnız),
> Save referansı olduğu gibi koruyor, runtime tile başına trimesh ile çarpışıyor.
> Sonraki iş editörde çok-tile sculpt/paint.
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
- **Dosyalar:** `levels/<World>/terrain/<name>.terrain.json` (grid tanımı, katmanlar,
  tile listesi + tile başına min/max yükseklik ve bayt boyu) ve tile başına
  bir ikili dosya `<name>.tiles/x_z.tile.bin` (başlık + height + weight blokları).
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

**S1 sonucu — masaüstü (2026-10-22).** GPU CDLOD yolu masaüstünde
**onaylandı**; yedek plan (CPU geomipmapping) gerekmiyor. Ölçüm: kullanıcının
Chrome 155'i, RTX 3060 / D3D11, 1920×1080, dpr 1, 80 slot `R16`, patch 32,
`range0` 128 m, gölge 2048² ±160 m:

| Faz (B ölçümü) | Arazi GPU ort. | Arazi GPU p95 | Düğüm (ort./en çok) | Üçgen (en çok) |
|---|---|---|---|---|
| Alçak uçuş, 25 m, ~300 m/s | 0.77 ms | 1.02 ms | 181 / 206 | 0.84 M |
| Yüksek yörünge, 450 m | 0.68 ms | 1.08 ms | 90 / 182 | 0.75 M |
| Yer koşusu, 2 m, ~100 km/sa | 0.90 ms | 1.00 ms | 177 / 186 | 0.76 M |

Arazi GPU = faz GPU − arazisiz taban (0.07 ms); tüm kare GPU'su en çok
1.49 ms. Arazi 2 draw call (renk + gölge). Düğüm seçimi 0.14–0.19 ms CPU.
Arazi GPU belleği ≈ 35 MB (80 slot; height 10.1 + weight 20.2 + global 0.4 +
katman dokuları 4.0 MB), gölge haritası 16 MB. Komşu LOD farkı ≥ 2 olan kenar
her karede 0. Yörüngede (~430 m/s) 1 düğüm bir anlığına slotu yüklenmemiş
tile'a düştü (yükleme kuyruğu kare başına 2 tile); Faz 4'te önceden yükleme
halkası bunu kapatır. Kapı (< 3 ms, çatlak yok) yaklaşık 3 kat payla geçti.
Kullanıcı görsel olarak dikiş, pop ya da gölge sorunu görmedi. Laptop
ölçümü yapılamadı (cihaz yok); düşük kalite profili için ilk gerçek
laptop/mobil ölçümünde patch, `range0` ve slot sayısı yeniden ayarlanır, GPU
yolu değişmez.

**S1/S2 bulguları (2026-10-22, `spikes/terrain-cdlod`).** Denemenin ortaya
çıkardığı tasarım gerçekleri; Faz 2'de uygulanır:

- **Residency yarıçapı LOD menzillerinden çıkar.** `range0 = 4 × leaf`
  seçilince tile boyundaki düğümlerin menzili her zaman **4 tile** olur
  (`range[tileLevel] = 4 × tileSize`, patch boyundan bağımsız). Bu menzil
  içindeki her tile yüklü olmalı, yoksa o düğümler global haritaya düşer ve
  komşusuyla çatlar. Kare çevresinde kutu mesafesi < r olan tile sayısı
  `1 + 4r + πr²` → r = 4 için **67 tile**. Bu yüzden 64 slot yetmiyor;
  histerezis payıyla **80 slot** (≈ 30 MB height + weight) varsayılan oldu.
  Bütçe tablosundaki "≤ 64 slot (~25 MB)" buna göre güncellenmeli ya da
  ağırlık dokusu yarım çözünürlüğe inmeli.
- **`range0` alt sınırı 3B düğüm köşegeninden gelir.** LOD farkının ≤ 1
  kalması için `range[k] − range[k−1]`, k seviyesindeki düğümün 3B
  köşegeninden büyük olmalı: `range0/leaf > 2·√(2 + (H/boy)²)` (H: düğüm
  içindeki yükseklik farkı). Oran 3 yalnız alçak rölyefte güvenli; oran 4,
  H/boy ≤ 1.41'e kadar dik dağları taşıyor. `terrainLod.ts` bunu doğrulamalı
  ve test etmeli. Denemede dağlık 4 km dünyada komşu LOD farkı ≥ 2 olan kenar
  sayısı her karede 0.
- **Global harita nokta örneklemeli ve tile'ın bir üst seviyesinin gridinde
  olmalı** (stride = `2 · tileQuads / patchQuads` vertex; 32'lik patch'te
  16 m). Böylece tamamen morph olmuş tile-boyu düğüm, global haritayı okuyan
  komşusuyla aynı yükseklikleri görür. Aynı seviyedeki düğümler yükseklik
  kaynağını karıştıramaz (morph mesafesi örneklenen yüksekliğe bağlı).
- **Yükseklik dokusu formatı:** Chrome/D3D11'de `EXT_texture_norm16` var;
  `R16` normalized doku filtrelenebiliyor ve tile dosyasındaki Uint16 veri
  **dönüştürülmeden** yükleniyor (2 B/texel). Yoksa `R32F` (+
  `OES_texture_float_linear`), en son `R16F` (1 km aralıkta ~0.5 m adım,
  kayıplı). SwiftShader'da norm16 yok, `R32F` yolu çalıştı.
- **Dik yüzlerde düzlemsel UV dokuyu geriyor** (kaya katmanında belirgin
  çizgiler). K2'deki "isteğe bağlı triplanar" kaya katmanı için varsayılan
  olmalı.
- **Normal:** fragment'ta yükseklik dokusundan merkezi fark çalışıyor. Tile
  kenarında tek taraflı farka geçiliyor (hafif ışık dikişi olabilir); tile'dan
  büyük düğümler 16 m'lik global haritanın normalini kullanıyor (uzakta daha
  yumuşak). Faz 2'de tile'a 1 texel'lik apron ya da komşu slot örneklemesi
  değerlendirilecek.
- **three r184 gölge haritasını `info.reset()`'ten önce çiziyor**, bu yüzden
  `renderer.info.render.calls` gölge pass'ini saymıyor. Forge'un `?debug`
  draw call sayısı (`readRenderStats`) da gölge çizimlerini eksik gösteriyor.
  Denemede `info.autoReset = false` + kare başında elle `reset()`.

### K3 — Fizik: tile başına Rapier heightfield + analitik zemin sorgusu

- Her aktif tile bir **Rapier heightfield collider**'ı ile çarpışır
  (`ColliderDesc.heightfield`, sütun-öncelikli `Float32Array`). Trimesh'e göre
  bellek ve kurulum maliyeti çok küçüktür. Fizik yalnız **fizik menzili**
  (varsayılan 384 m) içindeki tile'lar için kurulur; render menzili çok daha
  geniştir.
  *S4 ile ölçüldü:* 257² tile kurulumu ~0.5 ms (şekil 0.25 + collider
  0.22 ms), silme ~0.01 ms; aynı tile'ın trimesh'i 74 ms. Collider'lar
  **`HeightFieldFlags.FIX_INTERNAL_EDGES`** ile kurulmalı: bayraksız
  heightfield'da yuvarlanan top iç kenarlarda 6 m/s'ye varan dikey sıçrama
  yapıyor; bayrakla 2×2 tile, tek parça heightfield'la dikişte ve köşede
  birebir aynı davranıyor (fark 0.0 cm).
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
  *S6 ile doğrulandı (2026-10-22):* `new Worker(new URL(…, import.meta.url),
  { type: "module" })` projenin kendi Vite ayarlarıyla ayrı bir chunk'a
  derleniyor (`@engine` importları içine paketleniyor, `manualChunks` worker'a
  uygulanmıyor), `verify:dist --strict` geçiyor ve production önizlemesinde
  çalışıyor. Varsayılan `worker.format` IIFE; worker kodu ileride dinamik
  import kullanırsa `vite.config.ts`'e `worker: { format: "es" }` eklenmeli.

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

**Karar (2026-10-22, S5).** Açık dünya level'larında **reversed-Z + float32
derinlik**, sahnenin çizildiği render target üzerinde. Forge zaten her kareyi
`EffectComposer` ile bir target'a çiziyor (`PostProcessPipeline`, RenderPass →
OutputPass); o target'a `DepthTexture(FloatType)` (DEPTH_COMPONENT32F) verilir
ve renderer `reversedDepthBuffer: true` ile kurulur. `EXT_clip_control` yoksa
yedek `logarithmicDepthBuffer`. Küçük level'lar (far 300 m) bugünkü standart
derinlikte kalır: near 0.1 ile 300 m'de çözünürlük ~5 cm.

Ölçüm (S1 sayfası **Z** testi, RTX 3060 / Chrome 149 headless, 1080p, near
0.1 m, far 6 km). Değer: önündeki mavi düzlemin `gap` m arkasındaki kırmızı
düzlemin kazandığı piksel yüzdesi; 0 = ayrılıyor, > 0 = z-fighting:

| Mod | 1 m aralık | 10 m aralık | Arazi GPU (B, ort.) |
|---|---|---|---|
| Standart, 24-bit (bugünkü) | 2 km'de %32, 5.8 km'de %100 | 5.8 km'de %25 | 0.82–1.14 ms |
| `reversedDepthBuffer`, tuval derinliği | 2 km'de %55, 4 km'den sonra %100 | 5.8 km'de %23 | — |
| `logarithmicDepthBuffer` | her mesafede %0 (1 cm dahil) | %0 | 1.00–1.38 ms (+%20–40) |
| reversed + float32 target | her mesafede %0 (1 cm dahil) | %0 | 1.00–1.26 ms (+ target/blit 0.5 ms*) |

\* Denemede target + ekrana kopya ayrıca 0.5 ms tutuyor; Forge bu target'ı
zaten kullandığı için gerçek ek maliyet yalnız derinlik formatı farkı
(D24 → D32F). Ölçümler arası gürültü ±%20.

Bulgular:

- **Tuval üzerinde reversed-Z işe yaramaz.** Varsayılan WebGL framebuffer'ı
  24-bit sabit noktalı derinlik veriyor; reversed-Z'nin kazancı float
  derinlikten gelir. Bu yüzden yalnız `reversedDepthBuffer: true` demek
  standarttan bile kötü sonuç verdi.
- three'de `capabilities.reversedDepthBuffer`, uzantı desteğini değil
  "istendi ve destekleniyor" bilgisini verir; destek
  `getSupportedExtensions()` ile sorulmalı. (İlk ön veri notu bu yüzden
  yanlıştı: Chrome/D3D11'de `EXT_clip_control` **var**.)
- **Gölge bias'ının işareti ters döner.** Reversed derinlikte Forge'un negatif
  bias'ı (`lights.ts`, −0.0005; denemede −0.0004) güneşe bakan yüzlerde
  kendine gölge lekesi üretiyor; 0 ya da +0.0004 temiz. Faz 7'de bias
  reversed modda otomatik ters çevrilmeli (ya da mod başına değer).
- **Derinlik okuyan pass'ler denetlenmeli:** `GTAOPass` ve `BokehPass` (DOF)
  kendi derinliklerini okuyor; reversed + float derinlikle doğrulanmaları
  Faz 7'ye eklenir. Forge'un kendi kodunda derinlik okuyan shader yok.
- Log derinlik `gl_FragDepth` yazdığı için erken derinlik testini kapatıyor;
  maliyet arazi gibi çok pikselli yüzeylerde büyüyor. Bu yüzden yalnız yedek.

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

- [x] **S1 GPU CDLOD:** 16×16 tile (4 km), `DataArrayTexture` havuzu, tek
      instanced draw, morph. Ölçüm: orta laptop ve masaüstünde kare süresi,
      draw call, GPU belleği. Kapı: < 3 ms GPU (arazi), çatlak/pop yok.
      *Deneme hazır (2026-10-22):* `spikes/terrain-cdlod` (açılış ve URL
      ayarları `spikes/README.md`'de). Tile'lar Faz 1 kodekinden geçiyor,
      80 slot `R16` havuzu, 32 quad'lık patch, `range0` 128 m, 8 LOD, tek
      instanced draw + gölge pass'i. **B** tuşu 33 s'lik betikli ölçüm yapar
      (alçak uçuş, yüksek yörünge, yer koşusu, arazisiz taban) ve rapor verir.
      *Masaüstü geçti (2026-10-22, kullanıcının Chrome 155'i, RTX 3060,
      1080p):* arazi GPU ort. 0.68–0.90 ms, p95 ≤ 1.08 ms; arazi 2 draw
      call; en çok 0.84 M üçgen; arazi GPU belleği ≈ 35 MB; komşu LOD farkı
      ≥ 2 olan kenar 0. Ayrıntılı tablo K2'de. Görsel onay verildi
      (dikiş/pop yok). Laptop yok; düşük profil ölçümü ilk uygun cihazda.
- [x] **S2 Malzeme uyumu:** displacement + mevcut splat `onBeforeCompile` +
      gölge alma + `customDepthMaterial` ile kendine gölge, three r184'te.
      *Teknik olarak çalışıyor (2026-10-22, aynı sayfa):* Landscape splat
      bloğu (4 `sampler2D` katman + renk yedeği) ağırlıkları slot dokusundan,
      UV'yi dünya metresinden alıyor; uzak tekrar kırma ve piksel başına
      normal var. Kutuların gölgesi displaced araziye doğru düşüyor ve kutular
      `terrainHeightAt` ile tam yüzeyde duruyor. Arazinin kendine gölgesi
      `customDepthMaterial` ile açılıp kapanıyor (LOD kamerası uniform'u
      sayesinde gölge pass'i aynı geometriyi çiziyor). Kullanıcı görsel
      olarak onayladı (2026-10-22).
- [x] **S3 Doku yükleme:** 257² Uint16 + 2× RGBA8 slot güncellemesi
      (`addLayerUpdate`) süresi. Kapı: tile başına < 2 ms ana thread.
      *Geçti (2026-10-22, S1 sayfası `?layers=8` + **U** stres tuşu: 80
      yüklü tile'ı tek karede yeniden yükler; headless Chromium, RTX 3060,
      üç koşu):* 8 katman (Uint16 height + 2× RGBA8 = 0.6 MB/tile) tile
      başına **ort. 0.34 ms, p95 ≤ 0.6 ms, en kötü 1.1 ms**; 4 katmanda
      ort. 0.18 ms. Sürenin yarısı three'nin istediği CPU ayna dizisine
      kopya (`DataArrayTexture.image.data`), yarısı `texSubImage3D`.
      Sonuçlar: (1) akış bütçesinde kare başına ~8 tile yüklemesi ≈ 3 ms
      (K4'teki 4 ms dilimine sığar; 80 tile'ı tek karede yüklemek 27 ms);
      (2) Faz 2'de ayna kopyası, `texSubImage3D`'yi tile baytlarından
      doğrudan çağıran küçük bir yükleyiciyle kaldırılabilir (three'nin
      `layerUpdates` yolu tüm diziyi CPU'da ister). Laptop ölçümü yok.
- [x] **S4 Rapier heightfield:** 257² tile collider oluşturma/silme süresi ve
      karakter + araç davranışı (kenar geçişi, iki tile arası dikiş).
      X ≠ Z boyutlu tile'da indeks sırası ve köşegen yönü tekrar
      doğrulanır (K3a). Kapı: oluşturma < 3 ms.
      *Kısmen (2026-10-22):* 3×2 quad'lık alanda indeks
      `vx·(nrows+1) + vz` ve tek köşesi yükseltilmiş hücrelerde `b–c`
      köşegeni doğrulandı; `terrainTileHeightfieldShape` bu düzeni üretiyor.
      *Tamam (2026-10-22, `spikes/terrain-physics`, Rapier 0.19.3, headless
      Chromium):* (A) gerçek kodek tile'larıyla şekil kurma ort. 0.25 ms +
      `createRigidBody`/`createCollider` ort. 0.22 ms (en kötü 0.5 ms),
      silme 0.01 ms; 16 tile ekledikten sonraki ilk `step` 0.2 ms. Aynı
      tile'ın trimesh'i (bugünkü Landscape collider) 74 ms. (B) 4×4 tile
      üzerinde 53 173 aşağı ışın (dikiş çizgileri 0.25 m arayla, dikişin
      ±0.1 mm yanı, iç köşeler, 4000 rastgele): **kaçırma 0**, en büyük
      `terrainHeightAt` farkı 0.2 mm. (C) dikiş ve köşeden geçen top ve
      Forge'un referans aracı, tek parça 512 q heightfield'lı kontrol
      dünyasıyla adım adım kıyaslandı: araç (ışınlı tekerlek) dikişte hiç
      etkilenmiyor (fark 0.00 cm, süspansiyon değişimi 0.02 cm); top
      `FIX_INTERNAL_EDGES` ile kontrolle birebir aynı, bayraksız iki dünya
      da iç kenarlarda zıplıyor (bkz. K3). Karakter: Forge karakteri Rapier
      temasını değil kendi üçgen probunu kullanıyor (K3); heightfield'dan
      üretilecek üçgenlerin dikiş davranışı Faz 3'ün merdiven/rampa
      testleriyle doğrulanır, (B) bunun veri tarafını kapsıyor.
- [x] **S5 Derinlik:** far 6 km'de `reversedDepthBuffer` desteği ve
      z-fighting; yedek seçeneklerin maliyeti (K7).
      *Tamam (2026-10-22):* S1 sayfasına `?depth=standard|reversed|log|
      reversed-float`, `?near=`, `?shadowBias=` ve **Z** z-fighting testi
      eklendi. Chrome/D3D11'de `EXT_clip_control` var. Sonuç ve karar K7'de:
      reversed-Z + float32 derinlikli sahne target'ı; yedek log derinlik.
- [x] **S6 Worker:** Vite'ta modül worker'ı build'e girip `verify:dist`'ten
      geçiyor mu; tile çözme süresi; `transfer` ile kopyasız aktarım.
      *Tamam (2026-10-22):* `spikes/terrain-worker` (sayfa + worker +
      `vite.build.config.ts`: ana config'i miras alan, `dist/` dışına yazan
      ayrı build). Build: worker 2 KB'lık ayrı chunk, `verify:dist --strict`
      PASS, production önizlemede çalışıyor. Ölçüm (headless Chromium, 12
      çekirdek, 64 tile × 0.63 MB, 8 katman; dev ve prod aynı):
      ana thread'de çözme tile başına ort. 0.39–0.43 ms (en kötü 1.5 ms);
      `postMessage` transfer'le ort. 0.01–0.08 ms, structured clone ile
      0.15–0.18 ms; transfer sonrası gönderenin buffer'ı boşalıyor (kopya
      yok); ana thread'in sonucu teslim alması ort. 0.01–0.02 ms; sonuç ana
      thread çözmesiyle birebir aynı. Throughput: 1 worker 1.4 ms/tile,
      4 worker 0.73 ms/tile (64 tile 46 ms). Worker içinde çözme ilk
      tile'larda 1.3 ms (yeni isolate'te JIT soğuk). Sonuç: K4'ün worker
      planı geçerli; çözme zaten ucuz olduğu için worker'ın asıl kazancı
      fetch + çözme + global harita + çim örneklemenin hepsini ana
      thread'den almak. Kodek çözmesi `DataView` yerine hizalı
      `Uint16Array` görünümüyle ayrıca hızlandırılabilir (küçük iş).
      *Tamam (2026-10-23): encode/decode hizalı `Uint16Array` yolunu kullanır;
      hizasız girişte veya big-endian platformda `DataView` yedeği korunur.
      İkili biçim değişmedi; rastgele tile'larda eski DataView yoluyla eşitlik testli.*
- [x] Kararlar kaydedildi. S1/S2 başarısızsa K2 yedek planına (CPU
      geomipmapping) geçildiği yazıldı. *(2026-10-22: S1/S2 geçti, yedek
      plana geçilmedi. K2 sonuç tablosu ve bulgular, K3'e S4 notu, K4'e
      worker notu, K7 kararı yazıldı.)*

**Faz 0 yan bulgusu (main'i ilgilendiriyor):** Forge'un bugünkü trimesh
collider'ları (`physicsSubsystem.ts`, `ColliderDesc.trimesh(vertices,
indices)`) hiçbir bayrak kullanmıyor. S4'teki ölçüme göre bu, Landscape ve
trimesh yüzeylerde yuvarlanan dinamik cisimlerin (top, sahne objesi) iç
kenarlarda zıplaması demek. `TriMeshFlags.FIX_INTERNAL_EDGES` ayrı ve genel
bir düzeltme olarak main'de değerlendirilmeli (minigolf gibi fork'ları
etkiler); bu plan kapsamında değiştirilmedi.

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
- [x] Legacy dönüşüm: `LayoutLandscape` + `*.landscape.json` → 1×1 terrain
      (bellekte, okuma sırasında). Splines ve River Water referansları korunur.
      `terrainDocument.ts` ortak okuma yolu `terrainLegacy.ts` dönüşümünü
      1×1 adaptörüne bağlar; spline kimlikleri ve actor/river referansları korunur.
- [x] Kayıt: `/__save-terrain` (`*.terrain.json`, JSON) ve
      `/__save-terrain-tile` (ham ikili gövde, boyut ve başlık doğrulamalı).
      `saveValidator`'a 5. yüzey; `droppedFields` kapsamı.
- [x] Editörde legacy Landscape kaydedildiğinde yeni formatta yazılır
      (tek yönlü migrasyon, eski dosya korunur). `public/` fixture'ları
      ve `RuntimeParity` güncellenir.
- [x] Engine testleri: kodek, örnekleme, dönüşüm, validator.
- [x] CLAUDE.md: 5. allowlist yüzeyi notu.

**Uygulama notu (2026-10-22).** Dosya düzeni `<name>.terrain.json` +
`<name>.tiles/x_z.tile.bin`. `terrainDefinition.ts` runtime/save ortak allowlist;
spline allowlist'i engine'e çıkarıldı ve legacy validator da aynı işlevi kullanır.
Binary uç ham gövdeyi boyut/başlık/koordinat/sonlu örnek bakımından denetler;
tanım ucu listedeki tüm tile'ları diskten okuyup tanımla eşleştirir. Uçlar mevcut
local-only ayrıcalık korumasındadır. Bilinmeyen alanlar `dropped[]` içinde
raporlanır; editör bu yanıtı başarılı kayıt saymaz.

Editör snapshot'ı ilk await'ten önce alır. İlk migrasyonda tile ve tanım
başarılı olmadan level'ın yeni referansı yayımlanmaz; in-memory referans da level
kaydı başarılı olunca değişir. Eski dosya korunur, kısmi hatada retry mümkündür.
Sonraki sculpt/boya kayıtları ikili formata gider; actor konumu/çarpışması değişirse
tanım da güncellenir. Float32 height kaydı mevcut collider vertex'lerini korur;
boya RGBA8 olarak quantize edilir. Bu dosyalar arası/disk kesintilerine karşı
transaction değildir (F01'in açık sınırı sürer).

**Faz sınırı:** generic eager loader tüm listeli tile'ları okuyabilir; mevcut
mesh/brush adaptörü yalnız 1×1 destekler. Çok-tile/hole içeren dünyayı render'a
bağlamak Faz 2/3'tür; adaptör veriyi daraltmak yerine hata verir. Rotasyon,
kare olmayan grid veya yeniden örnekleme gerektiren legacy veriler okuma sırasında
eski görünümüyle korunur; otomatik Save migrasyonu bunlarda açık hata verir,
sessiz geometri kaybına izin vermez. Doğrudan fixture migrasyonu yalnız Parity
ve iki starter level referansına uygulandı; eski parity JSON'u korundu.
Çalışma sırasında açık editör/başka oturum kaynaklı `LargeTerrain`, manifest,
varsayılan level ve Terrain referans değişiklikleri de gözlendi; bunlar geri
alınmadı. Başlangıçtaki `VehicleTrack.level.json` değişikliği korundu.

Nehirli migrasyon smoke'u mevcut okuma korumasındaki bir hatayı ortaya çıkardı:
`LayoutRiverWater` konumunu Landscape/spline'dan almasına rağmen `position`
zorunlu tutuluyordu. `readRoomLayout` bu koleksiyonda iki referansı doğrular;
başka actor'lerin zorunlu transform kontrolleri sürer. Engine regresyonu eklendi.

Doğrulama (2026-10-22):

- Tam `build:verify` geçti: **1.287 engine kontrolü**, 10 import, 5 fixture,
  10 release/URL testi; uygulama, smoke, content ve UI-test TypeScript kapıları,
  Vite production build ve sıkı runtime-only dist taraması dahil.
- Chromium'da game-starter, sculpt (kayıt sürerken undo + retry dahil), boya
  ve spline-chain smoke'ları geçti. Yeni terrain endpoint ve nehirli
  migrasyon/kayıt/reload/Play senaryoları son hedefli çalışmada **2/2 geçti**
  (46,4 s). İlk birleşik çalışmalardaki yanlış test level seçimi ve Outliner
  hazır olma beklentisi düzeltildi; forced click veya uygulama hatası filtresi yok.
- Editor/runtime ekran görüntüleri `test-results/terrain-migration-legacy-.../`
  altında alındı ve görüntülendi. Bu, headless işlevsel kanıttır; GPU performans
  kabulü değildir. Faz 0'daki kullanıcı GPU ölçümleri ayrı kanıt olarak korunur.
- Mevcut 5273 sunucusuna dokunulmadan kopya smoke projesi **5274** portunda
  çalıştırıldı. `FORGE_SMOKE_PORT` yalnız açık override; varsayılan 5273 kalır,
  5173 reddedilir. Kaynak fixture izolasyonunun 5 testi de geçti.
- `git diff --check` temiz. Bu oturum commit/push veya Codex Security taraması
  yapmadı. Yeni kayıt uçları için dar security-diff-scan önerisi ayrı onay bekler.

## Faz 2 — Terrain renderer (CDLOD) + editör araçlarının taşınması

- [ ] `terrainLod.ts`: quadtree seçimi, LOD menzilleri, morph faktörü
      (saf, test edilir: komşu düğüm LOD farkı ≤ 1, menzil monotonluğu).
      *Saf çekirdek hazır (2026-10-23): düğüm seçimi, 3B rölyef alt sınırı,
      morph ve yakın→uzak residency listesi testli. *Renderer'a bağlandı
      (2026-10-23):* seçim, `TerrainWorldHeightBounds` (tile başına piramit +
      tile aralıklarının toplamı) ile besleniyor; yerleşim
      `terrainResidentTileKeys` ile.
      Tam morph olmuş tile-seviyesi düğüm global haritayı kullanır; 67 tile
      yaklaşık değerdir, kesin sayı kamera konumuna bağlıdır.*
- [ ] `terrainTexturePool.ts`: slot ayırma/serbest bırakma, global düşük
      çözünürlüklü harita.
      *Saf slot ayırıcı `engine/terrain/terrainSlotPool.ts` hazır (2026-10-23):
      varsayılan 80 slot, serbest bırakılan veriyi önbellekte tutma ve en önce
      serbest bırakılanı tahliye etme testli.* *GPU tarafı bağlandı (2026-10-23,
      `terrainRenderer.ts`):* slot başına `DataArrayTexture` katmanı
      (`addLayerUpdate`), varsayılan 64 slot, kare başına 4 yükleme; bütün
      tile'lar sığıyorsa yerleşim hiç değişmez (1×1 Landscape).
      *Global harita saf çekirdeği hazır (2026-10-23): `terrainGlobalMap.ts`
      tüm dünya için tile'ın bir üst LOD gridinde (`2 · tileQuads / patchQuads`
      vertex stride) nokta örnekler; kirli tile dikdörtgenleri ve tile yükleme
      için artımlı güncelleme testli.* *GPU'ya bağlandı (2026-10-23):*
      `terrainRenderSource.ts` haritaya normal, delik işareti ve ağırlık ekliyor
      (tam çözünürlüklü vertex değerleri nokta örnekleniyor, slot↔harita
      geçişinde ışık/boya kaymıyor). Delik yükseklikleri GPU'da komşudan
      dolduruluyor, delik üç materyalde de `discard` ediliyor.
- [ ] `terrainRenderer.ts` + `terrainMaterial.ts`: instanced draw, dünya UV'li
      splat, `sampler2DArray` katmanlar, uzak tekrar kırma, view mode'lar,
      gölge alma, kalite profiline bağlı kendine gölge.
      *İlk dilim tamam (2026-10-23, `engine/render-three/terrain/`):* tek slot
      (1×1 Landscape) için instanced patch + morph, R32F yükseklik (`texelFetch`,
      morph ara noktalarında elle bilineer — float filtre eklentisi gerekmiyor),
      RG16F normal ve 2 blok RGBA8 ağırlık dokusu vertex çözünürlüğünde (legacy
      vertex attribute'larıyla aynı sonuç), 8 katman, lit/height/slope/layer
      view mode'ları, wireframe, gölge alma. CPU tarafı saf ve testli:
      `engine/terrain/terrainRenderData.ts` (normal formülü legacy ile birebir,
      node min/max piramidi). GTAO normal ve DOF derinlik geçişleri sahneyi
      override materyalle çizdiği için arazi o geçişlerde kendi
      `MeshNormalMaterial`/`MeshDepthMaterial` kopyasıyla çiziliyor
      (`renderSceneWithTerrainOverride`). LOD seçimi iki uygulamada da çizimden
      hemen önce kameraya göre (`updateLandscapeLod`; runtime'da `terrain` perf
      bölgesi).
      *Çok-tile çekirdeği tamam (2026-10-23):* renderer bir
      `TerrainRenderSource` çiziyor (World Terrain tile'ları ya da dolgulu tek
      tile'lık Landscape). `slot < 0` düğümler global haritadan okuyor (uzak
      düğümler ve slotu henüz olmayan tile'lar). Normaller tile dikişinde komşu
      tile'dan okunuyor; düzenleme dikişe değerse komşunun normalleri de
      yenileniyor. **Etek:** slot isteyip global haritadan çizilen bir düğüm
      bir slot düğümüne komşuysa kenarları iki kaynaktan okunduğu için ayrışabilir
      (tile akarken geçici); yalnız bu düğümler ve komşuları düğüm boyunun %5'i
      kadar etek sarkıtıyor, dünya sınırında hiç. Kalıcı durumda (kapasite
      yeterli) etek yok. Doğrulama: `tests/engine/terrainWorldRenderer.test.ts`
      ve `tests/smoke/terrain-world.spec.ts` (smoke'a özel sayfa
      `tests/smoke/pages/terrain-world.html`, oyun build'ine girmez; yukarıdan
      bakışta macenta arka planın arazi içinden görünmesi = çatlak, ölçülen 0).
      *Editör/runtime çok-tile yüklemesi tamam (2026-10-23):* okuma yolu
      `fetchTerrainActorDocument` (`src/scene/terrainDocument.ts`) tek (0, 0)
      tile'lık belgeyi eskisi gibi 1×1 `ForgeLandscapeData` köprüsüne, gerisini
      (`isMultiTileTerrain`) `{ kind: "world", document }` olarak döndürür;
      köprü çok-tile'ı yine reddeder, düz araziye düşüş yok (`landscapeItem`
      artık eksik veride hata atıyor). Çizim `createWorldTerrainObject`
      (`engine/render-three/landscape.ts`): `worldTerrainRenderSource` →
      `TerrainRenderer`. **Çerçeve:** `def.origin` tile (0, 0)'ın min köşesinin
      dünya konumu, actor grid'in merkezinde
      (`worldTerrainActorPosition` = origin + yarım genişlik; 1×1 köprüsündeki
      `origin = position − yarım genişlik` ile aynı ilişki, testli). World
      Terrain döndürülmez. Tanım kaynaktır: runtime actor transform'unu yok
      sayar, editör uyuşmayan actor'ü tanıma oturtup uyarır
      (`worldTerrainPlacementIssues`). Editör: arazi çizilir, seçilir, F ile
      odaklanır; transform kilitli (gizmo yok, Details konum/dönüş pasif,
      taşıma denemesi açık mesaj verir). Sculpt/paint/spline (seçili araziye
      tıklama) ve Details'teki katman/spline panelleri kapalı ve
      kullanıcıya durum mesajı/ipucu gösteriyor; Details yerine tile sayısı,
      boyut, tanım dosyası, View ve Collision gösteren görünüm-yalnız panel.
      *(Sculpt/paint ve elle foliage boyama sonradan açıldı; aşağıdaki maddelere bakın.)*
      Landscape foliage kuralları ve River Water çok-tile'da üretilmez
      (konsol uyarısı); spline'lar çizilmez. Kayıt: `EditorSaveSource.worldTerrainIds`
      bu actor'leri migrasyon ve terrain yazımından çıkarır, `dataRef` olduğu
      gibi kalır (testli; smoke'ta tanım ve tile baytları Save sonrası aynı).
      Doğrulama: `tests/engine/worldTerrainActor.test.ts` (çerçeve, render
      raycast = `terrainHeightAt`, çarpışma entity'leri, PhysicsSubsystem zemini,
      okuma yolu), `editorSaveCoordinator` kayıt koruması ve
      `tests/smoke/terrain-multitile.spec.ts` (3×2 + delik, gökyüzüsüz fikstür;
      editör görüntü + boş kare kontrolü, seçim/F/uyarı/Save, Play'de pawn
      arazi yüksekliğinde duruyor: 5,70 m'ye karşı 5,698 m).
      **Açık:** node frustum culling, uzak tekrar kırma ve kendine gölge
      (legacy de gölge düşürmüyor; parite için kapalı), dirty-rect doku
      yüklemesi (şimdilik tüm katman), tile akışının Faz 4 alt sistemine
      bağlanması (şimdilik bütün tile'lar CPU'da yüklü).
- [x] Eski `engine/render-three/landscape.ts` chunk renderer'ı kaldırılır;
      `RuntimeSceneApp` ve `SceneApp` yeni renderer'ı kullanır.
      *Tamam (2026-10-23):* görsel onaydan sonra chunk mesh, splat materyali ve
      `?terrainRenderer` bayrağı silindi. Her legacy grid boyutu (her eksende
      65–257, kare olmak zorunda değil) yeni renderer'la çiziliyor: dokular bir
      sonraki 2'nin kuvvetine kenar tekrarıyla dolduruluyor, vertex'ler ve
      raycast yazılmış X/Z sınırında kırpılıyor; yazılmış veri yeniden
      örneklenmiyor.
- [ ] Seçim ve brush hover: CPU heightfield raycast (`scenePicker`,
      foliage boyama, landscape brush cursor).
      *1×1 için tamam (2026-10-23):* terrain mesh'inin `raycast`'i
      `raycastTerrain`'e gidiyor; picker, brush, foliage ve yüzeye yerleştirme
      değişmeden çalışıyor. Engine testi rastgele ışınlarda (döndürülmüş arazi
      dahil) legacy mesh ile aynı nokta/mesafe/normal'i doğruluyor.
- [ ] Sculpt/paint: `terrainEdit.ts` ile çok-tile'lı brush, kenar vertex
      senkronu, kirli dikdörtgen doku yüklemesi. Undo artık tüm diziyi değil,
      tile başına kirli dikdörtgenin önce/sonra yamasını saklar.
      *Saf düzenleme çekirdeği hazır (2026-10-23): `terrainEdit.ts` Float32
      çalışma kopyası, ortak legacy fırça matematiğiyle çok-tile sculpt/paint,
      kenar/köşe senkronu, 8 katman RGBA8 normalizasyonu, dar kirli dikdörtgen,
      alanla orantılı undo/redo ve min/max güncellemesi testli. Kalan: editör
      bağlantısı, GPU yüklemeleri ve heightmap import/export.*
      *Editöre bağlandı (2026-10-23):* çok-tile World Terrain'de Sculpt
      (raise/lower/smooth/flatten) ve Paint (paint/erase/smooth weights)
      çalışıyor. Editör yüklemede tile'ları `createTerrainEditWorld` ile tek
      kopyaya alıyor; renderer aynı tile nesnelerini çizdiği için dab veri
      kopyalamıyor, yalnız `applyTerrainBrush`'ın kirli tile dikdörtgenleri
      `TerrainRenderer.updateTile`'a gidiyor (komşu dikiş normalleri, düğüm
      sınırları, global harita ve picking dahil). Fırça yüksekliği ve Flatten
      hedefi datum'a (`origin[1]`) göre, 1×1'deki actor-yerel Y ile aynı anlam.
      Undo bir stroke'un dab yamalarını (`TerrainUndoPatch`) saklıyor; belge
      nesnesine bağlı olduğu için silme + undo kaydedilmemiş düzenlemeleri
      koruyor, yeniden yükleme sonrası eski komut hiçbir şey yapmıyor.
      **Kayıt:** `WorldTerrainEditSession` (`src/editor/terrainStore.ts`) tile
      başına revizyon tutar; Save yalnız kirli tile'ları, her birini yüklendiği
      yükseklik formatında (`u16`/`f32`), sonra tanımı yazar
      (`captureWorldTerrainSave`, `engine/terrain/worldTerrainSave.ts`). Yazım
      sırasında yeniden düzenlenen tile kirli kalır. Düzenleme tanımın
      `heightMin..heightMax` aralığından çıkarsa aralık tam metreye ve 1 m
      payla genişler ve **bütün** tile'lar yeniden yazılır (tile başlıkları
      tanımla eşleşmek zorunda); `u16` tile'lar bu durumda yeni adımla yeniden
      nicemlenir (yarım adım ≈ 4 mm/512 m aralık). **Karar:** çok-tile arazi
      `dataRef`'inde yerinde yazılır, 1×1'deki gibi seviye klasörüne
      çatallanmaz — bütün tile grid'ini kopyalamak büyük dünyada pahalı; aynı
      tanımı paylaşan iki seviye düzenlemeyi birlikte görür. Details paneli
      Sculpt/Paint araçlarını, katman listesini, fırça ayarlarını ve View'ı
      gösteriyor; katman materyali atama artık açık. **Hâlâ kapalı:** spline'lar (uyarı),
      Fill Layer, yeniden boyutlandırma ve heightmap import/export.
      Elle foliage Paint/Erase/Single/Fill/Select araçları çok-tile yüzeyinde çalışır;
      yükseklik/normal raycast'ten gelir, boş tile'a düzlem fallback'i yapılmaz.
      Aynı `landscape` hedefi ve foliage sidecar'ı Save/Load/Play'de kullanılır;
      prosedürel Landscape foliage kuralları Faz 6'ya kadar kapalıdır.
      **Açık (perf):** GPU'ya dab başına tile katmanının
      tamamı ve global haritanın tamamı yükleniyor (CPU normalleri
      dikdörtgenle sınırlı); dikişe değen dab komşu tile'ın normallerini
      baştan hesaplıyor. Doğrulama: `tests/engine/worldTerrainActor.test.ts`
      (dikiş üstü dab yalnız iki tile'ı, formatıyla ve doğrulanarak kaydeder;
      aralık genişlemesi), `editorSaveCoordinator` (yalnız kirli tile + tanım,
      yerinde; yazım sırasında yeni düzenleme kirli kalır) ve
      `tests/smoke/terrain-multitile.spec.ts` (dikiş üstünde Raise stroke →
      autosave yalnız (0,0) ve (1,0)'ı yazar, dikiş satırları eşit; undo iki
      tile'ın baytlarını birebir geri getirir; redo sonrası Play'de pawn
      arazide).
- [x] Editörde çok-tile World Terrain oluşturma (2026-10-23): Add Actor →
      Terrain → **World Terrain** bir diyalog açar (ad, Tiles X/Z, tile
      çözünürlüğü 64/128/256 quad, vertex aralığı 0,25–8 m, taban yüksekliği);
      dünya boyu, tile/vertex sayısı, disk ve editör belleği canlı gösterilir,
      geçersiz seçenekte Create pasif. `createFlatWorldTerrain`
      (`engine/terrain/worldTerrainCreate.ts`) düz, deliksiz, dünya merkezli
      grid kurar (varsayılan dört katman, ±256 m aralık, yeni tile'lar `u16`).
      Sınırlar: en az 2 tile (tek tile Landscape'tir; 1×1 tanım okumada köprüye
      gider) ve en fazla 64 × 257² vertex — Faz 4 akışı gelene kadar editör
      bütün tile'ları bellekte tutuyor ve runtime tile başına trimesh kuruyor.
      Seviye başına tek Landscape kuralı World Terrain için de geçerli. Kayıt
      sırası değişti: World Terrain tile'ları ve tanımı artık **layout'tan
      önce** yazılıyor, seviye diskte olmayan araziyi hiç göstermiyor. Silme
      sonrası Save seviye-sahipli terrain'i budadığı için actor geri eklenince
      (undo/redo) bütün tile'ları kirli sayılıyor. Doğrulama: engine
      (geçerli tanım + tile doğrulaması, ret nedenleri, layout'tan önce yazım)
      ve `tests/smoke/terrain-create.spec.ts` (diyalog ret/kabul, u16 tile'lar
      ve tanım seviye klasöründe, undo budar / redo yeniden yazar, yeniden
      yükleme, Play'de pawn 2 m taban yüksekliğinde).
- [ ] Heightmap import/export: 16-bit PNG ve RAW, dünya boyunda; tile'lara
      bölme `terrainImport.ts`'de (büyük import worker'da, Faz 4'ten sonra).
      *Saf RAW import/export + tile bölme hazır (2026-10-23): little/big-endian
      16-bit RAW okuma, little-endian export, kopyalı kenarlar ve min/max özetleri
      testli. Tile başına generator ilerleme sayacıyla worker'a taşınmaya hazır;
      16-bit PNG ve worker bağlantısı açık.*
      *RAW editöre bağlandı (2026-10-23):* World Terrain Details → Heightmap
      bölümünde `.raw`/`.r16` import, little/big-endian seçimi ve 0/65535'in
      karşılığı olan metre cinsinden min/max var (terrain origin Y'ye göre).
      Dosya tam `(tilesX × tileQuads + 1) × (tilesZ × tileQuads + 1)` u16
      örnek içermeli; yanlış boyut beklenen örnek/byte sayısıyla reddedilir,
      arazi değişmez. Import tek undo komutu: tile başına tam önce/sonra
      yaması, özet yenileme, renderer güncellemesi, kirli tile kaydı ve autosave;
      paint ağırlıkları korunur, delik tile'lar oluşturulmaz. Export tüm grid'i
      terrain adıyla little-endian RAW indirir; deliklerin kapsanmayan örnekleri
      0'dır, komşu tile kenarları korunur. Status satırı yeniden import için
      yükseklik aralığını verir; kaydedilmemiş aralık dışı tepeler de export'a
      girer. `tests/engine/terrainImport.test.ts`: delikli 2×2 u16 round-trip,
      dikiş eşitliği, tam undo/redo, paint korunumu ve yanlış boyut reddi.
      **Açık:** 16-bit PNG import/export ve büyük import'un worker'a taşınması.
- [x] Mevcut smoke'lar: `landscape-sculpt`, `landscape-paint`,
      `landscape-spline-chain`, `runtime-parity`, `game-starter` yeşil.
      *Tamam (2026-10-23):* yeni renderer varsayılanken bunlar ve
      `landscape-wireframe`, `terrain-*` smoke'ları yeşil.
- [x] Ekran görüntüsü karşılaştırması: legacy landscape eski ve yeni
      renderer'da görsel olarak eşdeğer (tolerans belgelenir).
      *Tamam (2026-10-23, kullanıcı onayladı):* karşılaştırma smoke'u tepeli
      257² fikstürü üç açıdan + AO/DOF'lu bir seviyeden legacy, legacy tekrar ve
      CDLOD olarak çekti (chunk renderer silinince smoke
      `tests/smoke/terrain-renderer.spec.ts` render/derleme kontrolüne
      dönüştü; 201×137 fikstürle dolgu yolunu da çiziyor). Tolerans: CDLOD/legacy farkı, sahnenin
      kendi yükleme-yükleme gürültüsünün en fazla 2 seviye (ortalama kanal farkı)
      ve %2 değişen piksel üstünde. Ölçülen: ortalama 0,04–0,11 seviye, değişen
      piksel ≤ %0,03 (normal dokusunun half-float yuvarlaması ve silüet kenarı).
      Not: `Terrain.level.json` headless editörde main'de de siyah çiziliyor
      (gökyüzü); karşılaştırma bu yüzden kendi fikstürünü kuruyor.

## Faz 3 — Fizik, hareket, navigasyon zemini

- [x] `terrainCollider.ts`: tile → Rapier heightfield, `landscape:<id>:<tile>`
      entity id'leri, collision preset / physical material korunur.
      Collider `HeightFieldFlags.FIX_INTERNAL_EDGES` ile kurulur (S4).
      *Şekil verisi hazır* (`terrainTileHeightfieldShape`, Rapier testiyle);
      PhysicsSubsystem bağlantısı açık.
      *Ara karar (2026-10-23, çok-tile yükleme dilimi):* çok-tile World Terrain
      runtime'da şimdilik **tile başına statik trimesh** ile çarpışıyor
      (`worldTerrainColliderEntities`, `engine/terrain/worldTerrainActor.ts`;
      entity id `landscape:<actor id>:<tile key>`, deliklere entity yok).
      Gerekçe: karakter hareketi zemini `staticSurfaceTrianglesNear` üçgen
      listesinden okuyor ve nav/collision debug wire/araç da trimesh yolunu
      kullanıyor; heightfield bağlamak bu maddenin ve "arazi üçgenlerini anında
      üret" maddesinin birlikte yapılmasını gerektiriyor. Trimesh yolu bugün
      hepsiyle çalışıyor ve 1×1 Landscape ile aynı. Entity transform'u tile
      merkezinde, datum yüksekliğinde — `terrainTileHeightfieldShape`'in
      gövde çerçevesiyle aynı — ve üçgenler aynı b–c köşegeniyle bölünüyor
      (K3a, testli); heightfield'a geçişte yalnız primitive değişir. Bedel:
      257² tile başına ~74 ms kurulum (S4) ve tile başına ~131 bin üçgen; tile
      sayısı arttıkça boot uzar. Bu yüzden bu ara çözüm Faz 4 akışından önce
      heightfield ile değiştirilmeli.
      *Heightfield'a geçildi (2026-10-23):* collider bileşeninde yeni
      `"heightfield"` primitive şekli (`ColliderHeightfield`:
      quadsX/quadsZ/spacing + satır-öncelikli `Float32Array`, tile'ın kendi
      yükseklik dizisi kopyalanmadan paylaşılır). `worldTerrainColliderEntities`
      artık `terrainTileHeightfield` üretiyor; entity id, transform (tile
      merkezi, datum), `walkable` nav rolü ve delik kuralı aynı.
      PhysicsSubsystem Rapier'de `ColliderDesc.heightfield(quadsZ, quadsX,
      sütun-öncelikli, ölçek, FIX_INTERNAL_EDGES)` kuruyor; `traceCamera`
      ışınları `terrainHeightAt` ile 2 mm içinde (testli). Ölçüm (16 tile ×
      257², Node, aynı makine): `setEntities` + Rapier kurulumu ~4,3 s →
      ~80 ms, heap ~1,7 GB → ~0,5 GB.
      *1×1 Landscape de geçti (2026-10-23):*
      `createLandscapeHeightfieldPrimitive` actor merkezli, `heightScale`
      uygulanmış, kare olmayan grid'i de destekleyen heightfield üretir;
      runtime `landscape:<actor id>` kimliğini ve actor dönüşünü korur.
      Trimesh ile aynı b–c diyagonali ve `(a,c,b), (b,c,d)` üçgen sırası
      doğrulandı. Kare, döndürülmüş, 129×65 ve `heightScale = 2,5`
      fixture'larında yakın sorgular, tam/nav listeleri ve `hasStaticGround`
      sıra dahil `deepEqual` ile testli (Float32'de tam temsil edilen örnekler).
      Ondalıklı yükseklikler Float32'ye yuvarlanır (Rapier trimesh ile aynı
      hassasiyet); döndürülmüş 129×65 grid'de Rapier ışınları eski trimesh
      yüzeyi ve collider ışınlarıyla 2 mm içinde testli.
- [x] `PhysicsSubsystem.addEntities` / `removeEntities` (toplu, tek
      invalidation); statik yüzey üçgen cache'i gövde başına artımlı.
      *Tamam (2026-10-23, Faz 3 bölüm 1):* statik AABB/üçgen kayıtları gövde
      başına bir kez üretilir; 4 m hücre index'leri ekleme/silme, transform ve
      collision toggle ile artımlı güncellenir. Eski düz listeler tembel kurulur,
      gövde/primitive sırası korunur; yüzey yakın sorgusu hücre + overflow
      sırasını korur. Toplu API tek cache invalidation yapar; id → body map'i
      duplicate kontrolünü ve physical material erişimini O(1) tutar. Sahne
      başlangıcı zaten toplu `setEntities` kullanıyor; dönüştürülecek statik
      `addEntity` döngüsü yok.
- [ ] `staticSurfaceTrianglesNear` arazi üçgenlerini heightfield'dan anında
      üretir (karakter hareket kodu değişmez); nav yüzey tohumlama
      `TerrainHeightQuery`'yi kullanır. Merdiven/rampa düzeltmeleri
      (signedNormalY, headroom gate) korunur; ilgili testler yeşil.
      *Anında üretim tamam (2026-10-23):* heightfield gövdeleri statik
      indekse üçgen koymuyor; `HeightfieldStaticSource`
      (`engine/physics/heightfieldStatic.ts`) bir 4 m indeks hücresinin
      üçgenlerini ilk sorguda üretip önbelleğe alıyor (kaynak başına en çok
      4096 hücre), tam listeleri (`staticBlockerAabbs`, `staticSurfaceTriangles`,
      nav listeleri) yalnız istenince bir kez üretiyor. Üçgenler trimesh'le
      aynı dünya köşeleri, aynı sınıflandırma (`engine/physics/staticTriangles.ts`,
      trimesh yolu da bunu kullanıyor), aynı hücre üyeliği
      (`staticCellRange`) ve aynı göreli sırayla üretildiği için her sorgu
      trimesh'in cevabını birebir veriyor: `tests/engine/terrainHeightfieldPhysics.test.ts`
      karışık gövde sırasında, dikişte, delikte, duvar üçgenli dik bir
      çıkıntıda, collision kapat/aç, döndürme ve silme sonrası bütün yakın
      sorguları ve tam/nav listelerini `deepEqual` ile karşılaştırıyor.
      Döndürülmüş gövde ya da 32 m'den geniş quad'lar (overflow kuralı) eski
      gibi yüklemede indekse açılıyor. Maliyet: yürüme benzeri sorgularda
      yüzey + engelleyici çifti ~1,7 µs (trimesh ~0,8 µs); yeni bir hücreye
      ilk girişte ~25 µs. **Açık:** nav tohumlamanın `TerrainHeightQuery`'ye
      geçmesi — AI nav grid hâlâ tam listeleri okuyor (artık tembel).
- [ ] `staticBlockerAabbsNear(x, z, radius)`; karakter hareketi, `hasGroundProbe`,
      TPS kamera ve AI çağrıları buna geçer. Test: 5000 statik AABB'li
      sahnede karakter adımı süresi sabit kalıyor.
      *Kısmen tamam (2026-10-23, Faz 3 bölüm 1):* karakter çözümü, zemin/iniş
      ve `hasGroundProbe`, behavior hareketi, TPS spring arm ve araçtan çıkış
      yakın sorguya geçti (opsiyonel API + eski host için tam liste yedeği).
      Yarıçaplar ilgili hareket/footprint/offset ve skin payını kapsıyor.
      Global O(1) `hasStaticGround` boş hücrede düşmeyi, tamamen zeminsiz
      sahnede eski spawn-height tabanını koruyor. 5000 AABB testinde tam liste
      çağrısı yasak; bir karakter adımı en fazla 12 blocker adayı inceliyor
      (duvar saati yerine sayaç). Yeni 8 kontrol: `static queries` filtresi.
      AI'nin konum/yarıçap almayan toplu perception/query provider'ları
      (`aiModule`, `SceneApp`) ve tüm nav grid bake/debug listeleri bilerek
      tam listede; yerel AI sorgu sözleşmesi sonraki iş olduğundan bu madde
      açık. Heightfield bağlantısı/anlık arazi üçgenleri bu bölümün dışında.
- [ ] `createLandscapeColliderPrimitive` (trimesh) kaldırılır.
      *Açık:* runtime artık heightfield kullanıyor; editörün `SceneApp`
      collision overlay'i ve parity testinin referansı hâlâ bu trimesh'i
      kullandığı için yardımcı korunuyor.
- [x] Araç: tile kenarında süspansiyon zıplaması yok (2×2 tile'lık arazide
      gerçek araçla dikiş geçişi).
      *Tamam (2026-10-23, deterministik motor testi):*
      `tests/engine/terrainHeightfieldPhysics.test.ts`, `worldTerrainColliderEntities`
      ile düz 64×64 m zemini 2×2 adet 32 quad tile ve tek 64 quad kontrol tile'ı
      olarak kurar; iki koşuda da gerçek Rapier referans aracı `createVehicle` /
      `setVehicleInput` ile sürülür. 3 s yerleşmeden sonra 60 Hz sabit adımlarla
      X, Z dikişleri ve ortak köşe geçilir; tekerlekler sürekli temas eder,
      hedef tile kimliklerine ulaşır (köşede dört collider da temas alır).
      Dikişin ±4 m çevresinde X/Z/köşe için 50/50/42 adım ölçüldü:
      en büyük `|vy|` sırasıyla **0,06119130 / 0,06119109 / 0,06119118 m/s**;
      her biri tek-tile kontrolüyle aynı, en büyük adımlık `|ΔY|` hepsinde **0 m**.
      Kontrole ek tolerans `|vy|` için 0,005 m/s, `|ΔY|` için 0,0001 m;
      mutlak üst sınırlar 0,07 m/s ve 0,001 m. Test gerçek araç fizik yoluna
      ulaştığından tarayıcı smoke'u atlandı; test ~0,2 s sürüyor ve tam
      `test:engine` paketinde koşuyor. Zemin düz: dikişin kendi etkisini
      ölçüyor, eğimli arazide normal sürekliliği ayrıca test edilmedi.
- [x] Collision debug wire'ı heightfield'ı çizer.
      *Tamam (2026-10-23):* runtime `?debug` collider wire'ı heightfield
      üçgenlerini çiziyor; editörün Show > Collision katmanı aynı yüzeyi
      `terrainTileTrimesh` ile çizmeye devam ediyor.

## Faz 4 — Akış çekirdeği (yalnız arazi)

- [x] `worldGrid.ts`, `streamingPolicy.ts`: saf, tablo testli (menzil,
      histerezis, öncelik, hız yönü). *`worldGrid.ts` hazır* (hücre/sınır,
      yakından uzağa sıralı menzil sorgusu, actor → hücre); *`streamingPolicy`
      hazır (2026-10-23):* yükleme/aktivasyon menzilleri, histerezis, hız yönlü
      öncelik, çoklu kaynak, dünya sınırı, kalite çarpanı ve kare bütçesi.
- [ ] `worldStreamingSubsystem.ts`: durum makinesi, fetch sınırı, kare
      bütçesi, LRU bellek bütçesi, iptal (menzilden çıkan fetch), hata
      (eksik tile → düz tile + `[world]` uyarısı, CONTENT_LOADING_CONTRACT
      sınıflandırmasıyla).
      *Saf çekirdek hazır (2026-10-23):* enjekte loader/saat ile yaşam döngüsü,
      6 eşzamanlı fetch, 4 ms aktivasyon dilimi, iptal/geç sonuç temizliği,
      byte bütçeli pasif LRU, sınıflandırılmış tekil uyarı/fallback,
      `isAreaReady`/`waitForArea` ve `stats()` API'si testli. Menzil dışı pasif
      veri bütçe dolana kadar tutulur; aktif veri bu bütçenin dışındadır.
      Aktivasyon atomiktir: başlayan tek hücre dilimi aşabilir, sonraki iş
      sonraki kareye kalır. Runtime capability bağlantısı, gerçek loader'lar,
      renderer/fizik aktivasyonu ve `?debug` overlay'i açık.
- [ ] `terrainWorker.ts`: çözme + Float32 açma + min/max, transferable.
      *Saf çekirdek hazır (2026-10-23):* `terrainTileStreaming.ts` eager loader
      ile aynı tanım doğrulamasını kullanır; metre cinsinden Float32 yükseklik,
      RGBA8 ağırlık blokları, min/max ve benzersiz transfer buffer'ları üretir.
      İnce module worker önce `{ type: "init", def }`, sonra `{ key, bytes }`
      alır; sonucu transfer listesiyle, hatayı yapılandırılmış mesajla yollar.
      Runtime bağlantısı, gerçek loader'lar ve worker pool henüz yapılmadı;
      `?debug` sayıları yalnız subsystem `stats()` API'sinde, overlay açık.
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
                                  └──► TERRAIN_DEFORMATION Faz 1b+
Faz 8: Faz 2'den sonra parça parça (her faz kendi editör minimumunu getirir)
TERRAIN_DEFORMATION Faz 0 (araç/render spike'ları) + Faz 1a: bağımsız, şimdi
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
