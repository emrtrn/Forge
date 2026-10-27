# Nehir dibi parıltısı — 27 Ekim 2026

Başlangıç ve bitiş HEAD `f9aa05ff`; başlangıç çalışma ağacı/staged alanı temizdi. `AGENTS.md` ve önceki üç su QA kaydı okundu. Branch, commit, push, stage veya authored veri yazımı yapılmadı. Bu oturumda eşzamanlı başka kaynak değişikliği saptanmadı.

## Kanıtlanan neden ve dar düzeltme

**Kaya çevresindeki sivri beyaz parıltının baskın kaynağı nehir köpüğü değil, ıslak terrain katmanının doğrudan güneş specular lobudur.** Aynı kamera, ACES exposure **0.2**, ışık ve **t=12** ile nehir açık/kapalı tekrarlandı. Authored nehirde point-stamp yok. `riverWater.ts`, `riverSunShadow.ts`, `waterEnvironment.ts`, `sunCascadeShadow.ts`, terrain shader ve katman yükleme/texture-array yolları incelendi.

Geri alınabilir shader uniform'ları yalnız review fixture belleğinde çalışır. İki kamera × su açık/kapalı × dokuz durumdan oluşan [36 tanı karesi](../../../.dev-server/river-bed-glare/diagnosis/review.json) üretildi; `river-flat` Off durumlarının tümü ve `river-rock-low` ana karşılıkları gerçekten açıldı:

| Karşı deney | Açılan görüntüde sonuç |
|---|---|
| Normal → yalnız direct specular kapalı | Kaya halkasının beyaz sivri detayları ve geniş güneş parlaması kaybolur |
| Yalnız IBL specular kapalı | Ortam parlaklığı değişir; güneş halkası kalır |
| İki specular katkısı kapalı | Islak dipteki parlama silinir; açık renkli kuru ön kıyı hâlâ parlaktır |
| Sabit albedo / yalnız albedo çıktısı | Sabit albedoda halka kalır; aydınlatmasız renk dokusunda halka yoktur |
| Düz normal / roughness=1 | Normal, lobun yerini/şeklini değiştirir; roughness=1 halkayı siler |
| İlk duruma dönüş | Kaya ROI'sinde piksel farkı 0; tanı geri alınabilir |

[Normal Off](../../../.dev-server/river-bed-glare/diagnosis/river-flat-off-normal.png), [direct specular kapalı](../../../.dev-server/river-bed-glare/diagnosis/river-flat-off-no-direct-specular.png), [IBL specular kapalı](../../../.dev-server/river-bed-glare/diagnosis/river-flat-off-no-ibl-specular.png), [yalnız albedo](../../../.dev-server/river-bed-glare/diagnosis/river-flat-off-albedo-only.png). Bunlar görsel teşhistir; yalnız ortalama parlaklıktan neden çıkarılmadı.

`loadForgeMaterialLayer`, `LT_Wet_Mud_Roughness.webp` yeşil kanalını albedo alpha'sına lineer roughness olarak paketliyor; `terrainLayerArray` RGB'yi sRGB, alpha'yı lineer tutuyor. Bu yolda katman normal texture'ı yüklenmiyor; terrain heightfield normalini kullanıyor. Düşük roughness texelleri bu kaba normal üzerinde çok parlak güneş lobu üretiyor. Renk dokusuna gömülü beyaz köpük veya nehir stamp'i hipotezi bu halka için desteklenmedi. IBL katkısı vardır fakat sivri beyaz halkanın baskın nedeni değildir.

`terrainMaterial.ts` artık **packed roughness ve fiziksel profil wetness ≥ 0.5** birlikte olan katmanın roughness'ını **en az 0.45** yapar; sonra mevcut paint ağırlıklarıyla karıştırır. 0.32/0.45/0.60 [tanı adayları](../../../.dev-server/river-bed-glare/candidates/review.json) açıldı: 0.32 sivri detayları yeterince bastırmadı; 0.45 yumuşak ıslak parlama ve daha pürüzlü texel detayını korudu. Bu değer görsel kalibrasyondur, ölçülmüş malzeme sabiti değildir. Daha sonra çalışan track/puddle roughness override'ı **0.16** olarak kalır. Yeni sampler, render target veya capture yoktur.

