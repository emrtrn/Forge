# Puddle Wheel Ripples — Faz 3

3 Kasım 2026. Puddle için gerçek araç temasından sönümlenen yüzey halkaları uygulandı.

## Kullanım

Landscape → Water → Puddle seç → **Wheel Ripples**. Aynı bölüm oluşturma
taslağında da bulunur. Enabled, Strength, Spread Speed, Ring Width, Wavelength,
Lifetime, Emission Interval ve Reset ayarları kaydedilir; halka geçmişi kaydedilmez.
Play'de hareket veya patinaj halkaları üretir. Varsayılan güç 1.5, yayılma
hızı 0.65 m/s, genişlik 0.135 m, dalga boyu 0.21 m, ömür 2 s, aralık 0.14 s.

## Davranış ve sınırlar

- Tek `VehicleHost.onPhysicsStep` aboneliği; Lake'in tekerlek/su düzlemi kesişimi
  ve zaman bazlı `LakeRippleState` mantığı paylaşılır. Puddle ayrıca gerçek
  ground contact ve eşleşen terrain collider ister. Bağlı su üçgeni ve güncel
  filtrelenmiş deforme yatak doğrulanır; yalnız XZ bounds yeterli değildir.
- Hareket ve `tractionSlip` emisyon üretir. Kuru/yanlış terrain, havadaki veya
  yüzeyi kesmeyen tekerlek reddedilir. Temas kesilince mevcut halkalar söner.
  Işınlanma veya büyük zaman adımından yeni halka üretilmez.
- En fazla 12 halka/gövde, toplam 48 halka; etkin gövdeler bütçeyi paylaşır.
  Grafik kalitesinin Lake halka limiti ek üst sınırdır; kaydedilen ayar değişmez.
  Her gövdede en fazla 128 uygun temas ve en fazla 32 araç değerlendirilir.
- Mevcut fill işi kuru adalar dahil kesin kıyı segmentlerini çıkarır. 32 açısal
  sektör, her halkanın kıyıya eriştiği mesafeyi muhafazakâr biçimde sınırlar.
  Dar ada iki merkez ışını arasına denk gelse de dalga arkasına çizilmez.
  Bu, engelde sonlandırmadır; kırınım veya hidrolik simülasyon değildir.
- 1024 kıyı segmenti üstünde dalgalar duraklatılır ve Puddle durum mesajında
  sınır belirtilir. Her yüzeyin 32×12 tek kanallı float stop dokusu vardır;
  ek reflection render target oluşturulmaz. Stop verileri doğumda/yatak
  yayımında hesaplanır, her animasyon karesinde yeniden taranmaz.
- Halkalar yalnız normal ve planar UV distorsiyonunu değiştirir; su kotunu,
  sakin kıyıyı, çamur deformasyonunu veya fizik collider'ını değiştirmez.
- Normal deformasyon penceresi kayması halka geçmişini silmez. Hide/Delete,
  kaynak/ayar değişimi, zorunlu yeniden kurulum ve controller dispose geçmişi
  temizler; araç script reset ve eski kayıt konumuna dönüşü de geçici Puddle
  geçmişini temizler. Dispose fizik aboneliğini ve GPU kaynaklarını bırakır.
- Yeni yatak yayınını beklerken temas güncel filtrelenmiş yatakta yeniden
  doğrulanır. Seed'e 32 noktalı ek kontrol muhafazakârdır: kıvrımlı havzada geçici
  olarak emisyonu azaltabilir. Kıyı kesme geometrisi Faz 2'nin en fazla 10 Hz
  yayımını izler; tam sürekli akış hesabı yapılmaz.

## Doğrulama

- 2380 tam engine kontrolü geçti (`npm.cmd run test:engine:slow`).
- 30/60/144 Hz hareket emisyonu, sabit konumda patinaj, kuru/hava/yanlış ground,
  ömür sonu, tek abonelik/dispose, kalite limiti, çok gövdede toplam 48 sınırı,
  validator sınırları, save/read round trip ve güncel yatak/snapshot eşitliği sınandı.
- Chromium: Puddle oluşturma/taslak, kayıt ve undo/redo/lock/hide/delete,
  Save/Reload/Play, planar yansıma; Lake fizik dalgası ve ayarlarının regresyonları
  geçti. Mevcut Puddle prototip kontrolü de geçti.
- Gerçek Rapier araç fixture'ı: 4 temas, 315 iz hücresi, 12 halka; sabit su kotu
  hatası 2.98e-9 m. Dalga normal probunda 101 piksel değişti (toplam fark 2138).
- Ayrı kontrollü ada GPU probu: ada arkasındaki kırmızı kanal toplamı kesme
  kapalıyken 3446, açıkken **0**; engelsiz yöndeki toplam iki durumda da 6784.
  WebGL hatası 0, terrain kaynak dosyası hash'i aynı.
- Tam `build:verify` ilk koşusu yeni bütçe testindeki yanlış doygunluk
  beklentisinde durdu. Patinajla doygunluk fixture'ı düzeltildi; tam engine
  paketi ve son TypeScript/üretim derlemesi yeniden çalıştırıldı. Önceki başarılı
  builder/type paketleri tekrar edilmedi. Nihai dist/world-data sonucu teslimde
  ayrıca geçti: strict dist doğrulaması ve world-data kontrolü temiz.

Kanıtlar: [araç](evidence/puddle-wheel-ripples/real-wheels.png),
[ayar paneli](evidence/puddle-wheel-ripples/controls.png),
[dalga normal tanısı](evidence/puddle-wheel-ripples/normals.png),
[ölçümler](evidence/puddle-wheel-ripples/measurements.json).

Hedef donanımda çok araçlı performans ve kullanıcının kendi sahnesindeki görünüm
kabulü açık. Gerçek araç fixture'ı 60 Hz fizik kullanır; 30/144 Hz eşdeğerliği
kontrollü temaslarla sınanmıştır. Bu faz rüzgar dalgacıklarını ve çamurlu suyun
optik yoğunluğunu kapsamaz. Yeni kayıt/validator alanları nedeniyle Codex Security
diff incelemesi önerilir; onaysız güvenlik taraması başlatılmadı.
