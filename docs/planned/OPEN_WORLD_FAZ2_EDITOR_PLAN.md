# Open World Faz 2 — kalan iş: editör düzenlemesinin `terrainEdit`'e taşınması + 16-bit heightmap

> Durum: **onaylandı; 1. adımın paint kısmı tamam** (2026-10-25, "İlerleme" bölümü). Üst plan:
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

### Kalan adımların yeniden eşlenmesi (onay bekliyor)

1. **1b — 1×1 Landscape'i belge tabanlı düzenlemeye almak:** 1×1 de
   `editableWorldTerrain` + `WorldTerrainEditSession` ile açılır, sculpt/paint
   `applyWorldTerrainDab` yolundan geçer. `ForgeLandscapeData` kirli dikdörtgenden
   güncellenen türev görünüm olur (spline mesh, River, foliage, collider).
   Döndürülmüş, kare olmayan ya da `heightScale ≠ 1` legacy veri salt-okunur açılır
   ve migrasyon uyarısı gösterilir.
2. **Stroke/undo:** `LandscapeSculptStroke`'un tam dizi kopyaları ve
   `editLandscapeHeights/Weights` silinir. Çok-tile tarafında bu iş zaten bitmişti.
3. **Diğer işlemler:** Fill Layer, katman ekle/sil/malzeme ve spline deform/paint
   `TerrainEditWorld` üzerinde çalışır. Resample yalnız 1×1'de kalır.
4. **Kayıt:** 1×1 de kirli tile + tanım yazımına geçer (`captureTerrainWrite`
   emekli olur). Legacy sidecar migrasyonu korunur. Smoke: 1×1 sculpt → kaydet →
   yeniden aç.
5. **16-bit PNG codec'i** (değişmedi).
6. **Arayüz:** RAW'ın yanına PNG16 gelir, 1×1 için de import/export açılır.
   8-bit PNG resample seçeneği kalır.
