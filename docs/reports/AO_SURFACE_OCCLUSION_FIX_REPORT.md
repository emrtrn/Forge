# AO yüzey kapsamı düzeltmesi — kısmi teslim

Tarih: 2026-11-01. Temel: `0bc3643d` (uzaktaki main fast-forward ile alındı; yeni branch/commit/push yok). Başlangıç çalışma ağacı temizdi. Gelen project-roots/game-entry/saveValidator/worldRecipe değişiklikleri korundu. Authored sahne, terrain, model ve malzeme verileri değiştirilmedi.

## Tanı ve uygulama

Three.js 0.184.0 GTAOPass tek bir FrontSide normal override kullanıyor; beauty malzemesinin side/map/alphaMap/alphaTest değerlerini taşımıyor. İzole fixture, arkadan görünen DoubleSide alfa kartının normal çıktısında kaybolduğunu yeniden üretiyor. Before normal görüntüsünde arkadaki kutu görülüyor; after görüntüsünde kapalı kart yarısı kutuyu örterken alfa deliği kutuyu göstermeye devam ediyor. Kamera 320×240, perspektif 45°, z=5; kart z=0, kutu z=-1. Kart ön/arka yönleri ve tamamen opak kart da piksel referanslarıyla kontrol ediliyor. Kullanıcının gerçek sahnesi yeniden üretilmiş sayılmaz.

`engine/render-three/aoSurfaceMaterials.ts`, GTAO normal geçişinde mesh malzemelerini slot bazında önbellekli MeshNormalMaterial ile geçici değiştirir. allowOverride=false, sahnenin ortak override'ının bunları ezmesini önler. Yüz yönü, kesim dokuları ve UV dönüşü, alfa eşiği/opacity, normal/bump/displacement girdileri taşınır. Three'nin instancing/skinning/morph shader yolları korunur; bunların tümü için ayrı görsel kabul yapılmadı. Blend/görünmez slotlar görünür normal duvarına dönüştürülmez. Terrain özel override ve dalgalı Lake proxy yolu korunur. Snapshot ile kompozitlenen düz Lake/River artık genel slot malzemesinin yüz yönünü kullanır; bunlar görsel su kabulü değildir.

`foliageFade.ts` fade uniform/mode bilgisini WeakMap üzerinden AO shader'ına aktarır; beauty shader patch'leri körlemesine normal shader'ına uygulanmaz. Keyfi özel onBeforeCompile deformasyonları ve alphaHash bu teslimin doğrulanmış kapsamı değildir. `postProcess.ts` normal geçişinde overrideMaterial, visibility, autoClear ve clear rengini hata halinde de geri yükler. Kaynak dispose ve pass dispose önbellek malzemelerini serbest bırakır; dokuların sahipliği devralınmaz. Her kare malzeme/shader nesnesi üretilmez; değişen malzeme girdileri varyant güncellemesi tetikler.

## Regresyonlar ve komutlar

- `tools/engine-tests.ts`: slot ayrımı, side/alphaTest değişimi, cache kimliği, depthWrite opt-out, render exception sonrası material restorasyonu, kaynak/pass dispose. Gelen testler korunarak eklenmiştir.
- `tests/smoke/fixtures/ao-surface.{html,ts}`: gerçek WebGL GTAOPass ile sabit, bağımsız fixture; production pass için ForgeGtaoPass, önce için Three'nin ortak override davranışı. Önce/sonra karşılaştırması tarihsel tüm uygulamanın snapshot'ı değil, bu küçük sahnedeki override karşılaştırmasıdır.
- `tests/smoke/ao-surface.spec.ts`: iki taraftan kapalı piksel leaf-only normal referansıyla, delik piksel rear-only referansıyla aynı olmalı. Opak kart iki örnek pikseli de örtmeli. Normal/derinlik/ham AO, AO kapalı beauty ve kompozit renk görüntüleri kaydedilir. Konsol pageerror kontrolü yapılır. Piksel referansları normal kapsamını ispatlar; ham AO değerinin her deliğinde fiziksel doğruluk veya gerçek sahne kabulü iddiası yoktur.

Çalışma dizini `/workspace/Forge`:

```sh
npx tsc --noEmit
npm run test:engine
npm run build:verify
npx playwright test --config .dev-server/playwright.cloud.config.ts ao-surface.spec.ts
```

Cloud config, mevcut onboarding'in ignored yerel dosyasıdır; `/usr/bin/chromium`, `--use-angle=swiftshader` ve tek worker kullanır. Bundled Chromium indirme alanı ağ politikasında kapalıdır. Standart browser kurulumu bulunan makinede `npx playwright test ao-surface.spec.ts` kullanılabilir; bu komut burada ayrıca çalıştırılmadı. Fixture var olan izole smoke sunucusunu kullanır; dev-server endpoint kodu değiştirilmedi.

Sonuç: TypeScript geçti; test:engine 2187 kontrol geçti. Odaklı Playwright 1 test geçti. Tam `build:verify` geçti (exit 0): import sınırları, smoke fixture/type kontrolleri, build araçları, üretim derlemesi, slow engine paketi, strict dist ve world-data kontrolleri. Son `git diff --check` temiz. Testlerin yalnız çıkış kodu değil çalıştıkları kontrol edildi.

