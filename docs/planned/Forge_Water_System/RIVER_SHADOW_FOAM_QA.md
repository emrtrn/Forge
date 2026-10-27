# Nehir güneş gölgesi ve yerel köpük — 27 Ekim 2026

Başlangıç HEAD `e5c1fa40`, çalışma ağacı temizdi. `ab1498e2` göl çalışması korundu. Oturum sırasında başka çalışmanın `252f3843` heightmap import commit'i geldi ve korundu. Branch, commit, push veya authored veri yazımı yapılmadı.

## Teşhis ve uygulama

Nehirde `waterSurfaceLight` güneş highlight'ı ve ayrı `waterSunGlint` gölgeyi okumuyordu. İkisi aynı `riverSunVisibility` ile azaltılır. `riverSunShadow.ts`, Three'nin `UniformsLib.lights`, shadow chunk, mevcut directional map/matrix/sampler ve depth-mode sözleşmesini kullanır. `SunCascadeShadow` mevcut state'e salt okunur erişim verir. İlk uygun cascade, %5 kenar karışımı ve mesafe fade'i mevcut renderer kurallarını izler. Harita/uygun güneş yoksa görünürlük 1 olur; environment/IBL çarpılmaz.

Sığ kıyı köpüğünün kapsaması/breakup eşiği kontrollü azaltıldı. Point-stamp'in periyodik halkaları zamanla taşınan kopuk parçalara dönüştü; local alpha sınırlandı, köpük rengi gölgeyle aydınlanır. Akış teğetleri, düzensiz normaller, rapidness, animasyon ve kullanıcı uniform'ları korundu. Bu gerçek engel hidrodinamiği değildir. Yeni planar, capture, render target veya sahne render'ı yok.

Ortak `waterEnvironment.ts` yalnız visibility overload'larını ekler. Gölün eski imzası 1 ile çağırır. `waterOptics.ts`, göl ve terrain birikinti shader'ları değişmez.

## QA ve sonuçlar

| İddia / kontrol | Sonuç |
|---|---|
| Tek harita / 3 cascade; yüzey highlight ve glint ayrı | Yalnız örneklenen suyu örtmeyen gölge engeli açılır/kapanır. Gölgeli bir örnekte ortalama RGB farkı 6.59/255 ve 25.04/255; güneşli örnekler 0 |
| IBL izolasyonu / shadow kapalı fallback | Piksel farkı 0; başka nedenle sahnenin kararması başarı sayılmadı |
| Haritasız güneş, kamera katmanı, cascade fade/deactivate | Yeni engine regresyonu geçti |
| Yerel stamp: opacity 0/0.92, üstten/alçak, t=12/14 | Kapsama ve hareket var; stamp dışı örnekler aynı |
| Akış, köpük, spline Y, undo, Save/Reload/runtime | Üç nehir editor/runtime testi geçti |
| Göl, alpha enerjisi, Sphere Capture, Off/Low, ortografik/dönüştürülmüş yüzey | Mevcut optik regresyonlar geçti |
| Authored level/global/terrain/16 tile | Kaynak/kopya 19/19 SHA-256 eşleşir; önceki göl kaydından beri aynı |

`npx.cmd tsc --noEmit`, smoke TypeScript ve `npm.cmd run test:engine` (**1.999 kontrol**) geçti. `npm.cmd run build:verify` **çıkış 0**: production build, slow engine (1.999), fixture/content/UI tipleri, strict dist/world-data dahil. [Engine](../../../.dev-server/river-shadow/engine-final.log), [tam gate](../../../.dev-server/river-shadow/build-stable.log).

Son optik koşu **12/12 geçti**: [log](../../../.dev-server/river-shadow/optics-final.log). Aynı production shader ile **3/3 nehir editor/runtime** geçti: [log](../../../.dev-server/river-shadow/browser-final.log). Bu önceki birleşik koşuda yalnız stamp probu başarısızdı; o koşu 15/15 diye sunulmaz. Doğrulanmış toplam **12 optik + 3 editor/runtime = 15 test**. İlk GLSL döngü/değişken hataları düzeltildi; alçak stamp probu su düzleminden gerçek +2.5 cm stamp düzlemine taşındı, eşik gevşetilmedi.

## Açılan görüntüler ve sınırlar

