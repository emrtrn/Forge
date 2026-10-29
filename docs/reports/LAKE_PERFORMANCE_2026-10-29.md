# Lake performans ölçümü — 2026-10-29

Bu tablolar aynı gün yapılan [Lake kalite bağlantısı](LAKE_QUALITY_2026-10-29.md)
öncesindeki kaynak içindir; yeni kalite kodunun yeniden ölçülmüş performansı değildir.

**Sonuç: ölçüm altyapısı ve gerçek donanım koşusu tamamlandı; Lake performans kabulü açık.**
4 km / sekiz gövde profilleri ölçüldü. Ana thread için ≤4 ms kanıtı yok;
tam özellikli rebuild sırasında >50 ms görevler gözlendi. 64 MiB Lake ek CPU
ve 32 MiB GPU tepe bütçesi bu örneklenmiş toplam tarayıcı belleğiyle kapanmaz.
Varsayılan dar köpük bandı büyük alanlarda ayrıca mevcut maske sınırına takılır.

Kaynak tabanı: `f2666926cf6a00f5abcb23413fcd660a93917ab4`. Bu iş yalnız QA
fixture, ölçüm araçları, npm komutu ve rapor/plan ekledi; engine shader'ında
optimizasyon yapılmadı, authored sahne/terrain dosyasına yazılmadı.

## Donanım ve ölçüm koşulları

- 11th Gen Intel(R) Core(TM) i5-11400F @ 2.60GHz; Windows; Chrome 156.0.8078.73.
- RTX 3060, ANGLE D3D11; NVIDIA driver 32.0.16.1060.
  Donanım adı ve GPU timer her profilde denetlendi; SwiftShader kabul edilmez.
- Gerçek Chrome penceresi ve DOM fullscreen birlikte etkin; viewport ve drawing
  buffer **1920×1080**, DPR 1. Ultra, renderScale 1, dört CSM, adaptive kapalı.
- Gerçek `ForgeRuntime` döngüsü ve mevcut post-process kullanıldı. Vite geliştirme
  sunucusudur; production paketinin performans kabulü değildir.
- GPU: 60 hazırlık karesi + **300 A/B çifti**, bir görüntü karesinde bir örnek;
  AB/BA sırası dönüşür. GPU sorgusu post-process, gölge ve iç capture'ları kapsar;
  query sonunda `gl.flush`; disjoint/eksik/başkasının sahip olduğu query kabul edilmez.
  Zamanlı bölgede readPixels yoktur. Dünya varyantında sabit yörünge, çift başına
  aynı kamera konumu kullanılır. Komşu karelerdeki gölge/capture zamanlaması ve
  GPU saat değişimi çift farklarına gürültü katabilir.
- Küçük fixture: 96×96 m çalışma alanı, 9.216 hücre, spacing 1; üst sınır:
  65.536 hücre, spacing 1. Dünya: **4096×4096 m**, 256 tile, q=128, spacing 2;
  **sekiz Lake × 32.400 = 259.200 hücre**. Bu sentetik terrain dünyası, bütün
  authored sahne/foliage/araç yoğunluklarının kabulü değildir.

## GPU — tüm Lake etkilerinin birlikte ek maliyeti

Bu ek koşu `lake` modunu kullanır: aynı render'da gövdeler ve bağlı etkiler
birlikte kapalı/açık. Böylece yüzey ve caustics p95'leri toplanarak bir toplam
uydurulmaz. Yansıma açık profil ayrıca raporlanır. Birimler ms; capture sütunu
bir örnekte görülen en yüksek planar capture sayısıdır.

| Profil | Baseline GPU p95 | Açık GPU p95 | Çift farkı p95 | Ek draw p95 | Capture max |
| --- | ---: | ---: | ---: | ---: | ---: |
| small-none | 1,275 | 1,272 | 0,034 | 0 | 0 |
| small-caustics | 1,594 | 1,859 | 0,551 | 1 | 0 |
| maximum-caustics | 1,248 | 2,184 | 0,983 | 3 | 0 |
| world-none | 1,355 | 1,367 | 0,038 | 0 | 0 |
| world-caustics | 1,641 | 2,869 | 1,839 | 8 | 0 |
| world-wide | 1,8 | 3,324 | 2,208 | 8 | 0 |
| world-planarwide | 1,802 | 3,413 | 2,222 | 11 | 1 |

