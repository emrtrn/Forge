# Lake rebuild — uzun görevlerin kaynağı ve katman güncellemesi

2026-10-29. Water Body listesindeki ilk performans işi için ilk düzeltme
tamamlandı. Genel Lake performans kabulü ve her Lake iş diliminin ≤4 ms olması
henüz tamamlanmış sayılmaz.

## Bulgu ve değişiklik

İzole 4096×4096 m / 256 tile / sekiz Lake / 259.200 hücre dünyasında gerçek
Chrome ve RTX 3060/D3D11 kullanıldı. 1920×1080, DPR 1, Ultra, adaptif kapalı,
post-process ve dört CSM; köpük/ıslak kıyı bandı açıkça 2 m, planar kapalı.
Bu sentetik dünya authored sahne yoğunluğunun kabulü değildir.

CDP CPU örnekleri, uzun render görevlerindeki başlıca işi
`updateTerrainShoreWetness`, `updateTerrainCaustics` ve `texSubImage3D` olarak
ayırdı. Önceki kod her göl değişiminde bütün ortak doku dizisini yeniden
paketliyor, dispose ediyor ve GPU'ya yüklüyordu. Bir 97,274 ms görevde 160
örneğin 104'ü ıslak kıyı paketlemesi, 21'i texture upload, 18'i caustics
paketlemesindeydi. Bunlar örnek sayılarıdır; kesin fonksiyon süreleri değildir.

- Göl kimliğine göre kararlı katman sırası kullanılır; uniform sırası aynıdır.
- Gövde sayısı aynı kaldığında texture ve CPU backing buffer korunur.
  Yalnız değişen gövdenin katmanı paketlenir ve `addLayerUpdate` ile yüklenir.
- Gövde sayısı değişince gereken boyutta yeniden allocation yapılır; son
  kaynak kaldırıldığında texture bırakılır. Sabit sekiz katman rezervasyonu yoktur.
- Lake güncellemesi, değişmeyen River geometri atlasını yeniden üretmez.
- Sıradan render geçişleri katman listelerini yeniden sıralamaz/paketlemez.
- Yeni scene/save alanı, terrain değişikliği veya shader görünüm değişikliği yoktur.

## Ölçüm

| Koşu | Warm rebuild p95 | Ana thread sınırı |
| --- | ---: | --- |
| Önce, CPU örnekleyici açık | 1.117,1 ms | Maske paketleme/upload ağırlıklı uzun görevler |
| Sonra, aynı CPU örnekleyici açık | 761,1 ms | Kalan baskın işler shore maskesi, geometri/presentation hazırlığı |
| Son kod, örnekleyici kapalı | **536,0 ms** | En uzun görev **34,472 ms**; **0 adet >50 ms** |

İlk iki koşu aynı istenen 100 µs CPU örnekleme aralığı ve 5 hazırlık + 30
ölçülen rebuild kullanır. Örnekleyici ek yük oluşturur; bu karşılaştırma genel
performans kabulü değildir. Üçüncü koşu ayrı, örnekleyicisiz sonuçtur; önceki
737 ms tarihsel ölçümle kontrollü optimizasyon karşılaştırması olarak sunulmaz.
Bu son koşuda rebuild işaretleri başlangıç/son profiler protokol görevlerini
dışarıda tutar ve son gövdenin render/upload karesini de kapsar. Sınırı kesen
bir RunTask bütün süresiyle sayılır.

Son koşuda 300 AB/BA GPU çiftinin ek p95'i **1,594 ms**. Bu çok gövdeli
profil değeridir; tek Lake için 1 ms hedefinin kabulü veya GPU optimizasyonu
iddiası değildir. Kontrol profilleri ve cold açılış bu dar koşuda yoktur.

35 rebuild'de son kaynaklar hazırlık sonrasıyla aynı: **32 texture, 12 geometri,
8.230.720 Lake buffer byte**. Bütün sekiz Lake ready, console/page/GL hatası yok.
Bu kaynak sayımı transient CPU/GPU tepe belleğinin kabulü değildir.

## Doğrulama

- Son `npx.cmd tsc --noEmit` geçti; smoke TypeScript kontrolü de geçti.
- Su kapsamındaki engine koşusu **52 geçti / 2.060 atlandı**; tam gate değildir.
  Yeni regresyonlar katman/buffer kimliğini, yalnız değişen katmanın upload'ını,
  kesin bağlı yüz bayraklarını, kararlı uniform sırasını, kaldırmada compact ve
  dispose davranışını, Lake değişiminde River atlasının korunmasını sınar.
- CPU analizinin üç Node testi geçti: monotonik saat eşleştirme, örnek boşlukları,
  parent stack'leri ve profiler başlatma/bitirme görevlerinin dışlanması.
- `build:verify`, eşzamanlı değişen World Builder settlement testindeki
  `['wb-site-v1']` / `[]` beklentisinde durdu; tam gate geçti sayılmadı. Bu koşuda
  production build tamamlandı; sonraki strict dist/world-data adımlarına ulaşılmadı.
  World Builder dosyaları bu su işinin kapsamında düzenlenmedi.
- Headed Playwright **3/3 geçti**: Lake gerçek kıyı/ada köpüğü, bağlı su altı
  zeminini de kapsayan ıslak kıyı ve River otomatik geometri köpüğü/caustics.
  Toggle, undo, Save/Reload/Play ve animasyon kontrolleri mevcut senaryolarla
  doğrulandı. Sekiz göllü dünya görüntüsü de incelendi; sekiz yüzey görünür.

## Kanıtlar ve tekrar

- `.dev-server/lake-task-baseline/`: değişiklik öncesi CPU profile, trace ve rapor.
- `.dev-server/lake-task-after/`: katman güncellemesi sonrası CPU profile/trace.
- `.dev-server/lake-task-final/`: örnekleyicisiz son kaynak, 300 GPU çifti,
  rebuild işaretli trace, bellek örnekleri, source hash'leri ve dünya görüntüsü.
- `.dev-server/lake-task-final-engine.log`, `lake-task-analysis-tests.log`,
  `lake-task-final-types.log`, `lake-task-smoke-types.log`,
  `lake-task-build-verify.log`, `lake-task-browser.log`.
- Mevcut `npm.cmd run perf:lake` aracında `LAKE_PERF_CPU_PROFILE=1`, yalnız
  rebuild bölümüne CDP CPU örnekleyicisi ekler. İlgili `.cpuprofile` ve trace
  korelasyonu rapora yazılır. Böyle bir koşu kabul örnekleri yeterli sayılmaz.
  Örnekleyicisiz tekrar için değişken kapatılmalıdır.

## Kalan dar iş

Bu koşuda >50 ms gözlenmemesine rağmen **526 görev >4 ms**. Shore maskelerinin
eşzamanlı üretimi, `LakeWaterObject` normal/bounds hazırlığı, `LakeSurfaceQuery`
kurulumu ve geometri işinin sonunda aynı microtask zincirinde biriken yayın
adımları hâlâ dilimleme adaylarıdır. Önce bu işler ayrı zaman pencerelerinde
ölçülmeli; iptal/revision ve geçerli eski yüzeyi koruma davranışı bozulmadan
cooperative staging veya worker uygulanmalıdır. Rastgele çözünürlük düşürülmez.

Ardından büyük alanda 1 m dar köpük bandının 1024 texel sınırı; CPU/GPU transient
tepe, kalite profili/production/cold ve undo/reload ömrü kabulü gelir. Puddle,
River/Lake birleşimleri ve Ocean bu teslimde uygulanmadı. Commit/push yoktur.
