# Water surface v3 — 27 Ekim 2026

**Karar: optik kompozit düzeltmesi ve nehir akış revizyonu uygulanmıştır; bütün Water System için koşulsuz sanat kabulü verilmemiştir.** [Karşılaştırma galerisi](WATER_SURFACE_V3_REVIEW.html) gerçek PNG'leri, reddedilen ilk denemeyi ve açık görsel sınırları içerir. Eski `WATER_LANDSCAPE_REVIEW.md/html` tarihsel rapor olarak korunur.

Başlangıç HEAD `783895d5`. Kullanıcının önceki oturumda commit edilmemiş olarak bildirdiği çalışma artık `e901cd3d` içindeydi; onu yeniden uygulamadım. Başlangıçtaki ve oturum sırasında değişen diğer dokümanlara dokunulmadı. Branch, commit, push, authored sahne/terrain yazımı yapılmadı.

**Commit düzeni:** Kullanıcının sonraki commit talebiyle kaynak, test, bu rapor ve HTML galeri kayda alınır. Önceki `surface-v2` düzeni korunarak `evidence/surface-v3/` içindeki PNG ve ham çıktılar yerel diskte tutulur, `.git/info/exclude` ile Git dışında bırakılır. Galerinin resimleri ve raporun ham kanıt bağlantıları bu yerel klasörü gerektirir; yalnız Git checkout'u bu çıktıları içermez.

## Değişiklik ve gerekçe

`waterOptics.ts` içindeki `waterComposite`, gövde rengi, yansıma ve köpüğü tek alpha kompozitinde toplar. Eski shader'ın yansıma katkısı `R × alpha` idi: önce `mix(body, reflected, R)`, sonra SrcAlpha blend. Bu çift zayıflama koddan doğrulandı. Yeni düzenin yansıma katkısı `R`, görünen dip katkısı `(1-R) × (1-bodyOpacity)` olur; köpük bunların üstünde kendi kapsamasını taşır. Shader straight-alpha rengini son alpha'ya bölerek döndürür. **Opacity, exposure, authored ışık ve renkler yükseltilmedi.**

Bu doğrulama linear composer yolu içindir. Doğrudan canvas'ta tone mapping/output dönüşümü transparan blend'den önce gerçekleşir; tüm transparan direct/composer görüntülerin piksel eşitliği vaat edilmez. Mevcut opak nötr çıkış regresyonu iki exposure'da korunur.

`riverWater.ts` mevcut akış teğetinde taşınan, farklı ölçeklerde düzensiz normal kümeleri ekler. Köpük rapidness ile sınırlı, kırılmış ve yönlü parçalara ayrılır. İlk sinüzoidal deneme belirgin enine bantlar ürettiği için reddedildi; [iteration-1](evidence/surface-v3/iteration-1/river-bank-after.png) bunu saklar. Bağımsız glint'in gücü sınırlandı; nehir boyunca beyaz parıltının baskınlaşması azaltıldı. Mevcut akış hızı, vertex dalgası, köpük slider'ları ve stamp yolu korunur. Bu hidrodinamik veya gerçek kaya engeli simülasyonu değildir.

`lakeWater.ts` aynı enerji kompozitini kullanır; mevcut sakin normal animasyonu ve planar kaynak korunur. Sıfır derinliğe giderken ilk 8 cm'de yansıma yumuşatılır. Nehre planar eklenmedi; mevcut PMREM sky/probe yolu kullanılır. Birikintinin terrain IBL/ripple sistemi değiştirilmedi. Yeni scene-color/depth yakalama veya yeni reflection RT eklenmedi.

## Gözle yapılan değerlendirme

