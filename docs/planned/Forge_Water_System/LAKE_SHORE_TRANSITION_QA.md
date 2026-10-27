# Lake kıyı/dip geçişi — çalışma ve QA kaydı

27 Ekim 2026. Kapsam: Lake-1'in geniş yeşil kıyı bandı ve keskin dip/yansıma sınırı; Lake-3'ün sığ dip okunurluğu. Authored renk/opacity/terrain/ışık verisi korunur.

| İddia / davranış | Kontrol |
|---|---|
| Gerçek dip suya değdiğinde geçiş şeffaftır | Baked depth 5 m, gerçek dip 0–5 m; perspektif ve ortografik GPU piksel testi |
| Kıyı yumuşar, sığ dip kaybolmaz | Lake-1 genel/alçak ve Lake-3 kıyı/alçak/üst/genel; aynı t=12, before/off/after PNG |
| Yansıma keskinliği azalır, yeni capture yoktur | Aynı kadrajlarda V4/yeni; draw/capture/kopya sayıları ve donanım GPU ölçümü |
| Planar kapalı ve High çalışır, sakin hareket korunur | Gerçek Low/High ve hareket kontrolleri; t=14 yakın PNG |
| Optik, editor/runtime ve kaynak ömrü korunur | Mevcut optik ve Lake Save/Reload/Play regresyonları; tam gate |

Sınır denemeleri: gerçek dip ile baked depth uyuşmazlığı; 0/5 mm su; üstten/alçak ve ortografik kamera; planar off/on. Bunlar sualtı kamera veya bütün render yollarının kabulü değildir.

## Uygulama

`engine/render-three/lakeWater.ts` içinde, V4 scene snapshot yolunda aynı görünür dip artık hem ışığın su içindeki mesafesini hem de düşey su kalınlığını belirler. Islaklık, authored opacity floor'u ve kıyıdaki yansıma geçişi bu gerçek kalınlığı kullanır. Gövde rengi, yalnız geometriye yazılmış dip derinliğinden seçilmez: shallow/deep renkleri görüş boyunca extinction ile ağırlıklandırılarak bütünleştirilir. Mevcut güneşin göl hacmine diffuse katkısı eklenir; ortak ışık/exposure/renk ayarları değiştirilmez. Bu, authored renklerden türetilmiş bir sunum yaklaşımıdır; ölçülmüş su kimyası veya tam hacimsel saçılma modeli değildir.

Planar görüntü, hedef çözünürlüğünden türetilen 9 örnekli küçük Gaussian footprint ile okunur. Yansıma gücü ve Fresnel korunur. Yeni render target, sampler veya capture eklenmez; shader texture okuması ve aritmetiği artar. Nehir ve terrain birikinti shader'ları değiştirilmez. Direct/MSAA fallback'in eski renk/derinlik hesabı korunur; planar örnekleme filtresi orada da kullanılır.

İlk deneme gerçek kalınlık ve filtreyi ekledi, ancak koyu iç sınır yeterince azalmadı. İkinci deneme yol boyunca renk bütünleştirmesini ekledi. Son deneme mevcut güneşin göl gövdesine aydınlatmasını da ekledi. Ara denemeler `.dev-server/lake-shore-v5/iteration-1`, `iteration-2`, `iteration-3` altında korunur.

## Kontroller ve kanıt

- Yeni GPU regresyonu önce başarısız oldu: baked depth 5 m, gerçek su 5 mm olduğunda, görünür örneklerde su kapalı görüntüye göre **29/255** kanal farkı. `.dev-server/lake-shore-v5-red/` trace'i korunur.
- Son shader ile perspektif ve ortografik kamerada 0 ve 5 mm için örneklenen 8-bit görüntü farkı **0**; sığ dip kontrastı korunuyor, derinlik arttığında azalıyor. Bu, bütün görüntünün fiziksel olarak aynı olduğu iddiası değildir.
- **18/18 Chrome/RTX tarayıcı testi geçti:** 10 optik testi; Lake oluşturma, seam/sculpt/undo, uzak tile hata/retry, Water System gezinmesi, Escape/taslak, eski bed metadata ve Save/Reload/Play dahil 8 Lake testi. Ham log: `.dev-server/lake-shore-v5-browser.log`.
- `npx.cmd tsc --noEmit`, `npm.cmd run test:engine` (**1.987 kontrol**) ve `npm.cmd run build:verify` geçti. Son fallback renk hesabı korunduktan sonra TypeScript ve tam `build:verify` yeniden geçti: son gate **1.996 engine kontrolü**, smoke fixture tipleri, production build, strict dist ve world-data içerir. Sayı artışı eşzamanlı başka engine/test çalışmalarını da içerir; bu su değişikliğinin eklediği test sayısı değildir. `.dev-server/lake-shore-v5-final-build.log` son tam gate kaydıdır.
- Authored kaynak/kopya **19/19 SHA-256 eşleşir**; aynı 19 kaynak önceki V4 hash'leriyle de aynıdır. `.dev-server/lake-shore-v5/scene-hashes.json`. İnceleme GET/HEAD dışını engeller; mevcut kullanıcı level/tile verisine yazılmaz.

