# Dünya özeti (`*.worldbrief.json`) ve `world:brief`

7 Kasım 2026. Pilotun ([PILOT_MOUNTAIN_VALLEY.md](PILOT_MOUNTAIN_VALLEY.md)) 1. ve 2. adımı.
Karar 20: dünya oyun tasarım dokümanından okunur; doküman oyunun deposunda kalır,
Forge'a yalnız bu genel dünya özeti şeması girer
([plan §10](../planned/WES/FORGE_WORLD_BUILDER_TASARIM_VE_TEKNIK_PLAN_v0.4.md)).

## Dosya

- Yer: level'ın yanında, `<Level>.worldbrief.json`. Pilot:
  `public/assets/world-pilot/Levels/WbPilotValley.worldbrief.json`.
- Şema ve normalizer: `engine/worldbuilder/worldBrief.ts` (`normalizeWorldBrief`).
  Normalizer katıdır: bilinmeyen alan, alan dışı nokta, eksik yol düğümü gibi her sorun
  özeti reddeder; hiçbir alan sessizce düşmez. Kayıt yüzeyi yoktur, dosya elle veya
  tasarım dokümanından yazılır.
- Manifest'e ayrıca kaydedilmez; `check:assets` onu kayıtlı level'ın sidecar'ı sayar.

## Koordinat

Özet, tasarım dokümanının koordinatıyla yazılır: doğu ve kuzey metre (kuzey yukarı),
kot dokümanın datumuna göre. `frame`, Forge dünya orijinine düşen özet noktasıdır.
Dönüşüm `engine/worldbuilder/metricFrame.ts`'tedir (ilk kez metrik ana dosya importunda kullanıldı):

`x = east − frame.east`, `z = frame.north − north`, `y = elevation − frame.elevation`.

Genişlik, derinlik ve ölçüler düz metredir; dönüşüm görmez.

## Alanlar

| Alan | İçerik |
|---|---|
| `id`, `name`, `seed` | Recipe kimliği (`recipeId`), görünen ad, tohum |
| `frame`, `area` | Koordinat çerçevesi; dünya sınırı `west/east/south/north` |
| `terrain` | Landscape id ve adı, `tileQuads` (64/128/256), `spacing`, `heightRange`; tile sayısı alandan hesaplanır, arazi alanın ortasına oturur |
| `regionProfile`, `reference` | `*.regionprofile.json` yolu; alanı kaplayan referans görseli |
| `playerStart` | Oyuncu başlangıcı |
| `valleys` | Kesitlerle vadi: her kesitte `north`, taban `floor` ve kaya çizgisi `rock` (doğu değerleri; kesit aralıkları eşit olmak zorunda değil), kuzeyden güneye `floorProfile` kotları, `sideSlopeDeg`, isteğe bağlı `relief` (`slopeFoot`, `spurs`, `ridges`, `noise` metre; eksik anahtar varsayılanı alır: 18 / 26 / 16 / 10), `ridgeElevation`, iki yamacın örtüsü `slopeCover`. Bilinmeyen vadi ve rölyef alanı reddedilir |
| `regions` | Ek bölgeler (rol + çokgen) |
| `water` | Su çizgisi (`line`, akış yönünde; vadi kesitlerine bağlı değil) veya göl (`polygon`); `width`, `bedDepth` (yatak, kıyı zemininin altında), `surfaceDepth` (su yüzeyi, kıyının altında). Bir çizginin yatağı oyulması için üçü de gerekir |
| `roads` | `nodes` (uç, kavşak, kapı) ve `edges` (`roadClass`, isteğe bağlı `corridor` ipucu) |
| `landmarks` | Rol + konum; isteğe bağlı düzlenmiş zemin `pad: { size, falloff }` |
| `settlements` | Yerleşimler (tür, merkez, yarıçap, nüfus) |
| `props` | Tek tek konan nesneler (rol + konum, dönüş, ölçek, çarpışma) |
| `environment` | WES: mevsim, hava (`preset`, `intensity`), sabit saat |
| `models` | Model kaynağı satırları: rol → `blender` / `tripo` / `ready` + dosya, isteğe bağlı `variant` (karar 21) |

