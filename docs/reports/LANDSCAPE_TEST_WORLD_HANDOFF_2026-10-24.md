# LandscapeTest — yol ve environment teslimi

24 Ekim 2026. Önceki sculpt/boyama aşamasının devamıdır. Mevcut `LandscapeTest` seviyesi güncellendi; yeni seviye asseti oluşturulmadı. Önceki dört Terrain materyali korunuyor.

## Yol ve zemin

| Rota | Uzunluk | Genişlik | En yüksek eğim | En küçük dönüş yarıçapı |
| --- | ---: | ---: | ---: | ---: |
| Mesa Loop / asfalt çevrim | 1.026,7 m | 7,5 m | %15,31 | 19,60 m |
| Valley Trail / toprak kol | 1.274,0 m | 6,5 m | %26,57 | 14,75 m |

Asfalt çevrim kamyonun başlangıcından çıkar, merkez platonun batı yamacı ve kuzey eteğini dolaşıp başlangıca döner. Toprak kol batıdaki iki bağlantıdan güney vadisine iner ve geri bağlanır. Toplam yol yaklaşık **2,30 km**; karlı kuzey zirvelerine uzanan yol bu aşamada yapılmadı. Toprak kolun dik kısımları düşük hızla sürülecek offroad bölümleridir.

Kullanıcının seçtiği mevcut `SM_Road_Asphalt.glb` ve `SM_Road_Dirty.glb` modelleri kullanıldı. Çok tile Landscape için bağımsız Generic Spline `deformMesh` aktörleri oluşturuldu. Kaynak yol GLB'leri değiştirilmedi. Kısa segmentlerde özgün model UV'leri korundu; ilk denemedeki enine doku tekrarı giderildi.

İki yolun da gerçek deforme mesh collider'ı açık. Terrain üzerinde yol genişliği boyunca düz taban ve dışarı doğru yumuşak banket oluşturuldu; banketler toprakla boyandı. Yol bağlantıları ortak, yataya yakın kotlarda birleşiyor. Yol yüzeyine uyarlama arazinin 72.772 örneğini, yaklaşık **%6,93**'ünü değiştirdi. En büyük yerel kazı 19,40 m, dolgu 22,15 m; ana dağ/plato/vadi formları korunuyor.

## Environment

| Model | Yerleşim sayısı |
| --- | ---: |
| Alp çamı | 628 |
| Geniş yapraklı vadi ağacı | 138 |
| Kaya A | 165 |
| Kaya B | 169 |
| Yeşil ot kümesi | 695 |
| **Toplam** | **1.795** |

Ağaçlar batı yamaçları, merkezdeki korular, kuzey dağ etekleri ve güneybatıdaki kümelerde yer alıyor. Zirveler ve ana görüş koridorları açık bırakıldı. Yol çevresinde model boyutlarına göre boşluk ayrıldı. Dik yüzeylerde kaya/ot yerleşimi sınırlandı, ağaç kökleri ve kayalar zemine gömüldü. Ağaçlarda dar gövde collider'ı, kayalarda mesh collider kullanılıyor; otlar çarpışmasız.

İzin verilen ThreeAges kaynağından beş model alındı. Kaynak dosyalar değiştirilmedi; seçilen modeller tüm geometri ve dokularını GLB içinde taşıyor:

| ThreeAges içindeki kaynak | Forge içindeki hedef |
| --- | --- |
| `assets/ThreeAges/StaticMeshes/Resource_PineTree.glb` | `assets/LandscapeTest/Models/LT_Alpine_Pine.glb` |
| `assets/ThreeAges/StaticMeshes/Resource_Tree1.glb` | `assets/LandscapeTest/Models/LT_Valley_Tree.glb` |
| `assets/ThreeAges/NatureMega/Grass_Common_Tall.glb` | `assets/LandscapeTest/Models/LT_Meadow_Tuft.glb` |
| `assets/ThreeAges/NatureMega/Rock_Medium_1.glb` | `assets/LandscapeTest/Models/LT_Boulder_A.glb` |
| `assets/ThreeAges/NatureMega/Rock_Medium_2.glb` | `assets/LandscapeTest/Models/LT_Boulder_B.glb` |

Kaynak kökü `C:/Users/emret/Desktop/Games/ThreeAges/public/`. Kaynak lisans metadata'sı korundu. Beş manifest kaydı, model materyal/UVW/collision yan dosyaları eklendi. Kullanılan iki yol için de eksik olan altı varsayılan yan dosya oluşturuldu; var olan yan dosyalar değiştirilmez.

Kamyonun aktör tanımı, konumu ve yönü değişmedi. Üç hedef noktası eklendi: başlangıç, toprak yol ayrımı ve vadi tabanı. World Settings `killZ` değeri, vadinin altına gelecek şekilde **−160 m** olarak ayarlandı; gökyüzü, ışıklar, bulut ve post-process verileri korundu. Su yüzeyi, bina veya ek araç yerleştirilmedi.

## Doğrulama

