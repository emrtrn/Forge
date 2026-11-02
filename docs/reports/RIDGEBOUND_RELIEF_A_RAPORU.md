# Ridgebound Relief A — ilk makro rölyef adayı

2 Kasım 2026. **Durum: aday üretildi ve editörde açıldı; topoğrafik karakter için kullanıcı kabulü açık.** Commit/push yapılmadı.

## Sonuç ve sınır

Mevcut P1, kaynak raster ve kullanıcı sahneleri değiştirilmeden ayrı bir
`public/layouts/RidgeboundReliefA.level.json` oluşturuldu. 3072 × 1152 m,
24 tile ve 6 m örnek aralığı korundu. Kaynağa, koruma maskeleriyle sırt ve tepe
rölyefi eklendi; yan çukurlar yükseltilen sırtların arasında kalan kaynak yüzeyleridir.
Yeni dere yatağı kazısı veya erozyon simülasyonu yapılmadı.

- Genel çekirdek: `engine/worldbuilder/macroRelief.ts`.
- Ridgebound adaptörü: `tools/world/ridgeboundRelief.ts`.
- CLI: `world:ridgebound --terrain-variant relief-a`; P0/P1 varsayılanları değişmedi.
- Arşiv paket: `output/ridgebound/relief-a-20261102/`.
- Parametreler ve koruma geometrileri: paketin `import-report.json` dosyası.
- Editör: `http://127.0.0.1:5173/?editor`, aktif sahne `RidgeboundReliefA`.

Seed 20261102, genlik üst sınırı 190 m, dalga boyu 490 m ve yön -25° teknik aday
parametreleridir. 85.522 örnek değişti, koruma/sınır maskelerindeki 13.227 örnek
aynı kaldı; en büyük gerçek ek yükselti 139,49 m. V0/V1, B1 ve POI kontrol
noktalarında kot farkı sıfır. Bu maskeler onaylanmış yerleşim ayak izi veya
yol genişliği değildir.

World Builder'ın yalnız Plan blockout adımıyla 11 konum işareti kaydedildi.
R01 çizgisi plan gösterimidir; fiziksel yol, köprü, bina veya pad üretilmedi.
Panelde Macro Terrain dry-run/preview/apply/undo yükseklik entegrasyonu hâlâ açık.

## Koruma

İşlem öncesi public altında 325 mevcut level/recipe/terrain/binary dosyasının hash'i
alındı; işlem sonrası tamamı aynı kaldı. Önceki asset kayıtları korundu; manifest'e
yalnız yeni adayın level kaydı eklendi. Proje ayarlarında yalnız aktif sahne değişti.
Kaydedilmemiş P1 sculpt işlemleri okunmadı, kaydedilmedi veya yeni adaya birleştirilmedi.
Yeni aday kendi dosyalarına kaydedilir; üretim her seferinde kaynak rasterdan başlar.

## Doğrulama

- `npx.cmd tsc --noEmit`: geçti.
- Üretim adaptörü, asset denetim aracı ve yeni regresyon dosyası için ayrıca
  hedefli TypeScript proje kontrolü uygulandı (`output/ridgebound/tsconfig.relief-check.json`).
- Tam engine paketi, yavaş testler dahil: **2229 kontrol geçti**.
- Yeni regresyonlar: seed/dünya koordinatı determinizmi, maske sınırları ve bozuk
  parametre reddi; bütün korunan raster kodları; byte eşitliği; ortak tile
  kenarları; değiştirilmiş zeminde terrain sorgusu ile collider üçgeninin eşitliği.
- CLI: bilinmeyen aday ve heightmap'siz rölyef reddi; önceki hash/klasör/üzerine
  yazmama kontrolleri geçti.
- Son kodla yeniden üretim: paketin 26 üretilmiş binary/PNG dosyası ve public
  altındaki terrain dosyaları byte-exact aynı.
- Üretim build, strict runtime dist ve world-data denetimi geçti.
- Asset health geçti; var olan `SaveLoadMenu.ui.json` kayıt uyarısı baseline içinde.
- Content Browser'ın `layouts/` altında kaydettiği level kayıtlarını asset
  denetimlerinin de görebilmesi için dosya envanteri public kökünü kapsayacak şekilde
  düzeltildi. Gevşek dosya uyarılarının mevcut assets/ kapsamı korundu.
- `git diff --check`: temiz.

`build:verify` tek çalıştırmada yeşil bitmedi: ilk çalıştırma rölyef çekirdeğinin
terrain sculpt importunu mimari kurala aykırı buldu; bağımlılık kaldırıldı.
İkinci çalıştırma iki test sunucusu arasındaki isteklerden birinde `ECONNRESET`
ile kesildi. Kesilen izolasyon testi tek başına tekrarında geçti; daha önce
geçmiş diğer proje kökü kontrolleri korundu. Kalan kapılar ayrıca tamamlandı:
project-build, build, tam engine, strict dist ve world-data. Tüm kapı bileşenleri
bu şekilde doğrulandı; tek bir başarılı `build:verify` koşusu olarak sunulmaz.

Loglar `output/ridgebound/` altında `build-verify-relief-a-20261102.log`,
`project-roots-relief-retry-20261102.log`, `project-build-relief-a-20261102.log`,
`build-relief-a-20261102.log`, `engine-relief-a-20261102.log`,
`assets-relief-a-20261102.log`, `dist-relief-a-20261102.log` ve
`world-data-relief-a-20261102.log` dosyalarıdır.

## Tarayıcı ve görsel kontrol

Playwright ile görünür Chromium'da gerçek import/Open Level ve Plan blockout
dry-run/apply/save/reload akışı kullanıldı. Yeniden açılışta `11 unchanged`,
24 başarılı tile yüklemesi, sıfır console/pageerror ve sıfır HTTP hatası görüldü
(favicon isteği test oturumunda 204 yanıtlandı).

Genel görünüş, yakın görünüş ve V0 yakınında hesaplanan zeminin 3 m üstündeki
bakış incelendi. 1600 × 1000 ve 1280 × 800 pencerelerde arayüz dışına taşma yok.
Bu, araç sürüş veya GPU performans kabulü değildir. Tek renk materyal ve
6 m geometri ayrıntısı korunmuştur; malzeme/erozyon/çevre kalitesi nihai değildir.

Görüntüler: `output/ridgebound/relief-a-20261102/editor-overview.png` ve
`editor-ground-3m.png`. Aday genel görünüşte açık bırakıldı; önceki P1 dosyaları
karşılaştırma için yerinde duruyor.
