# Ridgebound metrik master → World Builder / P0a

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
