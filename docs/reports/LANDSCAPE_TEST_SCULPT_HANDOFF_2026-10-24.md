# LandscapeTest — sculpt ve boyama teslimi

24 Ekim 2026. Referans: `docs/reference/Forge Offroad_ Büyük Sculpt Formları_1.png`.

Mevcut Landscape üzerinde sculpt ve boyama tamamlandı. Bu aşama environment ve yol yerleşimini kapsamıyor. Yeni seviye oluşturulmadı; `LandscapeTest.level.json` ve mevcut aktörler değiştirilmedi.

## Oluşturulan arazi

- 1024 × 1024 m, 4 × 4 tile, 1 m örnek aralığı; 1.050.625 benzersiz yükseklik örneği.
- Kuzeybatıda dağ zinciri, kuzeyde yüksek plato, kuzeydoğuda daha yüksek karlı zirveler.
- Merkezde düzensiz kenarlı geniş mesa; doğuda sırtlar, güneydoğuda kuru dağlar, güneybatıda alçak açık alanlar.
- Güneyde birleşen vadi ve kuru akarsu yatakları. Su yüzeyi veya su aktörü eklenmedi.
- Noise ile büyük/küçük yüzey değişimi, Terrace ile katmanlı yamaçlar; gerçek engine erosion fonksiyonuyla 18 Thermal ve 23 Hydraulic bölge geçişi.
- Yükseklik aralığı yaklaşık −86,70 ile 149,10 m. Kamyonun mevcut [0,0,0] konumunda 36 × 44 m düz başlangıç alanı ve yumuşak geçiş bulunuyor. Bu alan sürüş kabul testi yerine geçmez.

## Boyama ve materyaller

`public/assets/LandscapeTest/Materials/` altında dört materyal oluşturuldu ve Terrain katmanlarına bağlandı:

| Katman | Materyal | Ortalama ağırlık |
| --- | --- | --- |
| Alpine Meadow | `lt-meadow` | %49,18 |
| Earth and Scree | `lt-earth` | %18,34 |
| Layered Rock | `lt-rock` | %31,96 |
| Alpine Snow | `lt-snow` | %0,51 |

Boyama yükseklik, eğim, bölge ve gürültüye göre geçişler içeriyor. Dik yüzeylerde kaya, alçak kuru yataklarda toprak, uygun düzlüklerde çayır ve yüksek zirvelerde kar kullanıldı.

Çayır ve çakıllı toprak dokuları, kullanıcının izin verdiği ThreeAges klasöründen kopyalandı; kaynak dosyalar değiştirilmedi:

- `C:/Users/emret/Desktop/Games/ThreeAges/public/assets/ThreeAges/Textures/T_TA_Grass_Meadow_BC.webp` → `public/assets/LandscapeTest/Textures/LT_Meadow_BC.webp`
- `C:/Users/emret/Desktop/Games/ThreeAges/public/assets/ThreeAges/Textures/T_TA_Road_Gravel_BC.webp` → `public/assets/LandscapeTest/Textures/LT_Earth_BC.webp`
- Kaya mevcut `t-rock-basalt-d` dokusunu kullanıyor.
- Kar dokusu built-in `image_gen` aracıyla üretildi; CLI kullanılmadı. Son dosya: `public/assets/LandscapeTest/Textures/LT_Snow_BC.png`, gerçek boyut **1254 × 1254**, 2.700.420 bayt. Prompt 2048 istedi; teslim edilen boyut 1254'tür. Kenarların matematiksel olarak kesintisizliği ayrıca ölçülmedi.

Kar dokusu için kullanılan son prompt:

```text
Create one production-ready seamless tileable snow ground BASE COLOR / ALBEDO texture for a realistic stylized alpine offroad game terrain. Square 2048x2048. Orthographic perfectly top-down flat material scan, no perspective, no objects, no horizon. Packed aged alpine snow, fine crystalline granular grain, subtle wind-compressed mottling and tiny shallow natural variations. Off-white ivory/light cool-gray, high brightness overall, restrained micro-contrast, almost no dark colors, no blue cast, no obvious lighting direction, no baked shadows or ambient occlusion, no highlights. No footprints, no tire tracks, no stones, no grass, no text or borders. Uniform detail scale, edges must tile seamlessly in both directions, no central focal element. This is a flat color texture to repeat over snowy mountain peaks; NOT a landscape illustration.
```

## Doğrulama ve sınırlar

