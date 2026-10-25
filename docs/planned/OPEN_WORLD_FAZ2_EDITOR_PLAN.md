# Open World Faz 2 — kalan iş: editör düzenlemesinin `terrainEdit`'e taşınması + 16-bit heightmap

> Durum: **onaylandı; 1.–3. adım tamam** (2026-10-25, "İlerleme" bölümü). Üst plan:
> [OPEN_WORLD_PLAN.md](OPEN_WORLD_PLAN.md) "Faz 2". Bu dosya Faz 2'nin kalan iki
> maddesinin uygulama planıdır; tamamlanınca maddeler OPEN_WORLD_PLAN'da kapatılır
> ve bu dosya `docs/COMPLETED_WORK_INDEX.md` üzerinden arşivlenir.

> **Kapsam notu (2026-10-25, birleştirme sonrası).** Bu plan `58f05f6` üzerinde
> yazıldı; `main` daha sonra yerel arazi işiyle birleşti (`8caca42`). Orada çok-tile
> World Terrain zaten `terrainEdit` üzerinden düzenleniyor: belge tabanlı
> `TerrainEditWorld` + `WorldTerrainEditSession` (`src/editor/terrainStore.ts`),
> stroke başına tile yamalı undo, yalnız kirli tile'ları yazan kayıt, editör
> streaming'i, RAW import/export arayüzü ve `terrain-multitile` smoke'u. Aşağıdaki
> "bugün editör yalnız 1×1 açabiliyor" ve "RAW için arayüz yok" cümleleri o tabana
> aittir. `ForgeLandscapeData` üzerinden düzenlenen yalnız **1×1 Landscape** kaldı
> (`SceneApp.editLandscapeHeights/editLandscapeWeights`, tam dizi undo,
> `captureTerrainWrite`). Kalan iş bu yüzden "1×1'i çok-tile yoluna almak" ve
> 16-bit PNG'dir; adımların yeniden eşlenmesi "İlerleme" bölümünde.

## Context

Faz 2'nin renderer geçişi bitti ve push edildi (`13855ad`…`58f05f6`). Kalan iki madde
şunlar:

- **(a) Editör sculpt/paint'i `ForgeLandscapeData`'dan çıkarmak.** Hedef:
  `engine/terrain/terrainEdit.ts` (Float32 çok-tile çalışma kopyası, tile başına
  undo yamaları).
- **(b) Heightmap import/export'u 16-bit PNG ve RAW'a geçirmek.**

Bugün editör yalnız 1×1 arazi açabiliyor: `terrainDocumentToLandscape` çok tile'ı
reddediyor. Undo her stroke'ta tüm yükseklik ve ağırlık dizilerinin önce/sonra
kopyasını tutuyor. Heightmap 8-bit; RAW için arayüz yok.

Fırça matematiği zaten ortak, modlar birebir aynı: raise, lower, smooth, flatten /
paint, erase, smoothWeights. Asıl iş veri modelini değiştirmek. `SceneApp`'te 53
`landscapeData.get(` çağrısı var ve 15 dosya `ForgeLandscapeData` kullanıyor.

## Süre tahmini

Ölçek olarak bu oturumdaki renderer geçişi alındı: 4 adım, her biri tsc + engine
testleri + smoke turu.

| İş | Adım (commit) | Tahmini değişiklik | Süre (agent çalışması, smoke dahil) |
|---|---|---|---|
| (a) editör → `terrainEdit` | 4 | ~600–900 satır + ~300 satır test | ~6–8 saat |
| (b) 16-bit PNG + RAW | 2 | ~300–450 satır + test | ~2–3 saat |
| **Toplam** | **6** | | **~8–11 saat**, bu oturum gibi 2–3 oturum |

En büyük belirsizlik, aşağıdaki "Riskler" bölümündeki 1. ve 2. maddeler. Bunlar
ilk adımda ölçülecek; tahmin sapacaksa o adımdan sonra haber verilecek.