Plan öğeleri (`water`, `roads`, `landmarks`, `regions`, `settlements`, `valleys`)
`source` taşıyabilir: `manual` (varsayılan, doküman verisi) veya `reference`
(referans haritadan ölçüldü, isteğe bağlı `confidence`). Recipe'ye aynı kaynakla geçer.

## Çalıştırma

```powershell
npm.cmd run world:brief -- assets/world-pilot/Levels/WbPilotValley.worldbrief.json --out assets/deneme/Vadi.level.json
```

- Yollar `public/` altına göredir. `--out` verilmezse özetin yanındaki `<Ad>.level.json` yazılır.
- Var olan level'ın üstüne `--force` olmadan yazmaz. `--force` level'ı özetten yeniden
  kurar ve editörde yapılan her değişikliği siler; yalnız `worldSettings.partition` korunur.
- Yeni bir level manifest'e `assetType: "level"` olarak kaydedilir; var olan kayda dokunulmaz.
- `npm run world:pilot` artık pilot özetiyle `world:brief`'tir. `world:build` adı HLOD
  üreticisinde kalır.

Çalıştırıcı: `tools/world/build-world-brief.mjs` (argümanlar) →
`tools/world/worldBriefRun.ts` (dosya okuma/yazma) → `tools/world/worldBriefBuild.ts`
(saf derleme).

## Sıra

özet → recipe planı (`worldBriefRecipe`) → arazi ve su yatakları (`createBriefTerrain`) →
boya → düzlenmiş zemin → aşamalar (`planStage`: yollar, sonra yerleşim zinciri — köy yeri,
sokaklar, parseller, arazi kullanımı, yapılar) → yol ve sokak spline'larının, sonra yapı
setlerinin araziye bake'i, setlerin altı toprak boyası → son zemini izleyen aşamalar (sokak
donatısı, çitler) → yerleşimler → kayıt-kanonik dosyalar.

**Yerleşimler** (RANDOM_WORLD_PLAN adım 1, `tests/engine/worldBriefSettlement.test.ts`):
özetteki her yerleşim greybox köy olarak kurulur. Evler, setler, istinat duvarları,
basamaklar, donatı ve çitler level'a yazılır; parsel plakaları (editör yardımcısı) yazılmaz.
Bölge profili yoksa yerleşim boş kalır (ev sayısı profilden gelir).

**Arazi ve su yatakları** (adım 3a, `engine/worldbuilder/briefTerrain.ts`, saf ve
bağımlılıksız):

- Her vadi kesitlerinden, taban profilinden, yamaç eğiminden ve rölyefinden bir zemin
  verir; arazi bunların **en alçağıdır**, iki vadi sırtta buluşur. İlk ve son kesitin
  ötesinde vadi kapanır, zemin yamaç gibi yükselir. Vadisiz özet datumda düzdür.
