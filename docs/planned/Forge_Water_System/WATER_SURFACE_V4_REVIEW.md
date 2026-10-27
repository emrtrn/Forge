# Water surface v4 — 27 Ekim 2026

**Karar: göl yüzeyi ilerletildi; bütün Water System için koşulsuz görsel kabul yok.** [PNG karşılaştırma galerisi](WATER_SURFACE_V4_REVIEW.html), [QA envanteri](WATER_SURFACE_V4_QA.md). V3 ve Landscape raporları tarihsel kayıt olarak korunur.

Başlangıç Git ağacı temizdi; HEAD `aaab028d` doküman arşivleme commit'i. `18f2307c` ve `e901cd3d` kaynakları incelendi, yeniden uygulanmadı. Branch, commit veya push oluşturulmadı. Authored terrain, level, göl ayarları, opacity, genel exposure ve ışıklar değiştirilmedi. Oturum sırasında başka çalışmadan gelen terrain materyali/renderer, texture-array, güneş gölgesi ve terrain test değişiklikleri korundu.

## Kontrollü teşhis

Eski Lake-1/Lake-3 PNG'leri ve yeni tanı kareleri gerçekten açıldı. Tanı çıktıları [continuation-v4](evidence/surface-v3/continuation-v4/) altında; eski kanıtlar silinmedi veya taşınmadı.

1. Yalnız AO ve tüm efektler kapatıldığında normal Lake-1 görüntüsündeki havza karakteri büyük ölçüde kaldı. Buna karşılık **sabit opak renk** üzerinde görülen dip izi, yalnız AO kapatılınca kayboldu. AO'nun bir katkısı doğrulandı; tek veya baskın neden olduğu ilan edilmedi. [AO açık](evidence/surface-v3/continuation-v4/lake-1-flat-color.png), [AO kapalı](evidence/surface-v3/continuation-v4/lake-1-flat-color-noao.png), [durum kaydı](evidence/surface-v3/continuation-v4/diagnostics-flat.json).
2. Ham planar reflection karesinde ağaçlar ve gökyüzü mevcut. Boş reflection RT hipotezi bu kadraj için desteklenmedi. [Ham yansıma](evidence/surface-v3/continuation-v4/lake-1-reflection.png).
3. Eski alpha kompoziti kahverengi dip rengini tek skaler geçirgenlikle azaltıyor; kırmızı/yeşil/mavi kaybını ayrı hesaplamıyor. Baked düşey derinlik, eğik bakışta o pikselin arkasında görülen dip noktasına kadar olan yol değil. Bunlar kaynak koddan doğrulandı.
4. Yeni yolda yalnız **baked path** geri getirildiğinde dip/havza şekli daha fazla okunuyor; yalnız **skaler absorpsiyon** geri getirildiğinde kahverengi/soluk dip baskınlaşıyor. Birlikte kullanılan ekran mesafesi ve RGB kaybı suyu daha belirgin kılıyor. Bu sanatçı değerlendirmesidir; tek bir yüzdeyle fiziksel neden paylaştırması yapılmadı. [Baked path](evidence/surface-v3/continuation-v4/lake-1-v4-baked-path.png), [skaler kayıp](evidence/surface-v3/continuation-v4/lake-1-v4-scalar-loss.png), [birlikte](evidence/surface-v3/continuation-v4/lake-1-v4-base.png), [ham kayıt](evidence/surface-v3/continuation-v4/diagnostics-ablations.json).
5. Gövde ışığını artırma ve environment/planar ağırlığını yeniden yorumlama denemeleri ana sorunu yeterince gidermedi; üretime alınmadı. Production'da reflectionStrength anlamı ve authored değerleri korundu. Önceki depthWrite denemesi de üretime alınmadı.

## Uygulama

