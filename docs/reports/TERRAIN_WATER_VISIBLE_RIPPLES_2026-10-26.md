# Tekerlek çevresinde görünür su halkaları

Kullanıcının `rendertargettest.mp4` kaydında tekerlek ve çamur sıçraması
hareket ederken su yansıması neredeyse sabit kalıyordu. Önceki regresyonlar
GPU'da küçük dalga verisinin bulunduğunu doğruluyordu; aydınlatılmış son
görüntüde hareketin yeterince görünür olduğunu doğrulamıyordu.

## Yeni yaklaşım

Temas ve fizik patinajı artık GPU simülasyonuna ek olarak dünya konumuna
sabitlenmiş analitik halka cepheleri oluşturur. Dalga cepheleri 0,7 m/s
hızla yayılır, 1,6 saniyede bırakılır; aynı anda en fazla 24 cephe tutulur.
Hareket eden veya patinaj yapan tekerlek yeni cephe üretir. Park edilmiş,
kuru veya havadaki tekerlek üretmez; ayrılan tekerleğin önceki halkaları
sönerek kaybolur. Level unload ve pencerenin dışına çıkma kaynakları temizler.

Normal oluşturma geçişi, mevcut render target'a bu cephelerin daha belirgin
eğimini ve kısa ömürlü tepe maskesini ekler. Arazi shader'ı bu eğimle ışığı
ve planar yansımayı büker. Hafif, çamur tonunda tepe katkısı, araç altındaki
koyu yansımada da hareketin seçilebilmesini sağlar. Sakin yüzeyden hesaplanan
kıyı maskesi korunur. Ayrı su geometrisi veya fiziksel su hacmi eklenmez.

Simülasyon tamponunun boş kanalları sakin su seviyesi ve bağlantı maskesini
taşır. Her halka, kaynak ile hedef arasındaki sekiz noktada bu veriyi
kontrol eder; kuru aralık ve farklı seviyedeki su dalga katkısını keser.
Bu, kısa mesafeli görsel bağlantı kontrolüdür; bir akış veya topolojik
su birikintisi çözümü değildir. Yeni bir terrain texture sampler'ı gerekmez.

## Doğrulama

Regresyona, halkalar açık/kapalıyken **son aydınlatılmış görüntünün** piksel
farkı eklendi. Debug normal/derinlik rengi bu ölçümde kullanılmaz. GAZ-52
fixture'ı da gerçek tekerlek temaslarının konumlarında aynı görsel kontrolü
uygular. Kontrollü görünüm aşamasında patinaj 0,8 olarak verilir; bu aşama
gerçek sürüşte patinajın büyüklüğü için kabul testi değildir.

- `npx.cmd tsc --noEmit`: geçti.
- Hedefli engine kontrolü: 11 geçti; tam gate yerine sayılmadı.
- `npm.cmd run build:verify`: geçti; 1.943 engine kontrolü, tüm tip
  kontrolleri, üretim build'i, strict dist ve world-data dahil.
- Fizik patinajı WebGL testi: geçti. Halkalar açık/kapalı karşılaştırmasında
  **1.114 pikselde en az 8/255 kanal farkı**, en büyük fark **65/255** oldu.
  Sakin kıyı maskesi aynı kaldı; durduktan sonra normal hareketi göstergesi
  203.054'ten 2.404'e düştü. Gösterge fiziksel enerji birimi değildir.
- Üç kalite / planar yansıma / reversed-Z / dar iz WebGL testi: geçti.
- GAZ-52 runtime WebGL testi: geçti. Aracın yanında, mevcut ışıklar ve
  post-process ile halka açık/kapalı ölçümü: **1.405 pikselde en az 8/255
  fark**, en büyük fark **31/255**.

Kanıtlar: `.dev-server/terrain-water-visible-accepted/` altında aydınlatılmış
halkalı/halkasız fixture görüntüleri ve JSON ölçümleri; son GAZ-52 koşusu
`.dev-server/terrain-water-visible-runtime-final/` altında. Son shader
ayarlarının tam gate çıktısı `.dev-server/terrain-water-visible-final-build.log`
dosyasında. Son durumda iki su fixture testi ve bir GAZ-52 testi geçti.

Elle deneme: sayfayı tamamen yenileyip LandscapeTest runtime'ını yeniden
başlatın. Islak çamurda ilerlerken veya yerinde patinajda tekerlek yanındaki
açık çamur tonlu cepheleri ve kırılan yansımayı izleyin. Gaz kesilip araç
durduğunda yeni halkalar oluşmamalı ve mevcut halkalar sönmelidir.

Görsel şiddetin kullanıcının kaydedilmiş sahnesindeki sürüşte kabulü ve
gerçek ekran kartı performansı ayrıca değerlendirilmelidir. Bu turdaki
tarayıcı kanıtları izole fixture koşularıdır.
