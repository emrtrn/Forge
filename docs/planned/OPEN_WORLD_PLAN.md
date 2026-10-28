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
> yolları o commit'e aittir. **Güncel uygulama (2026-10-25):** GPU CDLOD
> renderer, çok-tile World Terrain, sculpt/paint, Rapier heightfield çarpışması,
> editör/runtime streaming ve deformasyon/iz detayları birlikte mevcut.
> Eski CPU chunk renderer kaldırıldı. `claude/zealous-brown-lfi5ti` dalındaki
> alternatif Faz 2 renderer'ı, bu özellikleri koruyan yerel renderer üzerinde
> uzlaştırıldı; kararlar aşağıdaki birleştirme notunda. Açık Faz 2 işleri
> büyük import worker'ı, dab başına GPU yüklemesinin daraltılması ve renderer
> maddesinde belirtilen eklerdir. Editör işinin (sculpt/paint `terrainEdit`'e,
> 16-bit PNG + RAW, katman silme) planı 2026-10-25'te tamamlandı:
> `OPEN_WORLD_FAZ2_EDITOR_PLAN.md` (arşivde, `docs/COMPLETED_WORK_INDEX.md`).
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
> [WORLD_TERRAIN_WATER_BODY_PLAN.md](WORLD_TERRAIN_WATER_BODY_PLAN.md)
> (yol/nehir aktarımı, eski arazi emekliliği ve göl/birikinti/deniz araçları;
> sohbet kaydı ve önerilen geliştirme sırası),
> `VEHICLE_PHYSICS_PLAN.md` (arşivlendi),
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
| Voxel / marching cubes arazi | Mağara/overhang verir ama render, fizik, editör maliyeti çok yüksek. Mağara gerekirse Faz 10'daki delik maskesi + mesh yolu. |
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

**Birleştirme notu (2026-10-25):** `feat/terrain-deformation` ile
`claude/zealous-brown-lfi5ti` ortak `0a685bab` tabanından ayrı renderer'lar
üretmişti. Runtime'da yerel `TerrainRenderer` korunur: çok-tile/streaming,
seam normalleri, artımlı texture rect yüklemeleri, deformasyon ve GTAO/DOF
normal/depth materyalleri kaybolmaz. Bulut dalından seçiciye `extent` kırpması
(deformasyon alt seviyeleri korunarak), GPU terrain'in outline proxy'sinden
çıkarılması ve test vakaları taşındı. Kenar boya padding'i yüksekliklerle
aynı uzatma kuralına getirildi. `terrainTexturePool.ts` testli bağımsız bir
slot/doku yardımcısı olarak korunur; aktif renderer kendi normal/weight/global
texture ve dirty-rect yönetimini kullanmaya devam eder.

Bulut renderer'ının node-texture + `onBeforeRender` kamera seçimi ve fragment
normal hesabı mevcut renderer'ın yerine geçirilmedi. Bu dala ait eski
SwiftShader parite ölçümleri birleşmiş renderer için yeni doğrulama sayılmaz.
Aktif renderer'ın node frustum culling'i 2026-10-28'de bağlandı (aşağıda);
GTAO'yu dışlamak yerine yerel displaced normal/depth geçişleri korunur.
`tests/engine/terrainRender.test.ts` uyarlaması; kaynak/padding, slot cache ve
eviction, döndürülmüş arazide 60 ışın, sculpt/picking, shader geçişleri ve
outline davranışını mevcut API üzerinde denetler.

Editör maddelerinin uygulama planı (tamamlandı 2026-10-25):
`OPEN_WORLD_FAZ2_EDITOR_PLAN.md` (arşivde, `docs/COMPLETED_WORK_INDEX.md`).

- [x] `terrainLod.ts`: quadtree seçimi, LOD menzilleri, morph faktörü
      (saf, test edilir: komşu düğüm LOD farkı ≤ 1, menzil monotonluğu).
      *Saf çekirdek hazır (2026-10-23): düğüm seçimi, 3B rölyef alt sınırı,
      morph ve yakın→uzak residency listesi testli. *Renderer'a bağlandı
      (2026-10-23):* seçim, `TerrainWorldHeightBounds` (tile başına piramit +
      tile aralıklarının toplamı) ile besleniyor; yerleşim
      `terrainResidentTileKeys` ile.
      Tam morph olmuş tile-seviyesi düğüm global haritayı kullanır; 67 tile
      yaklaşık değerdir, kesin sayı kamera konumuna bağlıdır.*