`waterSceneSnapshot.ts` ve `PostProcessPipeline`, ilk görünen göl çiziminden önce mevcut linear composer renk/derinliğini **bir kez kopyalar**. Diğer göller aynı kopyayı kullanır. Ek sahne render'ı veya yeni planar capture yoktur; kopyanın GPU bant genişliği ve bellek maliyeti vardır. Doğrudan canvas, nested planar kamera ve MSAA composer hedefi eski baked-depth optiğine döner. Göl olmayan/gizlenen sahnelerde snapshot ve sisteme ait composer depth attachment'ları bırakılır; resize'da yeniden boyutlandırılır, pipeline dispose'da kaynaklar temizlenir.

`lakeWater.ts`, ters projeksiyonla su ve görünür dip konumlarını view uzayında kurar; aralarındaki mesafeyi RGB Beer–Lambert yaklaşımında kullanır. Spektral katsayılar mevcut deepColor'dan türetilen bir **sanat yaklaşımıdır**, ölçülmüş su kimyası değildir. Authored opacity floor'u önceki `max(opacity, 1-transmission)` sözleşmesine denk **kanal başına min geçirgenlik** olarak korunur. İlk prototipteki çarpım bu sözleşmeye uymadığı için düzeltilmiştir. Renk ve depth kopyası aynı pikselden okunur; bu turda normal ile bükülmüş fiziksel refraction eklenmedi.

Göl kendi sampled dibini final piksele dahil ettiği yolda GTAO normal/depth geçişi düz su arayüzünü görür; gömülü havzanın AO'su tamamlanmış su rengine yeniden uygulanmaz. Gölün beauty materyalinde `depthWrite=false` ve transparan sıralama korunur. Override normal/depth çiziminde tekrar su kopyası veya planar capture başlatılmaz.

Nehirde yalnız 3–30 cm sığlık aralığında bağımsız güneş glint'i yumuşatıldı. V3 akış teğetindeki normal kümeleri, yerel köpük, PMREM ve Sphere Reflection Capture yolu korunur. **Nehir ve birikintide planar yoktur.** Birikinti shader'ı değiştirilmedi; bu göl kazanımı birikinti kazanımı diye sunulmaz.

## Gözle değerlendirme

- **Lake-1:** Aynı genel kamerada kahverengi kuru havza görünümü azalır; yeşil su ve ağaç yansıması daha belirgindir. Yeni alçak kamerada da v3/v4 aynı pozda karşılaştırıldı. Fakat geniş yeşil kıyı bandı, koyu dip sınırı ve karşı kıyının keskin yansıması hâlâ dikkat çeker. Koşulsuz sanat kabulü yok. Maksimum düşey derinlik 6.4631004 m ve reflectionStrength=0.2 korunur.
- **Lake-3:** Alçak/kıyı görüntülerinde sakin ağaç yansıması ve sığ dip birlikte görülür; nehir gibi yönlü akış eklenmedi. Üstten bakışta küçük, kahverengi/koyu havza karakteri tamamen kaybolmaz. Maksimum derinlik 0.7589998 m korunur.
- **Nehir:** Dört açı ve t=12/t=14 karelerinde V3 akış karakteri korunur. Çok sığ kıyı glint'i azalır; alt bölümde kaya çevresindeki bazı köpük/parıltı parçaları hâlâ güçlüdür. Bunlar gerçek engel hidrodinamiği veya gölgeli su BRDF'si olarak sunulmaz.
- **Birikinti:** Güncel wet-mud ve GAZ-52 PNG'leri açıldı. Kahverengi zemin, sığ oluk, sky IBL ve yerel ripple korunur. Parlak/yer yer gri gökyüzü bandı hâlâ görülür; bu test kadrajları bütün çamurlu birikinti sanat hedefinin tamamlandığını kanıtlamaz.

## Doğrulama ve ölçüm

