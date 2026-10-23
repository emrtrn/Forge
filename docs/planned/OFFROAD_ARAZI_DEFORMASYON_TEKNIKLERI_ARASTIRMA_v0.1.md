# Offroad — Arazi Detay ve Deformasyon Teknikleri: Araştırma Raporu

**Tarih:** 2026-10-23 · **Sürüm:** v0.1 · **Durum:** Araştırma. Kararlar **öneridir**, uygulanmış ya da onaylanmış değildir.
**Kapsam:** Forge'da (WebGL2 / three r184 / Rapier 0.19.3) 4096 × 4096 m World Terrain üzerinde,
sub-metre ölçekte görünür **ve** sürüşe etki eden zemin deformasyonu için teknik seçenekler.
**Girdiler:** [OPEN_WORLD_PLAN.md](OPEN_WORLD_PLAN.md), [TERRAIN_DEFORMATION_PLAN.md](TERRAIN_DEFORMATION_PLAN.md),
`FORGE_OFFROAD_ARAZI_DETAY_KATMANLARI_PROBLEM_VE_COZUMLER_v0.1.md` (Detail Patch önerisi),
`Downloads\Offroad\` GDD/Vizyon/Aşama 1–2 belgeleri, repo kodu, web taraması, tek bir yerel ölçüm.

**Kanıt etiketleri:** `[KOD]` repoda okundu · `[ÖLÇÜM]` bu oturumda ölçüldü · `[KAYNAK]` web kaynağından ·
`[HESAP]` aritmetik, ölçülmedi · `[HAFIZA]` bilgiden, bu oturumda doğrulanmadı · `[ÖNERİ]` yorum.

---

## 1. Özet

1. **Ayrı "Detail Patch" yüzeyi (Landscape'ten türetilmiş) önerilmemeli.** OPEN_WORLD İlke #2 ("tek arazi yolu")
   ve K1 ile çelişiyor; ayrıca Detail Patch belgesinin korktuğu iki sorunu (çift collider, dikiş/z-fighting)
   kendisi yaratıyor. Aynı ihtiyaç, **CDLOD'un içinde yerel ince alt-seviyeler + katmanlı yer değiştirme (Δ) dokuları**
   ile karşılanabilir. Yeni yüzey, yeni collider, yeni dikiş yok. [ÖNERİ]
2. **Önerilen model: "Katmanlı yer değiştirme".** Taban (2 m, otoriter, collider'ı olan) + isteğe bağlı *authored Δ*
   (seyrek, level'a kayıtlı, statik detay) + *runtime Δ* (iz alanı, save-game'e kayıtlı). Hepsi aynı
   `terrainHeightAt + Δ` sorgusundan geçer. [ÖNERİ]
3. **Mevcut TERRAIN_DEFORMATION planının çekirdeği doğru.** CPU-otoriter, 12,5 cm hücreli, toroidal alan;
   Spintires/MudRunner'ın yayımlanmış tasarımıyla aynı ailede (CPU primitifleri çizer → GPU okur; 16 m blok başına
   128² mud dokusu = 12,5 cm). [KAYNAK][KOD] Değiştirmeyi önerdiğim yerler §6'da.
4. **Plan Faz 3'teki "yerel yoğun patch mesh + `discard`" yerine CDLOD alt-seviyeleri.** Hesaba göre ~65–100 bin
   üçgen (plandaki 256² patch: ~131 bin) ve `discard` / dikiş yok. [HESAP]
5. **Kod bulgusu — yük etkisi doygunlaşıyor.** `targetDepthForWheel` yük oranını `min(load/nominal, 1)` ile
   kırpıyor (`engine/scene/deformationField.ts:54`). Nominalden ağır yük daha derin batmıyor. Oysa D-009 sütun 3
   ("yük sürüş fiziğini etkiler") ve H-001/H-003 tam bunu bekliyor. Düzeltilmeli. [KOD]
6. **Ölçüm — collider değiştirmek ucuz.** Rapier'de heightfield `setShape` (FIX_INTERNAL_EDGES bayraklı):
   32 m × 32 m @ 0,25 m için **0,05 ms**, 64 m @ 0,25 m için **0,20 ms**; sil+yeniden-yarat aynı mertebe. [ÖLÇÜM]
   TERRAIN_DEFORMATION planı "collider yeniden kurmak pahalı" gerekçesiyle reddetmişti; **maliyet engel değil**.
   Asıl engel katmanlama problemi (§5.2). Dinamik cisimli sahnede kararlılık ölçülmedi.
7. **Pencere dışında kalıcı detay kaybı** mevcut planın (1 m kaba katman) en zayıf yanı. Lojistik oyunda oyuncu
   *aynı yolu tekrar tekrar sürer*; yol üstü izlerinin birikmesi oyun değeri taşır. **Seyrek 16 m blok deposu**
   (MudRunner modeli) toroidal pencerenin altına eklenebilir (§5.4). Save boyutu açık karar.
8. **Bekker–Wong terramechanics** (basınç–batma kapalı formu) mevcut `maxDepth × yük oranı` presetinin yerine
   geçirilebilir; lastik genişliği, lastik basıncı (GDD'de ileri mekanik) ve yükü tek formülde birleştirir. §4.C.

**Önerilen yol:** M2 için en küçük şey = plan Faz 2 (iz alanı + shader) + Faz 3'ün *yalnız fizik* kısmı (virtual
offset `rest − d`), düzeltilmiş yük modeliyle. İnce mesh, kalıcılık ve Δ-authored katmanı sonra, her biri
kendi spike kapısıyla (§8).

---

## 2. Forge'un bugünkü gerçek durumu

| Konu | Durum | Kanıt |
|---|---|---|
| Taban arazi | Tile grid, GPU CDLOD, 16×16 tile test dünyası, streaming (Faz 4), heightfield collider | OPEN_WORLD_PLAN |
| Taban çözünürlüğü | Tile verisi = en ince render seviyesi (2 m önerisi). CDLOD **veriden ince seviye üretmiyor** | `terrainLod.ts`, shader `forgeTerrainHeight` |
| Shader'da yükseklik | Slot dokusundan `texelFetch` + **bilinear** karışım | `terrainMaterial.ts:130–157` |
| Fizik/sorgu yüzeyi | `terrainHeightAt` **üçgen-birebir** (K3a); bilinear ile hücre başına `burulma/4` fark | OPEN_WORLD K3a |
| İz alanı çekirdeği | `DeformationField` saf, toroidal, 512² @ 12,5 cm, Uint16 derinlik + Uint8 bozulma; **henüz hiçbir yere bağlı değil** (yalnız testler) | `deformationField.ts`; kullanım araması: yalnız test + codec |
| Yüzey profili | `snow/mud/sand` presetleri, `SurfaceSample`, `VehicleSurfaceProvider` (Faz 1a) bağlı; **terrain katmanı → physical material (Faz 1b) yok** | TERRAIN_DEFORMATION Faz 1a/1b |
| Araç teması | Rapier `DynamicRayCastVehicleController`; **tekerlek başına tek ışın** (genişlik/temas yamağı yok) | `physicsSubsystem.ts:1296–1311` |
| Tekerlek başına çarpan | `frictionSlip`, `sideFriction`, ek fren (yuvarlanma direnci) her adımda set ediliyor | `physicsSubsystem.ts:1351–1360` |
| Gömülme | **Yok.** Faz 0 spike'ı `rest − d` işaretini ve ≤ 0,3 m/s slew sınırını doğruladı | TERRAIN_DEFORMATION Faz 0 |
| Shader'da iz | **Yok** (Faz 2 shader maddeleri açık) | plan |

Detail Patch belgesinin varsayımlarından iki düzeltme: (a) "Landscape çoklanabilir mi" sorusu eskimiş —
OPEN_WORLD K1 Landscape'i 1×1 tile'a indirgiyor ve tek yola bağlıyor; (b) "çok-tile collision/streaming doğrulanmadı"
artık doğrulanmış (heightfield collider, dikiş testi, streaming, test dünyası).

---

## 3. Dış dünya ne yapıyor

### 3.1 Spintires / MudRunner `[KAYNAK]`
Spintires baş geliştiricisinin 2017 yazısı ve modlama sitesindeki katman dökümü:
- Seviye ≤ 1 km × 1 km, **16 m × 16 m bloklar**; yalnız kameradaki bloklar çizilir, aracın yanındakiler "aktif".
- Blok başına iki doku: **Doku 1 25×25** (düşük çözünürlüklü taban + "mud" işaret kanalları), **Doku 2 128×128**
  (yalnız çamur içeren bloklarda ayrılır; R = tabana göre çamur yüksekliği, GB = çamuru tekerlekten kaydıran
  ofset, A = çamur karışımı) → ≈ **12,5 cm** çamur çözünürlüğü.
- Vertex shader düz bir 2B grid'i dokudan yüksekliklerle kaldırır. Taban arazi çamurdan *daha kaba*; ince geometri
  yalnızca çamurda.
- **CPU fizik + deformasyonu yürütür, "yaklaşık primitifleri" (tekerlek/şasi konumu, boyutu, hızı, batma derinliği)
  Doku 2'nin render target'ına çizer; GPU okur.** Yazar bunu açıkça "fiziğe gevşek bağlı, ampirik" diye niteliyor.
- Tekerlek izi: tekerlek yolunu izleyen yamuk meshler, iki geçişte (yükseklik + parallax). Çamur parçacıkları
  yalnız dekor, fiziği etkilemez. Çamur parçaları Havok rigid body.
- Su: iki doku ping-pong, CPU primitif çizer, GPU shader yayar.

**Çıkarım:** (i) Forge planının "CPU-otoriter alan + GPU gösterim" kararı sektör örneğiyle uyumlu.
(ii) Çamur çözünürlüğü olarak 12,5 cm tutturulmuş, doğrulanmış bir sayı. (iii) Çamur ince, taban kaba ve
ince detay **yalnız gereken bloklarda ayrılıyor** — kullanıcının "boyayla yerel detay" sezgisinin üretimde
karşılığı budur. (iv) "Fizik–görsel kopukluk" Spintires'ta da bilinçli bir kabul; bizim M2 kabul kapımız
("oyuncuyu yanıltmayacak tutarlılık") bundan daha katı.
*Güvenilirlik:* ikinci el yorum/yazı; Saber'ın güncel motoru farklı olabilir. SnowRunner/Expeditions için
yayımlanmış teknik belge bulamadım.

### 3.2 Kar/çamur izi — AAA başlıkları `[KAYNAK, yalnız özet düzeyinde]`
- **Batman: Arkham Origins** — GDC 2014 "Deformable Snow Rendering": DX11 tessellation + displacement.
- **Rise of the Tomb Raider** — "Deferred deformation" (GPU Pro 7 bölümü): deformasyon mantığını gösterdiği
  geometriden ayırır; bölüm özeti ~4 MB bellek ve onlarca NPC ölçeklenmesi diyor.
- **Horizon Zero Dawn: Frozen Wilds** — kalıcı kar izleri, çim dokusu karın altından görünür; yöntem ayrıntısı bulunamadı.
- Ortak desen: *kamera çevresinde sınırlı bir etkileşim dokusu + displacement/normal.* Tessellation WebGL2'de yok;
  bizim karşılığımız CDLOD alt-seviyeleri (§5.1).
Bu üç kaynağın içeriğini okumadım, yalnız arama özetlerini gördüm.

### 3.3 Akademik: yükseklik alanı + malzeme akışı
- Gilardi, Watten, Newbury, **"Drift-Diffusion Based Real-Time Dynamic Terrain Deformation"** (EG 2016 short):
  dinamik yer değiştirmeli height-map; değiştirilmiş drift-diffusion denkleminin Euler çözümü; toprak bileşimine
  göre farklı iz tipleri. PDF'e erişemedim (403); özet düzeyinde. [KAYNAK]
- **Su vd., SIGGRAPH Asia 2023, "Real-time Height-field Simulation of Sand and Water Mixtures"**: GPU, operator
  splitting; elastoplastik kum. Bizim bütçe için ağır; yön göstermek için. [KAYNAK]
- Štava vd. 2008 (GPU avalanching/erozyon), Nilles vd. 2024 (CUDA kum çığı). [KAYNAK, yalnız başlık]
- Klasik heightfield toprak/kar/kum kayması: Li & Moshell 1993; Sumner–O'Brien–Hodgins 1999 ("Animating Sand,
  Mud, and Snow"); Onoue–Nishita 2003. [HAFIZA, doğrulanmadı]
- **Project Chrono SCM** (Soil Contact Model): Bekker–Mohr–Coulomb tabanlı, yükseklik grid'li deforme olabilir
  zemin; gerçek zamanlıya yakın çalışabildiği belirtiliyor. Terramechanics modelleri küçük batma, düşük kayma ve
  silindirik tekerlek için geçerli; kramponlu/derin batmada zayıflar. [KAYNAK: arXiv 2410.04371, 2405.11001]

### 3.4 Motor tarafı
- Unreal: `ULandscapeHeightfieldCollisionComponent::UpdateHeightfieldRegion` — fizik heightfield'ının bir
  alt-bölgesini yeniden yazar (fiziksel materyali güncellemez). PhysX/O3DE aynı desen. Yani sektör
  "alt-bölgeyi güncelle, collider'ı sökme" yolunu kullanıyor. [KAYNAK]
- Rapier JS'te alt-bölge güncelleme API'si **yok**; `Collider.setShape(new Heightfield(...))` ve sil-yarat var. [KOD]

---

## 4. Teknik katalog

Boyutlar: **A** detay temsili/render · **B** fizik teması · **C** malzeme davranışı · **D** kalıcılık.

### A. Detay temsili ve render

| # | Teknik | Nasıl | Artı | Eksi | Forge uyumu |
|---|---|---|---|---|---|
| A1 | **Yalnız normal/albedo** (relief yok) | İz alanı → fragment'ta normal + tint + ıslaklık | En ucuz; mesh değişmez | Silüette iz yok; derin çamur inandırıcı değil | Plan Faz 2. **Tamam, ilk adım.** |
| A2 | **Parallax / POM** | Fragment'ta yükseklik izleme | Mesh'siz derinlik hissi | WebGL2'de pahalı, eğik açıda bozulur, silüet yok | Orta mesafe için isteğe bağlı |
| A3 | **Ayrı yerel patch mesh + `discard`** | Araç çevresinde yoğun grid; tabanda `discard` | Anlaşılır | Çift yüzey, dikiş, `discard` + gölge/derinlik pass'lerinde tutarlılık, ayrı yaşam döngüsü | Plan Faz 3. **Önermiyorum** (A5 daha iyi) |
| A4 | **Tessellation** | GPU alt bölme | AAA yolu | WebGL2'de yok | Uygulanamaz |
| A5 | **CDLOD alt-seviyeleri (veriden ince)** | Quadtree'ye, deformasyon penceresinde 2–3 ek seviye; yükseklik = `taban_üçgen_birebir + Δ(x,z)` | Tek mesh/tek draw, mevcut morph ile çatlaksız, `discard` yok, gölge/derinlik materyalleri aynı | `terrainLod.ts` + shader + renderer'a dokunur; ince seviyede taban üçgen-birebir olmalı | **Önerilen** |
| A6 | **Sparse authored Δ (statik ayrıntı)** | 16/32 m bloklarda 0,25–0,5 m Δ yükseklik dokusu, yalnız boyanan bloklarda ayrılır | Kullanıcının "boyayla yerel detay" isteği, topoloji değişmez | Yeni kayıt yüzeyi (6. allowlist), editör aracı | **Önerilen, sonra** (§5.3) |
| A7 | **Gerçek adaptif topoloji** (boyayla vertex sıklaştırma) | T-junction/stitch, Rapier heightfield düzenli grid varsayımı | Esnek | En yüksek risk; fiziği çözmez | Önermiyorum |
| A8 | **Detay bağımsız GPU deformasyonu** (RTT ping-pong) | GPU'da yayılma/çökme | Berm, akış ucuz | Fizik okuyamaz (readback) | Yalnız *görsel* ikincil katman olarak |

### B. Fizik teması

| # | Teknik | Nasıl | Artı | Eksi |
|---|---|---|---|---|
| B1 | **Virtual offset** (`rest − d`) | Collider sabit; tekerlek ışınından alan derinliği çıkarılır | Collider yok; Faz 0'da doğrulandı | Gövde tabana değer (belly); chassis collider ≠ görsel |
| B2 | **Temas yamağı örnekleme** | Tekerlek tabanı boyunca 3×5 örnek: ortalama derinlik + yanal eğim | Genişliği/uzunluğu modeller; **iz tutma (rut steer) kuvveti** ucuz | Tek ışına ek iş (~15 örnek/tekerlek) |
| B3 | **Yerel deforme collider** (setShape) | Pencerede heightfield'ı alandan yeniden kur | Gövde de doğru yüzeyi görür | Katmanlama problemi (§5.2); dinamik kararlılık ölçülmedi |
| B4 | **Kendi tekerlek modeli** (Rapier controller yerine) | Çok noktalı temas | En yüksek doğruluk | Vehicle Faz 0–5 çalışan sistemi yeniden yazmak |

### C. Malzeme davranışı

| # | Teknik | İçerik |
|---|---|---|
| C1 | **Preset eğrileri** (mevcut) | `maxDepth × deformability × min(yük/nominal,1)`; `compaction`, `digRate`, `recoveryRate`. Basit, ayarlanabilir; **yük doygunluğu hatası** |
| C2 | **Bekker–Wong kapalı formu** [HAFIZA: Wong, *Theory of Ground Vehicles*] | `p = W/(b·l)`, `z = (p / (kc/b + kφ))^(1/n)`, temas uzunluğu `l ≈ 2√(2 r z)` (küçük z; 1–2 sabit-nokta iterasyonu). Yuvarlanma direnci `R = b·(kc/b+kφ)·z^(n+1)/(n+1)`. Çekiş: Janosi–Hanamoto `τ = (c + p·tanφ)(1 − e^(−j/K))`. Yükü, lastik genişliğini ve **lastik basıncını** tek modelde birleştirir |
| C3 | **Hacim korunumu / berm** | Ezilen hacmin bir kısmı yanlara/öne yığılır (Sumner 1999 ailesi) → işaretli Δ (Int16) |
| C4 | **Gevşeme / çığ** | Dik duvar hücrelerinin komşuya kayması (doğal şev açısı / angle of repose). Aktif hücre listesinde CPU; GPU'da ping-pong |
| C5 | **Kazma (patinaj)** | `digRate × patinaj` — plan Faz 3'te var |
| C6 | **Yanal iz-tutma** | `F_lat ∝ (derinlik_sol − derinlik_sağ)` → tekerlek izin içinde kalmaya çalışır, "rut steering" hissi; B2'den bedava |

C2 parametre tablosu (kc, kφ, n, c, φ, K) kaynak okunarak ve **oyun hissine göre kalibre edilerek** girilmeli;
ders kitabı değerlerini bu oturumda doğrulamadım.

### D. Kalıcılık

| # | Teknik | Not |
|---|---|---|
| D1 | Toroidal pencere + 1 m kaba katman (mevcut) | Bellek sabit; pencere dışında detay kaybolur |
| D2 | **Seyrek blok deposu** (16 m, 128² @ 12,5 cm; yalnız dokunulan bloklar) | MudRunner modeli. Ham ~48 KiB/blok (2 B derinlik + 1 B bozulma). 1 km yolda ~120 blok ≈ 6 MB ham `[HESAP, kaba]`; RLE/kuantize ile çok küçülür (tahmin) |
| D3 | Yalnız save-game (authored dosyaya yazma yok) | TERRAIN_DEFORMATION İlke #2 ile uyumlu; **korunmalı** |
| D4 | Zamanla iyileşme (`recoveryRate`) | Kar > 0, çamur 0; çamurda kalıcı iz oyun değeri taşır |

---

## 5. Önerilen mimari: Katmanlı yer değiştirme

```
yükseklik(x,z) = Taban_üçgenBirebir(x,z)        ← 2 m, otoriter, tek collider (heightfield)
               + AuthoredΔ(x,z)                  ← seyrek, 0,25–0,5 m, level'a kayıtlı, statik   [ileri]
               + RuntimeΔ(x,z)                   ← iz alanı, 12,5 cm, save-game'e kayıtlı        [M2]