## Yaklaşım

Editörün tek doğruluk kaynağı, yüklenen `WorldTerrainDocument` üzerinde bir
`TerrainEditWorld` olacak. Renderer zaten çok-tile kaynak alıyor
(`worldTerrainRenderSource`). `ForgeLandscapeData` bir süre daha yalnız okunan bir
**türev görünüm** olarak kalacak; foliage, river, spline mesh ve trimesh collider
bunu okuyor. Bu tüketicilerin `TerrainHeightQuery`'ye taşınması Faz 3'ün işi.

Adımlar:

1. **Belge tabanlı düzenleme çekirdeği**
   - Landscape aktörü için `WorldTerrainDocument` ile `TerrainEditWorld`'ü bir
     arada tutan bir kayıt: SceneApp dışında, `src/scene/terrainEditSession.ts`.
   - Renderer'a belge tabanlı kaynak verilecek. Kirli tile başına
     `updateTile(x, z, rect)` çağrılacak, global harita güncellenecek.
   - Aktör-yerel isabet noktası dünya X/Z'ye çevrilecek. `heightScale` ve
     rotasyon için kural: döndürülmüş, kare olmayan ya da ikinin kuvveti olmayan
     legacy arazi okumada eski yoldan, salt-okunur açılıyor ve kullanıcıya açık
     bir migrasyon uyarısı gösteriliyor (bugünkü `captureTerrainSnapshot`
     politikasıyla tutarlı).
   - **Paint hassasiyeti ilk iş olarak çözülecek:** stroke boyunca float ağırlık
     biriktirme tamponu, quantize yalnız dab sonunda. Düşük güçlü fırçanın iz
     bırakması bir testle sabitlenecek.

2. **Stroke ve undo**
   - Dab yamaları tile başına birleştirilip stroke başına tek undo komutu olacak
     (`applyTerrainUndoPatches` / `revertTerrainUndoPatches`).
   - Tam dizi kopyaları (`LandscapeSculptStroke.beforeHeights/beforeLayers`)
     kaldırılacak.
   - `ForgeLandscapeData` türev görünümü kirli dikdörtgenden güncellenecek;
     foliage yeniden üretimi bugünkü 120 ms gecikmeyle sürecek.

3. **Diğer düzenleme işlemleri**
   - Katman doldurma, katman silme ve malzeme atama.
   - Spline deform/paint, mevcut `applyLandscapeSpline*` mantığının
     `TerrainEditWorld` üzerinde çalışan sürümüyle; tile ve dikiş güvenli.
   - Resample ve dünya boyutu değişikliği yalnız 1×1 arazide çalışacak. Çok tile'da
     bu işlemler devre dışı kalacak ve açıklama gösterilecek.

4. **Kayıt ve açılış**
   - Yalnız kirli tile'lar `encodeTerrainTile` ile yazılacak, ardından tanım
     dosyası. Bugünkü "kayıt sırasında düzenleme / yeniden dene" davranışı
     korunacak.
   - `terrainDocumentToLandscape` çok-tile reddi editör yolundan kalkacak. Çok
     tile'lı arazi editörde açılıp sculpt ve paint edilebilecek, ama runtime
     collider'ı Faz 3'e kadar uyarı verecek.
   - Smoke: iki tile arasında sculpt → kaydet → yeniden aç → aynı yükseklik.

5. **16-bit PNG codec'i**
   - Bağımlılık eklenmeyecek. `DecompressionStream` / `CompressionStream` ile
     deflate, PNG filtreleri, CRC ve chunk yazımı; gray16 okuma ve yazma; 8-bit
     PNG geriye uyumlu.
   - Engine testleri: round-trip, filtre türleri, bozuk dosya.

