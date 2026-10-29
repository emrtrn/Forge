# Lake — iptal edilebilir, dilimlenmiş CPU hazırlığı

2026-10-29. [Önceki katman güncellemesinin](LAKE_REBUILD_TASKS_2026-10-29.md)
devamı: shore maskeleri, render normal/bounds hesabı, tekerlek sorgu indeksi ve
geometri çekirdeği küçük CPU dilimleriyle hazırlanır. İşlev uygulanmıştır;
**bütün Lake iş dilimleri ≤4 ms / genel performans kabulü kapanmamıştır.**

## Davranış ve sahiplik

- `CooperativeWork`, en çok yaklaşık 2 ms hedefli çalışma dilimleri kullanır.
  Algoritmalar 256 öğe veya daha küçük sabit gruplarda kontrol verir. Her
  hazırlık aşaması yeni bir tarayıcı görevinde başlar; aynı microtask zincirine
  maskeler, normaller ve sorgu indeksi yığılmaz. Varsa `scheduler.yield()`, yoksa
  `setTimeout(0)` kullanılır. Bu, gerçek zamanlı bir süre garantisi değildir.
- Lake ve River'ın mevcut senkron shore maskesi yolu ile yeni asenkron Lake
  yolu aynı generator algoritmasını kullanır. Texel sayısı, mesafe hesabı,
  1024/eksen ve 16M örnek sınırı korunur; bandı genişletme/çözünürlük düşürme yoktur.
- Render normalleri, bounding box ve sphere önceden hazırlanır; constructor
  artık bu büyük döngüleri tekrar çalıştırmaz. Three'nin senkron sonucu ile
  buffer/bounds eşitliği engine testinde doğrulanır.
- Tekerlek derinlik indeksi de dilimlenir. Senkron ve asenkron sorgular; ada,
  bağlı su, kuru alan ve büyük dünya origin'inde aynı sonucu verir.
- Yeni geometri/maskeler hazır olana kadar eski mesh sahnede kalır. İptal,
  level değişimi veya daha yeni rebuild, yayımlanmamış kaynakları bırakır.
  Kaynak ve görsel limitler kontrol edildikten sonra değişim await olmadan yapılır.
- Hazırlık sırasında kalite değişirse eski kalite maskeleri yayımlanmaz;
  immutable geometri sonucundan yeni sunum hazırlanır. Kalite menüsü de yeni
  maskeleri asenkron hazırlar; mevcut mesh ve normal buffer korunur.
- Maske bütçesini aşan bir replacement, açık `over-budget` tanısıyla eski
  yüzeyi korur. Korunan yüzey de sonraki kalite tavanına uyar.
- Lake/River **Calculate**, gerçek su yüzeyi hazır olana kadar kapalıdır.
  İlk River browser koşusu, yüzey henüz yokken etkin görünen düğmenin tıklamayı
  sessizce kaybettiğini gösterdi. Yüzey yayını sonrasında Details yenilenir;
  deterministik regresyon normal-texture hazırlığını bekleterek düğmenin
  hazırlık sırasında kapalı, sonrasında kullanılabilir olduğunu kontrol eder.
- Terrain snapshot'ının resident veriyi ilk await öncesi dondurma sözleşmesi,
  kayıt şeması, authored sahneler ve terrain verisi değiştirilmedi.

## Gerçek tarayıcı ölçümü

RTX 3060 / Chrome / ANGLE D3D11 / 1920×1080 / DPR 1 / Ultra / adaptif kapalı /
post-process / dört CSM. Planar kapalı; `wide` profilleri açıkça 2 m köpük ve
ıslak kıyı bandı kullanır. İzole sentetik terrain, gerçek ForgeRuntime döngüsü,
Vite geliştirme sunucusu; production paket performans kabulü değildir.

Her profil: **5 hazırlık + 30 ölçülen rebuild**, **300 AB/BA GPU çifti**.
CDP CPU örnekleyicisi kapalı. Aşağıdaki CPU dilimleri, yalnız QA'da bağlanan
`onWorkSlice` gözlemcisinin ölçümüdür; süreler cooperative beklemeyi içermez.
Tablolardaki dilim sayıları ve maksimumlar hazırlık dahil 35 rebuild'i kapsar.

| Profil | Hücre / gövde | Warm rebuild p95 | En uzun RunTask | >50 ms |
| --- | ---: | ---: | ---: | ---: |
| Küçük, caustics | 9.216 / 1 | 15,6 ms | 27,219 ms | 0 |
| Üst sınır, köpük/ıslak kıyı | 65.536 / 1 | 94,9 ms | 47,168 ms | 0 |
| 4 km dünya, köpük/ıslak kıyı | 259.200 / 8 | **363,6 ms** | **19,628 ms** | **0** |

Önceki aynı `world-wide` fixture koşusunun p95'i 536 ms ve en uzun görevi
34,472 ms idi. Bunlar ayrı koşulardaki gözlemlerdir; donanım zamanlamasının
değişkenliği ve ek QA gözlemcisi nedeniyle eşlenmiş rebuild örnekleri değildir.

Sekiz Lake profilindeki çalışma dilimleri:

| Aşama | Dilim | p95 | Maksimum | >4 ms |
| --- | ---: | ---: | ---: | ---: |
| Bağlı dolum/kırpma/geometri | 2.959 | 2,1 ms | 7,3 ms | 7 |
| Render normal/bounds | 285 | 1,6 ms | 2,0 ms | 0 |
| Tekerlek sorgu indeksi | 280 | 0,9 ms | 1,6 ms | 0 |
| Köpük shore maskesi | 754 | 2,0 ms | 2,8 ms | 0 |
| Islak kıyı maskesi | 750 | 2,0 ms | 2,7 ms | 0 |