Üretim değişikliği yalnız bu katman koşulundadır. Nehir/göl shader'ları, güneş gölgesi, akış normalleri, animasyon, köpük/stamp kontrolleri, ışıklar, exposure, kaynak texture'lar, terrain/tile ve authored su verisi korunur. Planar yalnız göllerde kalır. Bu gerçek engel hidrodinamiği değildir.

## Aynı kaynakta görsel A/B

Yeni `--bed-glare` review modu, **aynı güncel su shader'ıyla** yalnız terrain'in yeni roughness ifadesini uniform ile geri alır. Eski commit'in bütün motoru kurulmuş sayılmaz. Her kamera için before/after/off-before/off üretildi: **24 PNG + iki t=14 PNG**. İlk PNG turu ve diğer testler bittikten sonraki GPU turu ayrı ayrı **462 engine/app/fixture kaynağında başlangıç/bitiş hash eşitliği** verdi; 0 error, 0 başarısız istek, 0 yazma; örneklenen GL error 0. [PNG kaydı](../../../.dev-server/river-bed-glare/final-images/review.json), [GPU kaydı](../../../.dev-server/river-bed-glare/final-gpu/review.json).

Önceki yerel kanıtlar tarihsel olarak incelendi. Yeni tanı başlangıcında engine/app dosyaları önceki `final-images` kaydıyla eşleşiyordu; fixture değişikliği ayrıca kaydedildi. **19/19 authored level/global/terrain/tile hash'i** önceki kayıtla, yeni kaynakla ve izole kopyayla aynı; ek **11 materyal/texture** kaynak/kopya eşleşir. [Hash ve ROI özeti](../../../.dev-server/river-bed-glare/summary.json). Önceki PNG'ler yeni A/B baseline'ı olarak kullanılmadı.

| Açılarak incelenen ana kadraj | Önce | Sonra | Su kapalı (sonra) |
|---|---|---|---|
| Alt nehir / kaya halkası | [PNG](../../../.dev-server/river-bed-glare/final-images/river-flat-before.png) | [PNG](../../../.dev-server/river-bed-glare/final-images/river-flat-after.png) | [PNG](../../../.dev-server/river-bed-glare/final-images/river-flat-off.png) |
| Kaya alçak | [PNG](../../../.dev-server/river-bed-glare/final-images/river-rock-low-before.png) | [PNG](../../../.dev-server/river-bed-glare/final-images/river-rock-low-after.png) | [PNG](../../../.dev-server/river-bed-glare/final-images/river-rock-low-off.png) |
| Kaya üstten | [PNG](../../../.dev-server/river-bed-glare/final-images/river-rock-top-before.png) | [PNG](../../../.dev-server/river-bed-glare/final-images/river-rock-top-after.png) | [PNG](../../../.dev-server/river-bed-glare/final-images/river-rock-top-off.png) |

`river-upper`, `river-bank`, `river-top` before/after/off; alt nehir ve alçak kayanın off-before; `river-bank`/`river-flat` t=14 kareleri de açıldı. Güneşli/gölgeli yüzey, dip dokusu ve akış okunur kalır. Yeni düzenli sınır bandı görülmedi. Mevcut açık kıyı ve yumuşak beyaz yüzey parçaları tümüyle giderilmiş değildir. Alt nehirde sivri parıltı azalması belirgin; alçak/üstten açılarda kazanım daha küçüktür.

Alt nehir kaya ROI'si **x=40,y=325,w=350,h=200**: üç RGB kanalı da 180/255 üstünde olan pikseller su açık **107 → 36**, su kapalı **169 → 55**. Bu eşik yalnız yardımcı ölçüdür, sanat kabulü değildir. Kuru ön kıyı kontrolünde aynı parlak piksel sayısı **59.368 → 59.368**; ortalama kanal farkı 0.023/255, en büyük fark 12/255. Kuru duvar ROI'si ortalama 0.110/255, maksimum 4/255: authored sahne bütünüyle bit-identical diye sunulmaz; karışık katmanlar ve ekran efektleri vardır. Saf kuru profil için kontrollü GPU testi tam eşitliği ayrıca doğrular.

## Güncel doğrulama