V4 baseline `35ac2ade` shader metinleridir; eski commit'in tüm motoru yeniden kurulmuş değildir. Before/after aynı güncel terrain/geometry/ışık grafiğini ve aynı kamera/su saatini kullanır. `water-surface-v4-shaders.json` bu baseline'ı saklar. `tools/water-landscape-review.mjs --lakes-only` altı göl kamerasını ve iki GPU kadrajını seçer.

## Görsel değerlendirme ve karşılaştırmalar

Lake-1'de koyu iç havza sınırı ve kıyıdan içeri renk sıçraması azalır; yansımanın ince kenarları yumuşar, ön taraftaki sığ dip dokusu korunur. Göl daha homojen ve bulanık yeşil okunur. Alçak açıda havza geometrisi hâlâ seçilebilir; kıyı bütünüyle kusursuz sayılmaz.

Lake-3 kıyı/alçak açıda sığ dip ile sakin yansıma birlikte kalır. Üstten bakışta koyu kahverengi dip hâlâ baskındır; bu açıdaki kazanım sınırlıdır. Maksimum authored derinlik yaklaşık 0.759 m'dir; sahne derinleştirilmedi veya yeniden renklendirilmedi. Bütün Water System için koşulsuz sanat kabulü verilmez.

| Kadraj | V4 | Yeni | Su kapalı |
|---|---|---|---|
| Lake-1 genel | [Önce](../../../.dev-server/lake-shore-v5/final-stable/lake-1-before.png) | [Sonra](../../../.dev-server/lake-shore-v5/final-stable/lake-1-after.png) | [Off](../../../.dev-server/lake-shore-v5/final-stable/lake-1-off.png) |
| Lake-1 alçak | [Önce](../../../.dev-server/lake-shore-v5/final-stable/lake-1-low-before.png) | [Sonra](../../../.dev-server/lake-shore-v5/final-stable/lake-1-low-after.png) | [Off](../../../.dev-server/lake-shore-v5/final-stable/lake-1-low-off.png) |
| Lake-3 kıyı | [Önce](../../../.dev-server/lake-shore-v5/final-stable/lake-shore-before.png) | [Sonra](../../../.dev-server/lake-shore-v5/final-stable/lake-shore-after.png) | [Off](../../../.dev-server/lake-shore-v5/final-stable/lake-shore-off.png) |
| Lake-3 alçak | [Önce](../../../.dev-server/lake-shore-v5/final-stable/lake-low-before.png) | [Sonra](../../../.dev-server/lake-shore-v5/final-stable/lake-low-after.png) | [Off](../../../.dev-server/lake-shore-v5/final-stable/lake-low-off.png) |
| Lake-3 üstten | [Önce](../../../.dev-server/lake-shore-v5/final-stable/lake-top-before.png) | [Sonra](../../../.dev-server/lake-shore-v5/final-stable/lake-top-after.png) | [Off](../../../.dev-server/lake-shore-v5/final-stable/lake-top-off.png) |
| Göller genel | [Önce](../../../.dev-server/lake-shore-v5/final-stable/lake-overview-before.png) | [Sonra](../../../.dev-server/lake-shore-v5/final-stable/lake-overview-after.png) | [Off](../../../.dev-server/lake-shore-v5/final-stable/lake-overview-off.png) |