6. **Import/export arayüzü**
   - Details panelinde PNG16 ve RAW seçenekleri olacak (`specialActorDetails.ts`).
     Dışa aktarma dünya boyunda, yükseklik aralığı dosyayla birlikte bildirilecek.
   - Dünya boyunda içe aktarma tüm belgeyi değiştirecek: yeni tanım, tile
     yazımları ve tek undo komutu. Bugünkü "mevcut grid'e yeniden örnekle"
     davranışı 8-bit PNG için seçenek olarak kalacak.
   - Faz 2'nin kalan maddeleri `OPEN_WORLD_PLAN.md`'de kapatılacak.

## Riskler

1. **Paint quantize:** `terrainEdit` her dab'da 8-bit'e yuvarlıyor. Düşük güçlü
   fırça hiç iz bırakmayabilir. Çözümü 1. adımdaki biriktirme tamponu.
2. **Veri modeli kapsamı:** türev `ForgeLandscapeData` görünümü tüketicileri
   şimdilik ayakta tutuyor. Bu görünüm tek grid olduğu için çok tile'da foliage,
   river ve spline mesh Faz 3'e kadar yalnız ilk tile'ı ya da hiçbir şeyi
   görmeyebilir. Bu durum açıkça uyarılacak, sessiz kalmayacak.
3. **Koordinat dönüşümleri:** aktör-yerel ve dünya-hizalı uzaylar,
   `heightScale`, rotasyon.
4. **Kayıt koordinasyonu:** çok tile yazımı ile bugünkü yeniden deneme akışı
   birlikte çalışmak zorunda.

## Yeniden kullanılacaklar

- `createTerrainEditWorld`, `applyTerrainBrush`, `applyTerrainUndoPatches`,
  `revertTerrainUndoPatches`, `mergeTerrainDirtyRects` (`engine/terrain/terrainEdit.ts`)
- `worldTerrainRenderSource`, `TerrainRenderer.updateTile`
  (`engine/terrain/terrainRenderSource.ts`, `engine/render-three/terrain/terrainRenderer.ts`)
- `updateTerrainGlobalMap` (`engine/terrain/terrainGlobalMap.ts`)
- `encodeTerrainTile`, `validateTerrainTile` (`engine/terrain/terrainTileCodec.ts`,
  `engine/terrain/terrainLoader.ts`)
- `importRawHeightmap`, `exportRawHeightmap`, `iterateRawHeightmapTiles`
  (`engine/terrain/terrainImport.ts`)
- Ortak fırça matematiği (`engine/scene/landscapeBrush.ts`)

## Doğrulama (her adımda)

- `npx tsc --noEmit`
- `npm run test:engine` (yinelerken `-- --filter terrain`)
- Smoke'lar (aşağıdaki "Smoke ortam notu"na bakın). Kapsam: `landscape-sculpt`, `landscape-paint`,
  `landscape-spline-chain`, `landscape-wireframe`, `terrain-isolation`,
  `terrain-migration`. Adım 4'te yeni çok-tile sculpt smoke'u, adım 6'da
  heightmap import/export smoke'u eklenecek.
- Son adımda `npm run build:verify`.
- Her adım ayrı commit, oturumun çalışma dalına push (2026-10-25'ten beri
  `claude/serene-fermi-qh36kn`), ardından
  kullanıcıya haber.

## Smoke ortam notu (bulut oturumları)

Bulut konteynerinde Playwright'ın beklediği tarayıcı sürümü (`@playwright/test`
^1.61 → `chromium_headless_shell-1228`) kurulu değil; kurulu olan
`/opt/pw-browsers/chromium_headless_shell-1243`. `playwright install` çalıştırmak
yerine, git'in yok saydığı `.dev-server/` altında yerel bir config kullanıldı:

```ts
// .dev-server/pw.config.ts (commit edilmez)
import base from "../playwright.config";
import { defineConfig, devices } from "@playwright/test";
const repo = "/home/user/Forge";
export default defineConfig({
  ...base,
  testDir: `${repo}/tests/smoke`,
  outputDir: `${repo}/test-results`,
  reporter: [["list"]],
  globalSetup: `${repo}/tests/smoke/global-setup.mjs`,
  globalTeardown: `${repo}/tests/smoke/global-teardown.mjs`,
  webServer: { ...(base.webServer as object), cwd: repo } as never,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: {
    executablePath: "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
  } } }],
});
```

Çalıştırma: `npx playwright test -c .dev-server/pw.config.ts <spec…>`.

- Tam Chromium (`/opt/pw-browsers/chromium`) favicon ister ve `pageErrors`
  kontrolü olan smoke'lar `favicon.ico` 404'üyle düşer; headless kabuk istemez.
- Headless kabuk WebGL kanvasını `page.screenshot` ile yakalamaz (siyah çıkar);
  ekran görüntüsü karşılaştırması için tam Chromium + `preserveDrawingBuffer`
  kullanın.
- `vehicle.spec.ts` "a TPS character gets in with E…" bu ortamda (SwiftShader,
  ~10 fps) Faz 2 öncesi commit'te de düşüyor; arazi içermez, regresyon sayılmaz.
- `terrain-surface.spec.ts` "OffroadTest paint layers reach the car's wheels…"
  (Play'de araba sürüşü) bu ortamda 240 s zaman aşımına uğruyor; 1b'den önceki
  `0fc52275`'te de aynı şekilde düşüyor (2026-10-25). Editör fırçasından geçmez.

## İlerleme

### Adım 1a — stroke boyunca float paint tamponu (2026-10-25)

`applyTerrainBrush(world, brush, { paint })`: `TerrainPaintAccumulator` stroke
başına dünya vertex'i anahtarlı, quantize edilmemiş katman ağırlıklarını tutar.
Dab ağırlıkları tampondan okur (tamponda yoksa tile baytlarından), yeni float'ı
tampona, quantize edilmiş baytları tile'a yazar. Tampon yazımı da baytlar gibi
dab sonuna ertelenir, yani `smoothWeights` dab'ın başlangıç ağırlıklarını okur.
Seçenek verilmezse davranış eskisi gibidir. Editörde her `WorldTerrainStroke`
kendi tamponunu taşır. Undo yamaları değişmedi; geri alma bit-birebir kalır.

Neden: 8-bit adımın yarısından (1/510) az değişen bir dab bayta geri yuvarlanıyordu.
UI'da en düşük güç 0,01 olduğu için merkezde sorun yok, ama falloff kenarında
etkili fırça küçülüyordu: güç 0,01, falloff 4'te yarıçapın yalnız iç üçte biri
boyanıyordu.

Doğrulama: engine testleri — düşük güçte (0,001 × 40 dab) tamponsuz stroke hiç
iz bırakmaz, tamponlu stroke legacy float referansıyla aynı baytı verir;
ağırlık toplamı 255, dikişler eşit, undo birebir; ilk dab'da tamponlu
`smoothWeights` tamponsuzla aynı. `terrain-multitile` smoke'una dikiş üstünde
güç 0,01 / falloff 4 ile 60 dab'lık paint stroke'u eklendi: autosave'de değişen
vertex sayısı tamponla **62**, tampon editörde kapatılınca **13** (smoke düşer);
toplam 255 ve dikiş satırları eşit.

### Adım 1b + 2 — 1×1 Landscape aynı stroke yolunda (2026-10-25)

Kullanıcı yeniden eşlemeyi onayladı. 1×1 için ayrı fırça kodu kalmadığından 2. adım
(tam dizi undo'nun ve `editLandscapeHeights/Weights`'in silinmesi) bu committe
birlikte yapıldı; ölü kod bırakmamak için ayrılmadı.

- `SceneApp`'te tek stroke yolu var (`TerrainStroke`, `beginTerrainStroke` …
  `completeTerrainStroke`). Çok-tile arazi session'ın tile'larını dünya uzayında
  düzenler. 1×1 Landscape stroke başında grid'inden **actor-yerel** bir tek-tile
  edit world kurar (`landscapeEditWorld`, `engine/terrain/terrainLandscapeBridge.ts`):
  origin grid'in min köşesi, Y yerel yükseklik (metre, `heightScale` katlanmış).
  Hit noktası `worldToLocal` ile bu çerçeveye çevrilir; taşınmış ya da döndürülmüş
  actor aynı şekilde düzenlenir. Ramp önizlemesi `localToWorld` ile çizilir.