- `npx.cmd tsc --noEmit` ve smoke fixture TypeScript geçti.
- `npm.cmd run test:engine`: **1.999 kontrol**, çıkış 0. [Log](../../../.dev-server/river-bed-glare/engine.log).
- `npm.cmd run build:verify`: **çıkış 0**; production build, slow engine 1.999, fixture/content/UI tipleri, strict dist ve world-data dahil. [Log](../../../.dev-server/river-bed-glare/build.log).
- Chrome/RTX Playwright **17/17**: 12 optik (sun-shadow/IBL/fallback ve local stamp dahil), 3 nehir editor/runtime, mevcut wet-mud ve yeni bed-glare regresyonu. [Log](../../../.dev-server/river-bed-glare/browser.log).
- Yeni test gerçek terrain shader'ını eski/yeni roughness ile karşılaştırır: packed ıslak zeminde görünür fark; wetness 0 ve 0.1 profillerinde ve unpacked katmanda tam aynı örnekler/profiller; birikinti tabanı roughness, puddle maskesi ve normal aynı; baseline'a dönüş aynı sonucu verir. Wet-bed before/after ve mevcut birikinti görünümü PNG'leri açıldı. Birikinti/tekerlek halkası tasarımı değiştirilmedi.
- GPU turunda gerçek kamera/variant/motion girdileriyle 30 saniyelik keşif yapıldı; kaynak yazımı veya kayıp/siyah yüzey hatası yoktu. Mevcut Mercedes invalid-JSON, Three deprecation ve sürücü shader uyarıları ham kayıtta korunur; konsol tamamen temiz ilan edilmez.

## Donanım ölçümü ve sınırlar

Chrome/RTX 3060/ANGLE D3D11; 1280×748 DPR 1. Gerçek composer sınırında `EXT_disjoint_timer_query_webgl2`: her koşulda 30 warm-up + 120 geçerli query; ikinci turun sırası ters. Diğer test/build işleri ölçümden önce tamamlandı. Aşağıdaki aralıklar iki turun min–max değerleridir.

| Kadraj | Önce GPU p50 / p95 ms | Sonra GPU p50 / p95 ms | Aynı tur p50 farkları |
|---|---|---|---|
| Kıyı | 2.983–2.989 / 4.361–4.452 | 2.967–2.989 / 4.340–4.350 | +0.006 / −0.023 ms |
| Alt nehir | 3.465–3.550 / 4.977–5.407 | 3.445–3.494 / 4.775–4.973 | −0.105 / +0.029 ms |

Kıyı before/after **61 draw**, alt nehir **p50 88 / p95 97 draw** (mevcut aralıklı gölge çizimleri); her ikisinde **capture=0, scene copy=0**. [GPU/CPU/rAF/sayaç özeti](../../../.dev-server/river-bed-glare/gpu-summary.json). Alt nehir Off p50'si 3.201 → 5.907 ms kaydı; ölçüm drift içeriyor. Aynı programdaki geri alınabilir ifade karşılaştırması kesin üretim shader ALU maliyeti değildir. Sabit maliyet, hızlanma veya FPS garantisi çıkarılmaz.

Kalan yumuşak ıslak parlama ve bazı açık kuru kıyılar korunur; bütün beyazlıkların çözüldüğü veya tüm su sanatının kabul edildiği iddia edilmez. Farklı ışık/hava/DPR matrisi ve uzun süreli leak testi kapsam dışıdır. Lake-3 revizyonuna, genel refactor'a veya Puddle/Ocean araçlarına geçilmedi. PNG/JSON/loglar yerel `.dev-server/` kanıtlarıdır; yalnız Git checkout'u bunları içermez.

Tekrar üretim: doğrulanmış izole LandscapeTest kopyası 5493'te sunulurken `node tools/water-landscape-review.mjs --bed-glare --url=http://127.0.0.1:5493 --output=.dev-server/river-bed-glare/new-run`. `--capture-only` GPU/keşif turunu atlar. Tanı API'si `diagnoseBed(0..7)` ile reset/direct-spec-off/IBL-spec-off/both-off/flat-albedo/flat-normal/roughness-one/albedo-only karşılıklarını sağlar; yalnız fixture belleğine yazar.