- Her su çizgisi, noktalarından geçen yumuşatılmış bir orta hat boyunca yatak oyar
  (yatak suyun her yanında 1 m geniş, 7 m'de kıyıya geçer). Su seviyesi orta hattın
  altındaki zemini izler ama **akış yönünde hiç yükselmez**; yatak `bedDepth`, yüzey
  `surfaceDepth` kadar aşağıdadır. Oyma zemini yalnız alçaltır. Her çizgi bir terrain
  spline'ı ve bir nehir aktörü olur.
- Göller oyulmaz, `ridgeElevation` kullanılmaz: ikisi de "not built yet" listesindedir.
- Editör aşamaları araziye yazmaz (karar 19); bu adımları bugün yalnız `world:brief`
  çalıştırır, editörde arazi aşaması sonraki dilimdir.

**Geçici adımlar** (`tools/world/worldBriefTemporarySteps.ts`): boya, bitki kuralları,
kaya saçılımı ve kulübe çiti. Her özeti okurlar ama sayıları (boya katmanları, bitki
kuralları, kaya sayıları, çit) pilotun `PILOT_TUNING`'idir; 3c–3e'de bölge profiline taşınır.

Henüz level'a yazılmayanlar, çalıştırıcının "not built yet" çıktısında listelenir:
`environment` (WES bağı; ışık ve renk kullanıcıdadır), `regions` (yalnız recipe planında),
`ridgeElevation`, göller.

## Kayıt biçimi

Çalıştırıcı level'ı editörün Save Layout'u gibi yazar, böylece editörde açıp kaydetmek
hiçbir dosyayı değiştirmez:

- Level ve hücreler `validateSavePayload` / `validateSaveWorldCellsPayload` ile; partition
  açıksa `partitionLayout` ile bölünür, `worldCells` dizini yazılır. Yazma sırası editörünki:
  hücreler → level → listede olmayan eski hücrelerin silinmesi.
- Recipe `validateSaveWorldRecipePayload`, foliage `validateFoliageData` ile; partition
  açıksa foliage dizini `foliageCells: []` taşır. Arazi tanımı `normalizeWorldTerrain` ile.
- Konumlar milimetreye yuvarlanır; varsayılan `collision: true` yazılmaz.

Doğrulama: `tests/engine/briefTerrain.test.ts` (iki vadi sırtta buluşur, eşit olmayan
kesitler, kapanan vadi ucu, rölyefsiz yamaç tam formül, kesitlere hizasız dere yatağını
oyar ve yokuş yukarı akmaz, göl raporlanır, belirlenimcilik, bilinmeyen alan reddi),
`tests/engine/wbPilotValley.test.ts` (iki derleme bayt bayt aynı, partition'lı
level geri okunup yeniden kaydedilince aynı dosyalar, dosya katmanı, `--force`) ve
`tests/smoke/world-brief.spec.ts` (gerçek editörde aç + Save: partition'lı ve partition'sız
level'da hiçbir dosya değişmiyor).

## Eski üreticiyle eşdeğerlik

Eski tek seferlik üretici (`tools/world/wbPilotValley.ts`) kaldırıldı. Taşıma, eski
sabitlerle çalıştırıldığında 64 tile, global harita, üç spline ve 151 yerleşimde bayt bayt
aynı çıktı verdi. Bilinçli iki fark vardır:

- Yamaç eğimi özetteki 20°'den `tan(20°)` ile hesaplanır; eski kod `0.364` yazıyordu.
  Fark: yerleşim kotlarında en çok 1,3 cm, tırmanış yolunda 4 mm. Yol, yerleşim kimlikleri,
  rolleri, ölçekleri ve dönüşleri aynıdır.
- Recipe bölge kimlikleri vadiden türer: `valley-floor`, `valley-west`, `valley-east`
  (eski `forest-west`/`forest-east`). Recipe alan sırası normalizer'ın sırasıdır.

Kullanıcının pilot level'daki düzenlemeleri (World Partition, `forge.vehicle`, Doruk K-180,
`viewDistance`) commit'lenmemiş durdukça pilot level yeniden üretilmez.

## Sonraki adımlar

3. Geçici adımlar genelleşir. ~~3a makro arazi + su yatakları~~ (`briefTerrain.ts`, 7 Kasım).
   Sırada: 3b göl yatağı ve `ridgeElevation`; 3c boya, 3d bitki kuralları, 3e kaya/prop
   saçılımı bölge profiline (`PILOT_TUNING` kalkar); 3f editörde arazi aşaması + tek undo.
4. T41 model listesi ve rol → model bağlama (`models` satırları, §13.7).

Ölçüt: ikinci bir dünya yalnız yeni bir özet dosyasıyla, kod yazmadan üretilebilir.