- [x] `terrainTexturePool.ts`: slot ayırma/serbest bırakma, global düşük
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
- [x] `terrainRenderer.ts` + `terrainMaterial.ts`: instanced draw, dünya UV'li
      splat, `sampler2DArray` katmanlar *(tamam 2026-10-27, 7c2 notu)*, uzak tekrar kırma, view mode'lar,
      gölge alma, kalite profiline bağlı kendine gölge.
      *Node frustum culling tamam (2026-10-28):* `updateLod` kameranın dört
      yan düzlemini terrain-local seçici uzayına çevirip
      `TerrainLodSelector.select`'e görünürlük olarak verir (perspektifte
      arkayı da eler; near/far kullanılmaz). Kutunun Y aralığı arazinin
      tüm yükseklik aralığının aynasına uzatılır, böylece yatay su/planar
      yansıması ekranın üstündeki yamaçları kaybetmez; düşey ayna bu
      kapsamda değil. Pay %1 yaprak + 0,005 × düzlemsel mesafe; kamera
      0,1°'den fazla dönünce ya da projeksiyon değişince yeniden seçer.
      Sphere Reflection Capture bake'i `withTerrainCullingSuspended`
      içinde kırpmasız çizer. Residency kırpmadan bağımsız (dönünce tile
      hazır). Kendine gölge açıldığında gölge kameralarının gördüğü
      düğümler de korunur (aşağıda). Test: `terrain renderer:
      the view frustum culls…` (mirror uzatması kapatılınca düşüyor); kapsama
      değişmezleri kırpmasız seçimde denetlenir.
      *Kendine gölge + uzak tekrar kırma tamam (2026-10-28):* yeni kalite
      anahtarı `terrainSelfShadow` (ultra/high açık, medium/low kapalı;
      runtime `applyQualitySettings`, editör `applyEditorQuality` →
      `setTerrainSelfShadow`). Arazi `customDepthMaterial` olarak displaced
      bir `MeshDepthMaterial` taşır; gölge pass'i `uTerrainLodCamera` ile
      görünümün LOD'unu çizer. Gölge atarken kırpma, gölge haritası çizilen
      ışıkların (kaskadlar, yoksa güneş) dört yan düzlemini görünümle
      birleşim olarak kullanır; bu yüzden gölge fit'i artık terrain LOD'dan
      önce koşar (runtime + editör). Uzak tekrar kırma: dokulu her katman 25 m'den
      sonra 0,23 ölçekli, 0,6 rad döndürülmüş ikinci bir örneği (dallanma
      içinde `textureGrad`, yalnız ağırlığı olan katmanda) 100 m'de yarı
      yarıya karıştırır; normal haritası tek ölçekte kalır. Kalite anahtarı
      `terrainFarTiling` (ultra/high açık, medium/low kapalı) bunu
      `FORGE_TERRAIN_FAR_TILING` define'ı olarak programa derler; SwiftShader'da
      ek okumalar `vehicle-soft-ground` smoke'unu (medium tabanlı) süre sınırının
      dışına itiyordu. Görsel
      karşılaştırma kullanıcıya gösterildi. Testler: `terrain renderer:
      self-shadow keeps…`, `terrain render:` shader metni.
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
      *(Frustum culling, uzak tekrar kırma ve kendine gölge 2026-10-28'de tamam.)*
      (legacy de gölge düşürmüyor; parite için kapalı), tile akışının Faz 4
      alt sistemine bağlanması (şimdilik bütün tile'lar CPU'da yüklü).
      **Dirty-rect tamam (2026-10-23):** slot dokuları ve global haritalar
      yalnız kirli bölgeyi yükler; seam normalleri komşuda ince şeritle
      güncellenir. İlk yükleme/context yenileme tam CPU kopyasını kullanır;
      boşluk doldurmanın etkilediği global yükseklik örnekleri de kapsanır.
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
- [x] Sculpt/paint: `terrainEdit.ts` ile çok-tile'lı brush, kenar vertex
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
      gösteriyor; katman materyali atama artık açık. **Hâlâ kapalı:** spline'lar (uyarı) ve
      yeniden boyutlandırma (heightmap import/export açık: RAW 2026-10-23, PNG16 2026-10-25). *(Fill Layer 2026-10-25'te
      açıldı; 1×1 ve çok-tile aynı `terrainEdit` stroke/undo yolunda — ayrıntı
      `OPEN_WORLD_FAZ2_EDITOR_PLAN.md` (arşivde, `docs/COMPLETED_WORK_INDEX.md`).)*
      Elle foliage Paint/Erase/Single/Fill/Select araçları çok-tile yüzeyinde çalışır;
      yükseklik/normal raycast'ten gelir, boş tile'a düzlem fallback'i yapılmaz.
      Aynı `landscape` hedefi ve foliage sidecar'ı Save/Load/Play'de kullanılır;
      prosedürel Landscape foliage kuralları Faz 6'ya kadar kapalıdır.
      *Paint hassasiyeti (2026-10-25):* stroke boyunca float ağırlık tamponu
      (`TerrainPaintAccumulator`), düşük güçlü dab'lar artık 8-bit'e yuvarlanıp
      kaybolmuyor; ayrıntı `OPEN_WORLD_FAZ2_EDITOR_PLAN.md` (arşivde, `docs/COMPLETED_WORK_INDEX.md`).
      *Tamam (2026-10-25):* 1×1 Landscape da aynı stroke/undo yolunda; Fill
      Layer ve spline bake tile yamalarıyla; Details Paint'te **Remove Layer**
      (1×1 ve çok-tile, tek undo): silinen katmanın ağırlığı kalan katmanlara
      orantılı dağıtılır, RGBA8 toplamı 255, blok sayısı katmanla düşer
      (`createTerrainLayerRemoval`). 1×1 kaydının kirli tile yoluna geçmesi
      (`captureTerrainWrite`'ın emekliye ayrılması) Faz 3'e ertelendi. Dab
      başına GPU yüklemesi aşağıdaki açık maddede. Doğrulama: `tests/engine/worldTerrainActor.test.ts`
      (dikiş üstü dab yalnız iki tile'ı, formatıyla ve doğrulanarak kaydeder;
      aralık genişlemesi), `editorSaveCoordinator` (yalnız kirli tile + tanım,
      yerinde; yazım sırasında yeni düzenleme kirli kalır) ve
      `tests/smoke/terrain-multitile.spec.ts` (dikiş üstünde Raise stroke →
      autosave yalnız (0,0) ve (1,0)'ı yazar, dikiş satırları eşit; undo iki
      tile'ın baytlarını birebir geri getirir; redo sonrası Play'de pawn
      arazide).
- [x] Dab başına GPU yüklemesi (perf): GPU'ya dab başına tile katmanının
      tamamı ve global haritanın tamamı yükleniyor (CPU normalleri
      dikdörtgenle sınırlı); dikişe değen dab komşu tile'ın normallerini
      baştan hesaplıyor. Yüklemeler kirli dikdörtgene daraltılır.
      *Tamam (kaynaktan doğrulandı 2026-10-27):* `TerrainTextureUpdates`
      slot katmanlarını ve global haritaları yalnız kirli dikdörtgenle
      `copyTextureToTexture` ile yükler; `TerrainRenderer.updateTile` komşu
      tile'da yalnız örtüşen şeridin (1 vertex normal payı) normallerini
      yeniden hesaplar. Kalan küçük maliyet: delikli dünyada her dab
      `fillHoles` ile bütün global yükseklik haritasını tarar.
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
- [x] **Tek Landscape girişi (2026-10-24):** Add Actor → Terrain'de artık
      yalnız **Landscape** var; ayrı "World Terrain" girişi kalktı. Kullanıcıya
      görünen ad Landscape, "World Terrain" veri formatının adı (`*.terrain.json`
      + tile ikilileri). Diyalog ("New Landscape") 1×1 dahil her grid'i kabul
      eder; varsayılan 1 tile × 128 quad × 1 m, yani eski Add Landscape'in
      129 × 129'u. 1×1 köprüden (`terrainDocumentToLandscape`) düzenlenir,
      spline/River çalışır; birden çok tile seçilince diyalog spline/River'ın
      şimdilik tek tile'da çalıştığını söyler. Add Landscape artık sahte
      `.landscape.json` referansıyla migrasyon yolundan geçmiyor, doğrudan
      `.terrain.json` yazıyor: `EditorSaveSession.markLandscapeUnwritten`
      diskte olmayan 1×1 veriyi (yeni ekleme, budanmış silme/genişletme
      geri alması) işaretler ve Save onun tile + tanımını level'dan **önce**
      yazar; sonraki düzenlemeler eski level-önce sırasını korur. Kullanılmayan
      `/__save-landscape` ucu ve `validateSaveLandscapePayload` silindi
      (`validateLandscapeData` legacy okuyucu emekliye ayrılana kadar kalır).
      Details/undo/durum metinleri "multi-tile Landscape" diliyle güncellendi.
      Doğrulama: engine (1×1 varsayılan, yazılmamış Landscape'in level'dan önce
      yazımı + başarısız tile yazımında level'ın kaydedilmemesi) ve Add
      Landscape kullanan smoke'lar (`addLandscapeFromMenu`).
- [x] Heightmap import/export: 16-bit PNG ve RAW, dünya boyunda; tile'lara
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
      *16-bit PNG + 1×1 (2026-10-25):* RAW ve 16-bit PNG import/export artık
      1×1 ve çok-tile Landscape'te aynı Details bölümünden; bağımlılıksız codec
      `engine/terrain/heightmapPng.ts`. 1×1'de eski "Import PNG (resample)" kalır.
      Ayrıntı `OPEN_WORLD_FAZ2_EDITOR_PLAN.md` (arşivde, `docs/COMPLETED_WORK_INDEX.md`).
      Büyük import'un worker'a taşınması aşağıdaki açık maddede.
- [ ] Büyük heightmap import'u worker'da (Faz 4'ten sonra; **ertelendi**): tile başına
      generator (`iterateRawHeightmapTiles`) ilerleme sayacıyla worker'a taşınır;
      bugün import ana thread'de çalışıyor.
      *Ölçüm (2026-10-27, Node, editörün en büyük dünyası 8×8 × 256 quad =
      2049²):* RAW bölme 67 ms + tile çözme 19 ms + undo yamaları 57 ms +
      uygulama 80 ms = 223 ms (4×4: 76 ms). Worker'a yalnız ilk ikisi (~85 ms)
      taşınabilir; yamalar edit dünyasına ana thread'de yazılır. Madde 4097²
      (256 tile) varsayımıyla yazıldı, editör bugün en fazla 64 tile tutuyor:
      editör sınırı büyüyene (Faz 8 sihirbazı / tam akışlı import) kadar ertelendi.
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
- [x] `staticSurfaceTrianglesNear` arazi üçgenlerini heightfield'dan anında
      üretir (karakter hareket kodu değişmez); nav yüzey tohumlama
      heightfield nokta sorgusunu kullanır (aynı b–c yüzeyi). Merdiven/rampa
      düzeltmeleri
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
      ilk girişte ~25 µs.
      *Nav tamam (2026-10-23):* `staticNavigationSurfaceSamplesAt` heightfield
      grid'inden yalnız noktanın komşu quad'larını örnekler; üçgen sırası, sınır
      toleransı, eğim, katman ve tavan kontrolü trimesh ile aynıdır. Nav yüzey
      listesi heightfield'ları dışlar; engel/perception listesi yalnız duvarları
      üretir. Ekle/sil/collision toggle nav cache'ini geçersiz kılar. Engine testi
      çok-tile trimesh ile katmanları, pişmiş grid'i ve yolu `deepEqual` kıyaslar;
      `HeightfieldStaticSource.all()` çağrısı yasaklanarak nav kurulur.
- [x] `staticBlockerAabbsNear(x, z, radius)`; karakter hareketi, `hasGroundProbe`,
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
      *AI tamam (2026-10-28):* `AISubsystemOptions.blockersNear` (`aiModule`
      host'un yakın sorgusundan, `SceneApp` physics'ten bağlar; yoksa tam
      liste yedeği). Algı her dinleyici için konumunda `sightRadius`
      karesini ister: kaynaklar o düzlemsel yarıçapta ve iz uçları kaynağın
      X/Z'sini paylaştığı için sonuç birebir aynı. Sorgu çalıştırıcıda
      `lineOfSight` segmentin kendi karesini (birebir), `navReachable` çiftin
      karesi + `NAV_REACHABLE_BLOCKER_MARGIN` (16 m) ister; bundan geniş
      dolanan yolun dışarıdaki duvarları görülmez, tile'lı nav (Faz 9) bunu
      kapatır. Testler tam listeyi yasaklayıp çağrılan kareleri denetler.
      `moveTo`/nav bake ve nav debug listeleri tam listede kalır (Faz 9).
      Heightfield bağlantısı/anlık arazi üçgenleri bu bölümün dışında.
- [x] `createLandscapeColliderPrimitive` (trimesh) kaldırılır.
      *Tamam (2026-10-24):* editörün "Show > Collision" overlay'i 1×1'de
      `createLandscapeHeightfieldPrimitive`, çok-tile'da `terrainTileHeightfield`
      primitive'inden `heightfieldWireSegments` (`collisionView.ts`, physics'in
      `forEachHeightfieldTriangle` sırası) ile çiziliyor — Play'in debug wire'ıyla
      aynı kaynak. `createLandscapeColliderPrimitive`, `terrainTileTrimesh`,
      `LandscapeColliderPrimitive` ve kullanılmayan `trimeshWireSegments`
      motordan silindi; trimesh'ler bağımsız parity referansı ve statik fixture
      olarak yalnız test tarafında yaşıyor (`tests/engine/terrainTrimeshReference.ts`,
      `data.heights`'tan kurulur, heightfield'dan türetilmez).
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

- [x] Global harita kalıcı (2026-10-23, dilim 1): `<ad>.global.bin`
      (`FGLB` v1, little-endian) yükseklikleri, normal X/Z + delik işaretini
      ve iki RGBA8 ağırlık bloğunu kayıpsız saklar. Her World Terrain kaydı
      tile → global harita → tanım sırasındadır; yerel ayrıcalıklı endpoint
      başlık/boyut kontrolü, tanım commit'i şekil eşleştirmesi yapar.
      Editör/runtime dosyayı renderer'a geçirir; eksik/geçersiz eski dosyada
      tek `[terrain]` uyarısıyla tile'lardan hesaplanır. Dilim 1 eager yükler;
      dilim 2 runtime akışı geçerli global harita ister (aşağıda).
- [x] `worldGrid.ts`, `streamingPolicy.ts`: saf, tablo testli (menzil,
      histerezis, öncelik, hız yönü). *`worldGrid.ts` hazır* (hücre/sınır,
      yakından uzağa sıralı menzil sorgusu, actor → hücre); *`streamingPolicy`
      hazır (2026-10-23):* yükleme/aktivasyon menzilleri, histerezis, hız yönlü
      öncelik, çoklu kaynak, dünya sınırı, kalite çarpanı ve kare bütçesi.
- [x] `worldStreamingSubsystem.ts`: durum makinesi, fetch sınırı, kare
      bütçesi, LRU bellek bütçesi, iptal (menzilden çıkan fetch), hata
      (eksik tile → düz tile + `[world]` uyarısı, CONTENT_LOADING_CONTRACT
      sınıflandırmasıyla).
      *Saf çekirdek hazır (2026-10-23):* enjekte loader/saat ile yaşam döngüsü,
      6 eşzamanlı fetch, 4 ms aktivasyon dilimi, iptal/geç sonuç temizliği,
      byte bütçeli pasif LRU, sınıflandırılmış tekil uyarı/fallback,
      `isAreaReady`/`waitForArea` ve `stats()` API'si testli. Menzil dışı pasif
      veri bütçe dolana kadar tutulur; aktif veri bu bütçenin dışındadır.
      Aktivasyon atomiktir: başlayan tek hücre dilimi aşabilir, sonraki iş
      sonraki kareye kalır. *Runtime bağlantısı tamam (2026-10-23, dilim 2):*
      `worldStreamingModule.ts` yalnız Play'de çok-tile araziyi bağlar;
      tanım + global harita okunur, tile'lar pawn (yoksa kamera) çevresinde
      akar. Eksik/geçersiz tile tek `[world]` uyarısıyla özetin min yüksekliğinde
      düz tile olur. Editör eager, 1×1 Landscape yolu değişmedi.
- [x] `terrainWorker.ts`: çözme + Float32 açma + min/max, transferable.
      *Saf çekirdek hazır (2026-10-23):* `terrainTileStreaming.ts` eager loader
      ile aynı tanım doğrulamasını kullanır; metre cinsinden Float32 yükseklik,
      RGBA8 ağırlık blokları, min/max ve benzersiz transfer buffer'ları üretir.
      İnce module worker önce `{ type: "init", def }`, sonra `{ key, bytes }`
      alır; sonucu transfer listesiyle, hatayı yapılandırılmış mesajla yollar.
      *Bağlandı (2026-10-23):* iki module worker, altı eşzamanlı fetch;
      kuyruk/aktif decode iptali geç sonuç yayımlamaz, level unload worker'ları
      kapatır. Worker hataları aynı sınıflandırılmış tile fallback'ine gider.
- [x] Render menzili ve fizik menzili ayrı; global harita menzil dışını
      kapatır.
      *Tamam (dilim 2):* render 2 tile boyu (en az 8 m), fizik 0,75 tile
      boyu (en az 4 m), histerezis 1,25. Pasif LRU bütçesi dört tile'ın
      decode baytı; aktifler ayrı tutulur. Renderer tanımda bulunan ama henüz
      yüklenmeyen tile'ı global haritadan çizer; delik maskesi değişmez.
      Aktivasyon/serbest bırakma sabit kamerada bile slot/bounds/dikiş
      normallerini yeniler; kalıcı global harita yeniden örneklenmez.
- [x] Bloklayan yükleme: boot, travel, save-game yükleme ve ışınlanma
      (`LevelRuntime` adımı + loading ekranı). Akıştan hızlı giden pawn'ı
      tutma kuralı.
      *Boot/level travel tamam (dilim 2):* `startSceneRuntime` öncesi spawn
      çevresinde `waitForArea` ve heightfield hazır olma kontrolü loading
      ekranı arkasında bekler. Pawn'ın mevcut/sonraki kare konumunun 2 m
      çevresinde bildirilen arazi collider'ı yoksa bütün simülasyon tutulur;
      streaming gerçek karelerde devam eder. Karakter çözücüsü hazır olmayan
      konuma adımı geri alır ve hızını sıfırlar; delikler/dünya dışı tutulmaz.
      *Save-game/ışınlanma tamam (2026-10-23):* seviye kurulumunda
      `levelLoaded` kancalarından (save restore burada pawn'ı taşır) sonra pawn'ın
      canlı konumu hazır değilse "Loading terrain around player" ile aynı
      `prepareSpawn` beklemesi travel loading ekranı arkasında koşar. Oyun içi
      tutma (ışınlanma, script taşıma, akıştan hızlı araç) 200 ms'yi aşarsa
      loading ekranı input moduna dokunmadan açılır, bırakılan karede kapanır.
      Aynı işte bulunan hata: save yürüyen pawn'ın spawn pozunu yazıyordu;
      `transformForEntity` artık önce karakter çözücüsünü okur. Smoke: uzak
      köşede quick-save → quick-load, yükleme bitince pawn tile'ında collider
      var ve tutma yok. Oyun içi tutma ekranının smoke'u yok.
- [x] `QualityExtensions.viewDistanceMultiplier` render menzilini ölçekler;
      fizik güvenlik halkası sabit, render çarpanı en az 0,5.
- [x] `?debug`: yüklü/aktif/kuyruk hücre sayısı, ms/kare, bellek; hücre grid
      overlay'i (renk = durum).
      *Sayılar tamam (dilim 2):* yüklü/aktif/kuyruk, fizik tile sayısı,
      ms/kare, resident bayt ve pawn tutma durumu mevcut overlay'de.
      *Grid tamam (2026-10-23):* `?debug` panelinde readout'un üstünde kanvas
      harita (`debugTerrainMap.ts`, yalnız debug chunk'ı): tile başına kare,
      renk = bildirilmemiş/boşta/fetch/LRU'da/aktif/fizik/hata
      (`TerrainRuntimeStreaming.debugGrid()`, çekirdekte `forEachCell`), akış
      kaynakları beyaz nokta. Birden çok akan arazide ilki çizilir. Smoke
      `data-tiles` sayımını okur.
- [x] **Test dünyası:** `tools/world/generate-test-world` → `Levels/OpenWorldTest`
      (4×4 km, fBm gürültülü dağ-vadi, 4 boya katmanı). Smoke: spawn → 1 km
      yürü/sür → bellek ve hücre sayısı sınırda kalıyor, zemine düşme yok.
      *Tamam (2026-10-23):* `npm run world:test` (`tools/world/testWorld.ts`
      çekirdeği + `generate-test-world.mjs`) `public/layouts/OpenWorldTest.*`
      yazar: 16×16 tile × 256 quad × 1 m, Z boyunca kıvrılan vadi + ridged fBm
      dağlar, çimen/toprak yol/kaya/kar. ~97 MiB tile + 1,5 MiB global harita,
      ~20 s; **gitignore'lu, commit edilmez**. `assets/` dışında olduğu için
      manifest sağlık kontrolüne girmez, smoke kopyası da onu atlar. Tile
      formatı standart u16 FTIL (512 m → ~7,8 mm); özetler ve global harita
      çözülmüş tile'lardan, ortak kenarlar global örnek indeksinden üretilir
      (dikişler birebir). `open-world.spec.ts` aynı dünyayı 128 quad × 2 m ile
      smoke kopyasına üretir; pawn 1 km koşar. İlk koşu: zirve 29 yüklü /
      25 aktif / 6 fizik tile (256'dan), 3,9 MB resident, düşme yok. Araçla
      sürüş versiyonu yok.

**Dilim 2 doğrulaması (2026-10-23):** `terrainRuntimeStreaming.test.ts`
tanımlı/yüklü olmayan tile–delik ayrımını, sabit kamerada slot değişimini,
global haritanın korunmasını, collider ekle/sil ve pawn tutmayı denetler.
`terrain-streaming.spec.ts` kopya smoke projesinde 6×6 × 64 quad + encoder'la
global harita üretir; köşede spawn, alt küme yükleme, normal input'la uzak
köşeye koşma, eski tile/collider bırakma ve `terrainHeightAt` ile zemini ölçer.
Geçerli global haritası olmayan eski çok-tile arazi Play'de açık hata verir;
editörde Save haritayı üretir.

**Tarayıcı kabulü (2026-10-28, kapandı):** `terrain-streaming.spec.ts` geçti
(spawn 8 yüklü / 4 fizik tile → hedef 17 yüklü / 4 fizik, spawn köşesi
bırakıldı, düşme yok). `open-world.spec.ts` 4×4 km `OpenWorldTest`
dünyasında (256 tile) pawn'ı normal input'la 1 km koşturur; tepe 29 yüklü /
25 aktif / 6 fizik tile, 3,9 MB resident, düşme yok (1,4 dk). Grid overlay'i
1b11faca'da (`?debug` paneli). Araçla uzun sürüş versiyonu yok.

## Faz 5 — Actor bölümleme (hücre dosyaları)

- [x] World Settings: `world.partition { enabled, grids: {main, foliage, ...} }`
      + validator.
      *Tamam (2026-10-23):* `worldSettings.partition` (v1 yalnız `main` grid,
      varsayılan 128 m hücre / 384 m menzil, `normalizeWorldPartitionSettings`);
      `spatiallyLoaded?: boolean` placement, actor, character, ışık, reflection
      capture, blocking volume, target point ve world widget'ta; yalnız `false`
      yazılır. Save validator + klon yardımcıları + serializasyon kayması
      testleri kapsıyor. Editör UI'ı yok.
- [x] Hücre dosya formatı (`worldCell`, schema 1); validator mevcut layout
      validator'larını yeniden kullanır.
      *Saf çekirdek hazır (2026-10-23):* `engine/world/worldPartition.ts` —
      `WorldCellDocument`, `<Level>.cells/main/<x_z>.cell.json` yolu,
      `partitionLayout` (konuma göre hücre; singleton'lar, landscape, spline,
      nehir, nav volume, Player Start, directional ışık, `spatiallyLoaded:false`
      ve hücreden geniş blocking volume persistent'te, uyarıyla) ve
      `mergeWorldCells` (round-trip testli).
      *Dosyalar tamam (2026-10-23):* partition açık level Save'de persistent
      level (`worldCells` dizini) + hücre dosyaları olarak yazılır; yalnız
      değişen hücreler gönderilir. Sıra: hücreler (silmeden) → level → `keep`
      ile eskiyen hücrelerin silinmesi; partition kapatılınca birleşik level
      önce yazılır, sonra hücreler silinir. `/__save-world-cells` yalnız açık
      level'a yazar, elemanları `validateLayout` ile doğrular (dropped[]
      raporlu). `loadRoomLayout` hücreleri birleştirir: editör ve runtime aynı
      tam level'ı görür, hücre akışı henüz yok. Smoke
      `world-partition-persistence.spec.ts`.
- [x] Editör kaydı: konuma göre otomatik hücre ataması; hücre sınırı geçen
      actor dosya değiştirir; `spatiallyLoaded: false` persistent'e gider;
      hücreden büyük sınırlı actor'ler v1'de persistent'e gider (uyarıyla).
      Yalnız kirli hücreler yazılır.
- [x] **Runtime v1 — yalnız Actor Script actor'leri akar (kullanıcı kararı
      2026-10-23, seçenek 1).** Statik instance'lar, ışıklar, karakterler,
      volume'ler ve diğerleri level başında tam yüklenmeye devam eder
      (instanced batch'ler level başına kurulur; hücre başına bölmek ayrı iş).
      Tasarım:
      - **Hücre ataması runtime'da yeniden hesaplanır:** `loadRoomLayout`
        birleşik level döndürür; `worldPartitionActorCells(layout, settings)`
        (`partitionLayout` ile aynı yönlendirme kuralı, tek kaynak) her
        akışlı actor'ün birleşik dizideki indeksini hücresine eşler.
        Persistent actor'ler (`spatiallyLoaded:false`, ...) eskisi gibi boot'ta
        kurulur.
      - **Kimlik değişmez:** akan actor de `actor:<birleşik indeks>` alır; save-game
        kalıcı durumu, mesaj hedefleri ve patrol referansları eager yüklemeyle
        aynı kimliği görür.
      - **Aktivasyon** (hücre menzile girer): sınıf (önbellekli) →
        `actorInstanceToEntity` → kayıt → render nesnesi → fizik → behavior
        `addEntity` (BeginPlay sonraki tick) → autoplay ses/parçacık; spawn
        koordinatörünün bağımlılıkları yeniden kullanılır. Kalıcı "yok edildi"
        işaretli actor hiç kurulmaz; gizli/çarpışmasız işaretleri eklenirken
        uygulanır. Mesh modelleri v1'de boot'ta yüklenmeye devam eder (K5
        AssetResidency ayrı dilim).
      - **Deaktivasyon** (hücre histerezis halkasının dışında): behavior
        `unloadEntity` → EndPlay `reason: "unloaded"` (yeni neden; Unreal
        `RemovedFromWorld`), entity detach, **yalnız `persist` anahtarları
        kalır**, geçici script durumu sıfırlanır; sonra host'un destroy
        temizliği (fizik gövdesi, render nesnesi, kayıtlar). Sahiplenilmiş
        pawn ve sürülen araç hücresi boşalsa da canlı kalır; hücre yeniden
        aktive olunca canlı kimlik atlanır.
      - **Save-game:** `applyPersistentStateSnapshot` canlı olmayan actor'lerin
        kayıtlarını da saklar (bugün atlıyor); aktivasyon onları uygular.
        Boşaltılmış hücredeki taşınmış dinamik cisim/araç pozu v1'de
        saklanmaz (sonra çözüldü: aşağıdaki Save-game maddesi, açık soru 1).
      - **Akış:** `worldPartitionModule` (`worldStreamingModule` gibi), main
        grid `cellSize/loadRange`, histerezis 1,25, kaynak = pawn'ın canlı
        pozu (yoksa kamera), kare başına aktivasyon bütçesi.
        `WorldStreamingSubsystem` çekirdeği yeniden kullanılır (fetch = anında
        hücre anahtarı). Boot/travel/save yükleme: spawn ve pawn çevresindeki
        hücreler loading ekranı arkasında aktive edilir (arazi bekleyişiyle
        aynı adımlar). `?debug`: aktif/toplam hücre, canlı akan actor sayısı.
      - **Bilinen sınırlar (v1):** Editör her şeyi yükler. (AI nav: akan
        collider'lar fizik statik indekslerine artımlı girip çıktığından nav
        grid önbelleği dizi kimliğiyle yenilenir; bu kapandı, `staticQueries`
        testi yol kesme/açmayı doğrular.)
      Dilimler: (A) saf yönlendirme + behavior `unloadEntity` / kalıcı durum
      (engine testli), (B) runtime modülü + bağlantı + smoke.
      *Tamam (2026-10-23):* A + B1 `dea780b` (ek olarak modül sink'leri artımlı
      `addEntity/removeEntity` aldı; runtime spawn edilen AI/hareketli actor
      artık hareket ediyor), B2 runtime: `WorldPartitionStreaming`
      (`engine/world/worldPartitionStreaming.ts`, kare başına ≤2 hücre,
      histerezis 1,25, kalite çarpanı uygulanmaz) + `worldPartitionModule`;
      boot'ta spawn menzilindeki hücreler toplu yoldan kurulur, uzak actor'lerin
      mesh'leri yine boot'ta yüklenir. `?debug`: `world partition: cells a/t
      actors n`. Smoke `world-partition-streaming.spec.ts`: 12 hücreli koridorda
      yürürken öndeki hücre yüklenir, arkadaki boşalır, canlı actor ≤ 5.
- [x] Runtime: hücre aktivasyonu instances / actors / lights / volumes /
      characters'ı sahneye, fiziğe (toplu), behavior'a ekler; deaktivasyon
      tersini yapar. Actor Script'te **BeginPlay hücre aktivasyonunda, EndPlay
      boşaltmada** çağrılır (Unreal semantiği); belgelenir.
      *Seçenek 2 tasarımı (kullanıcı onayı 2026-10-24: hücre × asset batch, ışık havuzu, karakterler eager, S0 spike ile başla):*
      - **Kapsam.** Akar: statik mesh yerleşimleri (`instances`, kendi
        collider/behavior/ses/parçacık bileşenleriyle), blocking volume'ler,
        directional olmayan ışıklar. Kalıcı kalır: reflection capture'lar
        (bake'leri boot'ta; yerleşimlere en yakın probe kurulumda atanır),
        target point'ler (AI rotaları hücreler arası referans), world widget'lar,
        spline/landscape/river/nav volume/Player Start, directional ışık.
        Karakterler (`layout.characters`) bu planda eager kalır (animasyon,
        AI controller, possession bağları); S2–S4 sonrası ayrıca karar.
      - **Kimlik değişmez.** Runtime yine birleşik level'ı yükler;
        `instance:<asset>:<birleşik yerleşim indeksi>`, `light:<n>`,
        `blockingVolume:<n>` kimlikleri eager yüklemeyle aynı. Mesh paint ve
        save-game kalıcı durumu bu indekslere bağlı kalır. Hücre JSON'larının
        hepsi boot'ta okunmaya devam eder (talep üzerine hücre dosyası okumak
        kararlı GUID kimlik ister; ayrı iş).
      - **Tek yönlendirme kuralı.** `worldPartitionActorCells` genelleşir:
        `worldPartitionCellContents(layout, settings)` her akışlı elemanı
        (tür + birleşik indeks) hücresine eşler; `partitionLayout` ile aynı
        kural, saf ve engine testli.
      - **Statik batch'ler hücre × asset başına.** Bugün asset başına tek
        InstancedMesh var; akışta her (hücre, asset) kendi batch'i olur ve
        birleşik yerleşim indeksi → (batch, slot) eşlemesi tutulur
        (transform senkronu, "destroyed" çöküşü, override klonları bu eşlemeyi
        kullanır). Kalıcı yerleşimler asset başına tek batch'te kalır.
        Bedel: görünür hücre sayısı kadar draw call (128 m hücre / 384 m
        menzil ≈ en çok ~37 hücre); kazanç: hücre başına frustum culling ve
        boşaltmada batch'in tümden silinmesi. (Alternatif: asset başına
        büyüyen ortak havuz + swap-remove slot yönetimi; az draw call, karmaşık
        ve culling'siz — önerilmiyor; HLOD Faz 7 uzak hücreleri zaten birleştirir.)
      - **Asset paketi (K5 genişler).** Residency yükü yalnız GLTF değil
        "asset paketi" olur: model + collision sidecar + UVW eşlemesi +
        malzeme slotları + yerleşim malzeme override'ları. Hücre "hazır" =
        paketler yerleşti **ve** yeni malzeme programları `compileAsync` ile
        ısıtıldı (gizli bir sahnede), böylece aktivasyon karesinde shader
        derleme takılması olmaz. Statik modeller de hücreyle boşalır;
        malzeme override'ları (küçük) level boyunca tutulur.
      - **Fizik ve nav.** Statik collider'lar `addEntities/removeEntities` ile
        toplu girer/çıkar (statik indeksler artımlı; nav cache dizi
        kimliğiyle yenilenir, actor akışında doğrulandı). Complex-as-simple
        trimesh'ler paket yüklenince hesaplanır.
      - **Işıklar: havuz.** Three.js'te sahnedeki ışık sayısı/türü shader
        program anahtarının parçası; ışık eklemek/çıkarmak bütün lit
        malzemeleri yeniden derletir (takılma). Bu yüzden level kurulurken
        point / spot (gölgeli ve gölgesiz ayrı) havuzları açılır; boyut =
        `worldPartitionCellContents`'ten hesaplanan, herhangi bir konumda
        menzil içindeki en yüksek eşzamanlı ışık sayısı (üst sınırla; aşılırsa
        uyarı + uzaktakiler atlanır). Aktivasyon havuzdaki ışığa parametre
        yazar, boşaltma yoğunluğu 0 yapar; program anahtarı hiç değişmez.
      - **Hareket eden cisimler.** `StreamedActorStateCache` simüle edilen
        statik yerleşimleri de kapsar (aynı eşik ve save kuralları).
      - **Bütçe.** Kare başına ≤2 hücre kuralı eleman sayısı bütçesiyle
        değişir (ör. kare başına en çok N yerleşim + collider); büyük hücre
        birkaç karede kurulur, tamamlanana kadar "aktif" sayılmaz.
      - **Editör değişmez.**
      Dilimler: **S0** ölçüm spike'ı — yoğun bir hücrenin (ör. 500 yerleşim,
      karışık collider) kurulum/boşaltma süresi kullanıcının PC'sinde headless;
      kare bütçesini ve collider'ların ön-bake gerekip gerekmediğini belirler.
      **S1** saf yönlendirme + ışık havuzu tepe hesabı (engine testli).
      **S2** statikler: hücre batch'leri, eşleme, fizik/behavior, asset
      paketi + shader ısıtma, smoke. **S3** blocking volume'ler. **S4** ışık
      havuzu. Karakterler sonra ayrı karar.
      *S0 sonuçları (2026-10-24, `spikes/cell-activation`, kullanıcının PC'si,
      headless Chromium; 128 m hücre, ms, ısınmış ortalama):*

      | yerleşim | türetme | batch | fizik ekleme | ilk çizim | ilk adım | boşaltma | toplam |
      |---|---|---|---|---|---|---|---|
      | 100 (%15 trimesh) | 0,8 | 0,5 | 8,4 | 2,1 | 1,0 | 1,2 | 12,8 |
      | 500 (%15) | 1,3 | 1,6 | 22,3 | 2,0 | 6,0 | 2,7 | 33,3 |
      | 1000 (%15) | 2,8 | 1,5 | 47,9 | 2,3 | 20,2 | 4,5 | 74,7 |
      | 1000 (%0) | | | 31,4 | | 16,1 | | 52,3 |
      | 1000 (%50) | | | 103,7 | | 27,3 | | 137,5 |

      - **Fizik ekleme baskın:** basit collider ≈ 30 µs, complex-as-simple
        trimesh ≈ 180 µs (Rapier BVH kurulumu). Kare bütçesi eleman sayısına
        ağırlıklı olmalı (trimesh ≈ 6 birim); ≈ 4 ms/kare ≈ 130 basit collider.
        Boşaltma da bütçelenmeli (bugün çıkan hücreler tek karede).
      - **Soğuk ilk hücre:** ilk çizim 58–95 ms (shader derleme). Hücre
        hazırlığında `compileAsync` ile ısıtma şart (tasarımdaki gibi).
      - **Türetme + batch + statik sorgular ucuz** (1000'de < 5 ms).
      - **Mevcut hata (akıştan bağımsız):** sabit durumdaki bir fizik
        adımı 1000 statik collider'la 9–19 ms, oysa ham `rapierWorld.step()`
        0,14–0,20 ms. Fark Forge'un her karede çalışan temas toplamasından:
        `addAabbSensorContacts` bütün cisim çiftlerini gezer (O(N²)),
        `updateRapierContacts` statikler dahil her collider için iki WASM
        çağrısı yapar. Bugünkü eager level'ları da etkiler.
        *Düzeltildi (2026-10-24):* AABB sensör geçişi sensörler × cisimler
        (sonra eski (i, j) sırasına dizilir, yön ve sıra aynı), Rapier temas
        taraması statik katı collider'lardan sorulmaz (Rapier sabit-sabit çift
        üretmez). Sabit durum adımı 1000 statikle 10–17 ms → 0,2 ms; eklemeden
        sonraki ilk adım 16–27 ms → 6–7 ms. `physicsContacts.test.ts` eski
        sırayı pinler.
      *S1 tamam (2026-10-24, Codex):* `partitionRoutes` tek yönlendirme kuralı;
      `partitionLayout` çıktısı değişmedi, `worldPartitionCellContents` aynı
      kuralla birleşik level indekslerini verir (`instances` için
      `{ group, placement }`), `streamedLightPeaks` ışık havuzu üst sınırı
      (kaynak hücre kutusundan `loadRange × 1,25` içindeki hücreler, tür ve
      gölge başına ayrı). Runtime'da parent zinciri kullanılmadığından
      (yerleşimler dünya koordinatında) hücreler arası hiyerarşi için özel
      yönlendirme gerekmedi.
      *S2 tamam (2026-10-24):* S2a `261e396` (yerleşim → (batch, slot)
      eşlemesi) + S2b: çekirdek `occupiedCells` (yalnız statik taşıyan hücre),
      hücre × asset batch'leri (frustum culling açık), collider/behavior
      eklemeleri kare bütçesiyle (130 birim, trimesh 6), boot/restore hazırlığı
      bütçesiz; spawn hücreleri sahne belgesinden önce, collision sidecar'ları
      yüklendikten sonra kurulur (reflection capture bake'i onları görmez).
      Residency hücre statik modellerini de sahiplenir; yüklemede unlit
      dönüşüm + instanced program ısıtması (`compileAsync`, canlı sahnenin
      ışıklarıyla), benimsemede UVW + complex collision. Kalıcı (`spatiallyLoaded:
      false`) yerleşimler asset başına tek batch'te. Smoke
      `world-partition-statics.spec.ts`: akan zemin hep zamanında, akan duvar
      pawn'ı durdurur, geride kalan hücreler boşalır. `world-partition-streaming`
      smoke'unun zemini artık `spatiallyLoaded: false` (actor testi).
      *S3 tamam (2026-10-24):* blocking volume'ler hücreyle akar (aynı hücre
      durumu ve bütçeli kuyruk; `blockingVolumeEntityForIndex`); hücreden geniş
      volume'ler eskisi gibi kalıcı. Statics smoke'u akan volume'ü de doğrular.
      Residency smoke'u pawn'ı 20 m/s'ye indirdi ve sayımları boşaltmadan
      sonrası için yapar: batch'te yavaş karede 60 m/s pawn bir hücreyi aşıp
      fazladan boşalt/canlandır üretiyordu (kod doğruydu).
      *S4 tamam (2026-10-24):* directional olmayan akan ışıklar havuzdan.
      Level kurulurken tür başına (point, spot, gölgeli point, gölgeli spot)
      `streamedLightPeaks` kadar ışık açılır (tür başına en çok 16; aşılırsa
      uyarı, fazlası karanlık). Havuz ışığı hep görünür kalır, park hâlinde
      parlaklığı 0 ve gölge haritası donuk (`shadow.autoUpdate = false`); hücre
      açılınca parametreleri yazılır, kapanınca park edilir. Işık sayısı hiç
      değişmediği için program yeniden derlenmez (statics smoke'u ışıklar
      yanarken program sayısının artmadığını doğrular). Işık entity'leri
      eager kalır (runtime'da ışığı kimliğiyle kontrol eden yol yok). `?debug`:
      `lights kullanılan/kapasite`.
      **Seçenek 2 kapandı.** Karakterler (`layout.characters`) bilerek eager;
      akmaları ayrı karar. Reflection capture, target point ve world widget'lar
      da kalıcı.
- [x] `AssetResidency` (K5): hücre başına asset ref-count, gecikmeli boşaltma.
      Persistent level'ın `loadGroups`'u eski davranışta kalır.
      *Tasarım (kullanıcı onayı 2026-10-24; parametreler 1,5× menzil, 30 sn):*
      v1'de yalnız Actor Script actor'leri aktığı için fayda şimdilik actor
      mesh'leriyle sınırlı; seçenek 2 (statik/ışık/volume akışı) aynı çekirdeği
      kullanacak.
      - **Çekirdek** `engine/world/assetResidency.ts` (saf, three yok): asset
        başına sahip kümesi (`persistent`, hücre anahtarı, tutulan actor),
        durumlar yüklü değil → yükleniyor → yüklü → boşaltma bekliyor; son
        sahip düşünce 30 sn gecikme, süre dolunca sahipsizse `evict`. Yükleme
        hatası "yerleşti" sayılır (actor bugünkü gibi mesh'siz kurulur),
        yeniden istenince tekrar denenir. Saat enjekte edilir.
      - **Ön-yükleme halkası:** `WorldPartitionStreaming` ikinci menzil
        (1,5 × `loadRange`, bırakma histerezisi 1,25) hesaplar; hücre halkaya
        girince host asset'lerini async ister, çıkınca bırakır. Aktivasyon
        menzili ve senkron aktivasyon değişmez; asset'i hazır olmayan hücre
        ertelenir, kare bütçesini harcamaz. Boot/travel/save yükleme menzildeki
        hücrelerin asset'lerini loading ekranı arkasında bekler. Bırakma
        mesafesi (720 m) deaktivasyondan (480 m) büyük olduğundan aktif hücre
        hep referans tutar.
      - **Boşaltma (host):** loader önbelleğinden silme + GLTF geometri/malzeme/
        doku dispose + `models`, `localBounds`, complex collision ve unlit
        dönüşüm girdileri; level'ın malzeme override önbelleği paylaşıldığı
        için dokunulmaz. Runtime'ın kullandığı her model residency'ye kayıtlı
        olmalı (eager olanlar `persistent` sahibiyle), yoksa kullanılan bir
        GLTF boşaltılabilir. Level değişince sahipler bırakılır, gecikme
        içinde yeni level aynı asset'i isterse yeniden kullanılır.
      - **Editör** değişmez (her şeyi yükler).
      Dilimler: (A) çekirdek + akış halkası, engine testli; (B) loader `evict`,
      host bağlantısı, boot yalnız kalıcı + spawn halkası; (C) smoke + `?debug`
      sayaçları.
      *Tamam (2026-10-24):* A `6b23e8a` (Codex), B+C bu commit. Uygulamada
      netleşen sınır: yalnız **düz actor** (`parentClass: "actor"`, `Vehicle`
      bileşeni yok) mesh'i hücreye ait; akan pawn/karakter/araç mesh'leri
      sabitlenir, çünkü hücresinden uzun yaşayabilir (sürülen araç, pawn) ya da
      save restore onu hücresinden önce senkron canlandırır (aracına biner).
      Ayrı "tutulan actor" sahibi bu yüzden gerekmedi. Sabitlenenler:
      `loadGroups`, statikler/karakterler, spline ve foliage mesh'leri, kalıcı
      ve runtime spawn actor'ler, VFX mesh efektleri. Level kurulurken boşaltma
      duraklatılır (yeni level bekleyen bir modeli yeniden kullanabilsin).
      Hücre yüklemesi loading çubuğuna girmez; boot "Loading world cells"
      durumunda bekler. `?debug`: `prefetch p wait w models r+e loading l`;
      loglar `[world-partition] loaded/evicted model <id>`. Smoke
      `world-partition-residency.spec.ts`: uzak torus modeli boot'ta yüklenmez,
      hücresinden önce yüklenir, geri dönünce 30 sn sonra boşalır, yeniden
      gidince tekrar yüklenir.
- [x] Save-game: P3.3 opt-in script state'i (destroyed/hidden işaretleri)
      hücre **aktivasyonunda** uygulanır, yalnız level başında değil.
      Hücre boşalırken taşınmış dinamik cisimler ve araçlar için bellek içi
      "hücre durum önbelleği" + save-game'e yazılması (bkz. Açık sorular).
      *Tamam (2026-10-23):* script durumu dea780b'de. `StreamedActorStateCache`
      (`engine/world/streamedActorState.ts`): hücre boşalırken fizikle
      simüle edilen cisim/araç yetkili pozdan ayrıldıysa (0,05 m / 0,5°) son
      pozu (dinlenmede) saklanır; hücre dönünce o pozda kurulur, araç el freni
      ve vitesi korur. Save'de boşaltılmış hücredeki araçlar `vehicles`
      listesine park halinde girer; restore'da canlı olmayan akan araç aynı
      önbelleğe konur, hücre aktive olunca belirir; `drivingVehicleId` aracı
      hücresinden önce canlandırılır (biner). Diğer dinamik cisimler yalnız
      bellekte tutulur, save-game'e yazılmaz (P3.2 değişmedi). Smoke
      `world-partition-streaming.spec.ts` (düşen kasa).
- [x] `SAVE_GAME_CONTRACT.md` ve `CONTENT_LOADING_CONTRACT.md` güncellenir.
- [x] "Convert Level to World Partition" editör komutu: mevcut level →
      persistent + hücreler (geri alınabilir, yedek kopya).
      *Toggle ile karşılandı (kullanıcı kararı 2026-10-24):* ayrı komut yok;
      World Settings'teki "Enable World Partition" + Save dönüştürür, kapatıp
      Save birleşik level'ı geri yazar (undo'lu). Yedek kopya yazılmaz: yedek
      dosyası Content Browser'da ve asset health'te ikinci bir level gibi
      görünürdü, yedeği Git tutuyor. Save durum satırı hücre özetini gösterir:
      `World Partition: N cells, K written; S streamed, P persistent`
      (`countWorldCellElements`, instance grupları yerleşim sayısıyla) ve
      persistent'te kalan büyük volume uyarıları. Smoke
      `world-partition-persistence.spec.ts` özeti doğrular.

## Faz 6 — Foliage ve çim akışı

- [x] Boyanmış foliage sidecar'ı hücre başına (`foliage` grid'i); mevcut
      16 m chunk'lar InstancedMesh başına frustum culling + `cullStart`/
      `cullEnd` fade (Foliage Faz 2'nin açık maddesi burada kapanır).
- [x] Landscape foliage kuralları → **prosedürel çim**: kamera etrafında 32 m
      hücre halkası, hücre başına deterministik seed, worker'da örnekleme,
      mesafeyle yoğunluk azalması, kural başına sınır hücre başına uygulanır.
- [x] Yerleştirme `TerrainHeightQuery` ile (eğim, yükseklik, katman ağırlığı).
- [x] Bütçe: çim instance sayısı kalite profiline bağlı.

### Faz 6 tasarımı (kullanıcı onaylı, 2026-10-24)

Kararlar: dither fade; G0 spike önce; çim mesh'i Kenney nature-kit
`grass.glb` + `grass_large.glb` (CC0) starter-content'e eklenir.

**Bugünkü durum (kaynaktan):** `FoliageRenderBinding` her grubu 16 m
chunk'lara bölüyor (`chunkFoliageInstances`), chunk başına frustum culling ve
`cullEnd × foliageCullDistanceScale` ile sert gizleme var; `cullStart`
kullanılmıyor (fade yok). Sidecar level başına tek `<Level>.foliage.json`,
partition açık olsa da tamamı boot'ta okunur. `landscapeRules` editörde ve
Play'de bütün arazi için bir kez üretiliyor (kural başına 20k sınırı);
çok-tile World Terrain'de atlanıyor (uyarıyla). Foliage mesh'leri level için
`pinModels` ile sabit.

**İlkeler.**
1. Partition kapalı level'lar bugünkü gibi çalışır (tek sidecar, 16 m
   chunk'lar); fade her level'a gelir.
2. Boyanmış foliage'ın runtime kimliği yok (script durumu, mesaj hedefi yok),
   bu yüzden foliage hücre dosyaları — `main` hücrelerinin aksine —
   **talep üzerine okunabilir**: GUID sorunu burada yok.
3. Üretilen çim hiçbir zaman kaydedilmez; aynı kural + aynı arazi her
   makinede aynı instance'ları verir (hücre başına deterministik seed).
4. Kural başına `cullEnd = 0` ("hiç gizleme") bugünkü davranışı korur:
   bütün yüzey üretilir (küçük 1×1 arazide değişiklik yok). Çok-tile
   dünyada `cullEnd = 0` olan kural üst sınıra (512 m) kısılır ve editör
   uyarır.

**F1 — Cull fade (her level).** `cullStart..cullEnd` aralığında instance
başına **dither (screen-door) fade**: tür başına klonlanmış malzemeye
`onBeforeCompile` ile instance merkezinden kamera uzaklığı (vertex) +
Bayer eşiğiyle `discard` (fragment); aynı kesme `customDepthMaterial` /
`customDistanceMaterial`'a da eklenir ki gölge de solsun. Saydamlık yok,
sıralama sorunu yok, malzeme sayısı tür başına bir (program anahtarı sabit).
Kalite çarpanı uniform olarak gider; çarpan değişince yeniden derleme yok.
Chunk gizleme `cullEnd`'de kalır (CPU tarafı erken çıkış). Foliage Mode
Faz 2'nin açık "cull start/end fade" maddesi bununla kapanır.

**F2 — Boyanmış foliage hücre dosyaları (partition açık level'lar).**
- `foliage` grid'i: 64 m hücre, 256 m menzil (`worldSettings.partition.grids.foliage`,
  `normalizeWorldPartitionSettings` + validator; yükleme menzili
  `viewDistanceMultiplier` ile ölçeklenir). Menzil türlerin `cullEnd`'inden
  kısaysa uzak instance'lar zaten görünmez; `cullEnd` menzilden uzun tür için
  editör uyarısı (uzak görünüm Faz 7 HLOD/impostor işi).
- Dosyalar: `<Level>.foliage.json` partition açıkken **dizin** olur (gruplar
  `id/foliageTypeId/target` ile, `instances: []`; `landscapeRules`;
  `foliageCells: ["x_z", ...]`) + `<Level>.cells/foliage/<x_z>.foliage.json`
  (`{schema:1, type:"foliageCell", cell, groups:[{id, instances}]}`). Instance
  konumuna göre hücreye düşer. Sıra Faz 5 ile aynı: değişen hücreler (silmeden)
  → dizin → `keep` ile temizlik; yalnız kirli hücreler yazılır. Validator
  mevcut `normalizeFoliageData` instance normalizer'ını yeniden kullanır
  (yeni allowlist yüzeyi: `/__save-foliage-cells`, dropped[] raporlu).
- Editör v1 bütün hücre dosyalarını okuyup birleştirir (bugünkü tam belgeyle
  çalışır; seçim indeksleri birleşik grupta, birleştirme sırası hücre
  anahtarına göre deterministik). Editörde foliage akışı Faz 8 işi.
- Runtime `FoliageCellStreaming`: pawn/kamera çevresinde hücre dosyasını
  ön-yükleme halkasında (1,5×) okur (Loaded), menzile girince batch'i kurar
  (Activated), 1,25× histerezisle boşaltır; kare başına bütçe (instance
  sayısına göre). Partition'lı level'da render batch'i **hücre × grup** (64 m)
  olur: 256 m menzilde ~50 hücre × tür draw call; 16 m chunk ile ~800 olurdu.
  Per-instance fade sayesinde büyük batch görünür bir sıçrama yaratmaz.
  Boot/travel/save-load spawn menzilindeki hücreleri loading ekranının
  arkasında bekler. Mesh'ler dizindeki türlerden bilindiği için level boyunca
  sabit kalır (K5'e foliage sahipliği eklenmez — v1 sadeliği).

**F3 — Prosedürel çim halkası.**
- `grass` grid'i: 32 m hücre. Kural başına halka yarıçapı = tür `cullEnd`
  (× `foliageCullDistanceScale`); `cullEnd = 0` → bütün yüzey (ilke 4).
- Saf çekirdek `engine/scene/proceduralFoliage.ts`: `FoliageSurface`
  arayüzü (`heightAt` = K3a üçgen-birebir `terrainHeightAt`, `normalAt`,
  `layerWeightAt(layerId)`), iki uygulaması: World Terrain (`TerrainTileMap`,
  kural `layerId` → `def.layers` indeksi) ve 1×1 `ForgeLandscapeData`
  (bugünkü bilinear, rotasyonlu). `generateFoliageCell(rule, type, surface,
  cell)` → seed = hash(rule.seed, cellX, cellZ); hücre içinde jitter'lı grid;
  her örneğin sabit bir `r` değeri var.
- **Mesafeyle yoğunluk:** hücre uzaklığına göre bant (ör. 1 / 0,5 / 0,25);
  örnek yalnız `r < bantOranı × grassDensity` ise tutulur. Kümeler iç içe
  olduğu için bant değişince instance'lar yer değiştirmez, yalnız eklenir ya
  da düşer.
- Kural başına hücre sınırı (hücre başına 4096) eski kural başına 20k'nın
  yerine geçer. Yeni çekirdek kalite alanı `grassDensity`
  (ultra 1 / high 0,8 / medium 0,55 / low 0,3; adaptif kalite ve user
  settings normalizer'ına eklenir).
- Üretim yeri spike'a bağlı (G0): hücre başına < 1 ms ise ana thread'de
  kare bütçesiyle, değilse worker'da (hücrenin yükseklik + ağırlık dilimi
  kopyalanıp gönderilir, ~10 KB). Tile'ı yüklü olmayan hücre bekler.
- Hem 1×1 Landscape hem çok-tile World Terrain aynı yoldan; çok-tile atlama
  uyarısı kalkar. Bu, Faz 8'deki 1×1 köprüsünü kaldırma maddesinin
  önkoşulunu karşılar.
- Editör: aynı halka editör kamerası çevresinde; sculpt/paint'in kirli
  dikdörtgenine değen hücreler yeniden üretilir (bugünkü 120 ms birleştirme
  korunur). Foliage panelinde kurallar çok-tile'da da açılır.

**G0 — Ölçüm spike'ı (önce).** `spikes/grass-ring` (main'e merge'den önce
silinir): (a) 32 m hücre üretim süresi, yoğunluk 2/4/8 m⁻² ×
`terrainHeightAt` + ağırlık + roll + matris; (b) 50k/150k/300k çim
instance'ının GPU kare süresi, dither'lı ve dither'sız, gölgeli ve
gölgesiz; (c) hücre × grup batch'i kurma/yükleme süresi. Bütçe hedefleri ve
worker kararı buradan çıkar.

*G0 sonuçları (2026-10-24, `spikes/grass-ring`, RTX 3060 / ANGLE D3D11,
1280×720, Kenney `grass.glb` 132 üçgen, 2×2 tile sentetik arazi, %58 çim
katmanı):*

| Ölçüm | Sonuç |
|---|---|
| (a) 32 m hücre, 4 m⁻² (2355 kabul) | bugünkü yardımcılarla 2,9–3,0 ms (1,25 µs/instance); doğrudan paketli matris 1,6 ms ort., p95 2,7 ms (0,7 µs/instance) |
| (a) 8 m⁻² (4763 kabul) | yardımcılar 6,5 ms, paketli 3,5 ms (p95 6,7) |
| (b) 50k / 150k / 300k, gölgesiz | GPU 1,0 / 2,6–2,8 / 5,3 ms (38 batch, frustum sonrası 19 draw call) |
| (b) dither fade'in ek maliyeti | ≤ %4 (gölgeli ve gölgesiz) |
| (b) çimin gölge atması | ×2,5–2,8 (150k: 2,6 → 7,1 ms; 300k: 5,3 → 15,1 ms) |
| (c) batch kurma, 2k / 4k / 8k / 16k | `createInstancedModelGroup` 0,4 / 0,6 / 1,2 / 3,4 ms; paketli 0,1 / 0,3 / 0,6 / 1,4 ms; ilk çizim (yükleme dahil) 1,2–2,8 ms |

Kararlar:
- **Üretim worker'da.** Paketli yolla bile hücre başına ortalama 1,6 ms,
  p95 2,7 ms ve kurallar üst üste biniyor (3 kural ≈ 5–8 ms); 1 ms eşiğinin
  üstünde. Faz 4'ün `terrainWorkerPool`'una "foliage cell" işi eklenir;
  worker aynı saf üreticiyi hücrenin yükseklik + ağırlık dilimi (bir quad
  paylı, ~10–20 KB) üzerinde koşturur ve paketli `Float32Array` matrisleri
  transferable olarak döndürür. Ana thread'e yalnız batch kurma (paketli,
  ≤ 1,4 ms) + ilk çizim kalır: kare başına en çok bir hücre aktive edilir.
- Üretici Euler/`Matrix4` nesnesi üretmez, doğrudan paketli matris yazar;
  `createInstancedModelGroup`'un `Matrix4[]` yolunu çim kullanmaz.
- **Dither fade tasarlandığı gibi** (F1), maliyeti ölçüm gürültüsü
  düzeyinde.
- **Çim gölgesi varsayılan kapalı:** gölge çim maliyetini 2,5–2,8 katına
  çıkarıyor. Starter çim türü `castShadow: false`; gölge atan türe bağlı
  halka kuralı panelde uyarı gösterir (yasak değil).
- **Bütçe:** 3060'ta 150k gölgesiz çim ≈ 2,7 ms GPU; orta seviye GPU için
  2–3 kat pay bırakılır. `grassDensity` ultra 1 / high 0,8 / medium 0,55 /
  low 0,3 korunur; 4 m⁻² × %60 kaplama × 96 m halka ≈ 67k (ultra) …
  20k (low) instance. `?debug` overlay'i halka instance sayısını gösterir.

**Dilimler.** G0 spike → F1 fade → G1 saf çekirdekler (foliage hücre
bölme/birleştirme + dosya formatı + validator; prosedürel hücre örnekleyici;
Codex'e uygun) → F2 editör save/load + runtime hücre akışı → F3 runtime çim
halkası → F3 editör halkası + panel → smoke'lar (`foliage-fade`,
`foliage-cells`, `grass-ring`) + CONTENT_LOADING_CONTRACT'a foliage bölümü.

**İlerleme:**
- *F1 tamam (2026-10-24, 1678f46):* `engine/render-three/foliageFade.ts`.
  `cullEnd > 0` olan türün grubu, slot'u çözülmüş malzemelerinin grup başına
  fade klonlarıyla çizilir: Bayer 4×4 dither, kamera uzaklığı, gölge
  depth/distance malzemeleri de aynı testle solar. Pencere uniform
  (kamera + kalite çarpanı), program yeniden derlenmez. `cullStart` boş
  (0) ya da ≥ `cullEnd` ise `cullEnd`'de instance başına kesme olur;
  eskiden yazılmış türler bu yüzden aynı görünür. Klon kaynağın `defines`'ını ve
  `onBeforeCompile` yamasını taşır. Smoke `foliage-fade.spec.ts`: lit +
  shadow programı GPU'da derlenir; pencere öncesi dolu, ortası ≈ yarı,
  sonrası 0 piksel. Not: headless donanım ipucu gölgesiz profil seçer;
  smoke elle "high" seçer.
- *G1 tamam (2026-10-24, 3861e49, Codex):* `grids.foliage` (64/256),
  `engine/world/foliageCells.ts`, `validateSaveFoliageCellsPayload` (uca
  bağlı değil), `engine/scene/proceduralFoliage.ts` (`FoliageSurface`,
  `generateFoliageCell`, paketli matris, iç içe küme).
- *F2 tamam (2026-10-24):* **F2a** (a8cff90) `/__save-foliage-cells`,
  kayıt sırası hücreler → dizin → budama, partition kapatılınca önce
  birleşik sidecar sonra hücre silme. Kayıt oturumu diskteki hücre ayak
  izlerini tutar ve level'ın foliage grid'ine uymuyorsa düzenleme olmadan da
  yeniden böler. Editör bütün hücreleri birleştirir; okunamayan hücrede
  yükleme durur (Save okunmamış instance'ın üzerine yazamaz). **F2b**
  `FoliageCellStreaming` (`src/scene/foliageCellStreaming.ts`, çekirdek
  `WorldPartitionStreaming`, actor indeksi olmayan dolu hücrelerle):
  kamera çevresinde talep üzerine okuma (ön-yükleme halkası 1,5×, menzil
  × `viewDistanceMultiplier`), hücre × grup tek batch
  (`FoliageRenderBinding.addCell/removeCell`), boot/travel/save-load
  hazırlığı loading ekranı arkasında, okunamayan hücre boş + uyarı.
  Smoke `foliage-cells.spec.ts`: Save hücreleri yazar, bayat hücreyi
  budar, yeniden açılan editör 5 instance görür, ikinci Save foliage
  yazmaz, Play yalnız spawn çevresindeki 3 hücreyi okur (3 km'deki hücreyi
  okumaz).
- *F3 runtime tamam (2026-10-24):* `engine/world/foliageRing.ts` (saf
  planlayıcı: 32 m hücre, yarıçap = tür `cullEnd` × `foliageCullDistanceScale`,
  `cullEnd = 0` → bütün yüzey, 1024 m'den geniş yüzeyde 512 m tavan + uyarı;
  bantlar 1 / 0,5 / 0,25 × `grassDensity`, çeyrek hücre bant histerezisi,
  1,25× tutma). `src/scene/proceduralFoliageRing.ts`: kural başına plan,
  altındaki tanımlı tile'ları yüklü hücre worker'da üretilir
  (`foliageCellGenerator.ts` + `engine/world/workers/foliageWorker.ts`,
  Codex; tile'lar worker'a bir kez kopyalanır, worker çökerse aynı veriyle
  yerel yola düşer), sonuç `FoliageRenderBinding.setPackedGroup` ile paketli
  matristen kurulur (kare başına 1 hücre, en çok 8 iş uçuşta). Boot/travel
  hazırlığı loading ekranı arkasında. World Terrain'de renderer'ın kendi
  belgesi (akan arazide canlı tile'lar) kullanılır; 1×1 Landscape tek tile
  görünümüyle (`landscapeTerrainView`); döndürülmüş ya da kare olmayan eski
  Landscape eski tek seferlik üretimde kalır. Kalite `grassDensity`
  (1 / 0,8 / 0,55 / 0,3); adaptif kalitenin foliage-cull adımı halkayı da
  küçültür. Smoke: `terrain-multitile` Play'de worker'ın kurduğu çim Node'da
  aynı üreticiyle hesaplanan sayıya birebir eşit (35 hücre, 16315 instance).
- *F3c editör tamam (2026-10-24):* editör aynı halkayı editör kamerası
  çevresinde tam yoğunlukta (çarpan 1) kurar; kural/tür/Landscape
  değişince halka yeniden kurulur. Sculpt/paint (1×1 ve çok-tile dab,
  undo/redo, RAW import) mevcut 120 ms birleştirmeyle o arazinin hücrelerini
  `ProceduralFoliageRing.replaceTerrain` ile bayat işaretler: tile'lar
  worker'a yeniden kopyalanır, eski batch'ler yenisi gelene kadar kalır.
  Halka batch'leri seçilemez (viewport tıklaması geçer). Foliage panelinde
  çok-tile Landscape'ler kural hedefi; kural satırı yarıçapı ("Cull End")
  ya da "never culls" uyarısını ve gölge maliyeti notunu gösterir.
  Döndürülmüş / kare olmayan eski Landscape'te eski tek seferlik üretim
  sürer. Smoke `terrain-multitile`: editör halkası tam yoğunlukta, Play
  0,8'de Node hesabına birebir eşit. **Faz 6 kapandı.** Kalanlar ve
  kapsam dışılar: editörde boyanmış foliage akışı (Faz 8), foliage
  collision (değişmedi), uzak ağaç impostor'ları (Faz 7), araç izinde çim
  ezilmesi (Terrain Deformation; `replaceTerrain` kancası hazır).

**Kapsam dışı:** foliage collision'ın akması (bugün collision çizim dışı,
`collision: true` türler yok sayılıyor — değişmiyor), editörde foliage
akışı (Faz 8), uzak ağaç impostor'ları (Faz 7), araç izi altında çimin
ezilmesi (Terrain Deformation planı; F3'ün hücre geçersizleme kancası onu
taşır).

## Faz 7 — Uzak görünüm: gölge, görüş mesafesi, LOD, HLOD

- [x] Kamera far/near World Settings `viewDistance` × kalite çarpanı;
      spring arm `farClip` buna bağlanır; K7 kararı uygulanır.
      *Tamam (2026-10-24, 7a + 7b):* ayrıntı aşağıdaki "7a tamam".
- [x] Gölge: `fitDirectionalShadowToBounds` yerine kameraya bağlı
      **cascaded shadow maps** (3–4 kaskad high/ultra, 2 low), texel'e
      hizalı kaydırma, gölge solma mesafesi. Splat ve foliage
      malzemeleriyle uyum.
      *Tamam (2026-10-25, 7c1 + 7c2):* ayrıntı aşağıdaki "7c2 ilerleme".
- [x] Height Fog ve Sky Atmosphere uzak mesafeyi ve akış kenarını gizleyecek
      varsayılanlar (dünya ayarına bağlı).
      *Tamam (2026-10-24, 7d):* ayrıntı aşağıdaki "7d tamam".
- [x] Actor LOD: mevcut `distanceLod.ts` + hücre bazlı küçük-nesne culling
      mesafesi (asset bounds'a göre).
      *Tamam (2026-10-24, 7e):* ayrıntı aşağıdaki "7e tamam".
- [x] **HLOD:** `npm run world:build` hücre başına statik mesh'leri tek bir
      sadeleştirilmiş GLB'de birleştirir (gltf-transform + meshoptimizer
      simplify). Yüklü olmayan `main` hücreleri yerine HLOD gösterilir.
      Dev'de HLOD yoksa uyarı, oyun yine çalışır.
      *Tamam (2026-10-24, 7f):* ayrıntı aşağıdaki "7f tamam".
- [x] `perf:assets` ve `verify:dist` hücre/tile/HLOD dosyalarını kapsar.
      *Tamam (2026-10-24, 7g + 7f):* denetim `verify:world-data` olarak
      ayrı adım (build:verify ve CI'da); HLOD dizini 7f ile eklendi.

### Faz 7 tasarımı (2026-10-24, kullanıcı onayladı)

**Bugünkü durum (kaynaktan):**

- **Uzak düzlem.** TPS karakter modu kameranın Camera component
  `farClip`'ini kullanır (varsayılan **100 m**). Diğer modlar ve editör
  `createSceneCamera`'nın 2000 m'sinde. Arazi global haritayla bütün dünyayı
  çizer ama TPS'te 100 m'de kesilir. World Settings'te görüş mesafesi yok.
  `viewDistanceMultiplier` bir fork uzantısı (`QualityExtensions`): akış
  menzillerini çarpar, şablon profilleri yazmaz.
- **Derinlik (K7) uygulanmadı.** K7'nin "Forge her kareyi EffectComposer ile
  çiziyor" varsayımı da yanlış: `PostProcessPipeline` yalnız authored bir
  effect pass varsa kurulur, yoksa sahne doğrudan tuvale (24-bit derinlik)
  çizilir. `reversedDepthBuffer` renderer kurulurken verilir; three'de
  sonradan `state.buffers.depth.setReversed` ile değişebilir (iç API).
  `logarithmicDepthBuffer` yalnız kurulumda verilebilir.
- **Gölge kamerayı izlemez.** `fitDirectionalShadowToBounds` güneş gölgesini
  `layout.instances` sınırlarına (arazi hariç) sığdırır ve frustum güneşin
  authored konumunda durur. 4 km dünyada ya her yeri kaba texel'le kaplar
  ya da güneşten uzaklaşınca gölge kalmaz. Arazi gölge alır, düşürmez.
- **Sis.** `FogExp2`/`Fog` mesafe tabanlı; varsayılan yoğunluk 0,03
  (~50 m'de %90). Açık dünyada ya hiç yok ya da çok yoğun.
- **Gökyüzü.** Sky kutusu derinlik testsiz, far'dan bağımsız. **Cloud Layer
  küresi** 90 m yarıçaplı, derinlik testli ama yazmasız: far büyüyünce 90 m'den
  uzaktaki arazinin üstüne bulut çizer. Far ile birlikte düzelmeli.
- **LOD.** `distanceLod.ts` yalnız fork'un verdiği LOD'lara bias uygular; Forge
  LOD üretmez. Actor/statik akışı `main` menzilinde (384 m) keser, HLOD yok.

**Dilimler ve sıra:** S7 spike ∥ 7a → 7b → 7c1 → (7c2, spike'a göre) → 7d →
7e → 7f → 7g.

**S7 — ölçüm spike'ı** (`spikes/far-view`, merge öncesi silinir;
OpenWorldTest + çim halkası + statikler, RTX 3060):
(1) çalışan bir sahnede `setReversed` aç/kapa: programlar yeniden derleniyor
mu, gölge karşılaştırması doğru dönüyor mu, maliyet; (2) kamera-takipli tek
kaskad vs three `CSM` eklentisiyle 2/3/4 kaskad: GPU ms, gölge draw call,
texel kalitesi, Forge'un kendi `onBeforeCompile` yamalarıyla (arazi, foliage
fade, world mask, materials) zincirlenebilirlik; (3) GTAO ve Bokeh reversed +
float derinlikle doğru mu.

**7a — Görüş mesafesi.**
- Yeni alan `worldSettings.viewDistance` (m, 50–20000). Yoksa bugünkü
  davranış sürer (İlke 3). saveValidator allowlist + drift testi, World
  Settings panelinde alan.
- Etkin far = `viewDistance × viewDistanceMultiplier` (yoksa 1). Akışla
  aynı düğme olduğundan görüş ve akış birlikte büyür ya da küçülür.
- Level `viewDistance` verdiyse oyun kameralarının hepsinde (Camera
  component, araç takip kamerası, serbest kamera) far'ı o belirler.
  Tek uygulama noktası `PlayerCameraManager`'ın projeksiyonu uyguladığı
  yerdir. Component `farClip` yalnız `viewDistance`'ı olmayan level'da
  geçerli kalır. Near component'ten gelir.
- Editör: kamera far = max(2000, `viewDistance`), kalite çarpanı uygulanmaz.
- Cloud Layer küresi far'a bağlanır (yarıçap ≈ 0,9 × far).

**7b — Derinlik (K7'nin uygulanması).**
- Etkin far > 1000 m olan level "uzak mod"a geçer: reversed-Z + float32
  derinlikli sahne hedefi. Daha küçük level'lar bugünkü standart tuval
  yolunda kalır.
- Mod level yüklenirken tek bir engine fonksiyonuyla değişir
  (`setSceneDepthMode`). Bu fonksiyon `setReversed`'i, gölge bias işaretini
  ve program yenilemeyi tek yerde toplar; travel bunu loading ekranı
  arkasında yapar.
- Uzak modda `PostProcessPipeline` her zaman kurulur (RenderPass →
  OutputPass), hedefine `DepthTexture(FloatType)` verilir.
- `EXT_clip_control` yoksa near uzak modda 0,1 → 0,5 m'ye çıkar ve tek
  seferlik uyarı verilir. Log derinlik renderer'ı yeniden kurmayı
  gerektirdiği için yedek olmaktan çıkar.
- GTAO/Bokeh S7'de bozuk çıkarsa uzak modda düzeltilir ya da uyarıyla
  kapatılır.

**7c — Gölge.**
- **7c1, kamera-takipli tek kaskad** (yalnız uzak mod; küçük level'lar
  sınır sığdırmada kalır): güneş frustum'u kamera odağının çevresine
  kurulur. Yarı genişlik `shadowDistance` × `shadowDistanceScale`
  (varsayılan 60 m; 2048'de ~6 cm texel). Kayma ışık uzayında texel'e
  hizalanır (yürürken gölge titremez). Derinlik aralığı yüklü arazinin
  yükseklik aralığını ve yüksek caster'ları kapsar. Saf hesap
  `engine/render-three` dışında, testli bir fonksiyon olur.
- **7c2, kaskadlar** (S7'nin sonucuna göre): three `CSM` ya da kendi
  uygulamamız, 3–4 kaskad high/ultra, 2 kaskad low/medium, kaskad sınırında
  ve gölge mesafesinin sonunda solma. Tek kaskadda gölge sınırı sert bir
  çizgidir; solma shader yaması gerektirdiği için kaskadlarla birlikte gelir.
- Çim gölgesi varsayılan kapalı kalır (G0).

**7d — Sis ve gökyüzü.** İlke gereği runtime authored veriye yazmaz;
varsayılanlar editör tarafındadır.
- Height Fog Details'ında **"Fit to View Distance"** komutu (undo'lu):
  exp yoğunluğu = 1,98 / far, yani far'da %98 sis
  (`FogExp2`: 1 − e^{−(ρd)²}).
- World Terrain oluşturma diyaloğu `viewDistance` ve uygun bir Height Fog
  önerir; Faz 8 New Open World sihirbazı da aynısını yapar.
- Uzak modda sis yoksa ya da far'daki opaklık %90'ın altındaysa World
  Settings'te uyarı satırı ve runtime'da tek seferlik konsol uyarısı
  ("arazi far düzleminde sert kesilir").
- Sis 384 m'deki actor akış kenarını gizlemeye yetmez; o 7f'nin (HLOD) işi.

**7e — Actor LOD / küçük nesne culling** (dilim başında kısa tasarım):
hücre batch'lerinde instance başına cull mesafesi, asset bounds yarıçapı ×
kalite katsayısından hesaplanır. Forge LOD mesh'i üretmez; fork'un
verdiğine `lodBias` uygulanır.

**7f — HLOD** (ayrı tasarım; açık soru 5 o zaman karara bağlanır):
`npm run world:build`, gltf-transform + meshoptimizer.

**7g —** `perf:assets` / `verify:dist` hücre, tile ve HLOD dosyalarını kapsar.

**Codex'e uygun saf dilimler:** `viewDistance` normalizer, validator ve
drift testleri; 7c1'in frustum/texel hizalama matematiği + testleri; sis
yoğunluğu yardımcısı.

**İlerleme:**
- *Tasarım onaylı (2026-10-24):* kullanıcı beş kararı da onayladı (level
  `viewDistance` far'ı ezer; çarpan yalnız `viewDistanceMultiplier`; uzak mod
  > 1000 m; önce tek kaskad; sis yalnız editör komutu + uyarı).
- *7a tamam (2026-10-24):* `worldSettings.viewDistance` (50–20000 m; layout,
  scene document, saveValidator, drift testi). Saf çekirdek
  `engine/world/viewDistance.ts` (`effectiveViewDistance`, `isFarViewMode`,
  sis yoğunluğu/opaklık yardımcıları) ve 7c1'in matematiği
  `engine/world/followShadow.ts` (`computeFollowShadowFrame`, three lookAt
  tabanıyla birebir, texel'e hizalı) Codex'ten. Far geçersiz kılması
  `engine/render-three/camera.ts` `setCameraFarOverride` (kamera başına;
  `PlayerCameraManager` projeksiyonu uygularken okur, `null` kameranın eski
  far'ını geri verir). Runtime level yüklenince ve kalite uzantıları
  değişince uygular; editör kamerası max(2000, `viewDistance`). World
  Settings → Environment'ta "View Distance (m)" alanı (boş = kameranın kendi
  far'ı). Cloud Layer küresi far × 0,9'a ölçeklenir (shader yön tabanlı,
  görünüm değişmez; uzak arazinin üstüne bulut çizilmesi düzeldi).
- *S7'nin derinlik kısmı kaynak okumasıyla kapandı (2026-10-24):* three
  program anahtarına derinlik durumunu katıyor (mod değişince shader'lar
  kendiliğinden yeniden derlenir); GTAO (`USE_REVERSED_DEPTH_BUFFER`) ve
  Bokeh (packing yardımcıları) reversed derinliği zaten destekliyor. İki
  tuzak: three kameranın `_reversedDepth`'ini yalnız açar (geri almaz) ve
  gölge haritasının karşılaştırma fonksiyonunu harita kurulurken sabitler.
  S7'nin kalanı (CSM maliyeti) 7c2'ye ertelendi.
- *7b tamam (2026-10-24):* `engine/render-three/depthMode.ts`
  `setSceneDepthMode` reversed durumunu, sahnedeki ve verilen kameraların
  projeksiyonunu, gölge haritalarını (yeniden kurulur) ve bias işaretini
  (`shadowDepthBias`, ±0,0005; `configureShadowCastingLight` buradan okur)
  birlikte değiştirir. Runtime etkin far > 1000 m'de (level yüklenirken ve
  kalite uzantısı değişince) uzak moda geçer: `PostProcessPipeline`
  `floatDepth` ile her zaman kurulur (HalfFloat renk, `DepthTexture(FloatType)`,
  4× MSAA — composer'da tuvalin MSAA'sı yok). `EXT_clip_control` yoksa
  near 0,5 m (`setCameraFarOverride` `nearMin`) + tek seferlik uyarı. Smoke
  `far-view.spec.ts`: 6000 m level'da reversed durum, far 6000, kamera
  projeksiyonu reversed, hedef float32 + 4 örnek, güneş bias'ı pozitif ve
  gölge haritası var; `viewDistance`'sız level standart yolda. Editör
  bilerek standart derinlikte (far ≤ `viewDistance`, en az 2000 m).
- *7c1 tamam (2026-10-24):* `engine/render-three/sunFollowShadow.ts`
  `updateSunFollowShadow` her karede (yalnız uzak mod, gölge açık, güneş
  gölge düşürüyorsa) güneşin frustum'unu kameranın yatay ileri yönünde yarı
  genişlik kadar öndeki noktaya kurar: yarı genişlik 60 m ×
  `shadowDistanceScale`, ışık ekseninde ±150 m, `computeFollowShadowFrame`
  ile texel'e hizalı. Işık ve hedefi birlikte ışık ekseninde kayar (yön
  değişmez; döndürülmüş light root'u altında `worldToLocal`). Bias dünya
  biriminde sabit (2 cm / derinlik aralığı, işaret moddan). Uzak modda
  `fitSunShadowToScene` devre dışı. Engine testi `sunFollowShadow.test.ts`
  (yön korunur, odak + texel, ışık ekseninde hareket kaydırmaz); smoke
  `far-view.spec.ts` high profilde −45 m frustum, far 300, hedef kameranın
  ~22,5 m önünde. Elle ekran görüntüsü: zemin + küpte gölge standart yolla
  aynı yerde, acne/peter-panning yok. Açık: gölge sınırı sert (solma 7c2).
- *7d tamam (2026-10-24):* Height Fog Details'ında "View Distance"
  bölümü: sisin level `viewDistance`'ındaki opaklığı, %90 altında uyarı ve
  **Fit to View Distance** komutu (undo'lu; exp, yoğunluk = 1,98 / mesafe →
  %98, 6 ondalık). Bulunan hata: save validator sis yoğunluğunu 3 ondalığa
  yuvarlıyordu (3 km uydurması 0,00066 → 0,001, 10 km'de 0,0002 → 0, sis
  Save'de kaybolurdu); yoğunluk artık 6 ondalık (drift testi). Runtime uzak
  modda far'daki opaklık %90 altındaysa konsola uyarı yazar; World Settings
  ipucu sisi önerir. `heightFogOpacityAt` saf yardımcı. Smoke
  `fog-fit-view-distance.spec.ts`. Ertelendi: World Terrain diyaloğunun
  `viewDistance` + sis önermesi (Faz 8 New Open World sihirbazıyla birlikte;
  2026-10-27'de New Landscape diyaloğunun Open World bölümüyle tamam).
- *7e tamam (2026-10-24):* küçük nesne culling, yalnız runtime ve yalnız
  açık dünya level'larında (World Partition açık ya da `viewDistance`
  tanımlı). Saf kural `engine/world/detailCulling.ts`: cull mesafesi =
  sınır yarıçapı × 200 (ekran boyutu), > 1000 m olan asset hiç cull
  edilmez; solma %80'de başlar; kalite `foliageCullDistanceScale` (adaptif
  kalite de küçültür). `engine/render-three/staticDetailCulling.ts` batch
  grubunun altındaki her mesh'i (InstancedMesh + yerleşim başına clone'lar:
  material slot / override / probe / mesh paint) asset başına paylaşılan,
  ölçek duyarlı dither-fade klonlarına geçirir (`foliageFade`
  `"instanceScaled"`: mesafe ÷ instance ya da dünya ölçeği; gölge de solar).
  Kompakt mesh'ler (hücre InstancedMesh'i ve her clone) en yakın noktası
  en büyük instance'ın mesafesini aşınca hiç çizilmez; level çapındaki
  InstancedMesh yalnız instance başına solar. Bulgu: material slot'u atanmış
  bir asset'in bütün yerleşimleri instanced batch yerine ayrı clone olarak
  çiziliyordu — bu yüzden culling clone'ları da kapsıyor. **Düzeltildi
  (aynı gün):** runtime asset slot'larını instanced batch'e uygular
  (`applyMaterialSlotOverrides`, spline/foliage ile aynı yol); clone'a yalnız
  yerleşime özel override materyal, probe envMap ve mesh paint gider. Zemin
  + küp sahnesinde 17 clone → 2 batch, ekran görüntüsü farkı 23/921600
  piksel (kenar yumuşatma). Editör bilerek clone yolunda kaldı. Engine testi `detailCulling.test.ts`,
  smoke `detail-culling.spec.ts` (600 m'deki karo atlanır, yakın ve 3×
  karo çizilir, program derlenir).
- *7g tamam (2026-10-24, 15bbf43, Codex + inceleme):*
  `tools/worldDataCheck.ts` (saf; engine'in yol yardımcılarıyla) her
  level'ın `worldCells`, foliage `foliageCells`, `landscapes[].dataRef`,
  World Terrain tile'ları ve global haritasını denetler: eksik dosya `fail`,
  tek tile'dan büyük terrain'de eksik global harita `warn`. `npm run
  verify:world-data` (varsayılan `dist`, `--root`, `--report`) build:verify'ın
  son adımı, CI'da da koşar. `perf:assets` aynı taramayı `public/` üzerinde
  "World data" bölümü olarak basar (level başına hücre/foliage/tile boyutu,
  en büyük 5 hücre). İlk koşu yerel bir artık buldu: gitignore'lu
  `OpenWorldTest.level.json` kalmış, `OpenWorldTest.landscapes/` silinmişti
  (dosya kenara alındı; `npm run world:test` ikisini yeniden üretir). HLOD
  kapsamı 7f ile gelir.

### 7f HLOD tasarımı (kullanıcı kararları 2026-10-24)

**Kararlar:** materyal (a) — build sırasında her kaynak materyalin
ortalama rengi vertex color'a pişirilir, proxy tek paylaşılan materyalle
çizilir (Unreal'ın doku pişirmesi (c) gerekirse sonra); üretim yalnız
`npm run world:build` (açık soru 5 kapandı).

**Kapsam (v1):** yalnız World Partition'ı açık level'lar; yalnız `main`
hücrelerine giden statik yerleşimler (`layout.instances`). Actor Script
mesh'leri, karakterler, foliage ve sentetik `shape:` asset'leri dışarıda.
7e kuralıyla zaten akış menzilinden önce sönen küçük asset'ler
(`detailCullDistance(yarıçap × ölçek) ≤ loadRange`) HLOD'a girmez.

**Build (`npm run world:build -- <public altı level yolu>`):**
1. Level + hücre dosyaları birleştirilir; `worldPartitionCellContents`
   runtime ile aynı hücre ataması verir.
2. Hücre başına: her yerleşimin GLB'si (gltf-transform) yerleşim matrisiyle
   dünya uzayına taşınır. Primitive rengi = slot materyali (asset
   `*.materials.json` → Forge `*.material.json` `baseColor` ×
   `baseColorTexture` ortalaması) ya da GLTF `baseColorFactor` ×
   `baseColorTexture` ortalaması; ortalama lineer uzayda. Slot indeksi
   runtime'daki `applyMaterialSlotOverrides` ile aynı sıra (sahnede ilk
   görülen benzersiz materyal sırası).
3. Hücrenin bütün üçgenleri tek primitive'de (POSITION, NORMAL, COLOR_0)
   birleşir, `weld` + meshoptimizer `simplify` (hedef oran ve hata sınırı
   parametreli) ile sadeleşir.
4. Çıktı: `<Level>.cells/hlod/<x_z>.hlod.glb` + dizin `<Level>.hlod.json`
   (`schema`, `cellSize`, hücre başına `key`, `triangles`, `sourceHash`).
   `sourceHash` hücrenin layout girdilerinden (asset id, yerleşim
   transformu) saf bir fonksiyonla hesaplanır; runtime aynı fonksiyonla
   eskimiş HLOD'u fark eder (asset dosyasının içeriği değişirse fark
   etmez — belgelenir).

**Runtime:** dizin varsa yüklenir (yoksa partition'lı level'da dev uyarısı:
"HLOD yok, `npm run world:build`"). Etkin görüş mesafesi içinde olup
statikleri **aktif olmayan** hücrenin HLOD'u gösterilir; hücre aktifken
gizlenir (gerçek mesh'ler ondan sorumlu). GLB'ler talep üzerine okunur,
görüş mesafesinin 1,25 katı dışında bırakılır. Tek paylaşılan
`MeshStandardMaterial({ vertexColors: true })`; gölge düşürmez, alır; sis
uygulanır. Eskimiş hücre: uyarı, yine de gösterilir. `verify:world-data`
dizinin listelediği GLB'leri de denetler.

**Bölüşüm:** Codex — saf çekirdek (`engine/world/hlod.ts`: dizin
normalizer, yol, `sourceHash`, dahil etme kuralı, renk ortalaması) + build
aracı + testler; Claude — runtime gösterimi, `verify:world-data`
genişlemesi, smoke.

**7f ilerleme:**
- *7f tamam (2026-10-24, Codex + inceleme):* saf çekirdek
  `engine/world/hlod.ts` (dizin, yollar, `hlodCellSourceHash`,
  `hlodIncludesPlacement`, `averageLinearColor`), build
  `tools/world/hlodBuild.ts` + `npm run world:build -- <level>` (eski proxy'leri
  budar; slot/Forge materyal rengi, `sharp` ile doku ortalaması, weld +
  meshopt simplify). Runtime `src/scene/hlodProxies.ts`: görüş mesafesi
  içinde ve statikleri aktif olmayan hücrenin proxy'si çizilir, aktif
  hücrede gizlenir; dizin yoksa / eskimişse uyarı. `verify:world-data`
  dizinin listelediği GLB'leri denetler. Smoke `hlod.spec.ts`: build
  smoke kopyasına yazılır, uzak hücrenin vertex renkli proxy'si görünür,
  aktif hücreninki gizli; kamera uzak hücreye gidince proxy gizlenir,
  gerçek mesh'ler görünür. Elle ekran görüntüsü: proxy kule + zemin
  doğru yerde. **Smoke'un bulduğu 7e hatası düzeltildi:** instance
  matrisi asset'in kendi düğüm ölçeğini de taşıyor (`Shape_Cube.glb`
  santimetre, 0,01 düğüm); culling yerleşim ölçeği yerine onu kullanıyordu,
  10× küp ~17 m'de kayboluyordu. Mesh başına taban ölçek (instanced:
  `userData.sourceMatrix`, clone: dünya ölçeği / clone kökü) ayrıştırıldı.
  CLI gerçek ortamda denendi (geçici level, 2 hücre, budama). Açık:
  Actor Script mesh'leri ve foliage HLOD'da yok; doku pişirme (c) gerekirse.

### 7c2 kaskadlı gölge — S7 ölçümü ve öneri (2026-10-24, kullanıcı onayladı)

**Spike** `spikes/far-view` (`run.mjs` + `probe.ts`; merge öncesi silinir).
Runtime gerçek OpenWorldTest'i (`npm run world:test`, 4 km) açar; level route
ile `viewDistance` 3000 (uzak mod, reversed-Z), `staticObjectsCastShadow`,
World Partition hücrelerinde (128 m, 36 hücre) 500 `commontree` + 120
`shape-cube` ve çim katmanına 4 m⁻² çim kuralı (80–96 m cull) alır. Probe
canlı renderer'a bağlanır ve güneş gölgesini varyantlar arasında değiştirir:
gölgesiz, bugünkü tek kaskad takipli gölge, three `CSM` eklentisi (2/3/4) ve
kendi prototipimiz (2/3/4, 4'te uzak iki kaskad dönüşümlü). RTX 3060 / ANGLE
D3D11, 1280×720, TPS kamera. Her varyant 4 turda karışık sırayla ölçüldü,
turların medyanı alındı. Ölçülen render'dan sonra sahne iki kez daha çizildi
(zamanlamasız): kare başına 3–4 ms işte GPU saati iniyor ve timer query
şişiyor. Bu yük olmadan "gölgesiz" bazen takipli gölgeden pahalı çıkıyordu.

**Sonuçlar** (GPU ms p50: kare toplamı / gölge geçişi; gölge draw call;
kaskad başına bölme mesafesi ve texel boyutu):

| Profil | Varyant | Kare | Gölge | Gölge DC | Bölmeler → texel |
|---|---|---|---|---|---|
| ultra 2048, 200 m | gölgesiz | 2,69 | — | 0 | — |
| | takipli (bugün) | 3,15 | 0,84 | 19 | ~90 m önü → 5,9 cm |
| | CSM 2 / 3 / 4 | 3,69 / 3,70 / 4,13 | 1,44 / 1,66 / 1,89 | 59 / 73 / 93 | 3: 34/75/200 m → 2,7/6,0/16,3 cm |
| | Forge 2 / 3 / 4 | 3,82 / 3,68 / 3,94 | 1,36 / 1,60 / 1,71 | 52 / 69 / 81 | 4: 16/36/77/200 m → 1,3/2,9/6,4/16,4 cm |
| | Forge 4 dönüşümlü | 3,95 | 1,38 | 51 | aynı |
| high 1024, 150 m | gölgesiz | 2,37 | — | 0 | — |
| | takipli | 3,1–3,5 | 0,81 | 17 | ~68 m → 8,8 cm |
| | CSM 2 / 3 / 4 | 3,38 / 3,37 / 3,35 | 1,19 / 1,43 / 1,47 | 50 / 65 / 73 | 3: 26/57/150 m → 4,1/9,1/24,3 cm |
| | Forge 2 / 3 / 4 | 3,3–3,8 / 3,31 / 3,30 | 1,17 / 1,35 / 1,43 | 45 / 61 / 70 | 3: 17/46/150 m → 2,7/7,6/24,6 cm |
| | Forge 4 dönüşümlü | 3,39 | 1,16 | 44 | |
| medium 512, 100 m | gölgesiz | 1,90 | — | 0 | — |
| | takipli | 2,38 | 0,77 | 14 | ~45 m → 11,7 cm |
| | CSM 2 / 3 / 4 | 2,79 / 2,78 / 2,83 | 1,06 / 1,14 / 1,30 | 36 / 45 / 58 | 2: 27/100 m → 8,6/32,4 cm |
| | Forge 2 / 3 / 4 | 2,66 / 2,72 / 2,82 | 1,06 / 1,11 / 1,22 | 36 / 44 / 54 | 2: 20/100 m → 6,6/32,8 cm |

- **Maliyet:** kaskadlar takipli gölgeye göre GPU'da +0,3–0,8 ms
  (gölge geçişi ×1,4–2,2) ve gölge draw call'ında ×2,5–4,5 ekler; CPU render
  +0,1–0,3 ms. Kaskad sayısından çok kapsama (200 m'lik son kaskad hemen
  bütün hücreleri görür) belirleyici: 2 → 4 kaskad yalnız +0,2–0,4 ms.
  Statikler hücre × asset batch'lerinde olduğu için her kaskad yalnız
  frustum'una giren hücreleri çizer. Level çapında tek InstancedMesh
  olsaydı her kaskad 500 ağacın tamamını yeniden çizerdi (ilk koşuda +6 M
  üçgen/kaskad).
- **Dönüşümlü güncelleme** (4 kaskadda uzak ikisi her iki karede bir):
  ultra'da gölge geçişi 1,71 → 1,38 ms, 30 draw call daha az. Güncellenmeyen
  kaskadın haritası da matrisi de eski karede kalır, yani birbiriyle
  tutarlı. Yalnız ilk kare çizilmeli (ilk denemede boş harita bağlandı, GL
  sampler hatası verdi).
- **Kalite:** aynı mesafede kaskadlar takipli gölgeden 2–5 kat keskin
  (ultra ilk 16 m 1,3 cm, bugün 5,9 cm) ve gölge 45–90 m yerine 100–200 m'ye
  uzanır. Ekran görüntülerinde (30 m yüksekten vadiye) CSM 3 ile Forge 3
  aynı: ağaç gölgeleri ~200 m'ye kadar var, kaskad geçişi görünmüyor,
  acne/peter-panning yok (Forge'da kaskad başına 2 cm/derinlik bias +
  0,75 texel normal bias). Bölme λ=0,75 (Forge) ilk kaskadı CSM'in
  λ=0,5'inden küçük ve keskin tutuyor.

**three `CSM` eklentisinin uyumsuzlukları** (kaynak + spike):
1. `setupMaterial` materyalin `onBeforeCompile`'ını zincirlemeden ezer:
   OpenWorldTest'te 48 lit materyalin 46'sının Forge yaması düşüyordu
   (arazi splat'ı, foliage fade, 7e `instanceScaled`, worldMask,
   materials.ts). Spike ölçebilmek için bunları elle zincirledi.
2. Kurulurken `ShaderChunk.lights_fragment_begin` ve `lights_pars_begin`'i
   **global** olarak değiştirir. Kopyası 0.184'ün parçasından eski (156
   satır fark: iridescence Fresnel karışımı, nokta ışık gölgesinin
   PCF/BASIC koşulu). Yani CSM'i kullanmayan materyaller, küçük level'lar
   dahil, three'nin eski aydınlatma koduyla derlenir. `dispose()` parçaları
   geri koymaz.
3. `dispose()` materyallerin `onBeforeCompile`'ını `delete` eder, yani
   Forge'un kendi yamalarını da siler.
4. `CSMFrustum` WebGL NDC'sini (z −1…1) varsayar. Reversed-Z projeksiyonunda
   near 1, far 0'a düştüğü için kaskad köşeleri ters/arkada çıkar. Spike
   reversed olmayan bir vekil kamera kullandı.
5. Kaskad bölmeleri, kamera near/far ve gölge mesafesi materyal başına
   uniform'dur. Sonradan gelen her materyal (hücre aktivasyonu, çim batch'i,
   HLOD proxy'si, aktör) ayrıca `setupMaterial`'dan geçmeli.

**Forge prototipi** (spike'ta çalışır, iki varyant da aynı maliyette):
- Işıklar: N `DirectionalLight` bir grupta, sırayla eklenir. Kaskad 0
  güneşin renk/parlaklığını taşır; 1..N−1 sıfır parlaklıklı yardımcı gölge
  ışıklarıdır. Güneş kaskad modunda gölge düşürmez. three gölgeli ışıkları
  öne, kendi aralarında sahne sırasıyla dizdiği için kaskad sırası korunur.
- Shader: materyal başına **zincirli** `onBeforeCompile`. Önceki yama ve
  `customProgramCacheKey` korunur, anahtar sona `|forge-cascades` ekler.
  `#include <lights_fragment_begin>` three'nin **o anki** parçasından
  türetilen kopyayla değişir. Yalnız yönlü gölge satırı (çapa; bulunamazsa
  hata, three yükseltmesinde test yakalar) ve yardımcı ışıkların
  `RE_Direct`'i değişir. Global `ShaderChunk`'a dokunulmaz, eski kopya
  tutulmaz.
- Kaskad seçimi gölge koordinatından yapılır: fragment'ı içeren ilk kaskad
  kullanılır. Kenarın %5'lik bandında bir sonrakiyle karıştırılır, son
  kaskadın kenarında gölgesize solar. Ek uniform gerekmez; sampler dizisi
  sabit indeksle açılır (`#if NUM_DIR_LIGHT_SHADOWS > k`, en çok 4).
- Frustum: kaskad k, kameradan bölme mesafesine kadar olan frustum
  diliminin çevrel küresine oturur (dönüşte boyu değişmez, titremez).
  Merkezi `computeFollowShadowFrame` ile texel'e hizalanır. Kaskadlar iç
  içedir, bu yüzden kenar karışımında her zaman bir sonraki kaskad vardır.

**Öneri (7c2 kapsamı):**
1. **Kendi uygulamamız, three `CSM` değil.** Maliyet aynı, ama eklenti
   Forge'un materyal yamalarını düşürüyor, global aydınlatma parçasını eski
   kopyayla değiştiriyor ve reversed-Z'de bozuk.
2. **Profil:** ultra 4 kaskad / 2048 / 200 m (son iki kaskad dönüşümlü),
   high 3 / 1024 / 150 m, medium 2 / 512 / 100 m. Low gölgesiz (bugün de
   `shadowsEnabled: false`); kullanıcı açarsa 2 kaskad / 70 m. Mesafe =
   200 m × `shadowDistanceScale`, yani adaptif kalite mesafeyi küçültmeye
   devam eder. Kaskad sayısı ve dönüşüm yeni profil alanları (ör.
   `shadowCascades`), normalizer + testlerle.
3. **Gölge mesafesi sonunda mesafeye bağlı solma:** paylaşılan tek bir
   uniform nesnesi (`{ value: [başlangıç, bitiş] }`, bütün yamalı
   materyallere aynı referans; [0,85 D, D]). Prototipteki son kaskad kenarı
   ışık uzayında bir kare: küre merkezi dilimin sonunda olduğundan ileri
   yönde 2,2 D'ye uzanıyor, yanlarda daha kısa kalıyor. Mesafe solması
   kenarı kamera çevresinde düzgün bir daire yapar. Kaskadlar arası geçiş
   gölge koordinatı bandıyla kalır.
4. **Yalnız uzak mod.** Yama ve kaskad ışıkları yalnız uzak modda kurulur.
   Küçük level'lar bugünkü sınır sığdırmada ve shader'da kalır (program
   anahtarı değişmez). 7c1'in takipli tek kaskadı kaskad sayısı 1 olarak
   bu yolun içinde kalır (`EXT_clip_control` yoksa ya da profil 1 derse).
5. **Materyal kaydı:** uzak modda sahneye sonradan giren her lit materyal
   (hücre aktivasyonu, çim/foliage batch'leri, HLOD proxy'leri, aktörler,
   karakterler) yamayı almalı. Önerilen yol kare başına `scene.traverse` +
   `WeakSet` (OpenWorldTest'te ~130 mesh; maliyeti entegrasyonda
   ölçülecek). Alternatif: materyal üreten noktalarda kayıt.
6. **İkinci gölgeli yönlü ışık:** shader gölgeli yönlü ışıkların hepsini
   kaskad sayar. Uzak modda güneş dışındaki yönlü ışığın gölgesi kapatılır
   ve tek seferlik uyarı verilir. Nokta/spot gölgeleri etkilenmez.
7. Çim gölgesi varsayılan kapalı kalır (G0). Sonraki düğme olarak dış
   kaskadlardan küçük caster'ları `shadow.camera.layers` ile dışlamak
   mümkün; 7c2'de yok.

**Onay (2026-10-24):** kullanıcı öneri 1–7'yi olduğu gibi onayladı (kendi
uygulama, profil tablosu, uzak modda ikinci yönlü ışığın gölgesi kapalı +
uyarı, materyal kaydı kare başına tarama + `WeakSet`).

**Codex'e uygun saf dilim:** `engine/world/sunCascades.ts`: bölme
(`computeCascadeSplits(count, near, distance, lambda)`), dilim küresi
(`cascadeSliceSphere(fovDeg, aspect, distance)`), kaskad frame'leri
(`computeFollowShadowFrame` üstünde) ve dönüşüm takvimi + testler. Shader
yaması, ışık grubu, materyal kaydı, profil bağlantısı ve smoke Claude'da.

**7c2 ilerleme:**
- *7c2 tamam (2026-10-25):* saf çekirdek `engine/world/sunCascades.ts`:
  bölmeler (λ 0,75, 1 m'den), dilim küresi, `computeSunCascades`
  (`computeFollowShadowFrame` üstünde, ışık yönünde küre + 100 m), dönüşüm
  takvimi, mesafe 200 m × `shadowDistanceScale`, solma [0,85 D, D]. Kalite
  profiline `shadowCascades` (ultra 4 / high 3 / medium 2 / low 2) ve
  `shadowCascadeStagger` (yalnız ultra) eklendi; custom ayar normalizer'ı
  ikisini de kabul eder. `engine/render-three/sunCascadeShadow.ts`
  (`SunCascadeShadow`): bir grupta N yönlü ışık; 0 güneşin renk ve
  parlaklığını her kare kopyalar, diğerleri siyah yardımcıdır. Güneş katman
  maskesi 0 ile render dışına çıkar (authored `visible`/`castShadow`
  okunabilir kalır), haritası serbest bırakılır; çıkışta maskesi geri gelir.
  Yama zincirlidir: önceki `onBeforeCompile` ve anahtar korunur, anahtara
  yalnız etkinken `|forge-sun-cascades` eklenir; three'nin o anki
  `lights_fragment_begin`'i çapa satırıyla kopyalanır (çapa yoksa hata, engine
  testi yakalar). Pasifken yama hiçbir şey yapmaz ve anahtar aynı kalır,
  yani küçük level'lar eskisiyle aynı programları derler. Materyal kaydı
  kare başına sahne taraması + `WeakSet` (yalnız uzak modda); başka gölgeli
  yönlü ışığın gölgesi kapanır, tek uyarı verilir, çıkışta geri gelir.
  Kaskad başına 2 cm / derinlik bias ve 0,75 texel normal bias. Runtime:
  uzak mod + reversed-Z + profil ≥ 2 kaskad → kaskadlar; aksi halde (profil
  1 ya da `EXT_clip_control` yok) 7c1 takipli gölgesi değişmeden çalışır,
  onda mesafe solması yok.
- *Uygulamada bulunan kaskad hatası:* kaskad kutusu ışık uzayında kare,
  derinliği ise yalnız dilim küresi kadar. Uzak düzlemin ötesindeki parça
  reversed-Z'de `z < 0` ile three'nin `z <= 1` testini geçiyor ve gölgede
  okunuyordu (Ultra, 7,5° aşağı bakan pozda caster'sız zeminde kama).
  Standart derinlikte aynı parçalar yanlışlıkla aydınlık çıkardı. Seçim artık
  derinliği de [0, 1] içinde olan ilk kaskadı alır, değilse sonrakine düşer.
- *7e hatası düzeltildi (aynı gün):* `staticDetailCulling` solma penceresini
  taban ölçekle çarpıyordu. Shader mesafeyi tam ölçeğe (taban × yerleşim)
  böldüğü için pencerenin tabana bölünmesi gerekir. Santimetre GLB'ler
  (`Shape_Cube`, 0,01 düğüm) uzak modda birkaç santimetrede dither ile
  tamamen kayboluyordu. CPU atlama testi doğru olduğundan smoke'lar
  (`visible` bayrağı) yakalamadı. `detailCulling` engine testi artık
  pencereyi ve shader mesafesini de doğrular.
- *Doğrulama:* engine testleri `sunCascades.test.ts` (bölme tablosu, küre,
  her kutu kendi ve önceki dilimleri kapsar, dönüşte sabit boy, texel
  hizası, takvim, profil alanları) ve `sunCascadeShadow.test.ts` (çapalar,
  güneş devri, ışık sayısı/güneş değişimi, susturulan ışık, dönüşüm, zincirli
  yama + anahtar + pasif no-op). Smoke `far-view.spec.ts`: high profilde
  3 kaskad, güneş katmanı 0 ve haritasız, kaskad başına bias/derinlik,
  yamalı program derlendi; pozlanmış Ultra'da 4 kaskad ve açık zemin
  köşelerinde karanlık piksel < %1 (derinlik düzeltmesi geri alınınca %15).
  Elle ekran görüntüleri: aynı pozda high kaskadlar ~150 m'ye kadar gölge
  çiziyor, 7c1 kadrajdaki küplere hiç gölge vermiyor; Ultra standart yolla
  tutarlı. **Ölçülmedi:** GPU maliyeti (headless, yazılım GL; S7 rakamları
  geçerli varsayım), kare başına tarama maliyeti, OpenWorldTest'te görsel
  kabul ve kamera hareketinde titreme/kaskad geçişi.
- *Sun üzerinde bayrak (2026-10-25, kullanıcı kararı):* kaskadlar artık uzak
  moda değil, Sun'daki **Cascaded Shadows** onay kutusuna bağlı
  (`LayoutLightActor.cascadedShadows`, Unreal'daki directional light CSM;
  save validator, editör klonu, drift testi). Bayrak açıkken her level'da
  çalışır, standart derinlikte de (bias işareti moddan). Bayrak kapalıyken uzak
  mod 7c1 takipli gölgeyi, diğer level'lar sınır sığdırmasını kullanır.
  Editörün perspektif görünümü High profilinin kaskadlarıyla önizler.
- *Doku birimi bütçesi:* her kaskad lit materyallere bir gölge haritası daha
  ekler. Lit arazinin fragment aşaması 13 kendi dokusu + ortam haritası +
  `dfgLUT` = 15 birim kullanır; ANGLE/D3D11'in sınırı 16. 2 kaskadda program
  bağlanamıyor, arazi hiç çizilmiyordu (kullanıcının LandscapeTest'te gördüğü
  "arazi yok"). `affordableSunCascades` sayıyı GPU'nun
  `MAX_TEXTURE_IMAGE_UNITS`'ine göre sınırlar; 16 birimde arazili level'da
  kaskad kapanır, güneş tek haritaya döner ve konsola uyarı yazılır.
  `TERRAIN_LIT_FRAGMENT_SAMPLERS` shader kaynağından sayılır, engine testi
  derlenen arazi shader'ına bağlar. Smoke `sun-cascaded-shadows.spec.ts`
  sınırı 16'ya düşürüp arazi programının aktif sampler'larını sayar.
  *Katman dizisi (2026-10-27):* boya katmanı dokuları artık tek
  `sampler2DArray` (`uLayerTexArray`, `terrainLayerArray.ts`); dokulu arazi
  katman sayısından bağımsız 1 birim alır (lit arazi 6 + 1 = 7), 16 birimli
  GPU'da Ultra'nın 4 kaskadı ve su yolu birlikte sığar. Dizi katmanları ortak
  boyuttadır: en büyük katmanın uzun kenarı (üst sınır 2048); küçük ya da kare
  olmayan doku yeniden örneklenir (UV tüm resmi kaplar, görünüm aynı, yalnız
  texel yoğunluğu değişir). Satırlar kaynağın `flipY`'sine göre GL sırasında,
  RGB sRGB / alfa doğrusal (paketli roughness); mipmap ve en yüksek anizotropi
  korunur. Okunamayan doku (görüntü yok, RGBA8 olmayan veri) rengini çizer.
  Program anahtarı artık katman sayısı değil, dokulu olup olmaması
  (`forge-terrain-cdlod-l0/l1`). Doğrulama: `terrainLayerArray` engine testleri
  (boyut, wrap'li bilineer, flipY, sıra/-1, ayarlar, önbellek), sekiz katmanlı
  ıslak katman testi dizi içeriğini okur; smoke `sun-cascaded-shadows.spec.ts`
  16 birimde 5 katmanlı LandscapeTest arazisinde Ultra'yla 4 kaskad, 13 aktif
  fragment sampler'ı ve `uLayerTexN` olmadığını doğrular. Görsel eşdeğerlik
  (eski/yeni build, editör, üç kamera pozu): ortalama fark 0,40–0,67 seviye,
  >8 seviye değişen piksel ≤ %0,115, build içi gürültü 0.

## Faz 8 — Editör dünya araçları

- [x] **New Open World** sihirbazı: tile sayısı, tile boyu, spacing,
      yükseklik aralığı, hücre boyları; boş ya da heightmap'ten.
      *Tamam (2026-10-27, boş dünya):* ayrı bir menü girdisi yok (tek
      Landscape girişi kararı); Add Actor → Landscape diyaloğundaki **Open
      World** bölümü her grid boyutunda açıktır (1×1 tile 8 m aralıkla 2 km'ye
      çıkar; partition/görüş mesafesi/sis level ayarıdır). Yalnız yükseklik
      aralığı çok-tile'a özeldir: çok-tile u16 saklar ve aralık adımı belirler,
      1×1 köprüsü Float32 kaydeder ve aralığı veriden genişletir
      (`captureTerrainSnapshot`). Alanlar: yükseklik aralığı (u16 adımı
      gösterilir; düz başlangıcı, yani 0'ı içermeli, ±10 km), World Partition
      açık/kapalı + `main` hücre boyu ve yükleme menzili, görüş mesafesi ve
      "Fit Height Fog to the view distance". Level'ın mevcut değerleriyle açılır;
      **Suggest for this world** görüş mesafesini en uzun kenara (100 m'ye
      yukarı yuvarlı) ayarlar, partition'ı açar, 1000 m üstünde sisi işaretler.
      Notlar hücre sayısını, uzak görüş modunu ve sissiz sert kenarı söyler.
      Terrain, World Settings ve sis (yoksa eklenir, varsa 7d'deki gibi exp +
      %98 opaklığa uydurulur) **tek undo adımı** ("Create Open World"); foliage
      grid'i korunur. Saf çekirdek `engine/world/openWorldSetup.ts`,
      `WorldTerrainCreateOptions.heightMin/heightMax`. Doğrulama: engine
      `open world setup` + `world terrain create` yükseklik aralığı testleri;
      smoke `terrain-create.spec.ts` ikinci senaryo (diyalog, öneri, notlar,
      geçersiz görüş mesafesi, Create sonrası level/tanım alanları, tek undo
      hepsini geri alır, redo geri getirir).
      *Heightmap'ten başlatma (2026-10-27):* diyalogda isteğe bağlı
      **Heightmap** bölümü (16-bit PNG ya da RAW). Dosya seçilince grid onun
      boyutuna uydurulur (`worldTerrainGridForHeightmap`: önce seçili çözünürlük,
      sonra 256/128/64; yeniden örnekleme yok, uymayan boyut gerekçeyle
      reddedilir); RAW başlıksız olduğu için kare kabul edilir, değilse mevcut
      grid'e uymalıdır. "Min Height (0) / Max Height (65535)" Details import'uyla
      aynı anlamda ve dünyanın kodlama aralığı olur, böylece u16 kayıt PNG
      kodlarını aynen geri yazar; Open World'ün yükseklik aralığı satırları
      gizlenir. `createWorldTerrainFromHeightmap` düz dünya gibi varsayılan
      katmanlar + katman 0 tam ağırlık kurar, yükseklikleri `importRawHeightmap`
      ile doldurur; 1×1 köprüye de gider. Oluşturma ile aynı tek undo adımı.
      Doğrulama: engine `world terrain create` (grid uydurma, kod korunumu,
      dikiş, big-endian, boyut/aralık ret, 1×1); smoke `terrain-create.spec.ts`
      dördüncü senaryo (100×100 reddedilir; 129×65 → 2×1 × 64 quad, grid
      değişince Create kilitlenir, kaydedilen tile'lar PNG kodlarını 0 farkla
      taşır, tek undo kaldırır).
- [ ] Büyük heightmap import (ör. 4097² 16-bit PNG/RAW) worker'da *(ertelendi, Faz 2 maddesindeki ölçüm)*, ilerleme
      çubuğuyla; export aynı.
- [ ] **World Partition paneli:** heightmap'ten üretilmiş minimap, hücre
      grid'i, bölge seçip yükle/boşalt, kalıcı "pinned" bölgeler; editör
      kamerası etrafında otomatik yükleme (runtime'dan geniş menzil).
      *İlk dilim tamam (2026-10-27):* sol panelde Scene Outliner'ın yanında
      **World Partition** sekmesi (`src/editor/panels/world/worldPartitionPanel.ts`).
      Canvas'ta global yükseklik haritasından gölgeli minimap (1×1 Landscape:
      kendi yükseklikleri; döndürülmüşse yalnız ayak izi), tile'lar editör
      durumuna göre (yüklü / yükleniyor / yüklü değil karartılmış), kaydedilmemiş
      tile'lar turuncu çerçeveli, dolu partition hücreleri öğe sayısıyla, kamera
      işareti ve akışlı arazide yükleme menzili. Üzerine gelince tile, hücre ve
      koordinat; tıklama editör kamerasını aynı yön ve yerden yükseklikle oraya
      götürür, akış o bölgeyi yükler. Sekme açıkken 400 ms'de bir yoklar.
      Saf çekirdek `engine/world/worldMapView.ts` (çerçeve, piksel dönüşümü,
      gölgeleme, odak pozu); `TerrainEditorStreaming.isLoading/loadRange`,
      `WorldTerrainEditSession.editRevision`. Yeni/genişletilmiş çok-tile arazi
      artık yükleyici gibi global haritasını kurar (minimap'te de görünür).
      Doğrulama: engine `world map view` + akış okuyucuları; smoke
      `world-partition-panel.spec.ts` (12×12 akışlı dünya: özet, hücre sayıları,
      hover metinleri, yüklü/yüklü olmayan parlaklık farkı, tıklayınca uzak
      köşe yüklenir ve eski bölge boşalır).
      *İkinci dilim tamam (2026-10-27):* haritada sürükleyerek bölge seçimi
      (tıklama yine kamerayı götürür, 4 px eşik); **Load Region** bölgenin
      tile'larını kamera nereye giderse gitsin yüklü tutar, **Unload Region**
      bırakır (kamera yakınındaki ve kaydedilmemiş tile'lar zaten kalır),
      **Clear** seçimi siler. Tutulan tile'lar mor çerçeveli; özet sayıyı ve
      tahmini editör belleğini gösterir. Akışta `held`'den ayrı bir küme
      (`keepLoaded`/`releaseKept`/`isKept`): fırça vuruşu ya da import'un
      argümansız `release()`'i tutulanları bırakmaz. Kalıcılık kamera pozu
      gibi `localStorage`'da, terrain yolu başına
      (`editor/scene/keptTerrainTiles.ts`); level dosyasına yazılmaz,
      yeniden açılışta bölge tekrar yüklenir. Hücre sayımı sahne değişiklik
      sayacı + partition ayarına göre önbellekli. Bölge yalnız arazi
      tile'larına uygulanır: editör actor hücrelerinin hepsini zaten tutuyor.
      Doğrulama: engine `editor terrain streaming` (dikdörtgen anahtarları,
      tutulan küme) + `kept terrain tiles`; smoke ikinci senaryo (sürükle →
      Load → uzak köşe kamera uzaktayken yüklü ve "kept", yeniden açılışta
      geri gelir, Unload → boşalır ve depo temizlenir).
- [x] Outliner: yalnız yüklü actor'ler + "yüklü olmayan hücrede" filtresi;
      bir actor'e gitmek hücresini yükler.
      *Tamam (2026-10-27, kullanıcı kararı):* editör bütün actor'leri yüklü
      tuttuğu için "yüklü" = pawn editör kamerasında dursa Play'in yükleyeceği:
      persistent öğeler + kameraya `main` yükleme menzili içindeki hücreler
      (runtime kuralı, histerezissiz). Partition açıkken her satırda hücre
      rozeti (`3_-1`, persistent `P`), menzil dışındakiler soluk; filtre
      menüsünde **World Partition** bölümü: All / Loaded around the camera /
      In unloaded cells / Persistent only. Kamera 500 ms'de bir yoklanır,
      yüklü hücre kümesi değişince Outliner yeniden çizilir. Bağlam menüsünde
      **Go To**: seçip kamerayı actor'e götürür, arazi tile'ları oraya akar.
      Saf çekirdek `editor/core/worldPartitionOutliner.ts` (save yönlendirmesiyle
      id → hücre; tekrarlanan asset grubunda editör gibi ilk grup).
      Doğrulama: engine `world partition outliner` (4); smoke
      `world-partition-panel.spec.ts` üçüncü senaryo (rozetler, dört filtre,
      Go To sonrası filtrenin tersine dönmesi, uzak tile'ın yüklenmesi).
- [ ] Landscape splines ve River Water dünya uzayına taşınır (`landscapeRef`
      yerine terrain'e bağlı dünya spline'ı); deform/paint birden çok tile'a
      uygulanır.
      **İlk motor dilimi tamam (2026-10-25):** W0 ortak tasarım → bu aktarım →
      Lake/Puddle/Ocean sırası onaylandı. 8A1'de `terrainSplines.ts` dünya
      spline dönüşümü ve `terrainEdit` çok tile deform/boya patch çekirdeği
      eklendi. 11 yeni regresyon ve tam `build:verify` (1.916 engine kontrolü)
      geçti. **8A2 veri geçişi tamam (2026-10-25):** yeni save snapshot'larında
      spline başına `coordinateSpace: "world"`; işaretsiz eski veri okunur,
      1×1 köprü dünya verisini mevcut yerel editör/runtime'a uyarlar. Ortak
      runtime/save allowlist, açık kopya migrasyonu ve repeat-save korunumu;
      8 yeni regresyon, tam `build:verify` (1.925 engine kontrolü) ve nehirli
      migrasyon/Save/Reload/Play Chromium smoke'u (2/2) geçti. Çok-tile editör
      bağlantısı (8A3), yol çıktısı (8A4), nehir aktarımı (8A5) ve bunların
      görsel/performans kabulü 8A2 sonunda açıktı.
      **8A3 devir (2026-10-26):** Çok-tile spline editör kodu eklendi; son
      tarayıcı kabulü tamamlanmadı. Kullanıcı isteğiyle commit/push noktasında
      sonlandırıldı; detay ve devam adımları alt plan §11.7'dedir. Koordinat, kimlik,
      eksik tile ve undo sözleşmesi ile 8A0–8A5
      iş sırası [Water Body alt planı §11](WORLD_TERRAIN_WATER_BODY_PLAN.md#11-uygulama-başlangıcı--2026-10-25)
      içinde kayıtlıdır. Bu ana madde uçtan uca aktarım kabulüne kadar açık kalır.
      **8A3 + 8A4 tamam (2026-10-26):** Çok-tile Draw/Edit/gizmo/snap,
      deform/boya undo/redo ve Save/Reload; dünya spline yol mesh'i, kesin
      terrain normal hizalaması ve çizim geometrisinden runtime çarpışması.
      Yoğun düzenlemelerde manuel Save'i bekleten autosave kuyruğu, çalışan
      snapshot + tek bekleyen son snapshot olarak birleştirildi. Yedi yeni
      motor regresyonu ve tam `build:verify` (1.946 kontrol), son çok-tile
      Chromium kabulü (4/4) geçti; görüntüler incelendi. Nehir aktarımı (8A5),
      yol geometri/collider streaming'i ve büyük dünya performans kabulü açık.
      Ayrıntılar ve kanıtlar alt plan §11.8'de.
      **8A5 tamam (2026-10-26):** Dünya koordinatlı nehir yüzeyi ve köpük,
      kesin terrain üçgen yüksekliğinden derinlik, mevcut spline yatağı
      deform/boya ve sculpt/undo sonrası yenileme; koridorla sınırlı geçici
      tile okumaları, eksik dosyada gövde reddi ve gerçek deliklerde kırpma.
      Tam `build:verify` (1.951 kontrol), iki yeni nehir Chromium senaryosu
      ve üç eski bake/migrasyon/endpoint regresyonu geçti; görüntüler incelendi.
      Nehir aktarımı kapatıldı; su/yol geometri streaming'i ve büyük dünya
      performans kabulü açık. Sonraki su dilimi W0-Lake tasarımıdır; ayrıntı
      ve kanıtlar Water Body alt planı §11.9'da.
      **Yol streaming ölçümü + ilk iki dilim (2026-10-28, su dışı):**
      4×4 km test dünyasında 8 × 4 km çarpışmalı `sm-road-asphalt` (genel
      spline actor'ı, `segments`) yolsuza göre: açılış +0,6 s, JS heap
      +110–125 MB (GC sonrası), kare başına render CPU +~2 ms; 1296 segment
      mesh'i, 155 bin üçgen, 4,9 MB GPU geometrisi. Örneklemeli heap profili
      kalıcı belleğin ~70 MB'ını fiziğin statik kayıtlarında (yüzey/engel
      üçgen kayıtları, uzamsal indeks, primitive kopyaları) gösterdi.
      *2a:* bir build'in segment parçaları materyal kopyasını paylaşır (grup
      sahiplenir, `disposeSplineSharedMaterials`; 1296 → 8) ve eğri önbelleği
      actor başına bir kez kurulur (açılış 2,1–2,3 s → 1,2–1,3 s).
      *2b:* World Partition açık level'da `segments` + çarpışmalı deformMesh
      üreteçlerinin çarpışması hücre başına trimesh olur
      (`engine/scene/splineCollisionCells.ts`: segment orta noktasının
      hücresi); hücre statikleriyle aynı kuyrukta eklenir/kaldırılır. `whole`
      mod ve partition'sız level eskisi gibi tek gövde. Kabul:
      `open-world.spec.ts` ikinci testi (açılışta yol hücresi yok, 2,5 m
      yükseltilmiş yolda pawn güvertede; ekleme kapatılınca düşüyor).
      *2b-B:* World Terrain yol spline'larının (`def.splines`, World Builder'ın
      yol ağı da bu yoldan üretilecek) landscape başına tek trimesh'i,
      partition açıkken üçgen ağırlık merkezinin hücresine göre parçalanır
      (`trimeshCellParts`) ve aynı hücre kuyruğuna girer; landscape'ler
      partition yapılandırmasından sonra kurulduğu için hücreler
      `addOccupiedCells` ile eklenir, boot `prepare`'i bunları da hazırlar.
      Kabul testi iki türü de koşar. Not: bu yolların nav'a giden `walkable`
      yüzeyi de artık yalnız yüklü hücrelerde (tile'lı nav Faz 9).
      Açık: render tarafı (genel spline segment mesh'lerinin hücre başına
      birleşmesi; World Terrain zincirleri zaten zincir başına tek mesh) ve su.
      **W1 Lake işlevleri tamam (2026-10-26):** Kullanıcı onaylı W0-Lake
      tasarımının ardından seed + sınırlı çalışma alanıyla mevcut çukuru
      doldurma; terrain üçgeninden gerçek kıyı/derinlik, adalar/bağlılık,
      minimax kaçış eşiği ve eksik tile tanıları; seçim/düzenleme,
      sculpt/undo/redo, Save/Reload/Play. 11 Lake engine regresyonu, tam
      `build:verify` (1.962 kontrol), üç Lake Chromium kabulü geçti.
      Donanım GPU pilotu SwiftShader timer sağlamadığı için atlandı; browser
      tepe bellek/ana thread ve büyük dünya/geometri streaming kabulü açık.
      Mevcut sahne/tile verileri değişmedi; yatak oyma W2'de kaldı.
      Ayrıntı ve CPU pilotu Water Body alt planı §13'te.
      **W2 onaylandı (2026-10-26):** Kapalı spline ile yalnız oyma, yazmadan
      önizleme, açık bake, isteğe bağlı kıyı boyası ve tek undo/redo; kalıcı
      tarif runtime'da otomatik uygulanmaz. Tasarım, bütçe ve bağımsız kabul
      alanı Water Body alt planı §14'te. W1 donanım GPU/browser bellek/ana
      thread ve büyük dünya performans kabulü bu onayla kapanmaz.
- [x] 1×1 `ForgeLandscapeData` köprüsü kaldırılır: bu madde ve Faz 6'nın
      prosedürel çim maddesi bittikten sonra 1×1 de çok-tile ile aynı yoldan
      (`terrainEdit.ts`, `worldTerrainActor.ts`) düzenlenir;
      `terrainLandscapeBridge.ts` ve `engine/scene/landscape.ts`'in köprüye ait
      kısmı (veri tipi, fırça, spline adaptörü, foliage kuralları) silinir. Expand
      ve tek-tile/çok-tile ayrımı (Details, spline uyarıları) bununla kalkar.
      **Kararlar (kullanıcı onaylı, 2026-10-27; 1 ve 4 2026-10-28'de
      değişti):** (1) Eski `.landscape.json` hiç okunmaz: ona referans veren
      level editörde ve runtime'da "desteklenmiyor" açık hatasıyla yüklenmez,
      `verify:world-data` da raporlar. Dönüştürme yolu yok (`terrain:migrate`
      yazılmadı); kullanıcı eski dosyaları önemsemiyor, geriye uyumluluk
      istenmiyor. Döndürülmüş bir Landscape actor'ü de açık hatadır. (2) Her World
      Terrain (1×1 ve çok-tile) gizmo ile **taşınabilir**: taşıma tanımın `origin`'ini
      değiştirir (undo'lu); döndürme/ölçek kapalı kalır. (3) Yalnız 1×1'de olan
      Resample preset'leri ve "Import PNG (resample)" tek tile'lı World Terrain'e
      taşınır, çok-tile'da kapalı kalır. (4) Geçiş süresi ve migrate komutu
      yok: okuyucu köprüyle aynı dilimde (K5) kalktı. Tek aktif fork (minigolf)
      arazi kullanmıyor, ThreeAges kapandı.
      **Dilimler:** K1 World Terrain taşıma → K2 1×1 World Terrain'de resample ve
      PNG resample → K3 1×1 World Terrain'de eksik kalan 1×1 özelliklerinin
      tamamlanması (spline/nehir/foliage kuralları/overlay/Expand) → K4 okuma yolu:
      1×1 `.terrain.json` ve kayıpsız eski dosya `{ kind: "world" }`, kayıplı eski
      dosya açık hata; smoke fikstürleri yeni biçime → K5 köprü, 1×1 dalları ve
      eski okuyucunun silinmesi (K6 bununla birleşti, migrate yok). Eşzamanlı oturum `SceneApp`/`EditorUi` üzerinde
      çalıştığı için dilimler ayrı worktree dalında yapılır, her yeşil dilim
      `main`'e birleştirilir.
      *K1 (2026-10-27):* `engine/terrain/worldTerrainMove.ts`; taşıma commit'te
      (gizmo bırakma, Details, undo/redo) tanımın `origin`'ini ve dünya
      çerçeveli spline'ları, nehir yüzeyi/köpüğünü, gölleri aynı farkla kaydırır,
      tile'lara dokunmaz; sürüklerken yalnız görsel actor'ü izler. Taşıma diğer
      transform'lar gibi Save ile yazılır. Editör akışı çerçeveyi yeniden okur
      (`TerrainEditorStreaming.syncFrame`). Smoke `terrain-multitile` taşıma
      senaryosu. *K2:* `engine/terrain/terrainResample.ts`; Resolution / World
      Size tek undo adımlı belge değişimi, PNG resample ortak heightmap yama
      hattı. *K3:* `expandSingleTileWorldTerrain`; orijinal tile dünyada yerinde
      ve birebir (yükseklik biçimi dahil), dünya koordinatlı spline/nehir/göl
      artık Expand'i engellemez; diyalog kaynağı `WorldTerrainExpansionSource`.
      *K4:* `fetchTerrainActorDocument` her zaman `{ kind: "world" }` döner; eski
      dosya actor'le kayıpsız dönüşür (`legacySource`), editör onu level'a ait
      yola (`levelTerrainPath`) kaydeder, eski dosya kalır; kayıplı eski dosya
      `terrain:migrate`'i gösteren açık hata. Yeni 1×1 Landscape de World Terrain
      (Float32 tile). Davranış farkı: paylaşılan bir 1×1 `.terrain.json` artık
      çok-tile gibi yerinde kaydedilir (köprü onu ilk Save'de level'a
      kopyalıyordu). K3+K4 main'de (`755600d0`); aynı seride CI'ın 25 Ekim'den
      beri kırmızı olan production smoke'u da düzeldi: `ActionMap` iki tick
      arasında basılıp bırakılan tuşu kaçırıyordu (yavaş SwiftShader karesinde
      Escape menüsü), artık bir tick basılı sayılıyor (`2958356e`).
      *K5 (2026-10-28):* `terrainLandscapeBridge.ts`, `terrainLegacy.ts`,
      `landscapeFoliage.ts`, `tools/world/migrate-landscape.mjs`,
      `validateLandscapeData` ve `public/landscapes/*.landscape.json` silindi;
      `engine/scene/landscape.ts`'ten `ForgeLandscapeData`, 1×1 ızgara/fırça/spline
      uygulama/heightfield yardımcıları, render'dan `createLandscapeObject` ve
      1×1 render kaynağı, yüzey örnekleyiciden ve nehir/spline-mesh yolundan
      `landscapeData` dalları çıktı. `TerrainActorDocument` yalnız `{ kind:
      "world" }`; `.landscape.json` yolu açık "not supported" hatası.
      `SceneApp`/`RuntimeSceneApp` yalnız World Terrain taşır; kayıt
      koordinatörü her araziyi World Terrain oturumuyla, level'dan önce yazar.
      Release starter ve smoke fikstürleri `.terrain.json` + tile binary
      üretir; `terrain-migration.spec` yalnız endpoint doğrulamasıyla
      `terrain-endpoints.spec` oldu. 62 eski motor kontrolü silindi, World
      Terrain'i test edip 1×1 fikstür kullananlar tek-tile fikstüre çevrildi.
- [x] Eski `.landscape.json` okuyucusu emekliye ayrılır. *2026-10-28, K5 ile:*
      kullanıcı kararıyla migrasyon komutu ve geçiş süresi olmadan kaldırıldı
      (yukarıdaki madde, karar 1/4). `runtime-parity.landscape.json` parity
      referansı değildi: RuntimeParity level'ı zaten `runtime-parity.terrain.json`
      kullanıyordu.
- [x] **Editör tile akışı (2026-10-23, ilk dilim):** 6×6'dan büyük
      (`editorStreamsTerrain`, >36 tile) ve geçerli global haritası olan
      World Terrain editörde yalnız tanım + global harita ile açılır;
      `TerrainEditorStreaming` editör kamerası çevresinde 3 tile yarıçapında
      tile'ları edit world'e yükler (6 eşzamanlı okuma, 1,25 histerezis,
      menzilden çıkan okuma iptal). Bu oturumda düzenlenen tile sabitlenir
      (kaydedilmemiş veri + undo geçmişi); disk okuması bellekteki tile'ın
      üzerine asla yazmaz. Brush'ın izi + yumuşatma payı yüklü değilse o dab
      atlanır, tile'lar istenir ve vuruş bitene kadar tutulur. Save:
      `captureWorldTerrainSave` kısmi dünyada renderer'ın her dab'de
      güncellediği canlı global haritayı yazar; aralık genişlerse yüklü
      olmayan (düzenlenmemiş) tile'lar diskten okunup yeni aralıkla yeniden
      kodlanır (`reencodeTerrainTileRange`, u16/f32 korunur). RAW import/export
      ve silme önce bütün tile'ları yükler (silme: undo budanmış dosyaları
      geri yazabilsin diye). Küçük dünyalar ve global haritası olmayan eski
      dosyalar eager kalır. Smoke `terrain-editor-streaming.spec.ts`: 12×12
      dünyada seam kamerası 42/144 tile okur, seam vuruşu yalnız iki tile +
      global haritayı yazar; kaydedilen global harita diskteki tüm
      tile'lardan yeniden kurulana u16 nicelemesi dışında (9/37249 örnek,
      ≤ yarım adım) eşittir; uzak kamera kendi bölgesini okur.
      Açık: ~~kamera menzili dışındaki tile'a tıklama isabet etmez~~ (tamam,
      `1b9faa0c`: yüklü olmayan tile global harita üzerinde aynı köşegenle
      yürünür, isabet "yaklaşık" işaretli), brush'ın tile
      yüklediği yol tarayıcıda denenmedi (engine testli), panel/minimap yok,
      Show > Collision tel kafesi yalnız açıldığı andaki yüklü tile'ları
      çizer.
- [x] Brush'lar tile sınırında kesintisiz; brush birden çok yüklü olmayan
      tile'a uzanıyorsa onları yükler.
      *Tamam (editör tile akışı ilk dilimi, yukarıda):* dikiş kenarları iki
      tile'a yazılır; iz + yumuşatma payı yüklü değilse dab atlanır, tile'lar
      istenir ve vuruş bitene kadar tutulur. Tarayıcıda denenmedi (engine testli).
- [x] Kirli tile/hücre göstergesi, Save yalnız kirlileri yazar.
      *Tamam (2026-10-27):* Save yalnız kirlileri yazıyordu; Details'teki
      `[data-world-terrain-residency]` sayacı vardı; World Partition paneli
      kaydedilmemiş tile'ları haritada turuncu çerçeveyle gösterir. Hücre
      dosyaları Save'de kendi değişiklik karşılaştırmasıyla yazılır (gösterge yok).
- [x] Editör smoke'u: yeni dünya oluştur → iki tile arasında sculpt → kaydet
      → yeniden aç → aynı yükseklik.
      *Tamam (2026-10-27):* `terrain-create.spec.ts` üçüncü senaryo. Diyalogla
      2×2 dünya, x = 0 dikişinde Raise; autosave yalnız `0_1` + `1_1`'i yazar,
      diskte dikiş sütunu iki tarafta birebir eşit. Yükseklik editörün kendi
      sorgusundan (terrain mesh'inin CPU yükseklik alanı raycast'i) dört
      noktada okunur; yeniden açılan editör aynı noktalarda u16 yarım adımı
      (512 m aralıkta 3,9 mm) içinde aynı yüksekliği görür (ölçülen 2,2–3,9 mm;
      dokunulmamış tile da oluşturulurken u16 yazıldığı için aynı payla kayar).

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
- [ ] Detay normal haritası: daha kaba tile aralığında (ör. 2 m) yakın
      yüzey ayrıntısını korumak için (açık soru 2'nin rafa kalan kısmı).

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

Hepsi kapandı (2026-10-27, kullanıcı onayladı). Soru metni tarihçe için
duruyor; her birinin altında karar ve dayanağı var.

1. **Hücreden çıkan dinamik durum:** oyuncu arabayı bırakıp 1 km uzaklaşırsa
   araç ne olur? Öneri: taşınmış dinamik actor'lerin durumu bellek içi hücre
   önbelleğinde ve save-game'de tutulur; araçlar her zaman "persistent
   runtime" kümesine terfi eder. Faz 5 başında karar.
   **Karar (Faz 5'te uygulandı):** terfi yok, hücre önbelleği var.
   `StreamedActorStateCache` (`engine/world/streamedActorState.ts`) hücre
   boşalırken yetkili pozdan ayrılmış simüle cisim/aracın son pozunu saklar,
   hücre dönünce o pozda kurar. Araçlar save-game'in `vehicles` listesine park
   halinde girer, sürülen araç hücresinden önce canlandırılır; diğer dinamik
   cisimler yalnız bellekte tutulur (bkz. Faz 5 Save-game maddesi).
2. **Tile çözünürlüğü:** varsayılan 1 m mi, yoksa 4 km dünyada 2 m + detay
   normal map mi? Faz 0 S1 bütçesine göre.
   **Karar:** varsayılan 1 m kalır (`TERRAIN_DEFAULT_TILE_QUADS = 256` × 1 m).
   S1 4 km'de arazi GPU bütçesini (< 3 ms) yaklaşık 3 kat payla geçti; aralık
   zaten dünya başına seçilir (Open World diyaloğu). Detay normal haritası
   Faz 10'a isteğe bağlı genişletme olarak alındı; ilk laptop/mobil ölçümü
   gerekirse onu ya da daha kaba aralığı düşük profile önerir.
3. **Katman sayısı:** 8 yeterli mi, yoksa katman başına ayrı ağırlık dokusu
   (Unreal gibi sınırsız) mı?
   **Karar:** 8 kalır (`TERRAIN_MAX_LAYERS`, iki RGBA8 ağırlık bloğu). Katman
   dokuları tek `sampler2DArray`'e geçtiği için (7c2) doku birimi artık katman
   sayısıyla büyümüyor; 8'in üstü tile ikili formatını ve global haritayı
   değiştirir, buna şu an ihtiyaç yok.
4. **Editör büyük dünyayı ne kadar yükler?** Varsayılan menzil ve "tüm dünyayı
   yükle" seçeneğinin bellek sınırı.
   **Karar:** bugünkü davranış kalıcıdır. En çok 36 tile'lık (6×6) arazi
   tümüyle bellekte; daha büyüğü editör kamerası çevresinde 3 tile yarıçapında
   akar (`EDITOR_TERRAIN_STREAMING_MAX_EAGER_TILES`, `TerrainEditorStreaming`).
   Ayrı bir "tüm dünyayı yükle" komutu yok: World Partition panelinde bütün
   haritayı seçip **Load Region** aynı işi görür. Bellek sınırı konmaz; panel
   tutulan tile'ların tahmini editör belleğini gösterir.
5. **HLOD üretimi** dev sunucusunda mı (Save sonrası arka plan), yoksa yalnız
   `world:build` ile mi?
   **Karar (7f):** yalnız `npm run world:build`.