- Terrain/tile/global ve materyal/UVW/collision/layout validatorları geçti. Yol alanları editor kaydetme doğrulamasından korunarak geçiyor.
- 6.168 tile kenar örneğinde yükseklik ve dört boya katmanı birebir eşit.
- 2.304 yol tabanı örneğinde Terrain ile spline kotu arasındaki en büyük fark **8,46 cm**; banket dahil kontrol edildi.
- Gerçek yol GLB'lerinden 178 deforme mesh/collider parçası üretildi: 21.360 üçgen. Kullanılabilir genişliğin merkezi ve iki yanında 1.383 dikey yüzey sorgusu yapıldı; boşluk bulunmadı. Bu örnekleme tam rota sürüşü yerine geçmez.
- Altı Playwright görünümü incelendi: genel, üstten, başlangıç, orman içi asfalt, birleşimler ve vadi. Browser error ve başarısız HTTP isteği yok. Mevcut Mercedes yan dosya JSON uyarıları, Chromium GPU readback uyarıları ve Rapier başlangıç parametresi uyarısı sürüyor.
- İzole runtime kopyasında mevcut GAZ-52, W ile **13 km/saate** ulaştı; S ile **0 km/saate** indi. İleri hareket ve fren kontrolü geçti. Kısa gözlemde negatif hız görülmedi; geri vites sürüşü kabul edilmiş sayılmıyor.
- **Tam çevrim sürüşü, uzun inişte frenleme ve tüm birleşimlerden araçla geçiş henüz doğrulanmadı.** Kamyon başlangıcıyla sınırlı bir sürüş kontrolü yapıldı.
- `npm.cmd run build` geçti; içindeki `tsc --noEmit` de geçti. `node --check` ve değişen içerik için `git diff --check` geçti. Engine kodu düzenlenmedi; tam engine paketi ve `build:verify` bu içerik aşamasında çalıştırılmadı.
- `check:assets` halen baseline dışında kalan önceki iki kayıt uyarısı nedeniyle exit 1 veriyor: `LandscapeTest.foliage.json` ve `LargeTerrain.landscapes/offroad-world.terrain.json`. Önce/sonra validator karşılaştırması **0 hata ve aynı 3 uyarı** gösteriyor; yeni asset hatası/uyarısı eklenmedi.
- Yayınlanan **46 dosya**, incelenen staging kopyalarıyla bayt bazında eşleşti. GAZ-52 aktör dizisi, Landscape bağlantısı, ışık/Sky/Cloud/PostProcess alanları yedekle eşit.

**Aydınlatma ve uzak görünüm sınırı:** Görseller ve runtime başlangıç kontrolü, önceki aşamadaki gibi yalnızca önizleme HTTP yanıtında nötr aydınlatma uygulanarak alındı; gerçek seviyenin aydınlatma ayarları değiştirilmedi. Özgün Sky/PostProcess ile görsel kabul açık. Editör yardımcı çizgileri ekran görüntülerinde gizlendi. Yüksekten genel görünümde bazı yol parçaları Terrain LOD yüzeyiyle örtüşebiliyor; yakın yol görünümleri ayrıca incelendi. Tüm mesafelerde LOD/yol örtüşmesi ve farklı donanımlarda performans kabulü yapılmadı. Hedef cihaz FPS ölçümü yok.

## İnceleme dosyaları ve devam

[Genel görünüm](landscape-test-world-2026-10-24/overview.png) · [üstten](landscape-test-world-2026-10-24/top.png) · [başlangıç](landscape-test-world-2026-10-24/start-road.png) · [orman yolu](landscape-test-world-2026-10-24/forest-road.png) · [birleşimler](landscape-test-world-2026-10-24/junction.png) · [vadi yolu](landscape-test-world-2026-10-24/valley-road.png) · [runtime](landscape-test-world-2026-10-24/runtime-drive.png).

[İçerik özeti](landscape-test-world-2026-10-24/summary.json), [mesh/collider kontrolü](landscape-test-world-2026-10-24/geometry-qa.json), [tarayıcı kontrolü](landscape-test-world-2026-10-24/browser-qa.json), [yayın eşleşmesi](landscape-test-world-2026-10-24/publication-validation.json), [derleme](landscape-test-world-2026-10-24/build.log), [asset kontrolü](landscape-test-world-2026-10-24/asset-health.log).

İçerik aracı: `tools/world/author-landscape-test-world.mjs`. Önce staging üretir; `--apply` özgün dosya hashlerini ve yeni dosya çakışmalarını denetler. Manuel seviye düzenlemelerinden sonra yeniden üretmek için kullanılmamalı. Önceki dosyaların yedeği: `.dev-server/landscape-test-world/backups/2026-10-24T17-13-41-045Z/`.

**Editörde kaydetmeden önce LandscapeTest'i yeniden yükleyin.** Kamyonla başlangıçtan ileri giderek asfalt çevrime çıkılabilir; batıdaki iki bağlantı güneydeki toprak kolu açar. Sonraki değerlendirme tam rota sürüşü ve varsa yerel eğim/viraj düzeltmeleridir.

Asset içe aktarma ve içerik üretim aracı için dar kapsamlı Codex Security diff incelemesi önerilebilir; kullanıcı onayı olmadan tarama başlatılmadı.
