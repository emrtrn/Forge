# Araç sürüş ölçüm paneli — 2026-10-25

`3.mp4` kaydı ve kullanıcının geri bildirimi üzerine, hareket halindeki çamur hissi ile durduktan sonra hafif eğimde kalkamama durumunu ayrı değerlendirebilmek için salt okuyan bir runtime paneli eklendi. Fizik katsayıları, çekiş sınırları, şanzıman kararları, kamera ve authored LandscapeTest/terrain dosyaları bu çalışmada değiştirilmedi. Çalışma ağacında bulunan sahne ve tile/global düzenlemeleri kullanıcıya aittir.

Araç sürerken panel varsayılan olarak sağ üstte görünür; **F8** ile gizlenir/gösterilir. Normal Play/runtime yolunda çalışır, `?debug` gerekmez. Araçtan inilince gizlenir; level unload ve runtime dispose durumlarında temizlenir. `vehicle-telemetry` capability'si fork tarafından çıkarılabilir.

## Okumalar

- İleri eksendeki işaretli hız, gerçek hareket yönü, vites ve şanzıman modelinin motor devri. Örneğin araç 1. viteste geriye kayıyorsa vites **1**, hareket **geri** gösterilir; otomatik olarak R yazılmaz.
- Son sabit fizik diliminde kullanılan gaz, fren/geri pedalı, direksiyon ve el freni girdileri. Vites değişiminin güç kesintisi ayrıca belirtilir.
- **Motor isteği:** tutunma sınırlaması öncesindeki motor kuvveti; vites değişiminde veya devir kesicisinde sıfır olabilir.
- **Aktarılan motor itkisi:** motor kuvveti olan temaslı tekerlerde Rapier'in gerçekten uyguladığı ileri impuls / fizik dilimi. Fren impulsları motor itkisi olarak sayılmaz.
- **Teker direnci / uygulanan:** fizik diliminde uygulanan zemin impulslarının büyüklükleri / süre. **Kapasite** ayrı gösterilir; duruşta tüm direnç kapasitesi uygulanmış gibi sunulmaz.
- Gövde oturma sürtünmesi, yerçekiminin gövdenin ileri eksenindeki kuvveti ve dünya yatayına göre gövde eğimi. Bu açı doğrudan zemin eğimi ölçümü değildir.
- Her teker için baskın fizik malzemesi, fiziksel süspansiyon batma ofseti (cm), modelin patinaj payı (%) ve süspansiyon yükü (kN). Görsel katman rengi, fizik malzemesi yerine kullanılmaz.

Motor itkisi ve yerçekimi işaretlidir. Zemin dirençleri büyüklük olarak verilir; yanal direnç ve dönme etkileri nedeniyle bu sayıları doğrudan çıkarıp kesin net ileri ivme sonucu üretmemek gerekir. Motor devri mevcut şanzıman modelinindir; bağımsız patinaj/free-rev motor simülasyonu eklenmedi. Telemetri hiçbir ayarı değiştirmez ve save/load şemasına yeni alan yazmaz.

## Sonraki kayıt

Kamera aynı açıda tutularak aynı güzergâhta: sert zeminden çamura giriş, gaz ve fren sıfırken yavaşlama, tam duruş, ardından düz çamurda ve hafif yukarı eğimde yeniden tam gaz kalkış. Her aşamada panelin birkaç saniye okunur kalması yeterlidir. Önceki fizik değişikliği gaz açıkken yüzey direncini etkinleştirdiği için eğimde kalkışı etkileyebilir; bu geri bildirim henüz giderilmiş bir sürüş problemi olarak kabul edilmez.

## Doğrulama

Geri kayma/vites ayrımı, eksik verinin bilinmiyor gösterilmesi, çamurda istenen/aktarılan kuvvet ayrımı, uygulanan direncin kapasiteyi aşmaması ve nötr zemin hız eğrisinin birebir korunması geçti.

- `npx.cmd tsc --noEmit` ve smoke TypeScript kontrolü geçti.
- Nihai `npm.cmd run build:verify`: **exit 0**. Üretim build, import/içerik/smoke fixture sözleşmeleri, **1880 motor kontrolü**, runtime-only dist ve world-data kapıları geçti.
- Playwright `vehicle.spec.ts --grep "vehicle telemetry"`: **1 geçti**. Gerçek runtime içinde gaz/fren girdileri, vites, motor isteği, nötr zeminde sıfır direnç kapasitesi, F8 ile gizleme/gösterme ve küçük ekran sınırları kontrol edildi. İlk testte Blocking Volume'a desteklenmeyen bir fizik malzemesi alanı verilmişti; test standart nötr zemin sözleşmesine düzeltildi. Çamurdaki kuvvet ayrımı ayrıca gerçek Rapier motor testiyle doğrulandı.
- 1280×720 ve 640×480 ekran görüntüleri incelendi: panel okunur, bütün teker satırları ve alt açıklamalar görünür. Headless 3B sahnenin karanlık çizimi panel kabulünden ayrıdır; bu çalışmada zemin/araç görsel kalitesi kabulü yapılmadı.
- `git diff --check`: temiz. Branch/commit/push yapılmadı.

Hafif eğimde kalkamama ve hareket halindeki çamur hissi kullanıcı kaydıyla değerlendirilecek açık fizik/kalibrasyon konularıdır; bu UI çalışması bunları düzelttiği iddiası taşımaz.
