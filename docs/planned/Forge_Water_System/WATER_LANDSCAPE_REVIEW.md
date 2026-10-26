# LandscapeTest — gerçek sahne su incelemesi

Tarih: 26 Ekim 2026. Kaynak branch `main`, başlangıç HEAD `c3410275`.
**Karar: REVİZYON.** Kontrollü shader testindeki kazanım gerçek nehirde de görülebiliyor; doğal su görünümünün nihai kabulü için yeterli değil. Eğimli nehirde planar capture sorunu doğrulandı. Göl ayrı, mevcut shader'ıyla değerlendirildi.

**Görüntüleri aç:** [Kaydırmalı karşılaştırma](WATER_LANDSCAPE_REVIEW.html). Dört nehir, üç göl kamerası; 18 PNG. Nehirde eski shader/prototip, gölde su kapalı/mevcut göl karşılaştırılır. Göl için sahte bir “yeni shader” görüntüsü üretilmedi.

## Kullanılan sahne ve yöntem

- LandscapeTest, mevcut bir nehir (`river-water-1`) ve bir göl (`lake-3`) ile kopyalandı. Tüm 16 terrain tile'ı ve göl geometrisi hazır olmadan yakalama başlamadı.
- `tests/smoke/start-server.mjs`, `.playwright-smoke/run-water-landscape-review` kopyasını 5488 portunda sundu. Kopyanın manifest'i LandscapeTest'e yönlendirildi. Authored proje manifest'i değişmedi.
- Gerçek `SceneApp`, mevcut Sky/IBL/fog, Sun/cascades, AO/bloom/SMAA ve diğer materyallerle çalıştı. Canvas **1280×748**, DPR **1**, tone mapping ACES, mevcut exposure **0.2**.
- Kameralar ve su saati (`t=12 s`) sabit. Sky/cloud camera-follow güncellemesi korundu; cloud animasyon zamanı durduruldu. Önceki Faz 0'daki siyah ortam sorunu burada oluşmadı.
- “Önceki nehir”, `6486120b` commit'indeki vertex/fragment/point-foam shader metinleridir. Aynı güncel geometri, uniform'lar ve sahne üzerinde değiştirilir; bütün eski commit veya eski authored dünya yeniden kurulmuş sayılmaz. [Shader fixture](../../../tests/smoke/pages/river-water-legacy-shaders.json).
- GPU ölçümünde mevcut **`GpuFrameTimer`** kullanıldı. Disjoint veya eksik query sonucu başarısız sayılır. CPU submit, rAF, toplam draw ve nested reflection draw sayıları ayrıdır; frame başında tek sayaç reset'i yapılır.
- Koşullar: Off, eski nehir/Medium, prototip/reflection-off, prototip/Medium, prototip/High. Bunlar **su reflection kademeleridir**; global grafik profili sabit kalır. Her koşulda 30 ısınma frame'i, 120 ölçüm frame'i; iki turda sıra ters çevrilir.
- Off, River/Lake mesh'lerini gizler; terrain su filmini kapatmaz ve Medium reflection target tahsislerini tutar. Reflection-off koşulu ise `setQuality(null)` ile iki reflection target'ını da kaldırır. Bu ayrım JSON'da kaydedilir.
- İlk geçişte iki kamera terrain tarafından örtülüyordu. `river-flat` ve `lake-shore` yeniden kadrajlandı; flat GPU koşusu tekrarlandı. İlk sonuç [first-pass kaydında](evidence/landscape-review/review-first-pass.json), son sonuç [review.json](evidence/landscape-review/review.json) içinde. Bu iki başarısız ilk kadraj görsel kabul olarak kullanılmadı.

Çalışma başında Git temizdi. Oturum sırasında authored terrain definition/global ve `2_2`, `3_1`, `3_2` tile dosyaları dirty oldu; bunlar bu araçlar tarafından yazılmadı ve geri alınmadı. Kopya ile kaynak arasındaki hash'ler [scene-hashes.json](evidence/landscape-review/scene-hashes.json) içinde; hash alındığı anda kopya ve kaynak eşleşiyordu. Sonuçlar bu kayıtlı snapshot'a aittir. Hiçbir save isteği gönderilmedi; driver GET/HEAD dışı istekleri engeller ve kaydeder. Ölçümde **0 yazma isteği**, **0 başarısız ağ isteği**, **0 page/console error** görüldü.

## Görsel değerlendirme

### Nehir

**İyileşen:** Sığ kenarın geçirgenliği ve renk geçişi daha yumuşak; üstten bakışta keyfî açık ribbon kenarı azalıyor. Kıyıdan bakışta önceki ağır ayna görüntüsü hafifliyor. Aktif su ve kaya/su birleşimleri dört kadrajda incelendi.

**Yetersiz kalan:** Derin su hâlâ koyu, yer yer türdeş ve yatay bantlı okunuyor. Normal/UV hareketi, akışın ve engel etkileşiminin doğal görünmesi için tek başına yeterli değil. Hareket kontrolü ve kamera/variant dönüşleriyle 30 saniyelik etkileşim incelemesi yapıldı; bu, kesintisiz sürüş videosunun veya tüm ışık koşullarının kabulü değildir.

