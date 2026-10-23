# LargeTerrain Offroad çalışma devri — 24 Ekim 2026

Durum: İlk arazi içeriği oluşturuldu. Görsel kabul ve tam sürüş doğrulaması tamamlanmadı. Kullanıcının oturumu bitirme isteğiyle çalışma durduruldu.

## Oluşturulan içerik

- Seviye: `public/assets/starter-content/Levels/LargeTerrain.level.json`.
- 512 × 512 m World Terrain; 2 × 2 tile; tile başına 256 quad; 1 m vertex aralığı.
- Yükseklik aralığı yaklaşık 1,51–105,10 m. Başlangıç düzlüğü, alçak havza/vadi, merkezi plato ve kuzey yükseltileri statik olarak şekillendirildi.
- Çayır, toprak/banket, kaya ve nemli vadi tabanı boya katmanları oluşturuldu. Çayır ve bankette mevcut çim/çakıl materyalleri kullanıldı.
- Yaklaşık 635,8 m uzunluk / 7 m genişlikte asfalt ve 278,5 m uzunluk / 5 m genişlikte toprak yol oluşturuldu. Her iki yol da mevcut `SM_Road_Asphalt.glb` ve `SM_Road_Dirty.glb` modellerini kullanan bağımsız Generic Spline `deformMesh` aktörleridir; collision açıktır.
- Çok tile için Landscape Splines desteği bulunmadığından World Terrain'in kendi `splines` alanı kullanılmadı. Yol güzergâhları boyunca terrain yüksekliği şekillendirildi.
- Mevcut `Script_Gaz52.actor.json` aracı başlangıca yerleştirildi. `forge.vehicle` Game Mode seçildi. Gaz52 sınıfı ve araç ayarları değiştirilmedi.
- Başlangıç, yol ayrımı, nemli vadi ve üst plato için editör hedef işaretleri eklendi.
- Kamera uzak kesim mesafesi `engine/render-three/camera.ts` içinde 300 m'den 2000 m'ye çıkarıldı. Bu değişiklik derleme/motor kontrollerinden geçti; genel görünümdeki boş ekran sorununu tek başına çözdüğü doğrulanmadı.

Terrain yalnızca bu seviyeye ait dosyalarda tutulur:

`public/assets/starter-content/Levels/LargeTerrain.landscapes/offroad-world.terrain.json`

Yanında bir global harita ve `offroad-world.tiles/` içinde dört tile binary dosyası vardır. Diğer seviyelerin terrain dosyaları değiştirilmedi.

## Geçen kontroller

- Tile sınırlarındaki yükseklik ve boya değerlerinin birebir eşitliği.
- Terrain tanımı, tile binary ve global haritanın mevcut Forge kayıt doğrulayıcılarıyla kontrolü.
- Yol spline alanlarının `validateLayout` sonrasında korunması.
- `npx.cmd tsc --noEmit`.
- `npm.cmd run build:verify`: tüm aşamalar geçti; motor paketinde 1594 kontrol geçti.
- Tarayıcıda seviye/outliner, World Terrain'in 512 × 512 m / 2 × 2 özellikleri, iki yol aktörü ve GAZ52 yüklendi. Yeniden yükleme sırasında içerik tekrar bulundu.
- Runtime GAZ52'yi `actor:0` olarak sahiplenip Vehicle kamerasına geçti. İlk denemede ileri hareket ve yaklaşık 8 km/sa hız gözlendi. Bu, tam rota veya tam sürüş kabulü değildir.

## Açık kalanlar

- Editör genel görünüm ekran görüntüleri boş/koyu kaldı. Runtime görüntüsünde de aydınlatma/görünürlük sorunu görüldü. Kök neden çözülmedi; görsel kalite kabul edilmedi.
- İlk otomatik sürüş kontrolü 20 saniyede `> 8 km/sa` koşulunu geçemedi; son gözlem 8 km/sa idi. Sonraki kontrol kullanıcı isteğiyle durduruldu. Fren/geri sürüş ve uçtan uca rota geçişleri tamamlanmış sayılmaz.
- Yolların tüm uzunluğu boyunca zeminle birleşimi, kavşaklar ve collider sürekliliği görsel/sürüş kabulünden geçmedi.
- Yol modellerinin `.uvw.json` ve `.materials.json` yan dosyaları için varsayılana dönüş uyarıları görüldü. Yakalanan ilk tarayıcı hata listesi boştu; uyarılar ayrıca çözülmedi.
- Çamur katmanı görsel boyadır. Fiziksel çamur tepkisi, batma ve dinamik tekerlek izi bu çalışmada eklenmedi.
- Sürüş performansı ve hedef cihaz FPS/bellek kabulü ölçülmedi. Headless test değerleri ürün performansı sonucu değildir.

## Devam noktası ve koruma

Önce editör/runtime görüntüleme sorununu incele; ardından iki yolun zemine oturmasını ve Gaz52 ile tam sürüşünü doğrula. Bu doğrulama bitmeden çevre dekorasyonuna veya büyük dünya genişletmesine geçme.

Seviye dışarıdan düzenlendi: açık editörde eski sahneyi kaydetmeden önce LargeTerrain'i yeniden yükle.

Yerel, Git tarafından yok sayılan çalışma dosyaları `.dev-server/large-terrain/` altındadır: ilk seviye yedeği `LargeTerrain.before.level.json`, içerik üretim scripti `author.mjs`, kontrol scriptleri ve tanı ekran görüntüleri. Ekran görüntüleri başarılı görsel kabul kanıtı değildir. Üretim scriptini, sonraki elle düzenlemeleri kontrol etmeden tekrar çalıştırma; bu script ürettiği araziyi yeniden yazar.

Bu görev için açılan tarayıcı kontrol süreçleri ve 5473 portundaki Vite sunucusu kapatıldı. Commit veya push yapılmadı. Çalışma sırasında görülen diğer oturumların motor/test/plan değişikliklerine müdahale edilmedi.