Üst sınır tek Lake'te geometri aşamasında **3** aykırı dilim / maksimum
**5,8 ms**; diğer hazırlık aşamalarında >4 ms yok. Küçük Lake'in izlenen
bütün dilimleri ≤3,6 ms. Bu sonuçlar geometri çekirdeğinin kesin ≤4 ms
kabulünü kapatmaz. RunTask; render/upload, snapshot, yayın ve GC gibi diğer
işleri de kapsar. Fonksiyon CPU dilimleri ile bütün görev süreleri karıştırılmaz.

GPU ek p95: küçük **0,948 ms**, üst sınır wide **1,817 ms**, world-wide
**1,964 ms**. Bu iş GPU shader optimizasyonu değildir. Terrain-only kontrol,
cold açılış, planar ve kalite matrisi koşulmadığından genel GPU kabulü verilmez.

Bütün gövdeler ready; console/page ve GL hatası yok. Her profilde son kaynak
sayıları/buffer byte'ı hazırlık sonrasıyla aynı. World-wide: **32 texture,
12 geometri, 8.230.720 Lake buffer byte**. Transient CPU/GPU tepe belleği bu
kaynak sayımıyla kabul edilmiş sayılmaz. Sekiz göllü dünya görüntüsü ayrıca
incelendi; yakın kıyı ve editör kontrolleri browser regresyonlarıyla doğrulanır.

## Doğrulama

- Son `npx.cmd tsc --noEmit` ve smoke TypeScript kontrolü geçti.
- Yeni test dosyası ayrıca Vite/Node tipleriyle TypeScript kontrolünden geçti.
- Son `npm.cmd run build:verify`: **2.120 engine kontrolü**, import sınırları,
  smoke/content/UI tipleri, release araçları, production build, strict dist ve
  world-data geçti. Önceki World Builder test engeli bu koşuda yoktur; o
  eşzamanlı çalışma bu su değişikliğinin kapsamında düzenlenmedi.
- Beş yeni engine regresyonu: görev sınırları/deadline/iptal; senkron-asenkron
  maske/normal/bounds/sorgu eşitliği; staged mask sırasında yeni rebuild ile
  eski mesh'in korunması ve tek dispose; kalite değişiminde eski maskenin
  yayımlanmaması; mask bütçesi reddinde eski yüzeyin kaliteye uyması.
- Son headed Playwright koşusu **6/6 geçti**: Quality menüsü/canlı Play;
  Lake Calculate/Recalculate/undo/binary Save/Reload/Play; River kontrollü
  geciktirilmiş hazırlık ve otomatik köpük/caustics Save/Reload/Play; Lake kıyı
  köpüğü; bağlı su altı zemini/ıslak kıyı; seam sculpt/seed/bounds ve undo.
  İlk koşudaki **4 geçti / 1 River timeout** kabul sayılmadı; yukarıdaki hazır
  olma düzeltmesi ve gecikme regresyonu sonrası altı senaryo son kaynakta geçti.

## Kanıt ve tekrar

- `.dev-server/lake-slices-final/report.json`: kaynak hash'leri, GPU ham çiftleri,
  rebuild süreleri, aşama dilimleri ve kaynak ömrü.
- Aynı dizinde `*.trace.json`, `*.memory.json` ve profil görüntüleri.
- `.dev-server/lake-slices-ui-final-gate.log` son tam kapıdır;
  `lake-slices-ui-types.log`, `lake-slices-final-types.log`,
  `lake-slices-smoke-types.log`, `lake-slices-test-types.log`,
  `lake-slices-engine.log`, `lake-slices-final-browser.log` ve
  `lake-slices-final-browser/` son kanıtlardır. İlk koşunun `lake-slices-browser/`
  trace'i, River readiness hatasının tarihsel kanıtı olarak korunur.
- Performans ölçümünden sonra eklenen değişiklik editör Calculate hazır olma
  kontrolüdür; runtime ölçüm raporundaki bütün kaynak hash'leri son engine/QA
  dosyalarıyla yeniden karşılaştırılıp aynı bulundu.
- `npm.cmd run perf:lake`; bu dar koşu için
  `LAKE_PERF_CASES=small-caustics,maximum-wide,world-wide`,
  `LAKE_PERF_MODES=lake`, `LAKE_PERF_PAIRS=300`, `LAKE_PERF_REBUILDS=35`,
  `LAKE_PERF_COLD=0`, `LAKE_PERF_CPU_PROFILE=0`. Cold 0 olduğu için ana
  raporun toplu kabulü bilinçli olarak açık kalır.

## Kalan sınır

Geometri çekirdeğinin aykırı CPU dilimleri, snapshot ve yayın/render/upload
görevleri, transient bellek, cold/production ve kalite matrisi ayrı açık.
Geometri aykırı değerlerinin allocation/GC veya hesap kuantumundan hangisine
ait olduğu bu örnekleyicisiz koşuyla kanıtlanmadı. Gerekirse bu dilimler ayrı
trace işaretleriyle ayrılmalı; çözünürlük kaybı olmadan daha küçük kuantum veya
worker değerlendirilmelidir.

Sonraki bağımsız Water Body işi, büyük alanda 1 m dar köpük bandının mevcut
1024 texel/eksen sınırına uygun yaklaşımının tasarlanıp uygulanmasıdır. Bu
teslim maske bütçesini değiştirmez; Puddle/Ocean veya yeni fizik içermez.
Commit/push yapılmadı.