**Doğrulanmış yansıma sorunu:** Nehrin surface Y aralığı **−38.7…−85.7 m**, yani **47 m kot farkı**. Paylaşılan planar kaynak hâlâ üst kotta **Y=−38.7** tek yatay düzlemi kullanıyor. Kıyı kamerası **Y=−40.7** iken kamera yerel suyun üstünde, ancak bu genel düzlemin altında. Kaynak yeni capture üretmiyor.

Ek kamera dönüşü deneyi:

1. Kıyı kamerasında reflection target'ları temizlenip Medium tekrar açıldı: river `captured=false` kaldı.
2. Kamera göl kadrajına (`[87,27,4]`) taşındı: river kaynağı capture üretti.
3. Aynı nehir kıyı kamerasına dönüldü: son capture'ın kamerası hâlâ göl kadrajıydı. Yeni kıyı capture'ı oluşmadı.

[Tanı JSON'u](evidence/landscape-review/diagnostics.json), [soğuk target](evidence/landscape-review/river-reflection-cold.png), [başka kameradan kalan target](evidence/landscape-review/river-reflection-stale.png). Bu önceden var olan bir planar/geometri uyumsuzluğudur; shader Fresnel düzeltmesi bunu çözmüş sayılmaz. Nehir benchmark'larında capture sayısının 0 olması da maliyet avantajı olarak yorumlanmamalı.

Bu son iki PNG'de belirgin bir görsel fark görülmedi; capture'ın yenilenmemesi kaynak durumu ve son capture kamerası kaydıyla doğrulandı. Dolayısıyla bu deney görünür bir ağaç-yansıması sıçramasının kanıtı olarak sunulmuyor.

### Göl

Terrain'e oturan havza sınırı ve düz su seviyesi korunuyor. Maksimum düşey derinlik yalnız **0.759 m** olmasına rağmen dip çoğu yerde okunmuyor; kıyı geçişi keskin ve yüzey tek renkli görünüyor. Uniform'lar bunu açıklıyor: `bedVisibility=0.05`, `absorptionDistance=1`; mevcut lake shader alpha'yı `max(opacity,1-transmission)` ile hesaplıyor. Kamera açısına bağlı Fresnel hâlâ yok. Gölün eski görünümü nehir prototipinin kazanımı gibi gösterilmedi.

**Sanat kararım:** Mevcut stilize terrain/bitkilerle uyumlu, daha okunabilir doğal su hedefi sürdürülmeli. Tek başına suyu daha turkuaz yapmak veya exposure'ı açmak yeterli çözüm değil.

## Gerçek GPU sonuçları

**NVIDIA GeForce RTX 3060**, driver **32.0.16.1060**, Chrome **155.0.0.0**, ANGLE **D3D11**. `EXT_disjoint_timer_query_webgl2` var; bu tablo SwiftShader/CPU tahmini değildir. Aşağıdaki aralıklar iki turun ayrı p50/p95 sonuçlarının minimum ve maksimumudur; tek birleşik dağılım değildir. FPS hedefi ilan edilmedi.

Gölün genel kadrajı, iki su kaynağının reflection yükünü görünür kılıyor:

| Koşul | GPU p50 ms | GPU p95 ms | CPU submit p50 ms | Ortalama draw/frame |
|---|---:|---:|---:|---:|
| River/Lake kapalı | 5.46–5.48 | 6.24–7.03 | 4.30 | 309.5 |
| Eski nehir, Medium | 7.43–8.08 | 9.81–10.38 | 6.20–6.90 | 367.6 |
| Prototip, reflection kapalı | 5.48 | 6.13–6.26 | 4.20 | 311.5 |
| Prototip, Medium | 7.92–8.47 | 10.10–12.56 | 6.90–7.50 | 363.8–367.6 |
| Prototip, High | 10.92–11.83 | 19.85–20.91 | 9.20–10.10 | 425.5 |

- Bu kadrajda Medium'un Off'a göre toplam kare p50 farkı **+2.47 / +2.98 ms**; High'ın farkı **+5.46 / +6.35 ms**.
- Medium'da 120 frame'de toplam **110–118**, High'da **240** reflection capture oluştu. High iki kaynağı da her frame güncelliyor. Görsel kazanıma göre pahalı; mevcut sahne için **Medium öneriyorum**.
- Aynı kadrajda prototip/Medium'un eski/Medium'a göre p50 farkı **+0.49 / +0.39 ms**. Bu bütün kare ve reflection etkisidir; yalnız Fresnel ALU maliyeti değildir. Diğer kameraların değişkenliği nedeniyle shader maliyeti için kesin sabit bir delta çıkarmıyorum.
- Nehir kıyısında eski p50 **2.80 ms**, prototip **2.83 ms**. Yaklaşık **0.03 ms**, mevcut timer hassasiyetinde anlamlı shader regresyonu kanıtı değil. Reflection capture yoktu.
- Yeniden kadrajlanan nehir alt bölümünde prototip p50 iki turda **3.12 / 5.08 ms**, eski **4.07 / 3.10 ms** çıktı. Yönü değişen bu fark **kararsızdır**; performans kabulü olarak kullanılmamalı. Bazı river Off sonuçlarının su açık sonuçlarından pahalı olması da bileşen maliyetine kör fark çıkarılmaması gerektiğini gösterir.
- rAF p50 çoğunlukla **16.6–16.7 ms**; bu vsync sınırlı bir sunum ritmidir. GPU ms ile aynı ölçüm değildir. High p95'inin yaklaşık 20 ms olması 60 FPS garantisine izin vermez.

## Teknik uyarılar ve kapsam

- Texture-unit uyarıları `landscape-terrain` / `MeshStandardMaterial` draw'ına bağlandı. **Su kapalıyken ve eski shader'da da mevcut.** Yeni nehir shader'ının sampler sayısı artmadı. Örneklenen `gl.getError()` değerleri **0**. Bu uyarı tek başına kesin bozuk render kanıtı sayılmadı; ayrı terrain/shadow sampler incelemesi gerekiyor.
- Mercedes SLS'nin mevcut `.uvw.json`, `.materials.json`, `.collision.json` yan dosyaları invalid-JSON uyarısıyla defaults'a düştü. Ayrıca Three PCFSoft deprecation ve sürücü shader warning'leri var. Bunlar temiz konsol kabulü yapılmasını engelliyor; sayılar ve tanı kayıtlarda tutuldu.
- Bu tur üretim engine/editor/runtime veya authored su/terrain kaynakları değiştirilmedi. Eklenenler review fixture'ları, önceki shader kaydı, driver, görüntü/ölçüm ve raporlardır. Endpoint veya save şeması değişmedi; güvenlik taraması başlatılmadı.
- `npx.cmd tsc --noEmit` ve `npm.cmd run verify:smoke-fixtures` geçti. Son tanı eklemesinden sonra smoke TypeScript tekrar kontrol edildi. Önceki 1.973 engine/full build sonucu bu tur yeniden çalıştırılmış diye sunulmuyor.
- Canlı UI'da camera, variant ve motion dönüşleri çalıştı. Statik karşılaştırma sayfasında yedi kadraj, görsel yüklenmesi, önce/sonra düğmeleri, slider ve 600 px viewport kontrol edilir.
- Bu oturum **editor SceneApp** üzerinde görsel/performance incelemesidir. Runtime GPU ölçümü, farklı DPR/ışık koşulları, 15 dakika leak, resize hitch ve nihai kullanıcı sanat onayı tamamlandı sayılmaz.

## Sonraki en küçük uygulama

1. Eğimli nehir için planar eligibility'yi gerçek surface yüksekliğiyle belirlemek; uygun olmayan bölümde mevcut environment/sky sözleşmesine dayanan açık bir reflection fallback'i kurmak. Yatay gölün planar yolunu korumak.
2. Aynı kıyı kamerasında capture temizleme → farklı kameraya gitme → dönme regresyonunu kapatmak; “önceki kameradan ayna” davranışını bitirmek.
3. Bu kapıdan sonra göle ortak optik parçaların taşınmasını mevcut Lake altyapısına uyarlamak. Yeni paralel göl sistemi veya geniş kayıt migrasyonu başlatmamak.

Ana araştırma belgesindeki stop/go ölçütüne göre bu aşamada bütün Faz 1'e veya ortak materyal refactor'ına kabul vermiyorum. Görsel fayda sınırlı, yansıma varsayımı hâlâ sorunlu; sıradaki iş bu varsayımı düzeltmektir.

## Tekrar çalıştırma

İzole server için `FORGE_SMOKE_PORT=5488` ve repo içindeki `.playwright-smoke/run-water-landscape-review` root'u kullanılır; `tests/smoke/start-server.mjs` başlatılır. Hazır kopyanın `public/project.3dgame.json` içindeki `editor.defaultScene`, LandscapeTest'e yönlendirilir. Ardından `node tools/water-landscape-review.mjs` çalıştırılır. Driver yüklü Chrome + D3D11 + donanım timer ister; SwiftShader'ı kabul etmez. `--pilot` yalnız ilk kareleri, `--refine` yalnız düzeltilmiş iki kadrajı ve flat ölçümünü günceller. Son mod mevcut `review.json` gerektirir.

Kameralar ve bütün kalite/sayaç kayıtları [review.json](evidence/landscape-review/review.json), source snapshot hash'leri [scene-hashes.json](evidence/landscape-review/scene-hashes.json), materyal/capture tanısı [diagnostics.json](evidence/landscape-review/diagnostics.json) içindedir.

Son kontrolde kayıtlı 21 kaynak dosyanın hash'i kopyayla hâlâ eşleşiyordu. İnceleme Chrome oturumları ve 5488 test sunucusu kapatıldı; doğrulanmış geçici proje kopyası temizlendi. Statik karşılaştırma HTML'i görüntü dosyalarıyla birlikte sunucu olmadan açılabilir.