PNG/ham JSON'lar yerel `.dev-server/` kanıtlarıdır; yalnız Git checkout'u bu resimleri içermez. Önceki V4 galerisi ve raporu tarihsel kayıt olarak değiştirilmedi.

## Nihai ölçüm

İlk geniş ölçümde GL/page/console error, başarısız istek ve yazma yoktu; fakat inceleme sırasında başka oturumun `engine/world/worldMapView.ts` dosyası eklendi. Driver bütün engine/app kaynaklarını izlediği için bu koşu çıkış kodu 1 verdi. `.dev-server/lake-shore-v5/final/` korunur; nihai sabit kaynak kanıtı olarak kullanılmaz.

Son tekrar `.dev-server/lake-shore-v5/final-stable/` altında **çıkış kodu 0** ile tamamlandı: **460 engine/app ve fixture kaynağının** başlangıç/bitiş hash'leri aynı; **0 error / 0 başarısız istek / 0 yazma**, bütün kadrajlarda GL error 0. Altı kamera × before/after/off = **18 PNG** ve iki t=14 kare üretildi; altı nihai after PNG açılıp incelendi. Low/High ve hareket gerçek input ile ara deneme turunda, Off/Low/Medium ve kamera/motion keşfi nihai turda kontrol edildi. 16/16 tile ve iki Lake ready. Mevcut Mercedes invalid-JSON, PCFSoft deprecation ve sürücü shader uyarıları ham kayıtta korunur; konsol tamamen temiz ilan edilmez.

Chrome/RTX 3060/ANGLE D3D11, 1280×748, DPR 1, ACES exposure 0.2; gerçek `EXT_disjoint_timer_query_webgl2`. Her koşulda 30 warm-up + 120 geçerli GPU query; iki turda sıra ters çevrildi. Aşağıdaki aralıklar iki ayrı turun min–max değerleridir; birleştirilmiş dağılım değildir.

| Kadraj | V4 Medium p50 / p95 ms | Yeni Medium p50 / p95 ms |
|---|---|---|
| Göller genel | 10.701–22.063 / 16.165–90.647 | 13.955–23.028 / 20.327–113.432 |
| Lake-1 | 10.654–13.786 / 13.800–17.269 | 8.536–9.755 / 12.136–12.436 |

**Ölçümde ciddi drift/outlier vardır; performans kabulü verilmez.** Genel kadrajda yeni yol daha yavaşken Lake-1'de daha hızlı görünür; bunlar sabit shader maliyeti veya hızlanma iddiasına yeterli değildir. Aynı sahnenin Low/Off koşulları ve turlar arasında da kayma vardır. Tam gate GPU yakalamanın ilk bölümünde çalışıyordu; bu kayıt kontrollü tek yük performans ölçümü değildir. Ham GPU/CPU/rAF/draw/capture sonuçları `review.json`, kısa özet `.dev-server/lake-shore-v5/gpu-summary.json` içindedir.

V4 ve yeni yolda ölçülen kare başına bir scene kopyası vardır. Low planar capture 0; High genel kadrajda 120 karede 240, Lake-1'de 120 capture üretir. Medium capture sıklığı mevcut 32 ms zaman kapısına bağlıdır; dalgalanan frame sürelerinde toplam sayılar farklı olabilir. Bu fark yeni bir kaynak veya capture pass eklendiği şeklinde yorumlanmaz. Medium önerisi korunur; High varsayılan yapılmadı.

Tekrar üretimi, eski V4 raporundaki izole sunucu çalışırken:

```powershell
node tools/water-landscape-review.mjs --lakes-only --url=http://127.0.0.1:5493 --output=.dev-server/lake-shore-v5/new-run
```

Tam ışık/hava/DPR matrisi, sualtı kamera, karmaşık transparan çakışmalar, yeni göl yolunun ayrı reversed-Z kabulü ve 15 dakika leak/performance kabulü bu dar kıyı çalışmasında yapılmadı. Diffuse göl güneşi gölge haritası okumaz; bu shader'ın mevcut gölge sınırını kapatmaz. Branch, commit veya push oluşturulmadı.

Bu oturumun 5493 inceleme sunucusu ölçüm sonrasında kapatıldı; kullanıcıya ait diğer oturum/süreçlere dokunulmadı.