- **Nehir kıyısı:** Eski yüzeyde dip dokusu ve renk hâkimdi. Yeni yüzeyde farklı büyüklükte akış izleri, yumuşak çevre ışığı ve kopuk köpük parçaları görülüyor. Düzenli beyaz dalga sıraları kaldırıldı. t=12/t=14 ve canlı hareket değişimleri kontrol edilir. Üstten görünümün sakinleşmesi, daha düşük Fresnel ile uyumludur.
- **Nehir üst/alt bölümü:** Görünen dip ve kaya sınırı korunuyor. Alt kadrajda yerel köpük okunuyor; bazı kıyı parıltıları hâlâ güçlü. Doğrudan güneş terimi gölge haritası örnekleyen tam bir su BRDF'si değildir.
- **Lake-3:** Alçak ve kıyı açısında ağaç yansıması artık daha okunur, yüzey nehir gibi akmıyor; dip hâlâ görünür. Maksimum düşey derinlik **0.7589998 m**, eski kayıtla aynı. Üstten bakıldığında kahverengi dip baskın kalıyor. Bu sığ authored havza derin mavi bir göl gibi gösterilmedi veya yeniden şekillendirilmedi.
- **Lake-1:** Güncel authored ikinci göl korunur; maksimum derinlik **6.4631004 m**. `reflectionStrength=0.2` ve mevcut görünümüyle dip/havza biçimi hâlâ fazla baskın. Bu kadraja koşulsuz sanat kabulü vermiyorum. Yansıma kapalı, efektler kapalı, yalnız tanı amaçlı opak ve depth kareleri kaydedildi. AO'yu neden ilan edip genel postprocess değiştirmek için yeterli kanıt oluşmadı; denenen depth-write değişikliği üretime alınmadı.
- **Birikinti:** Kahverengi çamur ve yerel tekerlek ripple'ları gerçek GPU terrain/runtime testleriyle ayrıca korunur. Puddle planar kaynaklarına dönüş yoktur. Göl shader kazanımı birikinti kazanımı gibi sunulmaz.

Bu tur nehir akış karakterini ve göl yansıma okunurluğunu ilerletir. Özellikle ikinci gölün nihai yüzey karakteri açık kalır. Testlerin geçmesi bu sınırı kapatmaz.

## Yeniden üretim ve veri bütünlüğü

İzole sunucu: `tests/smoke/start-server.mjs`, port **5492**, kopya `.playwright-smoke/run-water-surface-v3`. Yalnız kopyanın manifest'i LandscapeTest'e yönlendirilir. Kaynak level, terrain/global ve tile dosyaları kopyayla SHA-256 üzerinden karşılaştırılır: [hash kaydı](evidence/surface-v3/scene-hashes.json).

Karşılaştırma **aynı güncel snapshot** üzerinde eski/yeni shader değiştirerek yapılır. `tests/smoke/pages/water-surface-v2-shaders.json`, `783895d5` kaynaklarından çıkarılmış shader metinleridir. Yeni geometri, kamera, texture ve scene ayarları sabit kalır; eski commit'in bütün motoru yeniden kurulmuş sayılmaz. Önceki günün görüntüleri farklı terrain ve ikinci göl nedeniyle doğrudan yeni baseline sayılmadı.

9 kadraj × off/before/after = **27 ana PNG**, ayrıca nehir/göl t=14 kareleri. Canvas **1280×748**, DPR **1**, ACES, exposure **0.2**, karşılaştırma saati **12 s**. Kameraların position/quaternion/FOV ve bütün optik uniform'lar [review.json](evidence/surface-v3/review.json) içinde. 16/16 terrain tile ve iki gölün ready olması kontrol edilir. GET/HEAD dışı review istekleri engellenir; hata/başarısız istek/yazma kaydı JSON'dadır. Boş/siyah kareye karşı ortalama ve dağılım kontrolü, ardından gözle PNG incelemesi yapılır.

GPU ölçümü gerçek `SceneApp` composer render sınırını sarar; uygulamanın update/material döngüsü yeniden taklit edilmez. Her koşulda 30 warm-up + 120 query, üç kadraj, ters sırayla iki tur. GPU ms, CPU submit, rAF, draw ve nested lake capture sayıları ayrıdır. İlk manuel/diğer tarayıcı işleriyle çakışan ölçüm [ayrı arşivdedir](evidence/surface-v3/review-initial-manual-overlap.json) ve nihai performans kabulünde kullanılmaz. Nihai koşu diğer GPU testleri bittikten sonra alınır.