- Her dab'ın yamaları (`patch.after`) `writeTerrainPatchToLandscape` ile grid'e
  yazılır; `ForgeLandscapeData` artık kirli dikdörtgenden güncellenen türev görünüm.
  Renderer, spline/River, foliage ve Save onu okumaya devam eder (Save 4. adımda).
- Undo/redo yamaları grid'e yazar (undo ters sırada). Grid'in boyutu ya da katman
  sayısı yamanınkiyle uyuşmazsa komut hiçbir şey yapmaz.
- Edit world her stroke'ta yeniden kurulur, çünkü fill, spline, resample ve import
  3. adıma kadar grid'i doğrudan değiştiriyor. 257² × 8 katman için kopya ucuz.
  3. adımda bütün yazıcılar edit world'den geçince kalıcı olacak.
- **Davranış farkları:**
  - 1×1 boya ağırlıkları dab başına RGBA8'e nicemlenir; stroke tamponu (1a)
    düşük güçlü dab'ları korur. Kayıt zaten RGBA8'di.
  - Terrace adımı ve ramp ofsetleri `heightScale ≠ 1` grid'de artık ham birim
    değil, metre. Arayüzdeki değerler zaten metreydi.
  - Aktif katman bulunamazsa 1×1 eskisi gibi ilk katmana düşer, çok-tile
    uyarı verir.
- **Salt-okunur:** kare olmayan, ikinin kuvveti olmayan ya da 8'den fazla katmanlı
  grid. Bunlar yalnız migrasyonun yeniden örneklemesi gereken legacy sidecar'larda
  görülür; zaten kaydedilemiyorlardı. Sculpt/paint denemesi nedenini ve "önce bir
  preset çözünürlüğüne Resample" önerisini gösterir. `heightScale ≠ 1`
  düzenlenebilir kalır.

Doğrulama: engine testleri — 1×1 sorun listesi; `heightScale` 1 ve 2,5'te dab
actor-yerel metrelerde ve yalnız kirli dikdörtgende; paint toplamı 1; undo birebir.
Tam suite 1860 kontrol. Smoke'lar 16/17: `landscape-sculpt` (kayıt sırasında
düzenleme + retry), `landscape-sculpt-tools` ve `-shift` (1×1 ve 2×2), `landscape-
erosion-visual`, `landscape-paint`, `landscape-spline-chain`, `landscape-wireframe`,
`terrain-create`, `terrain-editor-streaming`, `terrain-isolation`, `terrain-migration`
(2), `terrain-multitile` (2). Düşen `terrain-surface` aşağıdaki ortam notunda.

### Adım 3 — Fill Layer ve spline bake tile yamalarıyla (2026-10-25)

- **Fill Layer** `terrainEdit`'e taşındı: `createTerrainLayerFillPatches(world, layer)`
  her tile için tam tile yaması üretir; zaten dolu tile'ı atlar, yazmaz. İki arazi
  türü de aynı yoldan geçer (`fillSelectedLandscapeLayer` artık async). Çok-tile'da
  önce bütün tile'lar yüklenir (`loadWholeWorldTerrain`); Details'te çok-tile Paint
  araçlarına **Fill Layer** düğmesi eklendi (eskiden kapalıydı).
- Ortak `executeTerrainPatchCommand`: stroke, Fill Layer ve spline bake aynı undo
  komutunu kullanır. World Terrain'de yamalar session tile'larına, 1×1'de grid'e
  yazılır; grid'in şekli değiştiyse komut hiçbir şey yapmaz.