```
- Render: tek CDLOD; deformasyon penceresinde ince alt-seviyeler.
- Fizik: tek collider (taban). Δ'lar **sanal ofset** olarak tekerlek ışınına ve (isteğe bağlı) karakter ayağına uygulanır.
  Aynı `heightAt+Δ` fonksiyonu foliage, raycast, VFX yerleşimi için ortak.
- Sert taban = taban collider'ı. "Çamur kalınlığı" = authored toprak-derinliği verisi (T); alan derinliği `d ≤ T`'ye
  kırpılır. **Dünyada çukur açılmaz** (Detail Patch belgesinin K-05'i gerekmez).

### 5.1 CDLOD alt-seviyeleri (A5)
- Düğüm seçimi pencere içinde `k` ek seviye ister (2 m → 1 → 0,5 → 0,25 m). Morph aralığı mevcut kuralla aynı
  (komşu LOD farkı ≤ 1; `range0 / leaf` alt sınırı).
- İnce seviyede taban yüksekliği **üçgen-birebir** hesaplanmalı: bugünkü shader bilinear (`mix(mix(...))`), ve
  2 m hücrede bilinear–üçgen sapması `burulma/4` (1 m burulmada 25 cm) — iz derinliğinden büyük. Yoksa tekerlek ile
  görsel yüzey arasında sistematik kayma olur (K3a'nın görsel karşılığı).
- Normal: taban üçgen normali + Δ dokusunun merkezi farkı (fragment).
- Üçgen bütçesi `[HESAP]`: 0,25 m halka 16 m yarıçap ≈ 25,7 bin üçgen; 0,5 m halka 16–32 m ≈ 19 bin; 1 m halka
  32–64 m ≈ 19 bin → **~65 bin üçgen**. 0,25 m'yi 32 m'ye çıkarırsak ~100 bin. (Tek araç; çok araçta pencere
  birleşimi.) Mevcut arazi tavanı 0,75–0,84 M üçgen / 0,7–0,9 ms GPU ölçülmüştü, yani pay var.
- **İlk gün 0,25 m gerekmeyebilir.** Görsel iz genişliği 30–45 cm; 0,25 m mesh ile ~2 vertex/iz, 12,5 cm alan ile normal
  detayı. Seviye sayısı spike ile seçilir.

### 5.2 Neden tek collider + sanal ofset (B1+B2) ve B3'ün katman sorunu
Heightfield deformasyonu *tabanın altına* iner. Tekerlek ışını **en yüksek** yüzeyi vurur; iz yüzeyi tabanın altındaysa
ışın taban collider'ına çarpar. B3 ancak şu iki yoldan biriyle çalışır:
1. Taban collider'ını bilerek "yatak kaya" (zemin − T) olarak kurmak ve **çamur yüzeyini ikinci bir collider**
   yapmak (Detail Patch belgesinin önerisi). Bedeli: çamur bölgesi başına ayrı ince heightfield, bölge kenarında
   T kadar basamak olmaması için kenar yumuşatması ve çamur dışındaki her yerde T'nin sıfırlanması.
2. Taban tile collider'ını pencerede `setShape` ile alçaltmak — 2 m çözünürlükte 12,5 cm iz temsil edilemez.

Bu yüzden **önerim B1+B2** (sanal ofset). `setShape`'in ucuz olması B3'ü *ileri aşama* seçeneği yapar, ama
ayrı bir spike (S-D4) ile gövde teması/dinamik kararlılık ölçülmeden karar verilmemeli.
Sanal ofsetin bilinen bedeli: şasi collider'ı görsel olarak batan zemine değil taban yüzeyine çarpar; derinlik
sınırı (şasi yerden yüksekliği) ve `belly drag` (plan Faz 3) bunu örter.

### 5.3 Authored Δ — "boyayla yerel detay" isteğinin karşılığı (A6)
- Taban tile'ının yanında, yalnız boyanan bloklarda (16 veya 32 m) ek **Δ yükseklik dokusu**: 0,25–0,5 m örnekleme.
- Detail Paint aracı: fırça = "bu bloklara Δ ayır + çamur-kalınlığı T + toprak tipi". Topoloji değişmez.
- Kapsam kuralı: |Δ| ≤ süspansiyon seyahati civarı (≈ ±0,3–0,5 m). Daha büyük yapılar (hendek, set) ya taban
  sculpt'ında 2 m ile temsil edilir ya da mesh/blocking volume olur — çünkü Δ sanal ofsettir, şasiyi engellemez.
- Yeni kayıt yüzeyi → `saveValidator` + `serializationDrift` + CLAUDE.md allowlist notu (6. yüzey). Dosya biçimi
  `*.terrain.json` tile listesine ek `detail` bloku + `<name>.detail/x_z.bin` önerisi.
- Bu madde M0–M2 için **gerekmez**; yol kenarı hendeği/çamur çukuru gibi *tasarlanmış* ayrıntı için lazım olunca.

### 5.4 Kalıcılık: toroidal pencere + seyrek blok deposu
- Pencere: 64 m, 512², araç çevresi (mevcut).
- Pencereden çıkan hücreler (`onEvictCell` zaten var) → **16 m blok deposu** (128² @ 12,5 cm), yalnız dokunulan ve
  `deformability > 0` bloklarda ayrılır; LRU + bellek bütçesi; dışarıdaki blok geri girince yeniden yüklenir.
- Save-game: yalnız "kirli" bloklar, RLE + 8-bit; boyut bütçesi (şu an plan ≤ 64 KB) kaba katmana düşme kuralıyla.
- Açık karar: lojistik oyunda tekrar yol sürüşü ve iz birikimi *tasarım değeri* mi? (§9, K-09)

---

## 6. Mevcut TERRAIN_DEFORMATION planı için somut değişiklik önerileri

| # | Değişiklik | Gerekçe |
|---|---|---|
| 1 | `targetDepthForWheel` doygunluğunu kaldır: `nominal` = boş araç statik yükü; oran > 1 derinliği artırır (üst sınır `maxDepth`) veya Bekker (C2) | Yük sütunu; `deformationField.ts:54` |
| 2 | Tekerlek temas yamağı örneklemesi (B2) + yanal iz-tutma (C6) | Tek ışın genişliği bilmiyor; iz içinde seyir hissi |
| 3 | Faz 3 "yerel patch mesh + discard" → **CDLOD alt-seviyeleri** | Çift yüzey/dikiş/gölge tutarlılığı yok; ~65–100 bin üçgen |
| 4 | Faz 5 "kaba katman 1 m" → **seyrek 16 m blok deposu** (D2) veya en azından karar noktası | Yol üstü iz birikimi |
| 5 | Alanı işaretli yap (Int16) ya da ayrı berm kanalı ekle | C3 hacim korunumu; plan "berm yalnız görsel" diyor, kanal ucuz |
| 6 | `maxDepth`'i toprak-derinliği verisi `T`'ye (katman/bölge başına) bağla | "Çamur kalınlığı" fiziksel anlam kazanır; sert taban garantisi |
| 7 | "Rapier collider değiştirme pahalı" notunu güncelle: setShape 0,05–0,2 ms `[ÖLÇÜM]`; asıl sorun katman | Karar kaydı doğruluğu |

---

## 7. Detail Patch belgesinin maddeleri ile karşılaştırma

| Belge | Bu raporun görüşü |
|---|---|
| Seçenek A — çoklu Landscape | Reddedilmeli: Landscape legacy; OPEN_WORLD K1/İlke #2 |
| Seçenek B — boyayla topoloji | Doğru tespit: yüksek risk. Amaç (konuma göre ince detay) A5+A6 ile topolojisiz karşılanır |
| Seçenek C — Detail Patch + Paint | Paint aracı fikri iyi; **patch = ayrı mesh** kısmı yerine Δ-blok + CDLOD alt-seviye |
| P-04 çift yüzey / A3 collider yetkisi | Yetkili tek collider = taban; Δ sanal ofset. Sorun tasarımla ortadan kalkar |
| K-01 2 m | Uygun, ancak ince seviyede üçgen-birebir örnekleme şartıyla |
| K-02 Landscape çoklama mı | Hayır |
| K-03/K-04 blok 32/64 m, 0,5/0,25 m | Δ blok 16 veya 32 m; 0,25–0,5 m; runtime alan 12,5 cm (MudRunner emsali) |
| K-05 kontrollü çukur | Gerekmez; `T` verisi + kırpma |
| K-06 soil asset biçimi | Yerleşik physical material presetleri (TERRAIN_DEFORMATION açık soru 1) → fork ihtiyacında `*.physmat.json` |
| K-07 temas yetkilisi | Taban collider + sanal ofset (B1+B2) |
| K-08 iz çözünürlüğü / collision stratejisi | 12,5 cm alan; collision sanal; B3 ayrı spike |
| K-09 patch/rut level mı game save mı | Authored Δ → level; runtime Δ → game save (mevcut İlke #2) |
| K-10 LOD/streaming | Alt-seviyeler yalnız pencerede; Δ blokları terrain grid'iyle akar |
| TD-01…07 kabul testleri | Uygun; TD-05 ("alt sert tabana kadar batma") için `d ≤ T` kırpması, TD-07 için perf bütçesi §8 |

---

## 8. Spike / kapı önerileri (kod yazmadan önce ölçülecekler)

| ID | Soru | Kapı |
|---|---|---|
| S-D1 | CDLOD'a 2–3 ince seviye eklenebilir mi, taban üçgen-birebir, morph çatlaksız mı? | 0 çatlak (mevcut smoke yöntemi), arazi GPU < 3 ms, 2 m → 0,25 m geçiş pop'suz |
| S-D2 | Sanal ofset + yamak örnekleme + yanal iz-tutma: gerçek araçta his, titreşim, uyuyan gövde, slew ≤ 0,3 m/s | Faz 0 ölçütleri + tek tekerlek derin izde temas kaybı sayısı |
| S-D3 | Bekker kapalı formu vs preset: aynı araç, boş/hafif/ağır, kuru toprak/çamur — ölçülebilir fark? | T01/T02/H-001/H-003 |
| S-D4 | `setShape` ile yerel heightfield: dinamik şasi + 4 tekerlekle kararlılık, temas manifold maliyeti, uyuyan gövde | Zıplama yok, adım süresi < 0,3 ms; yalnız S-D2 yetmezse |
| S-D5 | Seyrek blok deposu: 5 km yol sürüşü sonrası bellek/save boyutu | Bellek sınırlı büyür, save ≤ belirlenen bütçe |
| S-D6 | Toroidal alanın GPU kısmi yüklemesi (planlanmış) + shader normal/tint | 512² R8 < 0,3 ms/kare |

**M2'ye eşleme (D-010):** M2 kabul kapısı için gerekli olan S-D2, S-D3, S-D6 + yük modeli düzeltmesi.
S-D1 (ince mesh) görsel kalite artışı, M2'nin zorunlu parçası değil. S-D4/S-D5/§5.3 sonraki kademe.

---

## 9. Kararlar

**Karar kaydı (2026-10-23, kullanıcı onayı):**
- **K-A — Kalıcılık: kademeli.** M2 kalıcılık olmadan tamamlanır. Pencere içindeki kısa vadeli izler (aynı teslimat,
  ikinci geçiş, saplanma sonrası yeniden deneme) zaten kapsamda. Pencereden çıkan izler mevcut 1 m kaba katmana
  (görsel kalıntı, fiziği etkilemez) düşer. Seyrek 16 m blok deposu ve save-game kalıcılığı **M2 oynama testinden
  sonra** karara bağlanır; ölçüt: oyuncu aynı yolu ikinci kez sürerken izlerin orada olmasını bekledi mi / fark etti mi.
- **K-B — Malzeme modeli: düzeltilmiş preset.** Bekker–Wong M2'de kullanılmaz (lastik basıncı mekaniği GDD'de
  "kademeli, öneri"). `targetDepthForWheel` doygunluğu kaldırılır: `nominal` = boş aracın tekerlek başına statik yükü,
  oran > 1 derinliği `maxDepth`'e kadar artırır. Derinlik hesabı tek bir fonksiyonun arkasında toplanır
  (`sinkage(profil, yük, lastikGenişliği)`); Bekker gerekirse aynı arayüzün arkasına konur.

**Hâlâ açık:**
1. **İnce mesh M2 içinde mi?** A1 (yalnız normal/tint) M2'yi karşılar; ince mesh kalite kararı.
2. **Authored Δ + Detail Paint ne zaman?** Yol/hendek tasarımı ihtiyacı çıktığında; M0–M2 öncesi gerekmiyor.
3. **Çamur yatağı verisi (`T`)**: katman başına sabit mi, boyanabilir harita mı?

---

## 10. Riskler ve bilinmeyenler

- **Ölçüm sınırı:** setShape ölçümü Node/wasm, dinamik cisim yok, yalnız zamanlama. Tarayıcıda ve araçlı sahnede yeniden ölçülmeli.
- **Üçgen bütçesi ve alan maliyeti `[HESAP]`**, ölçülmedi. Çoklu araç/AI pencereleri birleşimi hesaba katılmadı.
- **Sanal ofsette şasi–görsel ayrışması:** derin izlerde şasi taban yüzeyine çarpar; sınır derinliği oyun tasarımıyla uyumlu olmalı.
- **Bekker kapsamı:** derin batma ve kramponlu lastikte model zayıf (kaynaklar belirtiyor); oyun için *ilham + kalibrasyon*, doğruluk iddiası değil.
- **Web taraması sınırları:** AAA başlıkların (SnowRunner, RDR2, HZD) yöntemleri yayımlanmış ayrıntıyla doğrulanamadı;
  Eurographics PDF'i okunamadı; MudRunner anlatımı ikinci el. Sektör "emsal" olarak kullanılmalı, "kanıt" olarak değil.
- **Faz bağımlılıkları:** TERRAIN_DEFORMATION Faz 1b (terrain katmanı → physical material) ve OPEN_WORLD kalan maddeleri
  (Faz 2 açık maddeleri: node frustum culling, uzak tekrar kırma) bu raporun öncülleridir.
- **Dokunulmayanlar:** bu rapor kod değiştirmedi; yalnız bu dosya eklendi.

---

## Kaynaklar

- Spintires/MudRunner mud ve water yazısı (Game Developer): https://www.gamedeveloper.com/programming/mud-and-water-of-spintires-mudrunner
- "The Mud of MudRunner" (mod sitesi, katman dökümü): https://www.mudrunnermods.com/the-mud-of-mudrunner/
- Gilardi vd., Drift-Diffusion Based Real-Time Dynamic Terrain Deformation (EG 2016): https://diglib.eg.org/items/fa4da1ef-6250-4bd7-8c21-a7ecbb4059f5/full
- Su vd., Real-time Height-field Simulation of Sand and Water Mixtures (SIGGRAPH Asia 2023): https://asia.siggraph.org/2023/index.html?post_type=page&p=14494&id=papers_342&sess=sess131.html
- Deformable Snow Rendering in Batman (GDC 2014): https://gdcvault.com/play/1020177/Deformable-Snow-Rendering-in-Batman
- Rise of the Tomb Raider deferred deformation / Labs R&D (SIGGRAPH 2015): https://history.siggraph.org/learning/labs-rd-rendering-techniques-in-rise-of-the-tomb-raider
- Terramechanics değerlendirmeleri: https://arxiv.org/pdf/2405.11001 · https://arxiv.org/pdf/2410.04371 · https://atlantis-press.com/proceedings/meita-15/25838612
- PhysX dinamik heightfield değişikliği: https://developer.nvidia.com/content/physx-dynamic-heightfield-modifications
- Unreal `UpdateHeightfieldRegion`: https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Landscape/ULandscapeHeightfieldCollisionCo-/UpdateHeightfieldRegion
- Yerel ölçüm betiği: scratchpad `setshape-bench.mjs` (Rapier 0.19.3, Node, `FIX_INTERNAL_EDGES`).