**Son cihaz:** Chrome **156.0.0.0**, **NVIDIA GeForce RTX 3060 / ANGLE D3D11**, donanım timer mevcut. Son review'da **0 error, 0 başarısız istek, 0 yazma isteği**, bütün örneklenmiş GL error değerleri **0**. Kaynak/kopya **19/19 dosya eşleşir**. İki ayrı turun p50/p95 min–max aralığı aşağıdadır; birleştirilmiş dağılım değildir. [Ham özet](evidence/surface-v3/gpu-summary.json).

| Kadraj / koşul | GPU p50 ms | GPU p95 ms |
|---|---:|---:|
| Nehir kıyısı / Off | 2.728–5.058 | 4.810–6.555 |
| Nehir kıyısı / önceki shader | 2.781–4.998 | 4.830–7.397 |
| Nehir kıyısı / yeni Medium | 4.889–4.993 | 7.138–7.394 |
| Nehir alt / Off | 5.245–5.557 | 7.835–8.044 |
| Nehir alt / önceki shader | 5.432–5.633 | 7.777–8.024 |
| Nehir alt / yeni Medium | 5.326–5.499 | 8.001–8.033 |
| Göl genel / Off | 6.088–6.310 | 8.230–8.471 |
| Göl genel / önceki Medium | 8.814–8.882 | 11.786–13.105 |
| Göl genel / yeni Low (planar kapalı) | 6.247–6.427 | 8.261–8.460 |
| Göl genel / yeni Medium | 8.604–8.809 | 12.250–12.657 |
| Göl genel / yeni High | 11.482–11.597 | 13.871–15.238 |

Nehir kıyısında ilk tur içinde Off ve eski shader yaklaşık 2.8 ms iken sonraki bütün koşullar, ikinci turun Off/eski koşulları dahil, yaklaşık 5 ms'ye kaydı. Bu drift nedeniyle ilk turun +2.107 ms farkı shader maliyeti diye sunulmaz; ikinci tur farkı −0.005 ms'dir. Alt nehirde yeni/eski p50 farkı −0.307 / +0.067 ms, göl Medium'da −0.279 / −0.004 ms: sabit bir hızlanma iddiasına yeterli değildir. Yeni pass veya ek nehir capture yoktur; nehir kadrajlarında lake capture **0** olması nehre planar eklenmediğiyle uyumludur.

Göl genelinde Medium'un Off'a p50 farkı **+2.294 / +2.722 ms**, High'ın farkı **+5.172 / +5.509 ms**. Medium 120 frame'de **117 / 115**, High **240 / 240** göl capture üretti. İki authored göl farklı düzlemlerdedir. Medium'u öneriyorum; High'ın maliyetini yüzey iyileştirmesi için varsayılan hale getirmedim. Bu toplam sahne süresidir, yalnız shader ALU maliyeti değildir.

## Kontroller

| Kapı | Kanıt |
|---|---|
| `npx.cmd tsc --noEmit` | Geçti; [log](evidence/surface-v3/typescript.log) |
| `npm.cmd run test:engine` | **1.975 kontrol geçti**; [log](evidence/surface-v3/engine.log) |
| `npm.cmd run build:verify` | Geçti; slow engine, strict dist, world-data dahil; [log](evidence/surface-v3/build-verify.log) |
| Optik Chrome paketi | **8/8 geçti**; [log](evidence/surface-v3/optics.log) |
| Geniş editor/runtime su paketi | İlk koşu **11 geçti / 1 başarısız**; [log](evidence/surface-v3/hardware.log) |
| Göl GPU pilotu sayaç düzeltmesi | Aynı `additionalCalls===1`, 300 frame assertion'larıyla **1/1 geçti**; [log](evidence/surface-v3/lake-gpu-fixed.log) |
| Son fixture kontrolü | [log](evidence/surface-v3/smoke-fixtures-final.log) |

