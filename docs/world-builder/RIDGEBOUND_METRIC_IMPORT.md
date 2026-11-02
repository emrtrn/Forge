# Ridgebound metrik master → World Builder / P0a

**2 Kasım P1 eki:** Kaynak arazi aktarımı aşağıdaki “P1 — kaynak heightfield”
bölümünde uygulandı. İlk P0a sözleşmesi ve kabul sınırları tarihsel olarak korunur.

2 Kasım 2026. Bu ilk dilim, aday masterın konumlarını taşır. Terrain, yol yüzeyi,
köprü colliderı veya oynanabilir level üretimi değildir. F1b/WB-13 veya M0/M1/M2
kabulü kapatılmaz.

## Kaynak ve sınır

- Canlı kaynak: [SPATIAL_MASTER_v0.2.json](https://drive.google.com/file/d/1mM5MiOrvq0RRPoc2QNDQXtxk81wG0ZY9/view).
- Doğrulanan ham SHA-256: `72afa23b7264b2e6e419ca700511e1b61cbdb6178bdf18fe53eb91e8e5e7f09b`.
- Sabit test kopyası: `tests/engine/fixtures/ridgebound-spatial-master-v0.2.json`.
  Bu kopya otomatik Drive senkronizasyonu değildir. GPT yeni kaynak hazırlarsa
  orijinali tekrar oku; yeni hash/sürümü ve sözleşme farkını incele.
- Dönüştürücü: `tools/world/ridgeboundSpatial.ts`; oyun-özel kimlikler motorun
  içine eklenmedi. Genel eksen/datum hesabı `engine/worldbuilder/metricFrame.ts`.
- Yeni recipe alanı, save endpoint'i veya normalizer istisnası yoktur. Üretilen
  recipe mevcut `normalizeWorldRecipe` üzerinden hatasız geçmelidir.

## Kullanım

```powershell
# Varsayılan: yalnız doğrulama/rapor; hiçbir çıktı dosyası yazılmaz.
npm.cmd run world:ridgebound -- --source tests/engine/fixtures/ridgebound-spatial-master-v0.2.json

# Yeni ve ayrı bir inceleme klasörüne açık çıktı:
npm.cmd run world:ridgebound -- --source tests/engine/fixtures/ridgebound-spatial-master-v0.2.json --expect-sha256 72afa23b7264b2e6e419ca700511e1b61cbdb6178bdf18fe53eb91e8e5e7f09b --out output/ridgebound/yeni-inceleme
```

Çıktı klasörü `output/ridgebound` altında **yeni, doğrudan bir alt klasör**
olmalıdır. Var olan klasör, `public/`, kaynak veya proje varsayılanları üzerine
yazılmaz. Kaynak 2 MiB ile sınırlıdır; bilinmeyen kök alan/sürüm, yanlış eksen,
bozuk R01 uçları veya eksik B1 ankrajı çıktıyı reddeder. Kaynak ifadeleri
çalıştırılmaz. Yeni hash aynı v0.2 sözleşmesine uyuyorsa açık uyarıyla raporlanır;
`--expect-sha256` verilmişse farklı hash tamamen reddedilir.

Çıktılar:

- `preview.svg`: kuzey yukarı, aynı yatay metre ölçeğinde R01 ve kontrol noktaları.
- `import-report.json`: kaynak/hash, dönüşüm, kontrol noktaları, yol genişliği/eğim
  dönüşümü, eksikler ve aktarılmayan alanlar.
- `layouts/RidgeboundP0.worldrecipe.json`: V0/V1, B1 ve POI-01–06; tek R01 grafı.
- `layouts/RidgeboundP0.level.json`: şematik başlangıç sahnesi. İşaretler mevcut
  World Builder **Plan blockout → Dry Run → Apply** adımlarıyla oluşturulur.
- `README.md`: kullanım ve kabul sınırı.

Sahne/recipe çifti aynı yollar korunarak **ayrı test projesinin public/**
dizinine alınır. Kullanıcının açık Forge projesinin varsayılan sahnesi değiştirilmez.
Otomatik tarayıcı testi kendi `.playwright-smoke/run-*` projesinde bu adımı yapar.
Recipe'yi T35 Reference Plan Import alanına yapıştırma: bu farklı bir belgedir.

## Koordinat ve sahiplik

Varsayılan teknik ankraj kaynağın kuzeybatı köşesidir: east=0, north=6000,
elevation=0. Bu, 6×6 km dünya boyutunun nihai onayı değildir. Dönüşüm
`x=X-east`, `z=north-Y`, `y=Z-elevation`; yeniden ölçekleme yoktur.

| Kontrol noktası | Kaynak doğu/kuzey | Forge x/z |
|---|---|---|
| V0 | 3925 / 1200 | 3925 / 4800 |
| V1 | 1700 / 1650 | 1700 / 4350 |
| B1 | 3397 / 1330 | 3397 / 4670 |

Yüzde eğim dereceye `atan(percent/100)` ile çevrilir. R01'in %10 adayı yaklaşık
5,71° ve genişliği 6 m olarak **raporlanır**, yol üreticisine uygulanmaz.
Recipe'de `source: manual`, kullanıcı tarafından yazılmış masterın aktarımıdır;
görsel gözlemi veya uydurma güven puanı değildir. Source hash mevcut şemaya
eklenmeden ayrı raporda tutulur.

V0/V1 merkezleri `protected` işaretlidir. Bu, authored yol/POI geometrisini
kilitlemez. İlk kontrol için yalnız **Plan blockout** kullanılır. Roads,
settlementSites ve diğer üreticiler farklı rota/yerleşim üretebilir.

Plan blockout 11 işaret üretir; kendi çıktısında tekrar çalışma boş farktır.
Mevcut stage sahiplik kuralları elle taşınan veya silinen işaretleri korur.
**Düzenlenmiş recipe'ye yeni masterı birleştirme bu dilimde yoktur**; yeni inceleme
klasörü üreterek karşılaştırılır. CLI önceki çıktı klasörünü değiştirmez.

## Sonraki dilim

POI-07 canlı kaynakta yoktur ve V1 merkezinden türetilmez. GPT tarafı aday teslim
cebi, erişim ve dönüş alanını hazırlıyor. Terrain/U16, hidroloji, yol tasarım kotu,
B1 tabliye/şev/collider, POI ayak izi/parsel/avlu/giriş ve görev sistemi bu pakette
üretilmez; rapor bunları açıkça listeler.

Sonraki teknik adım seçilen pilot ızgarasında heightfield üretimi, sonra authored
R01 kotu/B1 ve ölçülü POI bloklarıdır. Genel araçlar Forge'da, Ridgebound kararları
adaptör/veride kalır. Mevcut sahneler ve bağımsız authored çalışma korunur.

## Kontroller

Yeni testler engine runner ve build:verify içindedir. CLI testi yeni klasör,
hash doğrulaması, authored çıktı üzerine yazmayı reddetme ve public/ korumasını
sınar. `ridgebound-spatial.spec.ts`, izole projede önizleme, gerçek kamera
frustum'u, apply/undo/redo, save/reload ve tekrar üretimi sınar. Şematik SVG ayrıca
Chromium'da açılarak görsel olarak kontrol edildi.

Kilometrelik önizlemeyi görüntülerken bulunan kamera hatası da giderildi:
World Builder Focus artık 80 m ortografik sınıra takılmaz; viewport oranını,
gerekli uzak kesme düzlemini ve Top görünüşün kuzey yönünü korur. Bu değişiklik
genel editör hesabındadır; sahne verisine yazılmaz.

## P1 — kaynak heightfield (2 Kasım 2026)

`--heightmap` verilirse yeni terrain paketi üretilir. Girdi, [Drive makro
heightfield v0.2](https://drive.google.com/file/d/1mVdVcTWfzyOvJNAZkd6bvF2OtdIZfNU5/view)
ile birebir doğrulanan `tests/engine/fixtures/ridgebound-valley-heightfield-v0.2.png`
dosyasıdır. SHA-256:
`bc0c67e06eded7f5533c582d540420b7963d33e46d7c131a1fa7cbf8ae623934`.
Bu raster 1001×1001, 16-bit gri ve **6 m** aralıklıdır; kodlama 100…850 m.

```powershell
npm.cmd run world:ridgebound -- --source tests/engine/fixtures/ridgebound-spatial-master-v0.2.json --heightmap tests/engine/fixtures/ridgebound-valley-heightfield-v0.2.png --expect-heightmap-sha256 bc0c67e06eded7f5533c582d540420b7963d33e46d7c131a1fa7cbf8ae623934 --out output/ridgebound/yeni-terrain-incelemesi
```

Tile sınırını source lattice üzerinde dışarı yuvarlayan ve kenar dışına taşarsa
reddeden genel yardımcı `engine/terrain/heightmapWindow.ts` içindedir. P1 teknik
seçimi: 100 m test payı, 64 quad/tile; **8×3 tile, 3072×1152 m**, 513×193 kaynak
örneği. Origin `[1536,0,4224]`; kaynak doğu 1536…4608 / kuzey 624…1776 m.
Bu seçim masterı, mevcut kuzeybatı ankrajını veya mekânsal onayı değiştirmez.

**Yeniden örnekleme yapılmaz.** Kaynağın U16 kodları aynen kesilip ortak tile
kenarlarına kopyalanır; 1 m ayrıntı, yol profili, temel düzlüğü veya kıyı detayı
üretilmiş sayılmaz. V0'nun ayrı 1 m rasterı bu sürümde birleştirilmez. Bilinmeyen
raster boyutu, bit derinliği, renk türü, extent veya kodlama reddedilir.

Ek çıktılar: `RidgeboundP1.level.json`/recipe, `.landscapes/pilot.terrain.json`,
24 tile, global harita ve kayıpsız kesilmiş `pilot-heightfield-u16.png`.
`import-report.json`, iki kaynak hash'ini, source window/spacing/extent'i,
kontrol noktalarının gerçek terrain kotlarını ve bekleyen işleri kaydeder.

Terrain collision aktiftir; bu, R01 yolunun veya B1 tabliyesinin hazır olduğu
anlamına gelmez. B1 kontrol noktası ~209,84 m **ham yatak** kotudur. World Builder
Plan blockout işaretleri artık bu arazinin üstüne oturur. Konum aktarımı, terrain
veri doğruluğu, fizik üçgenleri, editor görüntüsü ve gerçek sürüş ayrı kabul edilir.

P1 için de mevcut klasöre veya kullanıcı sahnesine yazma yoktur. Yeni masterı
elle düzenlenmiş recipe'ye birleştirme hâlâ açık; yeni inceleme klasörü gerekir.

## Relief A — koruma maskeli makro arazi adayı (2 Kasım 2026)

P1'in doğru aktarılmış olması, topoğrafik çeşitlilik kabulü değildir. Kaynak
pilotunda 172,76–398,70 m kot aralığı bulunmasına rağmen baskın biçim geniş,
yumuşak vadi yamaçlarıdır. Ayrı bir karşılaştırma adayı için CLI'ya
`--terrain-variant relief-a` eklenmiştir; varsayılan P0/P1 davranışı korunur.

```powershell
npm.cmd run world:ridgebound -- --source tests/engine/fixtures/ridgebound-spatial-master-v0.2.json --heightmap tests/engine/fixtures/ridgebound-valley-heightfield-v0.2.png --expect-sha256 72afa23b7264b2e6e419ca700511e1b61cbdb6178bdf18fe53eb91e8e5e7f09b --expect-heightmap-sha256 bc0c67e06eded7f5533c582d540420b7963d33e46d7c131a1fa7cbf8ae623934 --terrain-variant relief-a --out output/ridgebound/yeni-rolyef-adayi
```

Genel ve saf çekirdek `engine/worldbuilder/macroRelief.ts`, dünya koordinatlarında
seed'li sırt rölyefi ve yumuşak koruma maskelerini hesaplar. Ridgebound parametreleri,
H-01/H-02 adaptasyonu ve konum/koridor kararları `tools/world/ridgeboundRelief.ts`
içindedir. Kaynak ifadeleri çalıştırılmaz; H-01 formülü desteklenen sözleşmeyle
eşleşmezse aktarım reddedilir. Ham kaynak rasterdan yeniden başlanır; önceki
adayın veya P1'in üstüne birikimli sculpt uygulanmaz.

İlk aday: seed `20261102`, genlik üst sınırı 190 m, dalga boyu 490 m, yön -25°.
Gerçek en büyük ek yükselti yaklaşık 139,49 m'dir; 85.522 örnek değişmiş, koruma
ve sınır maskelerinde 13.227 örnek değişmeden kalmıştır. V0/V1, B1 ve POI kontrol
noktalarının hesaplanan kot farkı sıfırdır. Arazi, P1 ile aynı 24 tile / 6 m
ızgarasındadır. Yerel 1 m ayrıntı veya fiziksel yol oluşturulmaz.

Koruma çekirdekleri: V0/V1 110 m, diğer kontrol noktaları 55 m, R01 rehberi 34 m,
H-01 örneklenmiş merkez çizgisi 70 m, H-02 55 m. Geçiş genişlikleri ve bütün aday
parametreleri `import-report.json` içinde kayıtlıdır. Bunlar teknik aday
değerleridir; parsel/yerleşim/yol/hidroloji için onaylanmış alan ölçüleri değildir.
Maske garantisi raster örnekleri içindir; tam yerleşim ayak izleri ayrıca tasarlanır.

Çıktı `RidgeboundReliefA.level.json`, eş recipe ve ayrı `.landscapes/` dizinidir.
Seçilen aday, bütün companion dosyalarıyla `public/layouts/` altına yeni dosyalar
olarak alınabilir. Mevcut Content Browser import/Open Level mekanizması kullanılır;
yalnız Plan blockout uygulanarak 11 konum işareti kaydedilir. Kullanıcı sahneleri,
kaydedilmemiş P1 sculpt işlemleri veya düzenlenmiş recipe bu adaya birleştirilmez.

Bu dilim **panelde Macro Terrain aşamasını tamamlamaz**. Stage Runner
dry-run/preview/apply/undo yükseklik patch entegrasyonu, erozyon/hidroloji kabulü,
görsel karakterin kullanıcı kabulü, yollar ve gerçek sürüş testi açık kalır.
Çekirdek ve adaptör testleri deterministik byte çıktısını, ortak tile kenarlarını,
korunan kaynak kodlarını ve değiştirilmiş zeminde collider/yükseklik sorgusu uyumunu
doğrular. CLI bilinmeyen adayları ve heightmap'siz rölyef isteğini reddeder.