Son inceleme Chrome **156 / NVIDIA RTX 3060 / ANGLE D3D11**, gerçek `EXT_disjoint_timer_query_webgl2` ile yapıldı. **10 kamera × off/v3/v4 = 30 PNG**, ayrıca nehir/göl t=14 kareleri. Canvas 1280×748, DPR 1, ACES exposure 0.2, sabit saat 12 s. Kamera ve ışık eşliği JSON üzerinden, görüntülerin dolu olması sayısal dağılım ve PNG açılarak kontrol edildi. On ana after/before/off PNG'nin tamamı ayrıca contact sheet olarak açıldı; Lake-1/Lake-3, nehir ve birikinti yakın kareleri ayrı incelendi.

[Nihai review](evidence/surface-v3/continuation-v4/final-stable/review.json): **457 engine/app kaynak dosyasının başlangıç/bitiş hash'i aynı**, **0 error / 0 başarısız istek / 0 yazma**, örneklenen GL error değerleri 0. [Authored kaynak/kopya hash'leri](evidence/surface-v3/continuation-v4/final-stable/scene-hashes.json) **19/19 eşleşir**; 16/16 tile ve iki göl ready. Baseline `18f2307c` shader snapshot'ıdır; eski commit'in bütün motoru kurulmuş sayılmaz. V3 ve V4 aynı güncel geometri/terrain/material/ışık grafiğinde karşılaştırılır.

Eşzamanlı terrain/gölge değişikliklerinin yüklemeye yakın olduğu ilk `final/` turu korundu, nihai kaynak eşliği kanıtı olarak kullanılmadı. `final-stable/` tekrarında kaynak sınırı sabittir. Başka oturumun terrain texture-array/gölge düzeltmelerinin toplam sahneye etkisi su shader kazanımı diye yazılmaz. Son review'da eski texture-unit uyarısı görülmedi; bunu su kodunun çözdüğü iddia edilmez. Mercedes SLS invalid-JSON, PCFSoft deprecation ve sürücü shader uyarıları ham kayıtta korunur; temiz konsol iddiası yok.

| Kapı | Sonuç / kayıt |
|---|---|
| `npx.cmd tsc --noEmit` | Geçti |
| `npm.cmd run test:engine` | **1.980 kontrol**; [log](evidence/surface-v3/continuation-v4/engine.log) |
| `npm.cmd run build:verify` | Geçti; smoke fixture, build, slow engine, strict dist/world-data dahil |
| Gerçek işlem çıkışları | [Üç kapıda da 0](evidence/surface-v3/continuation-v4/gates.json) |
| Optik browser | **9/9**; [son log](evidence/surface-v3/continuation-v4/optics-final-fixed.log) |
| Göl/nehir/birikinti editor-runtime | İlk tur **12/12**; [log](evidence/surface-v3/continuation-v4/browser.log). Son kaynak turu **11 geçti / 1 açılış timeout'u**; [log](evidence/surface-v3/continuation-v4/browser-latest.log) |
| Son göl tekrar kontrolü | Aynı 90 s açılış süresi ve assertion'larla Save/Reload/Play + yeni ray-path testi **2/2 geçti**, retry kullanılmadı; [log](evidence/surface-v3/continuation-v4/lake-final-recheck.log) |
| Birikinti PNG tekrar turu | **3/3**; [log](evidence/surface-v3/continuation-v4/puddle-visual.log) |
| Galeri | **10 kadraj / 28 resim**, bütün kadrajlarda önce/sonra/off/karşılaştır ve klavye slider; iki t=14 düğmesi, **600 px taşma yok / 0 page error**; [QA](evidence/surface-v3/continuation-v4/final-stable/gallery-qa.json). Desktop ve küçük PNG açıldı |
| Son fixture kapısı | Smoke TypeScript ve **5 smoke-project kontrolü geçti**; [log](evidence/surface-v3/continuation-v4/smoke-fixtures-final.log) |