Son fixture TypeScript ve 5 smoke-project kontrolü geçti. [Galeri kontrolü](evidence/surface-v3/gallery-qa.json): 9 kadrajın tüm resimleri yüklendi; önce/sonra/off/karşılaştır/slider/t=14 düğmeleri çalıştı; 600px'de yatay taşma ve page error yok.

[PNG ölçümü](evidence/surface-v3/image-metrics.json) dokuz kadrajın her birinde off/on farkını ve önce/sonra farkını kaydeder; her kadrajda kamera, exposure ve GL durumu eşleşir. Bütün ana PNG'ler ayrıca gözle açıldı; testte görünen çamurlu kanal ve GAZ-52 runtime kareleri de incelendi. Bu sayılar sanat kabulü eşiği olarak kullanılmadı. İnceleme Chrome oturumları kapatıldı; yalnız bu oturumun sunucu PID'si **6376**, başlangıç zamanı ve `tests/smoke/start-server.mjs` komutu doğrulandıktan sonra kapatıldı. Eski `run-water-surface-v2/server.json` PID'sine dokunulmadı. İzole v3 veri kopyası tekrar inceleme için tutulur.

Yeni enerji regresyonunda siyah dip/gövde ve kırmızı/mavi yansıma ile alpha etkisi izole edilir. Opak/berrak sinyal nehirde **42.00 / 42.11**, gölde **84.28 / 84.28** (8-bit ekranda ortalama kanal farkı); eşitlik toleransı **3**, sinyal alt sınırı **15**. Bunlar fiziksel reflectance ölçümü değildir. Sphere-capture/sky boyut farkı, dönüşümlü dünya/ortografik view, alt kamera, kuru yatak, monoton dip kontrastı, derin ribbon kenarı, animasyon ve texture sayısı regresyonları da geçti.

Geniş pakette göl oluşturma, terrain korunması, sculpt/undo, Save/Reload/Play, 503/retry, su türlerinin UI'da gruplanması, draft UX ve legacy metadata kontrolleri geçti. Nehir seam/sculpt/flow/foam Save/Reload/runtime, GAZ-52 ripple, wheelspin ve shoreline testleri geçti. GPU pilotunun ilk hatası bir performans eşiği değildi: `renderer.info.autoReset=false` durumunda sıfırlanmayan kümülatif draw sayacını okuyordu. Yalnız test yardımcısına frame reset eklendi; assertion veya eşik azaltılmadı.

İlk sunucu başlatma esbuild sandbox erişim engeliyle durdu; izinli yeniden çalıştırma kullanıldı. Playwright REPL import'u modül export hatası verdi; repo Playwright runner'ı kullanıldı. Son fixture refactor'ında bir unused import TypeScript tarafından bulundu ve kaldırıldı; son kontrol ayrıca kaydedilir.

## Açık sınırlar

- Önceki **yazılım renderer siyah terrain/ripple başarısızlığı kapanmadı**; bu turdaki donanım geçişi onun yerine yazılmadı ve eşik düşürülmedi.
- Mevcut terrain sampler texture-unit uyarıları ve Mercedes SLS yan dosya invalid-JSON uyarıları saklanır. PCFSoft deprecation ve sürücü shader uyarıları da var; temiz konsol iddiası yok.
- Kaynak IMG kamera eşliği, bütün ışık koşulları/DPR, sualtı optiği, gerçek scene-color refraction, yüzdürme/akıntı fiziği ve 15 dakika leak bu turun kabulü değildir. Sabit FPS garantisi verilmez.
- Save şeması, endpoint veya asset ingestion sınırı değişmedi; güvenlik taraması başlatılmadı.

Tekrar çalıştırma: izole kopya sunucusunu hazırlayıp `FORGE_WATER_REVIEW_URL=http://127.0.0.1:5492`, `FORGE_WATER_REVIEW_OUTPUT=docs/planned/Forge_Water_System/evidence/surface-v3` ile `node tools/water-landscape-review.mjs` çalıştırılır. Driver Chrome/D3D11, NVIDIA ve gerçek GPU timer ister. Galeri yerel HTML olarak sunucusuz açılabilir.