## Görseller

Dosyalar `images/ao-surface-occlusion/` altında:

- [Önce normal](images/ao-surface-occlusion/before-normal.png), [sonra normal](images/ao-surface-occlusion/after-normal.png)
- [Önce derinlik](images/ao-surface-occlusion/before-depth.png), [sonra derinlik](images/ao-surface-occlusion/after-depth.png)
- [Önce AO](images/ao-surface-occlusion/before-ao.png), [sonra AO](images/ao-surface-occlusion/after-ao.png)
- [Önce beauty](images/ao-surface-occlusion/before-beauty.png), [sonra beauty](images/ao-surface-occlusion/after-beauty.png)
- [Önce kompozit](images/ao-surface-occlusion/before-composite.png), [sonra kompozit](images/ao-surface-occlusion/after-composite.png)

## Performans sınırı

[Ham CPU gönderim ölçümleri](images/ao-surface-occlusion/cpu-submit.json): aynı küçük fixture, üç eşlenmiş önce/sonra ölçüm; her geçişte 10 ısınma ve 60 örnek. Yalnız JavaScript render çağrısının CPU gönderim süresi ölçülür; GPU bitişi beklenmez. Alt-milisaniye sonuçlar timer çözünürlüğüne yakındır ve performans kabulü için yeterli değildir. Son render calls/triangles yalnız son fullscreen draw'a aittir, toplam frame draw sayısı değildir. Program sayısı yeni kesim varyantıyla 8'den 9'a çıkar; geometri/doku sayıları eşlenmiş turlarda sabittir. GPU timer uzantısı bulunuyor fakat GPU query ölçümü uygulanmadı. Yoğun foliage/geniş su için üçlü CPU/GPU median-p95 ve material sayısı ölçülmedi. RTX 3060 üzerinde ölçüm yapılmadı; %5 / 0.5 ms GPU p95 eşiği değerlendirilmedi. Yeni fullscreen geçiş veya render target üretim koduna eklenmedi.

## Su ve kalan kabul — tamamlanmadı

Snapshot fallback, MSAA `samples:4`, reversed depth ve editor/runtime seçimi kaynakta kontrol edildi; snapshot'ın MSAA kaynağı reddetmesi değiştirilmedi. Editor yolunun bu hataya sebep olduğu iddia edilmiyor. Genel depthWrite:false dışlaması kaldırılmadı; snapshot bulunmayan suyu zorla katı AO duvarına dönüştürmekten kaçınıldı. Dolayısıyla fallback su sızıntısı bu teslimde çözülmüş değildir.

Tek katmanlı normal/depth, aynı pikselin hem su arayüzünü hem alttaki nesnenin derinliğini taşıyamaz. Arayüzü yazmak bed AO'sunu kaybeder; yalnız bed'i yazmak final çarpımda yansıma/köpüğü de karartabilir. Bunun tüm geçirgen su durumlarında doğru olduğu bu değişiklikle kanıtlanmadı. Düz/dalgalı Lake, River, üst/alt bakış, snapshot açık/fallback, normal/MSAA, opak/geçirgen su, kıyı/köpük/kesişim matrisi için browser fixture ve görüntü kabulü eksiktir. Foliage fade/terrain/ikon overlay'lerin gerçek sahne görsel karşılaştırması da yapılmadı. Mevcut engine gate bu eksik görsel kabulün yerine geçmez.

Plan 4.C.6 sınırına göre ek render/target/kompozit kapsamı uygulanmadı. İncelenebilir sonraki seçenekler:

1. **AO'yu su kompozitinden önce uygulamak:** opak sahne AO'sunu refraction snapshot rengine katıp su/yansıma/köpüğü sonra kompozitlemek. Lake/River snapshot ve MSAA fallback yaşam döngüsü birlikte tasarlanmalı; ek opaque render gerekip gerekmediği prototipte ölçülmeli. Avantaj: alttaki AO suyun geçirgenlik hesabından doğal geçer. Maliyet/risk: render sırası ve snapshot entegrasyonu değişir, mevcut fallback ile eşdeğerlik gerekir.
2. **İki katmanlı su kompoziti:** alttaki AO ile su arayüzünün renk/geçirgenlik katkısını ayrı saklayıp sonradan birleştirmek. Yeni target ve fullscreen geçiş gerekir; tek RGBA16F 1080p hedef başına yaklaşık 15.8 MiB (MSAA ve ek derinlik hariç), geçiş başına yaklaşık 2.07 milyon piksel. Katman ayrımı daha açık, fakat bellek/bandwidth ve shader maliyeti yüksektir. Kesin hedef sayısı ve zaman maliyeti prototip olmadan verilmez.

Bunlar uygulanmış çözümler değildir. Bu kapsamı genişletmeden önce kullanıcı kararı gerekir; kaynak bu sınırlamayı planın 4.C.6 maddesidir. Yaprak düzeltmesi ve mevcut geçişteki bağımsız işler teslim edildi; su düzeltmesinin tamamı ve görsel/performans kabulü açık kalmaktadır.