Yeni optik test, baked vertex derinliğini 0.1 m tutarken gerçek yatağı 5 m'ye taşır; perspektif ve ortografik kamerada ekran derinliğinin gerçekten kullanıldığını gözler. Sığ dip kontrastı, yeşil kanal ayrımı, sabit rebuild texture sayısı ve gizle→göster kaynak bırakma/geri üretme kontrolleri geçer. Bir ara kaynak-sayısı assertion'ı iki composer'dan biri henüz ilk kez kurulurken alındığı için başarısız oldu. İki pipeline ısıtıldıktan sonra **aynı kesin eşitlik assertion'ı** geçti; eşik gevşetilmedi. [Başarısız koşu](evidence/surface-v3/continuation-v4/optics-final.log) korunur. İlk sandbox esbuild hataları geçiş sayılmadı. REPL Playwright modül hatası nedeniyle mevcut repo runner'ı kullanıldı.

Son geniş turdaki açılış hatası `page.goto(...terrain-lake-editor.html?editor)` / `domcontentloaded` aşamasında 90 saniyeydi; göl assertion'larına ulaşmadı. İki testlik tekrarın ikisi de ilk denemede geçti. Yeni göl optik fixture'ında 0.1 m sığ dip kontrastı **121.33**, 5 m kontrastı **18.00** (8-bit ortalama kanal aralığı); bunlar görsel kalite veya fiziksel absorpsiyon katsayısı değildir. Son testin [ham JSON'u](evidence/surface-v3/continuation-v4/lake-final-artifacts/river-water-optics-lake-op-eab16--colour-and-releases-copies-chrome-rtx/lake-scene-depth.json) baked/gerçek dip, warm-up ve kaynak bırakma durumlarını ayrı kaydeder.

### GPU karşılaştırması

Gerçek `SceneApp.postProcessPipeline.render` sınırı gözlenir; eski manuel frame taklidi kullanılmaz. Her koşulda 30 warm-up + 120 geçerli query, ters sırayla iki tur. Aşağıda iki turun min–max p50/p95 değerleri vardır; birleştirilmiş dağılım değildir. [GPU/CPU/rAF/draw/kopya/capture kayıtları](evidence/surface-v3/continuation-v4/final-stable/gpu-summary.json).

| Kadraj / koşul | GPU p50 ms | GPU p95 ms |
|---|---:|---:|
| Nehir kıyı / Off | 2.832–5.456 | 3.510–8.472 |
| Nehir kıyı / V3 | 2.930–4.645 | 10.400–16.179 |
| Nehir kıyı / V4 Medium | 2.901–2.910 | 11.311–15.669 |
| Nehir alt / Off | 2.673–5.760 | 3.346–7.266 |
| Nehir alt / V3 | 2.791–6.259 | 3.428–8.218 |
| Nehir alt / V4 Medium | 2.745–6.024 | 3.439–7.703 |
| Göl genel / Off | 2.796–3.176 | 3.432–3.736 |
| Göl genel / V3 | 3.488–3.534 | 4.320–4.446 |
| Göl genel / V4 Low | 2.970–3.191 | 3.633–3.638 |
| Göl genel / V4 Medium | 3.504–3.565 | 4.346–4.382 |
| Göl genel / V4 High | 4.407–4.430 | 4.600–4.607 |
| Lake-1 / Off | 2.735–3.018 | 3.393–3.404 |
| Lake-1 / V3 | 3.057–3.065 | 3.725–3.812 |
| Lake-1 / V4 Low | 3.011–3.078 | 3.443–3.465 |
| Lake-1 / V4 Medium | 3.146–4.471 | 3.664–19.627 |
| Lake-1 / V4 High | 3.525–14.604 | 4.085–20.443 |

**Drift ve outlier vardır; sabit shader maliyeti veya hızlanma kabulü verilmez.** Nehir kıyısında Off/V3 ve High koşulları dahi turlar arasında ciddi kayar. Lake-1 ikinci tur Medium/High p95 sıçramasının nedeni bu kayıttan kesinleştirilemez. Göl genelinde V4−V3 p50 farkı +0.077 / −0.030 ms, Lake-1'de +0.081 / +1.414 ms'dir; bu değerler tek bir shader ALU maliyeti diye sunulmaz. FPS garantisi yok.

Nehir kadrajlarında her koşulda **0 planar capture, 0 scene snapshot**. Göl V4 Low/Medium/High'da her ölçülen karede **tam bir** paylaşılan renk/derinlik kopyası, V3/Off'da 0 kopya vardır. Göl genel High 120 frame'de 240, Lake-1 High 120 capture üretir: görünür iki/tek göl planar kaynağı korunur, kopya bunlara yeni capture eklemez. Medium önerisi korunur; High varsayılan yapılmadı.

1280×748 için bir HalfFloat renk + depth snapshot ve iki composer depth attachment'ın nominal ek depolaması yaklaşık **18.3 MiB**'dir; gerçek VRAM/driver/MSAA maliyeti ölçümü değildir. Gizleme ve tekrar oluşturma testi sabit GPU texture sayısını doğrular; 15 dakika leak kabulü sayılmaz.

### Yerel tekrar üretimi

Mevcut izole authored kopya `.playwright-smoke/run-water-surface-v3/` korunur. Bu oturumun yerel `.playwright-smoke/start-water-v4.mjs` yardımcısı aynı kopyayı port 5493'te sunar; eski `server.json` PID'leri kullanılmaz. Sunucu çalışırken:

```powershell
$env:FORGE_WATER_REVIEW_URL = 'http://127.0.0.1:5493'
$env:FORGE_WATER_REVIEW_OUTPUT = 'docs/planned/Forge_Water_System/evidence/surface-v3/continuation-v4/new-run'
node tools/water-landscape-review.mjs
```

Yeni driver motor/app başlangıç ve bitiş hash'lerini kaydeder; kaynak değişirse koşuyu başarısız sayar. `WATER_SURFACE_V4_REVIEW.html` yerel dosya olarak açılabilir. Normal input ile 30 saniyelik kamera/kalite/hareket keşfi nihai driver turuna dahildir. İncelenen kadrajlarda boş/siyah terrain, kayıp su, GL hatası ve galeride yatay taşma görülmedi; yukarıda listelenen görsel kusurlar kabul dışı olarak tutulur.

Bu oturumun 5493 sunucusu PID **5016**, başlangıç zamanı ve tam `node .playwright-smoke/start-water-v4.mjs` komutu yeniden doğrulandıktan sonra kapatıldı. Chrome inceleme/QA oturumları kapandı. Eski server.json PID'lerine veya başka oturum süreçlerine dokunulmadı.

## Açık sınırlar

- Lake-1 kıyı geçişi ve Lake-3 üstten görünümü için revizyon gerekir. Bu tur bir yüzey ilerlemesidir, bütün Water System kabulü değildir.
- Ekran rengi ilk gölün çizim sırasındaki mevcut scene rengidir; daha önce çizilmiş transparanlar dahil olabilir. Üst üste binen su/transparanlar, sualtı kamera ve ekran dışı refraction tam kabul kapsamı değildir.
- MSAA/far-view ve doğrudan canvas eski görünüm yoluna döner; bu yollara yeni RGB aktarımının görsel eşitliği vaat edilmez. Reversed-Z inverse-projection kodu mevcut; yeni göl yolu için ayrı reversed-Z GPU kabulü bu turda yapılmadı.
- Tam ışık/hava/DPR matrisi ve 15 dakika leak kontrolü yok. Bellek sayacı VRAM ölçümü değildir. Önceki yazılım renderer siyah terrain/ripple başarısızlığı açık kalır; RTX geçişi onun yerine yazılmaz.
- Scene-light glint gölge haritası okumaz; gölgeli kıyıların bütün parıltı kusurları çözülmüş değildir.
- Save şeması/validator, endpoint ve asset ingestion sınırları değişmedi; Codex Security taraması başlatılmadı.
- Kanıtlar mevcut `surface-v3/` Git-exclude ağacının `continuation-v4/` altındadır. PNG/ham loglar yerel diskte kalır; galeri yalnız Git checkout'u ile eksiksiz değildir. Toplu stage yapılmadı.