- Terrain tanımı, 16 tile ve global map üretim validatorlarından geçti. Yükseklikler sonlu, boya ağırlıkları normalize; 6.168 ortak kenar örneğinde yükseklik ve dört boya katmanı birebir eşleşiyor.
- Yayınlanan 26 dosya staging kopyalarıyla bayt bazında eşleşti. Seviye SHA256 önce/sonra aynı: `22ef6bf083f582fd8b26343dbe1da7b2bc7d18746a8892419c3991e8ad490b35`.
- `npx.cmd tsc --noEmit` geçti. Son `npm.cmd run build` geçti; ilk denemedeki eşzamanlı HLOD modül hatası son kontrolde görülmedi. Vite, sandbox esbuild erişim kısıtı nedeniyle izinli ortamda çalıştırıldı.
- `check:assets` yeşil değil: başlangıçta da bulunan `LandscapeTest.foliage.json` ve `LargeTerrain.landscapes/offroad-world.terrain.json` kayıt uyarıları baseline dışında kalıyor. Önce/sonra karşılaştırması **0 hata, aynı 3 uyarı** gösteriyor; bu çalışmanın eklediği assetlerde yeni hata/uyarı yok. Dört materyalin thumbnail bilgisi editor tarafından üretilecek.
- Altı Playwright görünüm kontrolü geçti: genel, üstten, merkez plato, kuzey dağları, güney vadisi ve kamyon başlangıcı. İstek hatası ve browser error yok. Mevcut Mercedes sidecar JSON uyarıları ve Chromium GPU readback uyarıları var.
- **Görseller nötr aydınlatma önizlemesidir.** Orijinal Sky/Cloud/PostProcess ayarları headless Chromium'da boş/koyu viewport verdi. Önizleme kopyasında yalnızca HTTP yanıtı üzerinden bu ayarlar geçici çıkarılıp ambient ışık verildi; gerçek seviye ayarları korunuyor. Bu nedenle orijinal aydınlatmayla görsel kabul tamamlandı denemez. Ekran görüntüleri arazi şekli ve boyasını gösterir.
- Tam engine paketi, `build:verify`, runtime sürüş ve yol/collider kabulü bu içerik aşamasında çalıştırılmadı. Performans ölçülmedi.

Kanıtlar: [genel görünüm](landscape-test-sculpt-2026-10-24/overview.png), [üstten](landscape-test-sculpt-2026-10-24/top.png), [kuzey dağları](landscape-test-sculpt-2026-10-24/north-mountains.png), [güney vadisi](landscape-test-sculpt-2026-10-24/south-valley.png), [arazi özeti](landscape-test-sculpt-2026-10-24/summary.json), [browser kontrolü](landscape-test-sculpt-2026-10-24/browser-qa.json), [asset karşılaştırması](landscape-test-sculpt-2026-10-24/asset-validation.json).

## Dosyalar ve devam

Arazi dosyaları `public/assets/starter-content/Levels/LandscapeTest.landscapes/` altında. Yeni materyal/dokular `public/assets/LandscapeTest/` altında; yedi asset manifest kaydı eklendi.

İlk üretimdeki dosyalar ve manifest yedeği: `.dev-server/landscape-test-sculpt/backups/2026-10-24T16-28-38-743Z/`. İçerik üretim aracı: `tools/world/author-landscape-test.mjs`; önce staging üretir, `--apply` öncesi özgün dosya hashlerini ve yeni asset çakışmalarını kontrol eder. Manuel düzenlemelerden sonra yeniden çalıştırılacak genel bir editor komutu değildir.

**Açık editörde kaydetmeden önce LandscapeTest'i yeniden yükleyin.** Arazi dışarıdan güncellendiği için açık editor belleğindeki eski veriler kaydedilmemeli.

Sonraki aşamada kullanıcının görsel değerlendirmesinden sonra environment ve yol yerleşimi yapılabilir. Verilen yol modelleri: `assets/starter-content/StaticMeshes/Environment/SM_Road_Asphalt.glb` ve `assets/starter-content/StaticMeshes/Environment/SM_Road_Dirty.glb`. Şu aşamada yol modeli, spline, ağaç, kaya veya başka environment aktörü yerleştirilmedi.

İstenirse generated content ve manifest değişiklikleri için dar kapsamlı Codex Security diff incelemesi yapılabilir; bu çalışmada scan başlatılmadı.