`none` kontrollerinde gövde yoktur; etiket değiştirmek görüntüyü değiştirmez.
Sıfır maliyetli kontrolün çift p95 farkı dahi sıfır değildir. Otomatik raporun
0,25 ms kontrol eşiği aşılırsa sonuç gürültüsüz bir ≤1 ms kabulü diye sunulmaz.
Küçük fixture için gözlenen değer, çok gövdeli profilin kabulü yerine geçmez.

İlk tam koşudaki bileşen ayrımı:

| Profil | Yüzey ek GPU p95 | Caustics ek GPU p95 |
| --- | ---: | ---: |
| small-caustics | 0,442 | 0,065 |
| maximum-caustics | 0,855 | 0,329 |
| world-caustics | 1,63 | 1,28 |
| world-wide | 1,576 | 1,186 |
| world-planarwide | 1,454 | 0,461 |

**Eski 3,719 ms kaydı korunur.** 27 Ekim pilotu 704×752 editör canvas'ında,
doğrudan renderer ile 5 warm-up + 300 çift kullanmıştı. Bu koşu farklı kamera,
post-process, kaynak sürümü ve query teslimi kullanır. Önce/sonra optimizasyon
karşılaştırması değildir; eski ≤1 ms başarısızlığı geriye dönük silinmedi.

## Rebuild, ana thread ve açılış

Her ölçümde **5 hazırlık + 30 ölçülen rebuild** var. Toplam rebuild süresi
cooperative beklemeleri, mevcut normal/maske/obje oluşturmayı da kapsar;
debounce yoktur. Dünyada sekiz gövde birlikte yeniden değerlendirilir.

| Profil | Rebuild p95 ms | Ana thread görev p95 ms | En uzun görev ms | >50 ms görev |
| --- | ---: | ---: | ---: | ---: |
| small-caustics | 12,9 | 16,286 | 29,911 | 0 |
| maximum-caustics | 131,5 | 3,118 | 43,61 | 0 |
| world-caustics | 417,8 | 3,187 | 17,438 | 0 |
| world-wide | 736,7 | 3,183 | 65,994 | 2 |
| world-planarwide | 738,1 | 3,165 | 63,57 | 2 |

Ana thread, DevTools `CrRendererMain / RunTask` olaylarıdır. Tablo bütün
rebuild penceresini, ilk beş hazırlık dahil, kapsar; render, GC ve DevTools
örnekleme işleri de vardır. Bu, Lake'e özel her iş diliminin ölçümü değildir.
Dolayısıyla p95 düşük olsa bile **her Lake dilimi ≤4 ms** kabulü kapanmaz;
>50 ms görevlerin kaynak fonksiyonuna ayrılması sonraki iştir.

Ham trace incelemesinde 65,994 / 63,570 ms görevler `FireAnimationFrame` ve
`RuntimeSceneApp.ts` içindeki `loop` çağrısı altında yer alıyor. Bunlar doğrudan
bir geometri-build dilimi diye etiketlenemez; rebuild sırasında render/upload
yolu da profillenmelidir. V8'in arka plan derleme görevleri ana thread tablosuna
katılmadı. Bu trace ayrıntılı JS alt fonksiyon örneklemesi içermiyor.

Cache kapalı **10 ayrı context/açılış**; 1440×900 referans viewport. Aşağıdaki
navigasyon başlangıcından ready'ye süre, runtime fabrikası öncesi modül/HTTP
beklemelerini de içerir. Level süresi bu toplamın içindeki ayrı penceredir.
Ready: level/geometry yüklenmiş; ilk GPU karesinin sunumuna ait ölçüm değildir.

| Profil | Level yükleme p95 ms | Navigasyon → ready p95 ms |
| --- | ---: | ---: |
| small-caustics | 574,3 | 1.057,6 |
| maximum-caustics | 722,6 | 1.147,4 |
| world-caustics | 1.164,6 | 1.623,2 |

Tam navigasyonun ≤1 s olması ayrıca değerlendirilir; yalnız level süresi
üzerinden cold kabulü verilmez. IO/decode saf alt dilimleri bu raporda ayrılmadı.

## Tarayıcı tepe belleği ve tekrar ömrü

Rebuild penceresinde gözlenen tepe değerler, **MiB**:

| Profil | V8 used heap | ArrayBuffer/backing storage | Chrome private toplam | Chrome working set toplam |
| --- | ---: | ---: | ---: | ---: |
| small-caustics | 45,76 | 68,973 | 1.078,738 | 834,949 |
| maximum-caustics | 56,118 | 166,532 | 1.214,879 | 920,758 |
| world-caustics | 64,489 | 207,416 | 1.475,887 | 1.178,738 |
| world-wide | 65,9 | 265,488 | 1.552,414 | 1.254,758 |
| world-planarwide | 63,805 | 254,911 | 1.587,277 | 1.259,285 |

