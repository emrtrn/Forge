# Lake grafik kalite bağlantısı — 2026-10-29

Lake özellikleri Düşük/Orta/Yüksek/Ultra profillerine, Özel profil alanlarına
ve adaptif kaliteye bağlandı. Mevcut Quality menüsü hem editör viewport'unu
hem Play'i sürer; açık Play sekmesi diğer sekmedeki seçimi canlı izler.

| Lake üst sınırı | Düşük | Orta | Yüksek | Ultra |
| --- | --- | --- | --- | --- |
| Caustics | Kapalı | Kapalı | İzinli | İzinli |
| Planar yansıma | Kapalı | Kapalı | En fazla medium | En fazla high |
| Kıyı/temas/geometri köpüğü | Kapalı | İzinli | İzinli | İzinli |
| Islak kıyı/dip sunumu | Kapalı | İzinli | İzinli | İzinli |
| Eşzamanlı teker dalgası | 8 | 12 | 24 | 24 |

Profiller kapalı bir authored özelliği açmaz. Ultra, gölün medium yansımasını
high'a yükseltmez. Normal ayrıntıları, hafif geometrik dalgalar ve yumuşak kıyı
geçişi mevcut göl ayarlarıyla korunur. Terrain yüksekliği, boya, su kotu ve
kaydedilmiş Lake görünümü değiştirilmez; yeni scene/save şeması eklenmedi.

## Kaynak ömrü ve geçişler

- `engine/perf/lakeQuality.ts`, kalite sınırlarını terrain registries için
  geçici görünüm kopyasına uygular. Kalıcı Lake nesnesi yazılmaz.
- `LakeWaterController.setQuality()` geometri yayınlarıyla aynı sırada çalışır;
  `prepareLakeSnapshot`/`buildLakeGeometry` çağırmaz. Aynı mesh, BufferGeometry,
  position/normal buffer'ları, derinlik sorgusu ve teker temas geçmişi korunur.
- `LakeWaterObject.applyQuality()` yalnız köpük sampler/define'larını, yansıma
  kaynağını ve dalga sınırını değiştirir. Düşük kaliteye geçişte kıyı/geometri
  köpüğü GPU dokuları, caustics/ıslak kıyı kayıtları ve kullanılmayan planar
  target lease'leri bırakılır. Gereken kaynaklar üst seviyede yeniden oluşturulur.
- Ortak yansıma kaynağı başka bir River/Lake tüketicisindeyse onun lease'i
  korunur. Düzlem/grup/kalite anahtarı aynı Lake'ler tek kaynağı paylaşır.
- Düşük kalite baked-foam HTTP okumasını başlatmaz; yüklenmiş decode cache'ini
  bırakır. Editörün kaydedilmemiş bake/undo artifact'ları korunur. Eski bir
  asenkron yanıt kalite düşürüldükten veya level değiştikten sonra cache/GPU
  kaynağını yeniden dolduramaz. Controller dispose sonrası level travel'da
  tekrar kullanılabilir.
- Maskeler gövde başına sırayla yenilenir. Görsel bütçe reddi mevcut su
  yüzeyini korur ve `qualityErrors` tanısı üretir; sessiz çözünürlük düşürme yoktur.
- Adaptif sistem AO/DoF ve parçacık adımlarından sonra Lake yansımasını
  high → medium → off azaltabilir; ardından caustics, dalga sayısı ve kıyı
  efektlerini azaltabilir. CPU baskısında dalga sayısı da azaltılabilir.
  Geri yükseliş mevcut ters sıra mekanizmasıyla seçilmiş profil tavanına kadardır.

## Doğrulama

- TypeScript ve smoke fixture tip kontrolü geçti.
- Odaklı engine koşusu **26 geçti / 2.069 atlandı**; tek başına tam gate sayılmadı.
  Altı yeni Lake kalite kontrolü; kaynakların dispose edilmesi, üç tam profil
  turu, paylaşılan reflection lease'leri, hızlı profil değişimleri, dalga sınırı,
  authored ayarların korunması, bekleyen editör artifact'ları, geciken foam
  yanıtının iptali ve dispose sonrası travel'ı kapsar.
- `npm.cmd run build:verify` **çıkış 0, 2.095 engine kontrolü**: import sınırları,
  smoke/content/UI tipleri, release araçları, production build, strict dist ve
  world-data geçti. Kanıt: `.dev-server/lake-quality-build-verify.log`.
- Headed Chromium'da **4/4 browser senaryosu geçti**: mevcut editor Quality
  menüsü/canlı Play, yeni Lake profil geçişleri, geometry-foam Calculate/undo/
  Save/Reload/Play ve caustics görünüm/kalıcılık regresyonu.
  Kanıt: `.dev-server/lake-quality-final-browser/`.
- Menü kapatılarak yapılan son görsel tekrar da **1/1 geçti**:
  `.dev-server/lake-quality-visual-browser/`. Düşük/Ultra görüntüleri incelendi;
  düşükte caustics/köpük/yansıma kapanırken su yüzeyi ve normal ayrıntısı kalıyor.
- Yeni senaryo aynı mesh kimliğini, normal/dalga/kıyı geçişi değerlerini,
  8/12/24 dalga sınırını, 0/256/512 reflection boyutlarını, Save/Reload sonrası
  authored ayarları ve değişmeyen terrain hash'ini kontrol eder. Konsol/page/GL
  hatası yoktur. İlk denemedeki eksik QA favicon 404'ü giderilerek koşu tekrarlandı.
- Genel renderer texture sayısı editörde Ultra **30 → Low 18 → Ultra 30**,
  Play'de Ultra **24 → Low 12** gözlendi. Sayılar post-process/gölge kaynaklarını
  da içerir; Lake'e özel byte veya GPU p95 ölçümü değildir.

## Kalan sınır

Bu iş profil bağlantısı ve kaynak yaşam döngüsüdür. Önceki 66 ms rebuild
takılmasının fonksiyon bazında çözümü ve gerçek donanımda yeni profil bazlı
GPU/tepe bellek kabulü ayrı kalır. Eski performans tabloları bu yeni kodun
yeniden ölçülmüş sonucu diye sunulmaz. 360 m alanda varsayılan dar köpük bandı
için mevcut maske bütçesi korunur; göl ayarı otomatik genişletilmedi.

Authored sahneler değiştirilmedi. Commit/push yapılmadı.