- **Spline Apply Deform / Apply Paint (1×1):** hesap hâlâ grid fonksiyonlarında
  (`applyLandscapeSpline*`, runtime yeniden boyama da bunları kullanıyor), ama
  grid'in bir kopyası üzerinde çalışır. Yalnız değişen dikdörtgen tile yaması olarak
  işlenir (`landscapeGridPatchValues`), yani undo artık tüm dizinin iki kopyası
  değil, dikdörtgen boyutunda.
- **Plandan sapma:** spline korridor matematiği `TerrainEditWorld`'e kopyalanmadı.
  Çok-tile spline'lar dünya-uzayı spline'ları gelene kadar (Faz 8) kapalı; ikinci
  bir korridor uygulamasının şimdi çağıranı olmazdı. Resample ve dünya boyutu
  zaten yalnız 1×1'de; çok-tile panelinde yoklar ve ipucu bunu söylüyor.
  **Katman silme** iki yolda da hiç yok; yeni özellik olduğu için eklenmedi,
  ayrı karar bekliyor.
- **Davranış farkı:** Fill/spline undo'su dikdörtgen içinde RGBA8'e yuvarlanmış
  "önce" değerlerini yazar. Bu, diskteki değerlerle aynıdır; float ağırlıklar
  yalnız kaydedilmemiş durumda farklıydı.

Doğrulama: engine testleri — Fill yamaları dört tile'ı kaplar, yükseklikleri
korur, dolu grid'de boş liste, birebir undo, eksik tile reddi; grid dikdörtgeni
↔ yama değerleri round-trip (`heightScale` 2). Yeni smoke
`landscape-spline-bake.spec.ts`: 1×1'de iki tıkla spline, Deform +2 m ve rock
Paint, Save (63 vertex yükseldi, 82 vertex boyandı, grid'in yarısından fazlası
dokunulmamış), undo sonrası disk birebir orijinal. `landscape-paint`'e 1×1 Fill +
undo (disk ağırlıkları birebir geri), `terrain-multitile`'a çok-tile Fill (bütün
tile'lar %100 rock) + undo (tile baytları birebir) eklendi.

### Kalan adımların yeniden eşlenmesi (onaylandı 2026-10-25)

1. **1b — 1×1 Landscape'i belge tabanlı düzenlemeye almak:** 1×1 de
   `editableWorldTerrain` + `WorldTerrainEditSession` ile açılır, sculpt/paint
   `applyWorldTerrainDab` yolundan geçer. `ForgeLandscapeData` kirli dikdörtgenden
   güncellenen türev görünüm olur (spline mesh, River, foliage, collider).
   Döndürülmüş, kare olmayan ya da `heightScale ≠ 1` legacy veri salt-okunur açılır
   ve migrasyon uyarısı gösterilir.
2. **Stroke/undo:** `LandscapeSculptStroke`'un tam dizi kopyaları ve
   `editLandscapeHeights/Weights` silinir. Çok-tile tarafında bu iş zaten bitmişti.
   *1b ile birlikte yapıldı.*
3. **Diğer işlemler:** Fill Layer, katman ekle/sil/malzeme ve spline deform/paint
   `TerrainEditWorld` üzerinde çalışır. Resample yalnız 1×1'de kalır.
   *Tamam; kapsam farkı yukarıda (Adım 3).*
4. **Kayıt:** 1×1 de kirli tile + tanım yazımına geçer (`captureTerrainWrite`
   emekli olur). Legacy sidecar migrasyonu korunur. Smoke: 1×1 sculpt → kaydet →
   yeniden aç.
5. **16-bit PNG codec'i** (değişmedi).
6. **Arayüz:** RAW'ın yanına PNG16 gelir, 1×1 için de import/export açılır.
   8-bit PNG resample seçeneği kalır.