Heap CDP ile 100 ms, yalnız bu Chrome'un PID kümesinin process belleği Windows'ta
250 ms arayla örneklendi. Private bytes ile working set farklı ölçülerdir;
working set toplamı paylaşılan sayfaları tekrar sayabilir. Sütun tepe değerleri
aynı anda oluşmak zorunda değildir ve toplanmaz. Örnekler anlık gerçek tepenin
alt sınırıdır; boot'un her anını veya GPU VRAM tepesini içermez. Normal
haritaları/post-process/terrain ve GC bekleyen buffer'lar da dahildir.

35 rebuild sonunda render kaynak sayıları ve Lake buffer byte'ı hazırlık sonrası
seviyeyle karşılaştırıldı: small-caustics: aynı; maximum-caustics: aynı; world-caustics: aynı; world-wide: aynı; world-planarwide: aynı.
Bu olumlu kaynak ömrü kontrolü; 20 undo/reload/level-travel döngüsünün veya
GC sonrası heap leak incelemesinin yerine geçmez. **Lake'e ait ek transient ≤64 MiB
ve GPU ≤32 MiB henüz kanıtlanmadı.**

## Büyük alanda görünüm bütçesi

`world-all` ve `world-planar`, 360 m hesap genişliğiyle varsayılan 1 m köpük
bandını kullanınca 1440 texel ister; mevcut 1024/eksen sınırı gövdeleri
`over-budget` yapar. Bu iki profil için GPU kabul değeri üretilmedi.
`world-wide` ve `world-planarwide` yalnız test varyantlarıdır: köpük ve ıslak
kıyı bandı **2 m**, bütün sekiz Lake hazır. Yeni göl preset'i/renderer sınırları
değiştirilmedi. Planar varyantı aynı kot/grup/medium kalitesini paylaşır.
Geometri köpüğü bake'i, teker temasıyla dolu ripple bütçesi ve ayrı kotlardaki
çoklu yansıma grupları bu fixture'da yoktur.

## Kanıt ve tekrar

- Kompakt sayısal kayıt: [LAKE_PERFORMANCE_2026-10-29.json](LAKE_PERFORMANCE_2026-10-29.json).
- Ham sorgular, Chrome trace, 100/250 ms bellek örnekleri ve ekran görüntüleri:
  `.dev-server/lake-perf-final-2026-10-29/` ve `.dev-server/lake-perf-combined-2026-10-29/`. Önceki diagnostic/acceptance/effects klasörleri
  bu son tabloların yerine kullanılmaz.
- [Küçük Lake görüntüsü](images/lake-performance-small-2026-10-29.png),
  [sekiz Lake görüntüsü](images/lake-performance-world-2026-10-29.png): boyut,
  gövde görünürlüğü ve görüntü hataları için incelendi. Başarılı profillerde
  console/page ve GL hatası yoktu; başarısız profillerin nedeni yukarıda kayıtlıdır.
- `npm.cmd run perf:lake`; isteğe bağlı `LAKE_PERF_CASES`,
  `LAKE_PERF_MODES=lake`, `LAKE_PERF_PORT`, `LAKE_PERF_OUTPUT`.
  Kısaltılmış örnek sayısı kabulü kapatmaz. Ayrı port, izole kopya ve cleanup
  kullanılır; mevcut editor sunucusuna veya authored veriye yazılmaz.
- TypeScript: `npx.cmd tsc --noEmit`,
  `npx.cmd tsc --noEmit -p tsconfig.smoke.json`,
  `npx.cmd tsc --noEmit -p tools/perf/tsconfig.lake.json` geçti.
  Engine/runtime üretim kodu değişmediği için tam build/engine gate tekrarlanmadı.
  Commit/push yoktur.

Sonraki dar iş: rebuild trace'lerinde >4 / >50 ms görevleri fonksiyonlarına
ayır; maske/normal/upload ve allocation aşamalarını hedefle; Lake buffer'larını
terrain/render baseline'ından ayırarak tepe bellek kabulünü tekrarla. Aynı
profil ve kontrol gürültüsüyle GPU tekrarı, cold tam navigasyon, undo/reload
ömür testi ve production runtime ölçümü tamamlanmadan ana kabul kapatılmaz.