İlk t=12 kaydı uygulamadan önce alındı. Nihai A/B aynı güncel geometri, ışık, PMREM, kamera ve su saatinde eski/yeni shader metniyle yapılır; eski commit'in bütün motoru kurulmuş sayılmaz. Son PNG turunda ve GPU turunda 462 kaynak başlangıç/bitiş hash'i aynı; 0 error/başarısız istek/yazma, GL error 0. İlk baseline ile son GPU kaydı arasında engine/app farkları yalnız bu su çalışmasının dört modülü ve review fixture'ıdır. [Görsel ham kayıt](../../../.dev-server/river-shadow/final-images/review.json), [GPU ham kayıt](../../../.dev-server/river-shadow/final-stable/review.json), [authored hash](../../../.dev-server/river-shadow/scene-hashes.json).

| Kadraj | Önce | Sonra | Su kapalı |
|---|---|---|---|
| Üst bölüm | [PNG](../../../.dev-server/river-shadow/final-images/river-upper-before.png) | [PNG](../../../.dev-server/river-shadow/final-images/river-upper-after.png) | [PNG](../../../.dev-server/river-shadow/final-images/river-upper-off.png) |
| Kıyı | [PNG](../../../.dev-server/river-shadow/final-images/river-bank-before.png) | [PNG](../../../.dev-server/river-shadow/final-images/river-bank-after.png) | [PNG](../../../.dev-server/river-shadow/final-images/river-bank-off.png) |
| Alt nehir | [PNG](../../../.dev-server/river-shadow/final-images/river-flat-before.png) | [PNG](../../../.dev-server/river-shadow/final-images/river-flat-after.png) | [PNG](../../../.dev-server/river-shadow/final-images/river-flat-off.png) |
| Üstten | [PNG](../../../.dev-server/river-shadow/final-images/river-top-before.png) | [PNG](../../../.dev-server/river-shadow/final-images/river-top-after.png) | [PNG](../../../.dev-server/river-shadow/final-images/river-top-off.png) |
| Kaya alçak | [PNG](../../../.dev-server/river-shadow/final-images/river-rock-low-before.png) | [PNG](../../../.dev-server/river-shadow/final-images/river-rock-low-after.png) | [PNG](../../../.dev-server/river-shadow/final-images/river-rock-low-off.png) |

PNG'ler açılarak incelendi. Mevcut kadrajlarda yönlü yüzey/yerel hareket korunur; yeni düzenli beyaz bant veya ribbon sınırını izleyen köpük konturu görülmedi. Authored kadrajlarda güneş farkı küçük; genel nehir sanat kabulü ilan edilmez. [Point-stamp önce](../../../.dev-server/river-shadow/controls/stamp-top-before.png)/[sonra](../../../.dev-server/river-shadow/controls/stamp-top-after.png), alçak karşılıkları ve t=14 kareleri de açıldı: halka daha sönük kopuk parçalar olur. Sentetik fixture authored sahneye eklenmedi. Gerçek kamera/Off/Low/Medium/motion girdileriyle 30 saniye keşif yapıldı.

**Alt nehirdeki geniş beyaz kaya halkası nehir Off iken de kalır.** Authored kayıt bu nehirde point-stamp içermiyor. Halkanın tamamı nehir köpüğü diye teşhis edilmez veya giderildiği iddia edilmez. Nehir kapalıyken kalan dip/sahne parıltısı açık sınırdır; terrain malzemesi, ışık ve exposure korunur.

## Donanım ölçümü

Chrome/RTX 3060/ANGLE D3D11; 1280×748, DPR 1, ACES exposure 0.2. Gerçek composer sınırı, 30 warm-up + 120 geçerli GPU query/koşul; ikinci tur sırası ters. Diğer test/build işleri önce bitti. Aralıklar iki turun min–max'ıdır.

| Kadraj | Önce GPU p50 / p95 ms | Sonra GPU p50 / p95 ms | Aynı tur p50 farkı |
|---|---|---|---|
| Kıyı | 5.676–5.730 / 7.600–7.641 | 5.553–5.575 / 7.050–7.114 | -0.177 / -0.101 ms |
| Alt nehir | 6.066–6.134 / 7.634–7.672 | 6.163–6.211 / 7.629–7.774 | +0.097 / +0.077 ms |

Önce/sonra draw sayısı **61/61** ve **88/88**; **capture=0, scene copy=0**. Kadrajların ters yönlü farkları ve Off tur kayması nedeniyle sabit maliyet, hızlanma veya FPS garantisi çıkarılmaz. [GPU/CPU/rAF/sayaç özeti](../../../.dev-server/river-shadow/gpu-summary.json).

Lake-3 üst görünüm, genel GPU kabulü, uzun süreli leak/performance, alternatif göl yolları, birikinti görünümü ve tam reversed-Z/ışık/hava matrisi açık kalır. Puddle/Ocean çalışmasına geçilmedi. PNG/ham JSON'lar yerel `.dev-server/` kanıtlarıdır; yalnız Git checkout'u bunları içermez.
